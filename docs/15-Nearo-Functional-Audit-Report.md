# Nearo — Functional, Business-Workflow & Experience Audit Report

| | |
|---|---|
| **Status** | **AUDIT ONLY — awaiting owner approval. No code was changed during this audit.** |
| **Product** | Nearo (currently branded QuickServe in code; tagline "Everything you need. Closer.") |
| **Code baseline** | `sushruth5454/quickserve` `main` @ `bfa999f` (2026-11-18), 58 migrations (latest `0058_sports_payments.sql`), 12 Edge Functions |
| **Deliverables in this set** | **A** Functional audit (this doc §3 + appendices) · **B** Customer experience (§4) · **C** Provider experience (§5) · **D** Billing & finance spec → [`16-Nearo-Billing-and-Finance-Specification.md`](16-Nearo-Billing-and-Finance-Specification.md) · **E** Test matrix (§6 + appendix feature matrices) · **F** Roadmap → [`17-Nearo-Audit-Remediation-Implementation-Plan.md`](17-Nearo-Audit-Remediation-Implementation-Plan.md) |
| **Evidence appendices** | [`audit/15-WS1`](audit/15-WS1-customer-journeys.md) Customer journeys · [`WS2`](audit/15-WS2-home-services.md) Home services · [`WS3`](audit/15-WS3-products-shops-rfq.md) Products & RFQ · [`WS4`](audit/15-WS4-sports-venues.md) Sports · [`WS5`](audit/15-WS5-creators-projects.md) Creators · [`WS6`](audit/15-WS6-payments-settlements.md) Payments & settlement · [`WS7`](audit/15-WS7-provider-admin-notifications.md) Provider/admin/notifications · [`WS8`](audit/15-WS8-security-reliability.md) Security & reliability · [`WS9`](audit/15-WS9-billing-forms-receipts-coins.md) Billing forms, receipts & coins |

---

## 1. Method, evidence and limits

### 1.1 How the audit was run
The coordinating auditor split the brief's 15 phases into **nine parallel read-only workstreams**. Each workstream read the actual source:
- Expo routes and feature modules
- The **latest** definition of every SQL function across all 58 migrations
- RLS policies
- Edge Functions
- CI workflows
- SQL, Deno and Jest tests

Each workstream then wrote a feature matrix, findings, persona walkthroughs, a form-field audit, remediation tasks and regression tests (appendices).

**Automated test evidence used:**

| Run | What it proves |
|---|---|
| Backend deploy `44358292571` | **All 82 registered SQL checks PASS.** They run on PGlite against the real migrations. 23 SQL test files exercise RLS/permissions. |
| Backend deploy `44361095946` | Payment Edge Functions deployed; Deno tests pass |
| App publish `44365580862` / lane CI | `npx jest` runs in CI (`publish-app.yml:72`, `lane-ci.yml:100`) and passes |
| Main E2E `44365580570` | Web Playwright against the **DEMO** Supabase project with **demo payments** (`EXPO_PUBLIC_DEMO_PAYMENT=1`). It rendered 157 screens. **7 steps failed** (§6.2). |
| Razorpay check `43729959915` | **Failed**: the test-mode limit of 30 payment links was hit, and the check targets the old Payment Links API, not the Orders API now used |

**Not done, by instruction or because it was impossible here:**
- No app was run on a device.
- No live Razorpay, RazorpayX or SMS calls were made.
- No production data was touched.
- No destructive security tests were run.
- No real customers or providers were interviewed.

**All usability statements are code-based assessments.** Items marked NEEDS REAL USER VALIDATION require pilot users.

### 1.2 Status vocabulary and severity
- **PASS**: covered by a passing automated test, named in the appendix.
- **FAIL**: a test fails, or the code cannot work (lines cited).
- **PARTIAL**: works, but important parts are missing.
- **NOT IMPLEMENTED**: the functionality does not exist.
- **DEMO ONLY**: works only with demo data or demo payments.
- **BLOCKED**: cannot be verified here (credentials or live services).
- **NEEDS REAL USER VALIDATION**: technically works, but usability or business assumptions need real users.
- **UNTESTED**: the code looks correct, but no automated test covers it. This is never counted as PASS.

Severity follows the brief: **P0** financial, security, privacy, payout or duplicate-transaction risk · **P1** core workflow broken or billing confusion · **P2** friction · **P3** minor. Release gates: **G1** before pilot · **G2** before accepting real payments · **G3** before scaling · **Later**.

### 1.3 Claims verified by the lead auditor, and corrections

| Claim | Verified at | Result |
|---|---|---|
| Admin allowlist contains the E2E phone (WS8-01) | `supabase/migrations/0041_admin_support.sql:7` (`admin_phones = ["918888888888"]`); `e2e/web-smoke.mjs:13` (`OTP = '123456'`) | **Confirmed** |
| App sends the wrong key to `create-payment` for sports (WS4-01) | `app/src/features/sports/api.ts` sends `{ kind: 'sports', sportsBookingId }`; `supabase/functions/create-payment/logic.ts:52` requires `body.booking_id` | **Confirmed**: every in-app online sports payment returns HTTP 400 |
| Completed fixed-package jobs settle with 0 commission (WS6-01) | `0019_fixed_package_booking.sql:350` inserts `subtotal_labour=0, subtotal_other=v_service_total`; settlement commissionable = `q.subtotal_labour + q.subtotal_travel` (`0014_travel_requests.sql:659`) | **Confirmed** |
| Turning coin redemption off blocks quote approval (WS9-01) | The app always sends `useCoins` default `true` (`app/app/booking/[id].tsx:106,270`). `_apply_quote_coins` asserts the `coins_redemption` flag when `p_use_coins` is true (`0047_coins_config.sql:276-278`). | **Confirmed**, but it triggers only after an admin turns the flag off (seeded **on**). **Re-graded P0 → P1.** |
| "Jest did not run in either CI run" (WS7 scope note) | `publish-app.yml:72`, `lane-ci.yml:100` | **Corrected**: Jest runs in CI. WS7 features marked UNTESTED for this reason may be covered by Jest; see each Jest test name before relying on it. |
| Several "PASS" SQL suites load only early migrations (WS2, WS6) | stated by two independent workstreams | Treated as **PARTIAL** for latest-definition behaviour. Remediation WP-T2 in doc 17 fixes the test loaders. |

The other findings carry `path:line` evidence from their workstream. They were not individually re-verified by the lead auditor. Doc 17 requires every implementing agent to re-read the cited lines before changing them.

---

## 2. Executive verdict

**Can Nearo become a genuinely usable marketplace? Yes. The backend core is unusually strong for a prototype. It is not ready to take real money, and it is not ready for an unattended pilot.**

| Standard from the brief | Today |
|---|---|
| A customer can discover, understand the price, complete the transaction and understand the receipt | **Partly.** Discovery and booking work on demo data for home services. Prices are server-authoritative. Several screens **show the wrong amount** (coins double-subtracted, ₹29 fee omitted on fixed packages, fixed cancellation copy). Online sports payment **cannot be started from the app**. **No receipt exists anywhere.** |
| A provider can receive a request, fulfil it, bill correctly and understand earnings | **Partly.** Inspect-and-quote providers can do this end to end. Recurring-plan providers face raw timestamp entry, no visible earnings on plan requests, and visits that silently expire after the plan is accepted. Earnings are shown as "Billed / Fees / Net" with no statement. **Venue owners cannot see their payouts.** |
| An administrator can operate the marketplace, investigate issues and manage finances | **No.** There is no document-review screen, no refund/payout/transfer visibility on the admin booking view, and no reconciliation. Payout retry needs direct database access. The admin login is publicly known. |

**Strengths, all proven by passing SQL tests:**
- Integer-paise money everywhere.
- The server recomputes every chargeable amount; the client never sends an amount (WS6 §4).
- Inspect → quote → change order → payout is correct, including the documented ₹1,937.60 payout example.
- An auditable FIFO coin ledger with idempotent earning and clawback.
- Sports holds, expiry, double-booking prevention, wrong-amount refunds and notice-based refund tiers.
- Customer/provider data isolation on bookings, phones and payments.
- Server-side admin role checks with an audit log.
- A strong recurring-plan engine (tests RP-01 to RP-37).

**Readiness by area:**

| Area | Backend logic | App wiring | Customer comprehension | Provider comprehension | Gate blockers |
|---|---|---|---|---|---|
| Home services, one-time (inspect & quote) | Strong (PASS) | Works on demo | Fair: cancel copy is wrong for non-visit types | Fair | G2: payment races, second capture |
| Home services, fixed/session packages | Tested on older definitions | Profile "Book" routes to the wrong checkout (WS1-01) | Pay button omits the ₹29 fee | — | **G2: 0% commission** |
| Recurring plans | Strong (RP tests) | Web dialogs dead; no pay button on plan | No amounts on plan screen | Raw timestamp reschedule; no earnings | **G1: address leak; visits expire after acceptance** |
| Products & RFQ | Works; **no money flows** (by design) | Works | Misleading "lowest" badge; prices without units | No earnings or GST guidance | G1: verified shops go offline on any edit |
| Sports | Strong (PASS) | **Online pay broken (HTTP 400)** | Paid bookings shown as "Pay at venue" | No booking list; payouts invisible | **G2: venue never paid on late cancel; wrong status** |
| Creators / proposals | Mostly untested past acceptance | Delivered work not visible to the customer | Brief is a single text box | Revisions/deadline not agreed | **G2: non-payment and non-delivery traps; 0% commission** |
| Billing documents | — | — | **No receipt / invoice** | No statement | G2 |
| Coins | Strong ledger | Works | Caps hidden | — | G1: redemption switch blocks approvals |
| Notifications | Exists | Recurring deep links broken | Provider cancel → customer not told | No money notifications | G1 |
| Ops/admin | Role-checked, audit-logged | Missing doc review, money view | — | — | G1 (verification), G2 (money view) |
| Platform/security | RLS solid | — | — | — | **G1: public admin login, forgeable demo payments, single environment, no SMS provider** |

**Feature status totals (383 features across 9 workstreams):**

| PASS | FAIL | PARTIAL | NOT IMPL. | DEMO ONLY | BLOCKED | NEEDS USER VALID. | UNTESTED |
|---|---|---|---|---|---|---|---|
| 158 | 29 | 72 | 66 | 7 | 3 | 2 | 46 |

**Findings:** 227 raw findings (P0 16 · P1 73 · P2 107 · P3 31). They consolidate into **13 unique P0s** (§3.1) after merging duplicates found by more than one workstream and re-grading WS9-01.

---

## 3. Deliverable A — Functional audit summary

Full per-feature tables with evidence are in appendices WS1–WS9, section "Feature matrix". This section lists what blocks real use.

### 3.1 Unique P0 issues (all must be fixed before the gate shown)

| # | Issue | Source findings | Type | Gate | Evidence (summary) |
|---|---|---|---|---|---|
| P0-01 | **Publicly known admin login.** The admin allowlist includes the E2E phone, and the E2E OTP is in the public repo. | WS8-01 | Security | **G1** | `0041:7`, `e2e/web-smoke.mjs:13`. The E2E admin step reached the portal. |
| P0-02 | **Forgeable demo payments can flow into real payouts.** `demo_settle_payment` trusts user-editable `raw_user_meta_data.demo_only`. Demo-paid bookings are not excluded from payouts, and the default payout rail pays from the platform balance. | WS8-02, WS6-08 | Security / Financial | **G1** | Appendix WS6, WS8 |
| P0-03 | **One Supabase project serves CI deploys, E2E demo seeding (which enables demo payments and flags) and app builds**, with no approval gate | WS8-03 | Operational / Security | **G2** | `.github/workflows/*` secrets |
| P0-04 | **No SMS OTP provider configured.** Real users cannot log in. | WS7-17 | Functional | **G1** | Appendix WS7 |
| P0-05 | **0% commission and 0 GST on completed fixed packages, fixed recurring occurrences and creator proposals** (cancellations of the same jobs *are* commissioned) | WS6-01, WS5-03 | Financial | **G2** | `0019:350`, `0014:659`, `0040:349-352` |
| P0-06 | **Concurrent `verify-payment` + `order.paid` webhook can refund a valid payment** (home services, sessions, packs; sports already locks correctly) | WS6-02 | Financial | **G2** | Appendix WS6 |
| P0-07 | **A second capture on an already-paid home-service order overwrites the payment id and refunds the original obligation**, which later blocks the provider payout | WS6-03, WS8-05 | Financial | **G2** | `record_payment_paid` (latest `0029`) |
| P0-08 | **Provider can cancel any active booking, even fully paid or in progress, with reason `customer_payment_default` and no proof**, and keep 100% (visit) or 50% (fixed) | WS2-01 | Financial / Business logic | **G2** | `provider_cancel_booking` (latest def.) |
| P0-09 | **Customer full address and coordinates are visible to the provider business, including non-manager staff, before a recurring plan is accepted, and after it is declined** | WS2-08 | Privacy | **G1** | Appendix WS2 |
| P0-10 | **Creator flow: the customer can keep delivered work and never pay the balance.** The booking stalls in `completion_requested` and the advance stays held indefinitely. | WS5-01 | Financial / Business logic | **G2** | Appendix WS5 |
| P0-11 | **Creator flow: no exit if the creator never delivers.** `delivery_pending` can't be disputed or cancelled, and there is no delivery deadline. | WS5-02 | Business logic | **G2** | Appendix WS5 |
| P0-12 | **Sports lists show the wrong payment status.** Paid-online bookings show "Pay at venue" with a stale deadline, because the list RPC doesn't return payment fields. | WS4-02 | Wrong payment status | **G2** | `list_my_customer_sports_bookings` (`0053`) |
| P0-13 | **Sports: the venue never receives its retained share after a late customer cancellation.** Payouts are created only for completed bookings. | WS4-03 | Wrong payout | **G2** | `_create_sports_payout` (`0058`) |

### 3.2 Highest-impact P1 issues (selection; full list in appendices)

| Area | Issue | Source |
|---|---|---|
| Sports | In-app online payment sends `sportsBookingId`, but the server requires `booking_id` → HTTP 400 (**verified**) | WS4-01 |
| Sports | Owner can block a slot that a customer is paying for; payment then confirms inside the block | WS4 |
| Sports | With the `sports` flag off, customers cannot see or cancel existing bookings | WS4-05, WS8 |
| Home services | Provider-profile "Book" sends fixed/session services to the visit-fee checkout → server `upgrade_required` | WS1-01 |
| Home services | Accepting a recurring plan doesn't confirm paid visits; the 15-minute expiry cancels and refunds them | WS2-02 |
| Home services | Recurring visits are charged at the provider's *current* price, not the quoted price | WS2-05 |
| Home services | Skip/Pause/Resume/Cancel plan use a dialog that doesn't work on web | WS2-07 |
| Home services | Bookings can stay forever in quote-sent / awaiting-payment / on-the-way; no no-show path | WS2-11 |
| Home services | Cancel dialog shows fixed refund text, not the category's server policy; the tested `cancellation.ts` helper is unused | WS1-03/04, WS2-03 |
| Payments | Coin-funded bookings cannot be refunded on cancellation or admin full-refund dispute (assert rolls back) | WS6-04 |
| Payments | Rejected captures (unknown link / amount mismatch) are acknowledged with 200 and never refunded (home services) | WS6-05, WS8-06 |
| Payments | Refunds that fail 5 times, or succeed at Razorpay but fail to record, have no alert or reconciliation; no chargeback handling | WS6, WS8-07 |
| Payments | Hosted checkout defaults to a personal GitHub Pages domain | WS6 |
| Reliability | No server-side idempotency on booking/request creation (double tap → duplicates) | WS8-08 |
| Billing UI | QuoteView subtracts coins twice in "To pay now"; book screens hard-code ₹29; non-labour/part line kinds hidden | WS9-02/05, WS2-04 |
| Coins | Redeemed coins can be restored twice in a change-order-then-cancel path | WS9-04 |
| Creators | Delivered links not shown to the customer; copy says "auto-confirms in 24 hours" but the server uses 7 days; revisions default silently to 2 (docs say 1) | WS5 |
| Products | Any edit to a verified shop silently takes it and its catalogue offline (`save_shop` → `draft`) | WS3 |
| Products | "Lowest total" badge can go to a quote that omits items; size/delivery differences not flagged; GST always added | WS3 |
| Ops | Admin "Verify" makes a provider bookable without documents or payout account, and gateway KYC webhooks overwrite the same field | WS7 |
| Ops | No admin document-review screen, so categories that require documents can never go live | WS7 |
| Notifications | Provider cancel → customer gets no notification; a system cancel tells the provider "The customer cancelled."; recurring deep links go nowhere | WS7 |
| Ops | Push config lacks Expo projectId / Android FCM, so delivery on real phones is unproven | WS7 |
| Accounts | "Account deletion requested." shows as soon as the mail app opens | WS1-09 |

### 3.3 Not implemented (confirmed absent)

Guest browsing · account recovery path · customer reschedule (one-time) · edit/delete saved addresses · **payment receipts, tax invoices, commission statements, settlement statements** · referral, promotions, discounts · delivery fees · TDS/TCS · reconciliation and chargebacks · product variants · WhatsApp/call contact for shops · RFQ cancel and "you were not selected" · creator revision agreement, deliver-by date, structured brief · sports operator booking list and price-rule edit/delete · admin money view, payout retry UI and document review · provider money notifications · Telugu on provider screens and notifications · the **Nearo brand itself** (all copy says QuickServe).

---

## 4. Deliverable B — Customer experience report

Code-based assessment only; not real-user tested. Persona walkthroughs with quoted labels are in appendices WS1 §4 (first-time user, electrician), WS2 §4 (cook 3×/week, plumber bill), WS3 §4 (500 sq ft tiles, retail enquiry), WS4 §4 (badminton 2 h) and WS5 §4 (ten reels).

| # | Journey problem | Where a customer may abandon or misunderstand money | Recommendation | Pri |
|---|---|---|---|---|
| B1 | Must register before seeing anything | First launch → login wall; the OS location prompt also appears before login | Guest browsing (doc 14 G-01); ask for location in context | P1 |
| B2 | Book button from a package/session service fails with a server error | Provider profile → Book → `upgrade_required` | Route by archetype (WS1-T01) | P1 |
| B3 | Amount on screen ≠ amount charged | Fixed package Pay button excludes ₹29; QuoteView double-subtracts coins; recurring visit price drifts | Show the server-returned breakdown only (doc 16 §3) | P1 |
| B4 | No receipt | "Receipt" button opens the booking (`UnifiedActivityScreen.tsx:378-383`) | Platform payment receipt (doc 16 §6) | P1 |
| B5 | Tax never mentioned | "Is GST included?" unanswered | "Platform fee (incl. GST)" wording after CA review | P2 |
| B6 | Refund promise in the cancel dialog doesn't match policy | Cancel → generic visit-fee copy | Server-computed refund preview before confirming | P1 |
| B7 | Sports: paid booking shows "Pay at venue"; online pay fails | Checkout → error / misleading list | WS4-T01/T02 | P0/P1 |
| B8 | Creators: brief is one free-text box; delivered work not visible; asked to "Accept delivery" blind | Request → proposal → delivery | Structured brief, deliver-by, revisions, visible deliverables | P1 |
| B9 | RFQ comparison can mislead | "Lowest total" on incomplete quote; prices without unit | Complete-quote ranking + equivalence flags | P1 |
| B10 | Coins: caps hidden; "capped by QuickServe revenue" not understandable | Wallet | Show ₹/booking and monthly caps in plain words | P2 |
| B11 | Recurring plan screen shows no amounts and no Pay button; customer never told a visit needs payment | Plan → visits silently released 24 h before | Per-visit amount, Pay button, payment-due notification | P1 |
| B12 | Account deletion looks done when it isn't | Account → Delete | Truthful state + in-app request record | P1 |
| B13 | Plain-language errors missing (raw DB messages) | Any failure | `friendlyError` (doc 14 C-07) | P2 |
| B14 | No reschedule for one-time bookings | Must cancel and rebook | Reschedule request (P2; needs real user validation) | P2 |

**Unnecessary or confusing fields** (full tables in each appendix §5):
- Sports "From / Until" free text without a format hint.
- Specifications typed as JSON (shops and RFQ).
- The provider recurring reschedule asks for a raw ISO timestamp.
- "Advance (%)" without a "₹X now, ₹Y later" preview.
- Admin coin form in paise and basis points.

---

## 5. Deliverable C — Provider experience report

| # | Provider problem | Persona | Recommendation | Pri |
|---|---|---|---|---|
| C1 | Earnings show "Billed / Fees / Net" only. Commission and GST are merged, and the TDS/TCS mention is false (none is deducted). | Electrician | Provider earnings statement (doc 16 §7); remove the TDS/TCS line until implemented | P1 |
| C2 | Venue owners can't see payouts; failed payouts say "Retrying" but nothing retries | Venue operator | Show venue payouts; honest failed copy; admin retry (WS7-T05/T06) | P1 |
| C3 | Recurring plan request lacks per-visit earnings, area and instructions; reschedule needs a typed timestamp | Cook/cleaner | Show "You receive ₹X per visit"; date/time pickers (WS2-T09) | P1 |
| C4 | Accepting a plan doesn't confirm visits; they expire | Cook/cleaner | Auto-confirm paid visits on acceptance (WS2-T02) | P1 |
| C5 | No "Cannot attend" / "Customer not home" actions | Electrician, cook | Stuck-state timeouts + no-show paths (WS2-T11) | P1 |
| C6 | Shop edit silently delists a verified shop | Tiles shop | Keep live on non-identity edits (WS3-T01) | P1 |
| C7 | Supplier quote form doesn't show what the shop earns or how GST applies; specs typed as JSON | Tiles shop | Earnings preview, GST rule, schema fields (WS3-T04/T05) | P1 |
| C8 | Creator: revisions/deadline not agreed; payment default unusable after delivery | Video editor | Agreed revisions, deliver-by, unpaid-balance path (WS5-T01/T06/T07) | P0/P1 |
| C9 | Staff must be added by raw user ID | Shop / venue | Add staff by phone (WS7-T09) | P1 |
| C10 | Operators have no list of confirmed bookings; can't edit/delete price rules | Venue operator | WS4-T08/T09 | P1 |
| C11 | No money/verification/suspension notifications | All | WS7-T07 | P1 |
| C12 | English only on provider screens and notifications | All (limited tech familiarity) | Telugu for provider surfaces (WS7-T13) | P2 |
| C13 | Dashboard doesn't group "Needs action now / Today / Upcoming / Money" | All | Dashboard wording & grouping (WS7-T12) | P2 |
| C14 | No reply to reviews | All | WS7-T11 | P3 |

---

## 6. Deliverable E — Test matrix summary

The **complete matrix** (383 rows: feature, role, status, evidence, notes) is the "Feature matrix" section of each appendix. Regression tests to add are listed in each appendix's last section and consolidated per work package in doc 17. Below is the critical-path matrix: one row per brief scenario.

### 6.1 Critical-path scenarios

| # | Feature / scenario | Role | Expected | Actual (evidence) | Result | Sev |
|---|---|---|---|---|---|---|
| E1 | Server computes the authoritative payable amount | Customer | Client cannot alter amount | Client sends ids only; server recomputes; recorder rejects amount ≠ row (`create-payment/index.ts:41-81`, `0029:192`) | **PASS** (SQL) | — |
| E2 | Inspect → quote → approve → pay → complete → payout ₹1,937.60 | Cust/Prov | Matches doc 03 | `migration.test.mjs` "payout 1937.60" (early-migration loader) | **PARTIAL** (latest def. untested) | P1 |
| E3 | Fixed package completion commission | Provider/platform | ~15% commission | `0019:350` + `0014:659` → 0 | **FAIL** | P0 |
| E4 | Duplicate webhook (sequential) | System | No double record | Dedupe by `razorpay_payment_id` | **PASS** (SQL) | — |
| E5 | verify + webhook concurrently (home services) | System | One record, no refund | Race refunds the valid payment | **FAIL** (code) | P0 |
| E6 | Sports slot double booking | Customer | Impossible | Constraint/lock logic + tests (PGlite serial) | **PASS** (SQL); concurrency **UNTESTED** | — |
| E7 | Sports unpaid hold expiry | System | Released after window | cron every 5 min; tests | **PASS** (SQL) | — |
| E8 | Sports online payment from app | Customer | Payment link opens | HTTP 400 (`api.ts` vs `logic.ts:52`) | **FAIL** | P1 |
| E9 | Sports late-cancel venue share | Venue | Venue paid retained share | No payout created | **FAIL** | P0 |
| E10 | Payment failure does not confirm booking | Customer | Stays unpaid | `payment.failed` ignored; row stays `created`; sports wrong-amount refund tested | **PASS** (sports SQL) / **UNTESTED** (UX) | — |
| E11 | Customer cancellation refund matches policy | Customer | Server policy, shown before confirm | Server correct (SQL); UI copy hard-coded | **PARTIAL** | P1 |
| E12 | Cancellation with coins | Customer | Refund cash, restore coins | Assert rolls back | **FAIL** | P1 |
| E13 | Coin earn idempotent / clawback after refund | System | Once; proportional clawback | Tests "earn ledger ref is idempotent", clawback | **PASS** (SQL) | — |
| E14 | Receipt after payment | Customer | Downloadable receipt | Does not exist | **NOT IMPLEMENTED** | P1 |
| E15 | Provider earnings statement | Provider | Per-payout/monthly statement | List only | **NOT IMPLEMENTED** | P1 |
| E16 | Recurring plan: skip/pause/resume/cancel | Customer | Works on all platforms | SQL tested (RP-*); web dialog dead | **PASS** (SQL) / **FAIL** (web UI) | P1 |
| E17 | Recurring accept → visits confirmed | Provider | Confirmed | Re-expire after 15 min | **FAIL** | P1 |
| E18 | Creator non-payment after delivery | Creator | Path to collect or close | Stalls indefinitely | **FAIL** | P0 |
| E19 | RFQ quote comparison equivalence | Customer | Non-equivalent items flagged | Only brand/specs flagged | **PARTIAL** | P1 |
| E20 | Customer A cannot read customer B's booking/phone/payment | Security | Denied | RLS tests | **PASS** (SQL) | — |
| E21 | Provider cannot change price after acceptance without customer approval | Security | Change order required | Tested | **PASS** (SQL) | — |
| E22 | Non-admin cannot call admin RPCs | Security | Denied | Server role checks tested | **PASS** (SQL) | — |
| E23 | Admin identity not obtainable by outsiders | Security | Private | Public phone + OTP | **FAIL** | P0 |
| E24 | Double tap on "Book" | Customer | One booking | No idempotency key | **FAIL** (code) | P1 |
| E25 | Live Razorpay order/capture/refund/payout | System | Works in test mode | No passing CI evidence; check failed (`43729959915`) | **BLOCKED** | G2 |
| E26 | SMS OTP delivery | Customer | Real SMS | No provider configured | **BLOCKED / NOT IMPLEMENTED** | P0 |
| E27 | Push notification delivery on device | All | Delivered + deep link | Config incomplete | **BLOCKED** | P1 |
| E28 | Usability of every flow for the 11 personas | All | Completes unaided | Code-based assessment only | **NEEDS REAL USER VALIDATION** | — |

### 6.2 Current E2E failures (main run `44365580570`) with probable causes

| Step | Probable cause (from workstream analysis; the log lacks locator detail, so these are not confirmed) |
|---|---|
| `home`, `home-family-drilldown-and-marketplace-entry-points` | Test waits for "Home & vehicle services"; the app shows "Home services" when grouped home verticals exist (WS1) |
| `category-packers-movers`, `category-kitchen-cleaning` | Test's category list no longer matches the demo city's categories (WS1, WS2) |
| `phase-6-sports-booking-request` | Test clicks "Request booking"; the button is now "Send request" (WS4) |
| `my-activity-sports-segment` | Cascade: no sports booking was created ("cleanup removed 0") (WS4) |
| `assistant-draft-or-busy-fallback` | Assistant's own daily limit of 30 messages on the shared test user (HTTP 429), not Gemini (WS1) |

---

## 7. Owner decisions
Decided by the owner on 2026-11-18.

| # | Decision | Needed by | **Owner decision** |
|---|---|---|---|
| D1 | Commission per archetype and line kind | WP-F2 | **Doc 07 rates.** Fixed packages 15/13/12% by provider tier on package value **plus add-ons**. Proposals 8%, capped at ₹5,000. Parts/material stay non-commissionable. |
| D2 | Creator policies | WP-C1, WP-C2 | **72-hour acceptance window** after delivery, then auto-accept and final payment due (creator may mark payment default if unpaid). **1 revision by default** (creator may offer more in the proposal). **Deliver-by date required** on every proposal; if missed, the customer may cancel with the advance refunded. |
| D3 | Sports late-cancel kept amount | WP-S1 | **Venue receives the kept amount minus normal commission + GST.** The ₹5 customer fee is **non-refundable**. |
| D4 | GST/TDS/TCS and tax invoices | WP-F7, WP-B3 | **Non-tax receipts and provider statements now** (tax fields stored as 0; remove the false TDS/TCS copy). **CA review before live payments** (no advisor yet; the owner must engage one). Tax invoices after that review. |
| D5 | Production environment + SMS | WP-X2 | **SMS: MSG91** (DLT template registration required). **Separate production Supabase project: noted but deferred.** The owner wants to finish testing first; it must be re-decided before live payments (G2). |
| D6 | Rebrand to Nearo | WP-U4 | **Brand constant now; full copy sweep before the pilot.** Coin name to be decided at rebrand time (currently "Seva Coins"). |
| D7 | Products/RFQ payments | — | **Enquiry-only for the pilot.** Every quote states "Pay the shop directly. Nearo charges no commission." Revisit after the pilot. |