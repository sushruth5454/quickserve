# Oorva Critical audit — Money (MN)

> **Implementation authority:** use [doc 18](../18-Oorva-Transformation-Implementation-Plan.md) and [`execution-plan.json`](../design/oorva/execution-plan.json) for the actual dispatch stage, file/function locks, migration claim and validation command. This source audit supplies verified current behavior, required changes and acceptance. A proposal filename is not a numeric reservation.


| Item | Baseline |
|---|---|
| Scope | **11 assigned screens**, payment/refund/payout/transfer lifecycles, transaction-card contract |
| Source | `2f1e4638b145185b9e58c4c62e58f5c6dd491fa1`, immutable `oorva-audit-main-2f1e4638` snapshot |
| Date | November 20, 2026 |
| Evidence | Complete assigned route bodies; actual client APIs/helpers; latest defining SQL/Edge paths; existing test source; three supplied earnings images |
| Detailed contract | [`money.json`](../design/oorva/audit/money.json): full source references, actor/state/readback matrices, exact task files/functions and assertions |
| Execution | **Read-only audit. No app/runtime tests, builds, installations, production requests, money operations, source edits or deployment.** |

## Summary

- **71 placement rows; 4 entity lifecycles; 1 transaction-card contract.**
- **15 findings:** 13 confirmed current source defects, 2 required design changes. **P0: 0; P1: 5; P2: 10.**
- **16 implementation tasks, 16 retain cases, 43 named acceptance cases.** These cases are specifications, **not executed results**.
- All assigned source coverage is complete; **no source-access coverage blocker** remains.
- Existing policies, money formulas, historical financial records and the implementation plan were not changed.

The most important current gaps are premature refund-completion claims, financial classification of demo sessions, bank-paid claims from dispatch/offset records, missing refund-retry capacity checks, and optimistic hosted-checkout failure copy. The latest receipt-trigger protection for sports/pack payments is **already present** and must not be re-reported.

### Evidence notation

Paths are relative to the frozen source root. `SQL/` below means `supabase\migrations\`; `EF/` means `supabase\functions\`. Slash notation in these two labels is prose shorthand only; actual paths in the JSON use Windows separators.

| Screen alias | Exact source file |
|---|---|
| E10 | `app\app\(provider)\earnings.tsx` |
| A13 | `app\app\admin\audit.tsx` |
| A14 | `app\app\admin\booking\[id].tsx` |
| A15 | `app\app\admin\bookings.tsx` |
| A17 | `app\app\admin\coins.tsx` |
| A18 | `app\app\admin\commission.tsx` |
| A21 | `app\app\admin\fees.tsx` |
| A24 | `app\app\admin\payouts.tsx` |
| A26 | `app\app\admin\refunds.tsx` |
| E44 | `app\app\earnings-statement.tsx` |
| R67 | `app\app\receipt\[paymentId].tsx` |

### Actual supplied visual evidence

Inspected only:

- `before-web-44696642603\119-earnings.png`
- `before-web-44696642603\120-earnings-scrolled.png`
- `before-web-44696642603\142-dark-earnings.png`

The light/dark initial frames show the large earnings chart before readiness. The scrolled frame **visibly truncates the Next payout timing explanation with an ellipsis**. “Paid to bank” is visibly rendered, but the image cannot establish actual bank credit. The source constraints are E10:264–275, 497–503.

The coordinator supplied the application-code parity verification for artifact head `229995fe3194de39684f12ef348d3e37930ae5f2`. This audit did not independently run `gh`. Neither the failed hosted run nor screenshot filenames establish runtime feature settings, money provenance or an application regression. The other ten assigned screens have **source evidence only**, not visual PASS.

## Findings

Class **A** applies in legacy and Oorva views. **B** is display identity. **C** is optional family composition. A presentation switch must never disable existing money resolution.

| ID | Priority / class | Verified current condition → exact correction | Evidence |
|---|---|---|---|
| MN-F01 | P1 / A | Fresh/stale refund worker completes by gateway ID alone; parent `booking.status=refunded` also precedes cash processing. Retain processing until proved processed; make parent-only copy “Refund arranged.” | `EF/process-refunds\index.ts:77–100`, `logic.ts:94–107`; `SQL/0088b_b6_money_notifications.sql:651–689`; `0076_f4_refund_dispute_engine.sql:575–606`; `app\src\features\bookingDetail\model.ts:115–124` |
| MN-F02 | P1 / A | Latest session finalizer inserts default `pending` and a transfer for a `pay_demo_` source. Tag new synthetic session payouts `demo`, skip their transfer only; preserve live formulas/completion updates. | `SQL/0060b_demo_payout_isolation.sql:42–56`; `0075_f2_commission_correctness.sql:520–569` |
| MN-F03 | P1 / A | Local `transferred` includes gateway queued/processing and fully netted offsets, yet UI/notification says bank-paid. Use “Transfer recorded / offset”; qualify historical timestamps. **No dispatch-policy change.** | `EF/_shared\payout-rail.ts:426–450`; `release-payouts\index.ts:125–142`; `SQL/0060b:322–325`; `0088b:711–741`; E10:234–236, 346–354 |
| MN-F04 | P1 / A | Failed refund is excluded from new reservations but retry requeues it without checking sibling capacity. Lock/recheck payment reservation capacity before retry; reject stale excess, never clamp policy amount. | `SQL/0001_init.sql:653–667`; `0076:67–90` |
| MN-F05 | P1 / A | Hosted checkout displays success-styled “Payment received…within a minute” for non-OK and transport/JSON failures. Preserve confirmation uncertainty and distinguish refund-queued/review-required recorder outcomes. | `web\checkout\index.html:56–70`; `EF/verify-payment\index.ts:33–58`; `_shared\record-payment.ts:37–50` |
| MN-F06 | P2 / A | Original receipt snapshot is displayed as current refunds/balance; refund-state payments lose receipt CTA; universal 24-hour copy contradicts proposal configuration. Preserve original evidence, add authorized live refund overlay and historical labels. | `SQL/0084_b2_receipts.sql:161–248`; `0082_c1_creator_delivery_safety.sql:147–154`; R67:136–160; `formatReceipt.ts:31–36,42–90` |
| MN-F07 | P2 / A | Partial form uses cash cap while server also caps existing `payout.amount`; note requirement is UI-only; null outcome falls through; other resolve buttons stay active while busy. Mirror cap, enforce existing partial-note rule/outcome validity, disable all resolution controls. | A14:33–89, 180–213; `SQL/0076:520–558,629–631` |
| MN-F08 | P2 / A | Admin “paid” combines cash/coins, ignores partial-refund children, drops fully refund-queued captures; stuck JSON omits sports/pack parents; stale processing with no error is absent from payout queue. Add explicit safe projections, no new actions. | `SQL/0041_admin_support.sql:355–374`; `0076:105–131`; `0086_o3_admin_money_visibility.sql:188–209`; `0078_f6_reconciliation_chargebacks.sql:192–200` |
| MN-F09 | P2 / A | Out-of-order range/filter reads, mount-only detail/receipt refresh, suppressed earnings reload errors, receipt error-to-null and conflated saved-config/readback failure. Use identity-keyed latest-read guard and truthful focus/manual/error states. | E10:62–87, 152–162; E44:51–63; A13:23–35; A14:21–30; A15:16–20; A17:118–124; R67:31–56 |
| MN-F10 | P2 / A | Earnings calls verified RazorpayX provider “pending” unless a Route account exists; clarification/suspended/review states collapse. Display actual KYC verification state, not reconstructed overall readiness. | E10:248–259; `SQL/0060b:291–299`; `app\src\lib\types.ts:23` |
| MN-F11 | P2 / A | Statement `net=po.amount` is current and reduced by dispute resolution, but labelled “before reversals.” Rename current-amount labels; show reversal history separately without another deduction. | `SQL/0085_b4_provider_statement.sql:62–78`; `0076:590–626`; E44:125–139, 191–198 |
| MN-F12 | P2 / C | Required redesign: readiness/problems before secondary history/settings, consistent contextual transaction cards and deliberate config review. Surface existing fixed/proposal config without inventing policy; preserve legacy omitted subtrees. | E10:164–294; A14:118–214; A26:118–169; A18:15–36; `SQL/0075:221–301` |
| MN-F13 | P2 / B | Receipt chrome contains Nearo literals; current contract has no legal issuer field. Rebrand display only, preserving original NR/QS/snapshot/reference identity; no guessed Oorva legal issuer. | R67:78–85, 116–119, 157–170; `app\src\lib\apiTypes.ts:174–204`; `SQL/0084:176–213` |
| MN-F14 | P2 / A | Important earnings timing/breakdown/reference text is forced to one line; actual Next payout ellipsis is visible. Wrap/stack meaningful text in legacy and new views; never round away paise. | E10:264–275, 340–354, 494–503; inspected scrolled earnings image |
| MN-F15 | P2 / A | Daily reconciliation compares raw tranche amount with net cash after recovery, and can compare synthetic offsets/demo rows with real gateway money. Compare dispatched cash and exclude only explicit synthetic references. | `SQL/0060b:322–339`; `EF/reconcile-payments\index.ts:88–159`, `logic.ts:146–194` |

**No observed live overpayment is asserted.** MN-F04 proves local over-reservation; the gateway may reject it. MN-F02 proves false financial pending classification; the claim still excludes synthetic source IDs. MN-F15 proves a deterministic comparator mismatch, not that a live alert fired.

## Screen placement audit

Every row names current placement, verified problem/retain, target/reason and a named acceptance case. The JSON carries expanded references and actor/state cases.

### S10 — Owner earnings · E10 · 8 rows

Purpose: understand recorded earnings/problems and open relevant existing work/statement. **No withdrawal or owner retry action.**

| Element | Current / problem or retain | Target / reason | Evidence; case |
|---|---|---|---|
| Period/chart | First large card; period applies to hero/chart, not following all-time totals. Retain exact periods/sums. | Compact period-labelled recorded earnings; label all-time summaries explicitly. | E10:89–137,164–232; `MN-CLASS-C-PARENTS` |
| Pending/transferred | Under chart; “Paid to bank” is unsupported by local transferred alone. | Same stored amount, “Transfer recorded / offset”; separate bank uncertainty. | E10:119–130,234–240; `MN-PAYOUT-QUEUED-NOT-BANK` |
| Hold/problems | Second summary row already distinguishes frozen/failed. **Retain.** | Elevate nonzero operational issues; no invented owner retry. | E10:238–243; `MN-PAYOUT-RETRY-GUARDS` |
| Commission terms | TierCard before readiness; server terms/unavailable handling already exist. | Secondary after readiness/history entry; defaults do not override booking snapshots. | E10:243,386–470; `MN-COMMISSION-PRESERVE-EXTENSIONS` |
| Verification | Requires Route account plus verified KYC; other states mostly become pending. | Actual KYC verification label and existing manage route, not total eligibility. | E10:245–260; `MN-READINESS-RAILS` |
| Next payout | One shrinking line; inspected image truncates awaiting-transfer timestamp. | Full wrapped amount/not-before time/explanation before secondary terms. | E10:264–275,474–505; `MN-CARD-REFERENCE-WRAP` |
| Statement | Conditional third InfoLine. **Retain existing capability.** | Near period/readiness when enabled; OFF cannot be bypassed by Oorva. | E10:277–287; `MN-STATEMENT-PERIOD-ACCESS` |
| Transactions/refresh | Last, one-line financial metadata; refresh errors hidden with old rows; old transferred timestamp says Paid. | Safe typed card, full values, qualified time and visible stale/error state. | E10:62–87,152–162,309–356; `MN-READBACK-EARNINGS-ERROR`, `MN-PAYOUT-POSTFAIL-TIMESTAMP` |

### S13 — Admin audit · A13 · 5 rows

Purpose: read actual administrative evidence; primary action **Apply target filter**, never mutate the log.

| Element | Current / problem or retain | Target / reason | Evidence; case |
|---|---|---|---|
| Target filter | First card; full UUID validation and route target handling. **Retain.** | Compact active-target context; short display reference is not PK. | A13:7–58; `MN-AUDIT-IMMUTABLE` |
| Action heading | Raw action key prettified per card. **Retain identity.** | Readable title with original key in disclosure; no stored-event rename. | A13:61–67; `MN-AUDIT-IMMUTABLE` |
| Actor/time | Second line already records actor and time. **Retain.** | Keep directly below action; expanded UUID, no phone-based identity. | A13:63–65; `MN-ROLES-SAME-PK` |
| Target/details | Always-visible raw JSON competes with primary evidence. | Full target plus safe structured disclosure; no edit/delete. | A13:65–66; `MN-AUDIT-IMMUTABLE` |
| Read states | Focus reset, explicit error/empty; no latest-target guard. | Ignore superseded results; distinct empty/error/manual retry. | A13:17–44,59–60; `MN-READBACK-LATEST-KEY` |

### S14 — Admin service booking detail · A14 · 8 rows

Purpose: inspect the same booking PK and resolve a dispute **only while disputed**. A booking resolution queues money work; it does not prove gateway completion.

| Element | Current / problem or retain | Target / reason | Evidence; case |
|---|---|---|---|
| Header/navigation | Global payout/audit buttons before booking summary. | Booking identity/status first; contextual audit, global tools secondary. | A14:91–108; `MN-ADMIN-URGENCY-ORDER` |
| Parties/total | Private admin context and stored total. **Retain authorization.** | Compact summary; do not export raw private payload to shared/public cards. | A14:101–108; `MN-ROLES-SAME-PK` |
| Payments | Purpose/status/amount only. | Funding/capture/refund qualifiers; cash, coins and attempts differ. | A14:109–117; `MN-ADMIN-CAPTURE-REFUND-COIN` |
| Timeline | Before current money diagnostics and dispute action. **Retain evidence.** | After urgent money/actions, preserving original event order/actor. | A14:118–125; `MN-ADMIN-URGENCY-ORDER` |
| Refunds | Below timeline; child status/error/attempts already separate. | Adjacent to payment; queued/processing/processed distinctions after worker fix. | A14:126–136; `MN-REFUND-SUBMIT-PENDING` |
| Payouts/transfers | Separate sections. **Retain distinct entities.** | Adjacent, rail/gateway context and qualified timestamps, not bank-paid shortcut. | A14:137–162; `MN-PAYOUT-QUEUED-NOT-BANK` |
| Reversal/debt | Separate recovery records and outstanding balance. **Retain.** | Adjustment subsection; no double deduction or refund/recovery equivalence. | A14:163–179; `MN-STATEMENT-NET-CURRENT` |
| Resolve panel | Last; UI cash cap/note differs from server payout cap/note checks; partial alone globally disables busy. | Early anchor to guarded panel; effective cap, server partial note/outcome checks, all buttons disabled while busy. | A14:33–89,180–214; `MN-PARTIAL-CAP-PAYOUT`, `MN-PARTIAL-NOTE-ROLE` |

### S15 — Admin bookings · A15 · 6 rows

Purpose: service-booking search/triage; primary action **open existing detail**. Results are newest-first, limited to 200, not a universal order ledger.

| Element | Current / problem or retain | Target / reason | Evidence; case |
|---|---|---|---|
| Search | Request on query change, no generation guard. | Keep first; only latest query/filter/caller may update results. | A15:12–23; `MN-READBACK-LATEST-KEY` |
| Filters | Active/Disputes/All use backend semantics. **Retain.** | Visible selected context; do not combine booking and payment enums. | A15:24–28; `MN-ADMIN-CAPTURE-REFUND-COIN` |
| Identity/status | Category, parties, city/date; no visible booking reference. | Reference/category/status first, then parties/schedule. | A15:30–36; `MN-CARD-REFERENCE-WRAP` |
| Money | Legacy status-only sum says “paid.” | Explicit real cash/coins/demo/refund buckets and net held. | A15:37–40; `MN-ADMIN-CAPTURE-REFUND-COIN` |
| Empty/error/refresh | Skeleton/error exist; successful empty array is blank; previous query can remain visible. | No matches, clear-filter/retry, visible current read state. | A15:16–20,29–42; `MN-READBACK-LATEST-KEY` |
| Detail/scope | Whole-card service-detail link. **Retain.** | Same route; latest-200 scope when at limit; no new mutation. | A15:29–41; `MN-ROLES-SAME-PK` |

### S17 — Admin coins · A17 · 6 rows

Purpose: program liability, existing runtime switches and configuration; primary action **Save configuration**, with independent immediate switch actions.

| Element | Current / problem or retain | Target / reason | Evidence; case |
|---|---|---|---|
| Liability summary | First card, server-derived. **Retain lot-based liability.** | Keep first with as-of/stale feedback; do not derive issued minus redeemed. | A17:156–166; `MN-COIN-FEES-AUTH-OFF` |
| Switches | Earning/redemption independently save; both disabled during switch write. **Retain.** | Clear OFF/balance-retention explanation and save state. | A17:130–145,168–187; `MN-OFF-SAFETY` |
| Units | Paise/bp explanation and denomination. **Retain validation.** | Units next to inputs; read-only conversion, no new formula. | A17:40–63,189–199; `MN-EDITORS-PAISE-UNITS` |
| Policy fields | Eight consecutive inputs. | Group denomination/earning/redemption/expiry-budget and review exact changes. | A17:189–201; `MN-EDITORS-FAIL-DIRTY` |
| Save readback | Saved config then summary read; same catch handles both failures. | Saved remains saved; summary refresh failure is a separate warning. | A17:106–127; `MN-EDITORS-FAIL-DIRTY` |
| Load/draft/layout | Focus clears draft, explicit initial error/skeleton. | Dirty-draft decision, keyboard-safe grouped view, reliable feedback. | A17:87–100,148–154; `MN-CLASS-C-PARENTS` |

### S18 — Admin commission · A18 · 6 rows

Purpose: edit existing supported policy; no historical repricing. Primary action **save policy or one category override**.

| Element | Current / problem or retain | Target / reason | Evidence; case |
|---|---|---|---|
| Default/founding | First policy section; current bounds. **Retain.** | Explicit archetype scope so a default is not mistaken for every booking rate. | A18:150–158; `MN-COMMISSION-PRESERVE-EXTENSIONS` |
| Standard tiers | Sorted Add/Remove editor, zero base/uniqueness/limits. **Retain constraints.** | Group with exact current-to-draft review. | A18:46–65,159–200; `MN-EDITORS-PAISE-UNITS` |
| Fixed/proposal | Existing backend supports them; form/type omits them. | Show/edit existing fields under optional composition; legacy omissions preserve stored subtrees. | A18:15–36; `SQL/0075:221–301`; `MN-COMMISSION-PRESERVE-EXTENSIONS` |
| Session/repeat | Separate rates and no-repeat explanation. **Retain.** | Scope-labelled groups and bp/percent units; no inferred sports policy. | A18:202–232; `MN-COMMISSION-PRESERVE-EXTENSIONS` |
| Categories | Blank inherits, zero is real override; void save reflected locally. | Explicit inherit versus 0, per-row feedback and authoritative reread. | A18:121–139,235–263; `MN-COIN-FEES-AUTH-OFF` |
| Save/dirty/error | Server-returned config exists; focus resets draft. | One guarded controller, dirty protection, local pending/saved/error state. | A18:85–119; `MN-EDITORS-FAIL-DIRTY` |

### S21 — Admin fees · A21 · 5 rows

Purpose: **existing new-booking fees**, not an historical repricing tool.

| Element | Current / problem or retain | Target / reason | Evidence; case |
|---|---|---|---|
| Capability OFF | Honest OFF message and existing Features route; server also checks. **Retain.** | Same in both layouts; OFF does not zero fees. | A21:115–124; `MN-COIN-FEES-AUTH-OFF` |
| Scope notice | Existing bookings keep saved fee. **Retain.** | Persistent editor context before fields. | A21:131–139; `MN-EDITORS-PAISE-UNITS` |
| Units/bounds | Rupees→paise, percent→bp, min≤max. **Retain.** | Fixed fees separate from proposal bp/min/max; unchanged serialized values. | A21:18–62; `MN-EDITORS-PAISE-UNITS` |
| Review | No draft review/dirty indication. | Current-to-draft config diff, not client price calculator. | A21:130–143; `MN-EDITORS-FAIL-DIRTY` |
| Read/save state | Focus reset, retryable load error, authoritative saved value. **Retain successes.** | Latest-key reads and explicit dirty/save/error decisions. | A21:75–112,125–128; `MN-READBACK-LATEST-KEY` |

### S24 — Admin payout problems · A24 · 6 rows

Primary action: **existing audited failed-payout retry**, never processing-transfer resend.

| Element | Current / problem or retain | Target / reason | Evidence; case |
|---|---|---|---|
| Queue coverage | Failed/error rows only; stale processing with no error omitted. | Include reconciler's ≥30-minute processing class, read-only. | `SQL/0086:188–209`, `0078:192–200`; `MN-ADMIN-PARENT-XOR` |
| Identity/amount | Provider, raw status, short payout/parent IDs; sports/service separated. **Retain parent distinction.** | Problem/status/amount first and full reference disclosure. | A24:55–73; `MN-CARD-REFERENCE-WRAP` |
| Transfer evidence | Status/attempts/error; fetched rail/gateway fields unused. | Rail/gateway/amount/age/full reference to diagnose actual state. | A24:74–81; `MN-PAYOUT-QUEUED-NOT-BANK` |
| Note/retry | Both-failed predicate, note and in-flight disabling. **Retain.** | Eligible-card footer; server still rechecks; no processing Retry. | A24:27–45,82–101; `MN-PAYOUT-RETRY-GUARDS` |
| Queued feedback | Correct queued toast followed by unguarded reload. | Same PK readback, pending until actual result, visible refresh failure. | A24:18–44; `MN-READBACK-FOCUS-OFF` |
| Audit/read states | Explicit loading/no-problems/error. **Retain.** | Current queue first, audit secondary; errors never mean no problems. | A24:48–54; `MN-CLASS-C-PARENTS` |

### S26 — Admin refunds · A26 · 6 rows

Primary action: **failed refund retry**. Dispute-window save is separate configuration.

| Element | Current / problem or retain | Target / reason | Evidence; case |
|---|---|---|---|
| Priority | Dispute settings before problems. | Current refund/transfer problems first, settings secondary. | A26:110–140; `MN-ADMIN-URGENCY-ORDER` |
| Refund context | Short refund/optional service booking; fetched payment ignored; sports/pack parents omitted. | Exact refund/payment and real supported parent, valid detail links only. | A26:9–19,139–162; `MN-ADMIN-PARENT-XOR` |
| Failed retry | Correct failed-only control; backend missing sibling-capacity recheck. | Retain control; enforce locked capacity and local error/readback. | A26:96–108,151–161; `MN-REFUND-RETRY-CAP` |
| Processing | Worker explanation, no manual retry. **Retain.** | Processing age/Refresh; no false completed state from gateway ID. | A26:151–161; `MN-REFUND-STALE-STATUS` |
| Transfers | Separate read-only failed/processing list. **Retain boundary.** | Parent/context and payout-triage link; not every processing row is stale. | A26:166–181; `MN-PAYOUT-RETRY-GUARDS` |
| Policy/error | Window validates 1–3650; retry error appears in settings card. | Keep fail-closed policy; per-operation errors and focused/manual reread. | A26:57–93,118–136; `MN-READBACK-FOCUS-OFF` |

### S44 — Monthly statement · E44 · 7 rows

Purpose: owner's **current payout-row projection for a UTC creation-date range**, not an immutable month-end tax/accounting statement.

| Element | Current / problem or retain | Target / reason | Evidence; case |
|---|---|---|---|
| Month/range | First selector, no obsolete-response guard. | Explicit UTC range; latest range/caller only; retain pull/focus. | E44:23–63,87–114; `MN-READBACK-LATEST-KEY` |
| Net/adjustment | Current `po.amount` labelled before reversals. | Current payout amount recorded; reversal history separately non-additive. | E44:120–141,191–198; `MN-STATEMENT-NET-CURRENT` |
| Demo | Correct helper excludes rows tagged demo; session writer fails to tag them. | Repair writer; no screenshot/build-mode guess. | E44:126–133; `MN-DEMO-SESSION-ONESHOT` |
| Operational totals | Pending/hold/problem already distinct. **Retain.** | Before detailed deductions; transferred is recorded, not bank-confirmed. | E44:137–141,159–174; `MN-PAYOUT-QUEUED-NOT-BANK` |
| Row/open action | Reference/date/status then breakdown; sports route checked first. **Retain.** | Safe read-only transaction card; no owner retry. | E44:145–190; `MN-ROLES-SAME-PK` |
| References/time | UTR hides transfer reference when both exist; historical transfer time unqualified. | Both full references, wrapping and state-qualified record time. | E44:200–207; `MN-CARD-REFERENCE-WRAP` |
| OFF/empty/error | Distinct capability OFF, skeleton, error, empty; server enforcement. **Retain.** | Same conditions under both layouts; current range retry. | E44:67–85,116–149; `MN-STATEMENT-PERIOD-ACCESS` |

### S67 — Payment receipt · R67 · 8 rows

Purpose: preserve the **original non-tax receipt** while separating present payment/refund facts.

| Element | Current / problem or retain | Target / reason | Evidence; case |
|---|---|---|---|
| Display/issuer | Literal Nearo title/funder; no issuer field. | Approved display chrome separate from original identity; no guessed legal issuer. | R67:78–85,116–119; `MN-RECEIPT-BRAND-ISSUER` |
| Number/time | Original receipt metadata, IST formatter. **Retain.** | Prominent original receipt/issue labels; never renumber. | R67:80–85; `MN-RECEIPT-POST-ISSUE-REFUND` |
| Party/context | Snapshot parties/locality, no phone. **Retain privacy.** | Compact authorized context; no KYC/admin/bank expansion. | R67:88–94; `MN-ROLES-SAME-PK` |
| Breakdown | Original items/fees/discount/total. **Retain exact paise and signs.** | Wrapping original values and explicit synthetic-payment disclosure. | R67:96–120; `MN-EDITORS-PAISE-UNITS` |
| Paid/balance | Snapshot paid-now/earlier/balance presented without historical qualifier. | Original payment and Balance at issue time; no invented current debt. | R67:122–142; `MN-RECEIPT-POST-ISSUE-REFUND` |
| Refunds/entry | Paid-time snapshot; later refunds absent; helper hides receipt after refund starts. | Authorized live child overlay and retained issued-receipt entry in captured refund states. | R67:144–155; `formatReceipt.ts:31–36`; `MN-RECEIPT-REFUNDED-LINK` |
| Release/tax/action | Static 24 h promise; correct non-tax/Not issued and booking action. | Keep tax/action; stored-terms timing instead of universal promise. | R67:157–179; `SQL/0082:147–159`; `MN-RECEIPT-BRAND-ISSUER` |
| Read state | Mount/ID/flag effect; error→null/unavailable; no refresh. | Distinct retryable error and identity-keyed focus/manual reread. | R67:24–76; `MN-RECEIPT-READBACK-ERROR` |

## Actual lifecycle and composite contracts

### Payment — `public.payments`

**PK:** `id`; gateway link/payment IDs are individually unique nullable identifiers. Exactly one of `booking_id`, `pack_purchase_id`, `sports_booking_id` is nonnull. A display QS reference is not a PK. `payment_obligations` uses `(payment_id,schedule_id)` and allows one capture to settle several due obligations.

Evidence: `SQL/0001_init.sql:200–216`; `0029_single_due_payment.sql:14–23`; `0058_sports_payments.sql:55–68`.

| Actual state/action | Actor and authoritative condition | Readback / prohibited inference |
|---|---|---|
| `created` | Verified customer UID through Edge; prepare RPC checks actual parent customer, due rows/current state/hold and server amount. | Checkout amount/URL is not payment completion. |
| `created → failed` | Retired attempt or provider-order creation failure; current prepare path retires previous live links. | Keep history; do not count as captured cash. |
| `created → paid` | Service-only recorder after signed webhook or HMAC/order/capture verification. Current scheduled/hold predicates still decide acceptance versus refund. | Browser return is `opened`; captured-but-refund-queued is not booking accepted. |
| Extra/mismatched capture | Same gateway ID is duplicate no-op; different extra capture gets a **new payment PK**, exact amount and refund reservation. | Never overwrite original captured ID. |
| `paid` plus partial child | Partial refund can leave parent `paid`; sum/read child states. | A paid badge does not mean “no refund.” |
| `refund_pending → refund_processing` | Refund claim; only parent already refund-pending flips. | Claimed is not returned cash. |
| `refunded` | Completed child sum covers full parent amount. | Booking-level `refunded` can precede this; use composite. |
| Paid coin/demo | `funding_source=coins` or actual `pay_demo_` provenance. | Not real gateway cash; coin restore is ledger work. |

Sources: `SQL/0029:40–96,118–159`; `0030_review_fixes.sql:586–618`; `0088b:180–274,347–400`; `0072:544–612`; `0062_coins_hardening.sql:127–143,166–187`; `EF/verify-payment\index.ts:33–58`.

**Due/read parity actually read:** booking detail filters paid rows and subtracts non-failed child refunds, matching the shape of `_net_paid`; due schedule rows are separate. Admin `paid_paise` does **not** implement that composite. No new formula is proposed. Sources: `app\src\features\bookingDetail\BookingDetailScreen.tsx:227–251`; `SQL/0002_qa_fixes.sql:7–18`; `0041:355–360`.

### Refund — `public.refunds`

**PK:** `id`; many children per `payment_id`; unique nullable gateway refund ID. States: **`pending`, `processing`, `refunded`, `failed`**. Fields include amount, reason, attempts, retry/error/created/processed timestamps and `processing_started_at`.

| Transition | Actor/condition | Exact consequence |
|---|---|---|
| New → pending | Existing policy resolver through locked `_queue_refund` | Amount capped at remaining amount minus non-failed reservations; no completed claim. |
| pending → processing | Secret-authenticated cron/service claim, due retry time, `SKIP LOCKED` | Same refund UUID; start timestamp; optional parent processing state. |
| processing → terminal/retry | Worker/gateway event | **Current ID-only completion is MN-F01.** Target processed proof only; existing failure backoff/5-attempt behavior retained. |
| Stale processing | Claimed age 30 minutes–24 hours | Lookup before reset; lookup error deferred; no blind resend. |
| failed → pending | Admin-only current failed target | Same UUID/audit; add missing sibling-capacity recheck (MN-F04). |
| Demo completion | Actual source `pay_demo_` | Simulated `rfnd_demo_`, no gateway call, never real cash reimbursement. |

Sources: `SQL/0001:642–669`; `0076:67–90,135–241,276–297`; `0078:499–613`; `0088b:638–695`; `EF/process-refunds\logic.ts:27–45,68–107`.

**Exact source reproduction, not executed:** payment 20,000; failed child 12,500; another pending child 20,000. Current admin retry requeues the failed child and reserves 32,500. The fix rejects that stale retry, without claiming the gateway permits overpayment.

### Payout — `public.payouts`

**PK:** `id`; unique nullable service or sports booking parent, exactly one parent. Recipient fields are not PKs; their constraint is coalesced nonnull, **not recipient XOR**. States: **`pending`, `frozen`, `transferred`, `failed`, `reversed`, `partially_reversed`, `demo`**.

| Action/state | Authority/composite | Truthful meaning |
|---|---|---|
| Create service payout | Existing completion/cancellation resolver → `_create_payout` | Stored gross/commission/GST/current amount; synthetic branch already demo. |
| Create session payout | Latest `_finalize_session_completion` | Current demo classification gap only; live formulas retained. |
| Create sports payout | Paid online completed/customer-cancelled retained share | Venue owner `payee_id`; actual commission/release rule; not pay-at-venue platform cash. |
| Hold | Valid customer dispute or created/lost gateway dispute | Freeze pending money; existing sent money may need recovery. |
| Transfer recorded | All local child transfer records transferred, parent still pending | Dispatch/offset completion, **not universal bank credit**. |
| Failure | Terminal attempts or definitive gateway callback | A prior transferred timestamp can remain; current status wins. |
| Retry | Admin + failed parent + failed child + 1–500 note + locks | Pending/queued, same IDs and audit; not immediate payment. |
| Dispute resolution/reversal | Existing full/partial/denied/recovery branch | Current amount can reduce to zero; reversal/debt states are separate facts. |

Sources: `SQL/0001:234–248`; `0058:70–83`; `0075:394–452,502–570`; `0072:732–828`; `0076:590–631`; `0088b:711–859`; `0086:214–295`.

**Release is eligibility, not arrival:** ordinary completion uses 24 hours; accepted proposal delivery uses configured `proposal.dispute_hours` (fallback 168); sports has validated `release_after_hours`. Claim also checks child/parent retry/release times, actual source, dispute and rail destination. Sources: `SQL/0082:147–159`; `0072:780–796`; `0060b:283–302`.

**Statement correction example:** original stored net 8,820; existing partial resolution reduces current amount by 1,000 to 7,820; child reversal history 1,000 is shown separately. Do **not** display “before reversals,” reconstruct original net, or subtract again to 6,820.

### Transfer — actual table `public.payout_transfers`

**PK:** `id`; nonunique payout/source-payment relationships allow tranches/shared pack sources. States: **`pending`, `processing`, `transferred`, `failed`, `reversal_pending`, `reversed`, `partially_reversed`**. `reversal_pending` is declared; inspected current recovery queues a separate reversal record rather than inventing a current UI transition to it.

| Action | Exact boundary | Readback |
|---|---|---|
| Allocate | Captured non-demo source capacity after transfers/non-failed refunds; rail/release snapshot | Actual tranche UUID/source UUID, not assumed 1:1 payout. |
| Claim | Due child+parent pending, non-demo source, no service dispute, actual rail destination, `SKIP LOCKED` | processing with `processing_started_at`. |
| Dispatch | Route note lookup; RazorpayX same idempotency key on automatic retry | External ID/gateway state separate from local transferred. |
| Stale reconcile | Existing worker polls before reset; ≥30-minute claim | Existing queued/processing gateway object currently counts locally transferred, not bank-settled. |
| Gateway callback | Signed payout event; actual external ID lookup | processed metadata/UTR or later failed/reversed/rejected/cancelled status. |
| Admin retry | Failed parent+child, note and locks | Pending; sequence bumps only on definitive RazorpayX failure. |
| Full receivable offset | `amount - recovered = 0` | `netted_` completion, **zero gateway cash**. |
| Recover | Route reversal versus irreversible RazorpayX debt | Separate recovery PK/status; customer refund and provider recovery do not complete each other. |

Sources: `SQL/0001:250–264`; `0011_payout_rails.sql:46–56,131–176`; `0021_cancellation_availability_payouts.sql:603–650,692–836`; `0060b:271–339`; `0078:172–231,471–488`; `EF/release-payouts\logic.ts:120–146`; `EF/_shared\payout-rail.ts:264–308,426–453`.

**Daily reconciliation is not settlement proof.** It compares identity/amount and saves an issue report, not processed-versus-queued status or bank arrival. Its current gross-tranche/synthetic comparison gap is MN-F15. Sources: `EF/reconcile-payments\index.ts:88–188`; `logic.ts:146–194`.

## Cross-role same-entity matrix

| Actor | Actual read projection | Allowed existing action | Not allowed / refresh expectation |
|---|---|---|---|
| Service customer | Same `payments.id` and nested child refunds; receipt when enabled | Own currently due payment; existing policy cancellation/dispute | No arbitrary capture/status/refund retry. Reread money, not browser success. |
| Service provider owner | Same participant payment/refund rows; own payout and optional statement | Open work/statement; manage own verification | No customer Pay or admin retry; membership is not impersonation. |
| Venue owner payee | Sports booking aggregate and own statement/payee rows when enabled | Existing sports/verification/statement actions | `paid_at`/`refund_paise` is not refund completion; no owner retry. |
| Manager/staff | Existing authorized operational view; sports paid/refund aggregate where already permitted | Only existing operational actions | Does not gain owner's service receipt, payout statement or admin diagnostics. |
| Admin | Explicit admin money RPCs and permitted receipt | Existing disputed resolution and failed-only guarded retries | Do not assume ordinary participant table RLS provides blanket admin bypass. |
| Cron/signed gateway | Internal authorized money records | Claim/dispatch/reconcile/record under secret/signature checks | Ordinary authenticated callers cannot execute worker RPCs. |
| Stranger/anonymous | No private participant/owner/admin finance projection | No money mutation; signed checkout verification requires real signature | New shared card must not expose bank/KYC/admin/phone data. |

Evidence: `SQL/0001:421–431,1954–1962,2008–2064`; `0052_merchant_staff.sql:212–245`; `0059:7–19`; `0080_s2_sports_ops_ux.sql:226–256`; `0084:239–248`; `0085:12–21,49–90`; `0086:13–18,228–244`.

Each scenario uses **isolated fixtures**. Within one workflow, compare the **same PK** across its authorized projections; do not compare similar names, display references or different seed records. See `MN-ROLES-SAME-PK`.

### Current readback versus required repair

| Views | Current behavior | Exact repair |
|---|---|---|
| Earnings | Focus/pull; old rows suppress error | Same-key stale banner/as-of/retry; caller-key reset. |
| Statement | Focus/pull; month requests can race | Range/caller generation guard and UTC context. |
| Audit/bookings | Focus/filter/query; callbacks can race | Latest target/query/filter only; explicit successful empty result. |
| Admin booking | ID effect and local action reload only | Focus/app-active/manual and post-action authoritative read. |
| Payout/refund queues | Focus/post-retry reload | Queued≠done; local operation error and failed readback distinguished. |
| Receipt | Mount/ID/flag; error→unavailable | Authorized current overlay, focus/manual refresh, retryable error. |
| Settings | Focus clears draft; coin save/summary share catch | Dirty-draft protection; saved write separated from failed summary refresh. |
| Party booking payments | Booking UPDATE realtime/pull/local action | Child-only money reread on focus/app-active/manual; no assumed publication. |

`subscribeToBooking` watches only `bookings` (`app\src\lib\supabaseApi.ts:839–850`); initial publication adds messages/bookings (`SQL/0001:2123–2127`). No new production publication/polling is presumed.

## Transaction-card contract

One shared **presentation** contract, **not** one universal money status engine:

1. Transaction kind/purpose and actual parent reference.
2. Exact stored-paise amount.
3. Entity-specific status plus separate funding/refund/gateway/recovery qualifier.
4. Relevant event time; historical transfer time cannot override current failure.
5. Stored breakdown/current amount; reversals are not deducted twice.
6. Wrapping full references/diagnostic disclosure.
7. One contextual existing open action; eligible admin retry footer only.

No business photo is needed; retain a small semantic glyph. Loading, successful empty, unavailable/OFF and retryable error remain different. At 320px/200% text, stack metadata/actions rather than silently truncate amounts or timing. Actual native/browser captures are still required later.

**Exact new files/API:** `app\src\features\money\transactionPresentation.ts` receives a discriminated `MoneyTransactionInput` for payment/refund/payout/transfer with each actual enum and safe actor projection; returns labels/tones/breakdown/metadata/existing action descriptors. `app\src\components\money\TransactionCard.tsx` renders that model. It receives **no** raw bank/fund-account/KYC/admin/phone payload and no generic `mutateStatus` callback.

Reuse `formatINR`, `paymentRowLabel`, `paymentRefundPresentation`, `shouldShowPaymentRow`, `payoutStatusCopy`, `formatReceipt`. Existing sources: `app\src\lib\money.ts:59–67`; `features\bookingDetail\model.ts:13–51`; `lib\providerInsights.ts:20–76`; `features\receipts\formatReceipt.ts:42–90`.

Class-A data/copy repairs run in **both** old and new views. Proposed class-C leaves, each default OFF under `oorva_brand`: `oorva_provider_ux` (order 215), `oorva_admin_money_ux` (222), `oorva_booking_ux` (207), group **Oorva experience**. These are composition switches, not new money authorizations. Coordinator owns registry/parent graph/locales/shared primitives; preserve existing admin values with `on conflict do nothing`.

## Executable implementation tasks

**Not implementation authorization.** All backend changes are narrow forward repairs requiring existing financial-owner acknowledgement. **`UNASSIGNED_MN_SQL_01`** is the explicit coordinator claim token, represented by logical file `supabase\migrations\UNASSIGNED_MN_SQL_01_money_truth_guards.sql`. The numeric migration filename is **UNASSIGNED**: only the coordinator may bind a noncolliding number and serialize these named function repairs. No numeric filename is guessed. Historical source migration names remain exact and must not be edited.

Test paths used below:

- **SQL-MN:** `supabase\tests\mn_money_truth.test.mjs` — new full-chain `createHarness()/scenario()` suite.
- **PG-MN:** `supabase\tests\mn_money_concurrency.pg.test.mjs` — separate approved real-PostgreSQL overlap case.
- **Refund-Deno:** `supabase\functions\process-refunds\logic_test.ts`.
- **Verify-Deno:** `supabase\functions\verify-payment\logic_test.ts`; **Checkout-Deno:** same directory `checkout-status_test.ts`.
- **Recon-Deno:** `supabase\functions\reconcile-payments\logic_test.ts`.
- **Status-Jest:** `app\src\lib\__tests__\providerInsights.statement.test.ts`.
- **Receipt-Jest:** `app\src\features\receipts\__tests__\formatReceipt.test.ts`.
- **Admin-Jest:** `app\src\lib\__tests__\adminMoney.test.ts`.
- **Money-Jest:** `app\src\features\money\__tests__\{transactionPresentation.test.ts,useMoneyReadback.test.tsx,adminMoneyConfig.test.ts}`.

| Task / owner / class | Ordered exact edits and functions | Exact acceptance / named cases |
|---|---|---|
| **MN-T01** O32 + F4/F6/B6/O16 · A | Refund Edge `index.ts`/`logic.ts`: preserve response/lookup status; add service-only `record_refund_submission(uuid,text,text)` in proposed SQL, route explicit terminal evidence to `record_refund_status`; notify only processed. Booking `model.ts`/`BookingDetailScreen.tsx`: safe refund progress, no parent-only completion claim. | Partial 12,500 of 20,000 stays processing without terminal proof; full processed 20,000 completes once; non-admin worker calls denied; OFF never blocks resolution. **Refund-Deno/SQL-MN:** `MN-REFUND-SUBMIT-PENDING`, `MN-REFUND-SUBMIT-PROCESSED`, `MN-REFUND-STALE-STATUS`, `MN-OFF-SAFETY`; companion existing model suite. |
| **MN-T02** O32 + F2 · A | Forward `_finalize_session_completion(uuid,uuid)`: actual selected synthetic source → demo, no transfer; preserve capacity/rates/GST/live completion. | 10,000−1,000−180=**8,820** demo/no transfer; separate live fixture pending/one 8,820 transfer. **SQL-MN:** `MN-DEMO-SESSION-ONESHOT`, `MN-DEMO-PACK-SESSION`, `MN-LIVE-SESSION-PAISE`. |
| **MN-T03** O32 + B6 · A | `providerInsights.ts`, E10/E44/A14/A24: neutral recorded-transfer labels, qualified timestamps/render fetched gateway context. SQL `complete_transfer(uuid,text)` **notification text only**, no state/formula change. | Queued 8,820 and fully offset 8,820 never bank-paid; later failed wins over old timestamp. **Status-Jest/SQL-MN:** `MN-PAYOUT-QUEUED-NOT-BANK`, `MN-PAYOUT-NETTED-NOT-BANK`, `MN-PAYOUT-POSTFAIL-TIMESTAMP`. |
| **MN-T04** O32 + F4 · A | Forward `admin_retry_refund(uuid)`: parent reservation lock, child failed recheck/capacity sum, explicit conflict handling; local S26 capacity error. | 20,000+failed12,500+pending20,000 rejects; failed5,000+pending10,000 allows reserved15,000; two failed12,000 cannot both reserve20,000. **SQL-MN/PG-MN:** `MN-REFUND-RETRY-CAP`, `MN-REFUND-RETRY-ALLOW`, `MN-REFUND-RETRY-CONCURRENT`. |
| **MN-T05** O35/O35D coordinator · A | `verify-payment\logic.ts` outcome mapper and `index.ts` result; new `web\checkout\payment-status.js`, consumed by existing HTML. Preserve HMAC/capture/recorder routing. | HTTP401/409/500/network/malformed → pending, not received; refund:true→queued, exception→review; no second BYO claim. **Verify-/Checkout-Deno:** `MN-CHECKOUT-UNVERIFIED`, `MN-CHECKOUT-CAPTURE-VS-BOOKED`; retain `MN-CAPTURE-IDEMPOTENCY`. |
| **MN-T06** O16 + B2 · A | Forward recreate `get_receipt(uuid)` old fields plus safe current status/refunds/demo/read time, same capability/party/admin grants. `apiTypes.ts`, `supabaseApi.ts`, `demoApi.ts`, `formatReceipt.ts`, R67, PaymentsSection. | Original 10,000 receipt unchanged through 2,500 child; current child status separate; captured refund-state receipt CTA retained, coins/created/failed/OFF hidden. **SQL-MN/Receipt-Jest:** `MN-RECEIPT-POST-ISSUE-REFUND`, `MN-RECEIPT-REFUNDED-LINK`, `MN-RECEIPT-TRIGGER-RETAIN`, `MN-ROLES-SAME-PK`. |
| **MN-T07** O32 + F4 · A | Existing `adminMoney.ts`: `partialRefundLimitPaise(detail)`; A14 use cap/disable all busy actions. Forward `resolve_dispute`: nonnull valid outcome and existing partial-note rule server-side. | Cash20,000/payout17,640: ₹180 rejects, ₹176→17,600; null/blank/long partial note and non-admin/non-disputed deny; preserve whole-rupee UI. **Admin-Jest/SQL-MN:** `MN-PARTIAL-CAP-PAYOUT`, `MN-PARTIAL-NOTE-ROLE`. |
| **MN-T08** O32 + O3/F4 · A | Forward `admin_list_bookings(text,text)` additive funding/refund/net-held fields; `admin_list_stuck_money` actual parents; `admin_list_problem_payouts` stale class/timestamps. Update `adminApi.ts` and A14/A15/A24/A26 types/rendering. | Cash12,000+coins3,000−refund2,000: separate buckets/net-held13,000; supported parent IDs; stale no-error processing visible, no Retry. **SQL-MN:** `MN-ADMIN-CAPTURE-REFUND-COIN`, `MN-ADMIN-PARENT-XOR`, `MN-PAYOUT-RETRY-GUARDS`. |
| **MN-T09** O32 + O16 · A | New money `moneyReadback.ts` controller / `useMoneyReadback.ts`: key caller/role/entity/range/filter, generation guard, focus/app-active/manual reload. Consume in 11 routes and party booking money read; preserve dirty drafts/write-success. **Depends T06**. | Late prior month/filter/identity cannot overwrite; same-key stale error visible; receipt error retryable; saved config survives failed summary read. **Money-Jest:** `MN-READBACK-LATEST-KEY`, `MN-READBACK-FOCUS-OFF`, `MN-READBACK-EARNINGS-ERROR`, `MN-RECEIPT-READBACK-ERROR`, `MN-EDITORS-FAIL-DIRTY`. |
| **MN-T10** O32 · A | `providerInsights.ts`: `payoutVerificationCopy(KycStatus|null)`; E10 uses actual verification state, not Route-account conjunction. | Six actual states distinct; verified without Route ID not pending; unknown never verified. No private new projection. **Status-Jest:** `MN-READINESS-RAILS`. |
| **MN-T11** O32 · A | E44 rename current-amount/reversal labels; preserve `summarizeProviderStatement`; test through actual dispute/reversal writers. | Current7,820 and separate reversal1,000, not6,820; full current0/reversal8,820; no before-reversal claim. **SQL-MN/Status-Jest:** `MN-STATEMENT-NET-CURRENT`, `MN-STATEMENT-FULL-REVERSAL`. |
| **MN-T12** O32/O16 · C | New typed presenter/card, apply all placement hierarchies to actual existing controllers. Request coordinator-only default-OFF parent registration. **Depends T01/T02/T03/T06/T08/T09/T10/T11/T15.** | All71 rows covered; actual actor/state actions; brand OFF/child ON keeps repaired legacy; no private fields/new money action. **Money-Jest:** `MN-CARD-REFERENCE-WRAP`, `MN-ADMIN-URGENCY-ORDER`, `MN-CLASS-C-PARENTS`, `MN-ROLES-SAME-PK`. |
| **MN-T13** O32 · C | New money `adminMoneyConfig.ts`; A17/A18/A21 grouped draft/review, current parse/serialize; `adminApi.ts` existing fixed/proposal fields; reread category save. **Depends T09.** | ₹29.99→2,999;1.25%→125bp; legacy edit preserves fixed tiers/proposal800bp/cap500,000; min>max/unauthorized/OFF rejects; old fees unchanged. **Money-Jest/SQL-MN:** `MN-EDITORS-PAISE-UNITS`, `MN-COMMISSION-PRESERVE-EXTENSIONS`, `MN-EDITORS-FAIL-DIRTY`, `MN-COIN-FEES-AUTH-OFF`. |
| **MN-T14** O16/coordinator · B | R67 consumes approved shared display identity; original evidence separate, `formatReceipt.ts` presentation only. **Depends T06.** No new issuer assertion without approval. | Brand toggles chrome only; original NR/QS/time/amount/reference unchanged; non-tax/Not issued. **Receipt-Jest:** `MN-RECEIPT-BRAND-ISSUER`. |
| **MN-T15** O32 · A | E10 InfoLine/transaction text wrapping; exact original destinations/amounts, no shared-theme rewrite. | Full next-release text at320px/200%,193,760→₹1,937.60; legacy OFF also fixed. **Money-Jest:** `MN-CARD-REFERENCE-WRAP`, `MN-CLASS-C-PARENTS`. |
| **MN-T16** O32 + F6 · A | Reconciliation `index.ts` selects recovered_amount on every transfer lookup; `logic.ts` exports `localGatewayRecord` comparable-cash adapter. No source-money writes. | Stored10,000/recovered1,000 vs gateway9,000 clean;8,999 mismatch expected9,000/actual8,999; explicit netted/demo excluded, real missing still reported. **Recon-Deno:** `MN-RECONCILE-NETTED-AMOUNT`. |

All task objects in JSON additionally specify exact write files, function locks, dependencies, OFF behavior and focused review category. Shared SQL/CI/locales/barrels remain coordinator-serialized. Money/auth/concurrency implementation review is required where listed; **no review agent or automatic Opus review was launched**.

### Named retained regression gates

The 43-case catalogue includes the task cases above plus these explicit cross-cutting gates:

- `MN-CAPTURE-IDEMPOTENCY`: same gateway ID once; distinct extra capture/new PK; expected500/captured499 queues exactly499 without overwriting original.
- `MN-STATEMENT-PERIOD-ACCESS`: UTC inclusive November fixture boundaries; provider raw earnings retained with statement OFF, payee-only rows/statement hidden; stranger/staff/manager/anonymous denied appropriately.
- `MN-AUDIT-IMMUTABLE`: actual admin UUID; full target match; limit500/501; no app-user edit/delete.
- `MN-COIN-FEES-AUTH-OFF`: server config role/bounds and current-fee application versus disabled editor; restore existing coins safely.
- `MN-OFF-SAFETY`: all Oorva OFF, receipt/statement/sports OFF still resolve existing capture/refund/payout/cancellation/restoration, while disabled new capabilities remain denied.

Assertions use isolated fixtures, explicit SQL parameter casts and `JSON.stringify` actual values. The new SQL suite uses the **full-chain loader**, not existing capped-at-85/86 fixture loaders. Read-only statement timestamps in2030 are not out-of-horizon booking-creation attempts. Actual transition fixtures must satisfy configured working hours/holds/horizon. **No test was run here.**

## Retain / no-change cases

| ID | Invariant to preserve | Evidence / named gate |
|---|---|---|
| MN-R01 | Latest nonnull-booking receipt trigger already protects sports/pack captures. | `SQL/0088b:6–16`; `MN-RECEIPT-TRIGGER-RETAIN` |
| MN-R02 | Admin UUID membership and server checks, not phone authorization. | `SQL/0059:7–19`; `MN-ROLES-SAME-PK` |
| MN-R03 | Owner/participant read scope; membership not owner finance; explicit admin RPC. | `SQL/0084:239–248`, `0085:12–21,82–90`; `MN-ROLES-SAME-PK` |
| MN-R04 | Current party paid-minus-nonfailed-child refund composite; coins separately labelled. | `BookingDetailScreen.tsx:227–238`; `SQL/0002:7–18`; `MN-ADMIN-CAPTURE-REFUND-COIN` |
| MN-R05 | Refund same-PK idempotency, lookup-before-requeue, lookup-failure defer. | `EF/process-refunds\logic.ts:31–45,82–107`; `MN-REFUND-STALE-STATUS` |
| MN-R06 | Existing pending/hold/failed/demo labels already distinct; old failed-as-paid defect not repeated. | `providerInsights.ts:60–75`; `MN-PAYOUT-POSTFAIL-TIMESTAMP` |
| MN-R07 | Failed+failed-child payout retry, note, locks, same IDs, audit and conditional sequence bump. | `SQL/0086:228–293`; `MN-PAYOUT-RETRY-GUARDS` |
| MN-R08 | Existing standard/sports demo classification and synthetic-source claim exclusion. | `SQL/0075:415–450`, `0072:767–801`, `0060b:283–299`; session-only gap is MN-F02 |
| MN-R09 | Customer refund, payout, tranche, Route reversal and debt recovery remain separate. | `SQL/0021:732–747`; `MN-STATEMENT-NET-CURRENT` |
| MN-R10 | Once-only terminal coin ledger restoration, not duplicate cash refund or flag-gated restore. | `SQL/0062:166–187`; `MN-OFF-SAFETY` |
| MN-R11 | UTC inclusive statement range and stored-value totals/demo exclusion. | `SQL/0085:56–85`; `MN-STATEMENT-PERIOD-ACCESS` |
| MN-R12 | Existing admin config validation and omitted commission subtree preservation. | `SQL/0047:97–148`, `0075:201–309`; `MN-COMMISSION-PRESERVE-EXTENSIONS` |
| MN-R13 | Audit viewer read-only; ordinary app table writes revoked; bounded deterministic filter. Not cryptographic service-role immutability. | `SQL/0001:1889–1890`, `0086:307–330`; `MN-AUDIT-IMMUTABLE` |
| MN-R14 | Exact paise/discount signs and non-tax/Not issued receipt. | `money.ts:59–67`; R67:160–170; `MN-RECEIPT-BRAND-ISSUER` |
| MN-R15 | Fee editor OFF does not zero current config; appearance never gates existing resolution. | `SQL/0079:67–118,274–302`; `MN-COIN-FEES-AUTH-OFF` |
| MN-R16 | Real browser return is opened, not paid; demo resolver semantics distinct; recover known BYO booking. | `payments.tsx:134–193`; `MN-CHECKOUT-UNVERIFIED` |

## S39 coordinator payment-recovery contract

S39 remains coordinator-owned and **is not counted as a twelfth screen**.

- **Real checkout:** link creation/browser exceptions propagate. Any resolved `openBrowserAsync` return is ignored and `usePayment` returns **`opened`**, including dismissal; no real `paid`/`cancelled` inference.
- **Demo sheet:** caller promise remains pending while processing; settlement errors are caught/displayed and leave it pending. Dismissal outside processing resolves `cancelled`, or `paid` if already done; successful settlement resolves `paid`.
- After invite claim commits, retain the known `bookingId`. **View booking** uses `/booking/[id]`; retry payment uses existing `createPayment(bookingId)`, which rechecks customer/current state/server amount. Do not reclaim an already claimed invite.
- **No 3% admin-config-drift finding** is made; no BYO fee/formula/RPC change is proposed.

Evidence: `app\src\lib\payments.tsx:134–193`; `supabaseApi.ts:493–503`; `SQL/0029_single_due_payment.sql:118–159`.

## Real decisions / runtime limitations

| ID | Exact limitation | Scope and safe disposition |
|---|---|---|
| **MN-B01** | Current receipt contract has no legal issuer mapping; tax lines empty/invoice URL null. | Financial/legal owner must approve any **new issuer assertion**. Preserve original evidence/non-tax wording; neutral truth fixes are not blocked. `SQL/0084:192–208`; `apiTypes.ts:174–204`. |
| **MN-B02** | Current dispatch/owner projection does not establish bank arrival; local transferred/netted is insufficient. | Use neutral recorded-transfer wording. A stronger bank-confirmed capability needs an approved authoritative settlement source, not a guessed status. `SQL/0060b:322–325`; `0085:62–78`. |
| **MN-B03** | Tests/builds/production/money operations are prohibited in this request; only three earnings images inspected. | Source audit is complete. Runtime/device/concurrency/gateway results remain **NOT VERIFIED**, not PASS; no credentials or production operation requested. |
| **MN-B04** | Lost-chargeback RazorpayX venue payout with null provider_id records operator-action diagnostic, **not** a provider receivable/recovery completion. | Money operations owner must authorize the actual manual recovery or a separately designed capability. Preserve “Requires operator action”; do not invent staff collection or bank pullback. `SQL/0078:471–488`; `EF/_shared\payout-rail.ts:452–453`. |

Source file inventory is recorded in JSON: **103 files read/queried**, with full assigned screen bodies and scoped relevant ranges elsewhere. Existing test assertions are not execution evidence. Report structural/range validation is not an app test. **No generic further-audit task remains; the deliverable is the completed assigned coverage and concrete implementation contracts above.**

## References

- [Machine-readable money audit](../design/oorva/audit/money.json)
- `audit-protocol.txt` (completed planning-session input; not worker instructions)
- [Published audit scope and coverage](../design/oorva/audit/coverage.json)


## Addressable source task cards

<a id="mn-t01"></a>

### MN-T01

**Evidence findings:** MN-F01. **Logical WP:** O32. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `supabase\functions\process-refunds\index.ts`; `supabase\functions\process-refunds\logic.ts`; `supabase\functions\process-refunds\logic_test.ts`; `supabase\migrations\UNASSIGNED_MN_SQL_01_money_truth_guards.sql`; `supabase\tests\mn_money_truth.test.mjs`; `app\src\features\bookingDetail\model.ts`; `app\src\features\bookingDetail\BookingDetailScreen.tsx`; `app\src\features\bookingDetail\__tests__\model.test.ts`.

**Function scope:** `record_refund_submission(uuid,text,text) (new)`; `record_refund_status(text,text,uuid)`; `complete_refund(uuid,text) (preserve contract)`.

**Required edits:**

1. Obtain financial-owner acknowledgement and coordinator allocation for claim token UNASSIGNED_MN_SQL_01, logical file supabase\migrations\UNASSIGNED_MN_SQL_01_money_truth_guards.sql. Only the coordinator binds an actual numeric migration filename; never guess one or edit applied migrations.
2. Add service-only record_refund_submission: lock the claimed refund, preserve its gateway ID, reject mismatched IDs, retain processing for nonterminal/missing gateway status, route explicit processed/failed to record_refund_status. Preserve same refund amount/PK and all existing retry keys.
3. Fresh gateway response and stale lookup must carry status; a matching ID with nonterminal or missing status is deferred, not completed or resent. Keep gateway lookup failure deferred. Preserve synthetic pay_demo_ branch with no real gateway call.
4. Add the existing refund_completed notification to the proved processed branch using refund-completed:refund UUID dedupe; do not notify on mere submission. Preserve current financial-event recording and duplicate processed/failed handling.
5. Extend heroCopy's safe money-progress input at BookingDetailScreen's existing call site; when only booking.status=refunded is known, say Refund arranged and refer to Payments. With child evidence, distinguish queued/processing/partly processed/full processed; do not change canonical booking status or refund policy.
6. Supply the aggregate-only versus completed-refund contract to the sports presentation owner; refund_paise alone must never mean gateway processed.

**Acceptance:**

- A real 12,500-paise partial refund response with an ID but no terminal proof leaves child processing, parent paid, and zero completion notifications; a full 20,000-paise processed child marks its parent refunded.
- Pending/unknown/failed stale matches do not execute the old unconditional complete callback; processed replay records one processed event/notification, not a second refund POST.
- Service-role only: ordinary customer/provider/manager/staff/admin cannot call the new worker RPC; signed webhook/cron paths remain the only external entry points.
- All Oorva flags OFF, payment_receipts OFF and sports OFF do not prevent safe resolution of existing refunds.
- A booking already labelled refunded with only pending children is not described as money returned to the customer.

**Tests (requirements, NOT RUN):**

- supabase\functions\process-refunds\logic_test.ts: MN-REFUND-SUBMIT-PENDING, MN-REFUND-STALE-STATUS
- supabase\tests\mn_money_truth.test.mjs: MN-REFUND-SUBMIT-PROCESSED, MN-OFF-SAFETY
- app\src\features\bookingDetail\__tests__\model.test.ts: MN-REFUND-SUBMIT-PENDING

**OFF behavior:** Always correct for existing work; no appearance, receipt-access, sports or coin-earning switch gates refund completion..

<a id="mn-t02"></a>

### MN-T02

**Evidence findings:** MN-F02. **Logical WP:** O32. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `supabase\migrations\UNASSIGNED_MN_SQL_01_money_truth_guards.sql`; `supabase\tests\mn_money_truth.test.mjs`; `supabase\tests\demo_payouts.test.mjs`.

**Function scope:** `_finalize_session_completion(uuid,uuid)`.

**Required edits:**

1. Copy the latest 0075 session finalizer into the reserved forward repair, preserving source-payment selection, commission snapshot, capacity, unique payout and all completion updates.
2. Derive v_is_demo from the selected payment's actual pay_demo_ prefix, matching _create_payout rather than build mode or a visual badge.
3. Insert status demo for synthetic sources and pending for real sources; skip only the transfer creation in the synthetic branch.
4. Do not normalize historical rows or alter commission/GST/net/release/job-count/pack-session policy.

**Acceptance:**

- Synthetic one-off and pack-funded session completion produce amount 8,820 paise with status demo and zero transfer rows for a 10,000 service / 1,000 commission / 180 GST fixture.
- The same live fixture produces pending amount 8,820 and one transfer for 8,820, not a demo exclusion.
- Provider statement/earnings financial totals exclude only the now-correct canonical demo status; all returned original values remain readable.
- Claim excludes any synthetic source regardless of Oorva or statement flags; customer/provider/admin callers cannot invoke the internal finalizer directly.

**Tests (requirements, NOT RUN):**

- supabase\tests\mn_money_truth.test.mjs: MN-DEMO-SESSION-ONESHOT, MN-DEMO-PACK-SESSION, MN-LIVE-SESSION-PAISE, MN-OFF-SAFETY
- supabase\tests\demo_payouts.test.mjs: retain existing synthetic claim exclusion

**OFF behavior:** Writer classification applies with every Oorva/statement flag OFF; existing owner provider payouts stay readable..

<a id="mn-t03"></a>

### MN-T03

**Evidence findings:** MN-F03. **Logical WP:** O32. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\src\lib\providerInsights.ts`; `app\src\lib\__tests__\providerInsights.statement.test.ts`; `app\app\(provider)\earnings.tsx`; `app\app\earnings-statement.tsx`; `app\app\admin\payouts.tsx`; `app\app\admin\booking\[id].tsx`; `supabase\migrations\UNASSIGNED_MN_SQL_01_money_truth_guards.sql`; `supabase\tests\mn_money_truth.test.mjs`.

**Function scope:** `complete_transfer(uuid,text) (notification-only edit)`.

**Required edits:**

1. Keep all payout/transfer state mutations, release timing, retry keys and booking-close behavior unchanged.
2. Change transferred payout copy/summary to Transfer recorded / offset; explain that bank confirmation is separate with existing projection.
3. Use state-qualified recorded timestamps; a failed payout with historical transferred_at must not say Paid.
4. Render already-returned admin rail/gateway_status/amount metadata without adding a public bank/KYC projection.
5. Change payout_sent notification body to neutral recorded-transfer/adjustment wording; retain kind, URL, recipient, amount payload and dedupe key.

**Acceptance:**

- An 8,820-paise queued/processing RazorpayX dispatch is not labelled bank-paid in owner/admin card or notification.
- An 8,820-paise fully netted transfer with net dispatch 0 and netted_ external reference does not claim money was sent to a bank.
- A later failed state wins over a retained transferred_at in the row label; historical timestamp remains visible as history.
- Pending/frozen/failed/demo labels retain their existing correct distinctions and all exact amounts.
- Neutral wording applies with all Oorva flags OFF and does not block any existing payout resolution.

**Tests (requirements, NOT RUN):**

- app\src\lib\__tests__\providerInsights.statement.test.ts: MN-PAYOUT-QUEUED-NOT-BANK, MN-PAYOUT-POSTFAIL-TIMESTAMP
- supabase\tests\mn_money_truth.test.mjs: MN-PAYOUT-NETTED-NOT-BANK, MN-OFF-SAFETY

**OFF behavior:** Always truthful; optional new layout cannot restore Paid to bank wording on the legacy view..

<a id="mn-t04"></a>

### MN-T04

**Evidence findings:** MN-F04. **Logical WP:** O32. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `supabase\migrations\UNASSIGNED_MN_SQL_01_money_truth_guards.sql`; `supabase\tests\mn_money_truth.test.mjs`; `supabase\tests\mn_money_concurrency.pg.test.mjs`; `app\app\admin\refunds.tsx`.

**Function scope:** `admin_retry_refund(uuid)`.

**Required edits:**

1. Identify target payment without mutating; acquire its reservation lock consistently with _queue_refund, then acquire/recheck the target failed refund. Use NOWAIT/conflict-to-retry handling for child lock contention instead of creating a worker/refund lock cycle.
2. Require actual admin, failed target, valid positive stored amount and target.amount + SUM(other non-failed child amounts) <= payment.amount under that lock.
3. Only then reset the existing target to pending/attempts 0 and insert its existing audit action. On capacity conflict no money or audit mutation occurs.
4. Keep current UI failed-only Retry and display the returned capacity/stale-state error beside the refund, followed by authoritative refresh.
5. Add an approved non-production two-connection PostgreSQL test for concurrent reservations/retries. Do not treat sequential PGlite as proof of contention safety.

**Acceptance:**

- 20,000 captured + failed 12,500 + another pending 20,000: retry rejects and reserved total stays 20,000.
- 20,000 captured + failed 5,000 + another pending 10,000: retry succeeds on the same PK, reserved total 15,000, one audit row.
- Two failed 12,000 refunds competing for a 20,000 payment cannot both become pending; demonstrate overlapping transactions and distinct backend PIDs in later implementation validation.
- Non-admin, missing, pending, processing and refunded targets reject without mutation; existing completion recording is not gated.
- All appearance flags OFF preserves the exact same guard and allowed safe retry.

**Tests (requirements, NOT RUN):**

- supabase\tests\mn_money_truth.test.mjs: MN-REFUND-RETRY-CAP, MN-REFUND-RETRY-ALLOW, MN-ROLES-SAME-PK, MN-OFF-SAFETY
- supabase\tests\mn_money_concurrency.pg.test.mjs: MN-REFUND-RETRY-CONCURRENT

**OFF behavior:** Guard and safe retry remain active independently of Oorva/receipt/earning flags..

<a id="mn-t05"></a>

### MN-T05

**Evidence findings:** MN-F05. **Logical WP:** O35. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `web\checkout\index.html`; `web\checkout\payment-status.js`; `supabase\functions\verify-payment\index.ts`; `supabase\functions\verify-payment\logic.ts`; `supabase\functions\verify-payment\logic_test.ts`; `supabase\functions\verify-payment\checkout-status_test.ts`.

**Required edits:**

1. Add a pure verificationOutcome mapper in verify-payment/logic.ts that distinguishes verified captured/applied, captured-refund-queued, persisted-exception/review-required and confirmation-pending; consume recordGatewayPayment.result without changing its idempotent acknowledgement contract.
2. Return an explicit display outcome from the verified endpoint while retaining status/capture/signature checks and current HTTP errors.
3. Add pure web payment-status.js mapping transport/HTTP/body outcome to pending/success/warning copy; import it from the hosted page and test that exact module with Deno.
4. Replace both optimistic failure fallback strings with Confirmation pending; return to your booking to check status. No guaranteed one-minute promise or automatic second checkout.
5. Keep the known BYO booking ID as the recovery destination; do not reclaim an already claimed invite.

**Acceptance:**

- HTTP 401/409/500, rejected fetch and malformed JSON never render paid/received/success styling.
- Verified captured refund:true yields refund queued language, not booking accepted; persisted exception yields review-required, not applied.
- Real usePayment continues returning opened after a browser return, propagating creation/browser failures; no local paid is set.
- HMAC test vectors, customer ownership, gateway amount source and all money recorder arguments remain unchanged.

**Tests (requirements, NOT RUN):**

- supabase\functions\verify-payment\logic_test.ts: MN-CHECKOUT-CAPTURE-VS-BOOKED plus existing HMAC vector
- supabase\functions\verify-payment\checkout-status_test.ts: MN-CHECKOUT-UNVERIFIED imports web\checkout\payment-status.js
- supabase\functions\_shared\record-payment_test.ts: retain MN-CAPTURE-IDEMPOTENCY dispatcher expectations

**OFF behavior:** Unknown money confirmation stays unknown with all branding switches OFF; outbound brand copy is a separate task..

<a id="mn-t06"></a>

### MN-T06

**Evidence findings:** MN-F06. **Logical WP:** O16. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `supabase\migrations\UNASSIGNED_MN_SQL_01_money_truth_guards.sql`; `supabase\tests\mn_money_truth.test.mjs`; `app\src\lib\apiTypes.ts`; `app\src\lib\supabaseApi.ts`; `app\src\lib\demo\demoApi.ts`; `app\src\features\receipts\formatReceipt.ts`; `app\src\features\receipts\__tests__\formatReceipt.test.ts`; `app\app\receipt\[paymentId].tsx`; `app\src\features\bookingDetail\PaymentsSection.tsx`.

**Function scope:** `get_receipt(uuid)`.

**Required edits:**

1. Transactionally recreate get_receipt with old id/receipt_no/payment_id/booking_id/issued_at/snapshot fields plus current_payment_status, current_refunds, current_payment_is_demo and read_at; explicitly restore its authenticated grant and revoke public/anon.
2. Preserve get_receipt's existing payment_receipts plus customer/provider/admin authorization. Safe current refund rows contain only refund ID/payment ID/amount/status/created_at/processed_at for that same payment.
3. Do not update payment_receipts rows, renumber or backfill absent historical receipts; retain latest 0088b booking-only trigger guard.
4. Extend PaymentReceipt and demo/real read adapters; format original snapshot and current refund overlay separately. Use historical balance wording and demo provenance from actual source reference.
5. Extend shouldShowPaymentReceipt to captured refund states but not created/failed/coins/OFF; keep existing booking action and non-tax/Not issued disclaimer.
6. Replace universal 24 h release text with stored-booking-terms guidance, no new rate or ETA.

**Acceptance:**

- Issue 10,000 receipt, queue/process a 2,500 refund: original snapshot/receipt number/issue time remain byte-for-byte unchanged, current overlay progresses through pending/processing/refunded and does not claim a full refund.
- Issued receipt entry remains reachable for paid/refund_pending/refund_processing/refunded customer payment; disabled/created/failed/coins remain hidden.
- Same receipt/payment PK visible only to customer/provider/admin; manager/staff/stranger/anonymous cannot obtain the current overlay.
- Receipt OFF returns no receipt data but never stops capture/refund/payout; sports/pack capture still skips the booking-only receipt trigger.
- A demo source is labelled simulated, and accepted-proposal release text does not promise 24 hours.

**Tests (requirements, NOT RUN):**

- supabase\tests\mn_money_truth.test.mjs: MN-RECEIPT-POST-ISSUE-REFUND, MN-ROLES-SAME-PK, MN-RECEIPT-TRIGGER-RETAIN
- app\src\features\receipts\__tests__\formatReceipt.test.ts: MN-RECEIPT-REFUNDED-LINK, MN-RECEIPT-POST-ISSUE-REFUND

**OFF behavior:** Existing payment_receipts OFF hides/rejects receipt access only; truthful current overlay and historical labels apply in legacy view when access is allowed..

<a id="mn-t07"></a>

### MN-T07

**Evidence findings:** MN-F07. **Logical WP:** O32. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\src\lib\adminMoney.ts`; `app\src\lib\__tests__\adminMoney.test.ts`; `app\app\admin\booking\[id].tsx`; `supabase\migrations\UNASSIGNED_MN_SQL_01_money_truth_guards.sql`; `supabase\tests\mn_money_truth.test.mjs`.

**Function scope:** `resolve_dispute(uuid,public.dispute_outcome,int,text)`.

**Required edits:**

1. Implement partialRefundLimitPaise(detail) in the existing adminMoney module using current paid non-coin gateway cash minus non-failed child refunds and min with existing payout.amount when present; never modify a server policy amount.
2. Use that limit with unchanged whole-rupee parsePartialRefundRupees; show the same limit before input and retain draft on errors.
3. Add explicit nonnull/outcome validity check and partial-only trimmed note 1-500 server check; retain current admin/disputed/amount guards, generated full/deny notes and all settlement branches.
4. Disable all resolve actions while any action is busy and guard handlers before confirmation; keep destructive confirmation and post-action reload.

**Acceptance:**

- 20,000 eligible cash / 17,640 current payout: 180 rupees rejects client-side, 176 becomes exactly 17,600 paise; 176.40 remains disallowed by the existing whole-rupee UI contract.
- Direct partial RPC with null/blank/501-character note rejects; valid note plus valid amount succeeds; null outcome no longer silently closes without refund.
- Non-admin and every non-disputed booking state reject without a refund/audit write.
- A full/deny action cannot be launched while partial is busy; repeat stale resolution is still rejected server-side.
- All Oorva switches OFF retain these guards, confirmed controls and existing valid safety resolution.

**Tests (requirements, NOT RUN):**

- app\src\lib\__tests__\adminMoney.test.ts: MN-PARTIAL-CAP-PAYOUT
- supabase\tests\mn_money_truth.test.mjs: MN-PARTIAL-NOTE-ROLE, MN-ROLES-SAME-PK, MN-OFF-SAFETY

**OFF behavior:** No money guard or valid resolution path depends on the admin Oorva leaf..

<a id="mn-t08"></a>

### MN-T08

**Evidence findings:** MN-F08. **Logical WP:** O32. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `supabase\migrations\UNASSIGNED_MN_SQL_01_money_truth_guards.sql`; `supabase\tests\mn_money_truth.test.mjs`; `app\src\lib\adminApi.ts`; `app\app\admin\bookings.tsx`; `app\app\admin\booking\[id].tsx`; `app\app\admin\refunds.tsx`; `app\app\admin\payouts.tsx`.

**Function scope:** `admin_list_bookings(text,text)`; `admin_list_stuck_money()`; `admin_list_problem_payouts()`.

**Required edits:**

1. Preserve existing list args/columns/filter/limit while adding cash_captured_paise, coins_applied_paise, demo_captured_paise, refund_pending_paise, refund_processing_paise, refund_completed_paise, refund_failed_paise and net_held_paise=existing _net_paid projection.
2. Cash capture predicate is customer funding plus actual non-demo gateway reference and captured/refund status; coins/demo remain separately labelled. Aggregate refunds laterally per payment to avoid multiplication by sibling joins; label failed refund amount as failed attempts, not returned cash.
3. Add supported parent IDs to stuck refund/transfer JSON and processing_started_at/rail/gateway_status to transfer diagnostics.
4. Include stale processing child with no error in problem payouts using the existing 30-minute threshold; retain failed/error rows and order.
5. Update typed APIs and render explicit current funding/refund/parent fields in legacy and new views, with supported routes only. No new mutation or action eligibility.

**Acceptance:**

- 12,000 real cash + 3,000 applied coins and 2,000 partial refund yields cash captured 12,000, coins 3,000, appropriate refund-state bucket 2,000, net-held 13,000; no amount is silently called bank cash.
- Full refund reservation still shows original captured cash with a separate pending/processing/completed bucket rather than zero-ever-paid history.
- Service, sports and pack stuck refunds retain correct parent identity; a pack never routes as a service booking.
- A >=30-minute processing transfer with last_error null appears read-only; a fresh processing row is not described as stale; Retry remains failed-parent/failed-child only.
- Every read remains admin-only, and all correctness data remains available with Oorva OFF.

**Tests (requirements, NOT RUN):**

- supabase\tests\mn_money_truth.test.mjs: MN-ADMIN-CAPTURE-REFUND-COIN, MN-ADMIN-PARENT-XOR, MN-ROLES-SAME-PK, MN-PAYOUT-RETRY-GUARDS

**OFF behavior:** Additive truthful financial projection applies in both layouts; appearance flags do not disable admin problem visibility..

<a id="mn-t09"></a>

### MN-T09

**Evidence findings:** MN-F09. **Logical WP:** O32. **Class:** A. **Source task prerequisites:** MN-T06.

**Proposed source files (canonical allocation takes precedence):** `app\src\features\money\useMoneyReadback.ts`; `app\src\features\money\moneyReadback.ts`; `app\src\features\money\__tests__\useMoneyReadback.test.tsx`; `app\app\(provider)\earnings.tsx`; `app\app\earnings-statement.tsx`; `app\app\admin\audit.tsx`; `app\app\admin\booking\[id].tsx`; `app\app\admin\bookings.tsx`; `app\app\admin\coins.tsx`; `app\app\admin\commission.tsx`; `app\app\admin\fees.tsx`; `app\app\admin\payouts.tsx`; `app\app\admin\refunds.tsx`; `app\app\receipt\[paymentId].tsx`; `app\src\features\bookingDetail\BookingDetailScreen.tsx`.

**Required edits:**

1. Implement a small testable moneyReadback controller plus useMoneyReadback<T> wrapper; input key, enabled and read() promise; output data, loading/refreshing, error, lastSuccessfulAt and reload(). Existing screens keep their API/action controllers.
2. Include verified caller identity/role plus entity/range/filter in keys. Use monotonically increasing request generations; invalidate obsolete results on key change/blur/unmount, clear old data on identity/entity key change.
3. Reuse useFocusEffect and AppState active handling for authoritative reread; preserve manual Screen refresh. Do not assume money tables are in the Realtime publication or add production polling.
4. Keep same-key stale data only with a visible last-read/error banner and retry; render successful empty arrays separately.
5. For settings, track current server configuration separately from dirty draft. Do not auto-replace a dirty form on focus; present explicit discard/reload decision.
6. Separate action write success from refresh outcome. A queued retry/saved config plus read failure says queued/saved, refresh failed; no false completed/unsaved inference.

**Acceptance:**

- Resolve December statement request then late November request: December label/data remain; equivalent audit-target/search tests select only latest key.
- Changing caller/entity clears previous data immediately and obsolete completions cannot repopulate it.
- Returning from another route/app background refreshes admin detail and receipt money; child-only refund changes do not rely on booking realtime.
- Earnings with old data plus failed reload visibly reports stale/error instead of suppressing it; receipt network error is retryable, not unavailable/empty.
- Successful coin-config write followed by failed summary read remains Saved with separate refresh warning; actual write failure retains entered draft.
- All readback/error fixes work with every Oorva composition/brand switch OFF; underlying disabled receipt/statement capability causes no unauthorized fetch.

**Tests (requirements, NOT RUN):**

- app\src\features\money\__tests__\useMoneyReadback.test.tsx: MN-READBACK-LATEST-KEY, MN-READBACK-FOCUS-OFF, MN-READBACK-EARNINGS-ERROR, MN-EDITORS-FAIL-DIRTY, MN-RECEIPT-READBACK-ERROR (controller state; actual receipt rendering additionally requires approved screen-interaction evidence)

**OFF behavior:** Read identity/error/correctness never depends on Oorva. Existing capability OFF remains fail-closed..

<a id="mn-t10"></a>

### MN-T10

**Evidence findings:** MN-F10. **Logical WP:** O32. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\src\lib\providerInsights.ts`; `app\src\lib\__tests__\providerInsights.statement.test.ts`; `app\app\(provider)\earnings.tsx`.

**Required edits:**

1. Add payoutVerificationCopy(KycStatus|null) returning label/tone/detail for each actual KYC value: pending, under_review, needs_clarification, verified, rejected, suspended; null/unknown stays unavailable.
2. Use it for the earnings verification row without requiring a Route account ID.
3. Retain the existing owner API and onboarding route; label this verification status, not overall provider eligibility or every payout's release readiness.

**Acceptance:**

- verified provider with no razorpay_account_id is not called pending merely for using a RazorpayX fund account.
- needs_clarification, rejected, suspended and under_review are distinct; no unknown/null becomes verified.
- No bank/fund-account/KYC-document data is added to the shared transaction model.
- Same wording applies in legacy view with all Oorva flags OFF.

**Tests (requirements, NOT RUN):**

- app\src\lib\__tests__\providerInsights.statement.test.ts: MN-READINESS-RAILS

**OFF behavior:** Always truthful; no new KYC capability or server permission..

<a id="mn-t11"></a>

### MN-T11

**Evidence findings:** MN-F11. **Logical WP:** O32. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\app\earnings-statement.tsx`; `app\src\lib\__tests__\providerInsights.statement.test.ts`; `supabase\tests\mn_money_truth.test.mjs`.

**Required edits:**

1. Rename summary and row net labels Current payout amount recorded.
2. Label reversal amount Recorded transfer reversals with a non-additive-history explanation.
3. Keep summarizeProviderStatement summing stored row.net and excluding demo; do not subtract reversed_amount or reconstruct original payout from gross.
4. Add cases using actual resolve_dispute and complete_transfer_reversal writes to verify the read projection, not only manually copied expected shapes.

**Acceptance:**

- Original net 8,820, partial refund/reversal 1,000: statement current amount is exactly 7,820 and separate reversal is 1,000; no 6,820 double deduction and no before-reversal label.
- Full resolution current amount 0 with transfer reversal 8,820 remains current 0, not negative or original bank credit.
- Demo excluded totals remain unchanged, and all copy correctness applies with Oorva OFF when statement capability is ON.

**Tests (requirements, NOT RUN):**

- supabase\tests\mn_money_truth.test.mjs: MN-STATEMENT-NET-CURRENT, MN-STATEMENT-FULL-REVERSAL
- app\src\lib\__tests__\providerInsights.statement.test.ts: matching labelled current-amount fixtures

**OFF behavior:** Existing statement capability still gates access; if accessible its labels remain correct in the legacy composition..

<a id="mn-t12"></a>

### MN-T12

**Evidence findings:** MN-F12. **Logical WP:** O32. **Class:** C. **Source task prerequisites:** MN-T01, MN-T02, MN-T03, MN-T06, MN-T08, MN-T09, MN-T10, MN-T11, MN-T15.

**Proposed source files (canonical allocation takes precedence):** `app\src\features\money\transactionPresentation.ts`; `app\src\components\money\TransactionCard.tsx`; `app\src\features\money\__tests__\transactionPresentation.test.ts`; `app\app\(provider)\earnings.tsx`; `app\app\earnings-statement.tsx`; `app\app\admin\audit.tsx`; `app\app\admin\booking\[id].tsx`; `app\app\admin\bookings.tsx`; `app\app\admin\payouts.tsx`; `app\app\admin\refunds.tsx`; `app\app\receipt\[paymentId].tsx`.

**Required edits:**

1. Implement the transaction card's exact discriminated input/output contract, reusing current typed status/refund/payment/money helpers. Do not pass full admin/KYC/bank payloads into common cards.
2. Retain one controller and apply all class-A repaired semantics in both layouts; add an optional view-composition branch only.
3. Apply each screen's targetHierarchy/placement rows: readiness/current problems before terms/history/settings, separate payout/transfer/reversal/refund contexts, full references, one contextual primary action.
4. Keep audit immutable and scoped; provide detail disclosure, not new mutation controls. Service/sports/pack routes remain their actual supported paths.
5. Request coordinator registration of default-OFF leaves: oorva_provider_ux order 215, oorva_admin_money_ux order 222, oorva_booking_ux order 207, group Oorva experience, parent oorva_brand, clear OFF legacy-composition description, on-conflict do nothing. These may already be supplied by coordinator; do not duplicate them.
6. Capture actual before/after authorized state/role evidence after implementation. No screenshot or green compile alone is visual completion.

**Acceptance:**

- All 71 placement rows have current/target evidence and a matching test; no assigned screen is omitted.
- ON requires brand plus its leaf; brand OFF/child ON and both OFF retain legacy layout with unconditional truth fixes.
- Existing payment_receipts/provider_earnings_statement/platform_fee_settings and staff permission gates remain effective under new composition.
- Admin disputed action is reachable before traversing all history; S26 problems precede dispute settings; processing rows have no Retry.
- 320px/200% text shows full amounts/timing/reference; no new money operation, order engine or private-field disclosure.

**Tests (requirements, NOT RUN):**

- app\src\features\money\__tests__\transactionPresentation.test.ts: MN-CARD-REFERENCE-WRAP, MN-ADMIN-URGENCY-ORDER, MN-CLASS-C-PARENTS, MN-ROLES-SAME-PK
- Coordinator feature-registry/effective-parent suite: MN-CLASS-C-PARENTS

**OFF behavior:** Legacy composition remains with all class-A money truth, errors, readability and permission repairs; no safety RPC is gated..

<a id="mn-t13"></a>

### MN-T13

**Evidence findings:** MN-F12. **Logical WP:** O32. **Class:** C. **Source task prerequisites:** MN-T09.

**Proposed source files (canonical allocation takes precedence):** `app\app\admin\coins.tsx`; `app\app\admin\commission.tsx`; `app\app\admin\fees.tsx`; `app\src\lib\adminApi.ts`; `app\src\features\money\adminMoneyConfig.ts`; `app\src\features\money\__tests__\adminMoneyConfig.test.ts`.

**Required edits:**

1. Extract current form parse/serialize/diff logic to adminMoneyConfig.ts for testability, preserving current server-compatible units/bounds and existing RPCs.
2. Group coins denomination/earning/redemption/expiry/budget; keep existing immediate earning/redemption switches distinct from Save.
3. Extend the typed commission draft/readback with existing fixed.tiers and proposal.bp/cap_paise. Use server constraints: fixed 1-10 unique nonnegative thresholds with one zero base, bp 0-3000; proposal bp 0-3000 and cap 1-100000000 paise; retain standard/time/repeat/founding/category rules.
4. For legacy composition, omit unsupported changed fields without dropping stored fixed/proposal subtrees; backend's existing preserve-on-omission contract remains intact.
5. Group fixed fee amounts versus proposal percent/min/max and add a read-only current-to-draft diff, not client pricing/reward formulas. Retain null versus zero meaning.
6. Use dirty/pending/saved/error state and keyboard-safe layout; reread void category saves; coordinate admin-money composition flag only, no new financial setting policy.

**Acceptance:**

- 29.99 rupees serializes exactly 2,999 paise; 1.25 percent exactly 125 bp; proposal minimum greater than maximum rejects before RPC and still rejects directly server-side.
- Coin denomination only 1/10/100 paise, bp 0-10000, nullable cap/budget remain nullable; no changed reward or expiry formula.
- Editing standard commission through legacy form preserves stored fixed tiers and proposal 800 bp / 500000-paise cap; new grouped editor roundtrips the same supported values without default resets.
- All non-admin config RPCs remain denied; platform_fee_settings OFF still prevents editing but current fees apply and old booking fee snapshots do not change.
- Actual save failure preserves values; successful write plus summary-read failure is not described as unsaved. New grouping/diff is OFF under brand OFF/leaf ON.

**Tests (requirements, NOT RUN):**

- app\src\features\money\__tests__\adminMoneyConfig.test.ts: MN-EDITORS-PAISE-UNITS, MN-COMMISSION-PRESERVE-EXTENSIONS, MN-EDITORS-FAIL-DIRTY, MN-CLASS-C-PARENTS
- supabase\tests\mn_money_truth.test.mjs: MN-COIN-FEES-AUTH-OFF

**OFF behavior:** Existing editors remain, preserving current config and all class-A feedback fixes; existing server capabilities/authorizations are not disabled by presentation..

<a id="mn-t14"></a>

### MN-T14

**Evidence findings:** MN-F13. **Logical WP:** O16. **Class:** B. **Source task prerequisites:** MN-T06.

**Proposed source files (canonical allocation takes precedence):** `app\app\receipt\[paymentId].tsx`; `app\src\features\receipts\formatReceipt.ts`; `app\src\features\receipts\__tests__\formatReceipt.test.ts`.

**Required edits:**

1. Consume coordinator's approved display-brand value in receipt chrome; do not create a second branding loader.
2. Keep original receipt metadata and snapshot distinct from chrome; do not replace NR/QS series, original party names, issue times, gateway IDs or numbers.
3. Show legal issuer information only if supplied as an actual approved issuer record. Until then do not assert Oorva is the legal issuer or a tax invoice.
4. Retain non-tax notice/Not issued and class-A historical/current refund separation under both brand states.

**Acceptance:**

- Brand ON changes display chrome to approved Oorva identity; OFF restores legacy chrome without undoing truth fixes.
- Original receipt number, issue timestamp, snapshot JSON and gateway references are unchanged in both states.
- No invented legal issuer, GST line, tax invoice URL or new 24-hour/bank-arrival guarantee appears.
- Authorized/unauthorized receipt access is unchanged.

**Tests (requirements, NOT RUN):**

- app\src\features\receipts\__tests__\formatReceipt.test.ts: MN-RECEIPT-BRAND-ISSUER, MN-RECEIPT-POST-ISSUE-REFUND

**OFF behavior:** Legacy display identity only; original financial evidence and all class-A correctness remain unchanged..

<a id="mn-t15"></a>

### MN-T15

**Evidence findings:** MN-F14. **Logical WP:** O32. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\app\(provider)\earnings.tsx`; `app\src\features\money\__tests__\transactionPresentation.test.ts`.

**Required edits:**

1. Change Earnings InfoLine long money content to stacked/wrapping label and value; remove the one-line constraint on the next release/status value.
2. Allow the existing transaction breakdown/net/reference/timestamp to wrap or disclose full value without altering exact stored amounts.
3. Keep active/disabled row accessibility and original service/sports/onboarding/statement destinations.
4. Use the inspected light/scrolled/dark earnings frames as existing web evidence only; capture actual narrow/large-text legacy and new views later.

**Acceptance:**

- At 320 CSS px and 200% text, full scheduled/overdue release message and timestamp are accessible with no ellipsis.
- Full 193,760-paise value remains ₹1,937.60, not rounded or silently shrunk; long references are recoverable in full.
- No extra duplicate CTA or financial action is added.
- Both brand OFF/leaf ON and all Oorva flags OFF retain the readability correction.

**Tests (requirements, NOT RUN):**

- app\src\features\money\__tests__\transactionPresentation.test.ts: MN-CARD-REFERENCE-WRAP, MN-CLASS-C-PARENTS

**OFF behavior:** Existing legacy view also wraps meaningful financial text; no feature flag gates accessibility..

<a id="mn-t16"></a>

### MN-T16

**Evidence findings:** MN-F15. **Logical WP:** O32. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `supabase\functions\reconcile-payments\index.ts`; `supabase\functions\reconcile-payments\logic.ts`; `supabase\functions\reconcile-payments\logic_test.ts`.

**Required edits:**

1. Extend TransferRow/selects for recovered_amount in gateway-ID, reference-ID and transferred-at snapshot paths.
2. Add exported pure localGatewayRecord(kind,row) adapter: payment/refund amount unchanged; payout-transfer gateway amount=amount-recovered_amount; return null only for explicit synthetic pay_demo_/rfnd_demo_/netted_ references of the corresponding kind.
3. Use the same adapter in loadLocalSnapshot for all lookup paths; preserve local UUID, real external/reference ID and deduplication.
4. Keep reconciliation reporting-only: no payment/refund/transfer state repairs, no ledger update, no dispatch or policy change.

**Acceptance:**

- Local tranche 10,000/recovered 1,000 with actual gateway payout 9,000 produces no false mismatch; a gateway payout 8,999 still produces exactly one mismatch with expected 9,000 and actual 8,999.
- Wholly netted 10,000/recovered 10,000 with netted_ reference does not produce a missing_gateway issue; its local money history remains untouched.
- Explicit synthetic capture/refund rows are excluded from real gateway comparison, while ordinary real missing rows still produce missing_gateway/missing_local.
- No Oorva flag gates reconciliation correctness and no money-state write is introduced.

**Tests (requirements, NOT RUN):**

- supabase\functions\reconcile-payments\logic_test.ts: MN-RECONCILE-NETTED-AMOUNT plus retained real missing/mismatch cases

**OFF behavior:** Reporting truth applies with all appearance and optional money-view flags OFF; internal synthetic offsets are not gateway transactions..
