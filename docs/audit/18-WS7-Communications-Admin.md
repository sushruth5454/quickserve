# Oorva Critical Audit — Communications

> **Implementation authority:** use [doc 18](../18-Oorva-Transformation-Implementation-Plan.md) and [`execution-plan.json`](../design/oorva/execution-plan.json) for the actual dispatch stage, file/function locks, migration claim and validation command. This source audit supplies verified current behavior, required changes and acceptance. A proposal filename is not a numeric reservation.


| Scope | Baseline / evidence |
|---|---|
| Assignment | `communications` / prefix `CM`; all **14 assigned screens**, their real bodies, `notification` and `supportThread` |
| Immutable source | `2f1e4638b145185b9e58c4c62e58f5c6dd491fa1` |
| Date | November 20, 2026 |
| Audit inputs | Complete `audit-protocol.txt`, `audit-manifest.json`, `..\critical-addendum-source.txt`; source/client/SQL bodies; three supplied before-web images |
| Detailed companion | [`communications.json`](../design/oorva/audit/communications.json): full source references, fields, 65 allowed notification kinds, actor cases, tasks and files-read inventory |
| Execution boundary | Read-only audit. No application execution, tests, builds, installs, production APIs, source changes, commits, pushes or deployments |

## Summary

**Source audit complete: 14/14 screens, 81 placement rows, 2 entity contracts, 1 notification-card contract, 19 findings and 15 concrete remediation tasks.** Fifteen findings are confirmed current-code defects; four are required design changes. Four findings are P1, fifteen P2; no P0 is asserted.

The important current defects are not merely visual: failed support queries can look like an empty inbox; a newly merged notification can remain read; transport retries change displayed event time; business chat permissions and unread projections disagree; overview review counts use the superseded KYC predicate.

**No source-coverage blocker remains.** Notification top whitespace, native keyboard behavior and uncaptured runtime states remain **NOT VERIFIED**, not “fixed” or visually passed.

### Supplied visual evidence — deliberately limited

Run `44696642603` and head `229995fe3194de39684f12ef348d3e37930ae5f2` are coordinator/user-supplied provenance. The coordinator reports only `docs/14` differs from the frozen source. This audit did not query the run.

| Actually inspected file | Observed content only |
|---|---|
| `before-web-44696642603\162-admin-feature-registry.png` | Features header, grouped registry controls/descriptions, Service types heading. Demo disclosure overlaps part of the success toast. |
| `before-web-44696642603\98-booking-chat-send.png` | Counterparty/booking-context header, date-grouped messages with times and a bottom composer. |
| `before-web-44696642603\100-unread-chat-divider.png` | Today separator, New messages divider, message times, Seen text and composer; demo disclosure covers part of the send-control area. |

No names, account details, message bodies or phones are transcribed. These images do **not** prove feature values, message delivery, current booking state or native behavior. The reported three Home coverage assertions are not evidence of a communications failure. The observed disclosure obstruction belongs to coordinator **O07**, not a duplicate CM root/primitive task.

## Findings

`A` = always-on existing truth/permission/accessibility repair. `B` = display identity. `C` = gated family composition.

| ID / priority / class | Source-confirmed current condition → exact repair | Owner / evidence |
|---|---|---|
| **CM-F01 · P2 · A** | Notification read optimism swallows RPC failure → pending guard, visible failure and canonical reconciliation; do not clear chat read-state. | O24; `app\app\notifications.tsx:56-67` |
| **CM-F02 · P2 · A** | `at=greatest(created_at,updated_at)` while delivery changes `updated_at` → explicit timestamp provenance: historical **record creation**, new/merged **queue-recording** time, never reconstructed last activity. Selected CM-T02 contract below. | O24; `supabase\migrations\0032_notification_centre.sql:24-40`; `0007_chat_unread_notifications.sql:465-478,501-513` |
| **CM-F03 · P1 · A** | Pending collapse changes content/count but retains a previous `read_at` → genuinely new merge resets read state. | O24; `supabase\migrations\0066_h2b_recurring_ux.sql:70-75`; `0032_notification_centre.sql:57-75` |
| **CM-F04 · P1 · A** | Admin support failure becomes `[]`/Inbox clear; personal support error never clears; geography can retain an initial skeleton after failure → explicit load/error/retry/data states. | O30/O24/O31; `app\app\admin\support\index.tsx:6-16`; `app\app\support\index.tsx:6-16`; `app\app\admin\geography.tsx:27-37,143-149` |
| **CM-F05 · P2 · A** | Admin-wide RLS also feeds personal support routes, which can label another user's message “You” → explicit personal-owner filter and scoped conversation adapter. **Not a claim of unauthorized DB disclosure.** | O24; `app\src\lib\adminApi.ts:393-409`; `app\src\components\SupportConversation.tsx:87-99`; `supabase\migrations\0041_admin_support.sql:454-459` |
| **CM-F06 · P2 · A** | Support detail has missing/stale-thread actions, no terminal not-found/error body and no incoming refresh while focused → role/entity-keyed load state, current authorized thread required, shared active refresh. | O24; `app\src\components\SupportConversation.tsx:14-43,62-87` |
| **CM-F07 · P2 · A** | Chat booking state is mount-only; error becomes Say hello; initial snapshot can overwrite realtime; successful send lacks readback → existing booking subscription plus keyed message reconciliation/reload. Server closed-state guard is retained. | O24; `app\app\chat\[bookingId].tsx:35-49,130-154`; `app\src\components\ChatPanel.tsx:27-73` |
| **CM-F08 · P2 · A** | Members can read/send but primary-only unread/read/heading helpers omit them; builder omits unread chats without recent outbox rows → align read predicates and derive missing authorized chat items, without new push fan-out. | O24/O38I; `supabase\migrations\0052_merchant_staff.sql:306-318,348-431`; `0007_chat_unread_notifications.sql:70-90,117-132`; `0032_notification_centre.sql:77-93`; `app\src\lib\unread.ts:159-193` |
| **CM-F09 · P1 · A** | Overview “need review” still counts KYC states, while People uses `admin_review_status`; Revenue is gross paid amounts → exact current review predicate and honest gross-collections label, no formula change. | O30; `supabase\migrations\0041_admin_support.sql:229-247`; `0064_o2_provider_verification.sql:44-54`; `app\app\admin\index.tsx:31-39,64-66` |
| **CM-F10 · P2 · A** | Category reorder locally uses `index*10`, SQL uses `ordinality*10`; editor fabricates saved projection → await `admin_list_categories` after mutations. | O31; `app\app\admin\services.tsx:28-72`; `app\app\admin\category\[id].tsx:230-301`; `supabase\migrations\0056_home_services_catalogue.sql:647-657` |
| **CM-F11 · P2 · A** | Concurrent feature writes replace full snapshots out of order → immediate one-write lock and all-switch pending state. | O31; `app\app\admin\features.tsx:34-43,70-75,111-116` |
| **CM-F12 · P2 · A** | UI omits Remote although existing archetype RPC accepts it → add `archetype:remote` control to the existing list. | O31; `app\app\admin\features.tsx:9-14`; `supabase\migrations\0042_feature_registry.sql:63-69` |
| **CM-F13 · P2 · A** | Late City A place result can populate City B's shared area draft → city/query/request ownership and pending-parent equality before save. | O31; `app\app\admin\geography.tsx:65-121,203-255` |
| **CM-F14 · P2 · A** | Rules focus reload clears unsaved drafts; OFF returns a blank route → dirty protection and navigable unavailable state. | O31; `app\app\admin\rules.tsx:35-48,84-87,117-141` |
| **CM-F15 · P1 · A** | Support notification title/body bypass the existing contact masker → mask preview only, retaining complete authorized history. No actual disclosure incident is claimed. | O24; `supabase\migrations\0041_admin_support.sql:469-490`; `0007_chat_unread_notifications.sql:233-250` |
| **CM-F16 · P2 · C** | Required communications composition: dated notification groups, accessible exact time, support context/status/unread separation and non-disruptive history scrolling. **No speculative top-gap patch.** | O24; `app\app\notifications.tsx:97-168`; `app\src\components\SupportConversation.tsx:63-102`; `app\app\chat\[bookingId].tsx:117-123` |
| **CM-F17 · P2 · C** | Required admin-operations hierarchy: actionable queues before reporting, distinct status/unread/time, Settings only after its real route exists. | O30; `app\app\admin\index.tsx:31-78`; `app\app\admin\support\index.tsx:14-23` |
| **CM-F18 · P2 · C** | Required six-screen configuration hierarchy: contextual find/edit/save, not a global generic layout replacement. | O31; exact sections in placement tables below |
| **CM-F19 · P2 · B** | Local support/chat/admin display strings embed QuickServe → consume coordinator's context-specific brand resolver; preserve historical payloads and QS references. | O24/O30; `app\src\components\SupportConversation.tsx:65-68,98-100`; `app\app\support\index.tsx:14`; `app\app\support\new.tsx:21-23`; `app\app\chat\[bookingId].tsx:173-180`; `app\app\admin\index.tsx:27` |

## Screen-by-screen placement audit

“Retain” identifies current correct behavior, not a generic future task. Named assertions below are **requirements, not executed tests**. Full ranges/functions are in the JSON.

### S12 — AI usage

Route/body: `app\app\admin\ai.tsx`; adapter `app\src\features\ai\adminApi.ts`. Primary purpose/action: read telemetry; Retry only on failure. Admin-only historical telemetry remains readable when AI is disabled.

| Element | Current → target / decision | Evidence | Assertion |
|---|---|---|---|
| Header/period | Compact back/title; period timezone implicit → retain compactness, add Today/month (IST). Design F18. | `app\app\admin\ai.tsx:15-30`; `supabase\migrations\0051_ai_usage_v3.sql:173-194` | `CM_AI_PERIOD_CONTEXT` |
| Budget/cost | First card converts micros to USD → retain exact units/read-only budget. | `app\app\admin\ai.tsx:8,33-37` | `CM_AI_UNITS` |
| Requests/model calls | Requests/error plus assistant usage-event count → retain distinct measures; no fallback-call double counting. | `app\app\admin\ai.tsx:39-53`; `supabase\migrations\0051_ai_usage_v3.sql:196-231` | `CM_AI_REQUEST_VS_EVENT` |
| Load/error/zero | Retry/skeleton; backend supplies three zero-filled rows → retain, do not invent outage/empty state. | `app\app\admin\ai.tsx:19-31`; `supabase\migrations\0051_ai_usage_v3.sql:196-210` | `CM_AI_ERROR_RETRY_ZERO` |
| Density/refresh | Focus-only, three feature cards → gated summary then compact existing breakdown; shared clean-view refresh. Design F18. | `app\app\admin\ai.tsx:19-23,38-55` | `CM_AI_LAYOUT_OFF` |

Runtime visibility: **NOT VERIFIED**.

### S16 — Category editor

Route/body: `app\app\admin\category\[id].tsx`, including all conditional nested sections. Primary action: Save category; cities are separate contextual writes.

| Element | Current → target / decision | Evidence | Assertion |
|---|---|---|---|
| OFF/error/not-found | Distinct unavailable/error/loading/not-found/back → retain. | `app\app\admin\category\[id].tsx:305-332` | `CM_CATEGORY_OFF_NOTFOUND` |
| Basics/identity | Name/immutable slug/icon/vertical/parent → retain actual UUID and create-only slug contract. | `app\app\admin\category\[id].tsx:334-370`; `supabase\migrations\0056_home_services_catalogue.sql:314-364` | `CM_CATEGORY_IDENTITY` |
| Booking/schema | Booking type, units, policy, raw JSON share a card → booking type first, advanced schema subordinate; preserve validation. F18. | `app\app\admin\category\[id].tsx:79-115,372-413` | `CM_CATEGORY_SCHEMA_RETAIN` |
| Recurrence | Only fixed/time_based; detailed fields only when allowed → retain. | `app\app\admin\category\[id].tsx:194-212,415-448`; `supabase\migrations\0056_home_services_catalogue.sql:415-449` | `CM_CATEGORY_RECURRENCE` |
| Verification/cities | Restricted/docs then cities after first save → retain inactive creation and distinct city availability. | `app\app\admin\category\[id].tsx:450-507`; `supabase\migrations\0056_home_services_catalogue.sql:555-571,674-707` | `CM_CATEGORY_INACTIVE_CREATE` |
| Saved projection | Client fabricates saved category → read `listCategories`, select returned PK, distinguish write/readback failure. F10. | `app\app\admin\category\[id].tsx:230-256` | `CM_CATEGORY_CANONICAL_READBACK` |
| Save placement | Save/error after every long section → gated persistent footer with dirty/error feedback. F18. | `app\app\admin\category\[id].tsx:334-335,509-513` | `CM_CATEGORY_SAVE_FOOTER` |

Permissions: admin plus editor flag for upsert/reorder; legacy active/city RPCs remain separately admin-only. Runtime: **NOT VERIFIED**.

### S20 — Feature controls

Route/body: `app\app\admin\features.tsx`. Primary action: one authorized runtime switch. Shared presenter internals remain coordinator-owned.

| Element | Current → target / decision | Evidence | Assertion |
|---|---|---|---|
| Registry navigation | Dynamic groups, no search → search returned label/description/key, preserve ordering. F18. | `app\app\admin\features.tsx:44-68`; `supabase\migrations\0042_feature_registry.sql:84-107` | `CM_FLAGS_SEARCH_DYNAMIC` |
| Parent presentation | Shared helper provides indentation/explanation/disabled state → retain; no copied dependency engine. | `app\app\admin\features.tsx:84-119` | `CM_FLAGS_PARENT_CONTRACT` |
| Pending state | Only matching row disabled, full responses replace state → serialize all writes. F11. | `app\app\admin\features.tsx:34-43,70-75,111-116` | `CM_FLAGS_SERIALIZED` |
| Remote switch | Four rows omit server-supported Remote → add existing `archetype:remote`. F12. | `app\app\admin\features.tsx:9-14`; `supabase\migrations\0042_feature_registry.sql:55-80` | `CM_FLAGS_REMOTE` |
| Load/recovery | Parallel reads, Retry/skeleton, server error toast → retain; disabling must not depend on brand-config validity. | `app\app\admin\features.tsx:23-43,50-52` | `CM_FLAGS_RECOVERY` |
| Feedback/obstruction | Existing success toast; actual web image has disclosure overlap → preserve feedback, consume O07 reservation, never hide demo disclosure. | `app\app\admin\features.tsx:34-43`; image `162-admin-feature-registry.png` | `CM_FLAGS_TOAST_OBSTRUCTION` |

Only the described before-web appearance is observed; runtime flag values and save outcomes are **NOT VERIFIED**.

### S22 — Geography

Route/body: `app\app\admin\geography.tsx`; projection `app\src\lib\geographyApi.ts`. Primary action: selected-node add/save, not a global destructive operation.

| Element | Current → target / decision | Evidence | Assertion |
|---|---|---|---|
| Initial failure | Error plus continued skeleton when tree absent → terminal retryable error. F04. | `app\app\admin\geography.tsx:27-37,143-149` | `CM_GEO_INITIAL_ERROR` |
| Hierarchy | Entire nested tree expanded → gated selected ancestry/search/contextual children; keep real parent ids. F18. | `app\app\admin\geography.tsx:150-208` | `CM_GEO_ANCESTRY` |
| Effective visibility | Child says Active from own flag only → preserve configured state, explain inactive ancestor. F18. | `app\app\admin\geography.tsx:283-294`; `app\src\lib\geographyApi.ts:78-101` | `CM_GEO_PARENT_OFF` |
| Search ownership | Awaited shared search/resolve can land in another city's pane → bind city/query/generation, reject stale results. F13. | `app\app\admin\geography.tsx:65-121` | `CM_GEO_STALE_PLACE` |
| Coordinate confirmation | Editable name/coordinates and save/refetch → retain; not proof of city containment. | `app\app\admin\geography.tsx:100-121,236-255`; `supabase\migrations\0046_managed_geography.sql:111-143` | `CM_GEO_SAVE_READBACK` |
| Disable/refresh | Immediate raw switch, initial/mutation load only → explain descendant hiding and refresh clean view; do not cascade/delete child settings. F18. | `app\app\admin\geography.tsx:35-62`; `supabase\migrations\0046_managed_geography.sql:145-190` | `CM_GEO_DISABLE_RETAIN_CHILDREN` |

Admin write; public effective areas require every ancestor active. `area_picker` is not administrative write authority. Runtime: **NOT VERIFIED**.

### S23 — Admin overview

Route/body: `app\app\admin\index.tsx`, including Metric/Action/DailyBars. Primary target action: open actionable work.

| Element | Current → target / decision | Evidence | Assertion |
|---|---|---|---|
| Review queue count | Old KYC predicate feeds Providers/People badge → exact submitted admin-review pending predicate. F09. | `app\app\admin\index.tsx:31-39,64-66`; `supabase\migrations\0041_admin_support.sql:229-247`; `0064_o2_provider_verification.sql:44-54` | `CM_SQL_DASHBOARD_REVIEW_PARITY` |
| Gross amount label | Revenue displays gross paid sum → Gross payments collected; amount unchanged. F09. | `app\app\admin\index.tsx:31-34`; `supabase\migrations\0041_admin_support.sql:242-244` | `CM_DASHBOARD_GROSS_LABEL` |
| Action priority | Metrics/trend before queue links → gated pending work/actions before reporting. No unmeasured fold claim. F17. | `app\app\admin\index.tsx:31-69,104-116` | `CM_ADMIN_QUEUE_ORDER` |
| Settings/shortcuts | Supported routes, no Settings → retain direct destinations; add Settings only after actual O10 route exists. F17. | `app\app\admin\index.tsx:51-68` | `CM_ADMIN_SETTINGS_LINK` |
| Back/error/secondary data | Focus/Retry/skeleton, profile returnTo and secondary top categories → retain; B-resolver only for identity. | `app\app\admin\index.tsx:19-30,70-78` | `CM_ADMIN_BACK_ERROR` |

Admin-only. Separate KYC, admin review and actual public readiness; no money-formula repair is smuggled into this screen. Runtime: **NOT VERIFIED**.

### S28 — Booking rules

Route/body: `app\app\admin\rules.tsx`, RuleInput/ChoiceList; adapters `app\src\lib\adminRulesApi.ts`. Primary action: truthful validated save.

| Element | Current → target / decision | Evidence | Assertion |
|---|---|---|---|
| OFF route | `return null` → navigable unavailable/back, no rule RPC. F14. | `app\app\admin\rules.tsx:35-48,84-87` | `CM_RULES_OFF_ROUTE` |
| Dirty draft | Focus resets both drafts, including after linked settings → dirty preservation/explicit discard. F14. | `app\app\admin\rules.tsx:35-48,117-141` | `CM_RULES_DIRTY_FOCUS` |
| Recurring units | Existing frequency, timing, billing and percent inputs → retain actual rules/converters. | `app\app\admin\rules.tsx:94-121`; `app\src\lib\adminRulesApi.ts:192-205` | `CM_RULES_EXISTING_UNITS` |
| Sports units/limits | Existing hold/fee/refund/payout fields → retain latest cap and exact conversions, not old 100% cap. | `app\app\admin\rules.tsx:123-136`; `app\src\lib\adminRulesApi.ts:207-225`; `supabase\migrations\0080_s2_sports_ops_ux.sql:119-153` | `CM_RULES_SPORTS_BOUNDS` |
| Partial save | Recurring then sports RPC, explicit second-failure message → retain non-atomic truth and failed draft. | `app\app\admin\rules.tsx:50-81` | `CM_RULES_PARTIAL_SAVE` |
| Save priority | One save after both long forms → gated section navigation and persistent dirty/save/error footer. F18. | `app\app\admin\rules.tsx:87-95,144-146` | `CM_RULES_FOOTER` |

Admin plus `admin_rules_editor`; shared helper is consumed, not redefined. Runtime: **NOT VERIFIED**.

### S29 — Services catalogue administration

Route/body: `app\app\admin\services.tsx`. Primary action: find/open/create category; activation/city/reorder remain contextual.

| Element | Current → target / decision | Evidence | Assertion |
|---|---|---|---|
| Search/filter | Name/slug search; All/Repairs/Fixed/Creators only → gated complete existing types/groups. F18. | `app\app\admin\services.tsx:24-26,80-93`; `app\app\admin\category\[id].tsx:32-39` | `CM_SERVICES_FILTERS` |
| Create/empty/editor OFF | Existing rows show New; empty state also offers it; editor controls gated → retain meaningful empty/no-match and legacy availability. | `app\app\admin\services.tsx:80-103,127-150` | `CM_SERVICES_EDITOR_OFF` |
| Identity/status | Name/parent/type/metrics/raw On-Off → retain raw configuration, not “verified” or universally live. | `app\app\admin\services.tsx:105-126`; `supabase\migrations\0056_home_services_catalogue.sql:778-798` | `CM_SERVICES_RAW_VS_LIVE` |
| Reorder | Local 0/10 while server 10/20 → canonical refetch, never rewrite SQL to match bug. F10. | `app\app\admin\services.tsx:50-72`; `supabase\migrations\0056_home_services_catalogue.sql:647-657` | `CM_CATEGORY_ORDER_READBACK` |
| Active/city writes | Manually patched booleans → serialized write plus authorized canonical readback. F10. | `app\app\admin\services.tsx:28-48,151-162` | `CM_CATEGORY_AVAILABILITY_READBACK` |
| Load/bounds | Error/Retry/skeleton/no matches; same-parent boundary controls → retain. | `app\app\admin\services.tsx:19-23,94-103,135-149` | `CM_SERVICES_ERROR_NOT_EMPTY` |

Runtime: **NOT VERIFIED**.

### S32 — Admin support conversation

Wrapper `app\app\admin\support\[id].tsx:1-7` passes `admin`; real body is **`app\src\components\SupportConversation.tsx`**, not a separate admin message engine. Primary action: reply when open; contextual confirmed Reopen when closed.

| Element | Current → target / decision | Evidence | Assertion |
|---|---|---|---|
| Body/mode | Shared body with admin prop → retain; RLS/RPC, not prop, grants authority. | `app\app\admin\support\[id].tsx:1-7`; `supabase\migrations\0041_admin_support.sql:450-459` | `CM_SUPPORT_ADMIN_SCOPE` |
| Context/status | Subject/subtitle/action only → explicit status and authorized booking context; existing confirmed Close/Reopen retained. F16. | `app\src\components\SupportConversation.tsx:45-70` | `CM_SUPPORT_CONTEXT` |
| Missing/stale id | Failed/null read lacks terminal state; old context can remain → keyed load/error/not-found, actions disabled until ready. F06. | `app\src\components\SupportConversation.tsx:14-30,72-87` | `CM_SUPPORT_NOTFOUND_AND_SWITCH` |
| History/refresh | Timestamped cards, focus/local mutation only → shared active incoming reload, preserve draft. F06. | `app\src\components\SupportConversation.tsx:19-43,86-102` | `CM_SUPPORT_CROSS_ROLE_REFRESH` |
| Composer/layout | Outer plus Screen iOS avoidance; footer textarea/Send → one shared keyboard owner, explicit existing length limit; native displacement not claimed. | `app\src\components\SupportConversation.tsx:62-84`; `app\src\components\ui\Screen.tsx:104-135` | `CM_SUPPORT_SINGLE_KEYBOARD_OWNER` |

Runtime: **NOT VERIFIED**.

### S33 — Admin support inbox

Route/body `app\app\admin\support\index.tsx`. Primary action: open the next unread conversation.

| Element | Current → target / decision | Evidence | Assertion |
|---|---|---|---|
| Loading/failure | Initial `[]` and catch `[]` both say Inbox clear → explicit pending/error/Retry/success-empty. F04. | `app\app\admin\support\index.tsx:6-16` | `CM_ADMIN_SUPPORT_FAILURE_NOT_CLEAR` |
| Filter | Open/Closed/All drives server query → retain; reject old-filter response. | `app\app\admin\support\index.tsx:7-15`; `supabase\migrations\0041_admin_support.sql:577-600` | `CM_ADMIN_SUPPORT_FILTER_ORDER` |
| Unread/status | Backend unread-first; one badge hides status if unread → separate both facts. F17. | `app\app\admin\support\index.tsx:17-22`; `supabase\migrations\0041_admin_support.sql:590-599` | `CM_ADMIN_SUPPORT_CLOSED_UNREAD` |
| Identity/time | Subject/preview/coarse actual Provider-Customer; returned time not rendered → add recency/exact time, omit phone. F17. | `app\app\admin\support\index.tsx:17-22`; `app\src\lib\adminApi.ts:281-294` | `CM_ADMIN_SUPPORT_TIME_PRIVACY` |
| Route/refresh | Correct admin thread route; focus only → retain route, refresh active authorized queue after changes. F17. | `app\app\admin\support\index.tsx:9-18`; `app\src\lib\adminApi.ts:390-391` | `CM_ADMIN_SUPPORT_ACTIVE_REFRESH` |

Runtime: **NOT VERIFIED**.

### S41 — Booking chat

Route `app\app\chat\[bookingId].tsx`; real nested bodies `ChatPanel.tsx`, `leakageChat.ts`, unread helpers/context. Primary action: eligible Send.

| Element | Current → target / decision | Evidence | Assertion |
|---|---|---|---|
| Header/back | Counterparty/category/reference and fallback booking route → retain reference format/context. | `app\app\chat\[bookingId].tsx:35-45,125-142` | `CM_CHAT_CONTEXT_REFERENCE` |
| Booking eligibility | Mount-only booking snapshot → existing booking subscription plus focus/resume readback; remove stale Send on remote close. F07. | `app\app\chat\[bookingId].tsx:35-49,130-154`; `supabase\migrations\0052_merchant_staff.sql:374-402` | `CM_CHAT_REMOTE_CLOSE` |
| Message acknowledgement | Error becomes empty; late snapshot overwrites events; successful RPC no refetch → explicit error and PK-based canonical reconciliation. F07. | `app\src\components\ChatPanel.tsx:27-73,93-108`; `app\src\lib\supabaseApi.ts:815-851` | `CM_CHAT_ACK_WITHOUT_REALTIME` |
| Group/unread/Seen | Actual day/sender groups, fixed first-unread divider and latest-own Seen → retain current helpers. | `app\app\chat\[bookingId].tsx:51-84`; `app\src\components\ChatPanel.tsx:111-171`; `app\src\lib\unread.ts:55-70` | `CM_CHAT_UNREAD_RETAIN` |
| Business member state | Latest member writes but primary-only reads → matching member unread/heading/read projection; preserve current primary Seen/push policy. F08. | `supabase\migrations\0052_merchant_staff.sql:306-318`; `0007_chat_unread_notifications.sql:70-90,117-132`; `0032_notification_centre.sql:77-93` | `CM_SQL_CHAT_MEMBER_PROJECTIONS` |
| Safety notice | RPC-returned nudge and masked previews → retain always; B-resolver only for display name, no changed guarantee. | `app\src\lib\leakageChat.ts:16-24`; `app\app\chat\[bookingId].tsx:173-180`; `app\src\lib\unreadContext.tsx:84-108` | `CM_CHAT_NUDGE_OFF` |
| Composer/scroll | Existing footer, 2000 cap/44-point Send; unconditional bottom-scroll → respect older-history reading, consume O07 obstruction space. F16. | `app\app\chat\[bookingId].tsx:117-123`; `app\src\components\ChatPanel.tsx:189-265` | `CM_CHAT_HISTORY_SCROLL` |

Two before-web frames inspected. Native keyboard, send outcome, role/state execution and flags remain **NOT VERIFIED**.

### S56 — Notifications

Route/body `app\app\notifications.tsx`, including actual Row/styles. Primary action: safe event navigation; marking read never performs a business transition.

| Element | Current → target / decision | Evidence | Assertion |
|---|---|---|---|
| Header/top inset | Plain non-large Header, no `safeTop` or spacer → retain. **Large top gap NOT VERIFIED.** | `app\app\notifications.tsx:78-87`; `app\src\components\ui\Screen.tsx:89-93,185-212` | `CM_NOTIFICATIONS_INSET` |
| Acknowledgement | Mark-all row plus swallowed optimistic failure → pending/error/canonical reconcile. F01. | `app\app\notifications.tsx:56-67,97-101` | `CM_NOTIFICATION_READ_ROLLBACK` |
| Event time/order | Mutable transport timestamp → historical exact `created_at` labelled **Record created**; new queue/merge time labelled **Recorded**; projected source marker and no transport retiming. F02. | `supabase\migrations\0032_notification_centre.sql:24-40`; `0007_chat_unread_notifications.sql:465-478` | `CM_SQL_LEGACY_TIMESTAMP_PROVENANCE`, `CM_UI_LEGACY_TIMESTAMP_LABEL`, `CM_SQL_TRANSPORT_RETRY_PROVENANCE` |
| Collapsed new event | New pending content keeps `read_at` → reset only for genuine new merge, not delivery retry. F03. | `app\src\lib\unread.ts:159-193`; `supabase\migrations\0066_h2b_recurring_ux.sql:70-75` | `CM_SQL_COLLAPSE_REREAD` |
| Unread chat without outbox row | Builder only iterates recent notification chats → include authorized unread-map booking with guarded heading/no fake preview. F08. | `app\src\lib\unread.ts:159-193`; `app\src\lib\unreadContext.tsx:42-61` | `CM_CHAT_MEMBER_NOTIFICATION_ITEM` |
| Card contract | Icon/title/relative time/context/body/unread cues already present → retain, add accessible exact time/contextual navigation cue. F16; support preview masking F15. | `app\app\notifications.tsx:112-168`; `app\src\lib\unread.ts:89-121` | `CM_NOTIFICATION_CARD_CONTRACT` |
| Group/window/count | Flat rows plus raw Loaded count; 60-row request → provenance-specific **Records created / Activity recorded / Messages** date groups, **Date unavailable** for unknown source, honest recent-window metadata. F16. | `app\app\notifications.tsx:45-50,102-107`; `supabase\migrations\0032_notification_centre.sql:35-40` | `CM_NOTIFICATION_DATE_GROUPS` |
| Load/empty/refresh | Four skeletons, Retry, empty, focus/pull; opening marks nothing read → retain. | `app\app\notifications.tsx:45-54,69-95` | `CM_NOTIFICATION_OPEN_NOT_READ` |

No Notifications screenshot inspected. Actual device safe-area/whitespace and interaction results: **NOT VERIFIED**.

### S84 — Participant support conversation

Wrapper `app\app\support\[id].tsx:1-7`; real shared body `app\src\components\SupportConversation.tsx`. Same thread PK as admin view, personal scope. Primary: reply/Reopen.

| Element | Current → target / decision | Evidence | Assertion |
|---|---|---|---|
| Participant scope | Unscoped direct reads inherit admin-wide RLS → explicit owner-scoped adapter before message fetch. F05. | `app\src\lib\adminApi.ts:399-409`; `app\src\components\SupportConversation.tsx:87-99` | `CM_SUPPORT_PERSONAL_DETAIL_SCOPE` |
| Status/context | Subject/subtitle/action, no booking context → explicit status and authorized booking link, retain confirmation. F16. | `app\src\components\SupportConversation.tsx:45-70`; `app\src\lib\adminApi.ts:296-308` | `CM_SUPPORT_PARTICIPANT_CONTEXT` |
| Load/not-found | Missing/error can leave skeleton/editable composer → current authorized ready-thread required. F06. | `app\src\components\SupportConversation.tsx:14-30,72-87` | `CM_SUPPORT_PARTICIPANT_LOAD` |
| Incoming readback | Focus/local writes only → same-PK active refresh and appropriate inbox invalidation, preserving draft. F06. | `app\src\components\SupportConversation.tsx:19-43,86-102` | `CM_SUPPORT_REMOTE_REPLY` |
| Composer/identity | Duplicate keyboard owners, no explicit client length cap, local QuickServe copy → shared layout, existing cap, B-resolver; preserve closed UI flow. F16/F19. | `app\src\components\SupportConversation.tsx:62-84`; `supabase\migrations\0041_admin_support.sql:469-473` | `CM_SUPPORT_COMPOSER_RETAIN` |

Runtime: **NOT VERIFIED**.

### S85 — Personal support inbox

Route/body `app\app\support\index.tsx`. Primary: open thread; Start a conversation in an empty inbox.

| Element | Current → target / decision | Evidence | Assertion |
|---|---|---|---|
| Personal ownership | All RLS-visible rows can mean every user's thread for admins → explicit signed-in owner filter, separate admin queue. F05. | `app\src\lib\adminApi.ts:393-397`; `supabase\migrations\0041_admin_support.sql:454-459` | `CM_SUPPORT_PERSONAL_LIST_SCOPE` |
| Loading/recovery | Blank initial body, sticky error/no Retry → explicit pending, reset/retry, successful empty only. F04. | `app\app\support\index.tsx:6-16` | `CM_SUPPORT_ERROR_RECOVERY` |
| Recency | Subject/two-line preview, no returned time → add relative/exact last-message time. F16. | `app\app\support\index.tsx:18-23`; `app\src\lib\adminApi.ts:296-308` | `CM_SUPPORT_LIST_TIME` |
| Status/unread | Closed hides unread count → show independent status/count; no invented status enum. F16. | `app\app\support\index.tsx:20-22`; `supabase\migrations\0041_admin_support.sql:561-575` | `CM_SUPPORT_CLOSED_UNREAD` |
| Start/footer | Already sticky/reachable → retain; only brand resolver changes display subtitle. | `app\app\support\index.tsx:14-16` | `CM_SUPPORT_START_FOOTER` |

Runtime: **NOT VERIFIED**.

### S86 — Start support

Route/body `app\app\support\new.tsx`. Primary: submit then navigate to server-returned thread id.

| Element | Current → target / decision | Evidence | Assertion |
|---|---|---|---|
| Booking context | Generic linked explanation/subject → pass null subject for existing server booking-derived context; preserve exact primary-participant authorization. F16. | `app\app\support\new.tsx:7-16,26-30`; `supabase\migrations\0041_admin_support.sql:505-520` | `CM_SUPPORT_BOOKING_SUBJECT` |
| General subject | Visible/required only without booking, max 120 → retain. | `app\app\support\new.tsx:23-30`; `supabase\migrations\0041_admin_support.sql:515-520` | `CM_SUPPORT_SUBJECT_RULE` |
| Message/privacy | Guidance only placeholder, no cap → visible guidance plus existing 2000 cap/counter; preview masking fixed separately in SQL. F16/F15. | `app\app\support\new.tsx:25-31`; `supabase\migrations\0041_admin_support.sql:469-473`; `app\src\components\ui\Input.tsx:124-132` | `CM_SUPPORT_NEW_MESSAGE_LIMIT` |
| Submit/readback | Busy/error preserves input, replace to returned id → retain canonical identity and one-submit guard. | `app\app\support\new.tsx:12-18`; `app\src\lib\adminApi.ts:411-412` | `CM_SUPPORT_START_RETURN_ID` |
| Footer/brand | Already sticky full-width send → retain placement; context-specific brand only, no invented contacts/SLA. | `app\app\support\new.tsx:21-24` | `CM_SUPPORT_NEW_BRAND_OFF` |

Runtime: **NOT VERIFIED**.

## Entity lifecycle, roles, actions and refresh

### Notification — actual independent states

| Contract | Actual source-backed rule |
|---|---|
| Identity | `notifications.id` UUID PK. Partial uniqueness `(user_id,collapse_key)` **only while pending**. Derived `chat:booking_id` is not the notification PK. |
| Delivery | `pending`, `sending`, `sent`, `failed`, `skipped`. These do not mean paid/accepted/read. |
| Non-chat read | `read_at` null/non-null; recipient acknowledgement, not list-open. |
| Chat read | `(booking_id,user_id)` PK in `booking_chat_reads`; other-sender messages newer than `last_read_at`. Notification `count` is not chat unread. |
| Read projection | `id,kind,title,body,data,count,booking_id,category_name,at,read_at`; no transport status exposed as a business badge. |
| Route | Existing internal allowlist including support/admin-support, earnings, merchant RFQ, recurring-provider and dashboard alias. Destination independently authorizes access. |
| History limit | Client requests 60, server caps 100, old delivered/skipped/failed records can be pruned after 30 days. No permanent archive promise. |

Evidence: `supabase\migrations\0007_chat_unread_notifications.sql:15-31,187-218,529-541`; `0032_notification_centre.sql:24-98`; `app\src\lib\unread.ts:89-204`.

| Actor / from → to | Allowed action / predicate | Readback and other-view effect |
|---|---|---|
| Internal event → pending | `_queue_notification`; same pending recipient/collapse key merges count/content. Current read-reset/time defects are F02/F03. | Recipient list/items; preserve latest `0066` recurring URL enrichment. |
| Worker pending due/stuck sending → sending | Service-only `claim_due_notifications`, lock/skip-locked; attempts increment. Read chat/no device → skipped. | Transport only; must not reorder event history after T02. |
| Worker claimed → sent/retry/failed | `finish_notification`; success sets sent_at; failures back off, terminal at attempts≥5. | Read-state/business status unchanged. |
| Recipient unread → read | `mark_notifications_read`, own user id and optional own ids; idempotent. | List plus non-chat unread count; no booking/payment mutation. |
| Chat reader → monotonic read/presence | Existing authorized `mark_chat_read`; 45-second presence, 20-second screen heartbeat. | Chat unread clears; pending own chat pushes skipped. |
| Message sender → own read advanced | Latest message trigger; primary counterpart push unless viewing; backdated messages do not create news. | Existing push recipients remain customer/owner; no new staff fan-out assumed. |

Evidence: `supabase\migrations\0066_h2b_recurring_ux.sql:31-76`; `0007_chat_unread_notifications.sql:441-567`; `0052_merchant_staff.sql:411-431`; `0010_notification_freshness.sql:9-48`.

| Role | Sees/can | Cannot / retained invariant | Named acceptance |
|---|---|---|---|
| Customer/provider/merchant/venue owner/creator, as recipient | Own list/count/acknowledgement; safe destination | No foreign recipient rows; no entity action inferred from kind | `CM_SQL_NOTIFICATION_RECIPIENT` |
| Admin recipient | Own rows; an admin-support destination can invoke separate admin authority | No administrator-wide notification RPC exception | `CM_SQL_NOTIFICATION_ADMIN_IS_RECIPIENT_ONLY` |
| Active business owner/manager/staff | Existing chat read/send/read-mark with `merchant_staff`; T06 aligns in-app reads | OFF/inactive removes membership grants; no automatic admin override or push fan-out | `CM_SQL_CHAT_MEMBER_PROJECTIONS`, `CM_SQL_CHAT_MEMBER_FLAG_OFF` |
| Outsider/guest | No foreign communications; guest execute denied | No transport-worker execution | `CM_SQL_TRANSPORT_EXECUTE_DENIED` |
| Service worker | Claim/finish/receipt cleanup | Delivery success is not read/paid/accepted | `CM_SQL_EVENT_TIME`, `CM_SQL_TRANSPORT_READ_INDEPENDENCE` |

**Refresh:** S56 focus/pull, UnreadProvider sign-in/foreground/60-second active count polling and debounced message reconciliation; S41 focused read heartbeat. T01/T02/T06 repair persistence and missing in-app chat items; O38R supplies typed invalidation. Evidence: `app\src\lib\unreadContext.tsx:32-138`; `app\app\notifications.tsx:45-108`; `app\app\chat\[bookingId].tsx:51-110`.

### Support thread — no invented lifecycle

| Contract | Actual rule |
|---|---|
| Identity/fields | Thread UUID PK; personal `user_id`; optional booking FK; subject; status; independent user/admin unread; last-message/from-admin/time and created time. Message UUID PK plus thread FK, sender, from_admin, body, created time. Full field constraints in JSON. |
| States | Exactly `open`, `closed`. No pending/resolved universal support enum is present. |
| Ownership | Owner OR current administrator reads through RLS; direct table writes revoked. Latest admin identity is **admins-table membership**, not the removed phone allowlist. |
| Linked creation | Exact booking customer/provider only. A business membership or generic admin role alone does not grant linked-start authority. |
| Reuse | Sequential linked start reuses latest own open thread; no composite unique constraint guarantees concurrent uniqueness. |
| Closed send | Server **permits authorized send on closed and reopens**. UI asks for explicit confirmed Reopen first. This conservative UI is not a missing backend guard. |

Evidence: `supabase\migrations\0041_admin_support.sql:424-621`; `0059_admin_identity_hardening.sql:7-30`; `app\src\lib\adminApi.ts:281-317,390-416`.

| Actor/action | From → to and actual counters | Readback / other roles |
|---|---|---|
| Authenticated general-help start | New open thread plus message; body trimmed 1..2000, subject ≤120/fallback | Navigate to returned UUID, not a locally generated id. |
| Primary booking participant start | Reuse own open linked thread or create new open | Same returned thread PK in participant/admin projections. |
| Owner send | Open **or closed** → open; `from_admin=false`; user unread=0, admin unread+1 | Latest message/time; support admin notification to eligible admins. |
| Non-owner admin send | Open **or closed** → open; `from_admin=true`; admin unread=0, user unread+1 | Owner support_reply notification; personal inbox readback. |
| Admin who owns the thread sends | Owner branch wins, `from_admin=false` | A UI `admin` prop does not override this rule. |
| Owner mark read | User unread → 0, status unchanged | Own list updates on authorized refetch. |
| Non-owner admin mark read | Admin unread → 0, status unchanged | Admin queue/overview aggregate updates on refetch. |
| Owner/admin close/reopen | Open↔closed; counters/messages retained | Existing confirmation; canonical thread reload. |
| Outsider/guest | Reads/mutations denied/not found; no state change | No leaked old content or enabled composer during failure. |

Evidence: `supabase\migrations\0041_admin_support.sql:469-600`; `app\src\components\SupportConversation.tsx:19-59`.

| Role | Available / unavailable actions | Acceptance using the same entity PK |
|---|---|---|
| Customer | Own general/own-booking support, reply/read/close/reopen; no foreign thread | `CM_SQL_SUPPORT_OWNER_LIFECYCLE` |
| Provider/merchant/venue owner/creator | Same personal support; role_provider is not an eligibility gate | `CM_SQL_SUPPORT_ROLE_NEUTRAL_START` |
| Manager/staff | Own general support; not automatically business owner's thread or linked booking | `CM_SQL_SUPPORT_LINKED_PARTICIPANT_ONLY` |
| Non-owner admin | Admin list/detail, reply/read/close/reopen | `CM_SQL_SUPPORT_ADMIN_LIFECYCLE`, `CM_SUPPORT_CROSS_ROLE_REFRESH` |
| Admin personal participant | Own-only personal list after T03; owner-first server semantics | `CM_SUPPORT_PERSONAL_LIST_SCOPE`, `CM_SQL_SUPPORT_ADMIN_OWNER_BRANCH` |
| Outsider/guest | Cannot read/send/change another thread | `CM_SQL_SUPPORT_OTHER_DENIED`, `CM_SUPPORT_NOTFOUND_AND_SWITCH` |

**Refresh:** Current shared body loads on focus and after local send/status change, not incoming activity. T04 adds actor/scope/thread-keyed load state and O38R focused-active fallback (60 seconds), foreground refresh, canonical mutation readback and authorized list/overview invalidation. Draft survives a same-thread refresh, not an actor/thread switch. Support counters and notification `read_at` remain separately named systems; reading a thread is not falsely claimed to acknowledge every support notification.

### Other owned endpoint contracts

| Screens | Latest endpoint/guard and retained behavior |
|---|---|
| S12 | `admin_ai_usage_dashboard` in `0051_ai_usage_v3.sql:173-249`; admin-only, three feature aggregates, requests versus model events, IST boundaries, historical reads retained. |
| S16/S29 | `admin_upsert_category`/`admin_reorder_categories`: admin + editor flag; latest `0056_home_services_catalogue.sql:280-741`. New inactive, immutable slug, all-sibling order. `admin_set_category_city` remains legacy admin-only (`0041_admin_support.sql:185-207`); restricted activation requires docs. |
| S20 | `0042_feature_registry.sql:28-112`: public raw read; admin metadata/write; registry missing key false; archetypes separate, including Remote. Shared effective-parent presentation is retained. |
| S22 | `0046_managed_geography.sql:3-84,91-198`: hierarchy PK/FK/coordinate checks and admin write. Public effective areas additionally filter active ancestors in `geographyApi.ts:78-101`. No invented containment/cascade policy. |
| S23 | `0041_admin_support.sql:211-276` remains latest dashboard body; compare pending review to current `0064_o2_provider_verification.sql:14-60`. T07 changes the narrow count/label only. |
| S28 | `0054_addendum_foundations.sql:73-90` read; latest write `0080_s2_sports_ops_ux.sql:35-169`; admin/editor guard. Recurring full object, sports allowed patch merge; exact integer units and current limits retained. |
| S41 | `0052_merchant_staff.sql:306-431`: existing participant/team authority; chat closed only for pending_payment/declined/expired/cancelled. Admin alone is not a participant. |

## Notification card contract

1. **Event → context → meaning → time → unread → safe next destination.** Existing relative time/unread styling is retained; accessible exact time and date headings are added. No missing timestamp allegation is made.
2. `NotificationCard({ item: NotificationItem, exactTimeLabel, pendingRead, onOpen })` is presentational only. It does not derive authorization, payment status or a booking transition.
3. Keep `notificationRoute`, `buildNotificationItems`, `firstUnreadIndex` and `seenMessageId`; do not introduce a parallel status engine. Extend the existing item builder for authoritative unread chats absent from the recent outbox window; missing preview stays absent.
4. `groupNotificationItems(items, now, timeZone)` returns ordered `{key,label,items}` groups with **Records created / Activity recorded / Messages** prefixes and **Date unavailable** for unknown source. `formatNotificationExactTime(item,timeZone)` delegates to CM-T02's always-on `notificationTimePresentation`, preserving the selected timestamp's provenance rather than defining another meaning. Notifications use **Asia/Kolkata**, matching the existing dated `shortAgo` branch, not a new global booking timezone policy.
5. One chat aggregate per booking; non-chat key is notification UUID. Unread chat count comes from chat read-state, never collapsed notification count.
6. No image, price, rating, verified badge or inline Accept/Pay/Refund/Verify is invented. A historical event is not current authorization.
7. Four row skeletons, retryable list error, genuine empty state; unread no-route can acknowledge, read no-route is disabled. Long decisive text wraps/increases height.
8. Support preview masking changes only notification preview; private support message history remains complete.

Source: `app\app\notifications.tsx:112-168`; `app\src\lib\unread.ts:89-204`; `supabase\migrations\0032_notification_centre.sql:24-75`.

Named assertions: `CM_NOTIFICATION_CARD_CONTRACT`, `CM_NOTIFICATION_SAFE_ROUTES`, `CM_NOTIFICATION_CHAT_AGGREGATE`, `CM_CHAT_MEMBER_NOTIFICATION_ITEM`, `CM_NOTIFICATION_DATE_GROUPS`, `CM_NOTIFICATION_READ_ROLLBACK`, `CM_COMMS_PRESENTATION_MATRIX`.

### CM-T02 — selected timestamp provenance contract

**This technical shape is decided, not a future implementation choice.** Historical record creation is known; historical last-collapse time is not. No new business policy is introduced.

| Layer | Required implementation meaning |
|---|---|
| Schema / historical backfill | Add nullable `notifications.event_at` with **DEFAULT NULL**. Leave it **NULL on every pre-migration row**. Preserve each exact original `created_at`, `updated_at` and stored title/body/data. Do **not** fill historical `event_at` from `now()` or `updated_at`; do not claim a recovered last-event timestamp. |
| New insert | `_queue_notification` explicitly sets `event_at=now()`: notification queue transaction time, not inferred original business-event occurrence or push delivery. |
| Genuine merge | Same pending PK/count merge explicitly sets `event_at=now()` and `read_at=NULL`, preserving original `created_at`. This promotes a legacy row only because a **new known event** has now been queued. Equal transaction-clock instants need no fabricated strict increment. |
| Transport | Claim/retry/finish/skip/receipt operations never write `event_at` or `created_at`; their `updated_at`/attempt/status changes do not change displayed time or provenance. |
| RPC compatibility | Keep `list_my_notifications(int)` input signature, existing returned columns/types, recipient checks and grants; use replacement without dropping the RPC. Return and sort `at` from **coalesce(event_at,created_at)**. Mixed history is ordered by its explicitly displayed basis, not reconstructed historical last activity. |
| Explicit source marker | For object `data`, project server-derived **`data._notification_time_source`** as **`legacy_created_at`** when `event_at` is NULL, otherwise **`queued_event`**. Overlay after payload keys so payload cannot spoof provenance. Projection only: stored historical `data` is untouched. Preserve malformed non-object legacy `data` unchanged; client treats absent marker as unknown instead of guessing. |
| Client type | Existing RPC-facing `AppNotification` fields remain unchanged (`data` already carries metadata). Extend internal `NotificationItem.timeSource` to `legacy_created_at` / `queued_event` / `message_created_at` / `unknown`. Missing/invalid marker is unknown. |
| Chat selection | Preserve the existing timestamp-selection comparison. When authoritative `unread.last_message_at` actually supplies the selected `at`, mark **message_created_at**, not the base outbox row's source. Otherwise retain that selected row's provenance. T06 synthesized chat items use a valid selected message time or unknown, never invented `now`. |
| Shared formatter | In `app\src\lib\unread.ts`, `notificationTimePresentation(item,now,timeZone)` returns `{label,accessibilityLabel}`. Reuse `shortAgo`; provenance must not be delegated to that relative-only helper. Future card/exact-time formatting delegates to this same formatter. |
| Legacy UI, always Class A | Visible: **“Record created &lt;relative time&gt;”**. Accessible: **“Notification record created &lt;exact date/time with timezone&gt;; latest historical activity time is unknown.”** Never call this Updated, Latest activity or Last event. |
| Known queue UI | Visible: **“Recorded &lt;relative time&gt;”**. Accessible: **“Notification event queued or merged &lt;exact date/time with timezone&gt;.”** |
| Selected message UI | Visible: **“Message &lt;relative time&gt;”**. Accessible: **“Message created &lt;exact date/time with timezone&gt;.”** |
| Unknown/invalid UI | Visible **Time unavailable**; accessible **Notification time source is unavailable**. No relative event time or dated bucket; use **Date unavailable**. |
| Flag behavior | Apply the label/announcement in the **current Row immediately**, including all Oorva flags OFF; do not defer truthful legacy meaning to the gated new card. Class-C group headings use **Records created Today/Yesterday/date**, **Activity recorded Today/Yesterday/date**, or **Messages Today/Yesterday/date** according to the displayed basis. |

This uses the already-read RPC's existing `data`/`at` fields and `AppNotification`/`NotificationItem` mapping (`app\src\lib\unread.ts:124-204`), avoiding a new RPC output field, changed grant contract or persisted historical payload rewrite.

#### Exact additional acceptance assertions

All are implementation requirements, **not executed tests**. Use isolated fixtures, a fixed legacy creation timestamp **C**, a distinctly later historical transport timestamp **U**, and captured database transaction time for new queue writes.

| Named assertion / test file | Required checked values |
|---|---|
| `CM_SQL_LEGACY_TIMESTAMP_PROVENANCE` — `supabase\tests\oorva_communications.test.mjs` | Pre-upgrade collapsed row (`count>1`): after migration `event_at IS NULL`, original `created_at=C` exactly, stored title/body/data unchanged; RPC `at=C`, **not U or migration time**, marker `legacy_created_at`. |
| `CM_UI_LEGACY_TIMESTAMP_LABEL` — `app\src\components\__tests__\NotificationsScreen.test.tsx` | Legacy visible/accessible strings above, exact C/timezone and explicit unknown historical activity; never Updated/Latest activity/Last event. Assert with cosmetic flags OFF and ON. |
| `CM_SQL_NEW_EVENT_TIMESTAMP_PROVENANCE` — SQL suite | New queue insert: `event_at` and projected `at` equal captured queue transaction time; marker `queued_event`; no grant/signature change. |
| `CM_SQL_LEGACY_MERGE_PROMOTION` — SQL suite | Genuine event merges into legacy pending row: same id and exact original C retained, count increments, read clears, `event_at` becomes captured new queue time and marker becomes `queued_event`. |
| `CM_SQL_EVENT_MERGE_TIME` — SQL suite | Already-new pending row merged again: original creation/id remain, new `event_at` is actual current transaction time, source stays `queued_event`; do not require a fictitious increment for equal clock instants. |
| `CM_SQL_TRANSPORT_RETRY_PROVENANCE` / `CM_SQL_EVENT_TIME` — SQL suite | Separate legacy, new and merged fixtures cover claim, failed finish/retry, successful finish and skip. `updated_at`, attempts/status may change; `created_at`, `event_at`, projected `at`, marker and relative order do not. |
| `CM_SQL_PROVENANCE_MARKER_AUTHORITY` — SQL suite | A contradictory same-named object payload key cannot override server-derived projected source; stored payload stays unchanged. Non-object legacy payload is not rewritten or treated as a trustworthy source marker. |
| `CM_UI_TIMESTAMP_SOURCE_FALLBACK` — `app\src\lib\__tests__\unread.test.ts` and screen test | Missing/invalid source or invalid timestamp gives Time unavailable/unknown-source announcement/Date unavailable, never “now” or a guessed event date. |
| `CM_UI_CHAT_TIMESTAMP_PROVENANCE` — `app\src\lib\__tests__\unread.test.ts` | A selected authoritative message timestamp gets message provenance/labels; when base row timestamp wins, its legacy/queued provenance remains. Verify also with Oorva OFF. |

Retain the existing collapse-reread, transport/read independence, recipient-only, worker-grant, recurring-route and nonblocking money-notification assertions. Failure diagnostics include serialized actual timestamps, marker, row identity, counters and stored/projected payload as applicable, without real personal data.

## Exact remediation tasks

These are executable repairs derived from this completed audit, not future “investigate the screen” tasks. New test files below are proposed artifacts, not claimed existing. The detailed JSON lists every exact file/function and assertion.

All shared new communications SQL uses `supabase\migrations\<MIG-SQL-N>_oorva_communications_truth.sql`. **Numeric version: UNASSIGNED until shared coordinator acknowledgment.** `<MIG-SQL-N>` is an explicit coordinator-substituted execution-metadata claim token, not a reserved numeric filename, permission to infer `max(main)+1`, or a literal filename to write. T02→T06→T07 share **one serial SQL lane** and `supabase\tests\oorva_communications.test.mjs`; other task test requirements are supplied there, not by concurrent file writers.

| Task / findings / owner | Exact edits and dependencies | Named acceptance / files |
|---|---|---|
| **CM-T01** F01 · O24 · A | `app\app\notifications.tsx::markRead/open`: guard pending ids, reconcile failed/successful read, distinguish navigation error. Independent. | `CM_NOTIFICATION_READ_ROLLBACK`, `CM_NOTIFICATION_MARK_ALL_CHAT_INDEPENDENT`; new `app\src\components\__tests__\NotificationsScreen.test.tsx`. Concurrency review. |
| **CM-T02** F02/F03/F15 · O24 · A | **After T01** (shared Row file). Apply the selected provenance contract above: nullable legacy-NULL `event_at`, exact original creation retained, explicit queue/merge time, signature-compatible projected marker, current Row/internal item provenance/formatter now, transport unchanged; `_support_post` preview masking only. SQL still uses `<MIG-SQL-N>`. | All nine provenance assertions above, plus existing event/collapse/read/privacy/recipient/grant/recurring safety cases. SQL suite plus `app\src\lib\__tests__\unread.test.ts` and new `NotificationsScreen.test.tsx`; retain B6 assertions in `cancellation_payouts.test.mjs`. Concurrency review. |
| **CM-T03** F04/F05 · O24 with O30 · A | `app\src\lib\adminApi.ts`: personal owner filter and `loadSupportConversation(threadId,scope,actorId) -> {thread,messages}`; owner query before personal message fetch. Personal wrapper/inbox plus admin inbox load/filter states. Independent; T04 adopts adapter. | `CM_SUPPORT_PERSONAL_LIST_SCOPE`, `CM_SUPPORT_PERSONAL_DETAIL_SCOPE`, `CM_ADMIN_SUPPORT_FAILURE_NOT_CLEAR`, `CM_SUPPORT_ERROR_RECOVERY`, `CM_ADMIN_SUPPORT_FILTER_ORDER`; new `supportApi.test.ts`, `SupportInboxes.test.tsx`. Auth review. |
| **CM-T04** F06 · O24 · A | `app\src\components\SupportConversation.tsx`: scoped keyed load, terminal states, current-thread action guard, serialized close, canonical readback/shared active refresh, one keyboard owner. After T03. | `CM_SUPPORT_NOTFOUND_AND_SWITCH`, `CM_SUPPORT_CROSS_ROLE_REFRESH`, `CM_SUPPORT_REMOTE_REPLY`, `CM_SUPPORT_SINGLE_KEYBOARD_OWNER`; new `SupportConversation.test.tsx`, SQL owner/admin/owner-first/linked-start assertions. Concurrency review. |
| **CM-T05** F07 · O24 · A | `app\app\chat\[bookingId].tsx` reuses `subscribeToBooking`; `ChatPanel.tsx::useChat` adds phase/reload, keyed reconciliation, post-send/resume readback. Independent. | `CM_CHAT_REMOTE_CLOSE`, `CM_CHAT_ACK_WITHOUT_REALTIME`, `CM_CHAT_SNAPSHOT_EVENT_MERGE`, `CM_CHAT_ERROR_NOT_EMPTY`, `CM_CHAT_CLOSED_SERVER_RETAIN`; new `ChatScreen.test.tsx`, `ChatPanel.test.tsx`. Concurrency review. |
| **CM-T06** F08 · O24/O38I · A | Same serial migration: fix `get_unread_counts`, `get_chat_read_state`, `get_chat_heading` using existing membership guard. Extend `app\src\lib\unread.ts::buildNotificationItems` and notifications load for missing authorized chat rows/headings. After T01/T02. | `CM_SQL_CHAT_MEMBER_PROJECTIONS`, `CM_SQL_CHAT_MEMBER_FLAG_OFF`, `CM_SQL_CHAT_PRIMARY_SEEN_RETAIN`, `CM_CHAT_MEMBER_NOTIFICATION_ITEM`, actor-change heading assertion; extend existing `app\src\lib\__tests__\unread.test.ts`. Auth review. |
| **CM-T07** F09 · O30 · A | Same serial migration: narrow `admin_dashboard` review count; `app\app\admin\index.tsx` truthful KYC/gross labels, no arithmetic change. After T06. | `CM_SQL_DASHBOARD_REVIEW_PARITY`, `CM_DASHBOARD_GROSS_LABEL`, `CM_SQL_ADMIN_ENDPOINT_DENIED`; SQL suite/new `AdminDashboardScreen.test.tsx`. Auth review. |
| **CM-T08** F10 · O31 · A | `app\app\admin\services.tsx` and `category\[id].tsx`: canonical post-mutation `listCategories`, remove synthetic saved row/0-based order; serialize/conflict-safe readback. Independent. | `CM_CATEGORY_ORDER_READBACK`, `CM_CATEGORY_CANONICAL_READBACK`, `CM_CATEGORY_AVAILABILITY_READBACK`, `CM_CATEGORY_INACTIVE_CREATE`, `CM_SERVICES_EDITOR_OFF`; new `AdminCategoriesScreen.test.tsx`, retain `adminCategoryApi.test.ts`. Concurrency review. |
| **CM-T09** F11/F12 · O31 · A | `app\app\admin\features.tsx`: immediate one-write lock, every switch pending, actual error, add Remote. No shared flag-internal edits. Independent. | `CM_FLAGS_SERIALIZED`, `CM_FLAGS_FAILURE_RETAINS_STATE`, `CM_FLAGS_REMOTE`, `CM_FLAGS_REMOTE_OORVA_OFF`, `CM_FLAGS_PARENT_CONTRACT`; new `AdminFeaturesScreen.test.tsx`. Concurrency review. |
| **CM-T10** F04/F13 · O31 · A | `app\app\admin\geography.tsx`: terminal error, city/query/session/generation-bound results, pending-parent equality, clean-view refresh. Independent. | `CM_GEO_INITIAL_ERROR`, `CM_GEO_STALE_PLACE`, `CM_GEO_STALE_QUERY`, `CM_GEO_SAVE_PARENT_MATCH`; new `AdminGeographyScreen.test.tsx`. Concurrency review. |
| **CM-T11** F14 · O31 · A | `app\app\admin\rules.tsx`: saved/dirty groups, protected navigation, explicit OFF/back, retained partial-save/error/unit behavior. Independent. | `CM_RULES_DIRTY_FOCUS`, `CM_RULES_OFF_ROUTE`, `CM_RULES_PARTIAL_SAVE`; new `AdminRulesScreen.test.tsx`, retain exact `adminRulesApi.test.ts` boundaries. |
| **CM-T12** F16 · O24 · C | New `NotificationCard.tsx`, `notificationPresentation.ts`; notifications/support/chat composition in their existing bodies; explicit support context, exact time, protected history scroll. After T01/T02/T03/T04/T05/T06 and coordinator contracts. | New `notificationPresentation.test.ts`, `NotificationCard.test.tsx`, `CommunicationsPresentation.test.tsx`: date/card/context/closed-unread/booking-subject/history-scroll and ON/OFF/parent-OFF assertions. |
| **CM-T13** F17 · O30 · C | `app\app\admin\index.tsx`, `support\index.tsx`: queues before reporting, separate status/unread/time, valid Settings after O10 target exists. After T03/T07. | `CM_ADMIN_QUEUE_ORDER`, `CM_ADMIN_SUPPORT_CLOSED_UNREAD`, `CM_ADMIN_SUPPORT_TIME_PRIVACY`, `CM_ADMIN_SETTINGS_LINK`, `CM_ADMIN_OPS_PRESENTATION_MATRIX`. |
| **CM-T14** F18 · O31 · C | Exact six files `admin\ai.tsx`, `category\[id].tsx`, `features.tsx`, `geography.tsx`, `rules.tsx`, `services.tsx`: screen-specific find/edit/save order above. After T08/T09/T10/T11. | New `AdminConfigPresentation.test.tsx`: IST/units, category/rules footer, dynamic registry search, ancestry/effective visibility, all type filters, ON/OFF/parent-OFF and draft preservation. |
| **CM-T15** F19 · O24/O30 · B | Local support/chat/admin strings consume coordinator resolver; preserve historical notification bodies/references/technical identity. After T12/T13. Future outbound identity stays O35SQL. | New `CommunicationsBrand.test.tsx`: `CM_COMMS_BRAND_CONTEXT`, `CM_SUPPORT_NEW_BRAND_OFF`, `CM_HISTORICAL_PAYLOAD_UNCHANGED`, `CM_CHAT_CONTEXT_REFERENCE`. |

### Shared implementation contracts / safety

- **A always applies.** New composition is not a reason to postpone unread, permissions, stale actions, load truth, runtime controls or dirty protection.
- **B** consumes coordinator `oorva_brand`; OFF preserves context-specific legacy identity, not a blanket rename.
- **C** consumes proposed effective parent+leaf gates: `oorva_comms_ux`, `oorva_admin_ops_ux`, `oorva_admin_config_ux`, each requiring `oorva_brand`, default OFF. These keys/helpers are **design dependencies, not existing frozen-source claims**.
- Coordinator owns `adminFeaturePresentation`/flag engine, primitives/root, O07 obstruction, O10 new Settings route, O38R typed invalidation and migration ordering. CM does not edit or duplicate those internals.
- Reuse existing `subscribeToBooking`, `useFocusEffect`, AppState and typed domain helpers. Shared fallback: one focused-active 60-second refresh, stopped on blur/background. Clear actor-sensitive data on permission loss; never share private rows across roles.
- Historical messages/references/receipt identities remain intact. No UI flag gates payment recording/refunds/settlement/expiry/cancellation safety.
- SQL acceptance scenarios use `createHarness()/scenario()`, isolated fixtures and explicit casts. A cross-role workflow compares the **same PK**, but different scenarios never reuse fixtures. Every assertion prints serialized actual rows/state.
- Coordinator O37A registers migration parse/new SQL suite in `supabase\tests\package.json`; `run-all.mjs:10-23` consumes those registrations. No shared registration/workflow file was changed.
- Focused implementation auth/concurrency review is required only where marked; no automatic review agent or model run occurred.

## Retain / no-change conclusions

1. Notifications already have a compact header, per-row relative timestamps, unread visual/accessibility cues, safe internal routes, real loading/error/empty states, chat aggregation and no mark-all on list open. **Do not manufacture a top-gap or missing-timestamp defect.**
2. Chat closed-state SQL remains authoritative; it denies the four explicit statuses, not every terminal-looking string. Existing day grouping, unread divider, Seen helper, protected-message nudge, preview masker and input cap are retained.
3. Support owner/admin authorization, latest admins-table identity, explicit UI close/reopen confirmation and **server send-reopens** semantics are retained. No inferred stricter closed-thread policy or delegated-business support access.
4. Admin support backend already sorts unread first. The repair is truthful load/state presentation and refresh, not a new queue engine.
5. Category immutable slug, new inactive row, same-parent complete reorder, required-doc activation, editor flag and distinct legacy city/activation permissions are retained.
6. Rules already validate integers/units, latest sports caps and partial success. Preserve current financial policy and parser arithmetic.
7. Geography writes already validate parent existence/coordinate ranges and refetch after mutation; public effective area filtering already checks all ancestors. No cascade/containment policy is invented.
8. AI dashboard already distinguishes request ids from fallback model events and supplies zero-filled feature rows. No new budget editor or outage inference is warranted.

## Real limitations / decisions before implementation

| Item | Status / exact boundary |
|---|---|
| Assigned source coverage | **Complete**, no missing assigned body/entity or unresolved source-access blocker. |
| Runtime visuals | Only S20 and S41 before-web content described above inspected; other screen/device/flag states **NOT VERIFIED**. Actual before/after/device interaction evidence remains implementation acceptance, not an unfinished source audit. |
| Event-time migration | **Decided in CM-T02:** preserve exact historical `created_at`; leave legacy `event_at` NULL; project `legacy_created_at` and display Record created with explicit unknown historical activity. New insert/merge explicitly records queue time and source; retries change neither. No reconstructed last-event timestamp. |
| Member chat policy | Repair existing in-app authorization/read parity. Staff remote push fan-out and aggregate team Seen are **not** silently introduced; primary recipient/receipt semantics stay unchanged. |
| Shared dependencies | Coordinator must supply the actual flag/brand/refresh APIs and Settings route. All shared new SQL uses `<MIG-SQL-N>_oorva_communications_truth.sql`; numeric version is **UNASSIGNED until shared coordinator acknowledgment** and substitution. Never infer `max(main)+1`. These constrain those concrete implementation tasks, not audit completeness. |
| Execution results | No named acceptance assertion was executed; no test/visual PASS or production health conclusion is claimed. |

The companion JSON contains the complete files-read record and all exact evidence ranges. Only these two assigned report files were authored.


## Addressable source task cards

<a id="cm-t01"></a>

### CM-T01

**Evidence findings:** CM-F01. **Logical WP:** O24. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\app\notifications.tsx`; `app\src\components\__tests__\NotificationsScreen.test.tsx`.

**Required edits:**

1. Add immediate pending-id/read-all guard to existing markRead.
2. Keep navigation and acknowledgement errors distinct.
3. Await persistent acknowledgement then canonical row/count reconciliation; failed acknowledgement must retain/restore actual unread without copying an older whole-list snapshot.

**Acceptance:**

- CM_NOTIFICATION_READ_ROLLBACK: reject single read RPC; exact row remains unread and an accessible failure is shown.
- CM_NOTIFICATION_MARK_ALL_CHAT_INDEPENDENT: fail/succeed all-read with chat+non-chat fixtures; only acknowledged non-chat presentation clears, chat read-state count remains.
- Every assertion includes serialized relevant rows/pending state in failure output.

**Tests (requirements, NOT RUN):**

- {"path": "app\\src\\components\\__tests__\\NotificationsScreen.test.tsx", "cases": ["CM_NOTIFICATION_READ_ROLLBACK", "CM_NOTIFICATION_MARK_ALL_CHAT_INDEPENDENT"]}

**OFF behavior:** All acknowledgement correctness applies with brand/comms leaves OFF..

<a id="cm-t02"></a>

### CM-T02

**Evidence findings:** CM-F02, CM-F03, CM-F15. **Logical WP:** O24. **Class:** A. **Source task prerequisites:** CM-T01.

**Proposed source files (canonical allocation takes precedence):** `supabase\migrations\<MIG-SQL-N>_oorva_communications_truth.sql`; `supabase\tests\oorva_communications.test.mjs`; `app\src\lib\unread.ts`; `app\app\notifications.tsx`; `app\src\lib\__tests__\unread.test.ts`; `app\src\components\__tests__\NotificationsScreen.test.tsx`.

**Function scope:** `public._queue_notification(uuid,text,uuid,text,text,jsonb,text)`; `public.list_my_notifications(int)`; `public._support_post(public.support_threads,uuid,boolean,text)`.

**Required edits:**

1. Numeric version is UNASSIGNED until shared coordinator acknowledgment of <MIG-SQL-N>; coordinator substitutes the claimed version and owns shared test/deploy registration. The token is execution metadata, not permission to infer max(main)+1. No existing applied migration is edited.
2. Apply notificationTimestampContract exactly: add nullable event_at DEFAULT NULL; leave historical event_at NULL and preserve exact historical created_at, updated_at and payloads. No reconstructed historical last-collapse timestamp.
3. Copy latest 0066 queue body, preserving recurring URLs. New insert explicitly sets event_at=now(); genuine pending merge explicitly sets event_at=now(), read_at=NULL and preserves original created_at. Never set event_at to NULL during a genuine new queue event.
4. Keep list_my_notifications(int) signature/output columns/types/grants; return/order coalesce(event_at,created_at), project authoritative data._notification_time_source without persisting payload changes. Transport writes do not touch event_at/created_at.
5. Extend internal NotificationItem.timeSource and add notificationTimePresentation in unread.ts. Update the existing Row's visible time and accessibility label now, as Class A, not deferred to the Class-C card task. Preserve chat timestamp selection and tag the actual selected source; unknown/invalid source means Time unavailable.
6. Mask only support notification title/body via existing _mask_preview; preserve private history, recipients, counters and open/reopen behavior.
7. Create isolated harness scenarios, using fixed legacy timestamps and captured database transaction time for new queue writes; retain current nonblocking money-notification safety tests without changing formulas. CM-T02 follows CM-T01 because both touch notifications.tsx; CM-T06 already follows CM-T02.

**Acceptance:**

- CM_SQL_LEGACY_TIMESTAMP_PROVENANCE: pre-migration row has fixed created_at C, later updated_at U, count>1 and stored payload snapshot; after migration event_at remains NULL, created_at is exactly C, stored payload is unchanged, RPC at equals C (not U or migration time) and marker is legacy_created_at.
- CM_UI_LEGACY_TIMESTAMP_LABEL: legacy row visibly says Record created <relative>; accessibility includes exact C/timezone and latest historical activity time is unknown. No Updated/Latest activity/Last event label; assert with every Oorva flag OFF and ON.
- CM_SQL_NEW_EVENT_TIMESTAMP_PROVENANCE: new queue insert has event_at equal to captured queue transaction time, projected at equal to it and marker queued_event; created_at/payload/grants/signature remain correct.
- CM_SQL_LEGACY_MERGE_PROMOTION: new event merges into a legacy pending row; same id/original created_at survive, count increments, read_at clears, event_at becomes the captured new queue time and marker becomes queued_event.
- CM_SQL_EVENT_MERGE_TIME: merging an already-new pending row replaces event_at with the actual current transaction timestamp, keeps original created_at/id and marker queued_event; do not require a fictitious strictly later timestamp for equal clock instants.
- CM_SQL_TRANSPORT_RETRY_PROVENANCE / CM_SQL_EVENT_TIME: claim, failed finish/retry, successful finish and skip on separate isolated legacy/new/merged fixtures leave event_at, exact created_at, projected at, marker and relative order unchanged even while updated_at/attempts/status change.
- CM_SQL_PROVENANCE_MARKER_AUTHORITY: contradictory same-named marker in object payload cannot override derived RPC marker; stored data stays unchanged. Non-object legacy data is not rewritten and client uses unknown provenance.
- CM_UI_TIMESTAMP_SOURCE_FALLBACK: absent/invalid marker or invalid time shows Time unavailable, exact unknown-source announcement and Date unavailable group, never now or an invented event date.
- CM_UI_CHAT_TIMESTAMP_PROVENANCE: existing selection of a newer authoritative last_message_at uses message_created_at/Message labels; when row timestamp wins its legacy/queued source remains, including under Oorva OFF.
- CM_SQL_COLLAPSE_REREAD and CM_SQL_TRANSPORT_READ_INDEPENDENCE: genuine merge resets read_at; transport-only writes do not.
- CM_SQL_SUPPORT_PREVIEW_MASKED / CM_SQL_SUPPORT_PRIVATE_BODY_RETAIN / CM_SQL_RECURRING_ROUTE_RETAIN: synthetic contact preview masked, private body and recipient-specific recurring routes retained.
- CM_SQL_NOTIFICATION_RECIPIENT / CM_SQL_NOTIFICATION_ADMIN_IS_RECIPIENT_ONLY / CM_SQL_TRANSPORT_EXECUTE_DENIED: signature and grants/recipient/worker boundaries unchanged. Assertions include JSON.stringify(actual rows/state), no real personal data.

**Tests (requirements, NOT RUN):**

- {"path": "supabase\\tests\\oorva_communications.test.mjs", "cases": ["CM_SQL_LEGACY_TIMESTAMP_PROVENANCE", "CM_SQL_NEW_EVENT_TIMESTAMP_PROVENANCE", "CM_SQL_LEGACY_MERGE_PROMOTION", "CM_SQL_EVENT_MERGE_TIME", "CM_SQL_TRANSPORT_RETRY_PROVENANCE", "CM_SQL_PROVENANCE_MARKER_AUTHORITY", "CM_SQL_EVENT_TIME", "CM_SQL_COLLAPSE_REREAD", "CM_SQL_TRANSPORT_READ_INDEPENDENCE", "CM_SQL_SUPPORT_PREVIEW_MASKED", "CM_SQL_SUPPORT_PRIVATE_BODY_RETAIN", "CM_SQL_RECURRING_ROUTE_RETAIN", "CM_SQL_NOTIFICATION_RECIPIENT", "CM_SQL_NOTIFICATION_ADMIN_IS_RECIPIENT_ONLY", "CM_SQL_TRANSPORT_EXECUTE_DENIED"]}
- {"path": "app\\src\\lib\\__tests__\\unread.test.ts", "cases": ["CM_UI_TIMESTAMP_SOURCE_FALLBACK", "CM_UI_CHAT_TIMESTAMP_PROVENANCE"]}
- {"path": "app\\src\\components\\__tests__\\NotificationsScreen.test.tsx", "cases": ["CM_UI_LEGACY_TIMESTAMP_LABEL", "CM_UI_TIMESTAMP_SOURCE_FALLBACK"]}
- {"path": "supabase\\tests\\cancellation_payouts.test.mjs", "cases": ["Retain existing B6 notification insert failure does not roll back payment/refund/payout state assertions"]}

**OFF behavior:** Timestamp provenance labels apply even with every Oorva flag OFF. Do not gate history, acknowledgement, safe support or existing payment/refund/payout notification processing behind cosmetic switches..

<a id="cm-t03"></a>

### CM-T03

**Evidence findings:** CM-F04, CM-F05. **Logical WP:** O24. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\src\lib\adminApi.ts`; `app\app\support\index.tsx`; `app\app\support\[id].tsx`; `app\app\admin\support\index.tsx`; `app\src\lib\__tests__\supportApi.test.ts`; `app\src\components\__tests__\SupportInboxes.test.tsx`.

**Required edits:**

1. Add explicit personal-owner filter to listSupportThreads after a verified signed-in user id.
2. Implement loadSupportConversation(threadId,scope,actorId) with the exact CM-F05 API; require participant ownership before message fetch, preserving admin RLS and using the adapter from the shared body.
3. Replace admin error-to-empty and personal sticky-error branches with loading/error/Retry/success-empty/data states.
4. Guard results by actor/filter/request generation; clear actor-sensitive state on permission loss.
5. O30 owns the admin inbox edits; serialize that file with CM-T13 instead of parallel writers.

**Acceptance:**

- CM_SUPPORT_PERSONAL_LIST_SCOPE: dual admin/participant receives only own personal-list ids; admin list remains all authorized.
- CM_SUPPORT_PERSONAL_DETAIL_SCOPE: another user's thread cannot be rendered as You in participant mode; separate admin route works.
- CM_ADMIN_SUPPORT_FAILURE_NOT_CLEAR: initial pending/rejected call is never Inbox clear.
- CM_SUPPORT_ERROR_RECOVERY: success after failure replaces error; Retry is visible.
- CM_ADMIN_SUPPORT_FILTER_ORDER: delayed prior-filter response cannot replace current filter rows.
- CM_SQL_SUPPORT_OTHER_DENIED: unchanged RLS/RPC outsider rejection is asserted in SQL lane, not inferred from hidden buttons.

**Tests (requirements, NOT RUN):**

- {"path": "app\\src\\lib\\__tests__\\supportApi.test.ts", "cases": ["CM_SUPPORT_PERSONAL_LIST_SCOPE", "CM_SUPPORT_PERSONAL_DETAIL_SCOPE"]}
- {"path": "app\\src\\components\\__tests__\\SupportInboxes.test.tsx", "cases": ["CM_ADMIN_SUPPORT_FAILURE_NOT_CLEAR", "CM_SUPPORT_ERROR_RECOVERY", "CM_ADMIN_SUPPORT_FILTER_ORDER"]}
- {"path": "supabase\\tests\\oorva_communications.test.mjs", "cases": ["CM_SQL_SUPPORT_OTHER_DENIED"]}

**OFF behavior:** Scope and truthful load/error behavior apply in legacy and Oorva layouts; support resolution remains accessible..

<a id="cm-t04"></a>

### CM-T04

**Evidence findings:** CM-F06. **Logical WP:** O24. **Class:** A. **Source task prerequisites:** CM-T03.

**Proposed source files (canonical allocation takes precedence):** `app\src\components\SupportConversation.tsx`; `app\src\components\__tests__\SupportConversation.test.tsx`.

**Required edits:**

1. Use the scoped adapter in the one existing shared body; key state by actor/scope/thread.
2. Implement pending/error/Retry/not-found/ready; disable send/status controls until ready; guard repeated status writes.
3. Consume O38R request-ordering/invalidation/focus/foreground and one active-focused fallback; do not create a second global refresh store.
4. After send/status await canonical readback; use existing markSupportRead and refresh affected lists/overview from their authorized reads.
5. Remove the outer keyboard-avoidance wrapper only against O07's single-Screen-owner contract, keeping native effects explicitly unverified until captured.

**Acceptance:**

- CM_SUPPORT_NOTFOUND_AND_SWITCH: missing/forbidden id has no enabled Send and no prior thread body; delayed old-id result is ignored.
- CM_SUPPORT_CROSS_ROLE_REFRESH: isolated thread uses same PK for owner/admin; remote reply/status appears within active refresh bound, stops on blur/background and resumes once.
- CM_SUPPORT_REMOTE_REPLY: draft survives same-thread refresh; successful send/read updates actor-side counters through real RPC/readback.
- CM_SUPPORT_SINGLE_KEYBOARD_OWNER: one keyboard owner, with actual native keyboard acceptance captured later.
- CM_SQL_SUPPORT_OWNER_LIFECYCLE, CM_SQL_SUPPORT_ADMIN_LIFECYCLE and CM_SQL_SUPPORT_ADMIN_OWNER_BRANCH retain existing open/closed/send-reopens/owner-first semantics.

**Tests (requirements, NOT RUN):**

- {"path": "app\\src\\components\\__tests__\\SupportConversation.test.tsx", "cases": ["CM_SUPPORT_NOTFOUND_AND_SWITCH", "CM_SUPPORT_PARTICIPANT_LOAD", "CM_SUPPORT_CROSS_ROLE_REFRESH", "CM_SUPPORT_REMOTE_REPLY", "CM_SUPPORT_SINGLE_KEYBOARD_OWNER"]}
- {"path": "supabase\\tests\\oorva_communications.test.mjs", "cases": ["CM_SQL_SUPPORT_OWNER_LIFECYCLE", "CM_SQL_SUPPORT_ADMIN_LIFECYCLE", "CM_SQL_SUPPORT_ADMIN_OWNER_BRANCH", "CM_SQL_SUPPORT_ROLE_NEUTRAL_START", "CM_SQL_SUPPORT_LINKED_PARTICIPANT_ONLY"]}

**OFF behavior:** Correct authorization/readback/refresh and single-layout-owner safety do not depend on brand/comms composition..

<a id="cm-t05"></a>

### CM-T05

**Evidence findings:** CM-F07. **Logical WP:** O24. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\app\chat\[bookingId].tsx`; `app\src\components\ChatPanel.tsx`; `app\src\components\__tests__\ChatScreen.test.tsx`; `app\src\components\__tests__\ChatPanel.test.tsx`.

**Required edits:**

1. Reuse existing subscribeToBooking plus focus/foreground canonical booking reads; clear state on booking/actor change.
2. Extend useChat with phase/reload and id-based reconciliation rather than initial-response replacement.
3. Refetch after successful send and after reconnect/resume, retaining the current RPC nudge behavior and existing send failure draft.
4. Only mark/read a usable current chat; preserve opened-read snapshot and fixed unread divider across later reloads.
5. Retain exact four-status closed predicate and backend enforcement rather than inventing a universal terminal-state rule.

**Acceptance:**

- CM_CHAT_REMOTE_CLOSE: remote cancelled/declined/expired/pending_payment readback removes composer; direct send remains rejected.
- CM_CHAT_ACK_WITHOUT_REALTIME: accepted message appears once from canonical readback even if subscription produces no event.
- CM_CHAT_SNAPSHOT_EVENT_MERGE: event during delayed initial read is not lost/duplicated; order stable by created_at/id.
- CM_CHAT_ERROR_NOT_EMPTY: rejected initial list shows Retry, not Say hello.
- CM_CHAT_CLOSED_SERVER_RETAIN: completed/closed chat behavior remains exactly as current server permits; no new policy.

**Tests (requirements, NOT RUN):**

- {"path": "app\\src\\components\\__tests__\\ChatScreen.test.tsx", "cases": ["CM_CHAT_REMOTE_CLOSE", "CM_CHAT_CLOSED_SERVER_RETAIN"]}
- {"path": "app\\src\\components\\__tests__\\ChatPanel.test.tsx", "cases": ["CM_CHAT_ACK_WITHOUT_REALTIME", "CM_CHAT_SNAPSHOT_EVENT_MERGE", "CM_CHAT_ERROR_NOT_EMPTY", "CM_CHAT_UNREAD_RETAIN"]}

**OFF behavior:** Existing chat must stay truthful and safely resolvable with all Oorva leaves OFF..

<a id="cm-t06"></a>

### CM-T06

**Evidence findings:** CM-F08. **Logical WP:** O24. **Class:** A. **Source task prerequisites:** CM-T01, CM-T02.

**Proposed source files (canonical allocation takes precedence):** `supabase\migrations\<MIG-SQL-N>_oorva_communications_truth.sql`; `supabase\tests\oorva_communications.test.mjs`; `app\src\lib\unread.ts`; `app\app\notifications.tsx`; `app\src\lib\__tests__\unread.test.ts`; `app\src\components\__tests__\NotificationsScreen.test.tsx`.

**Function scope:** `public.get_unread_counts()`; `public.get_chat_read_state(uuid)`; `public.get_chat_heading(uuid)`.

**Required edits:**

1. Append to the same coordinator-serialized migration after CM-T02; preserve function signatures/grants.
2. Use existing _business_chat_participant/_acts_for predicates in the three stale read projections; no new role enum.
3. For member opposite-party metadata/read timestamp use the customer; preserve primary-customer other_last_read_at semantics and current primary push recipients.
4. Extend existing buildNotificationItems(rows,unread,userId,headings?) to include unread-map bookings absent from recent outbox chats; headings is optional guarded metadata, missing preview stays empty. A synthesized item's valid last_message_at uses CM-T02 message_created_at provenance; missing/invalid time uses unknown, not invented now.
5. Enrich missing chat headings through getChatHeading, with actor/request ordering; no arbitrary routes/private fields or synthesized durable notification writes.

**Acceptance:**

- CM_SQL_CHAT_MEMBER_PROJECTIONS: same booking PK across customer, owner, active manager/staff yields permitted counts/heading/read state; outsiders get none/denial.
- CM_SQL_CHAT_MEMBER_FLAG_OFF: merchant_staff OFF or inactive membership removes member access but preserves primary customer/owner access.
- CM_SQL_CHAT_PRIMARY_SEEN_RETAIN: no customer-side aggregate team Seen policy is introduced.
- CM_CHAT_MEMBER_NOTIFICATION_ITEM: unread authorized chat with zero outbox rows yields one safe row; no fake preview; late heading from prior actor discarded.
- Existing one-chat-per-booking, safe route and masked preview tests remain intact.

**Tests (requirements, NOT RUN):**

- {"path": "supabase\\tests\\oorva_communications.test.mjs", "cases": ["CM_SQL_CHAT_MEMBER_PROJECTIONS", "CM_SQL_CHAT_MEMBER_FLAG_OFF", "CM_SQL_CHAT_PRIMARY_SEEN_RETAIN"]}
- {"path": "app\\src\\lib\\__tests__\\unread.test.ts", "cases": ["CM_CHAT_MEMBER_NOTIFICATION_ITEM", "CM_NOTIFICATION_CHAT_AGGREGATE", "CM_NOTIFICATION_SAFE_ROUTES"]}
- {"path": "app\\src\\components\\__tests__\\NotificationsScreen.test.tsx", "cases": ["CM_CHAT_MEMBER_HEADING_ACTOR_CHANGE"]}

**OFF behavior:** Member capability still obeys existing merchant_staff; Oorva OFF does not suppress valid unread correctness. No new remote staff-push capability is enabled..

<a id="cm-t07"></a>

### CM-T07

**Evidence findings:** CM-F09. **Logical WP:** O30. **Class:** A. **Source task prerequisites:** CM-T06.

**Proposed source files (canonical allocation takes precedence):** `supabase\migrations\<MIG-SQL-N>_oorva_communications_truth.sql`; `supabase\tests\oorva_communications.test.mjs`; `app\app\admin\index.tsx`; `app\src\components\__tests__\AdminDashboardScreen.test.tsx`.

**Function scope:** `public.admin_dashboard(int)`.

**Required edits:**

1. Append the narrow admin_dashboard count repair to the same serialized migration; retain its admin guard and all unrelated aggregates.
2. Align providers_pending exactly with latest submitted admin-review pending predicate; do not use a 300-row page cap.
3. Label unchanged KYC count as KYC measure rather than overall readiness.
4. Rename Revenue to Gross payments collected without touching underlying payment arithmetic; coordinate identity/money contract ownership.

**Acceptance:**

- CM_SQL_DASHBOARD_REVIEW_PARITY: isolated providers with independent KYC/review values produce the same pending membership as current People predicate; use same provider PK through each transition.
- CM_DASHBOARD_GROSS_LABEL: exact returned paise unchanged and gross wording visible.
- CM_SQL_ADMIN_ENDPOINT_DENIED: non-admin and guest cannot use privileged dashboard; obsolete phone allowlist grants no authority.
- No admin_set_provider_kyc restoration, payout policy or money formula edit.

**Tests (requirements, NOT RUN):**

- {"path": "supabase\\tests\\oorva_communications.test.mjs", "cases": ["CM_SQL_DASHBOARD_REVIEW_PARITY", "CM_SQL_ADMIN_ENDPOINT_DENIED"]}
- {"path": "app\\src\\components\\__tests__\\AdminDashboardScreen.test.tsx", "cases": ["CM_DASHBOARD_GROSS_LABEL", "CM_ADMIN_BACK_ERROR"]}

**OFF behavior:** Counts and labels remain truthful with Oorva OFF; no admin access or money resolution is gated..

<a id="cm-t08"></a>

### CM-T08

**Evidence findings:** CM-F10. **Logical WP:** O31. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\app\admin\services.tsx`; `app\app\admin\category\[id].tsx`; `app\src\components\__tests__\AdminCategoriesScreen.test.tsx`; `app\src\lib\__tests__\adminCategoryApi.test.ts`.

**Required edits:**

1. Replace fabricated savedCategory and 0-based reorder positions with post-write listCategories readback keyed by returned category id.
2. Refresh canonical state after legacy active/city writes; keep filters/selection stable.
3. Guard overlapping mutations and stale responses; distinguish committed write plus unavailable readback from write rejection.
4. Retain server validation/slug/create-inactive/parent/editor and legacy availability contracts.

**Acceptance:**

- CM_CATEGORY_ORDER_READBACK: server 10/20 positions persist exactly after reorder and later edit/save.
- CM_CATEGORY_CANONICAL_READBACK: normalized server fields, not sent draft/default counters, populate saved state.
- CM_CATEGORY_AVAILABILITY_READBACK: success refetches; failed readback visibly stale, no false retry of a known committed create.
- CM_CATEGORY_INACTIVE_CREATE and CM_SERVICES_EDITOR_OFF: inactive/restricted/flag-off behavior unchanged.

**Tests (requirements, NOT RUN):**

- {"path": "app\\src\\components\\__tests__\\AdminCategoriesScreen.test.tsx", "cases": ["CM_CATEGORY_ORDER_READBACK", "CM_CATEGORY_CANONICAL_READBACK", "CM_CATEGORY_AVAILABILITY_READBACK", "CM_CATEGORY_INACTIVE_CREATE", "CM_SERVICES_EDITOR_OFF"]}
- {"path": "app\\src\\lib\\__tests__\\adminCategoryApi.test.ts", "cases": ["Retain documented create/update/reorder arguments and server-error forwarding"]}

**OFF behavior:** Canonical readback applies with all Oorva leaves OFF; admin_category_editor retains its original narrower meaning..

<a id="cm-t09"></a>

### CM-T09

**Evidence findings:** CM-F11, CM-F12. **Logical WP:** O31. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\app\admin\features.tsx`; `app\src\components\__tests__\AdminFeaturesScreen.test.tsx`.

**Required edits:**

1. Add immediate one-write lock/guard, disable all registry/archetype controls during save, release only after canonical response/reconciliation.
2. Keep prior state on error and surface actual RPC failure.
3. Add Remote services to the existing archetype control set.
4. Do not edit shared featureFlagModel/adminFeaturePresentation internals or introduce a key whitelist.

**Acceptance:**

- CM_FLAGS_SERIALIZED: synchronous second press and delayed response cannot create stale visible full-state replacement.
- CM_FLAGS_FAILURE_RETAINS_STATE: failed write leaves canonical prior value and an error.
- CM_FLAGS_REMOTE / CM_FLAGS_REMOTE_OORVA_OFF: remote sends archetype:remote and works under legacy presentation.
- CM_FLAGS_PARENT_CONTRACT: shared helper alone controls parent-disabled explanations/raw child intent.

**Tests (requirements, NOT RUN):**

- {"path": "app\\src\\components\\__tests__\\AdminFeaturesScreen.test.tsx", "cases": ["CM_FLAGS_SERIALIZED", "CM_FLAGS_FAILURE_RETAINS_STATE", "CM_FLAGS_REMOTE", "CM_FLAGS_REMOTE_OORVA_OFF", "CM_FLAGS_PARENT_CONTRACT"]}

**OFF behavior:** Runtime OFF controls and existing remote control remain available even if Oorva identity/editor presentation is unavailable..

<a id="cm-t10"></a>

### CM-T10

**Evidence findings:** CM-F04, CM-F13. **Logical WP:** O31. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\app\admin\geography.tsx`; `app\src\components\__tests__\AdminGeographyScreen.test.tsx`.

**Required edits:**

1. Make initial error/loading/data explicit; no initial skeleton after failure.
2. Bind search/resolve/pendingArea to city id/query/session/request generation; invalidate on selection/query/unmount.
3. Require pendingArea.cityId===current city before save; ignore stale completions and retain correct save/refetch flow.
4. Use shared clean-view focus/foreground refresh without clearing an active draft.

**Acceptance:**

- CM_GEO_INITIAL_ERROR: failure/Retry replaces loading.
- CM_GEO_STALE_PLACE: resolve A after opening B never creates B's pending area.
- CM_GEO_STALE_QUERY: older search cannot replace newer query results.
- CM_GEO_SAVE_PARENT_MATCH: save uses the same originating city/coordinates; server parent/range/admin checks retained.

**Tests (requirements, NOT RUN):**

- {"path": "app\\src\\components\\__tests__\\AdminGeographyScreen.test.tsx", "cases": ["CM_GEO_INITIAL_ERROR", "CM_GEO_STALE_PLACE", "CM_GEO_STALE_QUERY", "CM_GEO_SAVE_PARENT_MATCH"]}

**OFF behavior:** Correct request scoping and error truth apply irrespective of area_picker/Oorva appearance; no consumer capability is enabled..

<a id="cm-t11"></a>

### CM-T11

**Evidence findings:** CM-F14. **Logical WP:** O31. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\app\admin\rules.tsx`; `app\src\components\__tests__\AdminRulesScreen.test.tsx`.

**Required edits:**

1. Track per-group canonical saved values/dirty draft instead of clearing both on every focus.
2. Protect secondary navigation/discard and reconcile only clean fields.
3. Render unavailable/back state when the existing helper disables editing; perform no rule RPC there.
4. Keep current partial-save reporting and integer parser functions untouched.

**Acceptance:**

- CM_RULES_DIRTY_FOCUS: draft survives navigation/focus unless explicit discard.
- CM_RULES_OFF_ROUTE: explanation/back with zero read/write RPCs.
- CM_RULES_PARTIAL_SAVE: recurring success plus sports failure preserves sports draft and reports exact outcome.
- Existing adminRulesApi boundary/exact-unit assertions remain unchanged.

**Tests (requirements, NOT RUN):**

- {"path": "app\\src\\components\\__tests__\\AdminRulesScreen.test.tsx", "cases": ["CM_RULES_DIRTY_FOCUS", "CM_RULES_OFF_ROUTE", "CM_RULES_PARTIAL_SAVE"]}
- {"path": "app\\src\\lib\\__tests__\\adminRulesApi.test.ts", "cases": ["Retain exact paise/basis-point conversions, latest bounds and partial server errors"]}

**OFF behavior:** Unavailable navigation and draft safety apply under legacy layout; money-safety paths are not gated by editor state..

<a id="cm-t12"></a>

### CM-T12

**Evidence findings:** CM-F16. **Logical WP:** O24. **Class:** C. **Source task prerequisites:** CM-T01, CM-T02, CM-T03, CM-T04, CM-T05, CM-T06.

**Proposed source files (canonical allocation takes precedence):** `app\src\components\NotificationCard.tsx`; `app\src\lib\notificationPresentation.ts`; `app\app\notifications.tsx`; `app\src\components\SupportConversation.tsx`; `app\app\support\index.tsx`; `app\app\support\new.tsx`; `app\app\chat\[bookingId].tsx`; `app\src\components\ChatPanel.tsx`; `app\src\lib\__tests__\notificationPresentation.test.ts`; `app\src\components\__tests__\NotificationCard.test.tsx`; `app\src\components\__tests__\CommunicationsPresentation.test.tsx`.

**Required edits:**

1. Consume coordinator's effective oorva_comms_ux/brand contract; do not implement a separate flag store.
2. Implement the exact presentational/card/date-group APIs in cardTemplates; retain safe route builder and no inline business transitions.
3. Add explicit support status/authorized booking context and distinct unread/time fields; linked start passes null subject to existing server derivation.
4. Keep privacy guidance visible and existing server message limit explicit.
5. Make history scrolling conditional while preserving existing unread/Seen helpers; consume O07 obstruction reservation.
6. Capture before/after real screen states without assuming flag values from old screenshots.

**Acceptance:**

- CM_NOTIFICATION_DATE_GROUPS: clock/timezone-bound groups, stable order, no duplicate chat rows; full exact time accessible.
- CM_NOTIFICATION_CARD_CONTRACT: actual event/context/meaning/unread/action supplied, no fabricated financial status.
- CM_SUPPORT_CONTEXT / CM_SUPPORT_CLOSED_UNREAD / CM_SUPPORT_BOOKING_SUBJECT: canonical linked context and independent fields.
- CM_CHAT_HISTORY_SCROLL: reader of old messages is not forcibly moved by incoming message.
- CM_COMMS_PRESENTATION_MATRIX: brand+leaf ON changes only composition; leaf OFF and parent-OFF/child-ON retain legacy layout plus Class-A fixes.
- Actual notification/device captures must establish safe-area/keyboard results; this audit supplies no visual PASS.

**Tests (requirements, NOT RUN):**

- {"path": "app\\src\\lib\\__tests__\\notificationPresentation.test.ts", "cases": ["CM_NOTIFICATION_DATE_GROUPS"]}
- {"path": "app\\src\\components\\__tests__\\NotificationCard.test.tsx", "cases": ["CM_NOTIFICATION_CARD_CONTRACT", "CM_NOTIFICATION_SAFE_ROUTES"]}
- {"path": "app\\src\\components\\__tests__\\CommunicationsPresentation.test.tsx", "cases": ["CM_SUPPORT_CONTEXT", "CM_SUPPORT_CLOSED_UNREAD", "CM_SUPPORT_BOOKING_SUBJECT", "CM_CHAT_HISTORY_SCROLL", "CM_COMMS_PRESENTATION_MATRIX"]}

**OFF behavior:** Effective parent OFF or leaf OFF keeps legacy composition; support/chat/acknowledgement correctness, cancellation/payment/refund resolution remain available..

<a id="cm-t13"></a>

### CM-T13

**Evidence findings:** CM-F17. **Logical WP:** O30. **Class:** C. **Source task prerequisites:** CM-T03, CM-T07.

**Proposed source files (canonical allocation takes precedence):** `app\app\admin\index.tsx`; `app\app\admin\support\index.tsx`; `app\src\components\__tests__\AdminDashboardScreen.test.tsx`; `app\src\components\__tests__\SupportInboxes.test.tsx`.

**Required edits:**

1. Consume effective oorva_admin_ops_ux.
2. Move canonical pending review/support/disputes route actions before reporting; keep returnTo navigation and existing route gates.
3. Add independent status/unread/last-message-time to admin support cards, omitting phone.
4. Add Settings only after coordinator O10 provides the implemented authorized destination; no dead placeholder route.

**Acceptance:**

- CM_ADMIN_QUEUE_ORDER: operations before trend under ON; legacy order retained under OFF.
- CM_ADMIN_SUPPORT_CLOSED_UNREAD: closed unread thread shows both facts.
- CM_ADMIN_SUPPORT_TIME_PRIVACY: readable relative/exact time, no phone/private copied fields.
- CM_ADMIN_SETTINGS_LINK: implemented target only; existing routes and back target remain valid.
- CM_ADMIN_OPS_PRESENTATION_MATRIX includes parent-OFF/child-ON and genuine error/zero-work fixtures.

**Tests (requirements, NOT RUN):**

- {"path": "app\\src\\components\\__tests__\\AdminDashboardScreen.test.tsx", "cases": ["CM_ADMIN_QUEUE_ORDER", "CM_ADMIN_SETTINGS_LINK", "CM_ADMIN_OPS_PRESENTATION_MATRIX"]}
- {"path": "app\\src\\components\\__tests__\\SupportInboxes.test.tsx", "cases": ["CM_ADMIN_SUPPORT_CLOSED_UNREAD", "CM_ADMIN_SUPPORT_TIME_PRIVACY"]}

**OFF behavior:** Legacy overview/inbox composition retained; truthful counts/errors and administrator authorization still apply..

<a id="cm-t14"></a>

### CM-T14

**Evidence findings:** CM-F18. **Logical WP:** O31. **Class:** C. **Source task prerequisites:** CM-T08, CM-T09, CM-T10, CM-T11.

**Proposed source files (canonical allocation takes precedence):** `app\app\admin\ai.tsx`; `app\app\admin\category\[id].tsx`; `app\app\admin\features.tsx`; `app\app\admin\geography.tsx`; `app\app\admin\rules.tsx`; `app\app\admin\services.tsx`; `app\src\components\__tests__\AdminConfigPresentation.test.tsx`.

**Required edits:**

1. Consume effective oorva_admin_config_ux without editing coordinator flag internals or generic Screen defaults.
2. Apply each of the six concrete screen targets in CM-F18/placement rows, not one global card/layout replacement.
3. Use Screen.footer for category/rules primary save, preserving dirty/partial-save behavior; add registry search and full existing archetype/group filters.
4. Use geography ancestry/contextual add plus effective-visibility explanation; raw child state survives ancestor disable.
5. Retain AI zero/error semantics, request-versus-event measures and exact units.

**Acceptance:**

- CM_AI_PERIOD_CONTEXT / CM_AI_REQUEST_VS_EVENT / CM_AI_UNITS: IST and existing calculations preserved.
- CM_CATEGORY_SAVE_FOOTER / CM_RULES_FOOTER: save/error reachable with keyboard/large text without policy changes.
- CM_FLAGS_SEARCH_DYNAMIC: unknown newly returned registry row remains searchable and operable.
- CM_GEO_ANCESTRY / CM_GEO_PARENT_OFF / CM_GEO_DISABLE_RETAIN_CHILDREN: correct UUID ancestry and non-cascading visibility explanation.
- CM_SERVICES_FILTERS: all existing types and groups reachable.
- CM_ADMIN_CONFIG_PRESENTATION_MATRIX: ON/OFF/parent-OFF, authorized/unauthorized, loading/error/empty/dirty/long-text cases; no theme rerender resets draft.

**Tests (requirements, NOT RUN):**

- {"path": "app\\src\\components\\__tests__\\AdminConfigPresentation.test.tsx", "cases": ["CM_AI_PERIOD_CONTEXT", "CM_AI_REQUEST_VS_EVENT", "CM_AI_UNITS", "CM_CATEGORY_SAVE_FOOTER", "CM_RULES_FOOTER", "CM_FLAGS_SEARCH_DYNAMIC", "CM_GEO_ANCESTRY", "CM_GEO_PARENT_OFF", "CM_GEO_DISABLE_RETAIN_CHILDREN", "CM_SERVICES_FILTERS", "CM_ADMIN_CONFIG_PRESENTATION_MATRIX"]}

**OFF behavior:** Legacy six-screen composition retained; canonical readback, runtime controls, permissions and dirty/error repairs remain active..

<a id="cm-t15"></a>

### CM-T15

**Evidence findings:** CM-F19. **Logical WP:** O24. **Class:** B. **Source task prerequisites:** CM-T12, CM-T13.

**Proposed source files (canonical allocation takes precedence):** `app\src\components\SupportConversation.tsx`; `app\app\support\index.tsx`; `app\app\support\new.tsx`; `app\app\chat\[bookingId].tsx`; `app\app\admin\index.tsx`; `app\src\components\__tests__\CommunicationsBrand.test.tsx`.

**Required edits:**

1. Use the coordinator-supplied context-specific display-brand resolver in local copy only; do not create a CM brand cache/store.
2. Preserve approved warning/privacy meaning and working routes/contacts.
3. Keep historical payloads, QS references and technical identifiers unchanged.
4. O35SQL separately owns future outbound support identity under oorva_external_brand; no outbound mass rewrite in this task.

**Acceptance:**

- CM_COMMS_BRAND_CONTEXT: intended support/admin/chat display identity follows resolver in brand ON.
- CM_SUPPORT_NEW_BRAND_OFF: exact context-specific legacy identity in OFF; requests/permissions unchanged.
- CM_HISTORICAL_PAYLOAD_UNCHANGED: stored notification title/body/data and bookingRef untouched.
- Safety nudge and support actions remain available regardless of cosmetic flags.

**Tests (requirements, NOT RUN):**

- {"path": "app\\src\\components\\__tests__\\CommunicationsBrand.test.tsx", "cases": ["CM_COMMS_BRAND_CONTEXT", "CM_SUPPORT_NEW_BRAND_OFF", "CM_HISTORICAL_PAYLOAD_UNCHANGED", "CM_CHAT_CONTEXT_REFERENCE"]}

**OFF behavior:** Exact legacy display identity; no loss of existing support/chat or resolution capability..
