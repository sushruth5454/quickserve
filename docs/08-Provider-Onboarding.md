# 08 — Provider Onboarding, Profile & Payout Verification

Status: implemented (migrations `0008`, `0009`, `0011`; Edge Function `provider-payout-account`; app wizard
`app/app/onboarding.tsx` + `app/app/provider-profile/*`). The payment and RLS parts need review (see §11).

This document is the spec for how a provider signs up, gets verified, goes live and manages their profile. It
replaces the old 3-step form (profile → skills → static payout checklist). In the old flow, real providers could
never become `verified`, so only seeded providers could be found or booked.

---

## 1. Goals

1. A brand-new provider (no seed data) can go from signup to **live and bookable** without staff action. The only
   exceptions are the payout partner's own checks and any category documents that need review.
2. The go-live rule is decided by **one server rule** (`_provider_is_live`). Search, booking and RLS all use it.
3. Every onboarding step can be edited later from **Me → Provider profile**.
4. Customers see a trustworthy profile: badges, specialisations, area, hours, work photos, rate card and reviews.
   They never see the phone number, exact base location, bank details or documents.
5. Payouts are not tied to one payment product. They use a **rail abstraction**: Razorpay Route, or RazorpayX
   Payouts. Route needs eligibility approval (doc 03 §5.1).

## 2. Flow (7 resumable steps)

| # | Step (route `/onboarding`, edit: `/provider-profile/<key>`) | Required to submit | Saved by |
|---|---|---|---|
| 1 | **About you** (`basics`): photo (camera/gallery, square crop, resized to 512 px JPEG on the device), name, optional gender (private, for future same-gender matching), languages, years of experience, bio (30–500 chars, with good and weak examples) | photo, name, bio ≥ 30, ≥ 1 language | `save_provider_basics` (creates the `providers` row, sets `profiles.role_provider`) |
| 2 | **Services** (`services`): categories from the server catalogue. For each one: skill level (with definitions), specialisations / brands / tools from `category_skills`, visit fee, labour rate per job or hour, rate card with suggestions, and **local price guidance** | ≥ 1 active service | `provider_services` upsert (validated by trigger `_validate_provider_service`), `rate_card_items` |
| 3 | **Area** (`area`): GPS or address search (native) for the base location, launch-city area chips as a fallback (web), city, radius 1–50 km with a coverage preview (circle, ≈ πr² km², nearby areas) | base location + city | `save_provider_service_area` |
| 4 | **Hours** (`hours`): weekly slots (≤ 4 per day, ≥ 1 h, no overlaps), presets, "copy Monday to all days", max jobs per day, time off (whole days, ≤ 90 days, ≤ 20 upcoming) | ≥ 1 slot | `set_provider_availability`, `add/delete_provider_time_off` |
| 5 | **Work & docs** (`portfolio`): up to 12 work photos with captions. Category documents: required / recommended / optional, from `categories.requires_docs` / `recommended_docs` | only docs listed in `requires_docs` (none today) | `add_portfolio_photo`, `submit_provider_document` |
| 6 | **Payouts** (`payouts`): legal name, PAN, email, bank account + IFSC (+ address on the Route rail). Shows status, ETA and a support link. Can be skipped and finished later | no (but needed to go live) | Edge Function `provider-payout-account` |
| 7 | **Review** (`review`): completeness checklist with jump-to links, "Preview your public profile" (`/provider/<id>?preview=1`), provider agreement summary + checkbox | agreement accepted | `submit_provider_profile(terms_version)` |

- **Resume:** `providers.onboarding_step` stores the furthest step reached. `resumeStep()` reopens the first
  incomplete required step, or the review step if the profile was already submitted.
- **Autosave:** free-text drafts for basics and hours are kept in AsyncStorage (`quickserve.draft.*`). PAN and
  bank fields are **never** saved to drafts.
- **After submit:** the provider dashboard shows the `GoLiveStatusCard` (Finish your profile / Under review /
  Action needed with reasons and "Fix" links / You are live) until the provider is live.

## 3. Statuses

`kyc_status` (`provider_kyc_status` enum) uses the values `pending`, `verified` and `rejected`, plus three values
added by `0008`: `under_review`, `needs_clarification` and `suspended`. The values are mapped from the payout rail
by `_map_gateway_status`.

`go_live.state` (computed by `_provider_go_live`, shown to the provider):

| State | Meaning |
|---|---|
| `draft` | Not submitted yet |
| `under_review` | Submitted; waiting for the payout partner or for document review. Nothing to do |
| `action_needed` | At least one reason has severity `action` (payout missing / needs clarification / rejected, document missing / rejected / expired, no active service, admin note) |
| `live` | Searchable and bookable (see §4) |
| `suspended` / `deactivated` | Admin suspension / provider deactivated the account |

Reason codes (`GoLiveReason.code`): `payout_missing`, `payout_unavailable`, `payout_pending`,
`payout_needs_clarification`, `payout_rejected`, `payout_suspended`, `doc_missing`, `doc_pending`, `doc_rejected`,
`doc_expired`, `no_active_service`, `admin_note`. The app wording is in `app/src/lib/onboarding/copy.ts`
(`reasonCopy`).

## 4. Go-live rule (single source of truth)

```
_provider_is_live(p) =
      kyc_status = 'verified'
  and not suspended
  and deactivated_at is null
  and submitted_at is not null
  and exists an active provider_service whose category documents are approved (_category_docs_ok)
```

- **Search** (`search_providers`) and **booking** (`create_booking`) also require `not paused`. They check
  `_category_docs_ok` for the specific service.
- **RLS** policies `profiles_select`, `providers_read`, `provider_services_read` and `rate_card_read` show
  non-owners only live providers. Participants in an existing booking can still read the provider.
- **Backfill:** providers that were already `verified` get `submitted_at = created_at` and the terms version
  `legacy`. Their behaviour is unchanged. Providers with no weekly slots are treated as available at any time, as
  before.
- **Paused (holiday mode):** the provider stays visible, marked "Not taking bookings right now". Search, ASAP and
  scheduled booking reject them.

## 5. Availability in booking

Tables follow doc 07 §3.9:

- `provider_availability(provider_id, weekday 0=Sun…6, start_time, end_time)` stores weekly slots.
- `provider_time_off(provider_id, period tstzrange, reason)` stores whole provider-local days, using
  `providers.timezone` (default `Asia/Kolkata`).

`_provider_slot_problem(provider, start, minutes)` is used by `create_booking`. A booking fails with
`provider_unavailable: …` when any of these is true:

- The provider is paused.
- The 2-hour window is not fully inside one weekly slot.
- The window overlaps time off.
- The day already has `max_jobs_per_day` non-cancelled bookings. Unpaid `pending_payment` rows count for
  30 minutes.

`create_booking` takes a per-provider advisory lock, so two customers cannot race for the last job of the day.
ASAP bookings are checked against the current time.

**App:** `get_provider_availability(provider)` returns the slots, time off (next 60 days) and full days (next
14 days). The Book screen uses `windowFits` / `asapAvailable` (`app/src/lib/onboarding/availability.ts`, which
mirrors the server check). It disables days and windows outside the provider's hours and turns off ASAP when the
provider is not working now. The server check is still authoritative.

## 6. Documents & platform trust (separate from payment KYC)

- **Aadhaar is never collected.** Identity is checked by the payout partner from PAN + bank.
- `document_types` holds the document catalogue: police verification, electrical licence, pest control licence,
  FSSAI, driving licence, training certificate, other.
- Each category's `requires_docs` / `recommended_docs` decides what is asked for. **PM default (founder may
  override):** nothing is mandatory today. An electrical licence is recommended for electricians, a pest-control
  licence for pest control, and police verification for house cleaning (doc 07 §9 B3, pending a lawyer).
  Making a document mandatory is one `update categories set requires_docs = '{…}'`.
- Files go to the **private** bucket `provider-docs` (10 MB; jpg, png or pdf). Storage RLS lets only the owner's
  folder and admins read. The table `provider_documents` tracks each upload: status pending / approved / rejected
  / expired / superseded, reject reason, `expires_on`, `reviewed_by` and `reviewed_at`.
- **Admin review:** `admin_list_document_queue()` and `admin_review_document(id, approve, reason)` are admin-only
  and logged in `admin_audit_log`. `admin_set_provider_review_note(provider, note)` adds a provider-visible
  "Message from QuickServe".
- **Customer badges** come from `get_provider_public_profile`:
  - **Bank verified:** `kyc_status = verified`.
  - **ID verified:** only when the verification came from a Route linked account (Razorpay checks the
    stakeholder's PAN). The RazorpayX rail only validates the bank account holder name, so it does not earn this
    badge.
  - **Police verified:** an approved, unexpired police certificate.
  - Every other approved credential is listed by name.

## 7. Payouts behind a rail abstraction

`app_config.payout_rail` is `'payouts'` (RazorpayX, the default) or `'route'`. Read it with `get_payout_rail()`;
admins switch it with `admin_set_payout_rail` (audited). Each `payout_transfers` row keeps a snapshot of its
`rail`, so transfers in flight finish on the rail they started on.

`supabase/functions/_shared/payout-rail.ts` defines one interface for both rails:
`onboardBeneficiary`, `getStatus`, `release` and `reverse`.

### 7.1 Route rail (linked accounts) — needs Route enabled by Razorpay Support

1. `POST /v2/accounts` (type `route`, business_type `individual`, legal name, email, phone from the user's
   account, address, `reference_id` derived from the provider id) — https://razorpay.com/docs/api/payments/route/create-linked-account/
2. `POST /v2/accounts/{id}/stakeholders` (name, email, PAN) — https://razorpay.com/docs/api/payments/route/create-stakeholder/
3. `POST /v2/accounts/{id}/products` `{product_name: "route", tnc_accepted: true}` — https://razorpay.com/docs/api/payments/route/request-product-config/
4. `PATCH /v2/accounts/{id}/products/{product_id}` with `settlements` (beneficiary name, account number, IFSC) — https://razorpay.com/docs/api/payments/route/update-product-config/
5. The `activation_status` and `requirements` from the response are stored. Webhooks
   `product.route.under_review`, `product.route.needs_clarification` and `product.route.activated` update the
   status — https://razorpay.com/docs/webhooks/route/ ; integration guide:
   https://razorpay.com/docs/payments/route/integration-guide/
6. Release = Route transfer from the captured payment (existing `create-payment` / `release-payouts` behaviour).

Resubmitting is **idempotent**. The stored `razorpay_account_id`, stakeholder id and product id are reused, so a
resubmission patches the existing account instead of creating a new one.

### 7.2 Payouts rail (RazorpayX) — default while Route is not enabled

1. Contact: `POST /v1/contacts` (type `vendor`, `reference_id` = provider id) — https://razorpay.com/docs/api/x/contacts/create/
2. Fund account: `POST /v1/fund_accounts` (`account_type: bank_account`, name, IFSC, account number) — https://razorpay.com/docs/api/x/fund-accounts/create/bank-account/
3. Bank account validation (penny drop): `POST /v1/fund_accounts/validations` from the platform's RazorpayX
   account (`RAZORPAYX_ACCOUNT_NUMBER`) — https://razorpay.com/docs/api/x/account-validation/bank-account/
   - The result `results.registered_name` is compared with the PAN name (`namesMatch`).
   - **PM default:** the names match if every token or initial matches, or if Razorpay's name-match score is
     ≥ 70.
   - `completed` with a match → `verified`. Account invalid or name mismatch → `needs_clarification`, with the
     reason shown to the provider.
4. PAN is checked for format only (4th letter `P` = individual). No public RazorpayX PAN-verification API was
   found in the docs (unverified; follow-up: a KYC vendor, or the Route rail for ID verification).
5. Release: `POST /v1/payouts` (`mode` IMPS/NEFT, `purpose: payout`, header `X-Payout-Idempotency:
   <transfer_id>:<idempotency_seq>`) — https://razorpay.com/docs/api/x/payouts/create/bank-account/
6. Webhooks `payout.processed`, `payout.failed`, `payout.reversed` (optional: `payout.rejected`,
   `payout.updated`) update `payout_transfers` via `record_payout_gateway_event` —
   https://razorpay.com/docs/webhooks/payouts/
7. Webhooks `fund_account.validation.completed` and `fund_account.validation.failed` update the beneficiary —
   https://razorpay.com/docs/webhooks/account-validation/
8. **Refunds after release:** `provider_receivables` (debt) is netted from future payouts
   (`claim_due_transfers` → `_net_receivables`). Fully netted transfers complete as `netted_<id>`.

### 7.3 "Not enabled" handling

If Razorpay answers with "Route feature not enabled for the merchant", "Access to requested resource not
available", 401/403, or account-not-activated errors (`isGatewayUnavailable`):

- The function records `provider_payout_accounts.last_error = 'gateway_unavailable'`.
- It logs a `provider_onboarding_events` row (kind `payout_setup_failed`) and writes `console.error` (visible to admins in function logs).
- It returns `{state: "unavailable", message: "Payouts setup temporarily unavailable — we'll notify you."}`.

The rest of onboarding still works: the provider can still submit. They stay `under_review`, with reason
`payout_unavailable`, until the rail works. **Bank details are not stored**, so the provider re-enters them with
"Try again" once payouts are enabled. A blocked validation (fund account created, validation refused) resumes
automatically: the `refresh` action and the `release-payouts` cron sweep retry it, because validation needs only
the fund account id.

### 7.4 Data we keep

`provider_payout_accounts` holds:
- `rail`, `activation_status` and `requirements`
- Razorpay ids: account, stakeholder, product, contact, fund account, validation
- `name_match_score`, beneficiary name, **bank last 4**, IFSC, `last_error`

We **never** store the full PAN or account number. `providers.razorpay_account_id` is set only for Route `acc_…`
ids. **Follow-up:** TDS (194-O) needs the full PAN later, kept encrypted in Vault.

### 7.5 Test vs live

| | Test mode (keys `rzp_test_…`) | Live |
|---|---|---|
| Route | Not enabled on this account: `POST /v2/accounts` returns "Route feature not enabled for the merchant" (checked 14 Nov 2026). When enabled, test linked accounts are usually activated without manual KYC | Needs Razorpay to enable Route (eligibility, doc 03 §5.1) and real KYC of each linked account |
| RazorpayX | Contacts API works; `/v1/payouts` returns "Access to requested resource not available" (RazorpayX not activated). In test mode, validations and payouts return simulated results | Needs RazorpayX activation, a funded current account, `RAZORPAYX_ACCOUNT_NUMBER`, and IP allowlisting for the payouts API |

## 8. Customer-facing profile and privacy

`/provider/[id]` shows:
- photo, badges (§6), the "Bank verified" check mark, city, online status, rating, jobs done, years of experience
- bio and languages
- "Serves within N km of <area>, <city>", "Available today 9 am–7 pm" (or "On leave until …"), and the weekly hours
- per-service specialisations and brands, rate cards, work photos, and reviews

`?preview=1` hides the booking button and shows the preview banner. The share button shares a deep link
(`Linking.createURL('/provider/<id>')`).

**Column privacy (fix):** `0009` revokes `select` on `public.providers` from `anon` and `authenticated` and grants
only the public columns: `id, bio, city, service_radius_km, years_experience, languages, kyc_status, suspended,
is_online, rating_avg, rating_count, jobs_completed, commission_tier, created_at, paused, base_area, timezone`.

- `base_location`, `razorpay_account_id`, `gender`, `max_jobs_per_day`, the review fields and the onboarding
  fields are private.
- The owner reads their own row through `get_my_provider()`.
- The app no longer uses `select('*')` on `providers` (`supabaseApi.getMyProvider`, `getProviderDetail`).

Avatars and portfolio photos are in **public** buckets (`avatars` 2 MB and `portfolio` 5 MB; jpeg/png/webp). Each
user can write only to their own folder.

## 9. Profile management (Me → Provider profile, `/provider-profile`)

The page has:
- status card with reasons and Fix links
- **profile strength** (weighted completeness, with up to 3 neutral tips — no promised booking uplift)
- one row per section (`/provider-profile/<section>`)
- Preview and Share (only when live)
- **Holiday mode** (`set_provider_paused`)
- **Deactivate / Reactivate** (`deactivate_provider_account` / `reactivate_provider_account`). Ongoing jobs and
  payouts continue.

## 10. Notifications hook

Every state change writes `provider_onboarding_events(provider_id, kind, detail, created_at)`. The kinds are
`submitted`, `payout_submitted`, `payout_status_changed`, `payout_setup_failed`, `document_submitted`,
`document_reviewed`, `review_note`, `deactivated` and `reactivated`.

**TODO(notifications):** the notifications agent should consume this table to send push or in-app notices
(go-live, action needed, document rejected). No push is sent from onboarding code.

## 11. Review-gated changes (payments / RLS / migrations / auth)

- `0008` (enum values), `0009` (schema, RLS, column grants, storage buckets and policies, `search_providers`,
  `create_booking`, sync functions, admin RPCs), and `0011` (rails, receivables, `claim_due_transfers`,
  `retry_payout`).
- Edge Functions `provider-payout-account`, `_shared/payout-rail.ts`, `_shared/payout-beneficiary.ts`,
  `release-payouts` (rail-based release and netting), and `razorpay-webhook` (rail event routing,
  `RAZORPAYX_WEBHOOK_SECRET`).
- Auth config: test OTP number `919000000301` added for the fresh-provider e2e. `e2e-web.yml` deletes that auth
  user before each run.

## 12. Founder actions

1. **Route:** ask Razorpay Support to enable Route (eligibility in doc 03 §5.1). Then run
   `select admin_set_payout_rail('route', 'reason')` if you want linked accounts.
2. **RazorpayX:** activate RazorpayX on the merchant account, open or fund the current account, and set the
   Supabase secret `RAZORPAYX_ACCOUNT_NUMBER` (repo secret, deployed by `deploy-backend.yml`). Allowlist the
   Supabase egress IPs if RazorpayX asks for it.
3. **Webhooks** (Razorpay Dashboard → Webhooks → `https://<ref>.supabase.co/functions/v1/razorpay-webhook`):
   - enable `product.route.under_review`, `product.route.needs_clarification`, `product.route.activated`
   - enable `fund_account.validation.completed`, `fund_account.validation.failed`
   - enable `payout.processed`, `payout.failed`, `payout.reversed` (optional: `payout.rejected`, `payout.updated`)
   - If the RazorpayX webhook uses a different secret, set `RAZORPAYX_WEBHOOK_SECRET`.
4. **CA:** confirm the GST/TDS treatment of the payouts rail (the platform collects and pays out, doc 03).
5. **Lawyer:** confirm which licences or police verification must be mandatory per category (then set
   `requires_docs`).
6. **Provider agreement:** publish the full text for version `provider-agreement-v1-2026-11-14` (the app shows a
   summary).

## 13. Follow-ups

- Map pin with drag, excluded areas, and polygon service areas (today: centre + radius).
- Instant-accept toggle; UPI payouts (fund account `vpa`) on the payouts rail.
- PAN verification vendor; Vault-encrypted PAN for TDS.
- Admin console UI for the document queue (RPCs exist).
- Cron to mark expired documents and notify providers 30 days before expiry.
- Re-onboarding when the rail switches (Route ↔ payouts); post-release disputes (doc 03 C9).
- Notifications consuming `provider_onboarding_events` (§10).
- Cleanup of orphaned storage objects (old avatars and replaced documents).
