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
private_user_accounts(user_id PK, phone, expo_push_token)   -- own row only; never exposed via provider directory
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
```
All money is stored in **integer paise**.

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
