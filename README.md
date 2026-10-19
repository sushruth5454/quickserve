# QuickServe

Local-services marketplace MVP: customers book independent pros (AC repair, electricians, plumbers, cleaners,
water-tank cleaners, mechanics…), pay a visit fee, approve an itemized on-site quote, pay the balance in the app
**before work starts**, and review the job. QuickServe takes a commission on labour only.

Specs: [`docs/01-PRD.md`](docs/01-PRD.md), [`docs/03-Pricing-Payments-Commission.md`](docs/03-Pricing-Payments-Commission.md),
[`docs/04-Architecture-Implementation-Plan.md`](docs/04-Architecture-Implementation-Plan.md).

```
app/        Expo (SDK 58) + Expo Router, TypeScript strict
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
  PAYMENT_CALLBACK_URL=https://<your-domain>/payment-complete   # optional

npx supabase functions deploy create-payment
npx supabase functions deploy razorpay-webhook --no-verify-jwt
npx supabase functions deploy release-payouts --no-verify-jwt
npx supabase functions deploy process-refunds --no-verify-jwt
```

| Function | Purpose |
|---|---|
| `create-payment` | Authenticated customer → computes the amount server-side (`prepare_payment`: visit fee, initial balance or change-order increment) → creates a Razorpay **Payment Link** → returns `short_url`. |
| `razorpay-webhook` | Verifies `X-Razorpay-Signature` (HMAC-SHA256 of the raw body, constant-time compare). On `payment_link.paid` calls `record_payment_paid` (idempotent by `razorpay_payment_id`). |
| `release-payouts` | Cron: expires 15-min-old requests, auto-confirms completions after 24h, cancels retired payment links, then creates one Route transfer per due `payout_transfers` row (`POST /v1/payments/{payment_id}/transfers`, `notes.transfer_id` set). Failed attempts back off (5→40 min); retries first look the transfer up by `notes.transfer_id` so a timed-out request is never paid twice. After 5 failures the payout is flagged `failed`; fix the cause and run `select retry_payout('<payout id>')`. Requires header `x-cron-secret`. |
| `process-refunds` | Cron: cancels retired payment links, claims queued `refunds` rows (`claim_due_refunds`) and calls `POST /v1/payments/{id}/refund` with `X-Refund-Idempotency: <refund row id>`; full refunds move the payment to `refunded`. Requires header `x-cron-secret`. |

### Razorpay (test mode)

1. Dashboard → *Account & Settings → Webhooks* → **Add webhook**
   - URL: `https://<project-ref>.supabase.co/functions/v1/razorpay-webhook`
   - Secret: the `RAZORPAY_WEBHOOK_SECRET` above
   - Events: `payment_link.paid`. A payment on a link that is no longer owed (retired, superseded or exceeding the
     booking total) is recorded and queued for refund automatically.
2. Enable **Route** and create a Linked Account per provider. The account id and its activation status drive
   `providers.kyc_status` via the service-role RPC `sync_provider_kyc(provider_id, account_id, status)`; there is no
   manual "mark verified" switch.

### Scheduled jobs

| Job | Schedule | How |
|---|---|---|
| Expire requests not accepted in 15 min (refund queued) | every minute | SQL `expire_stale_requests()` |
| Auto-confirm completions after 24h (creates payout) | every 15 min | SQL `auto_confirm_completions()` |
| Release payouts after the 24h dispute window | every 15 min | Edge Function `release-payouts` (also runs the two SQL jobs) |
| Process refunds and cancel retired payment links | every 10 min | Edge Function `process-refunds` |

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
```

**Option B — Supabase Dashboard → Integrations → Cron**: create the same jobs as "Supabase Edge Function" (POST,
header `x-cron-secret`) or "SQL snippet" jobs. Check runs with `select * from cron.job_run_details order by start_time desc limit 20;`.
## 3. Mobile app

> **Using a personal machine / public npm.** The `package-lock.json` files in this repo were generated through a
> corporate npm proxy, so their `resolved` URLs will not work elsewhere. On a personal machine:
>
> ```powershell
> npm config set registry https://registry.npmjs.org/
> Remove-Item app\package-lock.json, supabase\tests\package-lock.json
> cd app; npm install; npx expo install --fix
> cd ..\supabase\tests; npm install
> ```n>
> `npx expo install --fix` also aligns every Expo package with SDK 58 and moves `react-native` from the 0.88 RC to the
> stable version Expo SDK 58 expects once the public registry has it (after which `app/.npmrc`'s `legacy-peer-deps` is no longer needed).

```powershell
cd app
Copy-Item .env.example .env      # fill EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY
npm install
npx expo start                   # dev build (expo-dev-client); use `npx expo start --go` for Expo Go
```

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

npx eas-cli@latest build -p android --profile development   # dev client APK
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
