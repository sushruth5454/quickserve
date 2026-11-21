# Oorva Critical source audit — services

> **Implementation authority:** use [doc 18](../18-Oorva-Transformation-Implementation-Plan.md) and [`execution-plan.json`](../design/oorva/execution-plan.json) for the actual dispatch stage, file/function locks, migration claim and validation command. This source audit supplies verified current behavior, required changes and acceptance. A proposal filename is not a numeric reservation.


| Baseline | Scope |
|---|---|
| Source | Immutable `oorva-audit-main-2f1e4638`, SHA `2f1e4638b145185b9e58c4c62e58f5c6dd491fa1` |
| Date | November 20, 2026 |
| Coverage | **14 screens; 88 element-placement rows; 9 entities; 19 booking enum values; 2 card contracts; 22 findings; 25 implementation tasks** |
| Evidence | Actual route/imported bodies, ordered migrations and defining function bodies, client adapters, safe read projections; supplied web images separately identified below |
| Execution | Read-only audit. No application/SQL/device tests, installation, source edits, commits, pushes, deployment or production calls |
| Detailed contract | [`services.json`](../design/oorva/audit/services.json) contains exact fields, actor/state predicates, source ranges, file lists, task dependencies and named assertions |

## Summary

This is an implementation-ready change plan, not a request for another audit. Twenty findings are confirmed current-code defects; two are required hierarchy changes. Important existing safeguards must be retained: server pricing/owned-address checks, immutable snapshots, separate session finalization, fixed additive quotes, fee-preview reconfirmation, revision counters, paid-only delivery acceptance, and resolution with acquisition disabled.

The largest risks are **wrong-family mutations**, **request/proposal/booking composite drift**, **metadata being mistaken for delivered work**, and **actions based on stale or incomplete state**. A booking status is not a payment-capture assertion. Money owns recording/refund/payout formulas and financial remediation approval.

### Actual visual evidence, not inferred scenario states

The coordinator supplied run `44696642603`, head `229995fe3194de39684f12ef348d3e37930ae5f2`, completed/failure, and verified application-code equivalence to the audit SHA; only `docs/14` differs. This audit did not independently query that run.

Eleven PNGs and `contact-05.jpg` were inspected under `critical-audit`. No personal account details are reproduced.

* `79-bookings-active`: two navigation levels; the Repeat plans label and next-action line visibly truncate.
* `73-book-screen-ready`: schedule/date/window inputs and sticky checkout action visible.
* `93-booking-fc10-review-form`: completion hero followed by an unselected review form.
* `14-home-recurring-plan-request`: **Active**, provider response **Pending**, no upcoming visits, yet Pause plan visible.
* `63-proposal-flow-customer-compares`: full service total on accept footer, separate smaller total-today text in content.
* `125-quote-editor-fb4`: rate card, line editor and persistent send/summary; settlement explicitly unavailable until saved.
* `09-archetype-fixed-package-book-mocked-payment`: **loading skeleton**, not evidence of the fixed form or payment completion.
* `62-proposal-flow-pro-sends-proposal`: actually shows a request-detail empty state, not the compose form.
* `87-booking-fc6-quote` and `88-booking-fc6-quote-scrolled`: closed/no-work followed by payments/help; **these two do not display the contradictory payable quote**.
* The contradiction is directly visible in **`89-booking-fc7-awaiting-payment`**, also identifiable in `contact-05.jpg`: closed/no-work/declined text, an approved-payment-due quote, and **Pay to start work on the same captured screen**.

The last observation does not establish raw backend rows, a capture, or which fixture/cron produced them. **SV-F22 independently proves a source-reachable inconsistency**, so renaming/reseeding screenshots alone is not the fix. No screenshot is a visual PASS; the three reported Home flag-coverage failures are not evidence of a service defect.

## Findings

All source paths below are relative to the frozen source root. Historical migration numbers are evidence, not proposed migration assignments.

| ID | Priority / class | Source-confirmed condition → exact repair | Owner / evidence |
|---|---|---|---|
| SV-F01 | P1 / A | Composer always adds revisions metadata; acceptance counts any deliverable array entry. No-delivery proposals become delivery-pending with an unreachable `on_completion` obligation. Count real non-revisions work; narrowly correct affected in-flight metadata cases. | O22; `proposal\compose\[requestId].tsx:85–115`; `0081_c2_creator_delivery.sql:665–678`; `0082_c1_creator_delivery_safety.sql:71–97,485–502` |
| SV-F02 | P1 / A | Generic quote editor/approval used across families; fixed package kinds fail its three-kind RPC and generic approval creates no fixed addon obligation. Dispatch existing fixed APIs, constrain generic APIs, preserve explicit BYO itemized compatibility. | O22 + O32; `ActionsRow.tsx:127–132`; `0079_f7_platform_fees_and_identity.sql:663–755`; `0075_f2_commission_correctness.sql:732–819` |
| SV-F03 | P1 / A | Booking-only realtime, independent schedule cache, mount-only detail screens and broken proposal retry leave stale controls or endless skeletons. Share state and explicitly refresh/retry. | O16/O21/O17; `supabaseApi.ts:839–853`; `PaymentScheduleTimeline.tsx:15–41`; `proposal\[id].tsx:37–59,113` |
| SV-F04 | P1 / A | Manager/admin reader treated as customer; `bookings[0]` selects unspecified history; accepted/disputed can read confirmed. Add safe viewer/request/current-booking projection and reuse corrected helper. | O21; `proposal\[id].tsx:32–35,108–125`; `proposalStatus.ts:21–39`; `0030_review_fixes.sql:363–380` |
| SV-F05 | P2 / A | Message RPC errors discarded; draft cleared/success announced on rejection. Unwrap error, preserve draft, disable closed conversation composer and show timestamps. | O21; `supabaseApi.ts:294–298`; `RequestQuestionThread.tsx:36–64`; `0052_merchant_staff.sql:1240–1251` |
| SV-F06 | P1 / A | Reschedule response lacks current booking-state guard. Accept after cancellation/expiry/work start can still move the visit. Recheck legal state under existing locks. | O17; `0057_recurring_plans_v2.sql:1831–1912` |
| SV-F07 | P2 / A | Recurring UI uses scheduled minus 24h/two-day copy; actual deadline depends on obligation due time, configurable grace and visit limit. Project exact safe deadline. | O17; `customerPresentation.ts:43–74`; `0057_recurring_plans_v2.sql:2219–2249` |
| SV-F08 | P2 / A | Plan controls omit acceptance/actor/cutoff; next visit can be ended; past open visits disappear; route can select another business’s role. Correct typed composites and exhaustive partition. | O17; `recurring\[id].tsx:160–181`; `recurring\provider\[id].tsx:108–160`; `0065_h2a_recurring_correctness.sql:737–745` |
| SV-F09 | P1 / A | One-session UI multiplies quantity that RPC ignores; fixed job duration does not scale like SQL. Assistant always routes to inspect-oriented `/book` without package/family selection. Resolve actual category family and units. | O15; `catalogue\api.ts:176–209`; `packageModel.ts:64–67`; `assistant.tsx:389–397`; `assistant\prefill.ts:74–82` |
| SV-F10 | P1 / A | Preview still uses 2900; pack UI uses 4900 while F7 writers use configured fees. Fix read source, not arithmetic; retain fixed config and existing snapshots. | O32; `0073_b1_server_pricing.sql:41–64`; `0079_f7_platform_fees_and_identity.sql:195–443,445–483` |
| SV-F11 | P1 / A | Request countdown uses booking creation, unlike expiry’s updated time; recurring exempt; accepted session trip is a no-op with success toast; proposal active states omitted. Add authoritative family/deadline/actions. | O25; `JobCards.tsx:20–100`; `ProviderDashboard.tsx:36–46,183–187`; `0065_h2a_recurring_correctness.sql:244–263` |
| SV-F12 | P2 / A | Review UI checks status only, prompts duplicates and omits eligible closed. Mirror exact backend eligibility without inventing capture/pack policy. | O16; `BookingDetailScreen.tsx:629–631`; `ServicesSegment.tsx:230–234`; `0012_matching_foundations.sql:341–351` |
| SV-F13 | P1 / A | Noncustomer assumed owner; future starts, unpaid delivery accept, submitted-delivery cancellation, premature no-show, missing closed dispute, and generic financial promises. Use safe family/actor/time capabilities. | O16; `BookingDetailScreen.tsx:389–470`; `0081_c2_creator_delivery.sql:844–882`; `0083_h3_home_booking_safety.sql:196–237` |
| SV-F14 | P2 / C | Fixed form hides address, forces mount-time slot and omits exclusions. Add visible inputs using existing checkout pieces. | O15; `book-fixed\[providerServiceId].tsx:39,96–115,193–226` |
| SV-F15 | P2 / A | All proposal versions/statuses enter Lowest/selectable comparison, then repeat as duplicate cards. Filter availability/current version; retain historical read. | O21; `request\[id].tsx:84–106`; `comparePresentation.ts:4–18`; `QuoteCompareTable.tsx:29–45` |
| SV-F16 | P2 / A | Valid revision defaults 4–10 fail 0–3 client restriction; configured zero/full advance cannot be represented. Use advertised bounds and omit zero milestone rows. | O22; `proposal\compose\[requestId].tsx:76–84`; `proposals\model.ts:25–38`; `0081_c2_creator_delivery.sql:253–286,384–397,432–460` |
| SV-F17 | P2 / A | Fixed recurring packages only load from route hint; quote identity excludes changed address. Derive family and invalidate full eligibility context. | O17; `recurring\new\[providerServiceId].tsx:126–180,247–254` |
| SV-F18 | P2 / C | Concrete hierarchy changes in the 88 rows below; retain real controllers/sticky actions, not a replacement engine. | O15/O16/O17/O21/O22; per-screen evidence below |
| SV-F19 | P1 / A | New request/send lack proposal-parent rejection; routing uses older readiness; configured intake validation only client-side. Narrow server parent/readiness/intake repair. | O21/O22; `0081_c2_creator_delivery.sql:180–246,326–364`; `0040_urgent_proposals.sql:420–450`; `0064_o2_provider_verification.sql:62–81` |
| SV-F20 | P1 / A | Closed hold can be request-cancelled without cancelling booking; later funding sets request booked. Deny request-only cancel while active booking exists; use existing booking cancellation. | O21; `0023_proposal_milestone_booking.sql:451–467`; `0088b_b6_money_notifications.sql:286–302` |
| SV-F21 | P1 / A | Generic completion can finish paid submitted proposal without accepting delivery, missing existing accepted-delivery window branch. Guard public entry points; retain finalizers/admin paths. | O22 + O32; `0023_proposal_milestone_booking.sql:1178–1228,896–917`; `0082_c1_creator_delivery_safety.sql:145–164` |
| SV-F22 | P1 / A | Ended booking can retain pending quote/Pay footer; stalled cleanup leaves attempts and legacy balance recorder omits booking-state check. Repair UI, safe retirement and narrow recorder acceptance. | O16 + O32; `BookingDetailScreen.tsx:364–378,626–628`; `0083_h3_home_booking_safety.sql:132–182`; `0088b_b6_money_notifications.sql:351–381` |

### The two requested narrow verifications

**Ended quote:** `pendingPaymentQuote && dueForPending > 0 && !scheduled` selects the payment footer without checking whether `booking.status` is payable. The pending quote also renders independently of ended status. `expire_stalled_bookings` changes a stale inspection from `quote_sent`/`awaiting_payment` to `closed_no_work` without retiring its offers/created balance attempts. The traced payout/allocation and terminal-coins functions do not retire them. New `prepare_payment` rejects ended status; **that is not sufficient protection for an already-created link**, because the latest legacy balance recorder tests quote state/amount without the corresponding booking-state predicate. T25 preserves existing not-owed/refund machinery and adds safe, nonblocking retirement. It must not simply call a blocking helper under reversed webhook locks. Evidence: `BookingDetailScreen.tsx:237–253,364–378,626–628`; `0029_single_due_payment.sql:137–149`; `0075_f2_commission_correctness.sql:394–454`; `0060b_demo_payout_isolation.sql:62–102`; `0088b_b6_money_notifications.sql:351–381`.

**Assistant:** `reviewDraft` and `bookPro` both enter `/book/[providerServiceId]`; `draftToBookParams` supplies brief/slot/address but **no package or archetype**. The controller’s normal submit calls inspect-only `create_booking`; package body requires package/family params. Assistant category context is active categories without an inspect-only filter; matching uses each category’s archetype and drafting checks availability/category, not inspect family. Thus **inspect handoff is valid; universal fixed/session/proposal handoff is not**. Resolve the real loaded family, preserve draft and select an actual package/request flow. No runtime AI-selection frequency is claimed. Evidence: `app\app\assistant.tsx:389–397`; `app\src\lib\assistant\prefill.ts:74–82`; `supabase\functions\ai-assistant\index.ts:212–255,789–835`; `logic.ts:205–226`; `0018_archetype_core.sql:450–463`; `0079_f7_platform_fees_and_identity.sql:228–235`.

## Screen placement audit

**Reading the tables:** **A** is an always-on truth/permission/accessibility fix; **C** is controlled family composition; **Retain** preserves verified source behavior. Assertions are required future cases, not test results. File names in each table resolve within its explicitly named body paths; the JSON holds complete repo-relative paths/ranges for every row.

### S05 — `app\app\(customer)\bookings.tsx`

Real bodies: `app\src\features\activity\UnifiedActivityScreen.tsx`, `ActivitySegmentControl.tsx`, `segments\ServicesSegment.tsx`, `RequestsSegment.tsx`, `ShopSegment.tsx`, `SportsSegment.tsx`.

Purpose: find current work or readable history within its real domain. Primary action: open the specific record requiring action.

| Element | Current | Problem/retain → target and reason | Evidence | Required assertion |
|---|---|---|---|---|
| Domains | Large title with horizontal segments | C: compact title, existing domains directly below; do not merge lifecycle engines | `UnifiedActivityScreen:108–137`; `ActivitySegmentControl:23–77` | All domains reachable at narrow/large text |
| Service filters | Active/Past/Repeat plans | C: readable Plans/filter; retain history visibility when feature off or lookup fails | `ServicesSegment:69–81,112–125` | Existing plan/failed lookup still reachable |
| Booking next step | Status-only line after progress | A: family/composite next action before secondary reference/amount | `ServicesSegment:185–267`; `status.tsx:78–92` | Submitted delivery/change order differs from ordinary completion |
| Past actions | Every completed gets Rate; closed omitted | A: eligible Leave review or View review; receipt secondary | `ServicesSegment:230–258` | No duplicate/unpaid prompt; eligible closed included |
| Plans | Raw status + first future occurrence | A: acceptance composite and first future nonterminal occurrence | `ServicesSegment:144–169` | Future expired/cancelled never Next |
| Requests | Raw status/expiry; later error hidden | A: brief/outcome/current-booking link and stale warning | `RequestsSegment:15–62` | Booked request opens exact booking; failed refresh visible |
| Load/empty/refresh | Independent segment loads; allSettled booking/plan | Retain beneath compact controls; one failure does not erase another domain | `UnifiedActivityScreen:73–101`; `ServicesSegment:42–67` | Plan error retains loaded bookings |

### S36 — `app\app\book\[providerServiceId].tsx`

Real bodies: `features\booking\book\BookScreen`, `BookScreenContent`, `useBookScreenController`, issue/schedule/address sections; conditional `packages\PackageBookingScreen` and `catalogue\SchemaForm`.

Purpose: the actual inspect or selected-package checkout. Primary action: correct-family pay/request availability, not a universal “Book”.

| Element | Current | Problem/retain → target and reason | Evidence | Required assertion |
|---|---|---|---|---|
| Issue/photos | First form section; empty chip list; four photos | Retain first editable section and prefill; do not invent populated chips | `BookIssueSection:9–86` | Description preserved; fifth photo excluded |
| Schedule/travel | When, slot filters, inline approval | Retain binding to service/window/location; travel approval is not booking acceptance | `BookScheduleSection:14–119`; `0014_travel_requests.sql:427–477` | Forged/stale approval rejected; pending cannot pay |
| Address | Below schedule; Change/editor | C: visible Address before review, footer blocker links to it | `BookAddressPriceSections:22–49`; `BookScreenContent:214–233` | Saving address restores valid draft |
| Price/action | Server preview and sticky footer; package mismatches | A: exact writer fee/quantity operands; one amount/action | `useBookScreenController:72–104`; `PackageBookingScreen:94–101` | Nondefault fee/session unit matches server |
| Family handoff | Hinted package branch else inspect submit | A: actual category selects fixed/time/proposal route before preview | `BookScreenContent:48–76`; `0079...sql:228–235` | Assistant/direct non-inspect cannot offer inspect Pay |
| Loading/steps | Retry skeletons; every layout current=0 | Retain retry; C: truthful section progress, not fake advancing wizard | `BookScreenContent:32–67,202–213`; `BookingStepLayout.tsx:13–20` | Price retry recovers; review not labeled perpetually first step |

### S37 — `app\app\book-fixed\[providerServiceId].tsx`

Purpose: select fixed package, quantity, actual visit/location and pay. Primary action: pay the reviewed fixed booking.

| Element | Current | Problem/retain → target and reason | Evidence | Required assertion |
|---|---|---|---|---|
| Package | First auto-selected; inclusions only | C: package first with readable inclusions/exclusions | `:193–209`; `fixedBooking.ts:22–33` | Selected scope visible before Pay |
| Quantity | Bounded +/- reset by package | Retain bounds; A: shared fixed duration equals SQL | `:82–89,210–219`; `0075...sql:917–932` | Quantity2 job/60min reserves120min |
| Schedule | Mount now+2h; caption only | C: editable When before address/review | `:39,220–226` | User interval sent; stale interval blocks |
| Address | Silently from context | C: visible saved-address/Change and missing-address reason | `:96–115,146–164` | Displayed address equals payload |
| Price/footer | Fixed fee RPC and sticky total | Retain matching fixed-config source; no new formula | `:41–65`; `0073...sql:3–17` | Same configured amount in created obligations |
| Empty/error/off | Skeleton, retry/no packages; no fixed-off form guard | A: unavailable state suppresses creation, not old detail | `:123–164` | Fixed parent off denies raw/create UI |

### S38 — `app\app\booking\[id].tsx`

Real bodies: `features\bookingDetail\BookingDetailScreen.tsx`, `StatusHeader`, `ActionsRow`, `DeliverySection`, `PaymentsSection`, `CancelSection`, `model`; `catalogue\PaymentScheduleTimeline`; `components\QuoteView`, `StatusHero`, `StatusTimeline`.

Purpose: authorized readback and exactly the next legal family action. Not every noncustomer is a provider owner.

| Element | Current | Problem/retain → target and reason | Evidence | Required assertion |
|---|---|---|---|---|
| Hero | Status first; mixed generic copy | A: family/delivery/closure-specific next action and actual policy deadline | `model:68–161`; `StatusTimeline:40–47` | Submitted delivery not OTP; timeout not “declined” |
| Due timeline | Second independent schedule query/cache | A: shared parent data/error drives header and footer | `BookingDetailScreen:109–153`; `PaymentScheduleTimeline:15–41` | Same-status paid change updates both; error is retryable |
| Codes | Customer card/provider entry near top | Retain secret/lockout; A: actual owner/time window only | `BookingDetailScreen:540–565`; `0022...sql:873–898`; `0023...sql:811–835` | Wrong role/future start has no executable code action |
| Quote/change order | Generic family path; ended pending quote can Pay | A: inspect full scope/fixed additive; ended quote history nonpayable | `ActionsRow:127–132`; `BookingDetailScreen:283–293,364–378` | Fixed base immutable; ended never Pay |
| Delivery/revisions | Links high; deadline/revision terms lower in Help | C: deadline/links/time/revisions together before history | `BookingDetailScreen:523–578`; `CancelSection:125–138` | Delivered work/remaining review obvious before history |
| Review | completed/closed&&!review | A: exact server eligibility/existing review; no invented pack policy | `BookingDetailScreen:629–631`; `0012...sql:341–351` | One eligible review only |
| Parties/scope | Details after actions; masked address/chat | Retain compact contextual readback and approved scope | `BookingDetailScreen:677–760`; `0052...sql:289–305` | Same PK; exact address only when permitted |
| Cancel/no-show/dispute | Incomplete sets; noncustomer owner assumption | A: capabilities, grace/start windows, submitted no-cancel, valid closed dispute | `BookingDetailScreen:457–470`; `ActionsRow:49–62` | UI allow/deny matches direct RPC |
| Payments/error | Actual refund subrows low; stale load error invisible | Retain real history; A: warning/current due above, no capture/refund promise from label | `PaymentsSection:35–99`; `BookingDetailScreen:144–147,507–522` | Pending/failed/partial refunds remain distinct |

### S49 — `app\app\merchant-calendar.tsx`

Real helpers: `features\recurring\providerApi.ts`, `providerPresentation.ts`. Purpose: **recurring** provider schedule, not all marketplace orders.

| Element | Current | Problem/retain → target and reason | Evidence | Required assertion |
|---|---|---|---|---|
| Context | Resolved business not named in header | C: business/timezone before date/action controls | `:62–79,114–121` | Switch identity and data together |
| Date toolbar | Day/Week plus previous/range/next | Retain local week calculations; compact responsive toolbar | `:121–152`; `providerPresentation:175–191` | Monday week; offset reset |
| Visit card | Title/status/time/amount/two actions | C: actual visit primary; plan secondary; staff read-only explicit | `:163–194` | Visit uses booking id; plan uses schedule id |
| Refresh/errors | Focus/pull, fallback timezone warning | Retain; A: external reschedule readback moves same PK/date group | `:57–91,154–163` | No duplicates or false empty after failure |
| Feature off | Unavailable notice | Retain both server parents; distinguish off from no saved records | `:108–115`; `0057...sql:2097–2103` | Calendar RPC denied; authorized plan read still works |

### S60 — `app\app\proposal\[id].tsx`

Purpose: scope/terms/current outcome, then permitted acceptance or current booking. Helpers: `proposalStatus`, proposal API and `RequestQuestionThread`.

| Element | Current | Problem/retain → target and reason | Evidence | Required assertion |
|---|---|---|---|---|
| State/actor | provider-id equality; hold warning for all customers | A: viewer role + request/proposal/current booking summary | `:32–35,108–125`; `0052...sql:481–488` | Manager/admin no customer Accept |
| Accept/fee | Service total on footer; real due_today in body | Retain fee reconfirmation; A: label actual today due separately | `:61–99,110–138`; `0081...sql:647–664` | Changed preview needs explicit second confirm |
| Scope/delivery/revisions | Separate total/revisions/items sections | A: metadata not delivery; C: scope/deadline/revisions together | `:101–167`; `0081...sql:665–678` | Revisions-only uses no-delivery route |
| Milestones | Real proposal_schedule cards | Retain terms; C: before commitment; accepted links current booking | `:153–162` | Proposal terms not substituted for booking obligations |
| Questions | Always writable; ignored RPC error | A: timestamped, lifecycle-aware, retains rejected draft | `RequestQuestionThread:25–64`; `supabaseApi:294–298` | Closed request cannot announce false send |
| Retry/return | Mount only; retry leaves error/fee stale | A: unified retry/focus/current outcome refresh | `:37–59,113` | Retry recovers; return after accept shows booking |

### S61 — `app\app\proposal\compose\[requestId].tsx`

Purpose: exactly-one-managed-recipient fixed proposal. It is currently a one-scope-line composer, not a generic multi-item form.

| Element | Current | Problem/retain → target and reason | Evidence | Required assertion |
|---|---|---|---|---|
| Brief/readiness | Loads all routed requests/config; Send mounted regardless | A: current request/business readiness before editable form | `:34–70,122–142` | Failed/closed/ambiguous route cannot send |
| Package/scope | Prefilled package then editable title/total/note | Retain real editable scope; prefill is not authorization | `:144–153`; `proposals\model:54–93` | Saved terms equal edits |
| Deliverables | hasDelivery excludes revisions; payload adds revisions | A: same real-work predicate on both sides | `:85–115` | No-delivery final obligation reachable |
| Deadline/revisions | Parent-aware deadline; revisions max3 | Retain deadline parent; A: actual server0..10/config bounds | `:31,76–84`; `0081...sql:253–286` | Defaults4/10 valid;11 denied |
| Advance | One percent input; two mandatory rows | A: configured0/full boundaries; positive rows only | `:106–115`; `proposals\model:25–38` | No zero row; exact sum and cap |
| Send/error | Sticky Send; general top error | Retain persistence; C: ready reason/first field focus | `:72–121,122–173` | Failed send preserves terms; success only after RPC |

### S62 — `app\app\proposal-delivery\[id].tsx`

Purpose: provider-owner submission of existing proposal deliverables, including revision resubmission.

| Element | Current | Problem/retain → target and reason | Evidence | Required assertion |
|---|---|---|---|---|
| Context/role | Generic title; no booking load | A: authorized booking/delivery state before editor | `:9–15`; `0082...sql:466–471` | Customer/manager/terminal state read-only |
| Links |1..20 title/HTTPS inputs and remove/add | Retain exact contract and draft editing | `:20–29,39–70` |0/21/non-HTTPS denied |
| Notice | Durable links and fixed72h | Retain durability; A: actual configured review window | `:71–76`; `0082...sql:182–199` | Nondefault hours displayed truthfully |
| Send/error/return | Sticky send; top error; back | A/C: count/readiness/error near action, invalidate readback | `:18–37` | Customer sees actual links/due state; failure retains input |
| Screening | Client syntax plus backend contact-title guard | Retain backend rule and actionable error | `0082...sql:472–483` | Forbidden title denied; valid HTTPS succeeds |

### S66 — `app\app\quote\[bookingId].tsx`

Purpose: actual inspect full-scope revision or existing fixed additive workflow, never a new universal quote engine.

| Element | Current | Problem/retain → target and reason | Evidence | Required assertion |
|---|---|---|---|---|
| Mode/context | URL hint labels change order | A: loaded status/family/quote_type decides mode/permission | `:87–113`; `0079...sql:686–708` | Forged hint does not change operation |
| Lines | Package/addon base into three-kind editor | A: immutable fixed base and positive addon drafts; inspect full scope unchanged | `:46,105–112`; `0075...sql:732–819` | Fixed snapshot/lines retained |
| Bill proof | Inline attach/replace above strict threshold | Retain >50000 paise rule and server enforcement | `:279–377`; `0079...sql:721–737` |50000 no proof;50001 proof required |
| Travel | Filtered from editable base; automatic total | Retain managed identity, once only | `:105–142`; `0079...sql:694–714` | Override rejected; no duplicate line |
| Footer/settlement | Multiple After sending placeholders | Retain server preview authority; C: one total/send, short notice | `:204–246`; `QuoteView:214–236` | No invented payout estimate |
| Error/readback | No load retry; error after long page | A/C: retry, action-local error, same-status refresh | `:168–190,404–412`; `supabaseApi:839–853` | Revision replaces old offer across actors |

### S68 — `app\app\recurring\[id].tsx`

Purpose: customer plan/actual occurrences, not a blanket action from plan.status.

| Element | Current | Problem/retain → target and reason | Evidence | Required assertion |
|---|---|---|---|---|
| Plan state | Active plus Pending response; Pause visible | A: Awaiting provider composite; active only accepted | `:249–261`; `customerPresentation:159–174` | Pending cannot Pause |
| Next visit | All future rows Upcoming; incomplete exclusions | A: first eligible open visit/current due above list | `:160–169,267–310` | Ended future never Next/Skip |
| Pay deadline | scheduled minus24h | A: actual obligation-derived safe projection | `customerPresentation:43–74`; `0057...sql:2219–2249` | Custom/late-generated expiry exact |
| Reschedule | Decisions after history; actor ignored | A/C: other-party decision high; own request Waiting | `:170–181,326–366` | Exact outcome key removes controls |
| Management/actor | Bottom buttons, status/flags only | A: ownership/cutoff/capabilities; preserve cancel safety | `:369–410`; `0057...sql:1300–1318` | Provider/staff cannot use customer controls |
| History | Past rows then all changes, raw labels | C: exhaustive history with original/new times, reason, timezone | `:311–368` | Every returned PK appears once |
| Refresh | Mount only; opened payment no reload | A: focus/foreground/bounded masked-RPC refresh | `:140–159,197–217` | External payment/acceptance read back |

### S69 — `app\app\recurring\new\[providerServiceId].tsx`

Purpose: request configured fixed/time recurrence. New v2 billing is **per visit only**.

| Element | Current | Problem/retain → target and reason | Evidence | Required assertion |
|---|---|---|---|---|
| Family/package | Package load only from route fixed hint | A: actual category drives fetch before form | `:126–180` | No-hint fixed route works |
| Frequency/dates | Large category-frequency controls first | Retain choices; C: service/package context then first-date preview | `:416–495` | Only supported configured values |
| Schedule/end | Duration before fixed package; end picker | Retain end/date/count; C: package/duration/window together | `:496–638` | Quantity changes correct visit duration |
| Address/quote | Address low; removed from quoteKey | A: visible address, full eligibility quote identity | `:247–254,640–660`; `0057...sql:676–688` | Unsupported address clears quote/send |
| Footer | Detailed quote card plus duplicated total | C: detail in review; compact one-total/request footer | `:355–410` | Field/keyboard remains usable |
| Mode/payment copy | Always provider-review and two days | A: actual plan/occurrence mode and configured windows | `:411–414,664–668`; `0065...sql:420–430` | Child-off occurrence mode described honestly |
| Ready/error/off | Correct parent/category guard, quote debounce | Retain; C: blocker by action, separate errors | `:265–294,342–354,670–683` | Late prior response ignored; parent-off denied |

### S70 — `app\app\recurring\provider\[id].tsx`

Purpose: correctly scoped business readback, conflicts, absence and reschedule.

| Element | Current | Problem/retain → target and reason | Evidence | Required assertion |
|---|---|---|---|---|
| Role/business | Route providerId may resolve different owner role | A: plan.provider_id authority, explicit matching context | `:108–140`; `0052...sql:212–248` | OwnerA/staffB spoof hint cannot manage B |
| Conflict | Time-off warning before plan | Retain explicit warning, no implicit cancellation | `:374–385`; `providerPresentation:205–235` | Warning alone never mutates booking |
| Partition | Future reportable/completed/other; past reportable lost | A: exhaustive future/current-overdue/history partition | `:142–160,391–411` | Each occurrence appears once |
| Changes | Editors ignore cutoff/pending duplicate; server stale Accept gap | A: counterparty decision/current-state guard | `:207–363`; `0057...sql:1831–1912` | Cancel between request/accept cannot move booking |
| Visit link/terms | `/booking/id`, raw state/decision | Retain same PK; C: family next step and staff read-only | `:200–228,386–390` | Read role not promoted to owner |
| Refresh/off | Focus/pull and distinct errors | Retain; bounded masked readback; resolution ungated | `:95–135,367–377`; `0057...sql:1915–1952` | Parent off hides new reschedule, not absence resolution |

### S71 — `app\app\request\[id].tsx`

Purpose: original brief, comparable actual offers, current hold/booked outcome and valid request-only cancellation.

| Element | Current | Problem/retain → target and reason | Evidence | Required assertion |
|---|---|---|---|---|
| Brief/header | Category/date/area/privacy; no original brief | C: actual brief/schema answers plus outcome | `:60–78` | Scope visible; private location not exposed |
| Offers | All versions/statuses eligible for Lowest | A: current available offers first; read-only history | `:84–91`; `comparePresentation:4–18` | Expired cheapest never actionable Lowest |
| Duplicate/outcome | Second card map; no current booking | C: one comparison and primary current-booking panel | `:91–106` | One primary action per offer |
| Cancel | Open/closed request regardless of active hold | A: Manage booking if active; backend request-cancel guard | `:34–50,108–110`; `0023...sql:451–467` | Cannot cancel request while hold survives |
| Empty/error | Null spinner; always Waiting when zero offers | A: unavailable and lifecycle-specific empty/readback | `:20–32,61–83` | Cancelled/expired not “waiting” |
| Questions/privacy | Through proposal; private explanation | Retain per-provider identity; contextual secondary link | `:55–58,77`; `0023...sql:1405–1421` | No shared public thread/private data |

### S72 — `app\app\request\new.tsx`

Real nested body: `app\src\features\catalogue\SchemaForm.tsx`, `schema.ts`.

| Element | Current | Problem/retain → target and reason | Evidence | Required assertion |
|---|---|---|---|---|
| Context/readiness | Target in header; package later; live Send during load | A: resolved category/provider/package before form | `:42–57,122–136` | Invalid/off config cannot send |
| Brief/schema | Client validations only | Retain renderer; A: equivalent narrow server validator | `:62–80`; `SchemaForm:18–101`; `0081...sql:199–207` | Raw malformed RPC leaves no inserts |
| Event/deadline | Date becomes four-hour window and deliver_by | C: explicit event versus remote deadline labels, no universal duration promise | `:69–80,162–197` | Remote urgent hidden; labels unambiguous |
| Private location | Context implicit; Venue/area visible | C: selected private location/change before submit | `:91–97,129–133`; `0081...sql:230–241` | Other user’s saved address denied |
| Budget | Maximum input silently adds80% minimum | C: explicit optional maximum, minimum null unless actually entered | `:86–90,199–202` | No invented range; finite nonnegative paise |
| Result/action | Sticky submit; honest zero/unknown recipient result | Retain result distinctions; ready reason/field error near action | `:99–120`; `0081...sql:241–246` | Target failure atomic; zero match not promised replies |

## Canonical lifecycle, role and readback matrices

### Identity and actual state fields — all nine assigned entities

| Entity | Real key/model | Actual states/composites; not an invented universal enum |
|---|---|---|
| `serviceOffering` | `provider_services.id`; unique provider/category. Many `service_packages.id` per service | Independent active booleans; category archetype five values; package price_type fixed/range/from/quote; bookability additionally category/city/docs/live/paused/lead/feature. `0001_init.sql:108–121`; `0017_creator_config.sql:258–294`; `0018_archetype_core.sql:239–282` |
| `serviceBooking` | `bookings.id`; party/service/category/address FKs; approved_quote_id |19 values below plus family, origin, quotes, delivery, obligations, time and role. `0001_init.sql:11–15,133–157`; `0020_proposal_enum_values.sql:1–4` |
| `serviceRequest` | `service_requests.id`; private extension PK=request_id; recipients PK(request_id,provider_id) | open/closed/booked/expired/cancelled. Closed often means unpaid accepted-proposal hold. `0023_proposal_milestone_booking.sql:53–95` |
| `bookingRequest` | **Derived booking projection**, `ProviderJob.booking_id=bookings.id`; no separate service booking_requests entity | Requested plus its booking outcomes; recurring plan request and travel approval are separate contracts. `0052_merchant_staff.sql:249–287` |
| `serviceQuote` | `quotes.id`; unique(booking_id,version); item ids separate | sent/approved_pending_payment/approved/rejected/superseded; quote_type itemized/package and is_change_order. `0001_init.sql:169–202`; `0019_fixed_package_booking.sql:67–76` |
| `proposal` | `proposals.id`; unique(request,provider,version); only one sent per provider/request | sent/withdrawn/accepted/rejected/expired. Accepted is not funded. Booking FK is **not unique**; active-request booking index is partial. `0023...sql:97–145,201–207`; `0030_review_fixes.sql:347–403` |
| `review` | `reviews.id`; unique booking_id | **No status enum**. Absent eligible/ineligible or existing review. Customer, completed/closed, nonnull total, booking-local paid total and uniqueness all required. `0001_init.sql:264–281`; `0012_matching_foundations.sql:325–352` |
| `recurringPlan` | `recurring_schedules.id`; many bookings/change rows | status active/paused/cancelled/completed × acceptance pending/accepted/declined × mode plan/occurrence × legacy/v2. `0022...sql:351–393`; `0057...sql:60–138` |
| `recurringOccurrence` | Actual `bookings.id`, recurring_schedule_id FK; unique(schedule,scheduled_at) | Booking state plus separate change ledger: skipped/provider_unavailable/reschedule_requested/rescheduled/reschedule_declined/provider_absent/cancelled. Change booking_id may be null. `0057...sql:235–285` |

Packages use units `job,hour,day,session,person,plate,sqft,bhk,seat,litre,event,month`; bounds/prices are real database checks. Category archetype `remote` exists in the foundation, but remote-only creator locations can run the **proposal** engine. No separate remote/order lifecycle is inferred.

### All 19 booking values and current legal action distinctions

| Canonical value | Actual meaning / customer | Provider/business distinction |
|---|---|---|
| pending_payment | Correct-family payment/cancellation; proposal hold not funded | Not incoming provider Accept |
| requested | Funded/allocated request; wait/cancel under actual family policy | Assigned owner accept/decline; recurring not universal15m |
| accepted | Accepted home/session or plan-preaccepted occurrence | Home trip; session code within±15m; not same workflow |
| confirmed | Normal paid proposal | Owner proposal code in actual start date/window and due prerequisites |
| en_route | Home arrival code/read/policy cancellation | arrive OTP → inspect or fixed/BYO work |
| inspecting | Await itemized quote | Owner/manager sends actual three-kind quote |
| quote_sent | Review initial quote | Revise can leave booking state unchanged |
| awaiting_payment | Pay approved initial balance; not started | Wait; no completion |
| in_progress | Work; possibly sent/pending-payment change order | Inspect full scope, fixed addon, session completion or proposal delivery/no-delivery |
| delivery_pending | Delivery preparation or revision_requested | Owner submits HTTPS work; customer deadline/dispute policy |
| completion_requested | Family-specific confirmation or submitted delivery review | OTP only applicable families; submitted delivery is not generic OTP |
| completed | Eligible review/dispute/history; settlement may remain | Read actual settlement; no universal24h promise |
| closed | Transfer-close outcome; eligible review and configured post-close dispute | History, not new mutation |
| closed_no_work | Inspection-only rejection or timeout; not work completed | No quote/payment/work CTA; distinguish closure cause |
| declined | Provider declined; refund rows determine processing | Decision controls removed |
| expired | Different ordinary/hold/occurrence expiry reasons | No work; proposal may reopen separately |
| cancelled | Policy/skip/absence outcome; not automatic full refund | No start/complete/new quote |
| disputed | Support/read while backend safety applies | Ordinary completion stopped; admin resolution only |
| refunded | Full-refund dispute outcome, not proof refund completed | History; actual refund rows separate |

Evidence: `components\status.tsx:5–111`; **actual writers** `0001_init.sql:957–1004`, `0019_fixed_package_booking.sql:722–760`, `0022_time_based_booking.sql:861–1037`, `0023_proposal_milestone_booking.sql:800–917`, `0081_c2_creator_delivery.sql:813–882`, `0082_c1_creator_delivery_safety.sql:59–216,453–545`, `0083_h3_home_booking_safety.sql:132–257`, `0088b_b6_money_notifications.sql:235–329,474–513,698–743`.

The transition registry is only a **coarse allowlist**, not action authorization. `0021_cancellation_availability_payouts.sql:362–371` adds a broad archetype×actor×status cancellation cross-product; public RPCs are narrower. `0018_archetype_core.sql:791–827` validates edges; `0052_merchant_staff.sql:71–89` maps manager actors for applicable calls. Neither makes owner-only RPCs manager-callable.

### Actual family transitions and guards

| Family / action | From → to | Actual gate / readback |
|---|---|---|
| Inspect create/fund | absent→pending_payment→requested | Current service/price/address/bookability; server recorder only; visit fee not client-authorized |
| Fixed create/fund | absent→pending_payment→requested | Active fixed package, qty/window/address, frozen package quote/obligations; accepted plan can autoadvance accepted |
| Session create/fund | absent→pending_payment→requested; paid pack allocation can start requested | One package price/duration; separate session recorder/finalizer |
| Ordinary owner acceptance | requested→accepted/declined | Exact provider owner, state; accept also not suspended. T12 aligns ordinary deadline with established expiry |
| Ordinary expiry | requested→expired | **Nonrecurring**, updated_at older15m, refund safety |
| Home trip/arrival | accepted→en_route→inspecting or fixed/BYO in_progress | Owner and start OTP; five attempts; fixed due prerequisite |
| Session start | accepted→in_progress | Owner, scheduled_at±15m, no upcoming/due obligation, correct OTP |
| Proposal start | confirmed→in_progress | Owner; scheduled_at±30m **or same current date**; required non-final due milestones paid; OTP |
| Inspect quote | inspecting→quote_sent→awaiting_payment/in_progress | Owner/manager sends; customer approves; recorder activates paid balance; reject initial→closed_no_work |
| Change order | in_progress retained | Sent/pending/approved quote is composite state. Fixed must create addon obligation, not generic full-scope schedule |
| No-delivery completion | in_progress→completion_requested→completed | Owner request; proposal completion obligation due; customer/OTP/all-paid guard; session separate |
| Actual proposal delivery | in_progress→delivery_pending→completion_requested/submitted→completed/accepted | Owner begin/submit, actual links; all-paid customer accept updates delivery_status before existing finalizer |
| Revision | completion_requested/submitted→delivery_pending/revision_requested | Customer, creator_revisions, remaining count, note5..1000; timer cleared |
| Auto-confirm | completion_requested→completed | Default24h non-delivery; configured category hours/default72 for delivered proposal; all proposal obligations paid; revisions excluded |
| Cancel/default/no-show | Family-specific eligible→cancelled or session-policy outcome; no-show→disputed | Actual owner/actor/time policy, not coarse registry; submitted delivery cancellation explicitly denied |
| Dispute/resolve/close | eligible→disputed→refunded/completed; completed→closed after transfer | Customer configured eligibility; admin resolution; system transfer-close. No public card recomputation |

Evidence: family function bodies cited above; ordinary expiry `0065_h2a_recurring_correctness.sql:244–263`; fixed addons `0075_f2_commission_correctness.sql:732–819`; scheduled approval `0019_fixed_package_booking.sql:566–609`; final delivery safety `0082_c1_creator_delivery_safety.sql:59–216`.

### Request, proposal, quote, review and recurring matrices

| Entity/action | State/actor rule | After action / opposite-role readback |
|---|---|---|
| Request creation | Customer, active proposal category, future date/lead or urgent policy, owned address | open; up to8 recipients or atomic targeted failure. T19 adds missing parent/readiness/schema enforcement |
| Send proposal | Exactly one routed business managed by actor; request open/unexpired/lead-valid | sent version; old sent withdrawn; customer notified |
| Accept proposal | Only request customer; sent/valid/open; lock request/proposal; no other active booking | accepted proposal + closed request + pending_payment hold; **not confirmed yet** |
| Hold funded | Actual recorder acceptance | booking confirmed; request booked; competing sent offers rejected |
| Hold expired | System, hold deadline | booking expired; proposal sent/expired and request open/expired; **multiple historical booking rows possible** |
| Request-only cancel | Customer open/closed currently | cancelled + sent offers rejected, booking untouched. T20 disallows this when active booking exists |
| Request question | Routed thread, customer or authorized business staff, request open/closed,1..2000 chars | Message id/nudge and other-party notification; T06 fixes lost errors |
| Quote send/replace | Owner/manager; actual family/kind restrictions | sent next version; same booking status possible; current approved scope preserved until activation |
| Fixed addon approve | Customer, fixed in_progress, sent package change order | Due addon schedule or activation; no changed base snapshot |
| Review submit | Customer; completed/closed; nonnull total; `_paid_total(id)>=total`; absent review | Unique review. No capture/pack-policy inference; tags≤5 from category |
| Plan create | Customer; fixed/time category recurrence and actual parent/rules | plan child on→active/pending; off→occurrence/accepted and materialization |
| Plan decision | Owner/manager, active/pending, both switches | accepted then generate, or declined/cancelled with reason;72h system timeout cancels pending |
| Pause/resume | Customer, effective skip/pause; accepted active to pause | Only eligible future **unpaid pending** visits cancelled; paid/work retained; resume materializes |
| Plan cancel | Customer active/paused or completed with future open | Existing future bookings resolved by actual family policy; acquisition flag not required |
| Skip | Customer pending_payment/requested/accepted occurrence beyond cutoff | Existing cancellation policy and skipped ledger; repeat idempotent |
| Absence | Owner/manager, actual four reportable occurrence states | Existing provider-fault resolution plus provider_absent ledger; acquisition flag not required |
| Reschedule request | Customer/manager, allowed state, original beyond cutoff, target>60m, no pending request | Ledger only; booking unchanged |
| Reschedule response | Counterparty, exact original/new identity, availability/target recheck | Accept moves **same booking PK**; decline leaves it. T07 adds missing current-state guard |
| Unpaid occurrence expiry | System remaining obligation cutoff | expired, open obligations waived/attempts retired/refunds safe, ledger + notifications; failure retains reservation |

Evidence: `0023_proposal_milestone_booking.sql:451–467`; `0030_review_fixes.sql:347–403`; `0052_merchant_staff.sql:1209–1274`; `0057_recurring_plans_v2.sql:1251–1450,1748–1952,2176–2317`; `0065_h2a_recurring_correctness.sql:405–485,623–780,783–1021,1024–1064`; `0081_c2_creator_delivery.sql:154–488,547–735`; `0012_matching_foundations.sql:325–352`.

### Cross-role permissions — same entity PK, different controls

| Operation | Customer | Provider owner | Manager | Staff | Admin/system |
|---|---|---|---|---|---|
| Edit offering/package prices | No | Own rows | No inherited right | No | Existing admin configuration only |
| Create booking/request | Own; cannot self-book or use another address | Customer role for another provider only | Same | Same | No impersonation |
| Accept/decline booking request | No | Assigned requested only | **No** | **No** | System preacceptance/expiry separate |
| Send quote/fixed addon/proposal | No | Guarded family/request | `_acts_for(manager)` | No | No impersonation |
| Approve quote/proposal/pay | Own customer only | No provider action | No | No | Recorders service-only |
| Trip/start/complete/submit delivery/default/provider cancel | No, except own customer confirm | Actual owner-only guarded action | **Not granted by proposal management** | No | Admin dispute/system finalize separate |
| Recurring plan acceptance/reschedule/absence | Customer counterpart where applicable | Yes guarded | Yes guarded | Read only | Rules/admin resolution separate |
| Read masked recurring plan/calendar | Own | Own business | Own business | Own business | Plan RPC not generic admin bypass |
| Review | Own, exact composite | Read only | Read only | Read only | Read not customer write |
| Resolve dispute | No | No | No | No | Admin only from disputed |

`_acts_for` membership honors `merchant_staff`; redacted request-view member union currently misses that flag and is repaired in T05. Regular booking reads, quotes, payment/events and admin RPCs have different scopes; **do not give staff payment rows or private plan address merely to build a card**. Evidence: `0052_merchant_staff.sql:27–89,212–305,321–347,433–509`; `0001_init.sql:1944–1973`; `0066_h2b_recurring_ux.sql:276–363`; `0086_o3_admin_money_visibility.sql:3–160`.

### Read/refresh contract

| Surface | Current source behavior | Required convergence |
|---|---|---|
| Customer activity | Focus/pull per segment; bookings/plans independent | Keep failure isolation; explicit stale request warning; safe view summary |
| Booking detail | Combined load; booking UPDATE subscription only | Same-status quote/obligation/review/refund refresh; one parent schedule |
| Proposal detail | Mount load, broken partial retry | Complete retry + current booking/actor state, focus/foreground |
| Request detail | Mount only; null spinner | State-specific unavailable/empty and opposite-role offer/outcome refresh |
| Question thread | Mount/local send only | Error propagation, timestamped current thread, safe focused refresh |
| Customer plan | Mount only; “opened” payment does not reload | Masked RPC focus/foreground/bounded active refresh |
| Provider plan/calendar | Focus/pull/local action | Retain and converge external response/date group without raw private grants |
| Admin | Audited privileged read RPC snapshot | Same booking PK/status; no claim about unaudited admin UI subscriptions |

Source: `supabaseApi.ts:509–573,839–853`; `ServicesSegment.tsx:42–67`; `RequestQuestionThread.tsx:25–49`; `proposal\[id].tsx:37–59,113`; `request\[id].tsx:20–32`; `recurring\[id].tsx:140–159,197–217`; `merchant-calendar.tsx:57–91`.

## Booking-facing payment inputs — preserve money ownership

| Path | Actual UI input versus writer | Decision |
|---|---|---|
| Inspect creation | Preview visit fee matches service; preview platform fixed2900 versus writer configured `platform_fees.inspect_quote` | Fix preview source; initial visit pay input and server authority retained |
| Fixed creation | Package price×validated quantity + `get_fixed_booking_fee`; writer uses same fixed config | Retain arithmetic/source; fix schedule/duration/input presentation |
| Single session | UI quantity multiplies package; single-session RPC sends no quantity and uses one package price/duration | UI one-session unit must be1; do not change writer to charge an invented multiple |
| Session pack | UI4900/49 versus configured pack fee | Read safe server fee; retain actual integer p_sessions writer |
| Proposal | Fee preview’s actual service_due/platform_fee/total_today and expected-value guard | Retain preflight; footer labels actual due today, not service total |
| Inspect quote detail | Parent paid sum uses paid-status amount less nonfailed refunds; `_net_paid` uses same operands; requiredTotal matches `_required_total` | **Operand parity only**, not gateway/capture equivalence. Keep coin/refund/settlement formulas |
| Scheduled/recurring | Actual due obligations and stored plan override, not generic total or assumed24h | Share current schedule/read expiry projection; never reprice old plan from new defaults. Preparation selects `status=due`, not `due_at<=now`: do not invent an earliest-payment gate or claim expiry time instantly changes state before cleanup |

Exact evidence: `app\src\lib\money.ts:93–144`; `BookingDetailScreen.tsx:223–253,344–378`; `0002_qa_fixes.sql:7–19`; `0001_init.sql:525–532`; `0073_b1_server_pricing.sql:3–64`; `0079_f7_platform_fees_and_identity.sql:195–443,445–483`; `0081_c2_creator_delivery.sql:515–544,647–664`; `0029_single_due_payment.sql:25–101`; `0030_review_fixes.sql:571–620`.

## Card contracts

### Booking card

Reuse/extract existing `ServicesSegment` card into `features\activity\ServiceBookingCard.tsx`, not a public order DTO.

1. Leading category icon; service/package title and compact canonical status.
2. Counterparty/reference, then **one actual family/composite next action**.
3. Contextual unread chat; actual schedule/timezone.
4. Labeled total/inspection fee; due only from current authorized obligation projection.
5. Primary context link into existing workflow. Secondary eligible review/receipt/book-again; ended/disputed history never Pay.

Input: `Booking`, typed safe `ServiceBookingUiState`, unread count and navigation callbacks. No secret OTP, admin document/payout fields or client capture computation. At large text/narrow width wrap title/action, stack amount/schedule and subordinate secondary controls. Retain skeleton/error/empty/fallback receipt. Required cases: same PK across roles, submitted/revised/no-delivery, pending addon, already-reviewed/closed eligibility, ended stale quote and privacy.

Evidence: `ServicesSegment.tsx:185–294`; `JobCards.tsx:104–149`; `status.tsx:5–111`; `bookingDetail\model.ts:68–185`.

### Booking-request card

Keep `providerDashboard\JobCards.tsx RequestCard`; extend its business-job projection. Identity is `bookings.id`, not a copied service request.

1. Category/package/requested identity; customer display name plus area/distance, no full address.
2. Server response deadline where actually applicable; recurring requested has no false15m countdown.
3. Brief/real thumbnails; schedule and correct family context.
4. Assigned **owner** Accept primary, confirmed Decline secondary, View details tertiary; manager/staff read/context only.
5. After decision remove decision controls and refresh same PK into family-specific next job.

A plan-request card remains a separate `recurring_schedules.id` contract. Do not compute fixed/session earnings from zero visit_fee. Narrow layouts may stack owner actions; loading failure is not “No requests”. Required cases: delayed funding, recurring request, owner/manager/staff/customer distinction, masked address, session code route and confirmed/delivery proposal discovery.

Evidence: `JobCards.tsx:20–100`; `ProviderDashboardView.tsx:134–177`; `0052_merchant_staff.sql:249–287`; `0065_h2a_recurring_correctness.sql:244–263`.

## Executable implementation plan

### Coordinator migration claims — deliberately unassigned

* `supabase\migrations\UNASSIGNED_SV_service_lifecycle.sql`
* `supabase\migrations\UNASSIGNED_SV_service_read_models.sql`
* `supabase\migrations\UNASSIGNED_SV_service_layout_flags.sql`

These are **UNASSIGNED coordinator claim tokens**, not runnable/numerically reserved migrations. Coordinator assigns final order and serializes shared function/DTO edits. Historical migration evidence above stays exact.

Tests below are proposed/extended cases, not executed results. New SQL files use `createHarness()`/`scenario()` plus the full chain through the new migration via `r1-test-harness.mjs`; never silently stop at an old target migration. Use isolated fixtures/slots and same-PK actor comparisons; explicitly cast parameters and print actual JSON on assertion failure. Coordinator registers files/parse commands in `supabase\tests\package.json`, consumed by `run-all.mjs`. Future targeted execution belongs in Codespace/lane CI, **not installation on the owner’s Windows machine**.

| Task / owner | Exact edit scope and ordered change | Named acceptance assertions / test file | Class / later review |
|---|---|---|---|
| SV-T01 / O22 | Lifecycle claim; `_proposal_has_delivery`, `accept_proposal`; `proposals\model.ts`, compose form. Exclude revisions metadata; narrow legacy correction preserving snapshots/amounts. | `sv_service_lifecycle.test.mjs`: NODELIVERY→completion due→paid completion; real delivery/revision unchanged; legacy selectors exclude real work/ended/disputed. | A / money |
| SV-T02 / O22+O32 | Lifecycle claim; generic send/approve wrappers/reject guards; `types.ts`, quote editor, `ActionsRow`, detail, existing `fixedBooking`. Fixed additive dispatch, immutable base; explicit inspect/BYO compatibility. | `SV-QUOTE-FAMILY-01`, `GUARD-02`, `COINS-03`, `BYO-04` in service lifecycle; wrong-family write rolls back all side effects. | A / money/auth |
| SV-T03 / O16 | Read-model claim publication, `supabaseApi.ts`, detail/StatusHeader/PaymentScheduleTimeline. Parent-controlled schedule, scoped subscriptions/refund IDs, focus and race-safe load. | `bookingDetail\__tests__\readback.test.tsx`: same-status revisions, due→paid, refund/review, error retry, cleanup, older-response ignored. | A / auth |
| SV-T04 / O21/O17 | New `features\serviceLifecycle\useFocusedServiceRefresh.ts`; proposal/request/customer/provider plan/calendar/thread/RequestsSegment. Focus+foreground, bounded30s only active/focused; complete retry and stale warnings. | `serviceLifecycle\__tests__\refresh.test.ts`: focus/foreground, background silence, blur cleanup, stale response; proposal successful retry recovers fee/content. | A / none |
| SV-T05 / O21 | Read-model claim `get_proposal_view_state`, recipient view member flag; proposal types/API/status/helper/detail/compose/request/inbox. Deterministic active/latest history and exact role. | `sv_request_proposal.test.mjs`: manager/admin not customer; two booking histories order-independent; disputed not confirmed; merchant_staff off denies member view. | A / auth |
| SV-T06 / O21 | `supabaseApi.ts`, `RequestQuestionThread.tsx`; unwrap errors, state-aware composer, timestamps, retain draft until success. Depends T05. | Thread tests: resolved RPC error never success/clear; booked/cancelled read-only; exact routed thread privacy. | A / auth |
| SV-T07 / O17 | Lifecycle claim `respond_visit_reschedule`; under existing locks assert current allowed state only for Accept; preserve exact idempotency/counterparty/new-time guards. | `sv_recurring_actions.test.mjs`: request→cancel/expire/start→Accept denied unchanged; valid accept same PK; duplicate no-op/self denied. | A / concurrency |
| SV-T08 / O17+O32 | Read-model claim masked plan/quote projections; recurring types/presentation/customer/create. Actual due amount/window/expiry/mode, no24h/two-day literals. | Read-model tests: nondefault due/grace, late generation, paid/waived, reschedule/config refresh; H1 address/net privacy retained. | A / money |
| SV-T09 / O17 | Recurring helpers/routes/activity model/plan cards. Add actor/business/acceptance/cutoff and exact pending identity; exhaustive partitions. Depends T07/T08. | Customer/provider presentation tests: pending no Pause, own request no response, ownerA/staffB denial, every occurrence PK once. | A / auth |
| SV-T10 / O15 | Book controller/content/package model/API plus Assistant/prefill. Actual-family resolver before preview; single session1; fixed SQL-equivalent duration; preserve draft. | Booking model/package/assistant tests: four-family route matrix, forged hint ignored, quantity/duration exact, original brief/address retained. | A / money |
| SV-T11 / O32 | Read-model claim preview/pack-fee getter/new-recurring fee source; package/API/proposal footer. Reuse writer configuration, keep fixed and old snapshots. | `b1_booking_price_preview`, `f7_platform_fees`, safe read-model cases: nondefault fees agree; accepted old plan untouched; expected proposal preview retained. | A / money |
| SV-T12 / O25 | Lifecycle/read-model claims acceptance deadline/job DTO; provider dashboard/View/JobCards/Widgets/types. Updated requested deadline, recurring exemption, actual family next action/priority. | Job projection/card cases: delayed funding fresh; recurring no timer; owner only; session code not fake trip; confirmed/delivery active. | A / concurrency |
| SV-T13 / O16 | Activity/detail/capabilities consume server eligibility, existing review ID/reason; no new pack/capture policy. Depends T14. | `reviewEligibility.test.tsx` and read-model cases: closed eligible, completed already-reviewed, unpaid/null-total/other role, pack-current-ineligible. | A / auth |
| SV-T14 / O16 | Read-model claim `get_service_booking_ui_state`; new typed `bookingDetail\capabilities.ts`; detail/actions/cancel/model/status/timeline/delivery form. Exact family/actor/time legal actions and honest copy. Depends T02/T24/T25. | Read-model RPC-versus-UI matrix across actual states/roles; start/no-show boundaries, paid delivery, closed dispute, no private/admin fields. | A / auth+money |
| SV-T15 / O15 | Layout claim `oorva_service_checkout`; fixed route and existing book/package bodies. Visible schedule/address/scope/exclusions, truthful section navigation, compact sticky current amount. Depends T10/T11. | Checkout/fixed layout cases: exact visible location/window payload; narrow/keyboard usability; OFF old composition with semantic fixes. | C / none |
| SV-T16 / O21 | `comparePresentation.ts`, request detail; use existing selectable/excludeFromLowest/warnings; one current offer and read-only version history. Depends T05. | Existing compare tests: expired cheapest excluded, new version current, all unavailable no Lowest, current hold primary, historical read retained. | A / none |
| SV-T17 / O22 | Read-model creator config bounds; proposal model/API/compose. Permit configured0/full advance via only positive rows, actual revision range. Depends T01. | Model/server cases: revisions0/4/10 valid/11 denied; cap0/10000 representable; sum/rounding/lower cap preserved. | A / money |
| SV-T18 / O17 | Recurring creation body/readiness tests. Category-driven package fetch; address eligibility in quote key; clear old quote immediately and ignore stale results. | No-hint fixed works; unsupported new address disables Send; forged package/family rejected. | A / none |
| SV-T19 / O21/O22 | Lifecycle claim create/send/route and narrow request-intake validator; request/compose ready state. Current proposal parent/live readiness, recursive configured value contract plus reserved keys. | `sv_request_proposal.test.mjs`: parent-off/child-on denied; required/type/enum/range/nested failure before writes; valid/no-match/targeted atomic paths; old resolution ungated. | A / auth |
| SV-T20 / O21 | Lifecycle claim `cancel_service_request`; request/API. Under existing request lock deny exact active booking set; route to booking cancellation, no alternate refund engine. | Hold unchanged on request-cancel denial; no-active request cancels; history not blocker; serialized accept/cancel/funding no contradictory state/lock inversion. | A / concurrency |
| SV-T21 / O16 | Layout claim `oorva_service_activity`; extract typed `ServiceBookingCard`; compact activity/filter/action priority. Depends T09/T13/T14. | Same-PK booking card matrix, readable Plans, review/history/off/privacy; Shop/Sports remain separate contracts. | C / none |
| SV-T22 / O21/O22 | Layout claim `oorva_service_workflows`; six request/proposal/delivery/quote routes plus detail delivery placement. Scope/terms/current outcome before commitment; private location; maximum-only budget; one comparison/action. | Per-screen placement/correct actor/readiness cases, no duplicate primary card, field error focus, layout off safety retained. Depends semantic tasks listed in JSON. | C / none |
| SV-T23 / O17 | Layout claim `oorva_service_recurring`; four recurring/calendar routes. Business/composite identity, current due/other-party decisions, exhaustive history, compact quote/request footer. Depends T04/T07/T08/T09/T18. | All four screen placements, exact visit/plan links, large text/keyboard, parent/layout off history/resolution retained. | C / none |
| SV-T24 / O22+O32 | Lifecycle claim public `confirm_completion`/`complete_booking` family guard only. Delivered proposal must accept_delivery; session must session finalizer. Do not blanket-block private admin finalization. Depends T01. | Paid submitted generic confirm/legacy OTP denied unchanged; proper accepted-delivery window retained; no-delivery/fixed/inspect/session/admin/system paths retained. | A / money/auth |
| SV-T25 / O32+O16 | Lifecycle/read-model claims stalled cleanup, legacy balance acceptance and closure projection; detail/model/QuoteView. Ended nonpayable UI; safe NOWAIT attempt retirement/retry; narrow recorder state guard; historical correction. | `SV-ENDED-QUOTE-01/02`, `CAPTURE-03`, `LOCK-04`: ended never Pay, timeout distinct, late owed check refunds safely, duplicate idempotency and webhook race preserved. | A / money/concurrency |

### Runtime controls and OFF behavior

Register these new **layout-only** switches OFF in the layout claim: group **Oorva**, sort orders210–213:

| Key | Label | User-visible OFF behavior |
|---|---|---|
| `oorva_service_checkout` | Oorva service checkout | Existing checkout composition; correct route/units/amount source/permissions remain fixed |
| `oorva_service_activity` | Oorva service activity | Existing activity composition; truthful actions/history/refresh remain |
| `oorva_service_workflows` | Oorva service workflows | Existing request/proposal/quote/delivery layouts; guards/terms/resolution remain |
| `oorva_service_recurring` | Oorva recurring layouts | Existing plan/calendar layouts; role/state/deadline and money safety remain |

JSON includes exact descriptions. Existing `booking_steps`, archetype flags, recurring parent/children, merchant calendar, urgent/deadline/revision controls are not replaced. Composition cannot enable an underlying disabled capability. **Class A always applies, including with Oorva OFF.** No cosmetic control gates existing payment recording, cancellation, refunds, expiry, settlement or payout safety.

## Retain/no-change invariants

* Keep real `BookScreen`/controller and package body; four-photo/owned-address/window validation, travel binding and server fee authority.
* Keep fixed base snapshot immutable and use actual fixed additive RPC; full revised inspect scope remains full scope.
* Keep separate session completion/cancellation/funding paths; do not assume completion requires a quote for a session.
* Keep proposal fee preflight/expected-value protection, hold idempotency, exact positive schedule sum, actual revision counts and HTTPS/title validation.
* Keep default72-hour **paid-only** delivered-proposal auto-confirm and configured accepted-delivery dispute/release semantics; never infer that every completion is24h.
* Keep masked recurring RPCs, provider-only net estimate, per-visit-only new billing, no silent repricing/discount, idempotent generation/rescheduling and expiry failure reservation.
* Keep receipt fallback, domain-specific activity segments and existing record readability. Do not invent a service booking-request table or a product-order engine.

## Risks, decisions and unverified limits

**No assigned screen/entity coverage blocker remains.** Integration requires coordinator allocation of the UNASSIGNED migration claims and focused implementation review where indicated; those are execution ownership gates, not “audit later” tasks.

* No live feature/config/schema state, actual gateway capture, refund completion or payout execution was queried. Source defaults are not deployed-setting claims.
* No reproduction SQL, application/device tests or new before/after captures were run. Assertions here name the evidence implementation must produce.
* The supplied images cover selected web states only; absent form/native images are **source-only**, not visual PASS.
* Whether pack-funded completed sessions should become review-eligible is a separate product-policy change. The planned repair is fully executable **without deciding it**: preserve exact current `submit_review` eligibility and stop offering rejected writes.
* Coordinator owns repository documentation, shared activity logging and brand/native primitives. Only this stream’s two session reports were written.

## Evidence references

[`services.json`](../design/oorva/audit/services.json) is the canonical complete evidence inventory: exact repo-relative nonempty source ranges, actual fields/enums/composites, actor/action/readback rules, all88 placement rows, all25 task file/assertion/dependency lists and files read. Source truth is exclusively the frozen SHA named at the top; draft transformation prose and screenshot filenames were not treated as status evidence.


## Addressable source task cards

<a id="sv-t01"></a>

### SV-T01

**Evidence findings:** SV-F01. **Logical WP:** O22. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `supabase\migrations\UNASSIGNED_SV_service_lifecycle.sql`; `app\src\features\proposals\model.ts`; `app\app\proposal\compose\[requestId].tsx`; `supabase\tests\sv_service_lifecycle.test.mjs`.

**Function scope:** `new _proposal_has_delivery(jsonb)`; `accept_proposal`.

**Required edits:**

1. Define private immutable delivery-presence predicate: actual non-revisions deliverable exists; add equivalent pure model helper for composer schedule choice.
2. Use predicate at accept_proposal instantiation while retaining immutable snapshots/revision terms and fee guards.
3. Add count-guarded legacy correction only for proposal snapshots containing revisions metadata but no non-revision work: never-submitted active pending rows become not_applicable; never-submitted delivery_pending rows return to in_progress with explicit correction event. Do not alter delivery_snapshot/amounts.
4. For already submitted revisions-only legacy completion_requested rows, preserve submitted links/review state and make only their existing upcoming on_completion obligations due with notification; do not generate a new obligation/amount. Money owner reviews exact selection/count and rollback plan.
5. Add full-chain cases before integration with completion guard T24.

**Acceptance:**

- Revisions-only proposal can finish through no-delivery route and its existing on_completion milestone becomes due.
- Actual delivered work still requires begin/submit/review and all-paid acceptance; revision counters unchanged.
- Legacy correction excludes any real non-revisions work, completed/disputed/ended rows and monetary snapshot changes.

**Tests (requirements, NOT RUN):**

- supabase\tests\sv_service_lifecycle.test.mjs::SV-PROPOSAL-NODELIVERY-01,SV-PROPOSAL-DELIVERY-02,SV-PROPOSAL-LEGACY-03
- app\src\features\proposals\model.test.ts::deliveryPresenceExcludesRevisionMetadata

**OFF behavior:** Semantic correction applies in all layouts. Existing delivery/completion/payment/cancel safety remains callable; no acquisition switch is used as a repair gate..

<a id="sv-t02"></a>

### SV-T02

**Evidence findings:** SV-F02. **Logical WP:** O22. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\src\lib\types.ts`; `app\app\quote\[bookingId].tsx`; `app\src\features\bookingDetail\ActionsRow.tsx`; `app\src\features\bookingDetail\BookingDetailScreen.tsx`; `app\src\lib\fixedBooking.ts`; `supabase\migrations\UNASSIGNED_SV_service_lifecycle.sql`; `supabase\tests\sv_service_lifecycle.test.mjs`.

**Function scope:** `send_quote`; `approve_quote`; `approve_quote_with_coins`; `reject_quote`; `send_fixed_addons`; `approve_fixed_change_order`.

**Required edits:**

1. Add actual quote_type/source_package_id/package_snapshot and booking_origin to typed projections.
2. Derive quote mode from loaded booking/state; fixed package base is read-only and new drafts are positive addons sent through existing sendFixedAddons.
3. Dispatch fixed customer approval through approveFixedChangeOrder, retaining its addon obligation; inspect/BYO itemized uses existing full revised scope and generic coin path.
4. Reject unsupported marketplace fixed/proposal/time_based generic send/approve/reject before any writes; explicitly preserve existing BYO itemized agreement route rather than assuming archetype alone.
5. Hide unsupported session/proposal change-order controls, reject wrong-role deep link and retain managed travel/proof behavior.

**Acceptance:**

- Fixed addon preserves original package lines/snapshot, increments version and creates correct addon obligation only after customer approval.
- Inspect reductions, positive deltas, coins and stale-link safety unchanged; unsupported direct RPC fails atomically.
- Correct owner/manager can send allowed quotes; staff/customer cannot; route changeOrder hint cannot change operation.

**Tests (requirements, NOT RUN):**

- supabase\tests\sv_service_lifecycle.test.mjs::SV-QUOTE-FAMILY-01,SV-QUOTE-GUARD-02,SV-QUOTE-COINS-03,SV-QUOTE-BYO-04
- app\src\features\bookingDetail\__tests__\model.test.ts::familySpecificQuoteActions
- app\src\features\booking\packages\__tests__\packageModel.test.ts::fixedAddonBaseImmutable

**OFF behavior:** Always repair wrong dispatch/permission. Do not gate approval/payment/refund resolution for an existing valid offer behind Oorva or acquisition availability..

<a id="sv-t03"></a>

### SV-T03

**Evidence findings:** SV-F03. **Logical WP:** O16. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\src\lib\supabaseApi.ts`; `app\src\features\bookingDetail\BookingDetailScreen.tsx`; `app\src\features\bookingDetail\StatusHeader.tsx`; `app\src\features\catalogue\PaymentScheduleTimeline.tsx`; `supabase\migrations\UNASSIGNED_SV_service_read_models.sql`; `app\src\features\bookingDetail\__tests__\readback.test.tsx`.

**Required edits:**

1. Make PaymentScheduleTimeline a controlled presentation of parent schedule/loading/error; one fetch drives header and sticky footer.
2. Extend subscribeToBooking with quotes/payment_schedule/booking_events/payments/reviews booking_id filters and refunds filtered by the current known payment ids; rebind when ids change, clean up all channels.
3. Idempotently add only required RLS-protected tables to existing supabase_realtime publication when it exists; grant no new SELECT privileges.
4. Add focus/foreground detail refresh and load-generation guards so an older actor/entity response cannot overwrite newer state.
5. Render first-load and stale refresh errors explicitly; ActionsRow/CancelSection success must invalidate shared parent state rather than only local copy.

**Acceptance:**

- Same-status quote revision, milestone paid, refund subrow and review insert change actual visible state without a remount.
- No child stale paid/due contradiction; initial schedule error renders Retry, not skeleton forever.
- Unrelated rows/actors do not trigger visible private data; unmount removes channels and older load cannot overwrite current booking.

**Tests (requirements, NOT RUN):**

- app\src\features\bookingDetail\__tests__\readback.test.tsx::sameStatusQuoteRevision,scheduleFailureRetry,refundAndReviewReadback,olderLoadIgnored,cleanupSubscriptions
- supabase\tests\sv_booking_read_models.test.mjs::SV-BOOKING-READ-AUTH-01

**OFF behavior:** Refresh/permission truth always applies; payment/refund/history still refresh when all presentation/acquisition switches are off..

<a id="sv-t04"></a>

### SV-T04

**Evidence findings:** SV-F03. **Logical WP:** O21. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\src\features\serviceLifecycle\useFocusedServiceRefresh.ts`; `app\app\proposal\[id].tsx`; `app\app\request\[id].tsx`; `app\app\recurring\[id].tsx`; `app\app\recurring\provider\[id].tsx`; `app\app\merchant-calendar.tsx`; `app\src\features\activity\segments\RequestsSegment.tsx`; `app\src\features\proposals\RequestQuestionThread.tsx`; `app\src\features\serviceLifecycle\__tests__\refresh.test.ts`.

**Required edits:**

1. Add narrow hook useFocusedServiceRefresh(load,{enabled,pollMs:30000}) using useFocusEffect plus AppState; refresh immediately on focus/foreground and at bounded interval only while focused/active; cleanup blur/unmount. Purpose is safe RPC refresh where raw plan rows are intentionally masked.
2. Use hook in request/proposal/customer-plan and existing provider/calendar readbacks; preserve current per-screen loading/stale handling and cancel/ignore stale loads.
3. Unify ProposalDetail retry with initial load including fee/config/view state and explicit error clearing.
4. Turn null/inaccessible request into unavailable state; show later RequestsSegment refresh failure above retained rows.
5. Payment opened/return and delivery/quote/router.back invalidate affected detail/current request/plan, not assumed remount.

**Acceptance:**

- Other actor's proposal/plan/reschedule change appears on focus/foreground or bounded active refresh; no raw private table grant.
- Proposal error then successful retry exits error and restores fee; request null does not spin forever.
- Background/blurred screens do not poll; concurrent loads cannot overwrite newer identity/state.

**Tests (requirements, NOT RUN):**

- app\src\features\serviceLifecycle\__tests__\refresh.test.ts::focusForegroundRefresh,activeOnlyBoundedPolling,blurCleanup,outOfOrderIgnored
- app\src\features\proposals\__tests__\detailReadback.test.tsx::retryClearsErrorAndFee
- app\src\features\activity\__tests__\activityModel.test.ts::staleRequestRefreshWarning

**OFF behavior:** Existing record reads/refresh remain available when acquisition is off; no feature flag is used to suppress stale/error truth..

<a id="sv-t05"></a>

### SV-T05

**Evidence findings:** SV-F04. **Logical WP:** O21. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `supabase\migrations\UNASSIGNED_SV_service_read_models.sql`; `app\src\lib\types.ts`; `app\src\lib\proposalStatus.ts`; `app\src\features\proposals\api.ts`; `app\app\proposal\[id].tsx`; `app\app\proposal\compose\[requestId].tsx`; `app\app\request\[id].tsx`; `app\src\features\proposals\ProviderProposalInbox.tsx`; `supabase\tests\sv_request_proposal.test.mjs`.

**Function scope:** `new get_proposal_view_state(uuid)`; `service_request_provider_view`.

**Required edits:**

1. Create authorized read RPC output {proposal_id,viewer_role,request_status,request_expires_at,current_booking_id,current_booking_status,current_booking_created_at,payment_hold_expires_at,delivery_status,can_accept,can_withdraw,can_send_new,can_message}. Authorize exact customer, manager/owner, permitted admin read; no private location/financial fields.
2. Select active booking with same proposal/request using accept_proposal's active set; when none, choose latest history deterministically by created_at/id. Never use embedded bookings[0].
3. Reuse proposalStatus with explicit composite and real fulfillment/ended labels; accepted hold links to current booking; only customer gets valid sent Accept.
4. Require merchant_staff in provider-view membership union while retaining owner branch; type redacted provider-request DTO accurately.
5. Compose unavailable/loading states suppress editing/send; provider inbox gains same current-booking context without duplicated status rules.

**Acceptance:**

- Actor capabilities match existing write guards; manager/admin are not mistaken for customer.
- Expired historical hold cannot override current booking; accepted disputed/fulfilled/cancelled states read correctly.
- Staff switch off removes member-only view access; owner still sees own records; no private request fields exposed.

**Tests (requirements, NOT RUN):**

- supabase\tests\sv_request_proposal.test.mjs::SV-PROPOSAL-ROLE-01,SV-PROPOSAL-HISTORY-02,SV-PROPOSAL-STATE-03,SV-STAFF-OFF-04
- app\src\lib\__tests__\proposalStatus.test.ts::multiBookingComposite,disputeNotConfirmed,managerReadOnly

**OFF behavior:** Historical proposals/booking links stay readable for authorized actors; new send/accept follows actual parent guards and existing money resolution remains intact..

<a id="sv-t06"></a>

### SV-T06

**Evidence findings:** SV-F05. **Logical WP:** O21. **Class:** A. **Source task prerequisites:** SV-T05.

**Proposed source files (canonical allocation takes precedence):** `app\src\lib\supabaseApi.ts`; `app\src\features\proposals\RequestQuestionThread.tsx`; `app\src\features\proposals\__tests__\RequestQuestionThread.test.tsx`.

**Function scope:** `send_request_message (unchanged)`.

**Required edits:**

1. Unwrap RPC error and typed message_id/nudge result; do not count a resolved Supabase error as success.
2. Pass can_message/request state to thread; retain messages but hide/disable composer with closed explanation when not open/closed.
3. Clear draft only after successful write/readback; add existing created_at timestamps and safe focused refresh.
4. Keep thread identity (request_id,provider_id) and server leakage nudge behavior.

**Acceptance:**

- Rejected RPC preserves draft and no success toast; successful message has real returned id/readback.
- Booked/cancelled/expired composer unavailable; raw server remains denied.
- Customer/business staff permitted thread, unrelated thread denied; no cross-provider message disclosure.

**Tests (requirements, NOT RUN):**

- app\src\features\proposals\__tests__\RequestQuestionThread.test.tsx::rpcResolvedErrorRetainsDraft,closedReadOnly,successfulTimestampReadback
- supabase\tests\sv_request_proposal.test.mjs::SV-THREAD-AUTH-01

**OFF behavior:** Existing authorized readable conversation state remains visible; Oorva layout does not control server permission or erase messages..

<a id="sv-t07"></a>

### SV-T07

**Evidence findings:** SV-F06. **Logical WP:** O17. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `supabase\migrations\UNASSIGNED_SV_service_lifecycle.sql`; `supabase\tests\sv_recurring_actions.test.mjs`.

**Function scope:** `respond_visit_reschedule`.

**Required edits:**

1. After locking current change/booking/plan and checking exact idempotent outcome, add p_accept-only current-status assertion for pending_payment/requested/accepted/confirmed.
2. Keep original_at equality, opposite actor, >60m target, provider availability/conflict checks and exact outcome identity.
3. Allow safe idempotent read/decline handling without making an ended visit schedulable.
4. Test cancel/expire/start between request and response with independent fixtures and a concurrent response pair.

**Acceptance:**

- Stale Accept cannot change status, scheduled_at/window, due rows or change ledger of ended/in-progress booking.
- Valid opposite-party Accept preserves PK and duration and creates one outcome; duplicate response is no-op.
- Customer cannot accept own request; manager/staff permissions remain exact.

**Tests (requirements, NOT RUN):**

- supabase\tests\sv_recurring_actions.test.mjs::SV-RESCHEDULE-TERMINAL-01,SV-RESCHEDULE-ALLOW-02,SV-RESCHEDULE-IDEMPOTENT-03,SV-RESCHEDULE-RACE-04

**OFF behavior:** Parent/child-off new reschedule still rejected; cancellation/absence/expiry of existing work not gated..

<a id="sv-t08"></a>

### SV-T08

**Evidence findings:** SV-F07. **Logical WP:** O17. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `supabase\migrations\UNASSIGNED_SV_service_read_models.sql`; `app\src\features\recurring\types.ts`; `app\src\features\recurring\providerTypes.ts`; `app\src\features\recurring\customerPresentation.ts`; `app\app\recurring\[id].tsx`; `app\app\recurring\new\[providerServiceId].tsx`; `supabase\tests\sv_booking_read_models.test.mjs`.

**Function scope:** `_recurring_plan_payload`; `quote_recurring_plan`.

**Required edits:**

1. Extend masked occurrence projection with remaining_due_paise, payment_due_at, payment_expires_at and actor can_pay; use exact existing obligation/rule selection from expiry/preparation, not scheduled-24h. Do not invent a payment-opening gate: current preparation selects status=due, not due_at<=now.
2. Add safe acceptance-mode/payment-window summary to new recurring quote response; do not expose admin-only config wholesale.
3. Replace visitPaymentLabel constants and creation's two-day/provider-review promises with those actual values.
4. Preserve current address masking, provider-only net estimate, frozen plan fee overrides and per-visit-only billing.

**Acceptance:**

- Default/custom due/grace and late-created visit labels equal existing backend deadline predicate exactly.
- Reschedule/config update and partial paid/waived rows refresh projected current amount/window.
- Provider pending privacy and customer exclusion from provider net estimate remain unchanged.

**Tests (requirements, NOT RUN):**

- supabase\tests\sv_booking_read_models.test.mjs::SV-RECURRING-DEADLINE-01,SV-RECURRING-DEADLINE-02,SV-RECURRING-PRIVACY-03
- app\src\features\recurring\__tests__\customerPresentation.test.ts::serverProjectedDeadline,noAssumed24Hours

**OFF behavior:** Old plans/obligations and safe payment/readback remain visible; no cleanup/recording behavior depends on layout flag..

<a id="sv-t09"></a>

### SV-T09

**Evidence findings:** SV-F08. **Logical WP:** O17. **Class:** A. **Source task prerequisites:** SV-T07, SV-T08.

**Proposed source files (canonical allocation takes precedence):** `app\src\features\recurring\customerPresentation.ts`; `app\src\features\recurring\providerPresentation.ts`; `app\src\features\recurring\types.ts`; `app\app\recurring\[id].tsx`; `app\app\recurring\provider\[id].tsx`; `app\app\recurring\new\[providerServiceId].tsx`; `app\src\features\activity\model.ts`; `app\src\features\activity\segments\ServicesSegment.tsx`.

**Function scope:** `_recurring_plan_payload (safe action inputs/capabilities only)`.

**Required edits:**

1. Extend getRecurringPlanActions inputs to actual actor ownership, acceptance/mode, safe capabilities and eligible occurrence/cutoff; pending plan cannot Pause.
2. Resolve business context from plan.provider_id and reject mismatched route hint; customer route verifies plan.customer_id before customer controls.
3. Use one exact pending-reschedule identity helper and requester/counterparty display rule on both plan routes.
4. Implement exhaustive partition by time+actual booking status and first legal next/skip candidate; retain past open, future ended and still-resolving visits under completed/paused plans.
5. Render actual plan-level versus occurrence acceptance copy and maintain cancel/absence safety.

**Acceptance:**

- Every returned occurrence PK appears exactly once; expired/refunded/no-work never becomes next actionable/skip.
- Own pending reschedule cannot be self-accepted; pending active plan no Pause; valid paused/completed-plan resolution remains reachable.
- OwnerA/staffB spoof hint cannot show B manager controls; all parent-off/child-on cases fail closed without losing history.

**Tests (requirements, NOT RUN):**

- app\src\features\recurring\__tests__\customerPresentation.test.ts::pendingAcceptedPausedCompletedActions,counterpartyOnly,nextEligibleVisit
- app\src\features\recurring\__tests__\providerPresentation.test.ts::exhaustivePartition,businessScopedRole
- supabase\tests\sv_recurring_actions.test.mjs::SV-PLAN-CAPABILITY-PARITY-01

**OFF behavior:** Existing records, customer cancellation and authorized provider absence remain; new skip/reschedule/acceptance follows existing effective switches..

<a id="sv-t10"></a>

### SV-T10

**Evidence findings:** SV-F09. **Logical WP:** O15. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\src\features\booking\book\useBookScreenController.ts`; `app\src\features\booking\book\BookScreenContent.tsx`; `app\src\features\booking\packages\PackageBookingScreen.tsx`; `app\src\features\booking\packages\packageModel.ts`; `app\src\features\catalogue\api.ts`; `app\app\assistant.tsx`; `app\src\lib\assistant\prefill.ts`.

**Function scope:** `create_booking/create_session_booking/create_fixed_booking (unchanged authority)`.

**Required edits:**

1. Add typed resolveServiceBookingEntry(service,draft) returning existing inspect/fixed-package/time-package/proposal-request destination and preserved safe prefill; loaded category is authority, route hints are not.
2. Apply resolver before controller requests wrong-family preview or offers inspect submission; use same resolver for Assistant reviewDraft/bookPro, preserving original description/slot/address and asking actual package selection where needed.
3. Restrict non-pack time package to exactly one session; quantity is a pack count only for purchase_session_pack.
4. Add fixedBookingDuration(package,quantity) matching fixed SQL qty_min/qty_max and ceil rule; use in both fixed routes; retain time package duration semantics separately.
5. Hide new-submit controls on effective family off while old booking details remain accessible.

**Acceptance:**

- Assistant and direct links for all four actual families reach correct real body or unavailable state, never upgrade_required after a misleading inspect Pay.
- Displayed single-session quantity and created amount/duration use same unit; fixed quantity2 job reserves required two-package duration.
- Draft text/address/slot survives valid handoff; invalid stale slot reselects rather than silently paying.

**Tests (requirements, NOT RUN):**

- app\src\features\booking\book\__tests__\model.test.ts::familyAwareEntry,assistantPrefillPreserved,forgedHintIgnored
- app\src\features\booking\packages\__tests__\packageModel.test.ts::singleSessionUnit,fixedQuantityDuration
- app\src\lib\assistant\__tests__\prefill.test.ts::nonInspectDestination

**OFF behavior:** Correct route, amount-unit truth and parent enforcement apply in old/new composition; existing payment/cancel remains ungated..

<a id="sv-t11"></a>

### SV-T11

**Evidence findings:** SV-F10. **Logical WP:** O32. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `supabase\migrations\UNASSIGNED_SV_service_read_models.sql`; `app\src\features\booking\packages\PackageBookingScreen.tsx`; `app\src\features\catalogue\api.ts`; `app\app\proposal\[id].tsx`; `supabase\tests\sv_booking_read_models.test.mjs`; `supabase\tests\b1_booking_price_preview.test.mjs`; `supabase\tests\f7_platform_fees.test.mjs`.

**Function scope:** `get_booking_price_preview`; `new get_session_pack_fee()`; `_recurring_plan_quote`; `_platform_fee_config (reuse)`.

**Required edits:**

1. Money owner changes only fee-source reads: inspect/time preview uses corresponding _platform_fee_config key; pack fee getter returns current pack key under authentication.
2. Remove 4900/49 from package totals/labels; display exact returned fee and revalidate changed payable context.
3. Use configured time fee for newly quoted recurring plan and preserve stored override for existing plans; fixed get_fixed_booking_fee stays on current fixed config.
4. Proposal accept footer displays total_today with separate service total; retain expected fee/service guards and payment recorder semantics.
5. No reimplementation or alteration of capture/refund/payout/commission formulas in this task.

**Acceptance:**

- Nondefault valid fee settings match each actual create path and shown review/footer amount.
- Old booking/accepted plan terms do not change after new config; fixed path unchanged.
- No amount derived from client config can authorize money; server RPC remains final.

**Tests (requirements, NOT RUN):**

- supabase\tests\sv_booking_read_models.test.mjs::SV-FEE-SOURCE-01,SV-FEE-SNAPSHOT-02
- supabase\tests\b1_booking_price_preview.test.mjs::configuredInspectAndTimeFee
- supabase\tests\f7_platform_fees.test.mjs::packPreviewMatchesWriter
- app\src\features\proposals\model.test.ts::totalTodayAndFreshness

**OFF behavior:** Fee-source truth applies regardless of layout; current money recording/refunds/settlement remain independently operational..

<a id="sv-t12"></a>

### SV-T12

**Evidence findings:** SV-F11. **Logical WP:** O25. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `supabase\migrations\UNASSIGNED_SV_service_lifecycle.sql`; `supabase\migrations\UNASSIGNED_SV_service_read_models.sql`; `app\src\lib\types.ts`; `app\src\features\providerDashboard\ProviderDashboard.tsx`; `app\src\features\providerDashboard\ProviderDashboardView.tsx`; `app\src\features\providerDashboard\JobCards.tsx`; `app\src\features\providerDashboard\DashboardWidgets.tsx`; `supabase\tests\sv_booking_read_models.test.mjs`.

**Function scope:** `get_my_business_provider_jobs`; `accept_booking`.

**Required edits:**

1. Extend safe business job output with actual family/origin/recurring id, nullable request_expires_at and owner action flags; retain address mask.
2. For ordinary requested acceptance assert updated_at+15m is still open under lock; recurring requested exempt exactly as established expiry function. Decline/resolution still follows current safe policy.
3. RequestCard uses server deadline and owner actions, adds View details, removes universal created_at timer and zero-visit-fee service-earning implication.
4. Use family-aware next job actions; session accepted opens actual booking start-code workflow instead of no-op startTrip/toast; include proposal confirmed/delivery_pending in active priority.
5. Do not redesign unrelated provider identity/dashboard panels.

**Acceptance:**

- Newly funded old booking gets current ordinary response window; recurring occurrence never receives false15m expiry.
- Only assigned owner accepts/declines; action success follows actual mutation and refreshed same PK.
- All actual active proposal/session work is discoverable with correct action and no fake earnings/capture assertion.

**Tests (requirements, NOT RUN):**

- supabase\tests\sv_booking_read_models.test.mjs::SV-REQUEST-CARD-01,SV-REQUEST-CARD-ROLE-02
- app\src\features\providerDashboard\__tests__\requestPresentation.test.ts::delayedFundingDeadline,recurringNoCountdown,sessionStartRoute,proposalActivePriority

**OFF behavior:** Incoming existing work remains resolvable; layout flags do not block owner decisions or refunds..

<a id="sv-t13"></a>

### SV-T13

**Evidence findings:** SV-F12. **Logical WP:** O16. **Class:** A. **Source task prerequisites:** SV-T14.

**Proposed source files (canonical allocation takes precedence):** `app\src\features\activity\segments\ServicesSegment.tsx`; `app\src\features\bookingDetail\BookingDetailScreen.tsx`; `app\src\features\bookingDetail\capabilities.ts`; `supabase\tests\sv_booking_read_models.test.mjs`; `app\src\features\bookingDetail\__tests__\reviewEligibility.test.tsx`.

**Function scope:** `get_service_booking_ui_state (from T14)`; `submit_review (retain)`.

**Required edits:**

1. Consume safe server can_review/review_id/reason, using exact current submit_review predicate and locked uniqueness.
2. Wire detail eligible form/existing review/read-only explanation; activity offers Leave review for eligible completed/closed and View review when present.
3. Do not infer pack eligibility or capture from labels; preserve actual tags/rating constraints.
4. Refresh detail/activity/provider readback after submission without claiming private financial equivalence.

**Acceptance:**

- UI controls agree with existing backend allow/deny for paid/unpaid/null-total/already-reviewed/other actor cases.
- Closed eligible is not omitted; completed duplicate is not prompted.
- Pack-backed current-ineligible gets no misleading form; no policy silently changed.

**Tests (requirements, NOT RUN):**

- supabase\tests\sv_booking_read_models.test.mjs::SV-REVIEW-01,SV-REVIEW-02,SV-REVIEW-03
- app\src\features\bookingDetail\__tests__\reviewEligibility.test.tsx::closedEligible,alreadyReviewed,unpaidAndPackIneligible,otherRole

**OFF behavior:** Review eligibility truth applies regardless of Oorva/acquisition state; old eligible bookings stay reviewable..

<a id="sv-t14"></a>

### SV-T14

**Evidence findings:** SV-F12, SV-F13. **Logical WP:** O16. **Class:** A. **Source task prerequisites:** SV-T02, SV-T24, SV-T25.

**Proposed source files (canonical allocation takes precedence):** `supabase\migrations\UNASSIGNED_SV_service_read_models.sql`; `app\src\features\bookingDetail\capabilities.ts`; `app\src\features\bookingDetail\BookingDetailScreen.tsx`; `app\src\features\bookingDetail\ActionsRow.tsx`; `app\src\features\bookingDetail\CancelSection.tsx`; `app\src\features\bookingDetail\model.ts`; `app\src\components\status.tsx`; `app\src\components\StatusTimeline.tsx`; `app\app\proposal-delivery\[id].tsx`; `supabase\tests\sv_booking_read_models.test.mjs`.

**Function scope:** `new get_service_booking_ui_state(uuid)`.

**Required edits:**

1. Add read-only authenticated RPC authorizing booking customer, current business staff or admin; output booking_id,viewer_role and explicit action booleans/reasons, no_show_opens_at,start_opens/window,delivery_review_deadline_at,closed_dispute_deadline_at,closure_reason,can_review/review_id. No secret codes, raw payout/doc/gateway fields.
2. Derive owner/manager/staff distinctions and each actual family/status/time guard from the named matrix; compare projection with real RPC allow/deny in full-chain tests. Do not use coarse transition registry as action authorization.
3. Add typed capabilities model and family-aware UI selector; isCustomer false no longer means provider owner. Managers retain quotes only where permitted; staff read/chat cannot see owner OTP/default/cancel/delivery.
4. Wire footer/code/cancel/no-show/dispute/review and delivery form. Submitted unpaid shows actual Pay prerequisite, not executable Accept; future starts explain opening window; closed dispute stays reachable.
5. Use current delivery/closure/refund context in existing hero/status/timeline helpers; remove universal code/24h/refunded claims while retaining actual history and server cancellation preview.

**Acceptance:**

- For each actual legal family state and all affected actor roles, displayed action is permitted by its backend function; all denied actions stay denied by direct call.
- Submitted/revised/no-delivery, no-show grace, session/proposal start window, closed dispute and ended stale quote cases are explicit.
- No new privileges/financial formulas; admin data never copied into customer/provider cards; existing resolution works with acquisition/layout off.

**Tests (requirements, NOT RUN):**

- supabase\tests\sv_booking_read_models.test.mjs::SV-BOOKING-ACTIONS-01,SV-BOOKING-ACTIONS-02,SV-BOOKING-READ-AUTH-03,SV-REVIEW-01
- app\src\features\bookingDetail\__tests__\model.test.ts::familyRoleTimeActions,submittedNoCancel,noShowGrace,closedDispute,policyCopy
- app\src\features\bookingDetail\__tests__\DeliverySection.test.tsx::paidAcceptPrerequisite,readOnlyWrongActor

**OFF behavior:** Truth/permissions always apply; pay, cancel, expiry, refund, settlement and valid existing-work resolution never depend on presentation flags..

<a id="sv-t15"></a>

### SV-T15

**Evidence findings:** SV-F14, SV-F18. **Logical WP:** O15. **Class:** C. **Source task prerequisites:** SV-T10, SV-T11.

**Proposed source files (canonical allocation takes precedence):** `supabase\migrations\UNASSIGNED_SV_service_layout_flags.sql`; `app\app\book-fixed\[providerServiceId].tsx`; `app\src\features\booking\book\BookScreenContent.tsx`; `app\src\features\booking\book\BookAddressPriceSections.tsx`; `app\src\features\booking\packages\PackageBookingScreen.tsx`; `app\src\features\booking\packages\PackageCard.tsx`.

**Function scope:** `feature_flags registry insert`.

**Required edits:**

1. Register oorva_service_checkout OFF with metadata in runtimeControls; preserve existing booking_steps semantics without pretending all-sections/current0 is a functional wizard.
2. Retain BookScreen controller and issue/schedule/address sections; make missing section/blocker visible beside sticky action.
3. Refactor fixed selection/selected-package body to expose editable schedule and explicit saved address/change; display inclusions/exclusions and quantity before review.
4. Review content has one package/service amount plus actual fee/total; sticky footer only current amount, valid action and concise blocker.
5. Keep old composition under flag off, including all class-A corrected route/quantity/fee behavior.

**Acceptance:**

- S36/S37 placement cases pass in both paths; selected exact interval/address is visible before payload submission.
- Narrow width/large text/keyboard leaves active input and sticky action usable; no silently forced now+2h slot.
- Flag OFF restores existing hierarchy, not known semantic defects; underlying family-off blocks new creation in both.

**Tests (requirements, NOT RUN):**

- app\src\features\booking\book\__tests__\checkoutLayout.test.tsx::SV-UI-CHECKOUT-01,SV-UI-CHECKOUT-02
- app\src\features\booking\packages\__tests__\fixedCheckout.test.tsx::SV-UI-FIXED-01,SV-UI-FIXED-02,SV-UI-FIXED-OFF-03

**OFF behavior:** Current checkout layout remains; no permission/amount-source/safety correction is rolled back..

<a id="sv-t16"></a>

### SV-T16

**Evidence findings:** SV-F15. **Logical WP:** O21. **Class:** A. **Source task prerequisites:** SV-T05.

**Proposed source files (canonical allocation takes precedence):** `app\src\features\proposals\comparePresentation.ts`; `app\app\request\[id].tsx`; `app\src\features\proposals\__tests__\comparePresentation.test.ts`.

**Required edits:**

1. Derive current per-provider version and availability from proposal/request/current booking state; retain all history separately.
2. Use existing selectable/excludeFromLowest/warnings props instead of price-ranking unavailable offers.
3. Remove duplicate card map; one current proposal row exposes terms and contextual View/Ask provider; history uses subordinate view action.
4. Closed hold/booked request shows exact existing booking before comparison, not another Accept.

**Acceptance:**

- Expired/withdrawn/rejected/older cheapest never wins actionable Lowest; current valid sent can.
- No duplicate primary card/action; all historical proposals remain readable.
- Compare view does not change totals, fee freshness or server accept authorization.

**Tests (requirements, NOT RUN):**

- app\src\features\proposals\__tests__\comparePresentation.test.ts::SV-COMPARE-01,SV-COMPARE-02,SV-COMPARE-03

**OFF behavior:** Status-valid comparison always applies; only additional hierarchy movement is separately layout-gated..

<a id="sv-t17"></a>

### SV-T17

**Evidence findings:** SV-F16. **Logical WP:** O22. **Class:** A. **Source task prerequisites:** SV-T01.

**Proposed source files (canonical allocation takes precedence):** `supabase\migrations\UNASSIGNED_SV_service_read_models.sql`; `app\src\features\proposals\api.ts`; `app\src\features\proposals\model.ts`; `app\app\proposal\compose\[requestId].tsx`; `app\src\features\proposals\model.test.ts`.

**Function scope:** `get_creator_proposal_config`.

**Required edits:**

1. Extend existing safe creator config response with actual min/max revision bounds; remove contradictory0..3 UI restriction.
2. Update proposalAmountError and schedule builder to represent configured zero/full advance without zero-valued rows; preserve current max-advance comparison and paise rounding.
3. Keep at most one revisions term and exact positive schedule sum; actual-delivery helper from T01 chooses correct final due rule.
4. Show field errors and safe config-load failure rather than silently replacing invalid admin configuration.

**Acceptance:**

- Valid revision defaults0/4/10 send; out-of-range11 does not.
- Configured cap0 or10000 is representable with positive rows; lower cap still enforced by server.
- No new advance cap, price or fee policy introduced.

**Tests (requirements, NOT RUN):**

- app\src\features\proposals\model.test.ts::SV-COMPOSE-CONFIG-01,SV-COMPOSE-ADVANCE-02,roundingPreservesPositiveSum
- supabase\tests\sv_request_proposal.test.mjs::SV-COMPOSE-SERVER-CAP-03

**OFF behavior:** Configured-valid representation works regardless of Oorva; new proposal parent guard still applies..

<a id="sv-t18"></a>

### SV-T18

**Evidence findings:** SV-F17. **Logical WP:** O17. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\app\recurring\new\[providerServiceId].tsx`; `app\src\features\recurring\__tests__\creationReadiness.test.tsx`.

**Function scope:** `_recurring_plan_quote (unchanged)`.

**Required edits:**

1. Resolve loaded category first and trigger fixed package fetch from actual fixed family, not archetypeParam.
2. Validate optional selected package belongs to current service; preserve valid requested quantity within server package bounds.
3. Include address_id and eligibility context in quote identity; clear old quote immediately and prevent send while a new context is unresolved.
4. Ignore old service/package/quote responses after route/address changes; use explicit load/quote/send errors.

**Acceptance:**

- No-hint fixed deep link loads packages; forged family cannot select another engine.
- Address change forces fresh quote; unsupported city cannot reuse old readiness.
- Package switch or stale response never submits another service's package/price context.

**Tests (requirements, NOT RUN):**

- app\src\features\recurring\__tests__\creationReadiness.test.tsx::SV-RECURRING-ROUTE-01,SV-RECURRING-ADDRESS-02,staleResponseIgnored
- supabase\tests\sv_recurring_actions.test.mjs::SV-RECURRING-PACKAGE-03

**OFF behavior:** Recurring/archetype/category off blocks all new quote/send controls while authorized saved plans remain readable..

<a id="sv-t19"></a>

### SV-T19

**Evidence findings:** SV-F19. **Logical WP:** O21. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `supabase\migrations\UNASSIGNED_SV_service_lifecycle.sql`; `app\app\request\new.tsx`; `app\app\proposal\compose\[requestId].tsx`; `supabase\tests\sv_request_proposal.test.mjs`.

**Function scope:** `create_service_request`; `send_proposal`; `route_service_request`; `new _validate_service_request_intake(uuid,jsonb)`.

**Required edits:**

1. Assert effective proposal parent for new request/send/routing; retain separate urgent trigger and acceptance INSERT guard.
2. Use current _provider_is_live plus service/category docs/paused/window eligibility in routing and new send readiness; do not treat legacy KYC alone as full readiness.
3. Add private request-intake validator for current SchemaField subset: object properties/required recursion; scalar/array item types/enums; numeric min/max; string min/max length; array min/max/unique; permitted reserved brief/package_id/deliver_by. Require existing client brief minimum and reject unknown nonreserved values before inserts.
4. Do not modify global profile validator: it has different allowed keys/features. Preserve x-private redaction and contact screening.
5. UI waits for valid resolved category/config and parent; preserve honest zero-match and atomic targeted failure.

**Acceptance:**

- Parent off denies raw request/send despite child deadline on; valid on/authorized path succeeds.
- Missing/wrong/out-of-bound configured answers fail before request/private/recipient/proposal writes; valid nested schema passes.
- Admin-rejected/deactivated/unsubmitted provider not newly routed/sent; no-match open creation remains its existing honest outcome.
- Existing history/message/cancel/payment/delivery/refund/expiry is not accidentally gated by new acquisition checks.

**Tests (requirements, NOT RUN):**

- supabase\tests\sv_request_proposal.test.mjs::SV-PROPOSAL-PARENT-01,SV-INTAKE-02,SV-ROUTING-03,SV-PROPOSAL-OFF-RESOLUTION-04
- app\src\features\proposals\__tests__\requestReadiness.test.tsx::resolvedConfigRequired,parentOff

**OFF behavior:** New acquisition denied server/client; existing authorized work and all money-safety paths stay available..

<a id="sv-t20"></a>

### SV-T20

**Evidence findings:** SV-F20. **Logical WP:** O21. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `supabase\migrations\UNASSIGNED_SV_service_lifecycle.sql`; `app\app\request\[id].tsx`; `app\src\features\proposals\api.ts`; `supabase\tests\sv_request_proposal.test.mjs`.

**Function scope:** `cancel_service_request`.

**Required edits:**

1. While holding existing service-request lock, reject request-only cancellation if accept_proposal's exact active booking set exists for this request.
2. Expose current booking context through T05 read state and replace closed-hold Cancel request with Continue/Manage booking.
3. Keep existing cancel_booking/customer confirmation as the resolution path; do not create an alternate request refund implementation.
4. Test accept/cancel/funding serialization without adding reversed booking/payment locks or silently reopening requests.

**Acceptance:**

- Active hold cannot coexist with a newly request-cancelled state through this RPC; rows unchanged on rejection.
- Open/closed request with no active booking still cancels and rejects sent offers; historical expired/cancelled row is not a permanent blocker.
- Existing booking cancellation remains functional when acquisition/layout off.

**Tests (requirements, NOT RUN):**

- supabase\tests\sv_request_proposal.test.mjs::SV-REQUEST-HOLD-01,SV-REQUEST-HOLD-02,SV-REQUEST-HOLD-RACE-03
- app\src\features\proposals\__tests__\requestReadback.test.tsx::manageActiveHoldInsteadOfRequestCancel

**OFF behavior:** Request/booking resolution guards always apply; no presentation switch gates cancellation/refund safety..

<a id="sv-t21"></a>

### SV-T21

**Evidence findings:** SV-F18. **Logical WP:** O16. **Class:** C. **Source task prerequisites:** SV-T09, SV-T13, SV-T14.

**Proposed source files (canonical allocation takes precedence):** `supabase\migrations\UNASSIGNED_SV_service_layout_flags.sql`; `app\src\features\activity\UnifiedActivityScreen.tsx`; `app\src\features\activity\ServiceBookingCard.tsx`; `app\src\features\activity\segments\ServicesSegment.tsx`; `app\src\features\activity\segments\RequestsSegment.tsx`.

**Function scope:** `feature_flags registry insert`.

**Required edits:**

1. Register oorva_service_activity OFF with exact OFF description.
2. Extract ServiceBookingCard using existing markup/primitives and documented props; actor/family view state is input, not a local universal status engine.
3. Compact title/segment spacing, keep distinct domains, make within-Service Plans filter readable and first action-required summary obvious.
4. One card context action then schedule/amount/reference, history review/receipt subordinate; preserve unread and book-again safety checks.
5. Keep source Shop/Sports panels separately owned; do not merge their statuses or financial copy into service enum.

**Acceptance:**

- S05 seven placement cases and booking card contract hold at narrow width/large text.
- No duplicate/ineligible Rate or ended Pay; current booking/request/plan identities remain distinct.
- Flag OFF retains old layout plus all semantic/readback corrections.

**Tests (requirements, NOT RUN):**

- app\src\features\activity\__tests__\ServiceBookingCard.test.tsx::SV-CARD-BOOKING-01,SV-CARD-BOOKING-02,SV-CARD-BOOKING-03,SV-CARD-BOOKING-04
- app\src\features\activity\__tests__\activityModel.test.ts::layoutFlagsAndPlansHistory

**OFF behavior:** Existing activity composition and domain navigation remain; correctness/permissions/history stay fixed..

<a id="sv-t22"></a>

### SV-T22

**Evidence findings:** SV-F18. **Logical WP:** O21. **Class:** C. **Source task prerequisites:** SV-T01, SV-T02, SV-T04, SV-T05, SV-T06, SV-T16, SV-T17, SV-T19, SV-T20, SV-T24.

**Proposed source files (canonical allocation takes precedence):** `supabase\migrations\UNASSIGNED_SV_service_layout_flags.sql`; `app\app\request\new.tsx`; `app\app\request\[id].tsx`; `app\app\proposal\[id].tsx`; `app\app\proposal\compose\[requestId].tsx`; `app\app\proposal-delivery\[id].tsx`; `app\app\quote\[bookingId].tsx`; `app\src\features\bookingDetail\BookingDetailScreen.tsx`.

**Function scope:** `feature_flags registry insert`.

**Required edits:**

1. Register oorva_service_workflows OFF; scope/deadline/revisions above money commitment, one comparison and one context action.
2. S71 renders customer's actual brief/configured answers and current booking outcome; S72 resolves category/provider/package before brief; separate event versus remote deadline labels, private selected location and explicit maximum budget without invented80% minimum.
3. S60 shows current state/provider/scope then real total_today; accepted routes to booking, not another hold warning.
4. S61 aligns actual deliverables/terms/milestones and inline validation with persistent ready-state Send; S62 adds booking/state context and real review-window notice.
5. S66 keeps family-specific editor, bill proof and managed travel but removes repeated After sending emphasis; S38 moves actual promised delivery/revisions before secondary history/help.
6. Preserve existing terms/readback APIs and financial safety; no new upload/order workflow.

**Acceptance:**

- Every S60/S61/S62/S66/S71/S72 placement case and S38 delivery placement can be verified in before/after captures at named states.
- Correct primary action remains visible; destructive actions confirmed/subordinate; no duplicated comparison or new private data.
- Feature off and parent off cases preserve current layout/history while new capability controls follow server guards.

**Tests (requirements, NOT RUN):**

- app\src\features\proposals\__tests__\workflowLayout.test.tsx::proposalTermsOrder,requestBriefAndSingleComparison,composeFieldErrors,deliveryReadOnlyContext
- app\src\features\bookingDetail\__tests__\DeliverySection.test.tsx::termsBeforeHistory
- app\src\features\proposals\__tests__\requestReadiness.test.tsx::maximumBudgetOnly,eventVersusRemoteDeadline

**OFF behavior:** Existing workflow composition remains; all class-A state/role/money-source corrections remain enforced..

<a id="sv-t23"></a>

### SV-T23

**Evidence findings:** SV-F18. **Logical WP:** O17. **Class:** C. **Source task prerequisites:** SV-T04, SV-T07, SV-T08, SV-T09, SV-T18.

**Proposed source files (canonical allocation takes precedence):** `supabase\migrations\UNASSIGNED_SV_service_layout_flags.sql`; `app\app\merchant-calendar.tsx`; `app\app\recurring\[id].tsx`; `app\app\recurring\new\[providerServiceId].tsx`; `app\app\recurring\provider\[id].tsx`.

**Function scope:** `feature_flags registry insert`.

**Required edits:**

1. Register oorva_service_recurring OFF.
2. S49 shows resolved business/timezone then compact Day/Week/date toolbar, grouped visits and primary Open visit/secondary Plan.
3. S68/S70 show composite plan and next/current due, then other-party decisions/conflicts, then upcoming/history and contextual management; use exhaustive partition from T09.
4. S69 puts provider/package context before recurrence input, moves detailed quote into review after address, keeps one compact total-per-visit/request footer with actual blocker.
5. Retain current per-visit-only and no-discount constraints, time-off warning without automatic cancellation, exact occurrence PK links and masked private reads.

**Acceptance:**

- All four recurring/calendar screen placement tables verified with no omitted occurrences/actions.
- Compact footer preserves field/keyboard usability; correct business/plan/timezone visible before mutation.
- Flag OFF uses old composition but actual actor/cutoff/acceptance/deadline fixes persist; existing cancel/absence/payment safe.

**Tests (requirements, NOT RUN):**

- app\src\features\recurring\__tests__\layout.test.tsx::customerActionPriority,providerBusinessContext,exhaustiveHistory,compactCreationReview,calendarDayWeekLinks
- app\src\features\activity\__tests__\recurringScreens.test.ts::layoutOffKeepsSemanticFixes

**OFF behavior:** Existing plan/calendar hierarchy remains; saved records and resolution remain readable/usable under existing capability policy..

<a id="sv-t24"></a>

### SV-T24

**Evidence findings:** SV-F21. **Logical WP:** O22. **Class:** A. **Source task prerequisites:** SV-T01.

**Proposed source files (canonical allocation takes precedence):** `supabase\migrations\UNASSIGNED_SV_service_lifecycle.sql`; `supabase\tests\sv_service_lifecycle.test.mjs`.

**Function scope:** `confirm_completion`; `complete_booking`.

**Required edits:**

1. Guard public generic completion entry points: delivered proposal states cannot use generic completion, and time_based must use its session finalizer route.
2. Permit proposal generic completion only delivery_status=not_applicable; preserve all-paid check and OTP lockout where applicable.
3. Keep accept_delivery setting accepted before _finalize_completion and existing configured delivery release/dispute window.
4. Do not alter private finalizer globally because admin dispute/system callers have separate legitimate semantics.

**Acceptance:**

- Fully paid submitted proposal raw generic confirm or valid legacy end OTP cannot bypass accepted delivery state.
- Proper accept_delivery updates delivery_status/accepted timestamp then completes with existing configured window.
- No-delivery proposal/fixed/inspect, session-specific, admin dispute and system auto-confirm retained.

**Tests (requirements, NOT RUN):**

- supabase\tests\sv_service_lifecycle.test.mjs::SV-DELIVERY-BYPASS-01,SV-DELIVERY-BYPASS-02,SV-DELIVERY-BYPASS-03

**OFF behavior:** Completion safety applies always; valid existing family resolution and recording are not acquisition/layout gated..

<a id="sv-t25"></a>

### SV-T25

**Evidence findings:** SV-F22. **Logical WP:** O32. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `supabase\migrations\UNASSIGNED_SV_service_lifecycle.sql`; `supabase\migrations\UNASSIGNED_SV_service_read_models.sql`; `app\src\features\bookingDetail\BookingDetailScreen.tsx`; `app\src\features\bookingDetail\model.ts`; `app\src\components\QuoteView.tsx`; `supabase\tests\sv_service_lifecycle.test.mjs`; `app\src\features\bookingDetail\__tests__\model.test.ts`.

**Function scope:** `expire_stalled_bookings`; `record_payment_paid`; `get_service_booking_ui_state (closure/payable output)`.

**Required edits:**

1. Restrict legacy pending-quote Pay/current-due display to actual legal awaiting_payment/in_progress context and actor; show stale ended quote as historical/nonpayable. This fix is always on, not a layout experiment.
2. Under existing stalled-booking lock supersede sent/approved_pending_payment offers before closed_no_work; retire each created attempt with payment-row NOWAIT/retry pattern from recurring expiry, not a new blocking helper lock inversion. Include retry pass for already closed_no_work rows with stale attempts.
3. Money owner adds explicit b.status awaiting_payment|in_progress to generic balance-recorder acceptance before activation, leaving existing not-owed/refund/idempotency logic intact.
4. Normalize only exact legacy ended offered quotes/created attempts, with count-guarded audit events; retain actual paid/refund history and approved financial snapshots.
5. Derive closure_reason from last actual closure event/from state/actor; quote rejection and quote/payment timeout get truthful distinct copy.
6. Record image evidence accurately: contradiction visibly in89;87/88 do not show it. Do not reseed/rename fixture as the implementation fix.

**Acceptance:**

- Ended stale pending quote cannot show Pay; a new prepare call rejects; proper active balance flow still works.
- Stall from awaiting_payment supersedes quote/retires or retries attempt; timeout copy does not say customer declined.
- Late recorder input after closure follows existing not-owed/refund branch, never reactivates scope; duplicate capture/event idempotency preserved.
- Concurrent webhook holding payment row does not deadlock cleanup or lose retry; paid/refund/inspection settlement unchanged.

**Tests (requirements, NOT RUN):**

- supabase\tests\sv_service_lifecycle.test.mjs::SV-ENDED-QUOTE-01,SV-ENDED-QUOTE-02,SV-ENDED-CAPTURE-03,SV-ENDED-LOCK-04
- app\src\features\bookingDetail\__tests__\model.test.ts::endedPendingQuoteNeverPayable,timeoutNotDeclined,activeBalanceStillPayable

**OFF behavior:** Unconditional ended-work/payment safety; existing refund/settlement/expiry never disabled with Oorva or acquisition off..
