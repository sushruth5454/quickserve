# Oorva Critical audit - implementation source index

| Item | Verified result |
|---|---|
| Source | `2f1e4638b145185b9e58c4c62e58f5c6dd491fa1`; November 20, 2026 |
| Coverage | **88 screens +5layouts,503 element-placement rows,29 entity definitions,12 required card families** |
| Findings | **136**: 109 confirmed current-code defects; 27 mandated design changes |
| Executable source tasks | **131**, each with files/functions, edits, OFF behavior and acceptance assertions |
| Runtime execution | **NOT RUN**; source audit/document validation is not implementation or release acceptance |

Use [doc 18](../18-Oorva-Transformation-Implementation-Plan.md) and its [canonical execution allocation](../design/oorva/execution-plan.json) to dispatch implementation. These reports supply actual source facts and fixes, not a future audit assignment. Migration numbers remain UNASSIGNED until shared-coordinator acknowledgment.

## Workstreams

| Report | Screens | Placement rows | Entities | Findings | Source tasks |
|---|---|---|---|---|---|
| [platform](18-WS1-Platform-Auth-AI-Native.md) | 7 | 30 | 1 | 14 | 12 |
| [marketplace](18-WS2-Marketplace-Shops-RFQ.md) | 19 | 101 | 6 | 28 | 26 |
| [services](18-WS3-Services-Creators-Recurring.md) | 14 | 88 | 9 | 22 | 25 |
| [identity](18-WS4-Identity-Provider-Workspaces.md) | 15 | 82 | 4 | 18 | 20 |
| [sports](18-WS5-Sports-Operations.md) | 8 | 50 | 3 | 20 | 17 |
| [money](18-WS6-Money-Receipts.md) | 11 | 71 | 4 | 15 | 16 |
| [communications](18-WS7-Communications-Admin.md) | 14 | 81 | 2 | 19 | 15 |

## What the audit established

- Verification/action errors also affect shops, provider review and credentials; payout/KYC/admin review/document validity are separate dimensions.
- Existing work can be hidden or blocked after capability shutdown; new acquisition must remain OFF while authorized history/cancellation/payment resolution stays safe.
- Booking/request/proposal/payment/refund/payout states need their actual source-backed composites; queued/recorded is not completed/bank credited.
- Existing helpers, valid protections, immutable financial evidence and correct filtered public trust are explicitly retained.
- Per-screen current/problem/target/reason/source/test rows and per-entity actor/transition/refresh rules are in the linked reports and portable JSON.

## Twelve required card families

| Family | Audited variants |
|---|---|
| service | service: marketplace |
| serviceProvider | provider: marketplace |
| shop | shop: marketplace |
| product | product: marketplace |
| sportsVenue | sportsVenue: sports |
| creator | creator: marketplace |
| booking | booking: services; sportsBooking: sports |
| bookingRequest | bookingRequest: services |
| notification | notification: communications |
| rfq | rfq: marketplace |
| supplierQuote | supplierQuote: marketplace |
| transaction | transaction: money |

## Finding index

| ID | Kind / priority | Source-backed change | Logical WP |
|---|---|---|---|
| PF-F01 | confirmed-current-defect / P1 | [Guest controls have independent, uncached and contradictory refresh paths](18-WS1-Platform-Auth-AI-Native.md) | O05A |
| PF-F02 | confirmed-current-defect / P1 | [Auth restoration has no explicit failure state or protection against a late initial result](18-WS1-Platform-Auth-AI-Native.md) | O05A |
| PF-F03 | confirmed-current-defect / P1 | [Post-OTP reads silently become new-user/customer state and provider defaults discard return intent](18-WS1-Platform-Auth-AI-Native.md) | O13 |
| PF-F04 | confirmed-current-defect / P1 | [Public location queries private addresses and the local address list is not identity-scoped](18-WS1-Platform-Auth-AI-Native.md) | O13 |
| PF-F05 | confirmed-current-defect / P1 | [Provider access loading is blank and admin transport errors are presented as denial](18-WS1-Platform-Auth-AI-Native.md) | O11 |
| PF-F06 | confirmed-current-defect / P1 | [BYO preview failures and committed claims do not have truthful recoverable UI states](18-WS1-Platform-Auth-AI-Native.md) | O13 |
| PF-F07 | confirmed-current-defect / P1 | [AI disabled UI still permits the query auto-send effect and handlers to issue a request](18-WS1-Platform-Auth-AI-Native.md) | O36 |
| PF-F08 | confirmed-current-defect / P1 | [AI history and new-chat callbacks can restore an obsolete conversation](18-WS1-Platform-Auth-AI-Native.md) | O36 |
| PF-F09 | confirmed-current-defect / P1 | [Actual unread and pressed-destructive color pairs fail normal-text contrast](18-WS1-Platform-Auth-AI-Native.md) | O02/O06/O11/O36 |
| PF-F10 | confirmed-current-defect / P2 | [Essential actions and text are capped/truncated rather than reliably reflowing](18-WS1-Platform-Auth-AI-Native.md) | O06 |
| PF-F11 | confirmed-current-defect / P2 | [Demo disclosure is an absolute overlay on tabs and sticky actions](18-WS1-Platform-Auth-AI-Native.md) | O07 |
| PF-F12 | required-design-change / P2 | [Identity text and native identity still use context-specific legacy sources](18-WS1-Platform-Auth-AI-Native.md) | O05B/O13/O33/O35/O36 |
| PF-F13 | required-design-change / P1 | [Current native publishing cannot safely double as isolated Oorva candidate delivery](18-WS1-Platform-Auth-AI-Native.md) | O33 |
| PF-F14 | required-design-change / P1 | [There is no current launch controller implementing the required bounded, actual-destination reveal](18-WS1-Platform-Auth-AI-Native.md) | O34 |
| MK-F01 | confirmed-current-defect / P1 | [Admin shop card advertises Verify and other completed actions independently of current state](18-WS2-Marketplace-Shops-RFQ.md) | O31 |
| MK-F02 | confirmed-current-defect / P1 | [submit_shop permits direct resets that the owner UI explicitly forbids](18-WS2-Marketplace-Shops-RFQ.md) | O38P |
| MK-F03 | confirmed-current-defect / P2 | [Suspended owner shop still offers product editing that SQL rejects](18-WS2-Marketplace-Shops-RFQ.md) | O27 |
| MK-F04 | required-design-change / P1 | [Capability OFF currently erases authorized history and blocks owner RFQ cancellation](18-WS2-Marketplace-Shops-RFQ.md) | O38P |
| MK-F05 | confirmed-current-defect / P1 | [Supplier selection bypasses current verified-shop requirement](18-WS2-Marketplace-Shops-RFQ.md) | O38P |
| MK-F06 | confirmed-current-defect / P2 | [New product enquiry accepts a product excluded by current public catalogue projection](18-WS2-Marketplace-Shops-RFQ.md) | O38P |
| MK-F07 | confirmed-current-defect / P1 | [RFQ actions/outcomes ignore temporal eligibility and conflate parent/quote state](18-WS2-Marketplace-Shops-RFQ.md) | O19 |
| MK-F08 | confirmed-current-defect / P1 | [Supplier detail loses saved quote terms/outcomes and reuses wrong-context drafts](18-WS2-Marketplace-Shops-RFQ.md) | O38P |
| MK-F09 | confirmed-current-defect / P1 | [Primary supplier selection precedes critical difference warnings and is duplicated](18-WS2-Marketplace-Shops-RFQ.md) | O19 |
| MK-F10 | confirmed-current-defect / P2 | [Unified search discards valid server product matches and exposes grouping categories as services](18-WS2-Marketplace-Shops-RFQ.md) | O12 |
| MK-F11 | confirmed-current-defect / P1 | [Unified product result strips indicative unit-price and stock truth](18-WS2-Marketplace-Shops-RFQ.md) | O12 |
| MK-F12 | confirmed-current-defect / P2 | [Marketplace entry points ignore effective parent capabilities](18-WS2-Marketplace-Shops-RFQ.md) | O12 |
| MK-F13 | confirmed-current-defect / P2 | [Guest and own-shop enquiry/AI commits do not use existing authentication handoff](18-WS2-Marketplace-Shops-RFQ.md) | O18 |
| MK-F14 | confirmed-current-defect / P1 | [Top-rated public card projection loses archetype pricing and current leave](18-WS2-Marketplace-Shops-RFQ.md) | O14 |
| MK-F15 | confirmed-current-defect / P1 | [Package catalogue ignores selected service city](18-WS2-Marketplace-Shops-RFQ.md) | O14 |
| MK-F16 | confirmed-current-defect / P2 | [Provider-specific package action silently restarts at all-provider category](18-WS2-Marketplace-Shops-RFQ.md) | O14 |
| MK-F17 | confirmed-current-defect / P2 | [Marketplace load failures can claim empty supply, setup or endless loading](18-WS2-Marketplace-Shops-RFQ.md) | O18 |
| MK-F18 | confirmed-current-defect / P2 | [Discovery/profile response scope and refresh can preserve stale truth](18-WS2-Marketplace-Shops-RFQ.md) | O12 |
| MK-F19 | confirmed-current-defect / P2 | [Enquiry closed/reopen/refresh controls do not match every participant state](18-WS2-Marketplace-Shops-RFQ.md) | O19 |
| MK-F20 | confirmed-current-defect / P2 | [Business work lists lose business identity for multi-business members](18-WS2-Marketplace-Shops-RFQ.md) | O28 |
| MK-F21 | required-design-change / P2 | [Home discovery needs one deliberate urgent-work and search/AI hierarchy](18-WS2-Marketplace-Shops-RFQ.md) | O12 |
| MK-F22 | confirmed-current-defect / P2 | [Narrow home pillar truncates a primary family title](18-WS2-Marketplace-Shops-RFQ.md) | O08 |
| MK-F23 | required-design-change / P2 | [Provider decision controls follow secondary biography/hours](18-WS2-Marketplace-Shops-RFQ.md) | O14 |
| MK-F24 | required-design-change / P2 | [Existing-shop catalogue and inbox work are subordinate to management forms](18-WS2-Marketplace-Shops-RFQ.md) | O27 |
| MK-F25 | required-design-change / P2 | [Product/shop discovery gives optional forms priority over browsing and buries enquiry action](18-WS2-Marketplace-Shops-RFQ.md) | O18 |
| MK-F26 | confirmed-current-defect / P2 | [Creator landing has no successful-empty category state](18-WS2-Marketplace-Shops-RFQ.md) | O21 |
| MK-F27 | confirmed-current-defect / P2 | [RFQ cancel confirmation promises supplier notification not queued by current command](18-WS2-Marketplace-Shops-RFQ.md) | O19 |
| MK-F28 | confirmed-current-defect / P1 | [Hard product deletion can violate the open-enquiry key and cannot preserve all valid histories](18-WS2-Marketplace-Shops-RFQ.md) | O38P |
| SV-F01 | confirmed-current-defect / P1 | [Revisions-only proposals are instantiated as delivery work and can strand their completion milestone](18-WS3-Services-Creators-Recurring.md) | O22 |
| SV-F02 | confirmed-current-defect / P1 | [Generic quote editing/approval crosses fixed, session and proposal contracts](18-WS3-Services-Creators-Recurring.md) | O22 |
| SV-F03 | confirmed-current-defect / P1 | [Readback depends on remount/status changes that several real mutations do not produce](18-WS3-Services-Creators-Recurring.md) | O16 |
| SV-F04 | confirmed-current-defect / P1 | [Proposal/request presentation erases actor and multi-booking hold/fulfillment state](18-WS3-Services-Creators-Recurring.md) | O21 |
| SV-F05 | confirmed-current-defect / P2 | [Request-message errors are discarded and closed conversations still look writable](18-WS3-Services-Creators-Recurring.md) | O21 |
| SV-F06 | confirmed-current-defect / P1 | [Counterparty can accept a pending recurring reschedule after the visit is no longer reschedulable](18-WS3-Services-Creators-Recurring.md) | O17 |
| SV-F07 | confirmed-current-defect / P2 | [Recurring customer payment deadline is a hardcoded approximation, not the actual expiry](18-WS3-Services-Creators-Recurring.md) | O17 |
| SV-F08 | confirmed-current-defect / P2 | [Recurring action helpers and visit partitions ignore acceptance, actor, cutoff and complete history](18-WS3-Services-Creators-Recurring.md) | O17 |
| SV-F09 | confirmed-current-defect / P1 | [Checkout route/quantity/duration differs from the selected server booking contract](18-WS3-Services-Creators-Recurring.md) | O15 |
| SV-F10 | confirmed-current-defect / P1 | [Server preview endpoints and package UI retain obsolete fee sources after configured-fee writers changed](18-WS3-Services-Creators-Recurring.md) | O15 |
| SV-F11 | confirmed-current-defect / P1 | [Provider request/next-job cards use the wrong deadline and omit actual family context](18-WS3-Services-Creators-Recurring.md) | O25 |
| SV-F12 | confirmed-current-defect / P2 | [Review controls advertise writes that the current review contract rejects](18-WS3-Services-Creators-Recurring.md) | O16 |
| SV-F13 | confirmed-current-defect / P1 | [Booking controls and financial lifecycle copy use incomplete role/state/time predicates](18-WS3-Services-Creators-Recurring.md) | O16 |
| SV-F14 | required-design-change / P2 | [Fixed entry hides essential address and forces a mount-time schedule](18-WS3-Services-Creators-Recurring.md) | O15 |
| SV-F15 | confirmed-current-defect / P2 | [Request comparison ranks unavailable proposal versions as the lowest actionable offer](18-WS3-Services-Creators-Recurring.md) | O21 |
| SV-F16 | confirmed-current-defect / P2 | [Composer rejects valid administrator revision defaults and boundary advance policies](18-WS3-Services-Creators-Recurring.md) | O22 |
| SV-F17 | confirmed-current-defect / P2 | [Recurring creation trusts navigation hints and preserves a quote across changed address eligibility](18-WS3-Services-Creators-Recurring.md) | O17 |
| SV-F18 | required-design-change / P2 | [Service family hierarchy needs concrete composition changes, not a second booking engine](18-WS3-Services-Creators-Recurring.md) | O16 |
| SV-F19 | confirmed-current-defect / P1 | [New proposal intake/send/routing does not consistently enforce current parent and readiness contracts](18-WS3-Services-Creators-Recurring.md) | O21 |
| SV-F20 | confirmed-current-defect / P1 | [Cancel request can contradict an active accepted proposal payment hold](18-WS3-Services-Creators-Recurring.md) | O21 |
| SV-F21 | confirmed-current-defect / P1 | [Generic completion RPC can bypass submitted-delivery acceptance semantics](18-WS3-Services-Creators-Recurring.md) | O22 |
| SV-F22 | confirmed-current-defect / P1 | [Ended inspection can retain a payable-looking quote and unretired balance attempt](18-WS3-Services-Creators-Recurring.md) | O16 |
| ID-F01 | confirmed-current-defect / P1 | [Admin provider cards retain completed review actions and collapse independent state axes](18-WS4-Identity-Provider-Workspaces.md) | O30 |
| ID-F02 | confirmed-current-defect / P1 | [Per-document readiness is misclassified and owner credential rendering ignores scope/expiry](18-WS4-Identity-Provider-Workspaces.md) | O38I |
| ID-F03 | required-design-change / P2 | [Admin document review needs scoped context and explicit review confirmation](18-WS4-Identity-Provider-Workspaces.md) | O30 |
| ID-F04 | confirmed-current-defect / P1 | [Provider identity and hours drafts are shared across accounts on the same device](18-WS4-Identity-Provider-Workspaces.md) | O26 |
| ID-F05 | confirmed-current-defect / P1 | [Account/service/online presentation uses incompatible meanings of verified or live](18-WS4-Identity-Provider-Workspaces.md) | O38I |
| ID-F06 | confirmed-current-defect / P2 | [Supported legacy payout accounts are falsely marked incomplete in profile guidance](18-WS4-Identity-Provider-Workspaces.md) | O38I |
| ID-F07 | confirmed-current-defect / P1 | [Owner dashboard omits active confirmed and delivery_pending bookings](18-WS4-Identity-Provider-Workspaces.md) | O25 |
| ID-F08 | confirmed-current-defect / P1 | [Assigned-job screen has stale action state, incomplete no-show eligibility and incorrect multi-actor chat attribution](18-WS4-Identity-Provider-Workspaces.md) | O25 |
| ID-F09 | confirmed-current-defect / P1 | [Delegated proposal-request view bypasses the merchant_staff OFF guard](18-WS4-Identity-Provider-Workspaces.md) | O38I |
| ID-F10 | confirmed-current-defect / P2 | [Business identity entry points omit real memberships, stable business IDs and effective feature parents](18-WS4-Identity-Provider-Workspaces.md) | O28 |
| ID-F11 | confirmed-current-defect / P2 | [Several owned reads convert unavailable/stale data into empty, zero, pending or silently current state](18-WS4-Identity-Provider-Workspaces.md) | O38I |
| ID-F12 | confirmed-current-defect / P2 | [Paused rewards hide normal wallet history access and still advertise unconditional earning](18-WS4-Identity-Provider-Workspaces.md) | O23 |
| ID-F13 | required-design-change / P2 | [All-family legal/safety presentation must qualify home-service workflow claims](18-WS4-Identity-Provider-Workspaces.md) | O23 |
| ID-F14 | required-design-change / P2 | [Oorva account/reward/help composition needs deliberate personal-versus-business hierarchy](18-WS4-Identity-Provider-Workspaces.md) | O23 |
| ID-F15 | required-design-change / P2 | [Oorva provider workspace should promote urgent and scheduled work over metrics/secondary history](18-WS4-Identity-Provider-Workspaces.md) | O25 |
| ID-F16 | required-design-change / P2 | [Oorva business tools should preserve selected context and promote current create/share/member actions](18-WS4-Identity-Provider-Workspaces.md) | O28 |
| ID-F17 | required-design-change / P2 | [Oorva onboarding/profile hierarchy should promote required repair over optional portfolio strength](18-WS4-Identity-Provider-Workspaces.md) | O26 |
| ID-F18 | required-design-change / P2 | [Oorva admin people/documents should be queue-first with explicit scoped actions](18-WS4-Identity-Provider-Workspaces.md) | O30 |
| SP-F01 | confirmed-current-defect / P1 | [Admin repeats Verify on verified venues and cannot invoke already-authorized restoration](18-WS5-Sports-Operations.md) | O09 |
| SP-F02 | confirmed-current-defect / P1 | [Owner submission can downgrade a verified venue to submitted](18-WS5-Sports-Operations.md) | O09 |
| SP-F03 | confirmed-current-defect / P1 | [Venue save hides its real re-review consequence and offers a denied suspended save](18-WS5-Sports-Operations.md) | O09 |
| SP-F04 | confirmed-current-defect / P1 | [Flag-OFF resource save loses stored instant mode through a snake_case/camelCase mismatch](18-WS5-Sports-Operations.md) | O29 |
| SP-F05 | confirmed-current-defect / P1 | [Management editor does not hydrate initial resource/day context and masks loading/read errors](18-WS5-Sports-Operations.md) | O29 |
| SP-F06 | confirmed-current-defect / P1 | [Read-only early return traps multi-venue members and mixed owner/member users](18-WS5-Sports-Operations.md) | O29 |
| SP-F07 | required-design-change / P2 | [Owner requests are below every editor and enabled owner view omits existing started/history rows](18-WS5-Sports-Operations.md) | O29 |
| SP-F08 | confirmed-current-defect / P1 | [Detail and checkout action predicates omit actual actor/time/payment eligibility](18-WS5-Sports-Operations.md) | O20 |
| SP-F09 | confirmed-current-defect / P1 | [Successful checkout still shows an old payment countdown and replacement-slot primary action](18-WS5-Sports-Operations.md) | O20 |
| SP-F10 | confirmed-current-defect / P1 | [Latest public venue RPC dropped the cancellation-policy disclosure contract](18-WS5-Sports-Operations.md) | O20 |
| SP-F11 | confirmed-current-defect / P1 | [Real payment Edge Function strands live sports obligations after feature shutdown](18-WS5-Sports-Operations.md) | O20 |
| SP-F12 | confirmed-current-defect / P1 | [Activity and business cards contradict canonical sports payment/status truth](18-WS5-Sports-Operations.md) | O20 |
| SP-F13 | confirmed-current-defect / P1 | [Focused cross-role venue/booking views have inconsistent refresh guarantees](18-WS5-Sports-Operations.md) | O09 |
| SP-F14 | confirmed-current-defect / P1 | [Out-of-order slot reads can display and submit a selection from another resource/date](18-WS5-Sports-Operations.md) | O20 |
| SP-F15 | confirmed-current-defect / P2 | [Slot read labels policy-ineligible future starts free](18-WS5-Sports-Operations.md) | O20 |
| SP-F16 | confirmed-current-defect / P2 | [Legacy multi-slot request still overcounts adjacent per-slot occupancy](18-WS5-Sports-Operations.md) | O20 |
| SP-F17 | confirmed-current-defect / P2 | [Venue footer calls a fee-exclusive slot subtotal Estimated total](18-WS5-Sports-Operations.md) | O20 |
| SP-F18 | required-design-change / P2 | [Sports home ties existing-work navigation to discovery success and provider navigation role](18-WS5-Sports-Operations.md) | O20 |
| SP-F19 | required-design-change / P2 | [Sports family needs concrete review/discovery/selection/card hierarchy, not another style-only pass](18-WS5-Sports-Operations.md) | O20 |
| SP-F20 | required-design-change / P2 | [Destructive review and schedule actions mutate immediately without confirmation](18-WS5-Sports-Operations.md) | O29 |
| MN-F01 | confirmed-current-defect / P1 | [Refund submission/parent resolution can be presented as completed reimbursement](18-WS6-Money-Receipts.md) | O32 |
| MN-F02 | confirmed-current-defect / P1 | [Time-based demo completion creates a financial pending payout instead of demo](18-WS6-Money-Receipts.md) | O32 |
| MN-F03 | confirmed-current-defect / P1 | [Locally transferred/offset payout is overclaimed as paid to bank](18-WS6-Money-Receipts.md) | O32 |
| MN-F04 | confirmed-current-defect / P1 | [Failed refund retry does not recheck capacity reserved by other refund rows](18-WS6-Money-Receipts.md) | O32 |
| MN-F05 | confirmed-current-defect / P1 | [Hosted checkout turns verification failure or uncertainty into success copy](18-WS6-Money-Receipts.md) | O35 |
| MN-F06 | confirmed-current-defect / P2 | [Receipt snapshot is mistaken for current refund/due state and refunded receipts lose their entry point](18-WS6-Money-Receipts.md) | O16 |
| MN-F07 | confirmed-current-defect / P2 | [Partial dispute form does not mirror payout cap and its note rule is UI-only](18-WS6-Money-Receipts.md) | O32 |
| MN-F08 | confirmed-current-defect / P2 | [Admin money read projections collapse funding/refund context and omit supported problem parents](18-WS6-Money-Receipts.md) | O32 |
| MN-F09 | confirmed-current-defect / P2 | [Money views lack reliable identity-keyed readback and some suppress real read failures](18-WS6-Money-Receipts.md) | O32 |
| MN-F10 | confirmed-current-defect / P2 | [Earnings payout verification assumes Route and collapses other real KYC states](18-WS6-Money-Receipts.md) | O32 |
| MN-F11 | confirmed-current-defect / P2 | [Statement labels current payout.amount as before-reversal money](18-WS6-Money-Receipts.md) | O32 |
| MN-F12 | required-design-change / P2 | [Financial family needs contextual transaction hierarchy and deliberate admin setting review](18-WS6-Money-Receipts.md) | O32 |
| MN-F13 | required-design-change / P2 | [Receipt display brand must be separated from original receipt/issuer identity](18-WS6-Money-Receipts.md) | O16 |
| MN-F14 | confirmed-current-defect / P2 | [Earnings silently truncates important release and transaction text](18-WS6-Money-Receipts.md) | O32 |
| MN-F15 | confirmed-current-defect / P2 | [Daily gateway reconciliation compares gross tranches and synthetic offsets as real gateway money](18-WS6-Money-Receipts.md) | O32 |
| CM-F01 | confirmed-current-defect / P2 | [Notification read acknowledgement can fail while the card remains falsely read](18-WS7-Communications-Admin.md) | O24 |
| CM-F02 | confirmed-current-defect / P2 | [Notification occurrence time and order change when push transport retries](18-WS7-Communications-Admin.md) | O24 |
| CM-F03 | confirmed-current-defect / P1 | [A new event merged into a read pending notification stays read](18-WS7-Communications-Admin.md) | O24 |
| CM-F04 | confirmed-current-defect / P1 | [Communication/admin load paths misrepresent failure or cannot recover correctly](18-WS7-Communications-Admin.md) | O30 |
| CM-F05 | confirmed-current-defect / P2 | [Personal support reads inherit administrator-wide scope and can mislabel another user as You](18-WS7-Communications-Admin.md) | O24 |
| CM-F06 | confirmed-current-defect / P2 | [Shared support detail has stale/missing-context actions and no focused incoming refresh](18-WS7-Communications-Admin.md) | O24 |
| CM-F07 | confirmed-current-defect / P2 | [Chat state and message readback depend on incomplete mount/realtime paths](18-WS7-Communications-Admin.md) | O24 |
| CM-F08 | confirmed-current-defect / P2 | [Authorized business chat members are omitted by canonical unread/read/heading projections](18-WS7-Communications-Admin.md) | O24 |
| CM-F09 | confirmed-current-defect / P1 | [Admin overview still counts KYC work as provider admin review and labels gross collections Revenue](18-WS7-Communications-Admin.md) | O30 |
| CM-F10 | confirmed-current-defect / P2 | [Category views locally synthesize canonical state, including wrong reorder positions](18-WS7-Communications-Admin.md) | O31 |
| CM-F11 | confirmed-current-defect / P2 | [Feature switches allow out-of-order full-state responses](18-WS7-Communications-Admin.md) | O31 |
| CM-F12 | confirmed-current-defect / P2 | [Remote is supported by the runtime archetype RPC but absent from admin controls](18-WS7-Communications-Admin.md) | O31 |
| CM-F13 | confirmed-current-defect / P2 | [Late place results can attach City A coordinates to City B's area draft](18-WS7-Communications-Admin.md) | O31 |
| CM-F14 | confirmed-current-defect / P2 | [Rules focus refresh discards unsaved edits; disabled direct route is blank](18-WS7-Communications-Admin.md) | O31 |
| CM-F15 | confirmed-current-defect / P1 | [Support notification previews bypass the existing contact masker](18-WS7-Communications-Admin.md) | O24 |
| CM-F16 | required-design-change / P2 | [Communications composition needs dated context and independent status/unread cues, not a speculative top-gap patch](18-WS7-Communications-Admin.md) | O24 |
| CM-F17 | required-design-change / P2 | [Admin operations should put actionable queues before reporting](18-WS7-Communications-Admin.md) | O30 |
| CM-F18 | required-design-change / P2 | [Six admin configuration screens need deliberate find/edit/save hierarchy](18-WS7-Communications-Admin.md) | O31 |
| CM-F19 | required-design-change / P2 | [Local communications/operations display copy is hardcoded to QuickServe](18-WS7-Communications-Admin.md) | O24 |

## Evidence and preservation boundaries

- The current-code archived web run44696642603 failed three Home flag-coverage assertions. It is not a new successful app test.
- Scenario image names do not prove route/state:02-login is Verify,03-verify is dashboard; the ended-booking/pay contradiction is image89.
- Images, live feature values, native signing/device/gateway outcomes and production record impact are not invented. Native/keyboard/large-text and after-state evidence remain implementation acceptance.
- Deactivation policy is preserved. Public trust wording uses existing safe projections without private credential/account fields. Legal issuer, public-policy wording and native distribution retain explicit owner gates.
- No application/SQL/CI/runtime setting/financial history was changed during this audit. Reports contain no reproduced personal account details.
