# QuickServe — Technical Architecture & Implementation Plan

## 1. Stack decision (solo founder, two platforms, low cost)

| Layer | Choice | Why | Alternatives rejected |
|---|---|---|---|
| Mobile app | **React Native + Expo (TypeScript, Expo Router)** | One codebase for Android and iOS; **EAS Build** produces store binaries in the cloud, so **no Mac is needed for iOS**; OTA updates; huge ecosystem | Flutter (also good, but Dart plus a Mac is needed for local iOS builds); native ×2 (too slow for one person) |
| Backend | **Supabase** (Postgres + Auth phone OTP + Storage + Realtime + Edge Functions) | Free tier for the MVP, SQL with Row Level Security, realtime chat out of the box, PostGIS for distance search | Firebase (NoSQL makes ratings/aggregates/geo/payments ledgers harder); custom Node API (more ops) |
| Payments | **Razorpay** Payment Links + **Route** transfers (India) | UPI, marketplace split, licensed PA | Stripe Connect is used if you launch outside India |
| SMS OTP | Supabase Auth phone provider → **Twilio / MSG91** | MSG91 is cheaper in India and DLT-compliant | — |
| Push | **Expo Notifications** (FCM/APNs under the hood) | Free, one API | — |
| Maps | expo-location + Google Maps (react-native-maps) | Address pin | — |
| Analytics/crash | PostHog (free tier) + Sentry (free tier) | — | — |
| CI/CD | EAS Build + EAS Submit (+ GitHub Actions later) | One command to the stores | — |

## 2. System diagram
```
┌──────────────── Mobile app (Expo RN, TS) ───────────────┐
│  Customer screens   Provider screens   Shared (chat/auth)│
└───────┬──────────────────┬────────────────────┬──────────┘
        │ supabase-js (RLS)│ Realtime (chat,    │ open Razorpay
        ▼                  ▼ booking status)    ▼ payment link
┌──────────────────── Supabase ───────────────────────────┐   ┌─────────────┐
│ Auth (phone OTP)  Postgres+PostGIS  Storage (job/dispute photos)│   │  Razorpay   │
│ RPC functions (SECURITY DEFINER): state machine,        │◄─►│  Orders/    │
│   search_providers, submit_quote, approve_quote ...     │   │  Links/Route│
│ Edge Functions (Deno): create-payment, razorpay-webhook,│   └─────────────┘
│   release-payouts (cron)                                │
└─────────────────────────────────────────────────────────┘
```

**Principle:** the client can **read** through RLS but **never directly mutates prices or booking status**. Every state transition goes through a Postgres RPC function that validates the actor and the current state. Money movements happen only in Edge Functions using secret keys.

## 3. Data model (Postgres)
```
profiles(id=auth.uid PK, full_name, avatar_url, role_customer bool, role_provider bool, created_at)   -- public-safe fields only
addresses(id, user_id→profiles, label, line1, city, lat, lng, location geography, is_default)
categories(id, slug, name, icon, pricing_mode 'quote'|'fixed', active)
providers(id=profiles.id PK, bio, city, service_radius_km, base_location geography,
          years_experience, languages text[], kyc_status 'pending'|'verified'|'rejected',
          is_online bool, rating_avg numeric, rating_count int, jobs_completed int,
          commission_tier int, razorpay_account_id, created_at)
provider_services(id, provider_id, category_id, skill_level 'beginner'|'skilled'|'expert'|'certified',
          visit_fee int (paise), labour_rate int (paise), rate_unit 'hour'|'job', unique(provider_id,category_id))
rate_card_items(id, provider_service_id, title, price int)
bookings(id, customer_id, provider_id, category_id, address_id, description, photos text[],
         scheduled_at, status booking_status, visit_fee int, approved_quote_id, amount_paid int,
         platform_fee int, commission int, created_at, accepted_at, completed_at, cancelled_reason)
booking_secrets(booking_id PK, start_otp, end_otp, start_attempts, end_attempts)
         -- NO direct client SELECT. Customer reads OTPs only via RPC get_booking_otps() (end OTP only in
         -- completion_requested). Verified only inside SECURITY DEFINER RPCs; 5 wrong attempts → lock → regenerate.
         -- Provider sees the exact address only after accepting (area/distance before).
private_user_accounts(user_id PK, phone, expo_push_token)   -- own row only; expo_push_token is legacy (see push_devices)
quotes(id, booking_id, version int, status 'sent'|'approved'|'rejected'|'superseded',
       subtotal_labour, subtotal_parts, subtotal_other, total, note, created_at)
quote_items(id, quote_id, kind 'labour'|'part'|'other', title, qty, unit_price, bill_photo_url)
payments(id, booking_id, purpose 'visit_fee'|'balance'|'fixed', amount, status 'created'|'paid'|'failed'|'refunded',
         razorpay_link_id, razorpay_payment_id, created_at)
payouts(id, booking_id, provider_id, amount, commission, commission_gst,
        status 'pending'|'frozen'|'transferred'|'failed'|'reversed'|'partially_reversed', release_after timestamptz)
payout_transfers(id, payout_id, source_payment_id, amount, razorpay_transfer_id, status)
reviews(id, booking_id UNIQUE, customer_id, provider_id, rating 1..5, punctuality, quality,
        behaviour, pricing, comment, photos text[], provider_reply, created_at)
messages(id, booking_id, sender_id, body, image_url, created_at)
booking_events(id, booking_id, actor_id, from_status, to_status, at)   -- audit log
booking_chat_reads(booking_id, user_id, last_read_at, viewing_until)  -- owner-only RLS; written via RPCs/trigger
push_devices(id, user_id, token UNIQUE, platform, last_seen_at)       -- Expo push tokens, several per user
notifications(id, user_id, kind, booking_id, title, body, data, collapse_key, count,
              status 'pending'|'sending'|'sent'|'failed'|'skipped', attempts, next_attempt_at, sent_at, read_at)
push_tickets(ticket_id PK, notification_id, token, created_at)      -- Expo tickets awaiting receipts (service only)
```
All money is stored in **integer paise**.

### Chat read state, unread counts and notifications (migrations 0007, 0010)
- **Unread** = messages in a booking from the *other* participant newer than my `booking_chat_reads.last_read_at`.
  Sending a message marks the chat read for the sender (trigger), so my own messages never count. Existing chats were
  backfilled to "read up to my own last message".
- RPCs (participants only): `get_unread_counts()` → `(booking_id, role, unread, last_message_at)` for bookings with
  unread > 0; `mark_chat_read(booking_id, viewing)` (idempotent, never moves backwards; `viewing=true` sets 45 s
  presence that the app refreshes every 20 s while the chat is open and focused); `get_chat_read_state(booking_id)`
  (my and the other side's last read → "New messages" divider and "Seen").
- App: `UnreadProvider` (`src/lib/unreadContext.tsx`) fetches counts on sign-in, foreground and every 60 s, and updates
  live from a Realtime subscription on `messages` (RLS-scoped), with a debounced refetch. Badges: booking cards
  (customer Bookings, provider dashboard and Jobs), booking-detail chat button, Bookings/Jobs tab, app icon (iOS). A
  message for a chat that is not open shows an in-app banner (works in Expo Go). Demo mode mirrors the same rules.
- **Outbox**: triggers on `messages` and `booking_events` queue rows in `notifications` (recipient = the other party,
  never the actor; only for events < 10 min old so seeds/backfills never push). Pending chat rows for the same booking
  collapse into one (`count`, latest text). Kinds today: `chat_message`, `booking_requested` (provider),
  `booking_accepted`, `provider_en_route`, `quote_sent`, `change_order_sent`, `completion_requested`,
  `booking_declined`, `booking_expired` (customer), `booking_cancelled` (provider). No push while the recipient has the
  chat open (presence) or after they have read it (re-checked at send time).
- **Delivery**: `send-notifications` Edge Function (x-cron-secret) is kicked by a statement trigger through `pg_net`
  (vault `project_url` + `cron_secret`) and by a 1-minute cron. It claims due rows (`claim_due_notifications`, SKIP
  LOCKED), sends ≤100 messages per Expo request (`collapseId`/`tag`/`threadId` per booking, Android channels
  `messages`/`bookings`, iOS badge = total unread, `data.url` deep link), records tickets, retries failures with backoff
  (1, 2, 4, 8 min; 5 attempts), checks receipts after 15 min and deletes `DeviceNotRegistered` tokens.
- **Privacy**: push bodies are masked by `_mask_preview` (emails, UPI ids, links, 8+ digit numbers) and clipped; data
  carries only ids and an in-app route. The app follows only `/chat|booking|quote/<id>` routes from a payload.

### Provider onboarding, go-live and payout rails (migrations 0008, 0009, 0011)
Spec: [08-Provider-Onboarding.md](08-Provider-Onboarding.md).
- New tables: `category_skills`, `document_types`, `provider_availability`, `provider_time_off` (doc 07 §3.9),
  `provider_portfolio`, `provider_documents` (private bucket `provider-docs`), `provider_payout_accounts`,
  `provider_onboarding_events`, `app_config` (`payout_rail`), `provider_receivables` + recoveries.
  `payout_transfers` gains `rail` (snapshot), `gateway_status`, `utr`, `recovered_amount`, `idempotency_seq`.
- **One go-live predicate** `_provider_is_live(provider)` (payout verified, submitted, not suspended/deactivated,
  ≥ 1 active service with required docs approved) used by `search_providers`, `create_booking` and the RLS read
  policies. `create_booking` also rejects windows outside working hours, during time off, when paused or when
  `max_jobs_per_day` is reached (`provider_unavailable: …`), under a per-provider advisory lock.
- **Column privacy**: `providers` is readable column-by-column; `base_location`, `razorpay_account_id`, gender and
  onboarding/review fields are private (owner reads via `get_my_provider()`; public profile via
  `get_provider_public_profile()`).
- **Payout rails**: `supabase/functions/_shared/payout-rail.ts` (Route linked accounts | RazorpayX contact + fund
  account + penny drop + payouts), used by `provider-payout-account`, `release-payouts` and `razorpay-webhook`.

### Booking state machine (canonical — enforced by RPCs; PRD B4 refers here)
Final `booking_status` enum: `pending_payment, requested, accepted, en_route, inspecting, quote_sent, awaiting_payment, in_progress, completion_requested, completed, closed, closed_no_work, declined, expired, cancelled, disputed, refunded`.
```
pending_payment ──visit fee paid (webhook)──► requested
requested ──accept(P)──► accepted ──start_trip(P)──► en_route ──arrive(P, start OTP)──► inspecting
   │ decline(P) / expire(cron 15m) / cancel(C)                           │ send_quote(P) (initial quote)
   ▼                                                                     ▼
declined / expired / cancelled                     quote_sent ──approve(C)──► awaiting_payment
                                                       │ reject(C) → closed_no_work (visit-fee payout to provider)
awaiting_payment ──balance paid (webhook)──► in_progress
in_progress: change order = new quote version; booking STAYS in_progress.
   approve → pay the increment (quote 'approved_pending_payment' → 'approved' on webhook)
   reject  → original approved scope and amount stand
in_progress ──request_completion(P)──► completion_requested
completion_requested ──customer end OTP OR auto-confirm after 24 h──► completed
completed ──all payout transfers done (after 24 h window)──► closed
in_progress / completion_requested / completed (payout not transferred) ──dispute(C)──► disputed (payout 'frozen')
disputed ──resolve_dispute(admin): denied / partial_refund──► completed ;  full_refund──► refunded
```
`payouts.status`: `pending | frozen | transferred | failed | reversed | partially_reversed`.
**Payout allocation:** one or more `payout_transfers(payout_id, source_payment_id, amount)` per booking. The provider share is allocated first from the visit-fee payment, then from balance/increment payments, and never exceeds any source payment (a Route transfer can't exceed its source payment). Payouts are also created for `closed_no_work` and for chargeable cancellations / customer no-show (visit-fee source).
**Chargebacks** (M2): handle `payment.dispute.*` webhooks → freeze or reverse Route transfers (`reversed/partially_reversed`) → recover via provider debt if already settled; QuickServe absorbs losses under ₹500.
Admin-only RPCs (audited, idempotent): resolve_dispute, refund_payment, set_provider_suspended. **No manual "set KYC verified":** `kyc_status` comes only from Razorpay linked-account status.
`claims`/`claim_events` tables for the full dispute workflow (PRD §5.10) are added in M2.

## 4. Repository layout
```
quickserve/
  docs/                       ← PRD, design, pricing, this plan, Play Store guide, reviews
  app/                        ← Expo app
    app/                      ← Expo Router screens
      (auth)/login.tsx, verify.tsx, role.tsx
      (customer)/index.tsx (home), category/[slug].tsx, provider/[id].tsx,
                 book/[providerServiceId].tsx, bookings.tsx
      (provider)/onboarding.tsx, dashboard.tsx, jobs.tsx, earnings.tsx
      booking/[id].tsx (shared detail: status, quote, OTP, chat, pay, review)
    src/lib/ supabase.ts, api.ts, money.ts, types.ts, theme.ts
    src/components/ ProviderCard, RatingStars, QuoteEditor, QuoteView, StatusTimeline, Button...
  supabase/
    migrations/0001_init.sql  ← schema, RLS, RPCs, seed categories
    functions/create-payment/, razorpay-webhook/, release-payouts/
```

## 5. Implementation plan (milestones → tasks)

| # | Milestone | Tasks | Exit criteria |
|---|---|---|---|
| 0 | Setup (day 1–2) | Create Supabase project (free), Expo app, EAS account, git repo; env vars | `npx expo start` runs; connects to Supabase |
| 1 | Auth & profiles (wk 1) | Phone OTP, role selection, profile, addresses | Can log in on a device with a test OTP |
| 2 | Provider onboarding (wk 2) | Profile, skills + level + fees, rate card, Razorpay linked-account onboarding (KYC done by Razorpay), online toggle | Provider appears in search once Razorpay reports the linked account as verified |
| 3 | Discovery (wk 2–3) | `search_providers` RPC (PostGIS distance, Bayesian sort, filters), category list, provider detail, reviews list | Sorted, filtered results < 1.5 s |
| 4 | Booking + quote (wk 3–4) | Create booking, accept/decline, OTP arrive, quote editor/view, approve/reject, change order, complete | Full happy path between two phones |
| 5 | Payments (wk 5–6) | Razorpay test mode: create-payment function, webhook, visit fee + balance-before-work + change-order increments, refunds, payouts cron (Route transfers after the dispute window) | Test UPI payment moves the booking through `requested` and `in_progress`; transfer created after the window |
| 6 | Reviews, chat, push (wk 6) | Review form + aggregate trigger, realtime chat, push on state change | Rating updates instantly; push arrives |
| 7 | Hardening (wk 7) | Expiry cron, error states, Sentry, analytics, privacy policy, account deletion | Closed-test build |
| 8 | Store release (wk 8–10 for a closed alpha) | Play closed test (personal accounts: ≥ 12 testers opted in for 14 days), then production. **A production pilot with live payments realistically needs 14–18 weeks** (tax/KYC gate, dispute ops, state-machine tests; see PRD §9) | Live in stores |

## 6. Environments & secrets
| Var | Where | Notes |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | app `.env` | Public by design; RLS protects data |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Supabase function secrets | **Never** in the app |
| `SUPABASE_SERVICE_ROLE_KEY` | function secrets only | — |
| `CRON_SECRET` (+ vault `cron_secret`, `project_url`) | function secrets / Vault | Cron + pg_net calls to `release-payouts`, `process-refunds`, `send-notifications` |
| `EXPO_ACCESS_TOKEN` (optional) | function secrets | Only if Expo "Enhanced push security" is on |

## 7. Testing strategy
- SQL: state-machine tests that run every transition as the wrong actor and expect an error. **Required before live payments (M2 gate)**, not "later": money transitions are the highest-risk code.
- App: TypeScript strict + `tsc --noEmit` in CI; Jest unit tests for money math (`money.ts`).
- E2E: manual test script on two devices (customer + provider) per release; Maestro flows later.

## 8. Cost to run (MVP)
| Item | Cost |
|---|---|
| Supabase | Free tier (500 MB DB, 1 GB storage, 50k MAU) → Pro **$25/mo** at launch (no auto-pause, daily backups) |
| Expo EAS | Free tier (limited monthly builds, low priority queue) — enough for a solo dev |
| SMS OTP | ~₹0.15–0.25 per SMS (MSG91) + DLT registration (~₹5,900 one-time) |
| Razorpay | No setup fee; ~2% + GST per transaction (standard pricing); Route transfer fee + GST may apply (confirm at onboarding) |
| Google Play | **$25 one-time** |
| Apple App Store | **$99/year** |
| Domain + privacy policy hosting | ~₹1,000/yr (GitHub Pages is free) |
