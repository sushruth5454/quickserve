# Nearo audit appendix WS8 — Security, data integrity & reliability

> Part of [docs/15](../15-Nearo-Functional-Audit-Report.md). Code-based audit of `main` @ `bfa999f` (2026-11-18), produced by a read-only audit agent and spot-checked by the lead auditor (see doc 15 §1.3 for verified claims and corrections). Status vocabulary and severity scale: doc 15 §1.2. Nothing in this file was tested on a real device or with real users.


Repo: `` @ `bfa999f` (read-only). Auditor: WS8 sub-agent. Date: 2026-11-18.

## Scope & method

- **Static review of all 58 migrations.** I used a read-only Python scan to list each table's `enable row level security`, the **latest** policy after every `create/drop policy`, the **latest** `create or replace function` for every `security definer` function, and its `set search_path`. The scan also replayed every `grant/revoke execute on function` by exact signature, in migration order. The scan assumes Supabase's default privileges (`execute on functions to anon, authenticated, service_role`), which every SQL test also emulates (for example `supabase/tests/booking_core.test.mjs:43-45`). The raw scan outputs were scratch only and were deleted; re-run the method to reproduce them.
- **Manual reading** of the money-path SQL (`prepare_*`, `record_*_paid`, `_queue_refund`, `_allocate_payout`, `_create_payout`, `_create_sports_payout`, `claim_due_transfers`, `demo_settle_payment`, `_is_admin`). I also read all payment, cron and webhook edge functions, `supabase/config.toml`, the CI workflows, the app's Supabase client, `api.ts`, `payments.tsx` and `invokeFunction.ts`.
- **CI evidence:**
  - `gh run view 44358292571 --log` reported "82/82 SQL checks passed": 53 parse checks plus 29 test files. All Deno tests passed ("97 passed | 0 failed").
  - `gh run view 44365580570 --log` had 7 failed steps: `phase-6-sports-booking-request`, `home`, `home-family-drilldown-and-marketplace-entry-points`, `category-packers-movers`, `category-kitchen-cleaning`, `assistant-draft-or-busy-fallback` and `my-activity-sports-segment`. **`admin-feature-registry` ran and did not fail.**
- **Secret scan:** `git grep` for Google, Razorpay, JWT, OpenAI and PEM key patterns returned **no matches**. `app/.env.example` contains placeholders only. No secret values are printed in this report.
- **Not done (outside the rules):** no live calls to Supabase or Razorpay, no execution of tests, no penetration testing. Statements about live project configuration, such as `sms_test_otp` or production `app_config` values, are inferred from repo and CI evidence and are marked as such.

**SQL test files that exercise RLS or authz** (all PASS in run 44358292571):

| Test file | What it covers |
|---|---|
| `migration.test.mjs` | Stranger isolation, `booking_secrets`, direct-update denial, outbox, `resolve_dispute` admin-only |
| `provider_onboarding.test.mjs` | Column privacy on `providers`, link self-approval, `admin_review_document`, `admin_set_payout_rail`, `claim_due_transfers` service-only |
| `review_fixes.test.mjs` | `demo_settle_payment` guards, `prepare_payment` with another user id, admin phone |
| `booking_core.test.mjs` | `category_cities` RLS |
| `creator_config.test.mjs` | Package privacy and anon writes |
| `fixed_booking.test.mjs` | `payment_schedule` participant scope |
| `proposal_booking.test.mjs` | Venue privacy, competing providers, targeted requests |
| `leakage_programme.test.mjs` | Invite tokens, `leakage_signals` admin-only |
| `seva_coins.test.mjs` | Forged ledger insert |
| `coins_config.test.mjs` | Admin config |
| `prd_v2.test.mjs` | Feature registry and commission admin-only |
| `managed_geography.test.mjs` | Geography upsert admin-only |
| `home_services_catalogue.test.mjs` | HSC-04 non-admin category writes |
| `addendum_foundations.test.mjs` | Rules admin-only |
| `ai_usage.test.mjs` | AI dashboard admin-only, metering functions service-only |
| `merchant_staff.test.mjs` | Stranger / staff / manager role checks |
| `activity_contracts.test.mjs` | Mark-read on another customer's records |
| `rfq.test.mjs` | Other customer / unrouted shop RLS |
| `shops_catalogue.test.mjs` | Enquiry isolation |
| `sports.test.mjs` | Flag-off RLS, slot race |
| `sports_payments.test.mjs` | `sp-extra-capture`, flag-off |
| `recurring_plans.test.mjs` | RP-20 RLS |
| `preferred_language.test.mjs` | Anon execution denied |

## Feature matrix

| ID | Control | Status | Evidence | Notes |
|---|---|---|---|---|
| WS8-F01 | RLS enabled on every table holding personal or financial data | PARTIAL | Scan: all 97 `create table`s have `enable row level security` (for example `0001:1868-1887`, `0029:21`, `0058` via `0048:110`). Negative tests exist only for a subset (`migration.test.mjs:417-425,487-489`). | Enabled everywhere by static scan. No test for each table. |
| WS8-F02 | Customers cannot read other customers' bookings, phones or addresses | PASS | `migration.test.mjs:487` "stranger sees no bookings"; `migration.test.mjs:79` phone leak check; `addresses_own` policy at `0001:1912` | Addresses are not covered by a dedicated test (UNTESTED part). |
| WS8-F03 | Provider-sensitive columns (gateway ids, base location, gender) hidden from others | PASS | `provider_onboarding.test.mjs:154-157`; column grant at `0009:1453-1456` | |
| WS8-F04 | Provider sees the exact customer address only after acceptance or advance payment | PARTIAL | Proposals: `proposal_booking.test.mjs:134` PASS. Inspect/quote: `get_booking_address` at `0052:289-302` gates on `accepted_at`, with no test. | Inspect/quote path is UNTESTED. |
| WS8-F05 | Clients cannot directly mutate bookings, payments, quotes, refunds or payouts | PASS | `0001:1944`; `migration.test.mjs:104` "no direct booking update" | |
| WS8-F06 | Payment prepare and record functions are service-role only | PASS | `0030:780-791`, `0058:1874-1890`; `review_fixes.test.mjs:326`, `provider_onboarding.test.mjs:259` | |
| WS8-F07 | Payment amount is derived on the server, never taken from the client | PASS | `prepare_payment` / `prepare_due_payment` at `0029:25-163`; `create-payment/index.ts:121` uses `prepared.amount`; `fixed_booking.test.mjs:72-79`, `migration.test.mjs:179` | |
| WS8-F08 | Price change after acceptance requires customer approval (change order) | PASS | `migration.test.mjs:156-189` (change-order approval, increment-only charge, completion blocked while unpaid) | Fixed packages are also protected by triggers (`0019:110,145`). |
| WS8-F09 | Users cannot alter coin balances | PASS | `0015:52-57` (client grants revoked; select only); `seva_coins.test.mjs:102` forged ledger insert; `coin_ledger.ref` unique at `0015:31` | A non-admin call to `admin_adjust_coins` is UNTESTED (the code checks `_is_admin` at `0047:665`). |
| WS8-F10 | Admin functions check admin role on the server | PASS | Every `admin_*`, `resolve_dispute` and `support_*` body calls `_is_admin()` (scan). Tests: `prd_v2.test.mjs:120-225`, `migration.test.mjs:195`, `provider_onboarding.test.mjs:214,256`, `home_services_catalogue.test.mjs:571`, `managed_geography.test.mjs:115`, `ai_usage.test.mjs:134` | Role checks work, but the admin identity itself is weak (F11). |
| WS8-F11 | Admin identity cannot be obtained by outsiders | FAIL | `0041:7` seeds `admin_phones` with the E2E phone; `0041:12-26`; `e2e/web-smoke.mjs:13,803`; run 44365580570 `admin-feature-registry` passed; repo is PUBLIC | See WS8-01. |
| WS8-F12 | Internal or cron functions are not executable by clients | PARTIAL | Privilege replay scan: `route_service_request`, `process_proposal_milestones` and `_proposal_public_intake` are executable by `authenticated`; about 12 user RPCs are executable by `anon` | See WS8-09. |
| WS8-F13 | Demo settlement cannot be abused | FAIL | `0030:736-777` trusts `auth.users.raw_user_meta_data ->> 'demo_only'`; `review_fixes.test.mjs:315-321` only tests seeded metadata | See WS8-02. |
| WS8-F14 | Razorpay webhook HMAC verification | UNTESTED | `razorpay-webhook/index.ts:17-28` (constant-time compare over the raw body) | No Deno test for the payment-webhook signature path. |
| WS8-F15 | Checkout callback (`verify-payment`) signature, order binding and capture | UNTESTED | `verify-payment/index.ts:33-48` | |
| WS8-F16 | Duplicate webhook or verify call is idempotent | PASS | `0029:181-183`; unique `razorpay_payment_id` at `0001:208`; `migration.test.mjs:98`, `leakage_programme.test.mjs:202` | |
| WS8-F17 | A second capture for the same order or link is handled safely | FAIL (home services) / PASS (sports) | Home services: `0029:280-303` overwrites `razorpay_payment_id`. Sports: `0058:1438-1446` plus `sports_payments.test.mjs` `sp-extra-capture`. | See WS8-05. |
| WS8-F18 | Refund queue is idempotent and capped | PASS | `_queue_refund` at `0001:642-670` caps at the refundable amount; `migration.test.mjs:374` "claimed refund not double-claimed"; `X-Refund-Idempotency` at `process-refunds/index.ts:49` | The gateway header itself is UNTESTED. |
| WS8-F19 | Payout and transfer idempotency | PASS | `payouts.booking_id` unique (`0001:236`); `sports_booking_id` unique (`0058:68`); `leakage_programme.test.mjs:155`; `provider_onboarding.test.mjs:272,278` | |
| WS8-F20 | Refund after settlement (transfer reversal or provider receivable) | PASS | `cancellation_payouts.test.mjs`: "customer refund is queued before provider recovery", "unreversible RazorpayX amount becomes provider debt" | |
| WS8-F21 | Booking creation is idempotent on double tap or retry | NOT IMPLEMENTED | `create_booking` at `0018:601-697` has no idempotency key; the client guard is only `setBusy` (`app/app/book-fixed/[providerServiceId].tsx:70`) | See WS8-08. |
| WS8-F22 | Sports booking concurrency and idempotency | PASS | Unique index on (`customer_id`, `idempotency_key`) at `0058:47-49`; `sports.test.mjs` "two customers racing for one slot produce exactly one booking" | |
| WS8-F23 | Notification failure does not roll back booking or payment | PASS | Outbox queued in the same transaction (`_queue_notification`, `0007:265`); `migration.test.mjs:459` | |
| WS8-F24 | Chargeback / dispute webhooks | NOT IMPLEMENTED | `razorpay-webhook/index.ts:62-65` TODO | |
| WS8-F25 | Upload validation on storage buckets (size and type) | PARTIAL | Limits exist for avatars, provider-docs, portfolio and product-images (`0009:1461-1466`, `0049:250-253`). None for job-photos or dispute-photos (`0001:1980-1984`). | |
| WS8-F26 | Edge function JWT and cron authentication | UNTESTED | `supabase/config.toml`; `deploy-backend.yml:476-482`; `CRON_SECRET` checked with `timingSafeEqual` (release-payouts, process-refunds, send-notifications, review-insights) | `schedule-reminders` uses `!==` and is not deployed. |
| WS8-F27 | No secrets in the repo or client bundle | UNTESTED | Manual `git grep` clean; the app reads only `EXPO_PUBLIC_SUPABASE_URL` and the anon key (`app/src/lib/config.ts:1-2`); `GEMINI_API_KEY` exists only as a function secret (`deploy-backend.yml:24,469`) | No automated secret scanning in CI. |
| WS8-F28 | AI cost and abuse limits | PARTIAL | Chat: per-user daily (30) and per-minute (6) limits at `ai-assistant/config.ts:81,84`. Global monthly budget exists only for product_search and quote_extract (`0051:30,120-125`); `ai_usage.test.mjs` PASS. | No global cap for chat or voice; see WS8-14. |
| WS8-F29 | Prompt-injection mitigation | PARTIAL | `ai-assistant/policies/security.ts` (heuristic, never blocks); `policies_test.ts` PASS | Tool calls are server-scoped, but prompt mitigation is advisory only. |
| WS8-F30 | Admin audit log for sensitive admin actions | UNTESTED | Inserts into `admin_audit_log` at `0047:689`, `0021:1095`, `0042:78`, `0043:415,450`, and others | No test asserts audit rows. |
| WS8-F31 | Separate staging and production environments | NOT IMPLEMENTED | One `SUPABASE_PROJECT_REF` / `EXPO_PUBLIC_SUPABASE_URL` used by `deploy-backend.yml`, `e2e-web.yml` (demo seed) and `publish-app.yml`/`build-apk.yml`; no GitHub `environment:` gate | See WS8-03. |
| WS8-F32 | Expired session handling | UNTESTED | `app/src/lib/invokeFunction.ts:12-21` refreshes once on 401; `autoRefreshToken` set at `app/src/lib/supabase.ts:12-19` | |
| WS8-F33 | Offline and timeout handling | PARTIAL | Razorpay 15 s timeout (`_shared/razorpay.ts:4,55`); no fetch timeout or offline detection in the app's Supabase client | |
| WS8-F34 | Existing sports bookings readable when the sports flag is off | FAIL | `0058:261-273` puts the flag in the RLS predicate; `sports.test.mjs` asserts "RLS also hides sports tables while the feature flag is off" | Conflicts with project rule 4 ("Keep existing rows … readable"). |

## Findings

| ID | Title | Type | Severity | Gate | Evidence | Recommendation |
|---|---|---|---|---|---|---|
| WS8-01 | **Publicly known admin login on the deployed backend.** The admin allowlist contains the E2E phone, and E2E logs in with OTP 123456. | Technical defect | P0 | Before pilot | `0041:7` inserts `admin_phones = ["918888888888"]`; `_is_admin` at `0041:12-26` grants admin to any `auth.users.phone` in that list. `e2e/web-smoke.mjs:803` logs in as `8888888888` with `OTP='123456'` (`:13`). `e2e-web.yml:67-68` says numbers are in the project's `sms_test_otp` list. Run 44365580570 step `admin-feature-registry` passed (opened Admin portal). Repo visibility is PUBLIC (`gh repo view`). | Remove the phone from `admin_phones` on every non-test project. Make `_is_admin` table-only (`public.admins`). Remove the admin number from the live project's `sms_test_otp`. Use a separate admin test project. Rotate any admin data changed while this was exposed and review `admin_audit_log`. |
| WS8-02 | `demo_settle_payment` trusts user-editable `raw_user_meta_data.demo_only`. A provider can self-flag, and their bookings can then be "paid" without money. With the default `payouts` rail, real payouts can follow. | Technical defect | P0 | Before pilot | `0030:750-757` (`u.raw_user_meta_data ->> 'demo_only' = 'true'`). Supabase lets a signed-in user update their own user metadata (`auth.updateUser({data})`). This is documented platform behaviour, not tested live here. `seed-all-services.sql:141` sets `demo_payments.enabled=true` and is applied to `SUPABASE_PROJECT_REF` by `e2e-web.yml:79-97`. `_allocate_payout` (`0001:536-565`) accepts any non-null `razorpay_payment_id`, including `pay_demo_…`. `claim_due_transfers` (`0058:1766-1810`) does not exclude demo payments. The `payouts` rail (`provider_payout_accounts.rail default 'payouts'`, `0009` table; `app_config.payout_rail='"payouts"'`, `0011`) pays from the platform balance (`_shared/payout-rail.ts:422-430`) without a source payment. | Check `raw_app_meta_data` (service-only) or a server table instead of `raw_user_meta_data`. Hard-disable `demo_settle_payment` unless the project is a non-production demo project (for example a `deployment_kind` row that only service_role can set). Exclude `razorpay_payment_id like 'pay_demo_%'` from payout allocation and transfer claims. |
| WS8-03 | One Supabase project serves CI deploys, E2E demo seeding (which turns on demo payments and feature flags) and published app builds. There is no environment gate. | Technical defect | P0 | Before accepting real payments | `deploy-backend.yml:14-26,126,476-482`; `e2e-web.yml:21-22,79-97`; `publish-app.yml:24-28`; `build-apk.yml:22-27`; only `pages.yml:23` uses `environment:`. | Create separate `staging` and `production` projects. Use GitHub Environments with required reviewers for the production deploy. Never run `seed-all-services.sql` against production, and add a guard row the seed checks. |
| WS8-04 | `_is_admin` phone allowlist does not require a confirmed phone, and admin membership lives in mutable config. | Technical defect | P1 | Before pilot | `0041:20-25` compares `u.phone` with no `phone_confirmed_at` check. | Drop the phone allowlist, or at minimum add `u.phone_confirmed_at is not null`. Prefer `public.admins` rows managed by service_role, with an audit row on change. |
| WS8-05 | A second captured payment on an already-paid home-services order or link overwrites `razorpay_payment_id` and fully refunds the row. The original capture is lost, the booking's net paid drops to 0, and payout allocation later fails. | Technical defect | P1 (financial status) | Before accepting real payments | `record_payment_paid` latest at `0029:167-319`. The duplicate check at `:181` only matches the same payment id. For `p.status='paid'` the code still runs `update payments set razorpay_payment_id = p_payment_id` (`:280-282`, `:297-299`) and then `_queue_refund(p.id, p.amount, …)`. `_allocate_payout` (`0001:556-565`) then sees zero available and fails `_assert(v_remaining <= 0)`. Sports already handle this with a separate capture row (`0058:1438-1446`, `_refund_unmatched_sports_capture`). Whether Razorpay can capture twice on one order is UNVERIFIED gateway behaviour; the sports code assumes it can. | When `p.status <> 'created'` or `p.razorpay_payment_id is not null`, insert a new `payments` row for the extra capture (same pattern as `_refund_unmatched_sports_capture`) and refund that row. Never overwrite an existing `razorpay_payment_id`. |
| WS8-06 | A captured payment that the record function rejects (`unknown link`, `amount mismatch`) is acknowledged with 200 for home services. There is no refund, no retry and no alert. | Technical defect | P1 | Before accepting real payments | `_shared/record-payment.ts:39-47` returns `{ok:true}` for non-sports `ok:false`. `record_payment_paid` returns `ok:false` at `0029:186-191` without queuing a refund. | For non-sports, mirror the sports behaviour: record an orphan capture and queue a refund (or write to a `payment_exceptions` table), and return 500 for `unknown link` so the gateway retries. Alert on any `ok:false`. |
| WS8-07 | No chargeback or dispute handling. | Business logic | P1 | Before accepting real payments | `razorpay-webhook/index.ts:62-65` TODO; `default` branch ignores the event. | Handle `payment.dispute.*` by freezing the payout (`payouts.status`) and reversing or recording a receivable. Add an admin queue. |
| WS8-08 | Booking and request creation RPCs have no idempotency key. Double tap, a network retry after timeout, or a restart mid-submit creates duplicate `pending_payment` bookings and duplicate `addresses` rows. | Technical defect | P1 | Before pilot | `create_booking` at `0018:601-697` (inserts an address and a booking each call); `create_fixed_booking` (`0019:190`), `create_session_booking` (`0031:23`), `create_service_request` (`0040:21`), `create_rfq` (`0050:211`), `create_recurring_plan` (`0057:1027`). Only sports has `idempotency_key` (`0058:47-49`). Client guard is only a React `busy` flag (`app/app/book-fixed/[providerServiceId].tsx:70`). ASAP bookings have no service window, so the exclusion constraint does not stop duplicates. | Add an optional `p_idempotency_key text` with a unique (`customer_id`, `idempotency_key`) partial index on `bookings`, `service_requests`, `rfqs` and `recurring_schedules`. Return the existing id on conflict. The app generates a UUID per form submit. |
| WS8-09 | EXECUTE hygiene: `revoke … from public, anon` does not remove Supabase's direct default grant to `authenticated`. Cron or internal functions are callable by any signed-in user, and several user RPCs are executable by `anon`. | Technical defect | P2 | Before scaling | `0023:1471-1497` revokes `route_service_request(uuid,int)`, `process_proposal_milestones()` and `_proposal_public_intake(uuid,jsonb)` only from public and anon, so they are still `authenticated`-executable (privilege replay scan). `route_service_request` (`0040:396`) has no caller or ownership check: any user can re-route any open request, causing provider fan-out and notification spam. Anon-executable: `cancel_session_booking`, `cancel_session_pack`, `confirm_session_completion`, `complete_session_booking`, `create_session_booking`, `decline_session_booking`, `extend_session_pack`, `purchase_session_pack`, `request_session_completion`, `start_session_booking`, `provider_cancel_booking`, `submit_review(…,text[])`, `can_read_request_private`. Each calls `_require_uid` (low impact). | One migration that runs `revoke execute … from public, anon, authenticated` for cron and internal functions, and `revoke … from anon` for user RPCs. Add a CI SQL test that asserts the exact privilege set (see T05). |
| WS8-10 | The job-photos and dispute-photos buckets have no `file_size_limit` or `allowed_mime_types`. | Technical defect | P2 | Before pilot | `0001:1980-1984`; never updated (grep `storage.buckets`). Upload policy checks only the folder (`0001:1986-1989`). | Set 5 MB and `{image/jpeg,image/png,image/webp}`, as done for portfolio (`0009:1466`). |
| WS8-11 | Refund completion is assumed when the refund API returns an id; `refund.failed` and `refund.processed` webhooks are ignored. | Technical defect | P2 | Before accepting real payments | `process-refunds/index.ts:44-60`; `razorpay-webhook` `default` branch. | Handle `refund.processed` and `refund.failed`. On failure, set refund `failed` and re-queue, and alert ops. |
| WS8-12 | A gateway success followed by a DB record failure only logs "needs reconciliation". There is no reconciliation job or alert. | Technical defect | P2 | Before accepting real payments | `release-payouts/index.ts:104-107`; `process-refunds/index.ts:59-60`; `verify-payment/index.ts:52-55`. | Add a reconciliation cron that lists `payout_transfers` stuck in `processing` for over 30 minutes and pending refunds with attempts, cross-checks Razorpay, and alerts. |
| WS8-13 | Sports bookings, payments and refunds become invisible to the paying customer when the `sports` flag is turned off. | Business logic | P2 | Before pilot | `0058:261-273` (`sports_bookings_participant_read` requires the flag); `sports.test.mjs` "RLS also hides sports tables while the feature flag is off". | Remove the flag from the participant read policy (keep it in write RPCs), per `.github/copilot-instructions.md` rules 4 and 6. |
| WS8-14 | No global spend cap for AI chat, voice and photo calls (only per-user limits). Phone-OTP account farming can drive Gemini cost. | Technical defect | P2 | Before scaling | `ai-assistant/config.ts:81-84`; monthly budget only for product_search and quote_extract (`0051:30,120-125`). | Extend `begin_ai_usage` budgeting to `kind in ('chat','voice_chat','transcribe','photo')`, or add `AI_MONTHLY_BUDGET_USD` enforced in `index.ts` before model calls. |
| WS8-15 | Demo payment artefacts leak into money pipelines: demo refunds are auto-completed and demo payments are eligible for payouts. | Technical defect | P2 | Before accepting real payments | `process-refunds/index.ts:32-37`; `claim_due_transfers` (`0058:1766-1810`) has no `pay_demo_` filter. | Covered by T02 (exclude demo ids; refuse demo in production). |
| WS8-16 | `schedule-reminders` uses a non-constant-time secret compare and is not deployed or configured. | Technical defect | P3 | Later | `schedule-reminders/index.ts:6`; missing from `config.toml` and the `deploy-backend.yml:477-482` lists. | Use `timingSafeEqual`, then deploy it or delete it. |
| WS8-17 | The webhook accepts either secret for any event type and has no event-age check. Processing is idempotent, so replay impact is low. | Technical defect | P3 | Later | `razorpay-webhook/index.ts:21-27`. | Bind `RAZORPAYX_WEBHOOK_SECRET` to rail events only. Optionally reject events older than N days by `created_at`. |
| WS8-18 | `reviews` are fully public, including `customer_id`, `comment` and `photos`. | Unvalidated business assumption | P3 | Before pilot | `0001:1963` `reviews_public using (true)`; select is not revoked from anon. | Expose reviews through a view or RPC without `customer_id`. Confirm with legal/privacy. |
| WS8-19 | Users can self-set `profiles.role_provider` and `role_customer`. No server authz relies on them, but the admin dashboard counts them. | Technical defect | P3 | Later | `0001:1893`; usage at `0041:231,590`. | Drop those columns from the update grant. |
| WS8-20 | The app's Supabase client has no request timeout or offline detection, so screens can spin indefinitely on a bad network. | UX | P3 | Before scaling | `app/src/lib/supabase.ts:12-19`. | Pass `global.fetch` with an `AbortSignal.timeout(20000)` wrapper, and surface a retry. |

## RLS & authorization review

### Tables (latest policies)

| Table (data) | RLS | Client grants | SELECT | INSERT / UPDATE / DELETE | Gaps |
|---|---|---|---|---|---|
| `profiles` (name, avatar) | yes `0001:1868` | update of 4 columns only `0001:1893` | `profiles_select` `0009:1431`: self, live providers, booking counterparties; **no role restriction (anon included)** | update own `0001:1901` | `role_provider` self-settable (WS8-19) |
| `private_user_accounts` (phone, push token) | yes | select, update(`expo_push_token`) `0001:1904-1906` | own `0001:1907` | update own | OK; test `migration.test.mjs:79` |
| `addresses` | yes | default (all) | `addresses_own` for all, own `0001:1912` | own | Provider access only via `get_booking_address` (`0052:289`, gated on `accepted_at`) |
| `bookings` | yes | select only `0001:1944` | customer or `_acts_for(provider,'staff')` `0052:322` | RPC only | OK |
| `booking_secrets` (OTPs) | yes | none `0001:1890` | — | — | OK; `migration.test.mjs:102-103` |
| `quotes`, `quote_items` | yes | select only | customer or `_acts_for(…,'manager')` `0052:327,336` | RPC only | OK |
| `payments` | yes | select only | `_is_participant(booking_id)` `0001:1954` (customer or provider; not staff) | RPC or service only | Sports payments (`booking_id` null) are not visible through this policy; customers rely on RPCs. Acceptable. |
| `payment_schedule` | yes | select | `_is_participant` `0023:1459` | service | `fixed_booking.test.mjs:70` |
| `payment_obligations` | yes | none `0029:22` | — | service | OK |
| `refunds` | yes | select | via payment participant `0001:1960` | service | OK |
| `payouts` | yes | select | `provider_id` or `payee_id = auth.uid()` `0058:248` | service | OK |
| `payout_transfers` | yes | select | payee of parent payout `0058:252` | service | OK |
| `payout_transfer_reversals`, `provider_receivables`, `provider_receivable_recoveries` | yes | receivables select own or admin `0011:102` | — | service | OK |
| `provider_payout_accounts` (bank last4, IFSC) | yes | select `0009:1411` | own or admin `0009:1424` | edge function (service) | Full account number and PAN are never stored (`provider-payout-account/index.ts:6`) |
| `provider_documents` / `provider-docs` bucket | yes | select | own or admin | RPC; storage insert own folder `0009:1475` | OK (bucket 10 MB, PDF/JPEG/PNG) |
| `coin_accounts`, `coin_clawback_tracking` | yes | none `0015:52` | — | service | OK |
| `coin_ledger` | yes | select | own `0015:59` | none (forged insert rejected: `seva_coins.test.mjs:102`) | OK |
| `messages` (chat) | yes | update/delete revoked `0001:1967`; **insert revoked `0016:608`** | `_business_chat_participant` `0052:348` | `messages_insert` policy `0052:351` is inert because the insert grant is revoked; RPC `send_booking_message` | OK; `migration.test.mjs:489` |
| `notifications`, `push_devices`, `booking_chat_reads` | yes | select only | own | RPC | `migration.test.mjs:418-425` |
| `support_threads`, `support_messages` | yes | select `0041:453` | own or admin `0041:455,458` | RPC (`support_send` admin-checked) | OK |
| `reviews` | yes | select to all (insert/update/delete revoked) | `using (true)` `0001:1963` | `submit_review` RPC | Exposes `customer_id` and comments to anon (WS8-18) |
| `sports_bookings` | yes | select `0048:117` | flag AND (customer or venue staff) `0058:261` | RPC | Hidden when the flag is off (WS8-13) |
| `recurring_schedules`, `recurring_occurrence_changes` | yes | select | customer, provider or admin `0022:1466`; `_can_read_recurring_occurrence_changes` `0057:281` | RPC | `recurring_plans.test.mjs` RP-20 |
| `service_requests` / `request_private` / `request_recipients` / `proposals` / `proposal_items` / `proposal_schedule` / `request_messages` | yes | select | customer, admin, or `_acts_for(provider,'manager')` (`0052:474-509`); `request_private` only for customer or the paid provider (`0023:1407`) | RPC | `proposal_booking.test.mjs:134,136,223` |
| `rfqs`, `rfq_items`, `rfq_recipients`, `supplier_quotes`, `supplier_quote_items` | yes | column-scoped select `0050` | `_rfq_can_read` / `_rfq_quote_can_read` | RPC | `rfq.test.mjs` "another customer cannot read the RFQ row" |
| `product_enquiries`, `product_enquiry_messages` | yes | select | `_product_enquiry_participant` and flag | RPC | `shops_catalogue.test.mjs` "enquiry rows are isolated" |
| `travel_requests` | yes | select | customer or provider of the service `0014:671` | RPC | — |
| `ai_conversations`, `ai_messages`, `ai_usage`, `ai_feedback`, `analytics_events` | yes | read own; feedback full own; analytics insert own | own | AI writes via service | OK |
| `leakage_signals`, `byo_invites` | yes | `leakage_signals` select admin | admin `0016:605` | RPC | `leakage_programme.test.mjs:173-228` |
| `admins`, `admin_audit_log`, `app_config`, `feature_flags` | yes | none | — | service or admin RPC | Admin identity weakness (WS8-01/04) |

### Storage buckets

| Bucket | Public | Read | Write | Limits |
|---|---|---|---|---|
| `job-photos` | no | Own folder or booking participant (`0052:363`). Photo paths are validated to the caller's folder (`0018:649-654`). | Own folder (`0001:1986`) | **none** (WS8-10) |
| `dispute-photos` | no | Own or admin (`0001:2000`) | Own folder | **none** |
| `portfolio` | yes | public | own | 5 MB, image (`0009:1466`) |
| `avatars` | yes | public | own | 2 MB, image |
| `provider-docs` | no | own or admin | own | 10 MB, JPEG/PNG/PDF |
| `ai-photos` | no | own (`0006:68`) | service | set in `0006:65` |
| `product-images` | no | `_product_image_access` (`0049:258-262`) | owner | set in `0049:250` |

Signed URLs: `createSignedUrls(paths, 3600)` at `app/src/lib/supabaseApi.ts:553`.

### Security definer functions

- **search_path:** all 330+ `security definer` functions in the scan have `set search_path = public` (scan field `sp=True` for every row). No definer function lacks it.
- **Ownership checks:** user RPCs derive the caller from `public._require_uid()` (for example `0018:618`, `0030:743`) and assert ownership or role with `_acts_for`, `_is_participant` or `_assert(b.customer_id = v_uid …)`. Functions that take a `p_user_id` parameter (`prepare_*`) are service-role only (`0030:780-791`).
- **EXECUTE revocation:** money-mutating internal helpers are revoked from `authenticated`. This covers `_set_status`, `_queue_refund`, `_allocate_payout`, `_create_payout`, `_spend_coin_lots`, `_credit_booking_coins`, `_create_sports_payout`, `record_*_paid`, `claim_*`, `complete_*` and `fail_*` (privilege replay scan). Exceptions are listed in WS8-09.

### Answers to the specific questions

| Question | Answer | Evidence |
|---|---|---|
| Can customers view other customers' private info? | **No** for bookings, phones, addresses, chat, payments and support. **Partially yes** for reviews (`customer_id` and comment are public). | `migration.test.mjs:79,487`; `0001:1963` |
| Can providers view unauthorised customer records? | **No**: bookings and quotes are scoped to provider or staff; exact address only after acceptance (inspect/quote path untested); proposal venue only after advance. | `0052:289-302,322`; `proposal_booking.test.mjs:134` |
| Can providers alter prices after customer acceptance? | **No** silent change: changes create a new quote or change order that the customer must approve and pay; package quotes are trigger-protected. Edits to `provider_services` or `rate_card_items` do not touch existing bookings, which snapshot `visit_fee` and `pricing_snapshot` (`0018:684-697`). | `migration.test.mjs:156-189` |
| Can users manipulate transaction statuses? | **Not directly**: no client insert/update on bookings, payments, refunds or payouts. **But** `demo_settle_payment` can mark a booking paid for any self-flagged "demo" provider when demo payments are enabled (WS8-02). | `migration.test.mjs:104`; `0030:750-757` |
| Can clients change payment amounts? | **No**: the amount comes from `prepare_*` (service only), and the record function rejects a mismatched amount. | `0029:186-191`; `review_fixes.test.mjs:326` |
| Can users modify coin balances? | **No**: ledger insert is denied, and only admins can adjust. | `seva_coins.test.mjs:102`; `0047:665` |
| Can non-admins reach admin functions? | Every admin RPC checks `_is_admin()` on the server, and tests confirm "admin only". **However**, the admin identity is reachable by anyone through the publicly known test phone and OTP (WS8-01). | See WS8-F10 / WS8-F11 |

## Reliability & idempotency review

| Scenario | Client guard | Server guarantee | Status |
|---|---|---|---|
| Double tap "Book" | React `busy` state (`book-fixed/[providerServiceId].tsx:70`; `book/[providerServiceId].tsx` same pattern) | None; each call inserts a new address and booking (`0018:674-697`). Provider advisory lock only serialises. | NOT IMPLEMENTED (WS8-08) |
| Double tap "Pay" | `pay()` has no in-flight lock (`app/src/lib/payments.tsx:104-120`) | `prepare_*` locks the booking (`_lock_booking`), reuses a live `created` row with `short_url`, and retires the others. A late attach loses the race and gets 409 (`create-payment/index.ts:155-201`). Sports use a unique `created` index (`0058:62-64`). | PASS for prepare reuse (`proposal_booking.test.mjs:260-265`); client UNTESTED |
| Duplicate webhook or verify callback | — | Early return on known `razorpay_payment_id`; unique constraint (`0001:208`) | PASS (`migration.test.mjs:98`) |
| Second capture on the same order | — | Sports: separate row plus refund. Home services: overwrites (WS8-05). | FAIL (home) |
| Concurrent accept or decision on a sports slot | — | Advisory lock per resource plus `for update` (`0058:1287-1291`) | PASS (`sports.test.mjs` race) |
| Concurrent coin spend | — | `_lock_coin_account` `for update` (`0015:62-70`); unique `ref` | PASS (`seva_coins.test.mjs:175`) |
| Refund claim concurrency | — | `claim_due_refunds` (`for update skip locked` pattern); `X-Refund-Idempotency` | PASS (`migration.test.mjs:374`) |
| Payout claim concurrency | — | `claim_due_transfers` `for update of t, po skip locked` (`0058:1807`); per-attempt idempotency key | PASS (`provider_onboarding.test.mjs:263,278`) |
| App restart mid-payment | — | Webhook (`order.paid`) settles independently of the app; `verify-payment` is a second path | UNTESTED end to end |
| Expired session | `invokeFunction` refreshes once, then "Your login has expired" | Edge functions verify the JWT (`admin.auth.getUser`) | UNTESTED |
| Offline or timeout | No fetch timeout or offline banner in the app | Razorpay calls time out at 15 s; ambiguous errors are retried by idempotency keys | PARTIAL (WS8-20) |
| Payment succeeded, booking update failed | — | `record_*_paid` is one transaction; on RPC error the webhook returns 500 so Razorpay retries (`razorpay-webhook/index.ts:57-60`). `verify-payment` returns 500 with "will be applied automatically". **But** `ok:false` results return 200 with no refund for home services (WS8-06). | PARTIAL |
| Booking succeeded, notification failed | — | Notifications are an outbox in the same transaction (`_queue_notification`); `claim_due_notifications` / `finish_notification` retry | PASS (`migration.test.mjs:459`) |
| Refund after settlement | — | `_queue_transfer_reversals`, provider receivables, netting in `claim_due_transfers` (`_net_receivables`) | PASS (`cancellation_payouts.test.mjs`) |
| Gateway success, DB record failure (payout or refund) | — | Row stays `processing`; logged only | PARTIAL (WS8-12) |

### Every place where duplicates can be created

1. **Bookings:**
   - `create_booking` (`0018:601`), `create_fixed_booking` (`0019:190`), `create_session_booking` (`0031:23`), `create_travel_request` (`0014:207`), `create_recurring_plan` / `create_recurring_schedule` (`0057:1027,2319`): no idempotency key.
   - ASAP bookings have a null `service_window`, so the reservation trigger (`0021:556`) cannot reject a duplicate.
   - Duplicate `addresses` rows are created on every call (`0018:674`).
2. **Service requests and RFQs:** `create_service_request` (`0040:21`) and `create_rfq` (`0050:211`) have no key.
3. **Payments:**
   - Normally deduplicated by reuse or retire (`0029:79-101,130-140`).
   - **Extra captures on home services overwrite the existing row** (WS8-05).
   - `_refund_unmatched_sports_capture` inserts a new row per unknown payment id. This is idempotent because it checks `razorpay_payment_id` first (`0058:1368-1370`).
4. **Bills / quotes:** new quote versions are unique on (`booking_id`, `version`) (`0001:184`); older open quotes are superseded (`0001:624-637`).
5. **Rewards (coins):** `coin_ledger.ref` is unique (`0015:31`), so earn and clawback are idempotent. Tested at `seva_coins.test.mjs:175`.
6. **Settlements (payouts):**
   - `payouts.booking_id` and `payouts.sports_booking_id` are unique, with `on conflict do nothing` (`0001:536-580`, `0058:1660-1668`).
   - Transfers are recomputed only for unattempted rows (`0001:551-552`).
   - **Demo payments can still be turned into transfers** (WS8-02/15).
7. **Refunds:** capped at the refundable amount per payment (`0001:655-664`). There is no unique key per business event, so two different cancellation paths could each queue a partial refund up to the cap. The cap prevents over-refund only per payment.
8. **Notifications:** collapse keys on most enqueues (for example `'sports-booking-confirmed:'||id`); the outbox claim is single-use.

## Secrets, storage & edge functions

- **Secrets:**
  - All server secrets (Razorpay key and secrets, RazorpayX, `CRON_SECRET`, `GEMINI_API_KEY`, `GOOGLE_MAPS_API_KEY`, Expo push token) come from GitHub Secrets and are set with `supabase secrets set` (`deploy-backend.yml:14-26,463-472`). They are masked in CI logs (run 44358292571).
  - The client receives only `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` (`app/src/lib/config.ts:1-2`). `app.json` and `eas.json` hold no keys. The repo grep for secret patterns was clean.
  - **Risk:** the repo is public, and test credentials are in it: the admin phone in `0041:7`, OTP `123456` in `e2e/web-smoke.mjs:13` and `README.md:256`, and seeded founder phone `919999999999` in `seed-full.sql:13`. Combined with `sms_test_otp` on the live project, these give working logins (WS8-01).
- **Edge function authentication:**

  | Function | JWT verification | Server-side check |
  |---|---|---|
  | `create-payment`, `ai-assistant`, `places` | `verify_jwt = true` (`config.toml`) | Caller resolved with `admin.auth.getUser(token)` |
  | `provider-payout-account`, `provider-service` | Gateway JWT at deploy (`deploy-backend.yml:477`) | `getUser` |
  | `razorpay-webhook` | `verify_jwt = false` | HMAC over the raw body, timing-safe (`:17-28`) |
  | `verify-payment` | `verify_jwt = false` | Checkout HMAC over `order_id\|payment_id` with the key secret; payment re-fetched from Razorpay and bound to the order (`:33-37`) |
  | `release-payouts`, `process-refunds`, `send-notifications`, `review-insights` | `verify_jwt = false` | `x-cron-secret` with `timingSafeEqual` |
  | `schedule-reminders` | Not configured or deployed | Uses `!==` (WS8-16) |

  Service-role clients are created only inside edge functions. User-impersonating calls in `ai-assistant` use the anon key plus the user's bearer token (`index.ts:1204`).
- **Webhook signatures:** verified as above. There is no Deno test of the payment-webhook signature (UNTESTED). Refund webhooks (WS8-11) and chargebacks (WS8-07) are not handled.
- **Upload validation:** limits are listed in the storage table above. Server RPCs validate paths (`like v_uid || '/%'`, no `..`) for portfolio and documents (`0009:740,798`) and job photos (`0018:649-654`). Signed URLs expire after one hour.
- **AI integration:**
  - The Gemini key is server-side only (no client reference found).
  - Abuse limits: 30 messages per day, 6 per minute, plus voice and photo caps (`ai-assistant/config.ts:81-84`; enforced at `index.ts:715-724`).
  - Product search and quote extract use DB-reserved budgets with a global monthly USD cap under a row lock (`0051:33-131`; `begin_ai_usage` is service-only, `0051` revoke at `:~130`).
  - Chat has no global cap (WS8-14).
  - Prompt injection: static rules plus heuristic flagging and output sanitisation (`policies/security.ts`). Tools act only for the authenticated uid. Mitigation is advisory only (PARTIAL).
- **Audit logs:** `admin_audit_log` (no client access, `0001:1890`) receives rows from coin adjustments, commission, features, geography, category, venue/shop status, KYC, disputes and payout rail. There is no test asserting audit rows (UNTESTED), and no audit on `app_config.admin_phones` changes (that row is edited out-of-band).

## Remediation tasks

All migration tasks create **one new migration file each**. Use the next free numbers (`0059_…`, `0060_…`), assigned by the coordinator, and register each in `supabase/tests/package.json` (`pretest` parse plus test file) and in the `deploy-backend.yml` 0020-0058 apply list (renamed to 0020-00NN). Never edit old migrations.

| ID | Objective | Files (exact paths) | Required change | Depends on | Acceptance criteria | Tests to add | Complexity | Parallelisable |
|---|---|---|---|---|---|---|---|---|
| WS8-T01 | Close the public admin backdoor | `supabase/migrations/00NN_admin_identity_hardening.sql` (new); `e2e/web-smoke.mjs`; `.github/workflows/e2e-web.yml` | 1) `create or replace function public._is_admin() returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from public.admins where user_id = auth.uid()) $$;`<br>2) `update public.app_config set value = '[]'::jsonb where key = 'admin_phones';`<br>3) Re-create `_admin_user_ids()` (`0041:37`) to select only from `public.admins`.<br>4) In E2E, before the admin step, insert the E2E admin into `public.admins` via the Management API on the **demo project only**, guarded by a `DEMO_PROJECT=1` repo variable.<br>5) Operational: remove `918888888888` from production `sms_test_otp`. | — | A phone listed in `app_config.admin_phones` is not admin; a user in `public.admins` is admin; the `review_fixes.test.mjs:474` expectation is updated to the new rule | New `supabase/tests/admin_identity.test.mjs` using `createHarness()`: scenario "phone allowlist no longer grants admin" (insert `auth.users` phone `'+918888888888'`, set `admin_phones` to `'["918888888888"]'::jsonb`, assert `select public._is_admin()` as that user returns false); scenario "admins table grants admin". Cast params explicitly (`$1::uuid`). | S | Yes |
| WS8-T02 | Make demo settlement unforgeable and keep demo money out of payouts | `supabase/migrations/00NN_demo_payment_hardening.sql` (new) | 1) Re-create `demo_settle_payment(uuid)` from `0030:736-775` with two changes: replace `u.raw_user_meta_data ->> 'demo_only'` with `u.raw_app_meta_data ->> 'demo_only'`, and add `perform public._assert(coalesce((select (value->>'is_demo_project')::boolean from public.app_config where key='deployment'), false), 'demo payments are disabled');` with an `insert into app_config (key,value) values ('deployment','{"is_demo_project":false}') on conflict do nothing`.<br>2) Re-create `_allocate_payout` (`0001:536`) and `_create_sports_payout` (`0058:1618`) adding `and p.razorpay_payment_id not like 'pay\_demo\_%'` to the payment loop.<br>3) Re-create `claim_due_transfers` (`0058:1766`) joining `payments pm` in the claim subquery and adding `and pm.razorpay_payment_id not like 'pay\_demo\_%'`.<br>4) Update `supabase/seed-all-services.sql` to set `raw_app_meta_data` `demo_only` and `deployment.is_demo_project = true` (seed file only). | — | User-metadata `demo_only` no longer qualifies; demo payments never produce `payout_transfers`; the existing demo test still passes with app metadata | In `review_fixes.test.mjs` or a new `demo_payments.test.mjs`: scenario "user metadata cannot self-flag demo" (set `raw_user_meta_data='{"demo_only":"true"}'::jsonb`, enable `demo_payments`, assert `demo_settle_payment($1::uuid)` fails); scenario "demo payment is excluded from payout allocation" (service role: insert paid payment `pay_demo_x`, call `_create_payout($1::uuid, 1000::int, 1000::int, now())`, expect assert failure or zero transfers). | M | Yes |
| WS8-T03 | Never overwrite a captured payment id; refund extra home-service captures on a new row | `supabase/migrations/00NN_record_payment_extra_capture.sql` (new) | Re-create `record_payment_paid(text,text,int)` from `0029:167-319`. Right after `select * into p … for update` and the amount check, add: `if p.razorpay_payment_id is not null or p.status <> 'created' then insert into public.payments (booking_id, quote_id, purpose, amount, status, razorpay_link_id, razorpay_payment_id, paid_at) values (p.booking_id, p.quote_id, p.purpose, p_amount, 'paid', 'extra-capture:'||p_payment_id, p_payment_id, now()) returning * into p2; perform public._queue_refund(p2.id, p_amount, 'duplicate capture'); perform public._log_event(p.booking_id, null, 'duplicate capture '||p_payment_id||' refunded'); return jsonb_build_object('ok', true, 'duplicate_capture', true, 'refund', true); end if;` (declare `p2 public.payments;`). Do the same for `record_time_payment_paid` (latest definition: run `grep -n "function public.record_time_payment_paid" supabase/migrations/*.sql`, last match). | — | A second capture on an already-paid link creates a new `paid` row with a full refund; the original row keeps its id and status `paid` | New `supabase/tests/payment_integrity.test.mjs` using `createHarness()` and `scenario()`: pay a visit-fee link with `record_payment_paid($1::text,'pay_A'::text,$2::int)`, then call it again with `'pay_B'`. Assert the original row still has `razorpay_payment_id = 'pay_A'` and `status = 'paid'`, a new row has `'pay_B'` with a pending refund of the full amount, and `_net_paid` is unchanged. | M | Yes |
| WS8-T04 | Stop swallowing rejected captures | `supabase/functions/_shared/record-payment.ts`; `supabase/functions/_shared/record-payment_test.ts`; migration from T03 | 1) In `record_payment_paid`, for `unknown link` or `amount mismatch`, insert a row into a new table `public.payment_exceptions(id uuid pk default gen_random_uuid(), reference text, razorpay_payment_id text unique, amount int, reason text, created_at timestamptz default now())` (RLS on; revoke all from anon and authenticated). Return `{ok:false, error, exception:true}`.<br>2) In `record-payment.ts`, return `{ok:false}` for **all** `ok:false` results except `exception:true`, which is logged with `console.error` and returns ok. | T03 | Unknown link or amount mismatch leaves an exception row and an error log; the webhook returns 500 when no exception row was written | Deno: extend `record-payment_test.ts` with "non-sports ok:false surfaces as failure". SQL: `payment_integrity.test.mjs` scenario "amount mismatch writes payment_exceptions". | S | No (after T03) |
| WS8-T05 | EXECUTE privilege hygiene plus a regression guard | `supabase/migrations/00NN_function_privileges.sql` (new); `supabase/tests/function_privileges.test.mjs` (new) | `revoke execute on function public.route_service_request(uuid,int), public.process_proposal_milestones(), public._proposal_public_intake(uuid,jsonb) from public, anon, authenticated; grant execute … to service_role;` and `revoke execute on function` (exact signatures listed in WS8-09) `from anon;` for all user RPCs listed in WS8-09. | — | `has_function_privilege('authenticated', 'public.route_service_request(uuid,int)', 'execute')` is false; no `anon` execute on mutating RPCs | `function_privileges.test.mjs`: after applying all migrations, query `select p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute')`. Assert the result equals an explicit allow-list array committed in the test. Same for `anon`. | M | Yes |
| WS8-T06 | Booking and request idempotency keys | `supabase/migrations/00NN_booking_idempotency.sql` (new); `app/src/lib/supabaseApi.ts`; `app/app/book/[providerServiceId].tsx`; `app/app/book-fixed/[providerServiceId].tsx` | 1) `alter table public.bookings add column idempotency_key text; create unique index bookings_customer_idempotency_idx on public.bookings(customer_id, idempotency_key) where idempotency_key is not null;` (same for `service_requests`, `rfqs`).<br>2) Add a new overload, e.g. `create_booking_v2(…, p_idempotency_key text)`, that first `select id … where customer_id = v_uid and idempotency_key = p_idempotency_key` and returns it if found; otherwise run the existing body and set the key. Grant to authenticated and revoke from anon.<br>3) The app generates `crypto.randomUUID()` once per screen mount and passes it. | — | Two calls with the same key return the same booking id and create one address | `supabase/tests/booking_idempotency.test.mjs`: call `create_booking_v2(... , 'k1'::text)` twice as the same customer; assert equal ids and `count(*)` of bookings = 1 and addresses = 1; a different key creates a second booking. | M | Yes |
| WS8-T07 | Bucket limits for job and dispute photos | `supabase/migrations/00NN_storage_limits.sql` (new) | `update storage.buckets set file_size_limit = 5242880, allowed_mime_types = '{image/jpeg,image/png,image/webp}' where id in ('job-photos','dispute-photos');` | — | Bucket rows show the limits | Parse check only (storage is stubbed in PGlite); add a `migration.test.mjs`-style static regex assertion in a new test that the migration contains both bucket ids. | S | Yes |
| WS8-T08 | Sports participant read is not gated by the flag | `supabase/migrations/00NN_sports_read_visibility.sql` (new); `supabase/tests/sports.test.mjs` | `drop policy if exists sports_bookings_participant_read on public.sports_bookings; create policy … using (customer_id = auth.uid() or exists (select 1 from public.sports_venues v where v.id = venue_id and public._acts_for(v.owner_id,'staff')));` | — | The customer still sees their own booking with `sports=false`; strangers see nothing | Update the `sports.test.mjs` assertion "RLS also hides sports tables" to cover catalogue tables only. Add scenario "flag off: customer still reads own sports booking". | S | Yes |
| WS8-T09 | Chargeback and refund webhooks | `supabase/functions/razorpay-webhook/index.ts`; `supabase/migrations/00NN_payment_disputes.sql` (new) | Add cases `payment.dispute.created`, `payment.dispute.lost`, `refund.processed` and `refund.failed`. Call new service-only RPCs: `record_payment_dispute(p_payment_id text, p_status text, p_amount int)` (sets `payouts.status = 'on_hold'` for that booking, or queues transfer reversals if already transferred via `_queue_transfer_reversals`) and `record_refund_status(p_razorpay_refund_id text, p_status text)`. | T03 | A disputed payment's payout is not claimable; a failed refund returns to `pending` with `last_error` | SQL: `payment_integrity.test.mjs` scenario "dispute freezes payout" (service role calls `record_payment_dispute('pay_A'::text,'created'::text,1000::int)`, then `claim_due_transfers(10::int)` returns 0 rows). Deno: webhook routing test. | L | No |
| WS8-T10 | Environment separation and deploy gate | `.github/workflows/deploy-backend.yml`; `.github/workflows/e2e-web.yml`; `.github/workflows/publish-app.yml`; `.github/workflows/build-apk.yml` | Add `environment: production` (with required reviewers) to `deploy-backend`. Create `STAGING_*` secrets; make `e2e-web.yml` use `secrets.STAGING_SUPABASE_PROJECT_REF` / `STAGING_*` only. Add a first step in `e2e-web.yml` that fails if `STAGING_SUPABASE_PROJECT_REF == SUPABASE_PROJECT_REF`. | — | E2E seed can never target production | Workflow lint only. | M | Yes |
| WS8-T11 | Payout/refund reconciliation alert | `supabase/functions/release-payouts/index.ts`; new SQL function in `00NN_reconciliation.sql` | `list_stuck_money_ops()` (service-only) returns `payout_transfers` in `processing` for over 30 minutes and refunds `failed` with `attempts >= 3`. `release-payouts` logs `console.error('RECONCILE', …)` and includes the count in its JSON. | — | A stuck row appears in the output | SQL scenario that inserts a `processing` transfer with `created_at = now() - interval '1 hour'` and asserts it is listed. | S | Yes |
| WS8-T12 | Global AI chat budget | `supabase/functions/ai-assistant/index.ts`; `supabase/functions/ai-assistant/config.ts`; `00NN_ai_chat_budget.sql` | Add `AI_MONTHLY_BUDGET_USD` (default 50) to the config. Before each model call, sum `ai_usage.cost_micros_usd` for the current month (service client) and return 429 `monthly_budget` if over. | — | Over-budget requests are refused before calling Gemini | Deno `config_test.ts` plus a unit test of the budget check with a fake usage sum. | M | Yes |
| WS8-T13 | Minor hardening | `supabase/functions/schedule-reminders/index.ts`; `supabase/functions/razorpay-webhook/index.ts`; `00NN_minor_privacy.sql` | Use `timingSafeEqual` in `schedule-reminders`. In the webhook, accept `RAZORPAYX_WEBHOOK_SECRET` only when `isRailEvent(event.event)`. Run `revoke update (role_customer, role_provider) on public.profiles from authenticated;`. Create view `public.reviews_public_v` without `customer_id` and revoke anon select on `reviews`; app reads switch to the view. | — | — | `preferred_language.test.mjs`-style check: an authenticated user updating `role_provider` gets `permission denied`. | S | Yes |

## Regression tests to add

1. **`supabase/tests/admin_identity.test.mjs`** (T01): the phone allowlist does not grant admin; the `admins` table does; every `admin_*` RPC returns "admin only" for a user whose phone is `+918888888888`.
2. **`supabase/tests/function_privileges.test.mjs`** (T05): exact allow-lists for `has_function_privilege('anon'|'authenticated', oid, 'execute')` over all `prosecdef` functions in `public`. This catches any future `revoke … from public, anon` that forgets `authenticated`.
3. **`supabase/tests/payment_integrity.test.mjs`** (T03/T04/T09): duplicate capture creates a new row and refund and preserves the original; amount mismatch or unknown link writes `payment_exceptions`; a dispute freezes the payout; `_net_paid` is unchanged after an extra capture.
4. **`supabase/tests/demo_payments.test.mjs`** (T02): user metadata cannot self-flag a demo provider; `deployment.is_demo_project=false` disables demo settlement; demo payments never become `payout_transfers` (both rails).
5. **`supabase/tests/booking_idempotency.test.mjs`** (T06): the same key returns the same booking and address; different keys produce two bookings; a concurrent pair with the same key yields one row (run two `as()` calls inside `Promise.all`).
6. **`sports.test.mjs`** (T08): with the flag off, the customer still reads their own booking; a stranger cannot.
7. **RLS gaps without tests:**
   - Inspect/quote `get_booking_address` hides `line1`/`lat`/`lng` from the provider until `accepted_at`.
   - `addresses` are not readable by other users.
   - `payouts` / `payout_transfers` are not readable by another provider.
   - `support_messages` are not readable by another user.
   - A non-admin `admin_adjust_coins` call fails with "admin only".
8. **Deno:**
   - `razorpay-webhook` signature: bad signature returns 401; valid signature with the payment secret is routed; the RazorpayX secret is rejected for `order.paid` (after T13).
   - `verify-payment` signature or order mismatch returns 400/401.
   - `record-payment_test.ts`: non-sports `ok:false` returns failure.
9. **E2E (staging only):** after T01/T10, an admin step logs in with a staging-only admin, and a negative step asserts the old `8888888888` login has no Admin portal entry.
