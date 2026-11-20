# Nearo — Billing & Finance Specification (Deliverable D)

| | |
|---|---|
| **Status** | **Owner decisions D1–D7 finalized on 2026-11-18. Tax/GST/TDS/TCS items remain placeholders pending professional review; nothing here is a legal conclusion.** |
| **Baseline** | `main` @ `bfa999f`. "TODAY" = verified current behavior (evidence in [doc 15](15-Nearo-Functional-Audit-Report.md) and appendices [WS6](audit/15-WS6-payments-settlements.md), [WS9](audit/15-WS9-billing-forms-receipts-coins.md)). "RECOMMENDED" = change to implement through [doc 17](17-Nearo-Audit-Remediation-Implementation-Plan.md). |

## 1. Principles (non-negotiable)

1. **Money is integer paise** (`int`/`bigint`, INR only). Display uses `formatINR(paise)`. No floating point in any calculation path. TODAY: compliant.
2. **The server is the only source of amounts.** The app sends ids (`booking_id`, `schedule_id`, `pack_id`, `kind`), never amounts. The server recomputes, and the gateway order amount equals the server row. TODAY: compliant (`create-payment/index.ts:41-81`). **RECOMMENDED:** the app must also *display* only server-returned breakdowns (today several screens recompute or hard-code fees, which causes doc 15 B3).
3. **Every financial event is an append-only record:** payment captured, refund, coin movement, commission, payout, reversal, chargeback. TODAY: PARTIAL. Coin amounts are rewritten in place, payment ids can be overwritten (P0-07), webhook payloads are discarded, and rows cascade-delete. **RECOMMENDED:** an append-only `financial_events` journal and a `gateway_webhook_log` (doc 17 WP-F5).
4. **A payment is successful only when the backend records a verified capture** (signature-verified webhook or server-side capture). Never trust a client response. TODAY: compliant.
5. **Customer payable and provider net are always separate fields**, and are never shown in the same sentence to the wrong party.
6. **Rounding:** commission and GST use `round()` (half away from zero). Refund shares use `floor()` (≤ 1 paisa per component in the platform's favor). This is documented on the receipt as "rounded to the nearest paisa".

## 2. Common transaction fields (every transaction type)

M = mandatory, O = optional. All money fields are `int` paise ≥ 0.

| Field | Description | M/O | Calculation rule |
|---|---|---|---|
| `transaction_id` | booking / sports booking / pack id (uuid) | M | — |
| `transaction_type` | `inspect_quote` · `fixed` · `time_based` · `pack` · `recurring_visit` · `sports` · `proposal` · `byo` · (`product_rfq` future) | M | — |
| `reference` | Human reference, e.g. `NR-1A2B3C4D` (today `QS-…`) | M | first 8 hex of id, uppercase |
| `currency` | `INR` | M | constant |
| `service_value_paise` | Value of the provider's service | M | per type, §3 |
| `pass_through_paise` | Parts/material at cost, non-commissionable | O | Σ `part` lines (inspect_quote only) |
| `commissionable_paise` | **RECOMMENDED new column** `quotes.subtotal_commissionable` | M | Σ lines where `_commissionable(kind)`. TODAY = `subtotal_labour + subtotal_travel` (`0014:659`), which is 0 for fixed/proposal (**P0-05**). |
| `platform_fee_paise` | Customer fee to Nearo | M | per type. **RECOMMENDED:** read from `app_config` (today hard-coded 2900 in places) |
| `coin_discount_paise` | Platform-funded discount | O | §9; never refundable as cash |
| `customer_payable_paise` | Total cash the customer pays | M | `service_value + pass_through + platform_fee − coin_discount` (inspect: `max(quote_total, visit_fee) + platform_fee − coins`) |
| `commission_bp_snapshot` | **RECOMMENDED**: frozen at booking/quote approval | M | from `_commission_bp` / time-based / sports config |
| `commission_paise` | | M | `round(commissionable × bp / 10000)`; proposal cap per D1 |
| `gst_on_commission_paise` | | M | `round(commission × gst_rate_bp / 10000)`; TODAY 18% fixed (**tax review**) |
| `tds_paise`, `tcs_paise` | **RECOMMENDED** placeholders, stored as 0 until CA sign-off | O | **requires professional tax/legal review** |
| `provider_net_paise` | Provider's earnings | M | `max(service_value + pass_through − commission − gst_on_commission − tds − tcs − refunds_borne_by_provider, 0)` |
| `refund_paise` | Cash refunded to the customer | M | §8 |
| `gateway_payment_ids[]`, `gateway_refund_ids[]`, `gateway_transfer_ids[]` | Razorpay references | M | from the recorders; **never overwritten** (P0-07) |

## 3. Per-transaction-type billing (with worked samples)

### 3.1 Home service — inspect & quote (TODAY correct)
- **Extra fields:**
  - `visit_fee_paise` (M; credited into the quote)
  - `labour_paise`, `parts_paise`, `other_paise`, `travel_paise`
  - `lines[] {kind: labour|part|other|travel, description, qty, unit_price_paise, amount_paise, bill_photo_url?}`
- **Rules:**
  - `line = round(qty × unit_price)`
  - `customer_payable = max(quote_total, visit_fee) + platform_fee − coins`
  - commissionable = labour + travel
  - Parts > ₹500 require a bill photo. **RECOMMENDED:** enforce this on the server; today it is enforced only in the client.
- **Sample** (doc 03; provider past the free period, 12%):

| Item | Paise | ₹ |
|---|---:|---:|
| Labour | 150000 | 1,500.00 |
| Parts (AC capacitor) | 65000 | 650.00 |
| Quote total | 215000 | 2,150.00 |
| Platform fee | 2900 | 29.00 |
| **Customer payable** (visit fee 19900 at booking + 198000 balance) | **217900** | **2,179.00** |
| Commission 12% × labour | 18000 | 180.00 |
| GST on commission 18% | 3240 | 32.40 |
| **Provider net** | **193760** | **1,937.60** |

### 3.2 Fixed package (incl. add-ons)
- **Extra fields:**
  - `package_id`, `package_snapshot`, `unit_price_paise`, `quantity`
  - `addons[] {title, qty, unit_price_paise}`
- **Rule:** `service_value = round(price × qty) + Σ addons`.
  - TODAY commissionable = 0 (**P0-05**).
  - **RECOMMENDED:** commissionable = package + add-ons at the D1 fixed rate.
- **Sample** (₹999 package, qty 1):

| Item | TODAY | RECOMMENDED (15%) |
|---|---:|---:|
| Package | ₹999.00 | ₹999.00 |
| Platform fee | ₹29.00 | ₹29.00 |
| **Customer payable** | **₹1,028.00** | **₹1,028.00** |
| Commission | ₹0.00 | ₹149.85 |
| GST on commission | ₹0.00 | ₹26.97 |
| **Provider net** | **₹999.00** | **₹822.18** |

The **"Pay" button must show ₹1,028.00**. Today it shows ₹999 (WS2-04).

### 3.3 Recurring visit (per-visit billing; plan billing D1/D2 not built)
- **Extra fields:**
  - `recurring_schedule_id`, `occurrence_id`, `occurrence_date`
  - `duration_min`, `hourly_rate_paise`, `price_snapshot_paise`
  - `billing_frequency` (`per_visit` TODAY)
- **Rules:**
  - `service_value = round(rate × duration / 60)`
  - recurring commission 8% (`app_config.commission.time_based.recurring_bp`)
  - **RECOMMENDED:** `price_snapshot_paise` is frozen at plan acceptance (today the provider's *current* price is used, WS2-05).
  - Each occurrence has its own status, payment row and payout.
- **Sample** (₹400/h × 90 min):

| Item | ₹ |
|---|---:|
| Service | 600.00 |
| Platform fee | 29.00 |
| **Customer payable** | **629.00** |
| Commission 8% | 48.00 |
| GST on commission | 8.64 |
| **Provider net** | **543.36** |

### 3.4 Sports booking (TODAY correct except P0-12, P0-13 and the late-capture issue)
- **Extra fields:**
  - `venue_id`, `resource_id`, `slot_start`, `slot_end`, `slots_count`, `participants`
  - `price_paise` (server price rule), `customer_fee_paise` (`app_config.sports_rules`)
  - `payment_mode` (`online` | `pay_at_venue`)
  - `commission_bp_snapshot`, `refund_paise`, `retained_paise`
- **Rules:**
  - `customer_payable = price + customer_fee`
  - venue `gross = price − refund_paise`
  - commission on gross
  - the customer fee is platform revenue
- **RECOMMENDED:**
  1. Duplicate/late-capture refunds never reduce `gross` (WS6).
  2. On a late customer cancellation, create a venue payout for `retained_paise` (D3; **P0-13**).
  3. Optional per-participant pricing (WS4-T12).
- **Sample** (₹1,200 slot, ₹5 fee, 10%):

| Item | ₹ |
|---|---:|
| Slot | 1,200.00 |
| Customer fee | 5.00 |
| **Customer payable** | **1,205.00** |
| Commission 10% | 120.00 |
| GST on commission | 21.60 |
| **Venue net** | **1,058.40** |

- **Late-cancel sample** (50% refund tier):
  - Refund **₹600.00**; retained ₹600.00.
  - Venue commission ₹60.00, GST ₹10.80.
  - **Venue net ₹529.20** (TODAY: ₹0, **P0-13**).
  - The ₹5 fee is non-refundable. Its wording requires owner approval.

### 3.5 Creator proposal with milestones
- **Extra fields:**
  - `proposal_id`, `items[]`, `deliverables[]`
  - `revisions_included` (**RECOMMENDED** M), `deliver_by` (**RECOMMENDED** M for remote work)
  - `milestones[] {seq, label, amount_paise, due_rule}` (Σ = total, enforced)
  - `platform_fee_rule_snapshot`
- **Rules:**
  - `platform_fee = clamp(round(total × 1%), 9900, 49900)`
  - TODAY commission = 0 (**P0-05**)
  - **RECOMMENDED:** 8% of total, capped at 500000 (D1)
  - The final milestone is due on delivery acceptance or auto-acceptance (D2 window).
  - An unpaid final balance after delivery triggers the WP-C1 path.
- **Sample** (₹20,000 job, 25% default advance cap):

| Item | TODAY | RECOMMENDED |
|---|---:|---:|
| Total | ₹20,000.00 | ₹20,000.00 |
| Platform fee 1% | ₹200.00 | ₹200.00 |
| **Customer payable** | **₹20,200.00** (₹5,200 now + ₹15,000 on delivery) | **₹20,200.00** |
| Commission | ₹0.00 | ₹1,600.00 |
| GST on commission | ₹0.00 | ₹288.00 |
| **Creator net** | **₹20,000.00** | **₹18,112.00** |

**Decision (2026-11-19):** Use the 25% advance cap from WS5-T10 and migration `0081_c2_creator_delivery.sql` (`proposal.max_advance_bp=2500`) for this sample and smoke fixtures. The prior 30% timing example contradicted the server-enforced default; keep the server cap unchanged unless the owner approves a validated admin-config change.

### 3.6 Product enquiry & RFQ (no money through Nearo; D7)
Nearo neither collects nor commissions product sales. That is confirmed by the passing test `selecting a supplier creates no payment`. Every RFQ and quote screen must state: **"Pay the shop directly. Nearo charges no commission."**

**RECOMMENDED supplier quote structure** (enables honest comparison, WS3):

| Field | M/O | Rule |
|---|---|---|
| `item_ref` (links to RFQ line) | M | every RFQ line must have a quote line, or be marked `not_quoted` |
| `brand`, `grade`, `size/dimensions` | M if the RFQ line specified them | differences from the RFQ are flagged "Different from request" |
| `unit` (`box`, `sq_ft`, `piece`, `kg`, `bag`…) | M | price per unit is **always** shown with its unit |
| `qty_quoted` | M | may round up to whole packs; shown as "500 sq ft → 47 boxes (517 sq ft)" |
| `unit_price_paise` | M | |
| `price_includes_gst` | M | if `false` and the shop has a GSTIN → `gst_rate_bp` M; if no GSTIN → GST must be 0 |
| `delivery_paise` | M (0 allowed) | |
| `delivery_by` | M | |
| `valid_until` | M | expired quotes are greyed |
| `other_charges[] {label, paise}` | O | |
| `total_paise` | M | server-computed: Σ lines + delivery + GST + other |

**Comparison rules:**
1. Rank only **complete** quotes (all lines quoted).
2. Show "Lowest total" only among complete quotes.
3. Flag different brand, grade, size or unit, a later delivery date, and missing GST clarity.

## 4. Customer billing summary (checkout and quote approval), exact order

1. Booking reference · Provider name · Service
2. **Items**: description · qty × unit price · amount, for every line kind (today package/add-on/proposal lines are hidden, WS9-05)
3. Service subtotal
4. Minimum visit charge (only if applicable)
5. Platform fee (incl. GST); exact wording after tax review
6. Taxes, only if the tax matrix requires a separate line
7. Nearo Coins used (−₹X) · "Funded by Nearo". The coins toggle sits directly above, shown only when `can_redeem`.
8. **Total**
9. Already paid (visit fee/advance; cash only)
10. **To pay now**: the only amount on the Pay button, **returned by the server**
11. Pay later (remaining milestones) with its trigger
12. "Paid to Nearo and held until the job is done, then released to <Provider>"
13. One-line refund summary + "How refunds work"

## 5. Provider billing form (quote editor), exact order

1. Header (read-only): booking ref · customer first name · service
2. "Add from my rate card" chips
3. Per line: **Type** (Labour / Parts / Other) → **What is this for?** → **Qty + unit** → **Unit price ₹** → line amount → (Parts > ₹500) **Bill photo, required** (server-enforced)
4. "+ Add line"
5. Note for the customer (optional)
6. Sticky summary:
   - Quote total
   - Customer pays (incl. platform fee)
   - Commission (x% of labour)
   - GST on commission
   - **You receive**
   - "Paid to bank ••••1234 about 24 h after the customer confirms"
   - Remove the "before statutory TDS/TCS" text until TDS/TCS exists.
7. Send (disabled until the server rate is loaded and validation passes)

**Sports price rule form:**
- Days · From/Until (time pickers) · Price per slot ₹ · Label · **"You receive ₹X per slot"**
- Rules can be edited and deleted.

**Proposal form:**
- Total ₹ · Deliverables · **Revisions included** · **Deliver by**
- Advance chips (0/30/50%) with the preview "₹X now, ₹Y on delivery"
- **"You receive ₹Z"**

## 6. Customer payment receipt (platform-issued, non-tax; can ship before the tax review)

**Trigger:** each successful payment and each refund. **Fields:**

| Field | Example |
|---|---|
| `receipt_no` (sequential, unique per FY) | NR-2026-000456 |
| `issued_at` | 05 Nov 2026, 4:12 PM |
| `status` | Paid / Refunded / Partly refunded |
| `booking_ref`, `category`, `provider_display_name` | NR-1A2B3C4D · AC repair · Ravi K. |
| `customer_name`, `customer_locality` | — |
| `items[] {description, kind, qty, unit_price, amount}` | Gas refill (labour) 1 × ₹1,500.00 |
| `subtotal`, `platform_fee`, `tax_lines[]`, `coins_discount`, `total` | ₹2,150.00 · ₹29.00 · — · −₹50.00 · ₹2,129.00 |
| `prior_payments[]` | Visit fee 03 Nov −₹199.00 |
| `this_payment {amount, method, gateway_ref, paid_at}` | ₹1,930.00 · UPI · pay_XXXX |
| `balance_due` | ₹0.00 |
| `refunds[] {amount, status, processed_at}` | none |
| footer | Money is held by Nearo and released to the provider 24 h after you confirm completion. Disputes: Booking → Report a problem. |

The method must be stored from the gateway payload. Today it is not stored (WS9).

## 7. Provider / merchant earnings statement (platform-issued)

**Trigger:** per payout plus monthly. **Fields:**
- Header: `statement_no`, `period_start`, `period_end`, `provider_legal_name`, `pan_masked`, `bank_last4`, `ifsc`, `gstin?`
- Rows: `booking_ref, date, customer_paid, your_bill (gross), commission, gst_on_commission, other_deductions, reversals, net, status, transferred_at, utr`
- Totals: `your_bill, commission, gst, adjustments, tds_tcs (after review), net`
- Buckets: `pending (release date)`, `on_hold (dispute)`, `failed`
- Notes: "The platform fee paid by the customer is not part of your bill. Coins are funded by Nearo and never reduce your payout."

**Venue owners and shops see the same statement.** Venues today have none (WS7).

## 8. Refunds, cancellations and disputes

| Case | Rule (server) | TODAY | RECOMMENDED |
|---|---|---|---|
| Customer cancels (home services) | `_cancellation_outcome` policy snapshot; `floor(principal × bp) + floor(platform × bp)`, capped at paid − prior refunds | PASS (SQL) | Show the **server preview** before confirming (WS1-03, WS2-03) |
| Customer cancels with coins used | Cash refund per policy + restore redeemed coins once | **FAIL** (assert rolls back) | WP-F4 |
| Provider cancels | Customer full refund | Abusable `customer_payment_default` (**P0-08**) | Allowed only when a payment obligation is actually overdue and unpaid; never after any paid capture |
| Sports | 100% / 50% / 0% by notice | PASS (SQL) | Refund preview; venue retained-share payout (**P0-13**) |
| Creator before delivery | — | No exit (**P0-11**) | Cancel/dispute while `delivery_pending`; refund advance if `deliver_by` is missed |
| Creator after delivery, unpaid | — | Stalls (**P0-10**) | Auto-accept after the D2 window; payment-default path for the creator |
| Duplicate / late / wrong-amount capture | Full refund of the extra row | Sports PASS; home services **swallowed** | Refund on a new row (WP-F1) |
| Refund fails 5× / recorded mismatch | — | No alert | Reconciliation + admin alert (WP-F6) |
| Refund after provider settlement | Route reversal / provider receivable netted on the next payout | PARTIAL | Admin visibility + test |
| Chargeback | — | NOT IMPLEMENTED | Freeze the payout, record a receivable (WP-F6) |

## 9. Coins (Nearo Coins; currently "Seva Coins")

TODAY (PASS unless noted):
- **Ledger and expiry:** FIFO ledger with lots and unique refs; 6-month expiry.
- **Earning:** 1% of eligible value, floored to the coin unit. Caps: ₹20 per booking and ₹1,000 per month. ₹10 first-earn bonus. ₹10,000 pilot budget.
- **Redemption:**
  - Inspect-quote approval only.
  - Limit: ≤ 10% of service value and ≤ net platform revenue.
  - Once per booking.
  - The coin payment row never funds provider transfers.
- **Clawback:** proportional clawback after refunds.

RECOMMENDED:
1. Quote approval must not fail when redemption is off (WS9-01): send `use_coins=false` unless the user opts in, and have the server ignore it when disabled.
2. Restore redeemed coins exactly once (WS9-04).
3. The wallet shows every cap in plain words: "Up to ₹20 back per booking, max ₹1,000 a month, expires after 6 months".
4. Every history row links to its booking.
5. The admin form takes ₹ and % values.
6. No referral or promotion engine before pilot. If one is built later, it uses the same ledger with `referral:<referee_id>` refs, pays only after the referee's first **paid and closed** booking, and is capped per referrer.

## 10. Document responsibility matrix (requires professional tax/legal review)

| Document | Issuer | Trigger | Ship when |
|---|---|---|---|
| Payment receipt (non-tax) | Platform | each payment/refund | **G2** (before real payments) |
| Service bill / tax invoice for the service | Provider; or the platform where liable (e.g. GST s.9(5) categories, per `docs/07:395`) | job completion | after tax review |
| Platform-fee invoice to customer | Platform | with the payment containing the fee | after tax review |
| Commission tax invoice to provider | Platform | each payout or monthly | after tax review |
| Provider/merchant settlement statement | Platform | per payout + monthly | **G2** |

## 11. Admin finance views (minimum for G2)

- **Per booking:**
  - Every payment row: gateway id, method, captured_at
  - Every refund: status, attempts, last error
  - Coins movement
  - Payout: gross, commission, GST, net, status, transfer id, UTR, failure reason
  - Disputes
  - The `admin_audit_log` entries for that booking
- **Actions:** retry payout and retry refund, both audit-logged and role-checked server-side.
- **Daily reconciliation report:** gateway captures/refunds/transfers vs DB rows; mismatches are listed with amounts.
