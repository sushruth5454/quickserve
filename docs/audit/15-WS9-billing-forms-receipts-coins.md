# Nearo audit appendix WS9 — Billing forms, receipts/invoices & coins

> Part of [docs/15](../15-Nearo-Functional-Audit-Report.md). Code-based audit of `main` @ `bfa999f` (2026-11-18), produced by a read-only audit agent and spot-checked by the lead auditor (see doc 15 §1.3 for verified claims and corrections). Status vocabulary and severity scale: doc 15 §1.2. Nothing in this file was tested on a real device or with real users.


Read-only audit of `` at `main @ bfa999f`. No repo files were changed.

## Scope & method

**In scope:** every billing-related form (provider quote editor, customer quote view, price rows, book/checkout price sections, provider payout/bank form, GST fields, RFQ supplier quote, proposal price form, sports pricing, admin coins form); every customer/provider money document (receipt, invoice, statement); customer and provider understanding of billing; Seva Coins (earning, bonus, redemption, limits, expiry, reversal, balance, history, admin).
**Out of scope (WS6):** whether the core payment, refund, payout and commission maths is correct. Amounts are mentioned here only where a form or document displays them.

**Method**
1. Read the latest `create or replace` of every coin function. Coin functions are defined only in `0015_seva_coins.sql` and `0047_coins_config.sql`; `0043_commission_config.sql:219` later overrides `_coin_platform_cap`. Also read `_net_paid` (`0002_qa_fixes.sql:7`), `_queue_refund`/`_refund_partial`/`_allocate_payout` (`0001_init.sql:536-705`), `prepare_payment` (`0029_single_due_payment.sql:103`), `send_quote` (latest at `0052_merchant_staff.sql:925`), RFQ quoting (`0050_rfq.sql`) and the sports payout (`0058_sports_payments.sql:1618`).
2. Read the app screens and components listed in each section, and quote the UI copy exactly.
3. Searched the app and `supabase/` for `receipt|invoice|statement|gstin|pdf|tds|tcs|referral|promo|coupon|voucher|cashback`.
4. CI evidence used:
   - Backend deploy run **44358292571**: all SQL checks passed. The log shows `PASS node coins_config.test.mjs` ("Coins config SQL checks passed") and `PASS node seva_coins.test.mjs` ("Seva Coins SQL checks passed").
   - Jest, from run **44365580862** ("Publish app to Expo Go", SHA 2c59548, step "Typecheck and unit tests"): `Test Suites: 27 passed`, `Tests: 246 passed`, including `coins.test.ts`, `money.test.ts` and `onboarding.test.ts`. I confirmed this with `gh run view --log`.
   - E2E run **44365580570**: web build, DEMO project, demo payments. The steps `coins-wallet`, `earnings`, `quote-editor-fb4`, `quote-editor-rate-card-pick`, `dark-booking-quote`, `new-pro-payouts`, `archetype-inspect-quote-browse-and-quote`, `archetype-fixed-package-book-mocked-payment`, `proposal-flow-accept-and-checkout` and `phase-7a-rfq-create-and-details` passed. None of the 7 failed steps is in WS9 scope.
5. **How statuses are assigned.**
   - **PASS:** a passing automated test asserts the behaviour (the test is named).
   - **DEMO ONLY:** the screen was only *rendered* by the demo-mode E2E. That run checks visibility, not amounts, and never uses the real backend.
   - **UNTESTED:** the code looks right but no automated test covers it.
   - Tax and invoicing points are listed as considerations and **require professional tax/legal review**. They are not legal conclusions.

## Feature matrix

| ID | Feature | Role | Status | Evidence | Notes |
|---|---|---|---|---|---|
| WS9-F01 | Coin balance derived from an append-only ledger (lots + FIFO) | Customer | PASS | `0015:24-48` `coin_ledger`, `0015:74-104` `_coin_lots/_coin_balance`; SQL test `seva_coins.test.mjs` "FIFO spends the oldest coin lot first", "coin balance is integer paise (₹50)" (run 44358292571) | `coin_accounts` stores only `clawback_due`. The balance is never a mutable number. |
| WS9-F02 | Clients cannot write to the ledger; history is scoped to the owner | Customer | PASS | `0015:52-58`; tests "clients cannot insert ledger rows", "another customer cannot read coin history", "balance view is scoped to the caller" | |
| WS9-F03 | Earning on completed→closed (1%, ₹20 per-booking cap, monthly cap, pilot budget) | Customer | PASS | `0047:356-489` `_credit_booking_coins`; tests "configured 1% earning is capped at ₹20 and adds the first-booking ₹10 bonus", "exhausted issuance budget leaves the booking with no earn or bonus ledger rows" | The budget check has a concurrency gap (WS9-15). |
| WS9-F04 | Earning is idempotent per booking | Customer | PASS | unique `ref` (`0015:31`), `earn:`/`bonus:` refs (`0047:381-389`); test "earn ledger ref is idempotent" | |
| WS9-F05 | First-transaction bonus | Customer | PASS | `0047:403-409`; coins_config test (line 238) | Granted on the first booking that *earns*, not the first booking ever. |
| WS9-F06 | Referral rewards | Both | NOT IMPLEMENTED | search for `referr|referral|invite code` in app + supabase: no hits | |
| WS9-F07 | Repeat-booking and cross-category promotions, promo codes, coupons, cashback | Customer | NOT IMPLEMENTED | search `promo|coupon|voucher|cashback`: no hits | |
| WS9-F08 | Redemption on inspect-and-quote approval (10% cap, capped by platform revenue) | Customer | PASS (server) | `0047:252-354` `_apply_quote_coins`; tests "quote approval applies the server-computed redemption cap", "redemption cap is the lower of 10% and net platform revenue…" | Only `approve_quote_with_coins` redeems. Fixed, proposal, time-based, sports and RFQ cannot redeem. |
| WS9-F09 | Redemption switch (`coins_redemption`) enforced on the server | Admin | PASS (server) / FAIL (app) | test "server refuses redemption while coins_redemption is off"; app always sends `p_use_coins=true` (`booking/[id].tsx:106,270`) | **With the switch OFF, every quote approval fails** (WS9-01). |
| WS9-F10 | Clawback of earned coins after a refund | Customer | PASS | `0047:492-565`; tests "₹50 refund removes 1 whole earned coin", "refund clawback never makes balance negative" | Recovery of `clawback_due` debt from later earnings is UNTESTED. |
| WS9-F11 | Restore redeemed coins on cancel/decline/expiry/full refund | Customer | UNTESTED | `0047:567-602`, trigger `0015:566-583` | Can credit twice (WS9-04). No test exists. |
| WS9-F12 | Expiry job (six months, configurable) | System | PASS | `0047:604-650`; tests "daily expiry writes a balancing expire entry", "new coin lots use the configured two-month expiry" | Admin can set `expiry_months` = 0 (WS9-14). |
| WS9-F13 | Admin coins config + summary + feature switches (audited) | Admin | PASS (server) / DEMO ONLY (UI) | `0047:79-205`; tests "coins configuration changes require an admin", "admin summary reports…"; `admin/coins.tsx` | No admin lookup or adjustment of a single user's ledger in the app (WS9-14). |
| WS9-F14 | Admin manual adjustment (audited) | Admin | PASS (RPC) / NOT IMPLEMENTED (UI) | `0047:652-693`; test "admin adjustments are audited" | `admin_adjust_coins` is not called anywhere in `app/`. |
| WS9-F15 | Customer wallet screen (balance, rules, history) | Customer | DEMO ONLY | `app/app/coins.tsx`; E2E `coins-wallet` (render only) | Rules shown are incomplete and use jargon (WS9-16). |
| WS9-F16 | "Coins earned" banner on booking detail | Customer | UNTESTED | `booking/[id].tsx:580-590` | Calculated on the client and can be wrong (WS9-05). |
| WS9-F17 | Provider quote editor with live "You receive" | Provider | PASS (maths) / DEMO ONLY (UI) | `quote/[bookingId].tsx`; Jest `money.test.ts` worked example; E2E `quote-editor-fb4`, `quote-editor-rate-card-pick` | Bill photo is not enforced on the server (WS9-08). |
| WS9-F18 | Customer quote view / price breakdown | Customer | DEMO ONLY | `QuoteView.tsx`; E2E `dark-booking-quote` (render) | Coins are subtracted twice (WS9-02). Non-labour/part/other items are hidden (WS9-07). |
| WS9-F19 | Booking-detail payments list | Customer/Provider | UNTESTED | `booking/[id].tsx:726-762` | No partial refunds, no payment method, no receipt (WS9-06). |
| WS9-F20 | Payment receipt (customer) | Customer | NOT IMPLEMENTED | no receipt/invoice table, RPC or screen. The "Receipt" button only opens the booking (`UnifiedActivityScreen.tsx:378-383`) | |
| WS9-F21 | Tax invoice (provider→customer or platform→customer) | Both | NOT IMPLEMENTED | no `invoice_number`, sequence or GST fields on `payments` (`0001:200-214`); PRD PAY5 requires it (`docs/01-PRD.md:110`) | Requires professional tax/legal review. |
| WS9-F22 | Commission tax invoice / platform-fee statement to provider | Provider | NOT IMPLEMENTED | `payouts` has gross/commission/gst only (`0001:234-246`) | Requires professional tax/legal review. |
| WS9-F23 | Provider earnings screen | Provider | DEMO ONLY | `(provider)/earnings.tsx`; E2E `earnings` (waits for "% commission") | No statement, no download, TDS/TCS not modelled (WS9-10). |
| WS9-F24 | Sports venue-owner earnings/payout view | Venue owner | NOT IMPLEMENTED | sports payouts are stored with `provider_id null, payee_id=owner` (`0058:1618+`); `listMyPayouts` filters `provider_id = uid` (`supabaseApi.ts:744-749`); no `payee_id` use in `app/` | |
| WS9-F25 | Provider payout/bank form | Provider | PASS (client validation) / DEMO ONLY (UI) | `validatePayoutForm` Jest "payout form mirrors the Edge Function rules"; E2E `new-pro-payouts` (gateway "temporarily unavailable") | PAN accepts individuals only (WS9-13). |
| WS9-F26 | Provider/business GSTIN and customer B2B GSTIN | Both | NOT IMPLEMENTED (services) / PARTIAL (shops: optional GSTIN) | `merchant-shop.tsx:358`, `0049:51,310` (regex only) | |
| WS9-F27 | RFQ supplier quote with per-line GST | Merchant | UNTESTED (UI) / DEMO ONLY (create step only) | `rfq/merchant/[id].tsx:24,181-204`; `0050:492-514` | A shop can charge GST without a GSTIN (WS9-12). |
| WS9-F28 | Proposal price form | Provider | DEMO ONLY | `proposal/compose/[requestId].tsx`; E2E `proposal-flow-*` | One line only. No "you receive" (WS9-23). |
| WS9-F29 | Sports price rules | Venue owner | UNTESTED (UI) | `sports/manage.tsx:644-665` | Add-only list (WS9-24). |
| WS9-F30 | Money notifications (payment received, refund done, payout sent) | Both | NOT IMPLEMENTED | none found in migrations (search of notification copy) | |
| WS9-F31 | Coin restore/redemption on fixed/proposal/sports | Customer | NOT IMPLEMENTED | redemption is only in `_apply_quote_coins` | This is a product decision; it is not explained to users. |

## Findings

| ID | Title | Type | Severity | Gate | Evidence | Recommendation |
|---|---|---|---|---|---|---|
| WS9-01 | **Turning off coin redemption blocks all quote approvals.** The app always sends `p_use_coins=true`, even when no coin toggle is shown. The server then raises "Coins can't be used right now." | Technical defect | P0 | before pilot | `booking/[id].tsx:106` `useState(true)`; `:270` `api.approveQuote(booking.id, quote.id, useCoins)`; the coin card only renders when `maximum_paise > 0` (`:531`); server `0047:268-270` asserts the flag whenever `p_use_coins` is true. coins_config test "server refuses redemption…" proves the server behaviour; no client test. | Client: send `useCoins && (coinPreview?.maximum_paise ?? 0) > 0`. Server: when the flag is off, treat `p_use_coins` as false (return 0) instead of raising, so approval and payment keep working (repo rule 6). |
| WS9-02 | **Quote view subtracts coins twice in "To pay now".** `total` already removes `coinDiscount`, and `due = total − alreadyPaid`, where `alreadyPaid` includes the coin payment row. After coin approval the card shows a lower amount than the footer "Balance due" and the gateway charge. | Technical defect | P1 | before pilot | `QuoteView.tsx:66-70` (`due = Math.max(0, total - alreadyPaid)`; `cashPaid` is computed but unused for `due`); `paid` includes all paid rows (`booking/[id].tsx:230-232`); server due = `_required_total − _net_paid` (`0029:136`, `0002:7-17`). | Use `due = max(0, total − cashPaid)`. Add a Jest render test. |
| WS9-03 | **Coin toggle and discount shown on change orders that cannot redeem.** The preview offers `maximum_paise` from the current balance even when the booking already has a redemption. The server never redeems a second time, so the footer due is too low by up to the preview amount. | Technical defect | P1 | before pilot | preview `0047:209-249` ignores `v_existing` when computing `maximum_paise`; `_apply_quote_coins` with `v_existing > 0` keeps the existing amount (`0047:284-306`); footer `booking/[id].tsx:331-336`. | Server preview: when `b.coin_discount > 0`, return `maximum_paise = applied_paise` and `can_redeem=false`. Client: hide the toggle when `can_redeem` is false. |
| WS9-04 | **Redeemed coins can be restored twice.** If a change order cuts the redemption to 0, the code restores `v_existing` (`restore:` ref) and marks the coin payment `failed`, but leaves `payments.amount` unchanged. A later cancel/refund then restores `p.amount` again: `_restore_coins_for_terminal_booking` picks the latest coin payment whatever its status. Re-redeeming on the same booking also fails: the failed row still holds the unique coin-payment index, and `_spend_coin_lots` treats the `redeem:<booking>` prefix as already spent. | Technical defect (duplicate credit) | P1 (narrow trigger: needs `redeem_cap_bp`/platform cap → 0, e.g. admin sets cap 0) | before accepting real payments | `0047:284-306`, `0047:567-602` (no `status='paid'` filter), `0015:15-16` unique index, `0015:162-168` prefix idempotency. No test. | In terminal restore, restore only `status='paid'` coin payments. In the change-order path, set `amount` to the remaining value or delete the coin payment. Add SQL tests (WS9-T03). |
| WS9-05 | **The "coins earned" banner is calculated on the client and can be wrong.** It uses built-in default config. It ignores the earning switch, first-booking bonus, monthly cap and budget. It says "added to your wallet" even when nothing was credited, and it shows "₹0 Seva Coins". | UX / Technical defect | P2 | before pilot | `booking/[id].tsx:580-590` (`earnedCoinPaise({...})` without config; text "`Seva Coins ${s === 'closed' ? 'added to your wallet' : 'will be added after the 24-hour dispute window'}`"); server truth is `coin_ledger` rows with `booking_id`. | Read the actual ledger rows for the booking (`coin_ledger where booking_id = …`). Before close, show "You'll earn about N coins" only when `coins_earning_enabled`. Hide when 0. |
| WS9-06 | **The payments list is not a receipt.** Partial refunds are not shown (row stays "Paid" at full amount). Abandoned or retired links appear as red "Failed" rows. Restored coins appear as "Seva Coins … Failed". Advance, platform fee and milestones all show as "Job payment". There is no payment method, no reference and no refund date. | UX | P2 | before pilot | `booking/[id].tsx:74-81, 726-762`; `refunds` rows are fetched (`:232`) but never listed; retire logic sets `failed` (`0029:83-88`); restore sets coin payment `failed` (`0047:587`). | Hide `failed` rows that have `cancel_link_pending` or `funding_source='coins'`. Render refunds as child lines. Label rows by purpose. Add "View receipt" (WS9-T06). |
| WS9-07 | **Quote view hides line items whose kind is not labour/part/other.** Fixed-package, proposal, time-based and add-on scopes (kinds `package`, `addon`, `per_unit`, `material`, `rental`, `travel`, `discount`) show "N items" and a Subtotal with no item lines. | Technical defect / UX | P1 | before pilot | `QuoteView.tsx:74-76` (only `['labour','part','other']`); items copied with their kind in `0019:550-551`, `0023:720-721`; proposal form sends `kind:'package'` (`proposal/compose/[requestId].tsx:29`); booking detail shows `approvedQuote` for every archetype (`booking/[id].tsx:713-717`). | Group over all `QuoteItemKind` values using `groupLabel`. Show discounts as negative lines. |
| WS9-08 | **Provider billing rules are only enforced in the client.** The "Parts above ₹500 need a bill photo" warning never blocks sending, and the server does not check it. The server books every kind other than labour/part as commission-free `other`, while the client preview counts `package/per_unit/addon/travel` as labour, so "You receive" can differ from the real payout. A `discount` line *adds* to the total on the server. Labour can be relabelled as Part/Other to avoid commission. | Business logic | P2 | before accepting real payments | `quote/[bookingId].tsx:82,331,439-455` (warning only); `send_quote` `0052:973-980` (`else v_other`, `v_price >= 0`, no bill check); `money.ts:87`. | Server: reject parts lines > ₹500 without `bill_photo_url`; only allow `labour|part|other` in `send_quote`; flag quotes where parts+other exceed X% for admin review. |
| WS9-09 | **Book screens hard-code the ₹29 platform fee.** The server value is configurable for fixed bookings, so the "Pay ₹X & book" button can differ from the gateway amount. | Technical defect | P1 | before accepting real payments | `book-fixed/[providerServiceId].tsx:61` (`const platformFee = 2900`), `:115,178-179`; `book/[providerServiceId].tsx:23,580` (`PLATFORM_FEE_PAISE`); server `0019:6,292` reads `app_config.fixed_booking.platform_fee_paise`. | Get the price breakdown from a server preview RPC (`get_booking_price_preview`) and show only server numbers. |
| WS9-10 | **The provider earnings screen is not a statement.** Commission and GST are merged into "Fees". Copy mentions "statutory TDS/TCS", but no deduction exists anywhere. `partially_reversed` is counted in full. `failed` is counted as "Pending". There is no per-period statement, no export, no refund/adjustment lines and no UTR/transfer reference. | UX / Unvalidated business assumption | P1 | before accepting real payments | `earnings.tsx:99,125,127,268-270,310`; `quote/[bookingId].tsx:474` "Paid to your bank 24 hours after completion, before statutory TDS/TCS."; no `tds|tcs` column/function in `supabase/` (search); `payouts` columns `0001:234-246`. | Add a statement view (WS9-T08). Split commission and GST. Show reversals. Remove the TDS/TCS wording or implement it after CA review. |
| WS9-11 | **No tax documents at all:** no payment receipt, tax invoice or commission invoice; no invoice numbering, GSTIN, HSN/SAC or place of supply. The PRD makes them mandatory and docs flag a CA gate. | Unvalidated business assumption (compliance) | P1 | before accepting real payments | `docs/01-PRD.md:110` (PAY5), `docs/05-…:72`, `docs/03-…:57,66,134`; no tables or RPCs found (search). | Build platform-issued payment receipts first (WS9-T06), then CA-approved tax invoices (WS9-T07). **Requires professional tax/legal review.** |
| WS9-12 | **RFQ: any shop can add GST (default 18%) to a quote without a GSTIN.** GSTIN is checked only by regex (`^[0-9A-Z]{15}$`). There is no HSN, no GST on the delivery charge, and no supplier GSTIN on the quote. | Unvalidated business assumption | P2 | before scaling (RFQ currently takes no payment: `rfq/[id].tsx:56,145`) | `rfq/merchant/[id].tsx:24,58,186-191`; `0050:492-514`; `0049:51,310`. | Force GST rate 0 unless `shops.gstin` is set and verified. Show the GSTIN on the quote. **Requires professional tax/legal review.** |
| WS9-13 | **The payout form only accepts individual PANs** (4th letter P). Shops, venues and firms with company/firm PANs cannot onboard. "Re-enter account number" is not masked while the first field is. | Business logic / UX | P2 | before scaling | `onboarding/validation.ts` `validatePayoutForm` (message "Enter a valid individual PAN… (4th letter is P)"); `PayoutSection.tsx:143-159`. | Add an "Account type: Individual / Business" choice. For Business, allow PAN types C/F/H/A/T and require a legal business name. Mask both fields or neither. |
| WS9-14 | **Coins admin gaps.** No per-user ledger viewer or adjust UI (`admin_adjust_coins` is unused in the app). System restores are written as `kind='admin'` with `created_by null`, so they look like manual adjustments. `admin_coin_summary` "issued"/budget ignores admin credits and restores, and does not net clawbacks. `expiry_months=0` and unbounded caps are accepted. Both switches default ON. | Business logic | P2 | before pilot | `0047:79-152` (no range check on expiry/caps), `0047:169-206`, `0047:567-602`, `0015:271-275`; `admin/coins.tsx:40-64,192-199`; flags `0047:19-22`. | Add kinds `restore`/`system` (migration). Add admin RPCs `admin_list_coin_ledger(user)` and a UI. Bound `expiry_months` to 1–24. Count all credits in liability/budget. |
| WS9-15 | **Pilot budget and monthly cap can be overshot under concurrency.** The global budget sum is read with only a per-user lock. | Technical defect | P2 | before scaling | `0047:419-428` (sum without a global lock; `_lock_coin_account` is per user). | Take `pg_advisory_xact_lock(hashtext('coins_budget'))` before the budget read. |
| WS9-16 | **Coin rules are unclear.** The wallet hides the per-booking cap (₹20), first-booking bonus (₹10), monthly cap (₹1,000) and which booking types can redeem. "capped by QuickServe revenue" is jargon. Internal reasons are shown to customers ("configured rate applied to eligible in-app paid service value"). History does not link to the booking and is limited to 50 rows. The old brand appears ("QuickServe", "Funded by QuickServe"). | UX | P2 | before pilot | `coins.tsx:74-82,119,125-127`; `0047:452,465`; `supabaseApi.ts:653-661`; `QuoteView.tsx:135`. | Rewrite the copy (WS9-T10). Map `kind`/ref to customer text. Link to the booking. Paginate. |
| WS9-17 | **Coins only partly cover the marketplace.** Redemption works only on inspect-and-quote; fixed, proposal, time-based, sports and RFQ cannot redeem. Sports bookings never earn (separate table). There are no referral, repeat or cross-category promotions. | Unvalidated business assumption | P3 | later | WS9-F08, F06, F07, F31. | Product decision. Document it in the wallet ("Use coins on inspection bookings"). |
| WS9-18 | **The coin-earn trigger can block the payout close.** `_credit_booking_coins` raises if the booking has no approved quote, and it runs inside the completed→closed update made by the payout transfer job. No test covers all archetypes. | Technical defect (risk) | P2 | before accepting real payments | `0047:385` `perform public._assert(found and …)` after `select … from quotes where id = b.approved_quote_id`; trigger `0015:433-449`; close in `0001:1695`. | Return 0 instead of raising when the quote is missing. Add an SQL test that closes each archetype. |
| WS9-19 | **Partial refunds never return redeemed coins.** `_refund_partial` only touches gateway-backed payments, and coin restore only happens on terminal status. This policy is not written down or shown to users. | Unvalidated business assumption | P2 | before pilot | `0001:691-705` (`razorpay_payment_id is not null`), `0015:566-583`. | Get an owner decision. Show it in the refund copy. |
| WS9-20 | **The "Receipt" button is misleading.** It only opens booking details. | UX | P2 | before pilot | `UnifiedActivityScreen.tsx:378-383`. | Rename it to "Details" until WS9-T06 ships, then link to the receipt. |
| WS9-21 | **No money notifications**: payment received, refund processed, payout transferred/failed. | UX | P2 | before accepting real payments | search of migration notification copy found only "Your visit fee is being refunded." (`0007:355,359`). | Emit notifications from `record_payment_paid`, `complete_refund` and payout transfer completion. |
| WS9-22 | **Proposal price form is too thin.** One package line only. Advance is a free-text %. Validity is fixed at 7 days. There is no platform-fee or commission preview and no "You receive". | UX | P2 | before scaling | `proposal/compose/[requestId].tsx:13-37,48-56`. | Add the same breakdown component as the quote editor. Use advance chips (0/25/30/50%). |
| WS9-23 | **Checkout uses a personal GitHub Pages URL and old brand text.** The default hosted checkout is `sushruth5454.github.io/quickserve/checkout/`, and the Razorpay description reads "QuickServe job payment". Both hurt trust and comprehension (security is cross-referenced to WS6/security). | UX / Security (cross-ref) | P1 | before accepting real payments | `supabase/functions/create-payment/index.ts:114,129-133`. | Require `CHECKOUT_PAGE_URL` (no default) on a Nearo domain. Use descriptions with the booking ref ("Nearo · QS-XXXX · Visit fee"). |
| WS9-24 | **Sports pricing UX is weak.** Price rules can only be added (none edited or deleted in the UI). Times are free text. There is no net-of-commission preview. Checkout labels the fee "Customer fee". | UX | P3 | before scaling | `sports/manage.tsx:644-665`; `sports-checkout/[id].tsx:116-128`. | Add edit/delete, time pickers and "You receive". Rename to "Booking fee". |
| WS9-25 | **Activity-list "Total" uses gross `total_amount`**, ignoring coin discounts and refunds. | UX | P3 | later | `UnifiedActivityScreen.tsx` `AmountRow` (`b.total_amount ?? b.visit_fee`). | Show "Paid ₹X" from net payments. |

## Billing form field audit

Legend for **verdict**: KEEP · FIX (keep, change label/validation) · MOVE · MERGE · REMOVE · ADD (missing field).

### A. Provider quote editor — `app/app/quote/[bookingId].tsx`

| Field | Purpose | Who needs it | Mandatory? | Label understandable? | Right section? | Auto-fill? | Simpler alternative? | Validated? | Duplicate elsewhere? | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| Item type (segmented "Labour / Part / Other") | Decides whether commission applies | Provider, platform | Yes | Partly. The commission impact shows below: "`12% commission applies`" / "`No commission · passed through at cost`" | Yes | Rate-card chips add Labour | Hide the type for rate-card items | Client: none. Server: enum only (`0052:973-980`) | Line kind is also in proposal/fixed items | FIX. Server rule for unsupported kinds; risk of misclassification (WS9-08) |
| Description | What the customer is paying for | Customer | Yes | No visible label, only a placeholder ("e.g. Gas refill, wiring work"); label exists only for accessibility | Yes | Rate-card title; previous quote lines | — | Client "Add a description"; server non-empty | — | FIX. Add a visible label "What is this for?" |
| Qty (stepper 1–100) | Quantity | Customer | Yes | "Qty" (OK) | Yes | 1 | — | Client 1–100 integer; server `0 < qty ≤ 1000` | — | FIX. Add a unit (job/hour/m/pc). Align the limits |
| Unit price (₹) | Price per unit | Customer | Yes | "Unit price" (OK) | Yes | Rate card | — | Client strips non-digits/dots; NaN → "Enter a price"; no max. Server 0–₹1,00,000 | — | FIX. Add a client max and a 2-decimal limit |
| Bill photo (parts > ₹500) | Proves parts cost | Customer, disputes | Should be | "Parts above ₹500 need a bill photo so the customer can trust the price." | Yes | — | — | **Warning only; not enforced on client or server** | Customer sees "Bill photo attached" | FIX (WS9-08) |
| Note for the customer (optional) | Explains the findings | Customer | No | Yes | Yes | — | — | maxLength 500 | — | KEEP |
| Add from my rate card (chips) | Speed, consistency | Provider | No | "Add from my rate card" | Yes | Is itself auto-fill | — | n/a | Rate card is managed in services | KEEP |
| Footer: "Quote total", "Fees · {pct}% of labour + GST", "You receive" | Provider economics | Provider | Read-only | Good | Yes | Server commission rate (`getBookingCommissionRate`) | — | Send is blocked if rate is unavailable | Same as Breakdown card | MERGE. Keep the footer; drop the repeated block below or collapse it |
| Breakdown: "Labour", "Parts", "Other, including travel", "Customer pays" (hint "Incl. ₹29 platform fee; ₹X visit fee already paid"), "Commission (12% of labour)", "GST on commission (18%)", "You receive" | Transparency | Provider | Read-only | "Customer pays … visit fee already paid" is ambiguous: the amount *includes* the visit fee | Yes | — | — | — | Footer | FIX copy: "Customer's total ₹X (₹Y already paid as visit fee, ₹Z due now)" |
| Missing: GST on service (if the provider is GST-registered), HSN/SAC | Tax | Provider, customer | Depends on CA matrix | — | — | From provider tax profile | — | — | — | ADD after CA review |

### B. Customer quote view — `app/src/components/QuoteView.tsx` (+ `ui/PriceRow.tsx`, `PriceBreakdown`)

| Field / row | Purpose | Who needs it | Mandatory? | Label (quoted) | Right section? | Auto-fill? | Simpler alternative? | Validated? | Duplicate? | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| Item groups | Itemisation | Customer | Yes | "Labour", "Parts", "Other charges" | Yes | — | — | **Only 3 kinds are rendered** | — | FIX (WS9-07) |
| "Subtotal" | Service value | Customer | Yes | OK | Yes | — | — | — | — | KEEP |
| "Platform fee" | Platform charge | Customer | Yes | Does not say "incl. GST" though docs say GST-inclusive (`docs/03:57`) | Yes | — | — | — | Book screen | FIX → "Platform fee (incl. GST)" *pending CA review* |
| "Minimum visit charge" | Shown when visit fee > subtotal | Customer | Conditional | Understandable | Yes | — | — | — | — | KEEP |
| "Seva Coins" (hint "Funded by QuickServe") | Discount | Customer | Conditional | Old brand | Yes | Preview from server | — | — | Booking toggle card | FIX brand → "Funded by Nearo" |
| "Total" / "Total after coins" | Total | Customer | Yes | OK | Yes | — | — | — | — | KEEP |
| "Paid so far (incl. visit fee)" | Prior payments | Customer | Conditional | Wrong for proposal/fixed (no visit fee) | Yes | — | — | — | — | FIX → "Already paid" |
| "To pay now" / "Extra to pay now" | Due now | Customer | Yes | OK | Yes | — | — | **Wrong when coins were used (WS9-02)** | Footer "Balance due"/"To pay now" | FIX |
| Typical-range alert | Price trust | Customer | No | "This is higher than the usual ₹A–₹B… Ask your provider why before approving." | Yes | Static ranges | — | — | — | KEEP |
| `PriceRow` / `PriceBreakdown` | Shared row primitive | All | — | Negative values shown as "−₹199", accessible label | — | — | — | — | — | KEEP. Make it the only breakdown primitive used by book, fixed and sports screens |

### C. Booking-detail coin toggle — `app/app/booking/[id].tsx:531-563`

| Field | Purpose | Who | Mandatory? | Label | Right section? | Auto-fill? | Simpler? | Validated? | Duplicate? | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| "Use N coins · ₹X" switch (default ON), "Wallet: N coins · ₹Y" | Opt in to redemption | Customer | No | Clear | Yes (above the quote) | Server preview | — | Server caps | QuoteView row | FIX: the default ON state is also sent when the card is hidden (WS9-01); hide on change orders (WS9-03) |

### D. Book screens' price sections

| Screen / field | Purpose | Who | Mandatory? | Label (quoted) | Right section? | Auto-fill? | Simpler? | Validated? | Duplicate? | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| `book/[providerServiceId].tsx:577` "Visit / inspection fee", hint "Adjusted in your final bill" | Upfront fee | Customer | Yes | Mostly. "Adjusted" is vague | Yes | Service visit fee | "Counts towards your final bill" | Server | Footer button "Pay ₹X & book" | FIX copy |
| `:578-583` "Platform fee", hint "Added to the final bill — not charged now" | Disclosure | Customer | Yes | Clear | Yes | **Client constant `PLATFORM_FEE_PAISE`** | — | — | QuoteView | FIX: source from server (WS9-09) |
| `:585` "To pay now" | Due | Customer | Yes | Clear | Yes | = visit fee | — | — | Footer | KEEP |
| `book-fixed/[providerServiceId].tsx:177-179` "Package", "Platform fee: ₹29 (charged once)", "Total" | Fixed price | Customer | Yes | Clear | Yes | **Hard-coded 2900** | — | Server recalculates | Button "Pay ₹X & book" | FIX (WS9-09) |
| `sports-checkout/[id].tsx:116-128` "Price", "Customer fee", "Total" | Slot price | Customer | Yes | "Customer fee" is jargon | Yes | Server | "Booking fee" | Server | Pay button | FIX copy |

### E. Provider payout / bank form — `app/src/features/providerOnboarding/PayoutSection.tsx`

| Field | Purpose | Who | Mandatory? | Label (quoted) | Right section? | Auto-fill? | Simpler? | Validated? | Duplicate? | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| "Name as on PAN / bank account" (helper "Must match your bank account name") | KYC beneficiary | Gateway | Yes | Clear | Yes | Profile full name / saved beneficiary | — | Regex 4–80 letters | Profile name | KEEP |
| "PAN" | KYC, TDS (future) | Gateway, tax | Yes | Clear (placeholder "ABCDE1234F") | Yes | — | — | **Individuals only** | — | FIX (WS9-13) |
| "Email" | Gateway contact | Gateway | Yes | Clear | Yes | **Not prefilled from account** | Prefill | Regex | Account email | FIX: prefill |
| "Bank account number" (masked) | Payout destination | Gateway | Yes | Clear | Yes | — | — | 9–18 digits | — | KEEP |
| "Re-enter account number" (**not masked**) | Typo guard | Gateway | Yes | Clear | Yes | — | — | Must match | — | FIX: mask consistently |
| "IFSC" | Bank branch | Gateway | Yes | Clear | Yes | — | Bank-name lookup from IFSC | Regex | — | KEEP (+ show bank name) |
| "Address", "City", "PIN code", "State" (Route rail only) | Gateway KYC | Gateway | Route only | Clear | Yes | **Not prefilled** from saved addresses | Prefill | Street ≥10, PIN 6 digits | Saved addresses | FIX: prefill |
| Missing: Account type (Individual/Business), Business legal name, GSTIN (optional), GST registration status | Tax/invoicing | Platform, CA | Depends on CA matrix | — | — | — | — | — | Shop GSTIN | ADD |

### F. GST / business-details fields

| Field | Where | Purpose | Mandatory? | Label | Validated? | Verdict |
|---|---|---|---|---|---|---|
| "GSTIN (optional)" | `merchant-shop.tsx:358`; server `0049:51,310` | Shop GST identity | No | Clear | 15 alphanumeric chars only; no checksum, state code or PAN cross-check | FIX: format + checksum; drive the RFQ GST rate from it (WS9-12) |
| Service-provider GSTIN | — | Provider invoices | — | — | — | ADD (after CA review) |
| Customer business GSTIN (B2B) | — | Input-credit invoices (`docs/09:144`) | — | — | — | ADD (later) |

### G. RFQ supplier quote — `app/app/rfq/merchant/[id].tsx`

| Field | Purpose | Who | Mandatory? | Label | Right section? | Auto-fill? | Simpler? | Validated? | Duplicate? | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| "Available" / "Unavailable" chips | Line availability | Customer | Yes | Clear | Yes | Available | — | n/a | — | KEEP |
| "Unit price" (₹) | Price | Customer | Yes (if available) | Clear | Yes | — | — | ≥ 0 | — | KEEP |
| "Brand offered" | Spec | Customer | No | Clear | Yes | Customer's preferred brand could prefill | Prefill | maxLength 80 | — | FIX: prefill |
| "Model (optional)" | Spec | Customer | No | Clear | Yes | — | — | 80 | — | KEEP |
| "Specifications offered (JSON object)" | Spec | Customer | No | **Not understandable for merchants** | Yes | — | Key/value rows or free text | JSON parse | — | FIX → free-text "Specifications" |
| "GST rate" chips 0/5/12/18/28% (default 18%) | Tax | Customer | Yes | Clear | Yes | Default 18% | Derive from product category/HSN | Enum | — | FIX (WS9-12) |
| "Delivery charge" | Logistics | Customer | No | Clear | Yes | — | — | ≥ 0 | — | FIX: GST treatment of delivery requires professional review |
| "Delivery days (optional)" | ETA | Customer | No | Clear | Yes | — | — | int | — | KEEP |
| "Notes for the customer" | Terms | Customer | No | Clear | Yes | — | — | 2000 | — | KEEP |

### H. Proposal price form — `app/app/proposal/compose/[requestId].tsx`

| Field | Purpose | Who | Mandatory? | Label | Right section? | Auto-fill? | Simpler? | Validated? | Duplicate? | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| "Package / scope" | Single line title | Customer | Yes | Clear | Yes | Request brief | — | non-empty | — | FIX: allow multiple lines |
| "Fixed total (₹)" | Price | Customer | Yes | Clear | Yes | Package price | — | > 0 | — | KEEP |
| "Terms" | Terms | Customer | No | Vague | Yes | — | "Notes & terms" | none | — | FIX copy |
| "Advance (%)" | Payment plan | Customer | Yes | Clear | Yes | 30 | Chips | 0 < adv < total | — | FIX: chips + preview "₹X now, ₹Y later" |
| "What will be delivered?" | Deliverables | Customer | No | Clear | Yes | — | — | none | — | KEEP |
| Missing: "You receive", platform fee shown to customer | Economics | Provider | — | — | — | — | — | — | — | ADD (WS9-22) |

### I. Sports pricing — `app/app/sports/manage.tsx:644-665`

| Field | Purpose | Who | Mandatory? | Label | Right section? | Auto-fill? | Simpler? | Validated? | Duplicate? | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| Day selector "Every day / Mon…" | Rule scope | Owner | Yes | Clear | Yes | "Every day" | — | n/a | — | KEEP |
| "From" / "Until" (free text) | Time band | Owner | Yes | Missing format hint (opening hours use "Opens (24-hour time)") | Yes | 08:00/20:00 | Time picker | Server RPC | Opening hours | FIX |
| "Price" ₹ | Slot price | Owner | Yes | Section says "Prices (₹ per slot)" | Yes | — | — | Button disabled if ≤ 0 | — | KEEP + add "You receive" |
| "Label" | Rule name | Owner | No | Clear | Yes | "Standard" | — | — | — | KEEP |
| Existing rules list | Review | Owner | — | Text only; **no edit/delete** | Yes | — | — | — | — | FIX |

### J. Admin coins form — `app/app/admin/coins.tsx:189-202`

Every field is labelled in raw units (paise and basis points), for example "Earn rate (basis points)" and "Per-booking cap (paise; blank = none)". This is acceptable for admins but error-prone. **FIX:** take ₹ and % inputs and convert on save. Add range limits (expiry 1–24 months, monthly cap ≤ budget). Show "This changes coin value for all customers" when the denomination changes.

### RECOMMENDED customer billing form (checkout / quote approval summary), fields in order

1. Booking reference (`QS-XXXXXXXX`) · Provider name · Service/category
2. **Items** (every line, any kind): description · qty × unit price · line amount; discounts as negative lines
3. Service subtotal
4. Minimum visit charge (only if applicable)
5. Platform fee (incl. GST): exact wording pending CA review
6. Taxes (only if the CA matrix requires a separate tax line): GST % and amount
7. Seva Coins used (−₹X) · "Funded by Nearo"
8. **Total**
9. Already paid (visit fee/advance, cash only)
10. **To pay now**, the only amount on the Pay button; the server returns it
11. Pay later (remaining milestones, if any) with due trigger
12. Who receives the money: "Paid to Nearo and held until the job is done, then released to <Provider>"
13. Refund/cancellation summary (1 line) + "How refunds work" link
14. Coins toggle (only when `can_redeem`), placed directly above row 7

### RECOMMENDED provider billing form (quote editor), fields in order

1. Booking ref · customer first name · category (header, read-only)
2. "Add from my rate card" chips
3. Per line: **Type** (Labour / Parts / Other) → **What is this for?** → **Qty + unit** → **Unit price ₹** → line amount → (Parts > ₹500) **Bill photo — required**
4. "+ Add line" buttons
5. Note for the customer (optional)
6. Summary (single block, sticky footer): Quote total · Customer pays (total incl. platform fee) · Commission (x% of labour) · GST on commission (18%) · *Statutory deductions (after CA review)* · **You receive** · "Paid to bank ••••1234 about 24 h after the customer confirms"
7. Send button (disabled until the server rate loads and validation passes)

## Receipt / invoice / statement audit

### What exists today

| Document type | Exists? | Evidence | What is shown instead |
|---|---|---|---|
| Customer **payment receipt** | NO | no table/RPC/screen; "Receipt" button only opens the booking (`UnifiedActivityScreen.tsx:378-383`) | Booking-detail "Payments" list: label (`'Seva Coins' / 'Visit fee' / 'Job payment'`), date, amount, status badge (`booking/[id].tsx:726-762`) |
| **Provider-generated bill** (provider→customer) | NO | — | The quote (`QuoteView`) is the only itemised document; "Bill photo attached" refers to parts bills uploaded by the provider |
| **Tax invoice** | NO | no `invoice_number`/sequence/GSTIN on payments (`0001:200-214`); PRD PAY5 (`docs/01-PRD.md:110`) | — |
| **Platform commission statement/invoice** (platform→provider) | NO | `payouts` = gross, commission, gst_on_commission, amount, status, release_after, transferred_at (`0001:234-246`) | Earnings list line "Billed ₹X · Fees −₹Y · Net ₹Z" (`earnings.tsx:310`) |
| **Merchant settlement statement** | NO | sports payouts not visible to owners (WS9-F24); no period statement | — |
| Razorpay "receipt" | Internal reference only | `create-payment/index.ts:120` `receipt: prepared.payment_id` | Gateway's own payment confirmation (not a Nearo document) |
| RFQ supplier quote | Quote only (not a bill) | `rfq/[id].tsx:110-115` "Items ₹ · GST ₹ · Delivery ₹" | — |

### Required content vs. what the payments list / quote shows today

| Required element | Payments list + QuoteView today |
|---|---|
| Issuer identity (legal name, address, GSTIN) | Missing |
| Document number (sequential, unique) | Missing (only `QS-XXXXXXXX` booking ref in header) |
| Date/time | Payment date/time per row ✔ |
| Customer details | Missing |
| Provider details | First name/avatar only |
| Reference (booking ref, gateway payment id/UTR) | Booking ref in header ✔; gateway id missing |
| Description, qty, unit price | QuoteView ✔ (but hidden for non-labour/part/other kinds, WS9-07) |
| Base amount / subtotal | ✔ |
| Discounts | Coins ✔; discount lines hidden |
| Extra charges (visit charge, travel, platform fee) | ✔ |
| Tax breakdown | Missing (platform fee GST-inclusive not stated) |
| Total | ✔ |
| Paid | Partly ✔ ("Paid so far (incl. visit fee)"); wrong with coins (WS9-02) |
| Due | ✔ (wrong with coins) |
| Payment method | Missing (not stored) |
| Status | ✔ badge |
| Refund (amount, date, status) | Missing for partial refunds; only status for full |

### Who should issue each (recommendation — **requires professional tax/legal review**)

| Document | Issuer | Trigger | Notes |
|---|---|---|---|
| Payment receipt (proof of payment) | **Platform** | each successful payment and refund | Non-tax document; can ship before the CA matrix |
| Service bill / tax invoice for the service | **Provider** (or platform where docs/07:395 says platform is liable under GST s.9(5)) | job completion | Depends on provider GST status and category tax profile |
| Platform-fee invoice to customer | **Platform** | with the payment that includes the platform fee | Docs say ₹29 is GST-inclusive (`docs/03:57`) |
| Commission tax invoice to provider | **Platform** | each payout (or monthly) | Commission + 18% GST is already calculated (`0001:590-591`) |
| Provider/merchant settlement statement | **Platform** | weekly/monthly + per payout | Must include TCS/TDS once implemented |

### Customer billing comprehension (actual UI copy)

| Question | Answered? | Actual copy / evidence |
|---|---|---|
| What am I paying for? | Partly | Quote items (`QuoteView`); book screen "Visit / inspection fee"; payments rows "Visit fee"/"Job payment" (advance, platform fee and milestones all become "Job payment") |
| How was it calculated? | Partly | "Subtotal", "Platform fee", "Minimum visit charge", "Total"; no item lines for package/add-on kinds |
| Extras? | Yes for change orders | "Change order", "Extra to pay now"; QuoteView change-order banner for providers: "The customer only pays the difference over what they already paid." |
| Is tax included? | **No** | Nowhere states GST |
| What have I paid? | Partly | "Paid so far (incl. visit fee)"; payments list |
| What is due? | Yes but can be wrong | "To pay now", "Balance due" (WS9-02/03) |
| Who receives it? | Yes | "Held by QuickServe and released to the pro 24 hours after completion." (`booking/[id].tsx:761`); old brand |
| Did it succeed? | Status badge only | "Paid" / "Pending" / "Failed"; no confirmation notification (WS9-21) |
| Where is my receipt? | **No** | "Receipt" button opens the booking (WS9-20) |
| How do I dispute? | Yes | "Report a problem" → "Payment to the pro is paused while our support team reviews it." |

### Provider earnings comprehension (actual UI copy, `app/app/(provider)/earnings.tsx`)

| Question | Answered? | Actual copy |
|---|---|---|
| What was the customer charged? | Partly | "Billed ₹X" = payout `gross` (excludes platform fee and coins) |
| Platform fee? | No | not shown to the provider |
| Commission? | Merged | "Fees −₹Y" (commission + GST together); footnote "Fees so far: ₹A on ₹B billed." |
| Promotions/coins? | No | coins are platform-funded; not explained to providers |
| Taxes/deductions | Misleading | Quote editor: "Paid to your bank 24 hours after completion, before statutory TDS/TCS." No TDS/TCS exists |
| Net | Yes | "Net ₹Z" |
| Received | Yes | "Paid to bank", "Paid {date}" |
| Pending | Yes, but includes failed | "Pending payout" (includes `failed`), "Releases {date}", "Next payout" |
| Refunds/adjustments | Status only | "Reversed", "Partly reversed" badges; amounts not shown |
| Settlement status | Yes | badges "On hold", "Frozen · dispute", "Paid", "Retrying", "Reversed", "Partly reversed" |

### Proposed provider earnings statement layout (per payout and monthly)

```
Nearo — Provider statement            Period: 01 Nov 2026 – 30 Nov 2026
Provider: <legal name> · PAN ••••1234F · Bank ••••6789 (HDFC0001234)
GSTIN: <if any>                        Statement no: NS-2026-11-000123

Job ref     Date     Customer paid  Your bill  Commission  GST on comm.  Other deductions  Net payout  Status       Paid on / UTR
QS-1A2B3C4D 03 Nov   ₹2,179.00     ₹2,150.00  −₹180.00    −₹32.40       ₹0.00            ₹1,937.60   Paid         05 Nov · UTR…
...
Totals: Your bill ₹…  Commission −₹…  GST −₹…  Adjustments/reversals −₹…  TDS/TCS −₹… (after CA review)  Net ₹…
Pending: ₹… (releases <date>) · On hold (dispute): ₹… · Failed (retrying): ₹…
Notes: Platform fee paid by the customer is not part of your bill. Coins are funded by Nearo and never reduce your payout.
```
Field names: `statement_no, period_start, period_end, provider_legal_name, pan_masked, bank_last4, ifsc, gstin, rows[booking_ref, date, customer_paid, provider_bill(gross), commission, gst_on_commission, other_deductions, reversals, net, status, transferred_at, utr]`, `totals{...}`, `pending, on_hold, failed`.

### Proposed customer receipt layout

```
Nearo — Payment receipt                 Receipt no: NR-2026-000456
Date & time: 05 Nov 2026, 4:12 PM       Status: Paid
Booking: QS-1A2B3C4D · AC repair · Ravi K. (provider)
Billed to: <customer name> · <area, city>

Item                         Qty   Unit price   Amount
Gas refill (labour)           1    ₹1,500.00    ₹1,500.00
Capacitor 45uF (part)         1    ₹  650.00    ₹  650.00
Service subtotal                                ₹2,150.00
Platform fee (incl. GST)                        ₹   29.00
Seva Coins (funded by Nearo)                    −₹  50.00
Total                                           ₹2,129.00
Paid earlier (visit fee, 03 Nov)                −₹  199.00
Paid now (UPI · pay_XXXX)                       ₹1,930.00
Balance due                                     ₹    0.00
Refunds: none
Money is held by Nearo and released to the provider 24 h after you confirm completion.
Questions or disputes: Booking → Report a problem.   Tax invoice: <link when issued>
```
Field names: `receipt_no, issued_at, status, booking_ref, category, provider_display_name, customer_name, customer_locality, items[description, kind, qty, unit_price, amount], subtotal, platform_fee, tax_lines[], coins_discount, total, prior_payments[], this_payment{amount, method, gateway_ref, paid_at}, balance_due, refunds[amount, status, processed_at], dispute_link, tax_invoice_url`.

## Coins & rewards audit

| Question | Answer | Evidence |
|---|---|---|
| Is the balance backed by an auditable ledger? | **Yes.** Credits are lots (`delta > 0`, `expires_at`). Debits reference the lot (`source_ledger_id`). The balance = sum of unexpired lot remainders. Every row has a unique `ref` and a `reason`. | `0015:24-48,74-104`; PASS tests "FIFO…", "coin balance is integer paise" |
| Can coins be credited twice? | Earn/bonus: **no** (unique `earn:`/`bonus:` ref + existence check; PASS "earn ledger ref is idempotent"). Terminal restore: **yes in one path** (WS9-04, UNTESTED). The change-order restore is idempotent per `restore:<booking>:<quote>`. | `0047:381-389`; `0047:567-602` |
| Concurrency | The per-user lock (`_lock_coin_account`) serialises a user's spends. The global pilot budget is not locked (WS9-15). | `0015:62-72`; `0047:419-428` |
| Earning rules | 1% of eligible value (service value − coin discount − refund), floored to the coin unit, ₹20 per-booking cap, ₹10 first-earn bonus, ₹1,000 monthly cap, ₹10,000 pilot budget, six-month expiry. Credited when completed→closed (after payout transfer). Switch `coins_earning`. | `0047:1-17,356-489`; PASS tests above |
| Referral | NOT IMPLEMENTED, so there is no referral abuse surface today. When built: unique referee device/phone, reward only after the referee's first *paid & closed* booking, cap per referrer/month, same ledger with `kind='referral'` and ref `referral:<referee_id>`. | search: none |
| First-transaction | Bonus goes on the first booking that *earns*. If earning was off or the budget exhausted on the true first booking, a later booking gets the "first" bonus. Minor; document it. | `0047:403-409` |
| Repeat / cross-category promos | NOT IMPLEMENTED | search: none |
| Redemption | Only on inspect-and-quote approval; ≤ 10% of service value and ≤ net platform revenue (commission + platform fee − GST); whole coin units; one redemption per booking. Coin-funded payment row never feeds provider transfers. | `0047:252-354`; `0043:219-241`; PASS "provider payout allocation uses gateway cash only" |
| Limits visible to users? | Partly. The wallet shows earn %, redeem %, months. It hides the ₹20/booking cap, ₹10 bonus, ₹1,000/month cap and which booking types qualify. "capped by QuickServe revenue" is not understandable. | `coins.tsx:74-82` |
| Expiry | Six months (configurable), daily cron `expire-seva-coins`. History shows "expires {date}" per credit. "Expiring soon" (15 days) is computed in `coin_balances` but not shown in the wallet. | `0015:107-124,715-726`; `coins.tsx:112` |
| Reversal after refund | Earned coins are clawed back proportionally; any shortfall becomes `clawback_due` debt recovered from future earnings. PASS for the basic clawback; debt recovery is UNTESTED. | `0047:492-565,446-475` |
| Reversal after cancel | Redeemed coins are restored on declined/expired/cancelled/closed_no_work/refunded (UNTESTED; double-credit path WS9-04). Partial refunds never restore redeemed coins (WS9-19). | `0015:566-583` |
| Balance & history UI | Balance shown as ₹ with "N coins · ₹X". History labels: "Booking reward", "Bonus", "Used on booking", "Expired", "Refund adjustment", "Account adjustment". Reasons are internal strings. Rows are not linked to bookings; 50-row limit. | `coins.tsx:15-22,97-121`; `supabaseApi.ts:653-661` |
| Admin audit | Config changes, feature switches and manual adjustments go to `admin_audit_log`. System restores are written as `kind='admin'` with `created_by null`, so they look like admin actions. No per-user ledger view or adjust UI. | `0047:149-150,686-690`; `0042:78`; WS9-14 |
| Is the value understandable? | Mostly. Big ₹ figure plus "N coins". Denomination-change notice "Coins are now 10 paise each. Your balance value hasn't changed." The non-cash disclaimer is present: "Seva Coins are not cash, are non-transferable, and can only be used inside QuickServe." (old brand) | `coins.tsx:55-61,70-73,125-127` |
| Is the switch safe? | **No.** Turning off redemption blocks quote approval (WS9-01). | — |

## Remediation tasks

| ID | Objective | Files (exact paths) | Required change | Depends on | Acceptance criteria | Tests to add | Complexity | Parallelisable |
|---|---|---|---|---|---|---|---|---|
| WS9-T01 | Quote approval must not depend on the coin switch | `app/app/booking/[id].tsx`; new migration `supabase/migrations/0059_coins_hardening.sql` | (1) In `approve` (line ~270) pass `useCoins && (data.coinPreview?.maximum_paise ?? 0) > 0`. (2) In `0059`, re-create `public._apply_quote_coins` (copy from `0047:252-354`) and replace the `if coalesce(p_use_coins,false) then perform _assert(...)` block with: `if coalesce(p_use_coins,false) and not public._feature_enabled('coins_redemption') then p_use_coins := false; end if;` (declare a local `v_use boolean` instead of assigning to the parameter). Keep everything else identical. | — | With `coins_redemption=false`, `approve_quote_with_coins(..., true)` succeeds and returns `coins_redeemed_paise = 0` | SQL: "approval succeeds with redemption off and use_coins=true". Update the existing coins_config assertion "server refuses redemption…" to expect 0 redeemed instead of an error | S | Yes |
| WS9-T02 | Fix QuoteView due when coins were used | `app/src/components/QuoteView.tsx` | Line 70: change `const due = Math.max(0, total - alreadyPaid);` to `const due = Math.max(0, total - cashPaid);`. Do not change other lines. | — | For quote total 2150, visit 199 paid, platform 29, coins 50 paid → "To pay now" shows ₹1,930 (= server `amount_due` in seva_coins test) | Jest: new `app/src/components/__tests__/QuoteView.test.tsx` rendering the case above | S | Yes |
| WS9-T03 | Remove double coin restore and re-redemption failure | `supabase/migrations/0059_coins_hardening.sql` | Re-create `_restore_coins_for_terminal_booking` from `0047:567-602` and change the payment select to `where booking_id = b.id and funding_source = 'coins' and status = 'paid'`. Re-create `_apply_quote_coins`: in the `v_new = 0` branch, also `delete from public.payments where booking_id = b.id and funding_source='coins' and status='paid'` instead of setting `status='failed'`. | T01 (same migration) | Change order to cap 0, then cancel → total restored == original redeemed (one restore). | SQL: "change-order restore + cancellation restores once"; "cancel after redemption restores exactly once (idempotent on re-trigger)" | M | No (same migration as T01) |
| WS9-T04 | Preview must reflect "already redeemed" | `supabase/migrations/0059_coins_hardening.sql`; `app/src/lib/coins.ts`; `app/app/booking/[id].tsx` | In `get_coin_redemption_preview` add `'can_redeem', (v_enabled and v_existing = 0)`, and when `v_existing > 0` set `maximum_paise := least(v_existing, v_service_cap, v_platform_cap)` floored to the unit. Add `can_redeem: boolean` to `CoinRedemptionPreview`. In booking/[id] render the toggle only if `can_redeem`, and compute `previewDiscount` only if `can_redeem`. | T01 | On a change order with existing redemption: no toggle, footer due == server `amount_due` | SQL preview test; Jest for the footer calculation (extract it into a pure helper in `app/src/lib/money.ts` named `customerDueNow`) | M | No (same migration) |
| WS9-T05 | Show every quote line kind | `app/src/components/QuoteView.tsx` | Replace `(['labour','part','other'] as const)` with `(Object.keys(groupLabel) as QuoteItemKind[])`. For `discount` items render the amount as negative. | — | Fixed/proposal approved scope lists its package/add-on items | Jest render test with a `package` item and a `discount` item | S | Yes |
| WS9-T06 | Customer payment receipt (non-tax) | new migration `supabase/migrations/0060_receipts.sql`; new `app/app/receipt/[paymentId].tsx`; `app/src/lib/supabaseApi.ts`, `app/src/lib/apiTypes.ts`, `app/src/lib/demo/demoApi.ts`; `app/app/booking/[id].tsx`; `app/src/features/activity/UnifiedActivityScreen.tsx` | Table `payment_receipts(id uuid pk, receipt_no text unique, payment_id uuid unique references payments, booking_id, issued_at, snapshot jsonb)` with a sequence `receipt_no_seq` and format `'NR-' || to_char(now(),'YYYY') || '-' || lpad(nextval::text,6,'0')`. Insert in an `after update of status on payments` trigger when `new.status='paid' and funding_source='customer'` (`on conflict (payment_id) do nothing`). Snapshot uses the layout field names in this report. RPC `get_receipt(p_payment_id)` returns the row only to the booking customer/provider/admin. Feature flag `payment_receipts` (default OFF, rule 1). App screen renders the "Proposed customer receipt layout". Add "View receipt" on paid rows. Rename the activity "Receipt" button to "Details" when the flag is OFF. | — | Paying creates exactly one receipt. Other users cannot read it. Flag OFF hides the entry points. | SQL: one receipt per payment, idempotent on webhook replay, RLS denial for a stranger, flag-off. Jest: receipt formatting helper | L | Yes |
| WS9-T07 | Tax invoices (service, platform fee, commission) | `docs/03-Pricing-Payments-Commission.md` first; then migrations | **Blocked until a CA delivers the PAY5 tax matrix.** Then add `tax_profiles`, provider GST status/GSTIN, invoice series per issuer, and HSN/SAC per category. | CA matrix; T06; T11 | CA sign-off documented | Per matrix | L | No |
| WS9-T08 | Provider earnings statement | `app/app/(provider)/earnings.tsx`; new `app/app/earnings-statement.tsx`; new RPC in a migration `get_provider_statement(p_from date, p_to date)` | RPC returns rows `{booking_ref, date, provider_bill(gross), commission, gst_on_commission, reversed_amount, net, status, transferred_at, razorpay_transfer_id}` for `payouts where provider_id = uid or payee_id = uid`. Screen renders the "Proposed provider earnings statement layout" with a month picker. In `earnings.tsx`: separate "Commission" and "GST on commission"; move `failed` from Pending into a "Retrying" stat; change the TDS/TCS copy to "Statutory deductions, if any, will be shown here." | — | Sports venue owners see their payouts. Totals reconcile to the sum of rows. | SQL: statement totals; payee-only visibility. Jest: summary helper (extract into `app/src/lib/providerInsights.ts`) | M | Yes |
| WS9-T09 | Server-sourced price breakdown on book screens | `app/app/book/[providerServiceId].tsx`, `app/app/book-fixed/[providerServiceId].tsx`, `app/src/lib/money.ts`, migration with `get_booking_price_preview(p_provider_service_id uuid, p_quantity int)` | The RPC returns `{visit_fee, platform_fee, package_total, total, pay_now}` from `app_config`/service rows. Replace `PLATFORM_FEE_PAISE` and `2900` usage with RPC values. Show a skeleton until loaded. | — | Changing `app_config.fixed_booking.platform_fee_paise` changes the displayed total | SQL preview test; E2E assertion that the button amount equals the preview `pay_now` | M | Yes |
| WS9-T10 | Coin wallet comprehension | `app/app/coins.tsx`, `app/src/i18n/en.ts`, `app/src/i18n/te.ts`, `app/app/booking/[id].tsx` | Rules card lists: earn %, "up to ₹{per_txn_cap} per booking", "₹{bonus} bonus on your first completed booking", "up to ₹{monthly_cap} a month", "use up to {redeem}% on inspection bookings", "valid {months} months". Replace "capped by QuickServe revenue" with "limits apply per booking". Map reasons by `kind`/`ref` prefix to customer text. Link rows with `booking_id` to `/booking/[id]`. Show `expiring_soon_paise`. Replace "QuickServe" with "Nearo". Booking banner (line ~580): fetch the booking's ledger rows instead of `earnedCoinPaise`; hide when 0 or earning is off. | T04 | No hard-coded default config used for customer-facing amounts | Jest: reason-mapping helper | M | Yes |
| WS9-T11 | Business/GST identity on the payout form | `app/src/features/providerOnboarding/PayoutSection.tsx`, `app/src/lib/onboarding/validation.ts`, `supabase/functions/provider-payout-account/*` | Add "Account type" (Individual/Business). Business → allow PAN 4th letter in `[CFHATBLJG]`, require "Registered business name"; optional "GSTIN" validated by format + state code + embedded PAN match. Mask "Re-enter account number". Prefill email and address from profile. | — | Business PAN accepted only with type Business | Jest `validatePayoutForm` cases; Deno edge test for business PAN | M | Yes |
| WS9-T12 | Enforce billing rules on the server | migration re-creating `public.send_quote` from `0052:925-1001` | Reject `kind not in ('labour','part','other')`. Reject `part` lines with `round(qty*price) > 50000` and an empty `bill_photo_url` (message "Parts above ₹500 need a bill photo"). | — | Sending without a photo fails; the client shows the message | SQL: three cases | S | Yes |
| WS9-T13 | Coins admin & accounting | migration; `app/app/admin/coins.tsx` | Add ledger kinds `restore` and `system` (drop/re-add the `kind` check). Use `restore` in the restore functions. `admin_set_coins_config`: assert `expiry_months between 1 and 24`, `monthly_cap_paise <= coalesce(pilot_budget_paise, monthly_cap_paise)`. Add `pg_advisory_xact_lock(hashtext('coins_budget'))` before the budget read in `_credit_booking_coins`. New admin RPC `admin_list_coin_ledger(p_user_id uuid, p_limit int)`. UI: user search → ledger list → "Adjust" (reason ≥ 3 chars) using `admin_adjust_coins`. Inputs in ₹/% converted to paise/bp. | T03 | Admin can find and adjust a wallet. Restores no longer counted as admin. Summary counts all credits. | SQL: expiry 0 rejected; admin ledger list RLS; budget race (two sessions) | M | No (migration ordering with T01/T03) |
| WS9-T14 | Payments list readability + notifications | `app/app/booking/[id].tsx`; migration for notifications | Hide `failed` rows with `cancel_link_pending` or `funding_source='coins'`. Label by purpose (`platform_fee` → "Platform fee", `advance` → "Advance", milestone → schedule label). Render refunds under each payment ("Refund ₹X · processing/refunded · date"). Notifications: insert a `notifications` row in `record_payment_paid` (customer), `complete_refund` (customer), payout transferred/failed (provider). | — | A partial refund is visible. No red "Failed" for abandoned links. | Jest for the row-label helper; SQL notification rows | M | Yes |
| WS9-T15 | Checkout trust | `supabase/functions/create-payment/index.ts` | Remove the default `CHECKOUT_PAGE_URL` (use `requireEnv`). Description = `` `Nearo · ${bookingRef} · ${purposeLabel}` ``. | — | Function fails fast if the env var is missing | Deno test for the description builder | S | Yes |
| WS9-T16 | Coin earn must not block close | migration re-creating `_credit_booking_coins` | Replace the assert at `0047:385` with `if q.id is null or b.status not in ('completed','closed') then return 0; end if;` | T13 migration ordering | Closing a booking without an approved quote succeeds | SQL: close a time-based/sports-like booking with null `approved_quote_id` | S | No (shared migration) |

## Regression tests to add

1. **SQL `coins_hardening.test.mjs`** (register in `supabase/tests/package.json` and `run-all.mjs`):
   - quote approval succeeds with `coins_redemption` OFF and `p_use_coins=true` (0 redeemed)
   - change order with `redeem_cap_bp=0` then cancellation → ledger restores total exactly the original redemption (no double credit)
   - re-trigger of the terminal status update does not add a second `restore-terminal` row
   - preview on a booking with an existing redemption returns `can_redeem=false` and `maximum_paise = applied`
   - `clawback_due` debt is recovered from the next earn and the bonus (two ledger rows, account debt reduced)
   - first-booking bonus is not granted twice when two bookings close in sequence
   - pilot budget cannot be exceeded by two concurrent closes (two PGlite sessions or sequential with locked budget)
   - `admin_set_coins_config` rejects `expiry_months = 0`
   - closing a booking with null `approved_quote_id` does not raise
2. **SQL `send_quote`**: rejects unknown kinds; rejects parts > ₹500 without `bill_photo_url`; accepts with photo.
3. **SQL receipts (after T06)**: exactly one receipt per paid payment; idempotent on `record_payment_paid` replay; stranger cannot read; flag OFF hides the RPC result.
4. **SQL provider statement (after T08)**: sports payee sees their payouts; totals equal the sum of rows; reversed amounts shown.
5. **Jest `QuoteView.test.tsx`**: coins case "To pay now" = server due; `package`/`addon`/`discount` items rendered; "Paid so far" label for non-visit-fee archetypes.
6. **Jest `customerDueNow`** (new helper): initial approval with coins, change order with an existing redemption, change order lowering the total.
7. **Jest `validatePayoutForm`**: business PAN with Business type passes; with Individual type fails.
8. **Jest coins reason mapping**: each `kind`/ref prefix → customer copy; no internal string leaks.
9. **E2E (real-backend lane, not demo)**: approve a quote with coins on → button amount == gateway order amount; admin turns redemption OFF → approval still works; wallet shows a ledger row linked to the booking.
10. **Deno `create-payment`**: description builder uses the "Nearo" brand and booking ref; missing `CHECKOUT_PAGE_URL` fails.
