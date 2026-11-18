# Nearo audit appendix WS5 — Creators & freelancer projects

> Part of [docs/15](../15-Nearo-Functional-Audit-Report.md). Code-based audit of `main` @ `bfa999f` (2026-11-18), produced by a read-only audit agent and spot-checked by the lead auditor (see doc 15 §1.3 for verified claims and corrections). Status vocabulary and severity scale: doc 15 §1.2. Nothing in this file was tested on a real device or with real users.


Repo: `` @ `bfa999f` (read-only). Auditor: WS5 sub-agent. Date: 2026-11-18.

## Scope & method

**In scope:** creator/freelancer onboarding (service, profile attributes, portfolio, links, packages), the 19 `proposal`-archetype categories in the `creators`, `photo-video` and `weddings-events` verticals, the customer brief (`app/app/request/new.tsx` → `create_service_request`), routing, proposals (`proposal/compose/[requestId].tsx`, `ProviderProposalInbox.tsx`, `proposal/[id].tsx`, `send_proposal`, `accept_proposal`), the payment schedule (`PaymentScheduleTimeline.tsx`, `payment_schedule`, `process_proposal_milestones`), start, delivery (`proposal-delivery/[id].tsx`, `begin_delivery`, `submit_delivery`, `accept_delivery`), revisions (`request_revision`, flag `creator_revisions`), completion/auto-confirm, payout/commission, cancellation, disputes and reviews.

**Method**
1. Read every app screen and API wrapper listed above. API wrappers are in `app/src/lib/supabaseApi.ts:200-326`.
2. Traced each RPC to its **latest** `create or replace` across the 58 migrations:
   - `create_service_request` → 0040:21
   - `route_service_request` → 0040:396
   - `send_proposal` → 0052:1077
   - `withdraw_proposal` → 0052:1209
   - `accept_proposal` → 0040:247
   - `send_request_message` → 0052:1225
   - `start_proposal_booking` → 0023:800
   - `begin_delivery` → 0023:838
   - `submit_delivery` → 0044:103
   - `accept_delivery` → 0023:896
   - `request_revision` → 0044:57
   - `request_completion` and `confirm_completion` → 0023:1150 and 0023:1178
   - `process_proposal_milestones` → 0023:1264
   - `expire_proposal_flows` → 0030:347
   - `auto_confirm_completions` → 0030:405
   - `cancel_proposal_payment_default` → 0030:703
   - `_cancel_booking_by_policy` → 0021:881
   - `dispute_booking` and `resolve_dispute` → 0021:988 and 0021:1016
   - `_finalize_completion` → 0014:642
   - `_create_payout` → 0016:67
   - `_commission_bp` → 0043:14 and 0043:48
3. Compared the code with the decided product rules in `docs/07` (C5–C9, D1–D7) and `docs/09` (B1–B5).
4. Mapped automated evidence:
   - SQL tests `supabase/tests/proposal_booking.test.mjs`, `creator_revisions.test.mjs`, `creator_config.test.mjs` and `review_fixes.test.mjs`. All 82 registered checks passed in backend run **44358292571**.
   - E2E steps in `e2e/web-smoke.mjs` and `e2e/all-services.mjs`, main run **44365580570**. All WS5-relevant steps passed. None of the 7 failed steps is in WS5 scope.
   - Jest: `proposalStatus.test.ts`, `onboarding.test.ts:317` and `providerInsights.test.ts:53`.
5. Nothing was executed. No app, Supabase or payment calls were made. Every result below comes from code reading or from the CI evidence named.

**Limits**
- E2E runs on web against the DEMO project with demo payments. No real Razorpay flow was exercised.
- Statements marked "code trace" were verified by reading source, not by a test.
- Persona walkthroughs are code-based only. No real users were involved.

## Feature matrix

| ID | Feature | Role | Status | Evidence | Notes |
|---|---|---|---|---|---|
| WS5-F01 | 19 creator, photo/video and wedding/event categories live as `proposal` archetype | Admin/Customer | PASS | `proposal_booking.test.mjs` "0024 activates creator/event categories in the launch city (idempotent)"; E2E `category-reel-maker`, `category-ugc-creator`, `category-youtube-creator`, `category-wedding-photographer` and others (log 44365580570 l.753-771) | Archetype and vertical are set in 0018:56-80. `reel-maker` is `location_modes = ['remote']` (0018:78) |
| WS5-F02 | Creator adds a creator service (reel-maker) | Creator | PASS | E2E `proposal-flow-pro-offers-reel-maker` (calls the `provider-service` function directly, not the UI) | The wizard UI is covered for a generic pro by the `new-pro-*` steps |
| WS5-F03 | Category profile attributes (styles, equipment, software, turnaround) | Creator | PARTIAL | `creator_config.test.mjs` "all requested creator/event categories are present" | Schemas seeded at 0017:20-120. Customer-side rendering and use in matching: UNTESTED |
| WS5-F04 | Portfolio photo upload (Storage bucket `portfolio`) | Creator | PASS | E2E `new-pro-portfolio` | Images only (`media.ts:36`; bucket mime list 0009:1466). Max 12 photos. Optional for go-live (0009:389 `required false`) |
| WS5-F05 | Portfolio video samples | Creator | NOT IMPLEMENTED | `media.ts:36` `mediaTypes: ['images']` | doc 09 B3 requires ≥6 sample videos for UGC/reel makers. Only links are possible today |
| WS5-F06 | Portfolio and social links with host validation | Creator | PASS | `review_fixes.test.mjs:306` "an Instagram link must point at instagram.com" | Links auto-approved by 0028 |
| WS5-F07 | Packages (deliverables, turnaround, revisions, raw files, usage rights) | Creator | PASS | `creator_config.test.mjs` "provider save RPC creates a package" and "fixed, range, from and quote package shapes are accepted"; Jest `onboarding.test.ts:317` | Editor at `ProviderPackageEditor.tsx:57-134` |
| WS5-F08 | Package terms carried into brief or proposal | Customer/Creator | NOT IMPLEMENTED | `ArchetypeCategory.tsx:53` passes `package`; `request/new.tsx:12-17` never reads it; compose has no package prefill | doc 09 B2 requires the package fields to be "copied into the proposal … (immutable snapshot)" |
| WS5-F09 | Customer brief (free text, date, venue, budget), targeted and open | Customer | PASS | E2E `proposal-flow-customer-sends-brief` (targeted); SQL "untargeted requests still route to all eligible providers", "targeted request reaches only the chosen provider" | One free-text box, minimum 10 characters (`request/new.tsx:38`) |
| WS5-F10 | Structured requirements from `categories.intake_schema` | Customer | NOT IMPLEMENTED | `request/new.tsx:45` sends only `{ brief }`; `SchemaForm` is used only by `PackageBookingScreen.tsx:80` | Masking of `x-private` fields is tested (SQL "private intake fields are masked from provider projection"), but no creator category defines an intake schema |
| WS5-F11 | Budget | Customer | PASS | E2E `proposal-flow-customer-sends-brief` fills "Approximate maximum (₹)" | The client invents `budget_min = 0.8 × max` (`request/new.tsx:46-47`) |
| WS5-F12 | Delivery deadline / turnaround in brief or proposal | Both | NOT IMPLEMENTED | No field in `request/new.tsx`, `compose/[requestId].tsx`, `proposals` or `service_requests` (0023:53-118) | "Event date" is the only date |
| WS5-F13 | Urgent requests (≥2 h notice) | Customer | PASS | `review_fixes.test.mjs:465` "an urgent proposal is booked and confirmed" | Flag `urgent_requests` (`request/new.tsx:84`) |
| WS5-F14 | Routing to ≤8 eligible pros; pre-payment privacy | System | PASS | SQL "routed provider sees request projection", "provider cannot read exact venue before advance", "competing provider cannot read raw request table", "selected provider reads venue only after advance is paid" | Routing is by city or radius even for `remote` categories (0040:431-437) |
| WS5-F15 | Provider proposal inbox (pending / sent / withdraw / resend) | Creator | UNTESTED | `ProviderProposalInbox.tsx` | E2E reads `service_request_provider_view` over REST, not through this screen |
| WS5-F16 | Proposal compose UI | Creator | UNTESTED | `proposal/compose/[requestId].tsx` | E2E `proposal-flow-pro-sends-proposal` calls the `send_proposal` RPC directly |
| WS5-F17 | `send_proposal` server rules (items, milestones sum to total, validity cap, notice) | Creator | PASS | `proposal_booking.test.mjs` runtime (send→accept); `review_fixes.test.mjs:392` (0037 validity cap) | No advance cap and no contact screening (see findings WS5-12 and WS5-13) |
| WS5-F18 | Withdraw / resend proposal | Creator | UNTESTED | `withdraw_proposal` 0052:1209; inbox buttons at `ProviderProposalInbox.tsx:118-122` | — |
| WS5-F19 | Pre-booking Q&A thread (`request_messages`) | Both | NOT IMPLEMENTED (UI) | RPC at 0052:1225 and wrapper at `supabaseApi.ts:283-292`; no screen calls them | `request/[id].tsx:47` tells customers "In-app questions appear in each proposal thread", which is false |
| WS5-F20 | Customer cancels an open request | Customer | NOT IMPLEMENTED (UI) | `cancel_service_request` 0023:451 and wrapper `supabaseApi.ts:218`; not used by any screen | — |
| WS5-F21 | Compare proposals and view proposal detail | Customer | PASS | E2E `proposal-flow-customer-compares`; `all-services` `archetype-proposal-deliverables-and-milestones` | Detail shows no revisions, turnaround, usage rights, cancellation terms or platform-fee amount |
| WS5-F22 | Accept proposal (30-minute hold, idempotent) | Customer | PASS | SQL "accept creates one held pending-payment booking", "repeated accept is idempotent", "proposal snapshots cannot be changed"; E2E `proposal-flow-accept-and-checkout` | Requires a saved address even for remote work (0040:297-308) |
| WS5-F23 | Advance + platform fee payment confirms the booking | Customer | DEMO ONLY | SQL "one combined payment settles both obligations and confirms the booking; the delivery milestone stays upcoming"; E2E `proposal-flow-accept-and-checkout` (demo payments) | Real gateway not exercised. doc 07 B2 forbids live money until a CA signs the tax matrix |
| WS5-F24 | Hold expiry reopens request and proposals | System | PASS | SQL "expired 30 minute hold reopens request", "expired hold reopens valid proposals" | — |
| WS5-F25 | Payment timeline display | Customer | PASS | E2E `all-services` `archetype-proposal-deliverables-and-milestones` (sees "Demo booking advance", "Demo delivery milestone") | Displays `due_rule` raw ("on delivery") |
| WS5-F26 | Milestone due promotion and reminders (`process_proposal_milestones`, cron every 15 min, 0023:1533) | System | UNTESTED | 0023:1264 | Only date-based rules are promoted. `on_delivery` and `on_completion` rows become due in `submit_delivery` / `request_completion` without `reminded_at` |
| WS5-F27 | Start code for proposal bookings | Both | UNTESTED | `start_proposal_booking` 0023:800; `get_booking_otps` 0039 | Start allowed only on the event day (0023:810-814) |
| WS5-F28 | Begin and submit delivery (links) | Creator | PARTIAL | `creator_revisions.test.mjs:183` (resubmission after revision returns to `completion_requested`/`submitted`) | First-submission path and `proposal-delivery/[id].tsx` UI: UNTESTED. UI sends one link only |
| WS5-F29 | Customer sees delivered work in app | Customer | NOT IMPLEMENTED | `delivery_links` appears only in `types.ts:203`; never rendered | Customer is asked to pay and "Accept delivery" without seeing anything |
| WS5-F30 | Revisions (count, request, resubmit) | Both | PARTIAL | `creator_revisions.test.mjs`: "creator revisions are registered disabled by default", "request_revision refuses clearly while the feature flag is off", "the booking customer can request a revision", "the default allowance of two revisions blocks a third request" | Server side PASS. The creator cannot set the count. The customer never sees it before accepting. UI UNTESTED. Flag OFF by default (0044:1-6) |
| WS5-F31 | Accept delivery → complete | Customer | UNTESTED | `accept_delivery` 0023:896; SQL test only regex-checks the error string ("deliverable guard") | — |
| WS5-F32 | Auto-accept after 7 days | System | UNTESTED | 0030:414-419 | Fires only if every milestone is paid (see finding WS5-01) |
| WS5-F33 | Payout and commission for proposal bookings | System | FAIL (code trace) | Quote created without subtotals (0040:349); `_finalize_completion` commission base = `subtotal_labour + subtotal_travel` (0014:658-660) | Commission resolves to 0 on every proposal booking. Contradicts doc 07 D1 (8%, cap ₹5,000). No test covers it |
| WS5-F34 | Policy cancellation of a proposal booking | Both | PASS | SQL "provider-fault cancellation refunds the combined payment with the fee split out" | Customer UI offers cancel only in `pending_payment` (`booking/[id].tsx` `cancelAction`) |
| WS5-F35 | Provider payment-default cancellation | Creator | PARTIAL | `cancel_proposal_payment_default` 0030:703 | Allowed only in `confirmed`/`in_progress`. No app UI. UNTESTED |
| WS5-F36 | Customer dispute | Customer | PARTIAL | `dispute_booking` 0021:988 | Blocked in `delivery_pending` (server and UI `booking/[id].tsx:450`). Dispute window effectively 24 h after completion |
| WS5-F37 | Review after completion with creator review tags | Customer | UNTESTED (for proposal bookings) | `booking/[id].tsx:575-577`; tags seeded at 0017 | — |

## Findings

| ID | Title | Type | Severity | Gate | Evidence | Recommendation |
|---|---|---|---|---|---|---|
| WS5-01 | A customer can keep the delivered work and never pay the balance. The booking stays in `completion_requested` forever and the creator's advance is never released. | Technical defect / Business logic | P0 | Before accepting real payments | `submit_delivery` 0044:126-139 marks `on_delivery` due but sets no `reminded_at`. `auto_confirm_completions` 0030:416-419 requires every schedule row paid. `accept_delivery` 0023:908-910 requires all paid. `cancel_proposal_payment_default` 0030:713-720 allows only `confirmed`/`in_progress` and needs `reminded_at`. `dispute_booking` is customer-only (0021:998). `_finalize_completion` (and therefore the payout) only runs at completion (0014:658). | Add a provider "payment default after delivery" path: `completion_requested` + `on_delivery`/`on_completion` row due for more than 48 h → policy settlement that pays the creator the paid principal and closes the booking. Set `reminded_at` and notify when final milestones become due. Hide delivery links until the final milestone is paid, or release a watermarked preview first. |
| WS5-02 | If the creator never delivers, the customer has no exit. `delivery_pending` cannot be disputed or cancelled and has no deadline. A requested revision also returns the booking to `delivery_pending`. | Technical defect | P0 | Before accepting real payments | `dispute_booking` allowed states (0021:999-1002) exclude `delivery_pending`, although `archetype_transitions` allows it (0030:561). `_cancel_booking_by_policy` allowed states (0021:897-903) exclude `delivery_pending`. UI `canReport` (`booking/[id].tsx:450`) excludes it. `request_revision` → `delivery_pending` (0044:88). No deadline column exists. | Allow `dispute_booking` from `delivery_pending`. Add `delivery_due_at` (see WS5-T07). Allow customer cancellation with `provider_fault` once `delivery_due_at` plus grace has passed. |
| WS5-03 | No platform commission is taken on proposal bookings. Creator payouts equal the gross amount, contradicting doc 07 D1. | Technical defect (financial) | P0 | Before accepting real payments | `accept_proposal` inserts `quotes(booking_id, version, status, is_change_order, total, note)` with no subtotals (0040:349-351). The `subtotal_labour` default is 0 (0001:178). `_finalize_completion` calls `_create_payout(b.id, greatest(q.total, visit_fee), q.subtotal_labour + q.subtotal_travel, …)` (0014:658-660). `_create_payout` computes commission = commissionable × bp (0016:89). `_commission_bp` has no proposal rate or ₹5,000 cap (0043:14-46). Code trace, not tested. | Set the proposal quote subtotal (service value) in `accept_proposal`. Add an admin-configurable proposal rate and cap to `app_config.commission`. Add a SQL test that asserts `payouts.commission` for a completed proposal booking. |
| WS5-04 | The customer cannot see the delivered links anywhere in the app, yet is asked to pay the balance and tap "Accept delivery". | Technical defect / UX | P1 | Before pilot | `delivery_links` is referenced only in `app/src/lib/types.ts:203`. `booking/[id].tsx` renders no delivery section. The footer "Accept delivery" is at `booking/[id].tsx:362-366`. | Add a "Delivered work" section listing `delivery_links` (title, https link via `Linking.openURL`) for both parties, plus the submission time. |
| WS5-05 | Wrong status copy and actions after delivery. The customer sees "marked the job done… share completion code" and "Auto-confirms 24 hours". The provider sees a completion-code input although `submit_delivery` never generates an end code. | UX / Technical defect | P1 | Before pilot | Customer hero at `booking/[id].tsx:880-881`. OTP hint at `booking/[id].tsx:511`. Provider hero at `booking/[id].tsx:922-923` and the OTP card at ~:579 for `completion_requested`. `submit_delivery` (0044:103-140) never sets `end_otp`, unlike `request_completion` (0023:1167). `complete_booking` treats a null `end_otp` as invalid and burns attempts (0023:1205-1210). The server window is 168 h and only applies if fully paid (0030:414-419). | When `archetype='proposal'` and `delivery_status='submitted'`: hide both OTP cards, use the copy "Review the delivery, pay the final milestone, then accept or request changes", and state "auto-accepted 7 days after delivery once paid". |
| WS5-06 | The revision count is never agreed. The creator cannot set it, the customer cannot see it before accepting, the DB default is 2 (doc 07 D7 decided 1), and with the default-OFF flag there are no revisions at all. | Business logic | P1 | Before pilot | The trigger reads `delivery_snapshot` items with `type='revisions'` (0044:24-45). Compose never sends one (`compose/[requestId].tsx:33`). Default 2 at 0044:9. Package `revisions_included` (`ProviderPackageEditor.tsx:58`) is not carried over. `proposal/[id].tsx` does not show it. Flag OFF at 0044:1-6. | Add a required "Revisions included" field to compose (0–3). Send it as a deliverable `{type:'revisions', qty:n, spec:'Revision rounds'}`. Show it on the proposal and booking. Align the default with D7 (1) in config, not code. |
| WS5-07 | Package terms (deliverables, turnaround, revisions, raw files, usage rights) are lost between package and booking. The `package` route param is ignored. | Business logic | P1 | Before pilot | `ArchetypeCategory.tsx:53` passes `package: item.package.id`. `request/new.tsx:12-17` reads only `categoryId, name, providerId, providerName`. doc 09 B2 requires the snapshot copy. | Carry `packageId` into `intake.package_id`, show the package summary on the brief and prefill compose from it. |
| WS5-08 | Remote freelance work is forced into the event/visit model: a single "Event date" fixed at 10:00 IST + 4 h, start allowed only on that date with an in-person-style start code, and no deadline. | Business logic | P1 | Before pilot | `request/new.tsx:39-40` (`T10:00:00+05:30`, +4 h). `start_proposal_booking` window `scheduled_at::date = current_date` (0023:810-814). The availability block uses that 4 h window (0040:445-451). `location_modes=['remote']` is set for creators (0018:78) but unused here. | For `location_modes = ['remote']` categories: label the date "Deliver by", let the creator start from confirmation (skip the start code or allow it from `confirmed` at any time) and do not block the calendar slot. |
| WS5-09 | Remote creators are still geofenced and an address is required. Customers outside the creator's city or radius cannot hire them, and accepting fails without a saved address. | Business logic / Unvalidated business assumption | P2 | Before scaling | `create_service_request` requires venue or address (0040:51). Routing uses city or radius (0040:436-440). `accept_proposal` raises 'address is required for booking' (0040:308). doc 07 C5: "`remote` has no address". | For remote categories, skip the radius filter (keep the city optional), skip the address requirement, and record `location_mode='remote'`. |
| WS5-10 | The brief is one free-text box (min 10 characters) with no structure for count, length, format, references, raw-footage handover or deadline. Scope disputes are likely. | UX / Business logic | P1 | Before pilot | `request/new.tsx:38,45,72`. `intake_schema` is unused for creator categories (F10). | Define an `intake_schema` per creator category (e.g. reel-maker: `count`, `length_seconds`, `aspect_ratio`, `captions`, `music`, `reference_links`, `footage_handover`, `deliver_by`) and render it with the existing `SchemaForm`. |
| WS5-11 | No pre-booking Q&A UI and no way to cancel a request, although both RPCs exist. The UI promises a Q&A thread that does not exist. | UX | P2 | Before pilot | `request/[id].tsx:47` copy. `send_request_message` 0052:1225 and `cancel_service_request` 0023:451 are not called from any screen. | Add a per-proposal question thread on `proposal/[id].tsx` and the provider inbox, plus a "Cancel request" action on `request/[id].tsx`. |
| WS5-12 | The compose screen hides the brief, budget and date from the creator, supports one line item only, defaults to a 30% advance, and the server has no advance cap (doc 07 D3: "Advance capped at 25%"). | UX / Business logic | P2 | Before pilot | `compose/[requestId].tsx:13,27,51-61`. `send_proposal` 0052:1160-1176 has no advance-share check. | Show a brief summary card. Default the advance to the configured cap. Enforce the cap server-side from config. |
| WS5-13 | No off-platform contact screening on the brief, proposal terms, deliverables or delivery titles, although packages are screened. | Business logic | P2 | Before pilot | `create_service_request` (0040:21-85) and `send_proposal` (0052) do not call `_contains_contact_hint` (0016:110). Packages: `ProviderPackageEditor.tsx:92` and Jest `onboarding.test.ts:317`. | Reject or mask contact hints server-side in `create_service_request.intake.brief`, `send_proposal.p_note`, item titles, deliverable specs and `submit_delivery` titles. |
| WS5-14 | The dispute and payout-hold window is 24 h after completion. doc 07 D7 decided 7 days for deliverable categories. There are no day-3/day-6 acceptance reminders, and `deliverable_acceptance_hours` is unused (hard-coded 168). | Business logic | P2 | Before accepting real payments | Release at +24 h (0014:659). Column at 0023:16, unused. Hard-coded 168 at 0030:414. No reminder job (cron list: 0023:1532-1533). | Use `categories.deliverable_acceptance_hours` for auto-accept, set payout `release_after` = completion + configured dispute window for proposal deliverables, and add reminder notifications. |
| WS5-15 | The platform fee amount is not shown before "Accept & reserve", and the fee rule is hard-coded rather than admin-configurable (repo rule 2). | UX / Business logic | P2 | Before accepting real payments | Button shows `proposal.total` only (`proposal/[id].tsx:50`). Fee `least(49900, greatest(9900, round(total*0.01)))` hard-coded at 0040:321. | Show "Total ₹X + platform fee ₹Y = ₹Z" on the proposal. Move the fee rule into `app_config`. |
| WS5-16 | Misleading broadcast copy: "Post your brief anyway. New pros joining your city will see it." and "Request sent to matching providers" even when 0 pros were routed. | UX | P2 | Before pilot | `ArchetypeCategory.tsx:111`. Routing happens only in `create_service_request` (0040:77). Zero recipients are allowed for open requests (0040:78-81). Toast at `request/new.tsx:56-60`. | Return the routed count and say "No pros available yet. We'll keep your brief for 7 days" only if re-routing is implemented. Otherwise say no pros were found. |
| WS5-17 | A customer can cancel by RPC after receiving the delivery (in `completion_requested`) and avoid the unpaid balance. | Technical defect | P1 | Before accepting real payments | `_cancel_booking_by_policy` allows `completion_requested` (0021:897-903). The `event_moderate` "inside_seven_days" rule refunds 0 but forfeits the unpaid balance (0021:200-202). The UI hides it but the RPC is callable by the customer (`cancel_booking` 0021:942). | Block customer cancellation once `delivery_status` is `submitted` or `accepted`. Disputes become the only path. |
| WS5-18 | The delivery UI accepts one link while the server allows 20. Ten reels means one folder link, so per-item acceptance is impossible. | UX | P2 | Before pilot | `proposal-delivery/[id].tsx:18`. 0044:117-118. | Allow adding up to 20 titled links. |
| WS5-19 | Creators get nothing until final acceptance (advance held), and portfolio video is unsupported. Whether creators accept this is unknown. | Unvalidated business assumption | P2 | Before scaling | Payout created only in `_finalize_completion` (0014:658). Image-only portfolio (`media.ts:36`). | NEEDS REAL USER VALIDATION with 5–10 local editors and photographers. Consider releasing the advance at start (doc 07 l.147 prerequisites). |
| WS5-20 | No automated test covers start → begin_delivery → submit → accept_delivery → payout. The compose, inbox and delivery UIs are untested. | Technical defect (test gap) | P1 | Before pilot | `proposal_booking.test.mjs` stops at confirmation. E2E sends the proposal by RPC (`web-smoke.mjs:296-309`). | See regression tests below. |
| WS5-21 | Raw keys are displayed to customers ("final_delivery", "on delivery"), and the compose numeric validation lets NaN through (e.g. "12,000"). The server rejects it, but with a generic error. | UX | P3 | Later | `proposal/[id].tsx:82,88`. `compose/[requestId].tsx:24-26` (`NaN <= 0` is false). | Map types and rules to labels. Validate with `Number.isFinite`. |

## Persona walkthroughs (code-based, not real-user tested)

### P1 — Customer hiring a video editor to edit ten reels

1. **Find the service.** Home → Creators → "Reel Maker / Editor" lands on `ProposalCategory` (`ArchetypeCategory.tsx:69-128`). It shows nearby pros and "Get proposals from several pros". The creator's packages (with turnaround and revisions) are visible on the pro profile (`provider/[id].tsx:380`) but cannot be chosen into the request (WS5-07).
2. **Write the brief.** `request/new.tsx` offers:
   - one "What do you need?" box;
   - "Event date" as typed `YYYY-MM-DD`;
   - a mandatory "Venue / area";
   - "Approximate maximum (₹)".

   Nothing asks for the number of reels, length, aspect ratio, captions or music, how raw footage will be shared, or the deadline. The customer must guess that "Event date" means "deliver by", and must type a venue for remote work. The date must be ≥24 h away (`min_lead_hours` 24, 0018:121-131).
3. **Routing.** The brief goes to up to 8 verified reel makers in the city or radius who are free 10:00–14:00 IST that day (0040:396-460). If none are found, the toast still says "Request sent to matching providers".
4. **Wait and compare.** `request/[id].tsx` lists name, total, number of payments and validity. The "In-app questions" mentioned there do not exist. The proposal detail shows the total, terms text, one line item, milestones ("Booking advance", "Delivery balance / on delivery") and a raw "final_delivery — …" deliverable. It shows no revision count, no delivery date, no usage rights, no cancellation terms and no platform-fee amount.
5. **Accept.** "Accept & reserve · ₹X" creates a 30-minute hold. Without a saved address it fails with "Choose a saved address for the venue…" (`proposal/[id].tsx:39-41`). Paying the advance plus fee confirms the booking (SQL test, DEMO ONLY).
6. **Start.** Hero: "Share code NNNN with the editor when the work starts." The editor can only enter it on the "event date" (0023:810-814). For ten reels with a deadline, the editor effectively cannot formally start until the deadline day.
7. **Work in progress.** The editor taps "Begin deliverables" (`delivery_pending`). From here the customer cannot report a problem (`booking/[id].tsx:450`; 0021:999-1002).
8. **Delivery.** The editor submits one https link. The customer sees the hero "Editor marked the job done — share your completion code", a completion-code card with no code and the text "Auto-confirms 24 hours", "Pay ₹balance", and "Accept delivery". **The link itself is not shown anywhere** (WS5-04). If `creator_revisions` is ON, "Request changes (2 left)" appears; if OFF (the default), there is no change request at all.
9. **Complete.** Pay the balance → Accept delivery → `completed` → review form with creator tags. The payout is released 24 h later (WS5-14), with 0 commission (WS5-03).

**Where it breaks:** unclear scope and deadline, blind acceptance, no revision terms, no dispute while waiting for delivery.

### P2 — Freelance video editor (brief → quote → deliver → paid)

1. **Onboard.** The wizard covers basics, services, area, hours, portfolio and payouts (E2E `new-pro-*`). The portfolio accepts photos only, so the editor must add YouTube, Instagram or Behance links (`PortfolioSection.tsx:172-205`). The editor can create a package with turnaround, revisions and usage rights (`ProviderPackageEditor.tsx`), but customers' proposal requests never reference it.
2. **Receive the brief.** The inbox card shows category, area, date and the brief text (`ProviderProposalInbox.tsx:85-101`). Budget is not shown on the card.
3. **Quote.** "Send proposal" opens the compose screen. The **brief is not visible there**. Fields:
   - one "Package / scope" title;
   - "Fixed total (₹)";
   - "Terms" (free text);
   - "Advance (%)" (default 30);
   - optional "What will be delivered?".

   There is no delivery date, no revision count, no line-per-reel option and no usage rights. Proposal validity is fixed at 7 days and capped to the request. Commission and net earnings are not shown.
4. **Booked.** The editor is notified "You have a confirmed booking" (0023 webhook path) and must get the start code from the customer on the event date.
5. **Deliver.** "Begin deliverables" → "Submit delivery" (one link). After submitting, the editor sees "Enter the completion code", which can never work for this path (no end code generated). The editor's only option is to wait.
6. **Get paid.** The editor is paid only when the customer pays the balance and accepts, or 7 days after delivery **if** everything was paid. If the customer never pays the balance, there is no default, no dispute and no auto-accept: the advance stays held indefinitely (WS5-01). The revision note (if enabled) is shown in a card (`booking/[id].tsx:604-609`); the revision limit was never agreed.

## Form field audit

### Customer brief — `app/app/request/new.tsx`

| Field | Control | Required | Client validation | Server validation (0040 `create_service_request`) | Issues |
|---|---|---|---|---|---|
| What do you need? (`intake.brief`) | TextArea | Yes | trimmed length ≥10 (`:38`) | Must be a JSON object; no length limit, no contact screening | Unstructured. No max length. Placeholder says "event, style and deliverables" (event-centric). Should become schema fields (WS5-10) |
| When (date / urgent) | SegmentedControl | Yes | — | — | "Urgent" is offered only behind a flag |
| Event date | Input "YYYY-MM-DD" | Yes | `new Date(...)` must parse | `event_start ≥ now + min_lead_hours` (24 h); ≤365 days | Free-typed date, no picker. Time forced to 10:00 IST and end forced to +4 h (`:39-40`). Wrong meaning for remote work: should be "Deliver by" |
| Urgent start time | Chips | If urgent | must pick | ≥2 h (0040:41-43) | Not meaningful for remote editing |
| Venue / area | Input | Effectively (falls back to `location.area`) | none | venue or address required (0040:51) | Irrelevant for remote work; forces a fake value |
| Approximate maximum (₹) | Input number-pad | No | none (NaN possible on web) | `budget_min ≤ budget_max` | `budget_min` is invented as 80% of max (`:46`). Copy "You never pay a range" is correct |
| Hidden: city | — | — | falls back to the literal `'Vijayawada'` (`:43`) | city required | Hard-coded fallback city |
| Missing | — | — | — | — | Count of items (10 reels), duration per item, aspect ratio, captions, music licensing, reference links, footage handover method, deadline, revisions expected, usage (organic / ads), package chosen |

**Simplification proposal:** for remote creator categories, use 5 inputs:
1. What (choose a package or "Custom");
2. Quantity;
3. Deliver by (date picker);
4. Reference links (optional);
5. Budget.

Drop venue and urgent for remote categories.

### Proposal compose — `app/app/proposal/compose/[requestId].tsx`

| Field | Sent as | Required | Client validation | Server validation (0052 `send_proposal`) | Issues |
|---|---|---|---|---|---|
| Package / scope | `items[0].title`, `kind:'package'`, qty 1, unit `job` | Yes | non-empty (`:23`) | 1–160 characters (table check 0023:124) | One line only. Cannot itemise "10 × reel @ ₹1,200" |
| Fixed total (₹) | `items[0].unit_price` (paise) | Yes | `amount > 0` (NaN slips through, `:24-26`) | 0 ≤ price ≤ ₹10,00,000 | Net-of-commission earnings not shown |
| Terms | `p_note` | No | none | ≤2000 characters | Free text holds all real terms (revisions, deadline, rights). No contact screening (WS5-13) |
| Advance (%) | schedule[0] `at_booking` | Yes (default 30) | 0 < advance < total | sum = total; no cap | Doc 07 D3 says cap 25%. Not enforced (WS5-12) |
| (derived) balance | schedule[1] `on_delivery` if deliverables text, else `on_completion` | — | — | rule whitelist | A hidden switch: typing deliverables changes the whole flow (delivery path vs OTP completion) without telling the creator |
| What will be delivered? | `deliverables:[{type:'final_delivery',qty:1,spec}]` | No ("Optional") | none | array | Optional. If empty, `delivery_status='not_applicable'` and no delivery step exists for a creator job (0040:342) |
| Valid until | fixed now + 7 days | — | — | capped to request expiry (0052:1124) | Not editable or visible |
| Missing | — | — | — | — | Delivery date / turnaround, revisions included, raw files, usage rights, per-item lines, what the customer must provide (footage, brand assets), feedback window, cancellation terms preview |

**Simplification proposal:** prefill from the creator's package. Show the brief at the top. Use 6 inputs:
1. Line items (qty × price);
2. Deliver by;
3. Revisions (0–3);
4. Usage rights (chips);
5. Advance % (capped);
6. Notes.

Show the creator's estimated net payout.

## Remediation tasks

Migrations must be applied in order. The next free number is `0059`. Migration tasks are serial in the merge queue. App-only tasks can run in parallel. Per repo instructions, every new capability needs a `feature_flags` key (default OFF), server enforcement and flag-off tests. Money-safety paths (WS5-T01/T02/T03) must stay ungated for in-flight bookings.

| ID | Objective | Files (exact paths) | Required change | Depends on | Acceptance criteria | Tests to add | Complexity | Parallelisable |
|---|---|---|---|---|---|---|---|---|
| WS5-T01 | Unblock unpaid balance after delivery (WS5-01, WS5-17) | `supabase/migrations/0059_proposal_delivery_safety.sql` (new); `supabase/tests/proposal_delivery.test.mjs` (new); `supabase/tests/package.json`; `app/src/lib/supabaseApi.ts`; `app/src/lib/apiTypes.ts`; `app/src/lib/demo/demoApi.ts`; `app/app/booking/[id].tsx` | See "WS5-T01 required change" below the table | — | Unpaid balance 48 h after delivery → provider can settle; booking leaves `completion_requested`; payout = paid principal minus commission; customer cancel after submission rejected | SQL: default allowed after 48 h; rejected before 48 h; rejected for customer; customer `cancel_booking` after submit rejected; payout created | M | No (migration) |
| WS5-T02 | Dispute/cancel while awaiting delivery; delivery deadline (WS5-02) | same 0059 file (or `0060_…`); `app/app/booking/[id].tsx`; `app/app/proposal/compose/[requestId].tsx` | See "WS5-T02 required change" below the table | T07 for `deliver_by` input | Customer can dispute in `delivery_pending`; overdue delivery → customer can cancel with full refund | SQL: dispute in `delivery_pending` succeeds and freezes payout; overdue cancel refunds 100%; not-overdue cancel rejected | M | No (migration) |
| WS5-T03 | Charge commission on proposal bookings (WS5-03) | `supabase/migrations/0061_proposal_commission.sql` (new); `supabase/tests/proposal_commission.test.mjs` (new); `supabase/tests/package.json` | See "WS5-T03 required change" below the table | — | A completed proposal booking with total ₹12,000 for a non-founding provider has `payouts.commission = 96000` paise (8%) and `gst_on_commission = 17280` | SQL: commission 8%; cap ₹5,000 at total ₹1,00,000; founding provider 0; repeat-client discount applies | M | No (migration) |
| WS5-T04 | Show delivered work (WS5-04, WS5-18) | `app/app/booking/[id].tsx`; `app/app/proposal-delivery/[id].tsx`; `app/src/lib/types.ts` | In `booking/[id].tsx`, after `PaymentScheduleTimeline`, when `booking.archetype==='proposal' && (booking.delivery_links?.length ?? 0) > 0`, render `<Section title="Delivered work">` with one `ListItem` per link (title, url host, `onPress={() => Linking.openURL(link.url)}`) and `delivery_submitted_at`. In `proposal-delivery/[id].tsx`, replace the single title/url pair with a list state `links: {title,url}[]` (max 20) with "Add link" and "Remove". Validate every url with `/^https:\/\/\S+$/`. | — | Customer sees each link before "Accept delivery"; provider can submit up to 20 links | Jest: delivery section renders links (component test); E2E: extend `proposal-flow-*` with submit + customer sees link | S | Yes |
| WS5-T05 | Correct post-delivery copy and actions (WS5-05) | `app/app/booking/[id].tsx` | Define `const deliveryReview = booking.archetype==='proposal' && booking.delivery_status==='submitted'`. (a) Do not render the customer `OtpCard` "Completion code" or the provider OTP card when `deliveryReview`. (b) In `heroCopy`, add param `deliveryReview`. For the customer in `completion_requested` with `deliveryReview`, use title "Review the delivery" and subtitle "Open the delivered work below, pay any final milestone, then accept. It is accepted automatically 7 days after delivery once fully paid." For the provider, use "Delivery sent" / "Waiting for the customer to review and pay the final milestone." (c) Do not render the provider footer "Verify completion code" when `deliveryReview`. | T04 | No completion-code UI on delivery bookings; copy matches server rules | Jest test for `heroCopy` (export it) for 4 cases | S | Yes |
| WS5-T06 | Agree revisions in the proposal (WS5-06) | `app/app/proposal/compose/[requestId].tsx`; `app/app/proposal/[id].tsx`; `supabase/migrations/0062_proposal_terms.sql` (new); `supabase/tests/creator_revisions.test.mjs` | Compose: add Input "Revisions included" (number-pad, 0–3, default from `app_config.creator.default_revisions`, fallback 1). Append `{type:'revisions', qty:n, spec:'Revision rounds'}` to `deliverables`. Proposal detail: render "Revisions included: n" and hide the `revisions` row from the deliverables list. Migration: in `send_proposal`, assert at most one `revisions` deliverable with qty 0–10. Change the `bookings.revisions_allowed` default to come from config (trigger sets `coalesce(snapshot qty, config default)`). Insert `app_config('creator', {"default_revisions":1})`. | — | The customer sees the revision count before paying; booking `revisions_allowed` equals the proposal value | SQL: proposal with revisions 1 → booking `revisions_allowed=1`; the second request is rejected; invalid qty 11 rejected | M | No (migration) |
| WS5-T07 | Deliver-by date for briefs and proposals (WS5-08, WS5-10) | `app/app/request/new.tsx`; `app/app/proposal/compose/[requestId].tsx`; `app/app/proposal/[id].tsx`; `supabase/migrations/0062_proposal_terms.sql` | See "WS5-T07 required change" below the table | — | A deliver-by date is visible to both sides and frozen into the booking | SQL: `delivery_due_at` copied; rejected when after `event_start + 365 d`; flag-off ignores | M | No (migration) |
| WS5-T08 | Structured creator brief (WS5-10) | `supabase/migrations/0063_creator_intake_schemas.sql` (new); `app/app/request/new.tsx`; `app/src/features/catalogue/SchemaForm.tsx` (reuse only) | See "WS5-T08 required change" below the table | T07 | A reel-maker brief captures count, length and aspect ratio; providers see them in the inbox | SQL: schema seeded for 4 slugs; Jest: SchemaForm validation for the reel-maker schema; E2E: brief with count 10 | M | No (migration) |
| WS5-T09 | Carry package into request and proposal (WS5-07) | `app/app/request/new.tsx`; `app/app/proposal/compose/[requestId].tsx`; `app/src/features/proposals/ProviderProposalInbox.tsx`; `app/src/features/catalogue/api.ts` | `request/new.tsx`: read `package` param. If present, fetch the package (existing `service_packages` select) and show a read-only summary card. Send `intake.package_id`. Compose: if `request.intake.package_id`, prefill title, total (price_min), deliverables, `turnaround_days` → deliver-by and `revisions_included` → revisions. | T06, T07 | A package chosen on the category or profile is shown on the brief and prefills the quote | Jest: prefill mapper pure function; E2E step "package-to-proposal" | S | Yes (after deps) |
| WS5-T10 | Compose shows the brief; advance cap (WS5-12, WS5-21) | `app/app/proposal/compose/[requestId].tsx`; `supabase/migrations/0062_proposal_terms.sql` | Compose: load `service_request_provider_view` row by `requestId` and render brief, budget max and date in a Card at the top. Validate numbers with `Number.isFinite`. Default advance = `app_config.proposal.max_advance_bp/100` (fallback 25). Migration: in `send_proposal`, assert `sum(at_booking amounts) ≤ total × max_advance_bp / 10000` (config key `proposal.max_advance_bp`, default 2500). | — | A 30% advance is rejected with "Advance can be at most 25%"; the creator sees the brief while quoting | SQL: 25% accepted, 26% rejected; Jest: NaN total shows an error | S | No (migration part) |
| WS5-T11 | Contact screening on brief, proposal and delivery (WS5-13) | `supabase/migrations/0062_proposal_terms.sql` | In `create_service_request`: `perform _assert(not _contains_contact_hint(p_intake::text), 'Remove phone numbers, emails or payment handles from the brief')`. In `send_proposal`: same check on `p_note`, each item title and each deliverable spec. In `submit_delivery`: same check on each link title. | — | Briefs or proposals with "+91 98xxxxxxx" or "upi" are rejected | SQL: one rejection per entry point; clean text accepted | S | No (migration) |
| WS5-T12 | Q&A thread and cancel request (WS5-11, WS5-16) | `app/app/proposal/[id].tsx`; `app/src/features/proposals/ProviderProposalInbox.tsx`; `app/app/request/[id].tsx`; `app/app/request/new.tsx`; `app/src/features/catalogue/ArchetypeCategory.tsx` | Add a "Questions" section using `api.listRequestMessages(requestId, providerId)` and `api.sendRequestMessage` (both exist) on `proposal/[id].tsx` and a "Message customer" button in the inbox card. Add a "Cancel request" destructive button on `request/[id].tsx` when `status in ('open','closed')`, calling `api.cancelServiceRequest`. Remove "New pros joining your city will see it" (`ArchetypeCategory.tsx:111`). Change the toast when 0 recipients (needs `create_service_request` to return the count, or a follow-up `select count(*) from request_recipients` via the customer view). | — | Copy matches behaviour; the customer can ask questions and cancel | E2E: message round-trip; cancel request rejects proposals (SQL already enforces) | M | Yes |
| WS5-T13 | Remote mode for creator categories (WS5-08, WS5-09) | `supabase/migrations/0064_remote_creator_mode.sql` (new); `app/app/request/new.tsx`; `app/app/booking/[id].tsx` | For categories where `location_modes = '{remote}'`: `create_service_request` skips the venue/address assert; `route_service_request` skips the radius and city filter (keep `category_cities` live check); `accept_proposal` skips the address requirement and stores `location_mode='remote'`; `start_proposal_booking` allows start any time after `confirmed` without OTP (new RPC `start_remote_proposal(p_booking_id)` asserting the provider and that all at-booking rows are paid). Behind flag `remote_creator_mode` (default OFF). | T07 | A remote reel-maker booking works with no address and starts immediately after confirmation | SQL: remote no-address accept; flag-off keeps the old behaviour; non-remote category unaffected | L | No (migration) |
| WS5-T14 | Acceptance window from config, reminders, dispute window (WS5-14) | `supabase/migrations/0065_deliverable_acceptance.sql` (new); `supabase/functions/schedule-reminders/index.ts` | `auto_confirm_completions`: replace the hard-coded `168` with `(select deliverable_acceptance_hours from categories where id=b.category_id)`. `_finalize_completion`: for `archetype='proposal' and delivery_status='accepted'`, use `release_after = now() + make_interval(hours => app_config.proposal.dispute_hours)` (default 168). Add `remind_delivery_acceptance()` notifying the customer at 72 h and 144 h after `delivery_submitted_at` (collapse key `delivery-accept:<id>:<day>`) and schedule it hourly. | T01 | Auto-accept honours category config; payout held for the configured window | SQL: 48 h category auto-accepts at 48 h; release_after 7 d | M | No (migration) |
| WS5-T15 | Show platform fee before accept (WS5-15) | `app/app/proposal/[id].tsx`; `supabase/migrations/0061_proposal_commission.sql` | Add the same fee formula as SQL function `public.proposal_platform_fee(p_total int)` reading `app_config.proposal_fee` (`rate_bp` 100, `min` 9900, `max` 49900). Use it in `accept_proposal`. Expose `get_proposal_fee_preview(p_proposal_id)`. In the app, show "Platform fee ₹Y · Total today ₹advance+Y". | T03 | The fee shown equals the fee charged | SQL: preview equals accept fee; Jest: label | S | No (migration part) |
| WS5-T16 | Label mapping (WS5-21) | `app/app/proposal/[id].tsx`; `app/src/lib/proposalStatus.ts` | Add `dueRuleLabel(rule)` ('at_booking'→'At booking', 'on_delivery'→'When work is delivered', 'on_completion'→'When the job is complete', 'days_before_start:7'→'7 days before') and `deliverableLabel(type)` (snake_case → sentence case). Use both. | — | No raw keys on screen | Jest: both mappers | S | Yes |

### Required changes for WS5-T01, WS5-T02, WS5-T03, WS5-T07 and WS5-T08

**WS5-T01 required change**

1. In `submit_delivery` and `request_completion`, set `reminded_at = now()` on the `on_delivery`/`on_completion` rows they mark due, and queue a `milestone_due` notification.
2. Replace `cancel_proposal_payment_default`:
   - Allow `b.status in ('confirmed','in_progress','completion_requested')`.
   - The overdue check uses `ps.due_at <= now() - interval '48 hours'`.
   - In `completion_requested`, settle via `_cancel_booking_by_policy(b.id,'provider','customer_payment_default',…)`, which already pays the provider the paid principal.
3. In `_cancel_booking_by_policy`, reject `p_actor='customer'` when `b.archetype='proposal' and b.delivery_status in ('submitted','accepted')` with the message 'delivery already submitted; raise a dispute instead'.
4. App: add `cancelProposalPaymentDefault(bookingId)` to the API files. In the provider view, show the button "Customer has not paid — close and get paid" when the RPC precondition holds (any `due` row with `due_at` older than 48 h).

**WS5-T02 required change**

1. In `dispute_booking`, add `'delivery_pending'` to the allowed statuses.
2. Add the column `bookings.delivery_due_at timestamptz`, copied from `proposals.delivery_due_at` in `accept_proposal`.
3. Allow `cancel_booking` by the customer in `delivery_pending` only when `now() > delivery_due_at + interval '48 hours'`, using reason `provider_fault` (full refund via the existing `event_moderate` rule).
4. UI: `canReport` includes `delivery_pending`. Show "Delivery is overdue — cancel for a full refund" when overdue.

**WS5-T03 required change**

1. In `accept_proposal`, insert the quote with `subtotal_other = v_proposal.total` and add a new column `commissionable int` (or set `subtotal_labour = v_proposal.total`, the simplest option).
2. Add config `app_config.commission.proposal = {"bp":800,"cap_paise":500000}`.
3. In `_finalize_completion`, when `b.archetype='proposal'`, compute the commission base = `q.total` and cap the commission at `cap_paise` by passing a capped commissionable amount: `least(q.total, cap_paise*10000/bp)`.
4. Make `_commission_bp` return `proposal.bp` for proposal bookings (still 0 in founding days, still the repeat discount).

**WS5-T07 required change**

1. Brief: rename "Event date" to "Deliver by" when `category.location_modes` equals `['remote']`. Store `intake.deliver_by` (ISO date).
2. Compose: add a required date Input "I will deliver by". Send it as the new `send_proposal` parameter `p_delivery_due_at timestamptz` (default null, keeping the signature backward compatible).
3. Migration:
   - Add `proposals.delivery_due_at`.
   - Validate it is in the future and ≤ request `event_start + 365 d`.
   - Copy it to `bookings.delivery_due_at` in `accept_proposal`.
4. Show "Delivery by <date>" on `proposal/[id].tsx` and the booking.
5. Flag `creator_delivery_deadline` (default OFF): with the flag OFF, compose hides the field and the server ignores it.

**WS5-T08 required change**

1. Migration: `update categories set intake_schema = …` for `reel-maker`, `ugc-creator`, `product-photographer` and `event-videographer`. Example for `reel-maker`:

   ```json
   {"type":"object","properties":{
     "count":{"type":"integer","minimum":1,"maximum":100},
     "length_seconds":{"type":"integer","enum":[15,30,60,90]},
     "aspect_ratio":{"type":"string","enum":["9:16","1:1","16:9"]},
     "captions":{"type":"boolean"},
     "music":{"type":"string","enum":["provider-licensed","customer-supplied","none"]},
     "footage_handover":{"type":"string","enum":["drive-link","in-person","creator-shoots"]},
     "reference_links":{"type":"string"}},
    "required":["count","aspect_ratio"]}
   ```

2. App: in `request/new.tsx`, fetch the category (`intake_schema`). If it has properties, render `<SchemaForm>` above the brief and merge the values into `intake`.
3. Show the intake values in `ProviderProposalInbox` and the compose summary.

## Regression tests to add

1. **SQL `proposal_lifecycle.test.mjs`** (register in `supabase/tests/package.json` `test`). The full happy path:
   - `create_service_request` → `send_proposal` (with `on_delivery` balance and `revisions` qty 1) → `accept_proposal` → pay the at-booking rows → `start_proposal_booking` (event-day stub) → `begin_delivery` → `submit_delivery` (2 links).
   - Assert `on_delivery` is due and `reminded_at` is not null.
   - Pay the balance → `accept_delivery`.
   - Assert `status='completed'`, `payouts.gross = total`, `payouts.commission = round(total*0.08)` capped at 500000, and `release_after ≈ now()+configured window`.
2. **SQL unpaid-balance default:** after `submit_delivery`, set `due_at = now()-49h`. Provider `cancel_proposal_payment_default` succeeds. The payout equals the paid principal minus commission. The customer `cancel_booking` after submission is rejected.
3. **SQL non-delivery:** `delivery_pending` + `dispute_booking` succeeds and freezes the payout. Past `delivery_due_at + 48 h`, the customer cancel refunds 100%. Before it, the cancel is rejected.
4. **SQL `auto_confirm_completions`:** a delivered, fully paid booking auto-accepts after `deliverable_acceptance_hours`. A delivered, unpaid booking does not (until T01 settles it). It must not auto-accept while `revision_requested`.
5. **SQL contact screening:** a brief, proposal note, deliverable spec or delivery title with a phone number, email or "upi" is rejected.
6. **SQL advance cap:** 25% accepted, 26% rejected. Flag-off and parent-flag-off cases for `creator_delivery_deadline` and `remote_creator_mode`.
7. **Jest:** `heroCopy` for proposal delivery states; `dueRuleLabel` / `deliverableLabel`; the compose numeric validation (NaN, "12,000", advance ≥ total); the package-prefill mapper.
8. **E2E `web-smoke.mjs`:**
   - Replace the RPC-based `proposal-flow-pro-sends-proposal` with a UI step through `/proposal/compose/[requestId]` (fill scope, total, advance, deliverables, revisions, deliver-by).
   - Add `proposal-flow-pro-delivers`: start code (demo), Begin deliverables, `/proposal-delivery/[id]` with 2 links.
   - Add `proposal-flow-customer-reviews-delivery`: sees "Delivered work" with both links and no completion-code card; pays the balance (demo); taps "Accept delivery"; sees the review form.
   - Add `proposal-flow-revision` with `creator_revisions` ON in the DEMO project.
