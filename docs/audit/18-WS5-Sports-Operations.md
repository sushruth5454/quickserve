# Oorva Critical Audit — Sports

> **Implementation authority:** use [doc 18](../18-Oorva-Transformation-Implementation-Plan.md) and [`execution-plan.json`](../design/oorva/execution-plan.json) for the actual dispatch stage, file/function locks, migration claim and validation command. This source audit supplies verified current behavior, required changes and acceptance. A proposal filename is not a numeric reservation.


| Baseline | Detail |
|---|---|
| Scope | **S31, S78, S79, S80, S81, S82, S83, S88**; `sportsVenue`, `sportsBooking`, `sportsSlot` |
| Immutable source | `2f1e4638b145185b9e58c4c62e58f5c6dd491fa1`, verified with local `git rev-parse HEAD` |
| Date / stream | November 20, 2026 · SP |
| Evidence | Actual route bodies, extracted sports feature/management sections, effective migration definitions, client projections, selected test bodies; two archived web frames |
| Execution | **Read-only. No application tests, builds, installs, SQL execution, production calls, edits to source/docs/CI, commits, pushes, deploys or subagents.** |
| Full detail | Adjacent [`sports.json`](../design/oorva/audit/sports.json): exact source ranges, complete fields, actor/state cases, 17 ordered tasks and files-read manifest |

## Summary

**8 screens, 50 placement elements, 3 lifecycles, 2 card contracts, 20 findings: 16 confirmed source defects and 4 required design changes.** There are **17 implementation tasks and 12 explicit retain cases**. No new product-policy decision is needed for these repairs.

The two reported verification problems are real in the current source:

- Admin **Verify venue** is rendered for both `submitted` and `verified`; the backend also accepts repeated same-state review writes.
- Owner **Submit for verification** is offered for `verified`, and `submit_sports_venue` changes it to `submitted`.
- **Saving is a different operation:** changed identity/details intentionally change an editable venue to **draft**. Unchanged/payment-only saves preserve review state. Preserve that existing rule and warn before its consequence; do not describe it as a save-to-submitted transition.

Other concrete defects include lost instant-mode configuration on feature-OFF resource save, incomplete editor hydration, multi-venue member navigation, stale/invalid booking actions, contradictory payment cards, a dropped cancellation-policy projection, real checkout blocked after feature shutdown, and stale asynchronous slot results.

### Evidence notation

All paths below are relative to the immutable source unless marked as report/artifact context.

| Short name | Exact source path |
|---|---|
| M48 | `supabase\migrations\0048_sports.sql` |
| M52 | `supabase\migrations\0052_merchant_staff.sql` |
| M54 | `supabase\migrations\0054_addendum_foundations.sql` |
| M58 | `supabase\migrations\0058_sports_payments.sql` |
| M59 | `supabase\migrations\0059_admin_identity_hardening.sql` |
| M60 | `supabase\migrations\0060b_demo_payout_isolation.sql` |
| M63 | `supabase\migrations\0063_o1_notifications.sql` |
| M72 | `supabase\migrations\0072_s1_sports_money_hardening.sql` |
| M80 | `supabase\migrations\0080_s2_sports_ops_ux.sql` |
| M87 | `supabase\migrations\0087_ui_redesign_flags_guest_read.sql` |
| Admin | `app\app\admin\sports.tsx` |
| Activity / List / Home | `app\app\sports\[activity].tsx` / `bookings.tsx` / `index.tsx` |
| Detail / Checkout | `app\app\sports-booking\[id].tsx` / `app\app\sports-checkout\[id].tsx` |
| Venue | `app\src\features\sports\SportsVenueBookingScreen.tsx` |
| API / Model | `app\src\features\sports\api.ts` / `model.ts` |
| OwnerScreen / OwnerState / OwnerActions | `app\src\features\sports\manage\SportsVenueManagementScreen.tsx` / `useSportsVenueManagementState.ts` / `actions.ts` |
| VenueEditor / ResourceEditor / Schedule / BusinessCards | Same `manage` directory: `VenueEditorSections.tsx` / `ResourceEditorSection.tsx` / `ResourceScheduleSections.tsx` / `BookingSections.tsx` |
| ActivityCards | `app\src\features\activity\segments\SportsSegment.tsx` |

**A:** unconditional existing-truth/permission/accessibility fix, including Oorva OFF. **C:** presentation composition behind the proposed `oorva_sports_ux` leaf and its `oorva_brand` parent. No sports-specific class-B identity work is reassigned from the coordinator.

## Findings

| ID | Priority / type / class | Actual condition → exact repair | Evidence | Owner |
|---|---|---|---|---|
| SP-F01 | P1 · defect · A | Verified shows Verify; rejected/suspended cannot invoke already-permitted restoration. Hide same-state actions, explicitly label restore/re-review, make redundant server transition a no-op without audit churn. | Admin:117–151; M48:457–478 | O09 → O31 |
| SP-F02 | P1 · defect · A | Owner submit accepts verified and downgrades it. Lock/check owner; submitted/verified no-op; draft/rejected keep existing prerequisites; suspended denied. | VenueEditor:144–146; M48:428–455 | O09 |
| SP-F03 | P1 · defect · A | Save hides detail-change-to-draft consequence and remains offered on suspended despite SQL rejection. Match actual changed fields, confirm re-review consequence, make denied detail controls read-only. | OwnerActions:19–48; VenueEditor:68–143; M58:338–367 | O09/O29 |
| SP-F04 | P1 · defect · A | `selectedResource.booking_mode` is passed to a helper reading `storedSettings.bookingMode`; instant-OFF save silently persists approval. Explicitly map the real resource shape. | OwnerActions:52–72; Model:180–190; M58:418–426 | O29 |
| SP-F05 | P1 · defect · A | Auto-selection does not hydrate resource name/activity/slot length; hours do not hydrate selected weekday. Initial loading looks like Create; assigned errors disappear. Add complete keyed hydration, loading/error state and dirty baselines. | OwnerState:25–48,95–138; ResourceEditor:17–23; OwnerScreen:31–45 | O29 |
| SP-F06 | P1 · defect · A | Non-owner early return occurs before venue selector; multiple assigned venues or owned+assigned users can be trapped on first venue. Common selector before role content. | OwnerScreen:25–45; OwnerState:98–99; M58:543–597 | O29/O28 |
| SP-F07 | P2 · design · C | Owner queue is below every editor; enabled owner view omits started/terminal rows returned by RPC. Queue first; current/upcoming/history then editors. | OwnerScreen:25–56; Model:224–237; M80:315–358 | O29 |
| SP-F08 | P1 · defect · A | Detail actions omit expiry/start checks; checkout permits a Pay button for owner/member readers and unknown deadlines. Shared actor/state/deadline action helper. | Detail:52–55,157–196; Checkout:64–87; M58:1284–1300; M80:443–447,871–879 | O20 |
| SP-F09 | P1 · defect · A | Confirmed checkout still uses old due deadline and always offers Choose another slot when non-payable. Restrict countdown to due states; confirmed → View booking. | Checkout:64–82,131–152 | O20 |
| SP-F10 | P1 · defect · A | M87 replaced `get_sports_venue` without M80's `cancellation_policy`; current disclosure becomes null. Restore only safe effective policy scalars, preserving guest privacy. | M80:284–297; M87:758–805; Venue:91–92,238–240 | O20/O38M |
| SP-F11 | P1 · defect · A | Real `create-payment` returns 403 when flags are OFF before preparing a live existing obligation; SQL/demo allow safe in-flight resolution. Separate creation gate from authorized live-payment preparation. | `supabase\functions\create-payment\index.ts:46–70`; M58:1272–1319; M80:649–696 | O20 + financial owner |
| SP-F12 | P1 · defect · A | Activity labels all accepted Pay at venue, everything else No online payment, and ignores stored total/fee; staff uses raw statuses. Reuse sports helpers/card contract; do not claim queued refund settled. | ActivityCards:43–61; BusinessCards:23–38; List:59–78; Model:94–118 | O20/O16/O29 |
| SP-F13 | P1 · defect · A | Most cross-role views refresh only on focus/local writes; existing checkout/slot timers lack app-active coordination. One focused/foreground read mechanism, preserving dirty drafts. | Admin:37–73; OwnerState:74–128; Detail:37–64; Checkout:53–62; Venue:147–157 | O09/O20/O29 |
| SP-F14 | P1 · defect · A | Any older slot read can overwrite a newer resource/date response and feed an old timestamp into the current resource request. Generation/context guard success, failure and selection. | Venue:130–189 | O20 |
| SP-F15 | P2 · defect · A | Slot read calls future starts inside configured lead time free; booking rejects them. Apply existing lead/exact-horizon predicates to slot state, not a new policy. | M87:816–856; M80:986–988,1061–1068 | O20/S3 |
| SP-F16 | P2 · defect · A | Legacy `request_sports_slot` still sums occupancy across the whole multi-slot period. Use per-slot maximum, already correct in main booking RPC. | M80:798–807 versus 1070–1088 | O20/S3 |
| SP-F17 | P2 · defect · A | Footer says Estimated total but sums only slots; online creation adds configurable fee. Label Slot subtotal (estimate); exact fee/total stays server-owned in checkout. | Venue:227–240; Model:245–268; M80:1101–1116 | O20 |
| SP-F18 | P2 · design · C | This home's history/business entries disappear on discovery error/empty/OFF; My venues relies on provider navigation role, not ownership. Separate existing-work navigation and authorized business context. | Home:47–71; M58:307–337; M80:196–213 | O20 |
| SP-F19 | P2 · design · C | Concrete hierarchy changes: review filters, full-title sports cards, responsive grid and one hero before selection instead of up to twelve stacked photos. Keep shared primitive ownership. | Admin:101–170; Activity:78–88; Venue:252–294; ListingCard:91–133 | O20/O31/O08 |
| SP-F20 | P2 · design · A | Reject/suspend, close day, price delete and block removal write immediately. Reuse existing contextual `useConfirm`; cancel means no RPC. | Admin:135–147; Schedule:32–38,112,138–142; `ui\Confirm.tsx:9–45` | O09/O29 |

### Important distinction: main versus legacy capacity

The main **`book_sports_slot` is already corrected** to take the maximum used participants per requested slot. SP-F16 concerns the **still-executable legacy `request_sports_slot`**, not a re-report of the fixed main path. Existing `sports_hardening.test.mjs:457–479` exercises the main path, not this legacy counterexample.

## Screen-by-screen placement audit

Every row is based on the actual body, not its wrapper alone. “Retain” identifies current behavior to preserve. Assertions below are implementation acceptance cases, **not tests run by this audit**.

### S31 — Admin sports

Body: `app\app\admin\sports.tsx`. Primary: review submitted venue. Secondary: state/history filters and activity configuration. Destructive: reasoned restriction. Contextual: existing restoration.

| Element | Current → target; reason | Evidence / concrete assertion |
|---|---|---|
| Review queue | Submitted-first SQL, all rows in one list → retain ordering, add queue/filter before rows. Keep historical/restoration access. | Admin:101–108; M48:480–495. **SP-ADMIN-QUEUE:** submitted first, each status filter shows its real rows. |
| Identity/status/reason | Name/location/owner + raw status/reason → retain actual facts, compact semantic badge. No payout-based verification. | Admin:108–116. **SP-ADMIN-STATE:** same venue PK matches owner status/reason. |
| Verify/restore | Verify for submitted **or verified**; no restore button → submitted Verify, verified status-only, explicit permitted restore/re-review. | Admin:117–124; M48:457–478. **SP-REVIEW-ADMIN:** no repeat Verify/audit; restore works. |
| Reject/suspend | Both for every non-draft, including same state; immediate write → only different-state controls with reason and confirmation. | Admin:125–151. **SP-ADMIN-CONFIRM:** cancelling writes nothing; confirm one exact id/status/reason. |
| Activity switches | Below review rows; real active state and post-write reload → retain, secondary section; warn before disabling. Existing bookings are not cancelled. | Admin:76–85,155–170; M48:512–529. **SP-ACTIVITY-OFF:** new discovery hides activity, old booking remains readable. |
| Loading/error/refresh | Skeleton, initial Retry, inline stale-data error, focus/local reload → retain and add focused/foreground 60-second truth refresh. | Admin:37–73,95–101. **SP-REVIEW-REFRESH:** remote state updates without erasing typed reason; blur/background stop reads. |

### S78 — Activity venue discovery

Body: `app\app\sports\[activity].tsx`; actual shared `ListingCard` and slug helper read. Primary: open venue. Contextual: search radius/location.

| Element | Current → target; reason | Evidence / concrete assertion |
|---|---|---|
| Activity/location | Name parameter or readable `titleFromSlug`; selected area/city → retain compact header. | Activity:30–55; `activityPresentation.ts:1–7`. **SP-ACTIVITY-TITLE:** readable slug fallback, actual location. |
| Radius | 5/10/15 km above results → retain placement and accessible selected state. | Activity:32–50,60–69. **SP-RADIUS:** actual coordinates/activity and numeric radius reach RPC. |
| Image/title | First real image/fallback at left, one-line title → explicit optional sports presentation with wrapped decisive title. Not a claimed observed clipping defect. | Activity:78–88; `ListingCard.tsx:88–105`. **SP-VENUE-CARD-LONG:** full title/price at narrow width; legacy selectable. |
| Trust/distance/price | Verified=true, real distance and From minimum → retain verified-only SQL truth; label from-per-slot, no invented rating/open-now. | Activity:82–88; M87:723–754. **SP-SEARCH-TRUST:** only verified matching-active venues; minimum is not availability. |
| Results/freshness | Explicit error/loading/empty; focus/dependency read → retain, add foreground refresh for review changes. | Activity:36–52,70–76. **SP-SEARCH-REVIEW-READBACK:** suspended PK disappears after refresh; errors do not become empty success. |

### S79 — My sports bookings

Body: `app\app\sports\bookings.tsx`. Primary: open exact booking id. No new mutation directly on history cards.

| Element | Current → target; reason | Evidence / concrete assertion |
|---|---|---|
| Venue/status | Already uses sports semantic helper → retain and share with activity/staff copies. | List:57–64; Model:94–107. **SP-CARD-STATUS-PARITY:** accepted consistently means Confirmed. |
| Resource/time | Activity/resource and IST start only → show actual returned start–end range for multi-slot work; no invented address/rating. | List:10–19,65–66; M80:172–209. **SP-CARD-RANGE:** both returned endpoints, not inferred duration. |
| Amount/payment/refund | Stored total fallback price, correct helper, bare Refund → retain total/mode; distinguish refund request from processed refund. | List:67–74; Model:109–118; M80:535–553. **SP-CARD-MONEY:** paid/due/venue modes correct, aggregate not settled claim. |
| Deadline/open | Whole-card detail link; copied deadline conditional → centralize response/hold/pay-by sources and exact-id navigation. | List:52–58,75–79. **SP-CARD-DEADLINES:** requested expires_at; pending hold; awaiting pay_by; terminal no due countdown. |
| Load/OFF/refresh | No client sports gate; focus/retry/skeleton/empty/inline error → retain OFF-readable history; bounded foreground updates. | List:21–50,84–89; M80:196–213. **SP-LIST-OFF-REFRESH:** same own PK readable OFF; remote update shown; failed refresh preserves rows/error. |

### S80 — Sports home

Body: `app\app\sports\index.tsx`. Primary: activity discovery. Contextual: existing customer/business work. New creation remains capability-gated.

| Element | Current → target; reason | Evidence / concrete assertion |
|---|---|---|
| Title/payment guidance | Request-slot header and mode guidance after grid → retain truthful feature-aware copy, place compact guidance near discovery. | Home:45–46,101–103; Model:193–197. **SP-HOME-MODES:** online OFF guidance does not disable old payable work. |
| History | Link inside successful nonempty activities branch → independent signed-in existing-booking link. | Home:47–63; M80:196–213. **SP-HOME-HISTORY:** link survives OFF/empty/error. |
| Business entry | Provider-active-role-only My venues → actual owner/assigned context; preserve legitimate signed-in self-onboarding, no false owner label. | Home:28,64–71; M58:307–337. **SP-HOME-ACTOR:** owner in customer navigation mode still reaches work; staff read-only. |
| Activity grid | Two 48%-width cards with real icon/name/slug → responsive family-gated grid/list, retain routes and real names. | Home:73–100. **SP-HOME-GRID:** long activity name readable at narrow/large text. |
| Empty/error/loading | Entire body switches, hiding work links → scope these states to discovery region. | Home:32–55. **SP-HOME-ERROR:** Retry and existing-work navigation coexist, no fabricated empty success. |

### S81 — Venue/business operations

Route wrapper `app\app\sports\manage.tsx:1–8` delegates to **OwnerScreen, OwnerState, OwnerActions, VenueEditor, ResourceEditor, Schedule, BusinessCards**. All were read. Primary owner action: respond to live request. Staff/manager primary: view assigned booking. Configuration is secondary.

| Element | Current → target; reason | Evidence / concrete assertion |
|---|---|---|
| Venue/business selector | Non-owner early return bypasses it → common authorized selector before role content, keyed by venue UUID. | OwnerScreen:25–45; OwnerState:95–99. **SP-MANAGE-MULTI:** owned + two assigned venues all selectable; no cross-venue rows. |
| Review/submit | Real badge, Submit except suspended → draft/rejected submit; submitted/verified status-only; server no-op for stale repeat. | VenueEditor:52–66,144–146; M48:428–455. **SP-OWNER-SUBMIT:** verified stays verified and publicly visible. |
| Detail save | Long form and direct Save, including suspended → warning exactly when stored detail fields would draft; no denied suspended detail Save. | VenueEditor:68–143; OwnerActions:19–48; M58:338–367. **SP-DETAIL-SAVE:** changed/unchanged/payment-only distinguished; cancel warning no RPC. |
| Resource editor | Auto-selected id with default/previous name/activity/length; snake/camel mismatch → complete resource hydration and explicit stored-mode mapping. | OwnerState:28–34,98–128; OwnerActions:50–72; Model:180–190. **SP-RESOURCE-PAYLOAD:** real 90-minute instant resource unchanged with children OFF. |
| Hours | Day changes clear closed but do not load its times; Set closed deletes immediately → hydrate exact venue/day, loaded absence=closed, confirm deletion. | OwnerState:45–48,136–138; Schedule:14–47; M48:296–325. **SP-HOURS-CONTEXT:** different weekdays never overwrite from previous/default fields. |
| Prices/blocks | Before booking work, immediate delete/remove → secondary contextual section, clear stale edit id and confirm destructive action. Retain SQL locks/positive paise/active-hold block guard. | Schedule:51–146; M48:327–375; M72:53–89; M80:581–599. **SP-SCHEDULE-SAFETY:** correct id after context switch; live hold blocks maintenance block. |
| Incoming requests | Below every configuration editor → queue/count directly below selector/status. | OwnerScreen:44–56; BusinessCards:73–90. **SP-OWNER-PRIORITY:** request appears before editor and opens same PK. |
| Current/history | Owner shows requested + future-start active only; staff/OFF can show all → current/upcoming/history from returned rows, no new terminal action. | Model:224–237; OwnerScreen:25–29; BusinessCards:23–69. **SP-OWNER-HISTORY:** started accepted and every terminal state reachable. |
| Loading/errors/refresh | Initial [] looks like Create; assigned branch discards error; selected reload resets forms → explicit first-load/error/retry and dirty baselines before polling. | OwnerState:25–27,74–138; OwnerScreen:31–45. **SP-MANAGE-LOAD:** skeleton before first read; assigned failure visible; remote badge update preserves draft. |

### S82 — Sports booking detail

Body: `app\app\sports-booking\[id].tsx`. Primary varies by actual actor/state: customer live Pay; owner live response; otherwise existing booking information. Destructive: previewed cancellation.

| Element | Current → target; reason | Evidence / concrete assertion |
|---|---|---|
| Identity/time | Venue/resource/activity, IST range and participants already present → retain, compact near status. | Detail:125–138; M80:225–253. **SP-DETAIL-IDENTITY:** exact same PK/resource/time/participants across roles. |
| Status/deadline | Correct sports label, deadline at card bottom, focus-only data → put next-action/deadline together and refresh; no locally invented persisted expired state. | Detail:37–55,108–112,151–155. **SP-DETAIL-EXPIRY:** invalid action ends at deadline even before cleanup. |
| Amount/refund | Correct total/helper/fee; green bare Refund → retain money inputs, neutral refund-request wording. | Detail:139–147; M80:535–553. **SP-DETAIL-REFUND:** no claim of processed gateway refund from aggregate. |
| Customer Pay | Customer + due-status only → actor/online/unpaid/finite-live-deadline predicate. Existing work survives feature shutdown. | Detail:157–164; M58:1284–1300. **SP-DETAIL-PAY:** only actual eligible customer sees Pay. |
| Owner response | Owner + requested only → also require live expires_at; keep required decline reason. | Detail:165–185; M80:867–900. **SP-DECIDE-ACTOR:** actual owner only; online accept awaiting_payment, venue accept accepted. |
| Cancellation | Four active states/participant, exact preview before confirm → retain preview; customer before-start eligibility; do not invent owner cutoff. | Detail:71–105,186–199; M80:443–486,516–532. **SP-CANCEL-PREVIEW:** customer at start cannot; owner with reason follows existing rule; stale preview not authorization. |

### S83 — Checkout

Body: `app\app\sports-checkout\[id].tsx`, plus actual `payments.tsx` and Edge preparation read. Primary: pay **existing live customer obligation**, then view confirmation.

| Element | Current → target; reason | Evidence / concrete assertion |
|---|---|---|
| Hold/status | Uses old deadline for every state → countdown only for pending_payment/awaiting_payment; no confirmed expired-payment warning. | Checkout:64–74,131–140. **SP-CHECKOUT-PAID:** old deadline before/after now cannot make accepted look due. |
| Reservation | Already venue/resource/IST range/participants → retain compact identity tied to same booking UUID. | Checkout:105–113; API:177–183. **SP-CHECKOUT-ID:** no replacement resource or client amount sent. |
| Breakdown | Separate server price/fee/total → retain exact stored amount and full readable values. | Checkout:114–129; M58:1291–1317. **SP-CHECKOUT-TOTAL:** 100000+500 prepares100500. |
| Pay authority | No viewer id; status/deadline only; invalid/missing deadline not expired → actual customer, online unpaid live finite deadline; readers are not payers. | Checkout:28–35,64–87; M80:250–255. **SP-CHECKOUT-ACTOR:** owner/member no Pay; unknown deadline fail closed. |
| Outcome | Every non-payable state → Choose another slot → accepted/completed View booking; requested View request; terminal optional new slot respects discovery. | Checkout:80–92,142–152. **SP-CHECKOUT-OUTCOME:** capture-confirmed same PK not prompted into replacement reservation. |
| Read/error/clock | Existing focused30s read + mounted1s clock/post-payment load → one active-aware timer, immediate foreground read, real recorder truth. | Checkout:37–62; `app\src\lib\payments.tsx:140–149`. **SP-CHECKOUT-REFRESH:** browser opened != paid; no duplicate/background poll. |

### S88 — Venue selection

Route `app\app\venue\[id].tsx:1–7` passes id to the **430-line Venue body**, which was read completely. Primary: effective Book or Send request. Sticky footer **already exists**, outside the scroll content in `app\src\components\ui\Screen.tsx:109–136`.

| Element | Current → target; reason | Evidence / concrete assertion |
|---|---|---|
| Gallery | Every photo190-high before form, up to12 permitted → one hero/expandable gallery in family composition. Source possibility, not observed twelve-photo runtime. | Venue:252–258; M58:323–326. **SP-VENUE-HIERARCHY:** choice follows one hero with12-photo fixture. |
| Identity/trust | Details/amenities below photos; safe verified-only read → compact real identity/trust then selection; no sports stars/private review data. | Venue:259–264; M87:768–804. **SP-VENUE-PUBLIC:** unverified unavailable; guest street/coordinates redacted. |
| Resource | Accessible real resource radios clear selection, but old read can overwrite → exact-context generation guard. | Venue:130–165,267–294. **SP-SLOTS-RESOURCE-RACE:** old A cannot alter B. |
| Date | Explicit IST Today/Tomorrow/date; changing clears state but not pending read → key state and selection to resource/date. | Venue:97–111,130–144,168–174. **SP-SLOTS-DATE-RACE:** stale success/error ignored. |
| Slots | Past hidden, unavailable disabled, free checks participants,30s refresh → retain; server lead/horizon-ineligible future cell must not be free. | Venue:314–353; M87:845–856; M80:1061–1068. **SP-SLOTS-LEAD:** configured cutoff matches booking. |
| Duration/participants | Contiguous adequate-capacity choices and child limits already exist → retain contextual controls; no participant price multiplier. | Venue:75–91,356–393; Model:32–57. **SP-DURATION:** insufficient adjacent capacity truncates choices. |
| Payment/policy | Modes/readiness filtered correctly; latest RPC dropped expected policy → restore safe effective scalars and online disclosure. | Venue:78–92,238–240; M80:284–297; M87:758–805. **SP-VENUE-POLICY-LATEST:** full-chain fallback/privacy correct. |
| Price/action footer | Already persistent; slot-only sum called Estimated total → truthful subtotal/fee qualification; retain returned-status navigation/idempotent retry. | Venue:176–240; Model:245–268; M80:1101–1116. **SP-SUBTOTAL:**100000 subtotal →100500 stored online total, no formula change. |

## Source-backed lifecycle and role/action matrices

### Identity and projection boundaries

| Entity | Actual keys / projection |
|---|---|
| Venue | `sports_venues.id` UUID PK. `owner_id` is **not unique**; names are not identity. `payment_modes` and nullable `cancellation_rules` augment the five review states. M48:17–35; M58:3–12. |
| Membership | `(owner_id,member_id)` PK, active membership and merchant_staff; not a venue id. Actual owner check is distinct from membership role string. M52:5–69. |
| Resource | `sports_resources.id` PK; `venue_id`,`activity_id` FKs; slot_minutes30/60/90/120; mode instant/approval; capacity1–100. M48:37–47; M58:14–18. |
| Booking | `sports_bookings.id` UUID PK; customer/venue/resource FKs; partial unique `(customer_id,idempotency_key)`; no unique resource/start booking invariant at capacity>1. M48:83–102; M58:20–53. |
| Slot | **Generated, not a sports_slots row.** Context is resource UUID + IST date + returned start/end. Hours PK `(venue_id,weekday)`; price/block UUIDs. M48:49–81; M87:808–883. |
| Payment/refund | Payment UUID and sports_booking_id; one created sports attempt partial unique. `refund_paise` aggregates queued booking refunds; no processed-refund status in booking read. M58:55–68; M80:535–553. |

Public cards must not import owner/admin/docs/payout records to recompute status. M87 public venue functions return verified-only safe fields, redacting guest street/coordinates. The existing review table references **service `public.bookings` and providers**, not sports bookings: `0001_init.sql:266–280`. No sports customer-review, order engine or sports receipt capability is added.

### Venue review: actual states, current behavior and repaired action presentation

| Stored state | Actual owner now / required safe behavior | Admin now / required safe behavior | Public |
|---|---|---|---|
| draft | Edit; submit after active resource/activity, hours and price. Retain. | Cannot transition draft via setter. Retain. | Hidden |
| submitted | Current repeat submit rewrites; make no-op/status Under review. | Verify / reasoned reject/suspend; keep existing valid edges. | Hidden |
| verified | Current submit downgrades to submitted; repair to no-op. Changed detail save intentionally drafts, with warning. | Current Verify repeated; remove it and same-state writes. Other existing different-state actions remain. | Visible only with active matching public eligibility |
| rejected | Reason + edit/resubmit; preserve prerequisites. | Existing verified-target re-review is SQL-authorized but missing UI; explicit action. | Hidden |
| suspended | Detail save/submit denied; show reason/read-only details. Existing booking resolution persists. Do **not** invent blanket maintenance revocation. | Existing verified-target restore is authorized; expose explicitly, preserve reasoned other existing edges. | Hidden |

Evidence: **M48:428–478**, **M58:338–367**, **M87:739–804**. Admin identity is current explicit `admins.user_id` membership, **not historical phone allowlist**: **M59:3–19**.

Other actual venue actions:

| Action | Actor / state / parent | Write/readback |
|---|---|---|
| Create venue | Any authenticated profile; sports ON; no providers-role requirement | `save_sports_venue(NULL,...)` → draft; authorized business venue read. M58:288–337. |
| Save venue | Actual owner, not suspended, sports ON | Detail change → draft; unchanged/payment-only retains state/reason. M58:338–373. |
| Resource create/edit | Actual owner, sports ON; active activity, valid mode/capacity/slot length | Existing fields update; no new review policy inferred. M58:375–430. |
| Hours | Actual owner, sports ON; valid weekday/range | Upsert row; both null deletes selected weekday. M48:296–325. |
| Price create/edit/delete | Actual owner, sports ON; positive paise, valid interval/day; overlap guard on create/edit | Actual rule UUID; old booking price snapshots unchanged. M48:327–375; M80:581–599. |
| Block add/remove | Actual owner, sports ON; valid interval/reason; add rejects active reservations/holds | Private management block rows; public read sees blocked, not private reason. M72:53–89; M48:412–426. |
| Activity enable/disable | Actual admin, sports ON | Catalogue active state only; no automatic cancellation. M48:512–529. |

### Booking: actual status/role/action matrix

Shared read: customer or active authorized business member through `get_business_sports_booking`. **Admin is not an implicit participant.** Members are read-only even when called manager or membership-role owner. M80:215–258,315–358; M52:27–69.

| Raw status | Customer | Actual venue owner | Manager/staff | Next state / source |
|---|---|---|---|---|
| pending_payment | Complete payment before hold deadline; cancellation before start | Read; reasoned cancel; no approve | Read only, not Pay | Exact timely capture → accepted; hold expiry → expired. M72:544–613; M63:824–875. |
| requested | Waiting for venue; no Pay; cancel before start | Accept/decline only before expires_at; reason required to decline; cancellation retains current rule | Read only | Online accept → awaiting_payment; venue accept → accepted; decline → declined; expiry → expired. M80:851–919. |
| awaiting_payment | Pay stored total before pay_by; cancel before start | Read/reasoned cancel; no repeat approval | Read only | Timely capture → accepted; deadline expiry → expired. M58:1284–1317; M72:544–593. |
| accepted | **Confirmed**; Paid online or Pay at venue; customer cancel only before start | Read/reasoned cancel under current active-state rule, including after start | Read only | After ends_at worker → completed; cancellation → cancelled. M80:516–553; M63:876–892. |
| declined | Read reason/history; no pay/cancel/approve | History; no repeated decision | Read history | No outgoing user transition defined. |
| cancelled | Read history/refund request; no repeated cancel/pay | History; no invented settlement claim | Read history | Late capture refunded, not reconfirmed. M72:596–613. |
| completed | Read completed history; no invented sports review/receipt | Read history; settlement separate | Read history | No new user sports transition defined. |
| expired | Read expired history; optional separately gated new-slot navigation | No accept | Read history | Late capture refund path; no resurrection. M72:596–613. |

Statuses/checks: M58:20–47; `cancelled_by` customer/venue/system: M72:3–4. Labels/payment summaries: Model:94–118.

### Booking creation, holds, payment and completion

| Operation | Exact current behavior to preserve |
|---|---|
| Main create | Authenticated non-owner, verified active resource/activity; sports parent. Online adds online child + venue mode + activated payout account. Venue mode requires its venue setting. M80:980–1028. |
| Effective mode | Stored instant plus effective instant child → instant; otherwise approval. Instant online → pending_payment/hold; instant venue → accepted; approval either mode → requested. M80:1122–1143. |
| Window/limits | Start future and ≤now+30 days, configured lead, 1–4 aligned same-local-day covered slots within hours, participants1–50, capacity; multi-slot/capacity child for >1. Configured customer active-hold limit includes future accepted pay-at-venue. M80:986–1088. |
| Price | Sum server rule price per slot, **not participants × price**. Online adds configured customer fee; commission snapshot preserved. M80:1090–1116. |
| Idempotency | Existing same customer/key returns current same booking before new-creation gates; partial unique insert/read prevents a second row. No general new-booking exception when disabled. M80:967–978,1135–1159. |
| Owner approval | Actual owner, requested, expires_at live. Online pay_by = min(start−configured lead, now+configured approval-pay window); venue acceptance immediately accepted. M80:871–906. |
| Prepare payment | Service role only, authenticated user supplied by Edge; existing online due state/live deadline and positive stored total; reuse live matching attempt or retire/create. M58:1272–1319,1870–1902. **SP-F11 repairs only contradictory Edge blanket flag gate.** |
| Capture | Unique capture id, exact amount, locks. Timely created attempt → accepted/paid_at. Extra/mismatched/late capture uses capped refund path. M72:470–613; M58:1321–1391. |
| Cancel | Active four states; customer before start or actual owner with3–500-character reason. Resource/booking lock, server refund target/queue; retire created attempts; cancelled_by recorded. M80:492–579. |
| Expire/complete | Worker handles each expired request/hold/pay window and accepted ended bookings, with resource lock. Existing cron every5 minutes is ungated. M63:824–892; M58:1851–1862. |

### Slot truth

| Slot state | Current defining condition / UI | Required change or retain |
|---|---|---|
| past | start≤now; client hides | Retain |
| blocked | Overlapping owner block, or no full-cover price rule | Retain; also classify future existing lead/horizon-ineligible starts blocked, not free |
| taken | Active overlapping participants≥resource capacity | Retain |
| free | Otherwise; returned remaining≥0, client also checks selected participants | Retain four-state contract; correct read/write eligibility mismatch |

Evidence: **M87:845–881; Model:14–57; Venue:314–353**.

Occupancy consumes `accepted`, live `requested.expires_at`, live `awaiting_payment.pay_by`, and live `pending_payment.hold_expires_at`. Lapsed holds stop consuming capacity **even before** the expiry worker changes raw booking status. Multi-slot durations require contiguous free adequately sized cells. Main booking checks the maximum per-slot occupancy; legacy request currently sums the full period.

**Legacy counterexample:** capacity2, one participant in10:00–11:00 and one in11:00–12:00. Both slots have remaining1. A new one-participant two-slot request fits, but legacy uses2+1>2 and refuses. Repair only that occupancy aggregation; do not alter price, mode or hold rules. M80:798–807 versus1070–1088.

## Current refresh and after-action cross-role views

| View | Current real mechanism | After another role acts / exact repair |
|---|---|---|
| S31 admin venue review | Focus + retry + local mutation load. Admin:37–85. | Owner submit/detail draft can stay stale while focused. Add one focused/active60s read; preserve typed reasons. |
| S78 public search | Focus and activity/coordinates/radius dependency read. Activity:36–52. | Suspension/review change appears on next read; foreground refresh removes same venue PK. |
| S79 customer list | Focus only; latest RPC ungated. List:25–37; M80:196–213. | Owner decision/cancel/capture needs bounded/foreground read, not only navigation round-trip. |
| S80 home | Focus catalogue load; feature hook foreground refresh is flags only. Home:32–43. | Discovery results must not hide independent existing-work links. |
| S81 owner/member | Focus and local action reload of venues/activities/bookings; object-change effects hydrate forms. OwnerState:74–138. | Admin/remote booking update needs safe refresh **after dirty fields are separated**; common error/selector must survive reader mode. |
| S82 detail | Focus + local action load. Detail:37–64. | Request/payment expiry/capture or counterparty action remains stale; add bounded/foreground read and actor/time action helper. |
| S83 checkout | Focus +30s reads; component1s clock; post-payment load. Checkout:53–82. | Retain cadence, stop background/blur duplication, reload on return, present actual confirmed outcome. |
| S88 selection | Venue metadata focus; slots focus/dependency +30s; slot-taken error reload. Venue:113–174,207–215. | Preserve one slot timer; foreground refresh venue truth; discard obsolete resource/date responses. |
| Shared Activity sports | Focus + parent pull-refresh registration; unread provider polls counts only. ActivityCards:16–26; `UnifiedActivityScreen.tsx:72–99`; `ActivityUnreadProvider.tsx:57–74`. | Do not claim unread-count polling updates booking rows. Preserve pull/mark-read while sharing correct card presentation. |

**Same-PK verification workflows** are fully specified as SP-X01–SP-X05 in JSON: venue review across owner/admin/public; venue-payment approval; online approval/capture/completion; instant online shutdown/expiry/late refund; capacity read/main/legacy/block behavior. Each scenario gets independent fixtures; **within** a scenario compare the same actual UUID across authorized role projections, never names/screenshots.

## Exact existing money/refund policy — retain

No values below assert hosted current settings.

- `sports_rules` has validated admin-managed windows, fees, commission, cancellation tiers, release time and hold limits. M80:3–159. Initial seeds are hold10m, approval-pay60m, commission1000bp, customer fee0, full24h, partial6h/5000bp, release24h; M80 backfills hold-limit3/response120m/lead30m when not numeric. **Seeds are not live policy reads.**
- **Customer cancellation:** before start only; refund target is service price at/above full cutoff, rounded service price×partial bp in the partial tier, zero below. Customer fee is not in this customer service-refund target. Venue overrides fall back per field to global rules.
- **Venue cancellation:** actual owner with reason; target full stored total, fallback service price+fee. Do not invent a matching owner before-start cutoff.
- Actual queue is capped by captured refundable payments after nonfailed refunds. Preview is advisory; write rechecks under lock. A booking's `refund_paise` is **not** a processed-refund status. M80:360–579; `0001_init.sql:642–670`.
- Existing retained/completed venue payout: gross=max(service price−booking refund,0); commission rounded from snapshot bp; GST18% of commission; net=max(gross−commission−GST,0); configured release delay. Venue cancellations do not create this payout; demo money creates no live transfers. M72:732–831; M60:256–342.
- Recording, expiry, cancellation and settlement must remain independent of Oorva and new-booking switches. Existing source already largely does this; the real create-payment blanket gate is the concrete exception SP-F11.

**Exact isolated acceptance fixture, not a live transaction:** service100000 paise, online fee500, commission1000bp, partial5000bp. Stored total100500; partial customer refund50000; retained gross50000; commission5000; GST900; venue net44100. Full customer service refund100000 leaves no service gross payout; venue cancellation targets100500. No formula changes are part of the redesign.

## Card contracts

### Sports venue

Current reuse: `ListingCard variant="venue"`; actual row source `app\src\components\market\ListingCard.tsx:84–133`.

1. Real first image/fallback; full venue name.
2. Activity context, area/city and real distance.
3. Compact verified indicator from verified-only public SQL; no payout/document/status-reason data.
4. From server minimum **per-slot** price or View slots; not live availability/selected-date quote.
5. One open-venue action. Full detail: compact identity/hero then resource/date/slot, not twelve images before choices.

No rating/review stars are available for this sports projection. Error/empty/loading remain explicit. O08 alone evolves the shared optional presentation API; legacy default stays. Tests: SP-VENUE-CARD-LONG, SP-SEARCH-TRUST, SP-VENUE-C-OFF, SP-VENUE-PUBLIC.

### Sports booking

Create `app\src\features\sports\SportsBookingCard.tsx`, wrapping existing primitives rather than a universal service/order card.

- Inputs: current booking fields, `perspective` customer/venue_owner/business_reader, optional authorized customer name, `onOpen(id)`. Existing business RPC already returns range/participants/deadlines; extend the narrow client type, do not infer them.
- Order: venue+canonical status → activity/resource → actual IST range/participants → stored total+separate payment summary → applicable response/hold/pay deadline → conditional reason/refund request → exact-id open.
- Reuse `getSportsBookingStatusLabel` and `getSportsPaymentSummary`; extend Model with **`getSportsBookingActions({booking,viewerId,now})`**, returning pay/decide/cancel eligibility, applicable deadline/type and next action. Existing `canContinueSportsCheckout(status)` is status-only and cannot supply actor/time guards by itself.
- No settled-refund inference, private money records, new sports receipt or review action. Read-only business readers never become payers/deciders.
- Replace S79, Activity sports and BusinessCards sequentially under O20/O16/O29 ownership; retain Activity refresh/read bookkeeping.

Assertions: same UUID/status/mode/total/deadline across projections; online accepted cannot say Pay at venue; awaiting_payment cannot say No online payment; queued refund cannot say completed. Long titles/full amounts/one accessible action must remain usable.

## Ordered implementation tasks

These are executable repairs, **not future “audit it” tasks**. The JSON gives exact file lists with coordinator-substituted migration claim tokens, steps and full assertions. Source evidence remains the current defining historical migrations.

**Numeric version UNASSIGNED until shared coordinator acknowledgment** for every new SQL claim below. These tokens are execution metadata, not permission to guess `max(main)+1`; other active/uncommitted claims are unknown. Only shared coordinator acknowledgment may substitute a numeric version and serialize order/test registration. Preserve all historical source evidence; do not edit applied M48/M58/M80/M87.

| Task | Coordinator-substituted execution filename under `supabase\migrations` | Numeric version |
|---|---|---|
| SP-T01 | `<MIG-SQL-V>_oorva_sports_review_guards.sql` | **UNASSIGNED** |
| SP-T06 | `<MIG-SQL-SP>_oorva_sports_public_projection.sql` | **UNASSIGNED** |
| SP-T11 | `<MIG-SQL-SC>_oorva_sports_legacy_capacity.sql` | **UNASSIGNED** |

| Task / findings / owner | Ordered edits and exact main files/functions | Acceptance / named cases | Depends / review |
|---|---|---|---|
| **SP-T01** F01/F02 · O09 | New review migration: current `submit_sports_venue`, `admin_set_venue_status`; actor/feature check → row lock → idempotent terminal/current-state handling → retained valid transitions/prerequisites/audit. Add `supabase\tests\oorva_venue_review.test.mjs`. | SP-REVIEW-01..07: verified/submitted repeat unchanged; draft/rejected prerequisites; suspended/nonowner/member/parent-OFF deny; restore retained, no repeat audit. | None · auth/concurrency focus |
| **SP-T02** F01/F02/F03/F20 · O09 | New `venueReviewPresentation.ts` descriptors + exact detail-change comparator; consume in Admin/VenueEditor/OwnerActions; existing useConfirm; suspended detail read-only. | `venueReviewPresentation.test.ts`: all5 states, all dirty fields; `manage\__tests__\actions.test.ts`: confirm cancel=noRPC, payment-only no draft. | T01 |
| **SP-T03** F04/F05 · O29 | OwnerActions explicit snake→camel mapping; OwnerState complete resource/day hydration, baseline/dirty/loading; ResourceEditor/Schedule common context; reader errors through OwnerScreen/BusinessCards. | `manage\__tests__\actions.test.ts`: real Resource payload; `managementState.test.ts`: auto-selection/day/context/loading/dirty refresh. | T02 |
| **SP-T04** F06 · O29 | OwnerScreen common selector before owner/reader branch; VenueEditor/BusinessCards filter by actual venue UUID; no privilege widening. | `managementState.test.ts`: two assigned+owned venues, revoked membership, no cross-venue rows/edit controls. | T03 · auth focus |
| **SP-T05** F08/F09 · O20 | Model `getSportsBookingActions`; Detail/Checkout actor/mode/time guards; terminal checkout outcome and no old deadline warning. | `model.test.ts`:8 statuses×actors/deadlines; `checkoutPresentation.test.ts`: owner/member not payer, invalid deadline, paid old deadline. | None |
| **SP-T06** F10/F15 · O20 | New public-projection migration: latest `get_sports_venue` safe policy scalars; latest `get_sports_slots` existing lead/exact-horizon truth. New full-chain `supabase\tests\oorva_sports_truth.test.mjs`; extend `guest_read_access.test.mjs`. | SP-LATEST-POLICY-PROJECTION, PER-FIELD-FALLBACK, LEAD-BOUNDARY, EXACT-HORIZON; existing guest redaction/parents/remaining unchanged. | T01 · public-field/auth review |
| **SP-T07** F11 · O20 + money owner | `supabase\functions\create-payment\{index.ts,logic.ts,logic_test.ts}`: existing-obligation auth/preparation separate from fresh creation switches; preserve all order-race/recorder paths. | SP-LIVE-OBLIGATION-FLAGS-OFF; new creation still denied; wrong actor/mode/state/deadline denied; exact stored money, no gateway unit calls. | None · money/auth review |
| **SP-T08** F12 · O20/O16/O29 | New SportsBookingCard; List/ActivityCards/BusinessCards + business types; existing Model helpers; tighten `e2e\web-smoke.mjs` sports fixture assertions. | `bookingCardPresentation.test.ts`: same-PK, online/nonzero-fee/due/terminal/refund wording; markRead/registerRefresh retained. | T05,T04 |
| **SP-T09** F13 · O09 → O20 | New `useSportsReadRefresh.ts`; replace, not duplicate, Admin/Owner/Activity/List/Detail/Checkout/Venue data timers; focus+AppState+web visibility. `load(guard)` checks `guard.isCurrent()` after awaits before success/error writes; hook returns refresh/refreshing and invalidates guards on cleanup/context change. | `readRefresh.test.ts`: one timer, foreground, blur/background cleanup; dirty preservation; no claim unread counts refresh rows. | T03,T05 |
| **SP-T10** F14 · O20 | Venue read+selection identity tokens; synchronous invalidate on context/cleanup; guard stale success/error and mismatched booking submit. | `slotReadContext.test.ts`: out-of-order success/error, selected-context guard, unchanged retry idempotency. | T09 |
| **SP-T11** F16 · O20/S3 | New legacy-capacity migration changes only `request_sports_slot` occupancy to per-slot maximum; full-chain isolated legacy scenarios. | SP-LEGACY-PER-SLOT-CAPACITY, FULL-SEGMENT, PARENT-CHILD-DENY; prices/semantics unchanged. | T06 · concurrency review; separate real-Postgres proof |
| **SP-T12** F17 · O20 | Venue footer Slot subtotal (estimate) and online fee qualification; preserve exact Checkout breakdown. | `checkoutPresentation.test.ts`:100000 subtotal/100500 stored total; venue fee0; no participant multiplier. | T10 |
| **SP-T13** F18 · O20 | Home and API context: independent signed-in history; actual own/assigned context; legitimate self-onboarding; consume family selector. | `homePresentation.test.ts`: history OFF/error/empty, owner in customer nav mode, staff readonly, guest private denial. | T04 |
| **SP-T14** F19 · O20/O08 | Activity/Home/List/Venue public composition; O08 stable optional sports card props; one hero before selection; responsive grid/time range; no shared-default override. | Family ON/OFF/brand-parent-OFF, full title/price,12-photo fixture; actual matched before/after sports frames after implementation. | T06,T08,T12,T13 |
| **SP-T15** F07 · O29 | OwnerScreen/BusinessCards/types/Model: requests → current/upcoming/history → editors; actual ends_at; no new status/mutation. | `managementState.test.ts`: request-first, started accepted + all terminal records, staff boundary, corrected legacy OFF. | T04,T08,T09 |
| **SP-T16** F19 · O31 | Admin composition after O09: submitted queue/count/filter then secondary activity configuration; preserve action guards/errors. | `venueReviewPresentation.test.ts`: queue filters, restore-not-redundant-Verify, family OFF. | T02,T09 |
| **SP-T17** F20 · O29 | OwnerActions/Schedule: existing useConfirm for close-day/price-delete/block-remove; route inline close through action boundary; busy/finally/error/reload. | `actions.test.ts`: each cancel zero writes, confirm one correct context write, failure retains truth, no nonowner rights. | T03 |

### Shared runtime controls and ownership

- The plan's **`oorva_sports_ux` is not present at this source SHA**. Coordinator O01/O03/O05 must register default **false**, label **Oorva sports presentation**, group **Oorva presentation**, sort140, description **“Off: Existing corrected sports presentation is retained.”**, parent `oorva_brand`.
- This is composition only. Actual `sports`, `sports_online_payments`, `sports_instant_booking`, `sports_capacity_slots`, `sports_multi_slot`, `merchant_staff`, and guest policy remain independently enforced server-side. Parent-OFF/child-ON and authorized/unauthorized assertions are explicit in the tasks.
- O09 → O29 serializes shared OwnerState/actions/venue sections; O09 → O31 serializes Admin; O20 → O16/O29 serializes shared card consumers. O08 owns generic primitive APIs. Financial owner serializes create-payment with O35D display changes. Coordinator alone handles migration/test registration.
- Focused review is required for money/auth/concurrency implementation changes. No automatic Opus review, runtime PASS or production-read claim is made here.

## Retain / no-change cases

| ID | Proven current invariant and required regression assertion |
|---|---|
| SP-R01 | Public venue trust is verified-only; no unsupported sports rating. M87:739–804; `0001_init.sql:266–280`. |
| SP-R02 | Main book RPC already has per-slot maximum, locks and idempotent row handling. M80:1002–1006,1070–1088,1135–1159. Do not mark the main path unfixed. |
| SP-R03 | Members/managers are read-only sports users, not actual-owner mutators. M52:27–69; M80:871–879. |
| SP-R04 | Current customer/business/detail RPCs and cancel/preview remain available for authorized existing work OFF. M80:172–258,315–358,421–579. Do not infer direct member base-table RLS OFF behavior from SECURITY DEFINER RPC behavior. |
| SP-R05 | Recorder/expiry/completion/payout are not cosmetic flag gates; latest cron is ungated. M72:470–613,732–831; M63:824–892; M58:1851–1862. |
| SP-R06 | New online parent/readiness/mode checks, capacity/multi-slot child gates and instant-OFF approval fallback already exist. M80:980–1028,1122–1133. |
| SP-R07 | Unavailable cell visibility/disable, past hiding, contiguous duration checks and persistent footer already exist. Model:14–57; Venue:227–240; `ui\Screen.tsx:109–136`. |
| SP-R08 | Pending-payment and awaiting-payment live holds already prevent owner maintenance blocks. M72:73–88. |
| SP-R09 | Customer/owner refund differences, fee exclusion, caps and retained payout formulas remain exact. M80:360–579; M72:777–799. |
| SP-R10 | Unchanged/payment-only venue save retains review; detail change intentionally drafts. M58:348–367. |
| SP-R11 | Current admin identity uses explicit admins membership, not old phone allowlist. M59:3–19. No personal account details are reproduced. |
| SP-R12 | Service-only payment preparation/recording and authenticated server-user/stored-total checks stay intact. M58:1870–1902; `create-payment\index.ts:46–70`; API:177–183. |

## Visual evidence, risks and genuine limitations

Two images were inspected from `critical-audit\before-web-44696642603`:

| Frame | Actually observed | Not established |
|---|---|---|
| `19-phase-6-sports-booking-request.png` | S82 title/status/resource/time/participant/payment/fee/note/expiry/cancel hierarchy; Waiting for venue and Pay at venue visible; request-sent toast/demo indicator. | Actual PK, actor, feature configuration, SQL state, cancellation interaction or lifecycle PASS. |
| `83-my-activity-sports-segment.png` | Sports activity cards visibly use uppercase REQUESTED/ACCEPTED/COMPLETED and No online payment / Pay at venue. | Underlying payment modes or same-PK parity. The wrong-online conditional is proved by ActivityCards source, not guessed from this frame. |

Local `git diff 229995fe3194de39684f12ef348d3e37930ae5f2 2f1e4638b145185b9e58c4c62e58f5c6dd491fa1 --name-only` returned only `docs/14-UI-Redesign-AI-Execution-Plan.md`, supporting application-source parity. The supplied hosted run outcome is **completed/failure with Home flag-coverage assertions**; it is not treated as sports failure or sports PASS.

- Seven assigned screens have no inspected direct image. No after screenshots, device behavior, large-text layout or interaction success was verified.
- No database/app tests ran. PostgreSQL lock behavior, deployed migration versions, actual feature settings, gateway refund completion, cron/push delivery and native layout remain **runtime-unverified**, not unexplained source-audit gaps.
- Existing `sports_hardening.test.mjs:55–64` loads only migrations≤80; it cannot detect M87 replacing the policy projection. `guest_read_access.test.mjs` covers later public reads but its sports assertion inventory does not assert cancellation_policy. New full-chain assertions are concrete tasks above, not existing PASS evidence.
- Numeric migration versions remain **UNASSIGNED until shared coordinator acknowledgment** substitutes the claim tokens above. Shared file handoffs also require coordinator acknowledgment. This is execution metadata, **not** a new domain policy or permission to infer the next number from main.
- **No policy blocker:** preserve current source rules. Giving managers mutation rights, revoking every suspended-venue maintenance action, refunding the customer fee for customer cancellation, extending payment grace or adding sports reviews would be separate policies and are intentionally not selected.

The adjacent JSON includes the complete files-read manifest and all source references. Only these two assigned report files were authored.


## Addressable source task cards

<a id="sp-t01"></a>

### SP-T01

**Evidence findings:** SP-F01, SP-F02. **Logical WP:** O09. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `supabase\migrations\<MIG-SQL-V>_oorva_sports_review_guards.sql`; `supabase\tests\oorva_venue_review.test.mjs`.

**Function scope:** `submit_sports_venue(uuid)`; `admin_set_venue_status(uuid,text,text)`.

**Required edits:**

1. Numeric version UNASSIGNED until shared coordinator acknowledgment of MIG-SQL-V. Only that acknowledgment may substitute <MIG-SQL-V> in the execution filename; never guess max(main)+1 or assume active/uncommitted claims are free. Then add the new migration; do not edit 0048.
2. Replace submit with feature/uid/owner validation, FOR UPDATE, suspended denial, submitted/verified unchanged return and draft/rejected existing prerequisite validation/update.
3. Replace admin setter with feature/admin validation, locked current row, retained non-draft different-state edges and no-op self-transition before update/audit.
4. Add createHarness scenarios applying the complete migration chain including 0087/0088 and this migration; hand shared package.json registration to coordinator.

**Acceptance:**

- Verified owner stale submit keeps status/reason/updated_at/public visibility; repeated submitted is unchanged.
- Non-owner, business member and sports-OFF denied before no-op; suspended denied; draft/rejected need actual active resource/activity/hours/price.
- Admin repeat target produces no timestamp/audit churn; draft denied; rejected/suspended restore remains allowed; all other existing different-state edges remain.

**Tests (requirements, NOT RUN):**

- supabase\tests\oorva_venue_review.test.mjs: SP-REVIEW-01..07, isolated venue/resource/customer fixtures; same-PK admin/owner/public reads.
- Use explicit SQL casts, actual-value JSON assertion diagnostics and scenario continuation; no concurrency PASS from sequential PGlite.

**OFF behavior:** Oorva OFF still gets guards. Actual sports OFF still denies review/submission; existing booking safety untouched..

<a id="sp-t02"></a>

### SP-T02

**Evidence findings:** SP-F01, SP-F02, SP-F03, SP-F20. **Logical WP:** O09. **Class:** A. **Source task prerequisites:** SP-T01.

**Proposed source files (canonical allocation takes precedence):** `app\src\features\sports\venueReviewPresentation.ts`; `app\src\features\sports\__tests__\venueReviewPresentation.test.ts`; `app\app\admin\sports.tsx`; `app\src\features\sports\manage\VenueEditorSections.tsx`; `app\src\features\sports\manage\actions.ts`.

**Function scope:** `Read/consume repaired review RPCs; retain save_sports_venue detail-reset policy`.

**Required edits:**

1. Implement getVenueReviewPresentation(status,actor) descriptors and hasSportsVenueReviewChanges(saved,normalizedDraft), covering every actual status and actual-owner/admin boundary.
2. Render verified/under-review status instead of repeated action, explicit existing admin Restore/Re-verify, and no same-state review controls.
3. Use existing useConfirm for review-affecting detail save and admin restriction; make suspended venue details read-only only where SQL denies writes.
4. Keep post-mutation canonical reads; hand state-hook ownership to O29 before its edits.

**Acceptance:**

- Each of five venue states has explicit owner/admin action assertions; verified never exposes Verify or Submit.
- Changed detail warning matches SQL fields; unchanged/payment-only no re-review warning or downgrade; cancelling warning makes zero calls.
- Owner-only controls remain absent for every member-role string; no private payout state used as verification.

**Tests (requirements, NOT RUN):**

- app\src\features\sports\__tests__\venueReviewPresentation.test.ts: SP-REVIEW-UI-ALL-STATES, SP-REVIEW-DIRTY-FIELDS.
- app\src\features\sports\manage\__tests__\actions.test.ts: SP-SAVE-CONFIRM-CANCEL, SP-SUSPENDED-DETAIL-READONLY.

**OFF behavior:** Truth/permission/warning behavior applies in corrected legacy and Oorva presentations; actual parent gates unchanged..

<a id="sp-t03"></a>

### SP-T03

**Evidence findings:** SP-F04, SP-F05. **Logical WP:** O29. **Class:** A. **Source task prerequisites:** SP-T02.

**Proposed source files (canonical allocation takes precedence):** `app\src\features\sports\manage\useSportsVenueManagementState.ts`; `app\src\features\sports\manage\actions.ts`; `app\src\features\sports\manage\ResourceEditorSection.tsx`; `app\src\features\sports\manage\ResourceScheduleSections.tsx`; `app\src\features\sports\manage\SportsVenueManagementScreen.tsx`; `app\src\features\sports\manage\BookingSections.tsx`; `app\src\features\sports\manage\__tests__\actions.test.ts`; `app\src\features\sports\manage\__tests__\managementState.test.ts`.

**Function scope:** `Retain existing resource/hours/price contracts`.

**Required edits:**

1. Map selectedResource.booking_mode explicitly to storedSettings.bookingMode before resolving settings for save.
2. Hydrate all resource fields on automatic/explicit resource PK change and selected venue+weekday hours from actual loaded rows; reset price edit context when resource/venue changes.
3. Separate baseline records/dirty draft fields from server review/bookings; add initialLoading/hasLoaded and preserve dirty text on background reads.
4. Render initial skeleton and common error/retry including assigned mode; do not turn failed/unfinished reads into Create/no-bookings success.

**Acceptance:**

- A nondefault auto-selected resource saves unchanged identity/activity/slot_minutes/mode/capacity.
- Stored instant/capacity8 survive child-OFF unrelated save; new resource uses approval/1; parent-OFF and non-owner writes denied.
- Different stored Monday/Tuesday hours load correctly; missing hours means closed only after load; changing context clears old price id.
- Unresolved first load cannot show Create; assigned error visible; dirty name survives a review status update.

**Tests (requirements, NOT RUN):**

- manage\__tests__\actions.test.ts: SP-REAL-RESOURCE-SNAKE-CASE-PAYLOAD, SP-CHILD-OFF-PRESERVE.
- manage\__tests__\managementState.test.ts: SP-AUTOSELECT-HYDRATE, SP-HOURS-CONTEXT, SP-INITIAL-LOAD, SP-ASSIGNED-ERROR, SP-DIRTY-REFRESH.

**OFF behavior:** Hidden child controls preserve stored settings; all baseline fixes remain when presentation OFF..

<a id="sp-t04"></a>

### SP-T04

**Evidence findings:** SP-F06. **Logical WP:** O29. **Class:** A. **Source task prerequisites:** SP-T03.

**Proposed source files (canonical allocation takes precedence):** `app\src\features\sports\manage\SportsVenueManagementScreen.tsx`; `app\src\features\sports\manage\VenueEditorSections.tsx`; `app\src\features\sports\manage\BookingSections.tsx`; `app\src\features\sports\manage\__tests__\managementState.test.ts`.

**Function scope:** `Existing get_my_business_sports_venues/get_my_business_sports_bookings/_acts_for only`.

**Required edits:**

1. Remove the pre-selector non-owner Screen return; render one common authorized selector/status/error shell.
2. Select owner editors or read-only assigned booking content after selection, and filter by actual selected venue UUID.
3. Keep Create/staff-management controls owner-contextual and actual-owner checks, not membership-role owner labels.

**Acceptance:**

- Two assigned venues and an owned venue remain individually reachable regardless of initial SQL order.
- Assigned selection never shows owner mutation controls; switching cannot mix venue bookings; removed membership revokes reads.
- merchant_staff OFF removes member access but not actual owner's access; sports OFF existing-work branch remains.

**Tests (requirements, NOT RUN):**

- manage\__tests__\managementState.test.ts: SP-MULTI-ASSIGNED-SELECTOR, SP-MIXED-OWNER-MEMBER, SP-REVOKED-MEMBER.

**OFF behavior:** Actual sports OFF still shows existing authorized bookings without configuration; cosmetic OFF does not reintroduce selector trap..

<a id="sp-t05"></a>

### SP-T05

**Evidence findings:** SP-F08, SP-F09. **Logical WP:** O20. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\src\features\sports\model.ts`; `app\app\sports-booking\[id].tsx`; `app\app\sports-checkout\[id].tsx`; `app\src\features\sports\__tests__\model.test.ts`; `app\src\features\sports\__tests__\checkoutPresentation.test.ts`.

**Function scope:** `Retain prepare/decide/preview/cancel SQL predicates`.

**Required edits:**

1. Add getSportsBookingActions({booking,viewerId,now}) -> canPay/canDecide/canCancel/applicableDeadline/deadlineKind/nextAction, reusing current typed sports status helpers.
2. Bind detail and checkout rendering to actor, actual raw status, payment mode, paid_at and the correct finite deadline; customer cancel checks starts_at, owner cancellation cutoff unchanged.
3. Show payment countdown only in due states; accepted/completed View booking and requested View request replace unconditional replacement-slot fallback.
4. Retain preview-before-cancel and post-payment canonical read; use local clock only to suppress ineligible action, not invent persisted status.

**Acceptance:**

- All eight statuses x customer/actual-owner/business-reader/stranger receive exact allow/deny assertions.
- At exact request/payment/start boundaries invalid actions disappear; absent/invalid deadline fails closed.
- Successful accepted read of same PK has no countdown or expired-payment warning and primary View booking; browser opened alone never marks paid.

**Tests (requirements, NOT RUN):**

- sports\__tests__\model.test.ts: SP-ACTION-ACTOR-STATE-DEADLINE, SP-CUSTOMER-OWNER-CUTOFF-DIFFERENCE.
- sports\__tests__\checkoutPresentation.test.ts: SP-PAID-OLD-DEADLINE, SP-STAFF-NOT-PAYER, SP-MISSING-DEADLINE.

**OFF behavior:** Existing due payment and customer cancellation remain available after business flags OFF; new-slot navigation alone respects discovery flags..

<a id="sp-t06"></a>

### SP-T06

**Evidence findings:** SP-F10, SP-F15. **Logical WP:** O20. **Class:** A. **Source task prerequisites:** SP-T01.

**Proposed source files (canonical allocation takes precedence):** `supabase\migrations\<MIG-SQL-SP>_oorva_sports_public_projection.sql`; `supabase\tests\oorva_sports_truth.test.mjs`; `supabase\tests\guest_read_access.test.mjs`.

**Function scope:** `get_sports_venue(uuid) latest 0087`; `get_sports_slots(uuid,date) latest 0087`.

**Required edits:**

1. Numeric version UNASSIGNED until shared coordinator acknowledgment of MIG-SQL-SP; only then substitute <MIG-SQL-SP> in the execution filename. Replace latest 0087 venue read with a surgical added effective cancellation_policy object; preserve all guest privacy and eligibility predicates.
2. Read/validate configured min_lead_minutes once in slot read; retain true past and classify future lead/horizon-ineligible slots blocked.
3. Add full-chain createHarness scenarios through latest numbered migration; register the new test via coordinator-owned supabase/tests/package.json, not a truncated <=80 loader.

**Acceptance:**

- Venue/global per-field refund policy matches current cancellation helper; no raw rules/private account fields exposed.
- sports OFF and guest-parent OFF deny new reads; guest address/coordinates stay redacted; authenticated behavior preserved.
- Free slot is not inside existing lead/exact horizon; price rule ordering, occupancy remaining and four-state contract preserved.

**Tests (requirements, NOT RUN):**

- supabase\tests\oorva_sports_truth.test.mjs: SP-LATEST-POLICY-PROJECTION, SP-PER-FIELD-FALLBACK, SP-LEAD-BOUNDARY, SP-EXACT-HORIZON.
- supabase\tests\guest_read_access.test.mjs: sports public read safe-fields regression with new effective policy scalars.

**OFF behavior:** Correct public read projection/state applies with Oorva OFF; actual sports/guest gates unchanged; no refund arithmetic changed..

<a id="sp-t07"></a>

### SP-T07

**Evidence findings:** SP-F11. **Logical WP:** O20. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `supabase\functions\create-payment\index.ts`; `supabase\functions\create-payment\logic.ts`; `supabase\functions\create-payment\logic_test.ts`; `supabase\tests\oorva_sports_truth.test.mjs`.

**Function scope:** `prepare_sports_payment unchanged; book_sports_slot retains creation gates`.

**Required edits:**

1. Acquire shared create-payment lock from financial owner; separate existing sports obligation preparation from new booking capability availability.
2. Authenticate user, resolve sports request and rely on service-role preparation of that user's existing live due online record; remove blanket flags rejection only from this path.
3. Retain every payment/order persistence/race/idempotency/refund branch, server amount and response contract.
4. Replace the overbroad sports-checkout-flags unit expectation with explicit creation-versus-resolution cases and mocked handler tests.

**Acceptance:**

- Existing live pending/awaiting obligation prepares exact server total with parent OFF or online child OFF; no new online booking can be created.
- Wrong actor, mode, state or elapsed deadline is denied; a captured accepted record cannot prepare again; no broad RPC execute grant or supplied client money.
- Existing order-race/late-capture/duplicate refund tests still assert unchanged behavior.

**Tests (requirements, NOT RUN):**

- supabase\functions\create-payment\logic_test.ts: SP-LIVE-OBLIGATION-FLAGS-OFF, SP-NOT-CUSTOMER-DENIED, SP-EXPIRED-DENIED, existing losing-order cases.
- supabase\tests\oorva_sports_truth.test.mjs: SP-OFF-PREPARE-VS-NEW-CREATION.

**OFF behavior:** This is the existing-work exception; creation remains off, not a new payment policy or unlimited grace period..

<a id="sp-t08"></a>

### SP-T08

**Evidence findings:** SP-F12. **Logical WP:** O20. **Class:** A. **Source task prerequisites:** SP-T05, SP-T04.

**Proposed source files (canonical allocation takes precedence):** `app\src\features\sports\SportsBookingCard.tsx`; `app\src\features\sports\model.ts`; `app\app\sports\bookings.tsx`; `app\src\features\activity\segments\SportsSegment.tsx`; `app\src\features\sports\manage\BookingSections.tsx`; `app\src\features\sports\manage\types.ts`; `app\src\features\sports\__tests__\bookingCardPresentation.test.ts`; `e2e\web-smoke.mjs`.

**Function scope:** `Consume existing booking read fields only`.

**Required edits:**

1. Implement a minimal sports-only card contract using current Card/Badge/Text and canonical helpers; extend business row typing for already-returned ends_at/participants/refund/deadlines.
2. Replace S79, Activity sports and business variants sequentially with O16/O29 handoff; keep Activity markRead/registerRefresh and exact id navigation.
3. Replace mode-blind payment text/price with server stored total and payment_mode/paid_at summary; render neutral refund-request aggregate.
4. Tighten existing sports smoke card assertions against an isolated known PK/mode/fee/status rather than a regex accepting any legacy text.

**Acceptance:**

- Same PK online accepted/paid has Confirmed + Paid online + exact total on every authorized projection; awaiting_payment has due wording everywhere.
- Pay-at-venue never implies an online capture; all terminal statuses distinct; staff never gains payment/decision/cancel controls.
- No private admin/doc/payout properties enter public card props; no claim queued refund completed.

**Tests (requirements, NOT RUN):**

- sports\__tests__\bookingCardPresentation.test.ts: SP-SAME-PK-CROSS-VIEW, SP-ONLINE-NONZERO-FEE, SP-STAFF-READONLY, SP-REFUND-REQUESTED.
- e2e\web-smoke.mjs existing my-activity-sports-segment step: exact known-fixture assertions and actual-value diagnostics.

**OFF behavior:** Truthful labels/amounts apply unconditionally; new composition is separately selected by family flag..

<a id="sp-t09"></a>

### SP-T09

**Evidence findings:** SP-F13. **Logical WP:** O09. **Class:** A. **Source task prerequisites:** SP-T03, SP-T05.

**Proposed source files (canonical allocation takes precedence):** `app\src\features\sports\useSportsReadRefresh.ts`; `app\src\features\sports\__tests__\readRefresh.test.ts`; `app\app\admin\sports.tsx`; `app\src\features\sports\manage\useSportsVenueManagementState.ts`; `app\app\sports\[activity].tsx`; `app\app\sports\bookings.tsx`; `app\app\sports-booking\[id].tsx`; `app\app\sports-checkout\[id].tsx`; `app\src\features\sports\SportsVenueBookingScreen.tsx`.

**Function scope:** `Read-only existing RPCs`.

**Required edits:**

1. Implement useSportsReadRefresh(load:(guard:{isCurrent:()=>boolean})=>Promise<void>,{enabled:boolean,intervalMs:number|null}):{refresh:()=>Promise<void>,refreshing:boolean}. Pass a focus/context generation guard to each load; callers check it after awaits before success/error writes. Serialize/coalesce reads and invalidate the guard on blur/background/context change/unmount; no new cache/publication framework.
2. Adopt 60-second review refresh and existing 30-second slot/checkout cadence; add bounded booking-detail/list refresh and immediate foreground read. Remove replaced timers, not double them.
3. Coordinate S88 adoption before SP-T10 and preserve idempotency/selection; separate review/booking truth refresh from dirty owner form fields.
4. Keep load-after-mutation and visible errors; Activity parent pull registration remains as-is until its card replacement.

**Acceptance:**

- One interval per focused screen; no reads on blur/background/hidden/unmount; immediate resume read.
- Same venue PK moves admin/owner/public projections consistently after review; same booking PK converges after decision/cancel/capture/expiry.
- Dirty name/reason/price draft not reset by status refresh; stale response cannot resurrect a removed selection.

**Tests (requirements, NOT RUN):**

- sports\__tests__\readRefresh.test.ts: SP-ONE-TIMER, SP-FOREGROUND, SP-BLUR-CLEANUP, SP-OBSOLETE-RESPONSE.
- manage\__tests__\managementState.test.ts: SP-REFRESH-DIRTY-PRESERVATION.

**OFF behavior:** Existing reads/resolution remain feature-independent where SQL permits; new discovery reads stop with actual sports OFF..

<a id="sp-t10"></a>

### SP-T10

**Evidence findings:** SP-F14. **Logical WP:** O20. **Class:** A. **Source task prerequisites:** SP-T09.

**Proposed source files (canonical allocation takes precedence):** `app\src\features\sports\SportsVenueBookingScreen.tsx`; `app\src\features\sports\__tests__\slotReadContext.test.ts`.

**Function scope:** `No SQL change`.

**Required edits:**

1. Tag each slot read and selected slot with venue/resource/date/participant context plus request generation.
2. Invalidate context synchronously on choice/parent change and cleanup; discard both stale success and stale error.
3. Require selected context identity to match current booking request before invoking bookSportsSlot; retain generic-transport retry key and slot-conflict reload.

**Acceptance:**

- A delayed A read after B cannot change B slots/selection/errors; same for resource/date/participant/parent changes.
- No mismatched-context booking RPC; unchanged request transport retry reuses key; changing semantic request resets key.

**Tests (requirements, NOT RUN):**

- sports\__tests__\slotReadContext.test.ts: SP-OUT-OF-ORDER-SUCCESS, SP-OUT-OF-ORDER-ERROR, SP-SELECTED-CONTEXT-GUARD, SP-IDEMPOTENT-RETRY.

**OFF behavior:** Race protection always applies; disabling sports invalidates pending discovery reads..

<a id="sp-t11"></a>

### SP-T11

**Evidence findings:** SP-F16. **Logical WP:** O20. **Class:** A. **Source task prerequisites:** SP-T06.

**Proposed source files (canonical allocation takes precedence):** `supabase\migrations\<MIG-SQL-SC>_oorva_sports_legacy_capacity.sql`; `supabase\tests\oorva_sports_truth.test.mjs`.

**Function scope:** `request_sports_slot(uuid,timestamptz,int,text)`.

**Required edits:**

1. Numeric version UNASSIGNED until shared coordinator acknowledgment of MIG-SQL-SC; only then substitute <MIG-SQL-SC> in the execution filename. With sports S3 owner, replace only legacy interval-wide participant sum by per-slot max with identical live occupancy predicates.
2. Keep legacy requested/pay-at-venue/one-participant result, original lock and all mode/parent/slot/lead/customer-limit/price checks.
3. Add legacy multi-slot boundary scenario to full-chain harness; coordinator registers migration/test order. Require separate real PostgreSQL review/evidence for any parallel-lock claim.

**Acceptance:**

- Capacity2 adjacent occupancy1+1 permits one new participant spanning both; a full segment refuses it.
- Parent/multi-slot OFF, owner self-booking, online-only venue and active-hold limits still reject as before; no money math change.

**Tests (requirements, NOT RUN):**

- supabase\tests\oorva_sports_truth.test.mjs: SP-LEGACY-PER-SLOT-CAPACITY, SP-LEGACY-FULL-SEGMENT, SP-LEGACY-PARENT-CHILD-DENY.

**OFF behavior:** New requests remain blocked by existing business flags; no existing booking/refund path altered..

<a id="sp-t12"></a>

### SP-T12

**Evidence findings:** SP-F17. **Logical WP:** O20. **Class:** A. **Source task prerequisites:** SP-T10.

**Proposed source files (canonical allocation takes precedence):** `app\src\features\sports\SportsVenueBookingScreen.tsx`; `app\src\features\sports\__tests__\checkoutPresentation.test.ts`.

**Function scope:** `No arithmetic change`.

**Required edits:**

1. Rename selection amount Slot subtotal (estimate).
2. For online selection, disclose that any customer fee and exact total appear in secure checkout; preserve restored cancellation-policy disclosure.
3. Continue displaying returned price/fee/total in checkout, not a new client-computed total.

**Acceptance:**

- A known 100000 subtotal plus500 fee remains subtotal100000 before creation and stored Pay100500 after creation.
- Venue mode remains fee0; no participant multiplier; truthful label with family flag OFF.

**Tests (requirements, NOT RUN):**

- sports\__tests__\checkoutPresentation.test.ts: SP-SUBTOTAL-NONZERO-FEE, SP-VENUE-NO-ONLINE-FEE.

**OFF behavior:** Correct amount terminology is unconditional; no new fee/refund behavior..

<a id="sp-t13"></a>

### SP-T13

**Evidence findings:** SP-F18. **Logical WP:** O20. **Class:** C. **Source task prerequisites:** SP-T04.

**Proposed source files (canonical allocation takes precedence):** `app\app\sports\index.tsx`; `app\src\features\sports\api.ts`; `app\src\features\sports\__tests__\homePresentation.test.ts`.

**Function scope:** `Existing authorized sports venue/business reads only`.

**Required edits:**

1. Separate signed-in existing-booking navigation from discovery success/empty/error/OFF branch.
2. Replace provider-active-role-only ownership inference with authorized venue context; distinguish My venues, read-only assigned business work and existing signed-in List a venue path.
3. Consume the coordinator's proposed default-OFF family composition selector; actual sports and merchant_staff switches still control capabilities.

**Acceptance:**

- Signed-in existing work remains reachable from new home composition despite sports OFF/empty/error.
- Owner in customer navigation mode reaches owner work; non-owner provider activeRole is not false ownership; assigned reader remains read-only.
- Guest does not receive authenticated private-history data; no new creation when sports OFF.

**Tests (requirements, NOT RUN):**

- sports\__tests__\homePresentation.test.ts: SP-HISTORY-INDEPENDENT, SP-ACTUAL-OWNER-NAVROLE, SP-ASSIGNED-READONLY, SP-GUEST-PRIVATE-DENY.

**OFF behavior:** Family OFF uses corrected legacy composition; existing independent history routes remain readable and money safety never depends on family flag..

<a id="sp-t14"></a>

### SP-T14

**Evidence findings:** SP-F19. **Logical WP:** O20. **Class:** C. **Source task prerequisites:** SP-T06, SP-T08, SP-T12, SP-T13.

**Proposed source files (canonical allocation takes precedence):** `app\app\sports\[activity].tsx`; `app\app\sports\index.tsx`; `app\app\sports\bookings.tsx`; `app\src\features\sports\SportsVenueBookingScreen.tsx`; `app\src\features\sports\__tests__\homePresentation.test.ts`.

**Function scope:** `No new domain capability`.

**Required edits:**

1. Consume O08's stable explicit sports ListingCard presentation for full title, full from-per-slot price and compact real metadata; no shared default edit in this task.
2. Use one hero/expandable gallery and move resource/date/slot choice immediately after compact identity; retain existing sticky footer.
3. Adapt activity grid and booking time-range hierarchy with only supplied fields; do not invent rating/live availability/location in booking reads.
4. Opt in through oorva_sports_ux AND oorva_brand; coordinator registration contract is default false, label Oorva sports presentation, group Oorva presentation, sort_order140, OFF text Existing corrected sports presentation is retained.

**Acceptance:**

- All owned public placement rows are reflected in actual rendering; long titles/INR amounts remain accessible at narrow/large-text sizes.
- Twelve-photo fixture does not bury choice in new composition; legacy is explicitly selected with family or brand parent OFF.
- No action, server amount, booking idempotency, parent permission or refund formula differs by cosmetic presentation.

**Tests (requirements, NOT RUN):**

- sports\__tests__\homePresentation.test.ts and bookingCardPresentation.test.ts: SP-FAMILY-PARENT-OFF, SP-FULL-TITLE-PRICE.
- e2e\web-smoke.mjs sports journey: capture matching actual before/after states for selection/detail; archived frames are not an after/PASS.

**OFF behavior:** Corrected existing composition remains; class-A fixes and existing record resolution always apply..

<a id="sp-t15"></a>

### SP-T15

**Evidence findings:** SP-F07. **Logical WP:** O29. **Class:** C. **Source task prerequisites:** SP-T04, SP-T08, SP-T09.

**Proposed source files (canonical allocation takes precedence):** `app\src\features\sports\manage\SportsVenueManagementScreen.tsx`; `app\src\features\sports\manage\BookingSections.tsx`; `app\src\features\sports\manage\types.ts`; `app\src\features\sports\model.ts`; `app\src\features\sports\manage\__tests__\managementState.test.ts`.

**Function scope:** `Existing all-authorized-business-rows projection retained`.

**Required edits:**

1. Compose owner pending requests directly below selector/status, then current/upcoming/history; move editors to secondary sections.
2. Use actual ends_at/starts_at/status to group current work and retain every returned history row by PK; do not assign a new booking status.
3. Keep read-only assigned selection and actual sports-OFF existing rows intact; consume the same family presentation switch.

**Acceptance:**

- Actionable requests precede configuration; started accepted and each terminal state remain reachable.
- Future hold is labeled due/held rather than confirmed; no invalid action appears in history or staff mode.
- Class-C OFF retains corrected legacy ordering while class-A truth/accessibility remain.

**Tests (requirements, NOT RUN):**

- manage\__tests__\managementState.test.ts: SP-REQUEST-FIRST, SP-CURRENT-AND-HISTORY-ALL-STATUSES, SP-OWNER-STAFF-PARITY.

**OFF behavior:** Presentation rolls back without gating existing read/payment/cancel/refund/expiry..

<a id="sp-t16"></a>

### SP-T16

**Evidence findings:** SP-F19. **Logical WP:** O31. **Class:** C. **Source task prerequisites:** SP-T02, SP-T09.

**Proposed source files (canonical allocation takes precedence):** `app\app\admin\sports.tsx`; `app\src\features\sports\__tests__\venueReviewPresentation.test.ts`.

**Function scope:** `No change to repaired review permissions`.

**Required edits:**

1. After O09 handoff, compose a submitted review queue with current-state filters/counts and secondary activities section.
2. Preserve repaired review/restore predicates, reason/confirmation, server ordering and inline mutation/read errors.
3. Use coordinator-owned family presentation selection; do not reintroduce redundant Verify for a visually uniform card.

**Acceptance:**

- Submitted review first, other states/restoration reachable; no same-state action in any filter.
- Parent-OFF notice remains truthful; family-OFF uses corrected old composition; unauthorized direct RPC remains denied.

**Tests (requirements, NOT RUN):**

- sports\__tests__\venueReviewPresentation.test.ts: SP-QUEUE-FILTER-COUNTS, SP-RESTORE-NOT-VERIFY, SP-ADMIN-FAMILY-OFF.

**OFF behavior:** Layout reverts, state guards and correct labels do not..

<a id="sp-t17"></a>

### SP-T17

**Evidence findings:** SP-F20. **Logical WP:** O29. **Class:** A. **Source task prerequisites:** SP-T03.

**Proposed source files (canonical allocation takes precedence):** `app\src\features\sports\manage\actions.ts`; `app\src\features\sports\manage\ResourceScheduleSections.tsx`; `app\src\features\sports\manage\__tests__\actions.test.ts`.

**Function scope:** `Existing set_sports_hours/delete_sports_price_rule/remove_sports_block only`.

**Required edits:**

1. Use existing useConfirm via the management action boundary for closing a day, deleting price rule and removing block; include exact context in each prompt.
2. Move inline Set closed write into the shared action path; update closed state only after confirmed successful server write or canonical reload.
3. Keep busy/error/finally/reload behavior consistent and prevent duplicate confirms/writes.

**Acceptance:**

- Cancel all three prompts -> zero writes; confirm -> one exact venue/day or UUID action.
- Failed write keeps prior truth and visible error; busy suppresses duplicate calls; existing owner-only SQL still denies nonowners.
- No confirmation depends on Oorva family flag; existing cancellation/refund policy untouched.

**Tests (requirements, NOT RUN):**

- manage\__tests__\actions.test.ts: SP-CLOSE-DAY-CONFIRM, SP-DELETE-PRICE-CONFIRM, SP-REMOVE-BLOCK-CONFIRM, SP-CONFIRM-FAILURE.

**OFF behavior:** Safeguards apply in both presentations; actual sports-OFF maintenance denial preserved..
