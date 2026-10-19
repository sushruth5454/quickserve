# QuickServe — Pricing, Payments & Commission (Product Decision)

## 1. The core problem
Service jobs have **uncertain scope**. An "AC not cooling" job might be a ₹300 filter clean, or a ₹2,500 gas refill plus a ₹1,800 capacitor. A fixed upfront price (Urban Company style) needs standardized SKUs and a trained workforce, and we don't employ anyone. Pure "pay the guy cash" gives us no revenue and no accountability.

## 2. Options considered

| Model | How it works | Pros | Cons | Verdict |
|---|---|---|---|---|
| A. Fixed price catalogue | Customer picks "AC gas refill ₹2,499" | Simple, transparent | Wrong for unknown faults; providers lose on hard jobs | Use **only** for well-defined jobs (cleaning, tank cleaning) |
| B. Lead fee (pay per lead) | Provider pays ₹30–100 per customer request | Revenue even if job goes offline | Providers hate paying for bad leads; no payment control | Rejected for MVP |
| C. Subscription for providers | ₹499/month to be listed | Predictable | Kills supply in cold start | P2 maybe |
| **D. Visit fee + on-site itemized quote + commission (chosen)** | Upfront visit fee → inspect → itemized quote → customer approves → pay in app → commission deducted | Handles variable scope, transparent, we're in the money flow | More steps; needs a good quote UI | **Chosen** |

## 3. Chosen model — "Inspect, Quote, Approve, Pay"

```
 Customer books ──► pays VISIT FEE (e.g. ₹199) ──► captured by the payment aggregator (not yet transferred)
                                │
            Provider arrives (start OTP) and inspects
                                │
        Provider sends ITEMIZED QUOTE in app:
           Labour: Gas refill ............ ₹1,500
           Parts : Capacitor 45uF ........ ₹  650   (bill photo)
           Other : —
                                │
             ┌──────── Customer ────────┐
          Approve                      Reject
             │                           │
     Customer PAYS THE BALANCE      Job closes. Visit fee is
     NOW, before work starts        paid out to the provider
     (quote total + platform fee    (minus commission)
      − visit fee already paid)
             │
     Work is done (a change order needs re-approval
     AND payment of the increase before work continues)
             │
     Provider requests completion → customer shares end OTP
             │
     24 h dispute window → payout transferred to provider
```
Collecting before work means a provider is never left unpaid after supplying labour and parts.

**Pricing rules**
1. **Visit fee** is set by the provider per skill, within a city band (e.g. ₹99–₹299). It is credited against the final bill if the customer approves the quote.
2. **Parts** above ₹500 per line need a bill photo. Parts are passed through at cost plus up to 10% handling (shown).
3. **Fair price range**: for common job types we show a typical range ("Most AC gas refills in Vijayawada cost ₹2,000–₹2,800"), computed from completed jobs. This protects customers from overquotes.
4. **Change orders**: any increase over the approved total needs a new approval and payment of the increase before work continues.
5. **Fixed-price SKUs** (deep cleaning, tank cleaning per 1,000 L) skip the quote step: the customer pays the full amount at booking, and the flow goes `inspecting → in_progress` directly. **Not in the MVP launch scope.**

## 4. Commission (take rate)

| Component | Rate | Who pays | Notes |
|---|---|---|---|
| Commission on **labour** (the visit fee is credited into labour when a quote is approved; if the quote is rejected, commission applies to the visit fee alone) | **12%** (launch: **0% for a provider's first 30 days**) | Provider (deducted from payout) | **Canonical tiers:** 12% → **10% after 50 in-app jobs** → **8% after 200**. Rewards staying on-platform. |
| Commission on **parts** | **0%** (parts are pass-through) | — | Avoids incentivizing over-selling parts. |
| **Customer platform fee** | ₹29 flat per booking, **GST-inclusive** | Customer | Charged once, with the balance payment. Partly offsets gateway fees and funds the guarantee. |
| Cash job commission | Same tiered rate on labour, accrued as provider debt | Provider | Deducted from the next payout; a debt over ₹1,000 blocks new jobs (P1). |

> **Tax caveat:** statutory deductions from the provider payout (GST TCS, Income-tax s.194-O TDS ~0.1%) and possible ECO liability under GST s.9(5) for housekeeping-type services are **not** in these figures. They come from the CA-approved tax matrix (PRD PAY5) before live payments.

**Worked example** (AC gas refill, provider past the free period):
```
Visit fee 199 (credited) | Labour 1,500 | Parts 650 | Platform fee 29
Customer pays total:  1,500 + 650 + 29 = ₹2,179   (199 at booking + 1,980 on quote approval, before work)
Commission: 12% × 1,500 = ₹180 (+18% GST on commission = ₹32.40)
Provider receives: 2,150 − 180 − 32.40 = ₹1,937.60 (before statutory TDS/TCS)
```

**Contribution per job (assumptions to verify at Razorpay onboarding):**
| Line | ₹ |
|---|---|
| Commission (net of the ₹32.40 GST, which is remitted to the government) | 180.00 |
| Platform fee net of GST (29 / 1.18) | 24.58 |
| Gateway fee: ~2% + 18% GST on ₹2,179 (Razorpay standard pricing applies to UPI too) | −51.42 |
| Route transfer fee (~0.1% of the ₹1,937.60 transferred + 18% GST, if charged) | −2.29 |
| **Contribution before refunds, guarantee claims, support, marketing** | **≈ 151** |

At 2,000 jobs/month that's about **₹3 lakh/month of contribution** in one city, before operating costs.

## 5. How money flows technically (Razorpay Payment Links + Route — India)
Razorpay Route lets a marketplace collect a payment and **transfer** part of it to linked accounts (the providers). The licensed payment aggregator handles the funds, so QuickServe doesn't need its own RBI PA license. **Single integration contract:** Payment Links (opened in the in-app browser, so no native SDK is needed) + one webhook event.

1. Provider onboarding → create a **Linked Account** (Route API); Razorpay performs payout KYC.
2. Booking → Edge Function creates a **Payment Link** for the visit fee (`payments.purpose='visit_fee'`, stores `razorpay_link_id`).
3. Webhook `payment_link.paid` (signature-verified, deduplicated by `razorpay_payment_id`) → booking `pending_payment → requested`.
4. Quote approved → Payment Link for the balance (`purpose='balance'`) → webhook → `awaiting_payment → in_progress`. Change orders charge only the increase.
5. `completed` → a `payouts` row with `release_after = completed_at + 24 h`. The provider share is split into `payout_transfers`, sourced first from the visit-fee payment and then from the balance/increment payments; no transfer can exceed its source payment. Example: labour ₹300, visit fee ₹199, balance ₹130 → provider share ₹257.52 = ₹199 from the visit-fee payment + ₹58.52 from the balance payment. A cron function creates one **Route transfer** per row (`POST /v1/payments/{source_id}/transfers`) after the window, if no dispute is open. Payouts are also created for `closed_no_work` and chargeable cancellations (sourced from the visit-fee payment). Commission stays in our account.
6. Refunds via the Refund API per PRD §5.10; gateway fees on refunds are absorbed by QuickServe.

Outside India, the same design maps to **Stripe Connect (Express accounts, separate charges & transfers)**.

## 6. Anti-leakage (stopping people from paying offline)
- The **7-day QuickServe Guarantee** (free rework; if rework isn't possible, a labour refund up to ₹2,000; same definition as PRD §5.9) applies only to in-app-paid jobs.
- Ratings and reviews only count for in-app-paid jobs, so providers need them to rank.
- Lower take rate than incumbents, plus tiers that reward loyalty.
- Masked phone numbers (P1) and chat monitoring for "pay me directly" phrases.
- Fast, predictable payouts: release starts right after the 24 h dispute window, subject to Razorpay transfer/settlement timing.

## 7. Decisions log
| # | Decision | Reason |
|---|---|---|
| D1 | Visit fee + itemized quote | Handles variable scope fairly |
| D2 | Commission on labour only, not parts | Avoids upselling parts; simpler GST |
| D3 | Customer platform fee (₹29, GST-incl.) | Keeps provider take rate low, which is the supply magnet |
| D4 | Razorpay Payment Links + Route transfers after the dispute window | Licensed PA, no RBI license needed by us; no native SDK |
| D5 | 0% commission for the first 30 days | Cold-start supply incentive |
| D6 | Balance collected **before** work starts | Provider is never unpaid for finished work |
