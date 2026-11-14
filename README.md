# QuickServe

Local-services marketplace MVP: customers book independent pros (AC repair, electricians, plumbers, cleaners,
water-tank cleaners, mechanics…), pay a visit fee, approve an itemized on-site quote, pay the balance in the app
**before work starts**, and review the job. QuickServe takes a commission on labour only.

Specs: [`docs/01-PRD.md`](docs/01-PRD.md), [`docs/03-Pricing-Payments-Commission.md`](docs/03-Pricing-Payments-Commission.md),
[`docs/04-Architecture-Implementation-Plan.md`](docs/04-Architecture-Implementation-Plan.md),
[`docs/08-Provider-Onboarding.md`](docs/08-Provider-Onboarding.md) (provider onboarding, go-live rule, payout rails).

```
app/        Expo SDK 57 (runs in App Store Expo Go) + Expo Router, TypeScript strict
supabase/   migrations/0001_init.sql, seed.sql, Edge Functions, SQL tests
```

## Booking lifecycle

```
pending_payment ─(visit fee paid, webhook)→ requested ─accept→ accepted ─start_trip→ en_route
  ─arrive(start OTP)→ inspecting ─send_quote→ quote_sent ─approve→ awaiting_payment
  ─(balance paid, webhook)→ in_progress ─request_completion→ completion_requested
  ─(end OTP | customer confirm | auto after 24h)→ completed ─(payout transferred)→ closed

quote_sent ─reject→ closed_no_work (visit fee paid out to provider)
in_progress: change orders create a new quote; booking stays in_progress; only the increment is charged
side states: declined, expired (15 min), cancelled, disputed → (admin) completed | refunded
```

Clients can only **read** bookings/quotes/payments (RLS). Every mutation is a `SECURITY DEFINER` RPC that checks the
actor and current state. Money moves only in Edge Functions holding the Razorpay secrets.

## 1. Supabase project

1. Create a project at <https://supabase.com> (free tier is fine) and note the project ref, URL and anon key.
2. **Auth → Providers → Phone**: enable it and configure an SMS provider (Twilio, or MSG91 via the Send SMS hook).
   For development add test numbers/OTPs under *Test OTPs*.
3. Apply the schema (PostGIS, enums, tables, RLS, RPCs, storage buckets, category seed):

   ```powershell
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push            # applies supabase/migrations/0001_init.sql
   ```

   Or paste `supabase/migrations/0001_init.sql` into the SQL editor. Optional demo providers: run `supabase/seed.sql`.
4. Make yourself an admin (for disputes/suspensions):

   ```sql
   insert into public.admins (user_id) values ('<your auth user id>');
   ```

## 2. Edge Functions and secrets

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

```powershell
npx supabase secrets set `
  RAZORPAY_KEY_ID=rzp_test_xxx `
  RAZORPAY_KEY_SECRET=xxx `
  RAZORPAY_WEBHOOK_SECRET=choose-a-long-random-string `
  CRON_SECRET=another-long-random-string `
  GEMINI_API_KEY=xxx `
  RAZORPAYX_ACCOUNT_NUMBER=xxx `                       # RazorpayX payouts rail (customer identifier of the X account)
  RAZORPAYX_WEBHOOK_SECRET=xxx `                       # optional, if the X webhook uses its own secret
  PAYMENT_CALLBACK_URL=https://<your-domain>/payment-complete   # optional

npx supabase functions deploy create-payment
npx supabase functions deploy ai-assistant
npx supabase functions deploy provider-payout-account
npx supabase functions deploy razorpay-webhook --no-verify-jwt
npx supabase functions deploy release-payouts --no-verify-jwt
npx supabase functions deploy process-refunds --no-verify-jwt
npx supabase functions deploy send-notifications --no-verify-jwt
```

| Function | Purpose |
|---|---|
| `create-payment` | Authenticated customer → computes the amount server-side (`prepare_payment`: visit fee, initial balance or change-order increment) → creates a Razorpay **Payment Link** → returns `short_url`. |
| `razorpay-webhook` | Verifies `X-Razorpay-Signature` (HMAC-SHA256 of the raw body, constant-time compare). On `payment_link.paid` calls `record_payment_paid` (idempotent by `razorpay_payment_id`). |
| `release-payouts` | Cron: expires 15-min-old requests, auto-confirms completions after 24h, cancels retired payment links, then releases each due `payout_transfers` row on its snapshotted rail (Route transfer, or RazorpayX payout with `X-Payout-Idempotency`; refund debts in `provider_receivables` are netted first; doc 08 §7) (`POST /v1/payments/{payment_id}/transfers`, `notes.transfer_id` set). Failed attempts back off (5→40 min); retries first look the transfer up by `notes.transfer_id` so a timed-out request is never paid twice. After 5 failures the payout is flagged `failed`; fix the cause and run `select retry_payout('<payout id>')`. Requires header `x-cron-secret`. |
| `provider-payout-account` | Authenticated provider → payout beneficiary on the active rail (`app_config.payout_rail`): Route linked account (`/v2/accounts` + stakeholder + route product) or RazorpayX contact + fund account + penny-drop validation. Actions `status` / `submit` / `refresh`. Stores only ids, status, bank last 4 + IFSC. "Not enabled" gateway errors become the provider state *Payouts setup temporarily unavailable*. See [doc 08](docs/08-Provider-Onboarding.md). |
| `ai-assistant` | Authenticated customer → QuickServe AI booking assistant (Gemini). See [AI assistant](#ai-assistant). |
| `process-refunds` | Cron: cancels retired payment links, claims queued `refunds` rows (`claim_due_refunds`) and calls `POST /v1/payments/{id}/refund` with `X-Refund-Idempotency: <refund row id>`; full refunds move the payment to `refunded`. Requires header `x-cron-secret`. |
| `send-notifications` | Push sender for the `notifications` outbox (chat messages, booking updates) via the Expo Push API: batches of 100, tickets, receipts, retries, dead-token cleanup. Kicked by `pg_net` on every new outbox row and by cron. Requires header `x-cron-secret`. See [Notifications](#notifications). |

### Razorpay (test mode)

1. Dashboard → *Account & Settings → Webhooks* → **Add webhook**
   - URL: `https://<project-ref>.supabase.co/functions/v1/razorpay-webhook`
   - Secret: the `RAZORPAY_WEBHOOK_SECRET` above
   - Events: `payment_link.paid`. A payment on a link that is no longer owed (retired, superseded or exceeding the
     booking total) is recorded and queued for refund automatically.
2. Provider payouts run on a **rail** (`app_config.payout_rail`, default `payouts` = RazorpayX; `route` once Razorpay
   enables Route). Providers create their own beneficiary from the app (`provider-payout-account`); webhooks
   `product.route.*`, `fund_account.validation.*` and `payout.processed|failed|reversed` drive `providers.kyc_status`
   (`sync_provider_payout_status`) and `payout_transfers`. There is no manual "mark verified" switch. Founder actions
   (enable Route / activate RazorpayX, webhook events): [doc 08 §12](docs/08-Provider-Onboarding.md).

### Scheduled jobs

| Job | Schedule | How |
|---|---|---|
| Expire requests not accepted in 15 min (refund queued) | every minute | SQL `expire_stale_requests()` |
| Auto-confirm completions after 24h (creates payout) | every 15 min | SQL `auto_confirm_completions()` |
| Release payouts after the 24h dispute window | every 15 min | Edge Function `release-payouts` (also runs the two SQL jobs) |
| Process refunds and cancel retired payment links | every 10 min | Edge Function `process-refunds` |
| Send push notifications + check receipts (safety net; new rows are also sent immediately via `pg_net`) | every minute | Edge Function `send-notifications` |

**Option A — `pg_cron` + `pg_net`** (Database → Extensions: enable both). Store the cron secret in Vault first:
`select vault.create_secret('<CRON_SECRET>', 'cron_secret');`

```sql
select cron.schedule('expire-requests', '* * * * *', $$ select public.expire_stale_requests(); $$);
select cron.schedule('auto-confirm', '*/15 * * * *', $$ select public.auto_confirm_completions(); $$);

select cron.schedule('release-payouts', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/release-payouts',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'))
  );
$$);

select cron.schedule('process-refunds', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/process-refunds',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'))
  );
$$);

-- Push notifications: immediate delivery needs the project URL in Vault (used by the outbox trigger via pg_net).
select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
select cron.schedule('send-notifications', '* * * * *', $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/send-notifications',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'))
  );
$$);
```

**Option B — Supabase Dashboard → Integrations → Cron**: create the same jobs as "Supabase Edge Function" (POST,
header `x-cron-secret`) or "SQL snippet" jobs. Check runs with `select * from cron.job_run_details order by start_time desc limit 20;`.

### AI assistant

"Ask QuickServe AI" (Home card, sparkles button on category results, route `/assistant`) lets a customer describe a
problem by text or voice (English, Hindi, Telugu, Hinglish/Tenglish) and get a diagnosis with a confidence level,
data-backed typical prices, 1-3 recommended pros and a **booking draft**. "Review & pay" opens the normal Book screen
pre-filled (description, problem chips, slot, address); the customer always confirms and pays there. The AI never
creates or pays bookings.

- **Architecture**: app → edge function `ai-assistant` (JWT verified at the gateway and in code) → Gemini function
  calling over read-only server-side tools (`list_categories`, `search_providers` with the user's JWT, `get_my_history`,
  `get_price_estimate`, `draft_booking`). Cards are built server-side from tool results, so prices and pros are never
  model-invented.
- **Skills/policies**: versioned rule files in `supabase/functions/ai-assistant/policies/` (`POLICY_VERSION` stored on
  every reply) with deterministic guardrails in code; `deno test` + `deno check` gate every deploy.
- **Config**: secret `GEMINI_API_KEY`; models (`AI_PRIMARY_MODEL` default `gemini-3.8-flash`, `AI_FALLBACK_MODEL` default
  `gemini-3.5-flash-lite`), timeouts, limits (30 messages / 10 voice per user per day, 6 per minute), CORS origins and
  kill switches are all function env vars. App flag `EXPO_PUBLIC_AI_ASSISTANT=false` hides it.
- **Privacy**: Gemini receives area/city only, saved-address labels, the user's own history and public pro listings;
  text is PII-redacted (voice audio cannot be). No phones, house numbers or other users' data.
- **Demo mode**: `src/lib/demo/demoAssistant.ts` answers offline with scripted rules (text only).
- **v2 experience**: live progress steps streamed (SSE) from the real server work, with a Stop button; a voice
  transcript preview (original + English) before sending; photo diagnosis (EXIF/GPS stripped server-side, private
  bucket); a provider job brief built from the whole conversation; support handoff; feedback; history and resume;
  read-aloud; and analytics (`AI_PHOTOS_ENABLED`, `AI_STREAMING_ENABLED`, `AI_DAILY_PHOTO_LIMIT`, `EXPO_PUBLIC_SUPPORT_*`).

Full reference (env table, data sent, failure modes, observability SQL, policy update procedure, production-readiness
checklist and blockers): [`docs/06-AI-Assistant.md`](docs/06-AI-Assistant.md).

### Notifications

Chat unread badges and push notifications (design: [doc 04 §3](docs/04-Architecture-Implementation-Plan.md)).

- **In-app (works everywhere, including Expo Go and web)**: unread badges on booking/job cards, the booking chat button
  and the Bookings / Jobs tab; a "New messages" divider and "Seen" in the chat; an in-app banner when a message arrives
  for a chat that is not open. Counts come from `get_unread_counts()` and update live through Supabase Realtime.
- **Push**: devices register Expo push tokens in `push_devices` (several per user; removed on sign-out and on
  `DeviceNotRegistered`). The permission prompt is shown only at meaningful moments (opening a chat, viewing a live
  booking, a pro going online), never at cold start. Events queue rows in the `notifications` outbox; the
  `send-notifications` function delivers them. Previews are masked (phones, emails, UPI ids, links). Tapping a push
  opens the chat or booking.
- **Events pushed today**: new chat message (collapsed per chat: "Ravi · 3 new messages"), new job request (pro),
  booking accepted / declined / expired, pro on the way, quote or change order received, job marked complete
  (customer), booking cancelled (pro).

| Where | Unread badges / banners | Remote push |
|---|---|---|
| Expo Go, Android (SDK 53+) | Yes | **No**. Expo removed remote push from Expo Go on Android; the app skips registration there. |
| Expo Go, iOS | Yes | Not supported per Expo's push guides ("use a development build"); the app tries silently and falls back. |
| Web | Yes | No |
| EAS development / preview / production build | Yes | Yes, once FCM/APNs credentials are set (below) |

**Production push credentials** (needed for real builds; not needed for Expo Go testing):

1. `npx eas-cli@latest init` (the project id is what `getExpoPushTokenAsync` uses).
2. **Android (FCM v1)**: create a Firebase project → add an Android app with package `com.quickserve.app` → download
   `google-services.json` into `app/` and set `"android": { "googleServicesFile": "./google-services.json" }` in
   `app.json` → Firebase *Project settings → Service accounts → Generate new private key* →
   `npx eas-cli@latest credentials` → Android → *Google Service Account Key for Push Notifications (FCM V1)* → upload.
3. **iOS (APNs)**: paid Apple Developer account → `npx eas-cli@latest credentials` → iOS → *Push Notifications: set up
   a push key* (EAS creates and stores it). The `expo-notifications` config plugin (already in `app.json`) adds the
   push entitlement at build time.
4. Build with `eas build` (see [Builds](#builds-eas)) and test with the Expo push tool <https://expo.dev/notifications>.
5. Optional: enable *Enhanced push security* in the Expo project and store the access token as repository secret
   `EXPO_PUSH_ACCESS_TOKEN` (deployed as function secret `EXPO_ACCESS_TOKEN`).

**Backend setup**: apply migrations `0007` and `0010`, deploy `send-notifications --no-verify-jwt`, create the Vault
secret `project_url` and the `send-notifications` cron job ([Scheduled jobs](#scheduled-jobs)).

**Observability**

```sql
select kind, status, count(*) from notifications where created_at > now() - interval '1 day' group by 1, 2;
select id, kind, attempts, last_error, next_attempt_at from notifications where status in ('pending', 'failed') order by created_at desc limit 20;
select count(*) from push_devices;
```

`skipped` with `last_error` = `read` (already seen), `no_device` (user has no registered device) or `stale_event`
is normal.

## 3. Mobile app

The app targets **Expo SDK 57** (React Native 0.86, React 19.2) so it runs in the App Store / Play Store **Expo Go**.
It only uses libraries bundled in Expo Go (no custom native modules, no dev client).

> **Using a personal machine / public npm.** The `package-lock.json` files in this repo were generated through a
> corporate npm proxy, so their `resolved` URLs will not work elsewhere. On a personal machine:
>
> ```sh
> cd app
> rm -rf node_modules package-lock.json
> npm install                      # tilde ranges resolve the newest SDK 57 patches (expo 57.0.30, expo-router 57.0.28, …)
> npx expo install --check         # should report everything up to date
> ```

### Try it on an iPhone in demo mode (no backend needed)

```sh
git pull
cd app
rm -rf node_modules package-lock.json
npm install
echo "EXPO_PUBLIC_DEMO_MODE=1" > .env
npx expo start --go              # add --tunnel if the phone is not on the same Wi-Fi
```

Scan the QR code with the iPhone camera → opens in Expo Go.

**Demo mode** (`EXPO_PUBLIC_DEMO_MODE=1`, or automatically when the Supabase env vars are missing) swaps
`src/lib/api.ts` to an in-memory backend (`src/lib/demo/`) with the same interface, so screens never branch:

- Any 10-digit phone, OTP **123456**. The demo user is both a customer and a verified provider; switch roles from the **Me** tab.
- Seed data: 11 categories and ~15 Vijayawada providers with rate cards, ratings and reviews; customer bookings in
  every state (incl. **#QS1042 with a quote awaiting approval**, #QS1043 en route with start code **4821**, a completed
  job waiting for a review); provider requests with a 15-minute countdown, active jobs and payout history.
- Provider side: start code **1234** and completion code **4321** for the demo customer's jobs.
- Payments open a simulated checkout sheet instead of Razorpay; state advances locally with simulated latency and the
  same guards/money math as the SQL RPCs. Bookings reset to the seed when the app restarts (the sign-in is remembered).

### Connect to Supabase

```sh
cd app
cp .env.example .env              # fill EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY, set EXPO_PUBLIC_DEMO_MODE=0
npx expo start --go
```

### UI

Design system in `app/src/theme` (light/dark palettes, Inter type scale, spacing, radii, elevation, motion) and
components in `app/src/components/ui` (Button, Input, OTPInput, BottomSheet, SegmentedControl, Skeleton, Toast,
StatusTimeline, …). Screenshots of every screen (iPhone 15 viewport, demo mode, light + dark) are in
[`docs/design/screens/`](docs/design/screens/); they are produced from the web build
(`EXPO_PUBLIC_DEMO_MODE=1 npx expo export --platform web`), which exists only for previews.

Only the Supabase URL and anon key ship in the app. Razorpay keys never do.

### Tests and checks

```powershell
cd app
npx tsc --noEmit
npm test                         # Jest (jest-expo): money math incl. the doc 03 worked example
npx expo-doctor

cd ..\supabase\tests
npm install
npm test                         # parses the migration (libpg_query) and runs the full state machine on PGlite
```

The SQL tests run the real migration in an in-process Postgres (PGlite) with PostGIS, `auth` and `storage` stubbed, and
exercise the happy path, change orders, OTP lockout, disputes, payouts, stale/excess payments, refunds, transfer retries
and RLS. `npx -y deno check supabase/functions/*/index.ts` typechecks the Edge Functions.

### Builds (EAS)

```powershell
npx eas-cli@latest login
npx eas-cli@latest init                              # links the project, writes extra.eas.projectId
npx eas-cli@latest env:create --environment preview --name EXPO_PUBLIC_SUPABASE_URL --value https://<ref>.supabase.co --visibility plaintext
npx eas-cli@latest env:create --environment preview --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon-key> --visibility plaintext
# repeat env:create for the development and production environments

npx eas-cli@latest build -p android --profile development   # internal APK, development env (no dev client — use Expo Go day to day)
npx eas-cli@latest build -p android --profile preview       # installable APK for testers
npx eas-cli@latest build -p android --profile production    # AAB for Google Play
npx eas-cli@latest build -p ios --profile production        # App Store build (no Mac needed)
npx eas-cli@latest submit -p android --profile production
npx eas-cli@latest submit -p ios --profile production
```

## Money rules (doc 03)

All amounts are integer paise. `app/src/lib/money.ts` mirrors the SQL helpers `_commission_bp`, `_required_total`
and `_create_payout`.

- Commission on **labour only** (parts and other items 0%): 12%, 10% from 50 completed jobs, 8% from 200, 0% in the
  provider's first 30 days. 18% GST on the commission.
- The visit fee is credited against the quote; the flat platform fee (₹29) is charged once with the first balance.
- Quote rejected after inspection, or customer cancels once the provider is en route: the provider is paid the visit
  fee minus commission/GST on it.
- Payouts are created at completion, released after a 24h dispute window, and split across the booking's payments
  (visit fee first).

Worked example: labour ₹1,500 + parts ₹650, visit fee ₹199, platform fee ₹29 → customer pays ₹199 + ₹1,980;
commission ₹180 + GST ₹32.40; provider receives ₹1,937.60.
