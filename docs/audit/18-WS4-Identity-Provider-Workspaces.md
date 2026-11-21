# Oorva Critical source audit — Identity

> **Implementation authority:** use [doc 18](../18-Oorva-Transformation-Implementation-Plan.md) and [`execution-plan.json`](../design/oorva/execution-plan.json) for the actual dispatch stage, file/function locks, migration claim and validation command. This source audit supplies verified current behavior, required changes and acceptance. A proposal filename is not a numeric reservation.


| Item | Baseline |
|---|---|
| Scope | `streams.identity`: S04, S08, S09, S11, S19, S25, S42, S46, S47, S51, S54, S55, S57, S64, S65 |
| Source | Immutable `oorva-audit-main-2f1e4638`; SHA `2f1e4638b145185b9e58c4c62e58f5c6dd491fa1` |
| Date / owner | November 20, 2026 / Identity stream, prefix **ID** |
| Requirements | Complete Critical addendum, audit protocol and identity manifest assignment |
| Evidence | Actual route wrappers, imported bodies, conditional UI, types, API reads, latest applicable SQL/Edge functions; ten supplied before PNGs |
| Boundary | Coordinator owns auth/login/verify/location/BYO-recipient/root and shared brand/native primitives. Related reads here establish contracts, not another screen audit. |
| Execution | Read-only. Only this report and [`identity.json`](../design/oorva/audit/identity.json) written. No app/SQL tests, installs, builds, production calls, source edits, commits, pushes, deploys or subagents. |

## Summary

**15/15 screens, 82 placement rows, four entity contracts, 17 lifecycle/actor/refresh cases, seven card contracts, 18 findings and 20 implementation tasks.**

- **11 confirmed current-code defects**, including repeated approval actions, incorrect credential explanations, account-unscoped drafts, missing active creator work and a delegated-read feature-OFF guard gap.
- **Seven required design changes**, explicitly distinguished from existing defects.
- Retain separate **payout/KYC, admin review, document validity, submitted/completeness, suspension/deactivation, online preference and actual bookability**. Creator is a provider persona, not a new auth role.
- **No source-coverage blocker remains.** Deactivation is a resolved preservation boundary, not a policy question for this plan. Only coordinator migration allocation and scoped public-policy wording approval remain implementation gates.
- **Public trust disposition:** retain `get_provider_public_profile` unchanged; correct public payout/credential wording using its existing safe fields. No new public projection, independent ID-approval claim, private data or migration is needed. Exact task: **ID-T20**.

The JSON companion contains exhaustive fields, source-reference objects, exact proposed write files, ordered edits, acceptance assertions, test cases and files read. All new functions/files/flags below are **implementation proposals**, not claims that they already exist.

## Findings

**A:** correctness/permission/accessibility/safe-action fix, applies with Oorva OFF. **B:** shared identity styling, coordinator-owned. **C:** optional family composition, requires `oorva_brand` and its UX leaf.

| ID | Priority / kind / class | Source-backed result | Exact repair / owner |
|---|---|---|---|
| ID-F01 | P1 / defect / A | Every submitted provider gets all review buttons, including already approved; one status badge overrides review with holiday/suspension. Filter counts describe a subset as totals. `app\app\admin\people.tsx:32-36,97-131`; latest writer `supabase\migrations\0088b_b6_money_notifications.sql:944-977`. | Hide only the same completed review target; retain supported alternate reviews. Project admin-only `go_live`/`review_note`, label separate axes, qualify restore/approve promises and remove false aggregate counts. **O30/O38I**. |
| ID-F02 | P1 / defect / A | Whole-category document compliance is tested inside each individual document loop. Valid A + missing B can produce **A expired**. UI selects newest type without scope/expiry and maps approved to Live. `supabase\migrations\0009_provider_onboarding.sql:257-278,440-467`; `app\src\features\providerOnboarding\PortfolioSection.tsx:13-18,49-70`. | Private per-requirement projection; distinguish valid credential from latest submission; correct scope/date labels. Preserve any-valid-approval and any-eligible-service rules. **O38I/O26**. |
| ID-F03 | P2 / design / A | Document pending-only backend is correct, but UI omits category context and mutates without confirmation; one busy string can be overwritten by another card. `app\app\admin\documents.tsx:61-89,101-153`. | Show category/general scope; confirm and serialize/key review actions; keep signing/expiry/reason guard. **O30**. |
| ID-F04 | P1 / defect / A | Draft key is `quickserve.draft.<section>`, not UID-scoped. Basics includes identity fields; Hours also restores. `app\src\features\providerOnboarding\useOnboardingData.ts:45-69`. | UID-scoped draft API, identity-change cancellation/reset, ignore unscoped legacy data, clear successful own section. Never persist payout/PAN/bank fields. **O26**. |
| ID-F05 | P1 / defect / A | Account checkmark uses KYC, Hub uses live; service enable toasts live; dashboard availability promises follow online alone. `AccountScreen.tsx:133-144`; `ProviderMeSections.tsx:39-50`; `DashboardWidgets.tsx:52-69` under `app\src\components` / `app\src\features\providerDashboard`. | Reuse canonical owner readiness; explicitly separate payout verification and availability preference. Do not invent a new online eligibility policy. **O38I/O23/O25/O26**. |
| ID-F06 | P2 / defect / A | Supported legacy provider account identifier counts in admin account presence, but not setup check or payout step completion. `supabase\migrations\0064_o2_provider_verification.sql:33-35`; `0009_provider_onboarding.sql:391-394`; `app\src\lib\onboarding\completeness.ts:78-81`. | Recognize legacy identifier for setup only; no beneficiary migration or verification bypass. **O38I/O26**. |
| ID-F07 | P1 / defect / A | Owner dashboard excludes `confirmed` and `delivery_pending`, although Job history calls both active and server transitions reach them. `app\src\features\providerDashboard\ProviderDashboard.tsx:37-46,159-182`. | Add both to ordered active coverage; safe detail CTAs, not guessed Start trip. **O25**. |
| ID-F08 | P1 / defect / A | Assigned job subscribes only to messages, mislabels all other team senders Customer, bypasses shared active-chat state and shows no-show before server grace eligibility. `app\app\merchant-job\[id].tsx:27-85,135-146,183-198`; `supabase\migrations\0083_h3_home_booking_safety.sql:191-216`. | Booking subscription, sender-ID attribution/dedup/shared unread; minimal server eligibility read for actual party/time/flag. Preserve owner/member differences. **O25/O38I**. |
| ID-F09 | P1 / defect / A | Latest `service_request_provider_view` reads active manager memberships directly, without `merchant_staff`; authenticated view grant persists. `supabase\migrations\0052_merchant_staff.sql:433-476`; `0040_urgent_proposals.sql:118`. | Add flag check only to delegated branch, retaining owner branch, sanitized intake and ambiguity filter. **O38I**, proposal-owner function lock. |
| ID-F10 | P2 / defect / A | No Account member-work entry; unconditional staff-management shortcuts; owner:type keys collide for multiple venues; S55 omits domain-parent gates. `app\app\merchant-work.tsx:35-53`; membership union `supabase\migrations\0052_merchant_staff.sql:181-209`. | Actual memberships, additive real business IDs, unique keys and effective capability entry gates. Keep legitimate business setup paths. **O28/O23/O25/O38I**. |
| ID-F11 | P2 / defect / A | Concrete loaders map failure to zero/absence/empty, leave perpetual skeleton/advice loading, suppress stale errors or mix old/new business context. Examples: `AccountScreen.tsx:40-56`; `app\app\merchant-work.tsx:11-35`; `useOnboardingData.ts:21-38`. | Explicit loading/empty/error/stale, retry and latest-response scope. Reuse shared onboarding loader; one focused-active canonical refresh, no private-table publication. **Owning UI WPs/O38I**. |
| ID-F12 | P2 / defect / A | Both rewards flags OFF hides normal history entry; empty wallet still encourages earning while paused. `app\src\components\AccountScreen.tsx:231-255`; `app\app\coins.tsx:75-95`. | Keep readable balance/history; paused-aware eligibility text; preserve all paise/ledger policy. **O23**, focused money review. |
| ID-F13 | P2 / design / A | Cross-family safety/agreement text describes universal inspected-quote/code workflow; deletion operation is a request. `app\app\info\[topic].tsx:12-37,61-85`; `app\src\lib\onboarding\copy.ts:48-54`. | Scope wording to actual workflow; Request deletion, not instant erasure. No invented money/policy numbers. **O23/O26**, money/legal wording approval. |
| ID-F14 | P2 / design / C | Account business groups precede personal settings; non-cash qualifier follows full history. | Target S04/S11/S42/S46 hierarchies below; existing shared controllers. **O23**, `oorva_account_ux`. |
| ID-F15 | P2 / design / C | Metrics/secondary empty and sent modules precede urgent requests; active jobs emphasize creation date and visit fee regardless of archetype. | Pending decisions → next work → upcoming → secondary modules; stored archetype metadata only. **O25**, `oorva_provider_ux`. |
| ID-F16 | P2 / design / C | Share comes after completed form; owner-wide scope unclear; removal immediate; selected shop/venue context discarded. | Current next action first, confirmed access removal, real selected IDs or explicitly labelled aggregate. **O28**, `oorva_business_staff_ux`. |
| ID-F17 | P2 / design / C | Required credentials can be below optional link/photo work; optional strength competes with blockers. | Required repair first, retain seven steps/edit returns/footer and all validators/policy. **O26**, `oorva_onboarding_ux`. |
| ID-F18 | P2 / design / C | Admin audit shortcut leads queue search; review/context hierarchy can be clearer. | Queue/search → identity/scope → independent states/reason → valid action; history secondary. **O30**, `oorva_admin_ops_ux`. |

## Screen-by-screen placements

Each row contains current placement, verified retain/problem, target, reason/assertion and source. **Retain is not a test PASS.** Source paths below are relative to the frozen snapshot. Shared implementation test files are listed in the task table and exhaustively in JSON.

### S04 — Customer Account — O23

Route: `app\app\(customer)\account.tsx:1-10` → `GuestGate` → shared `AccountScreen`.

**Purpose/primary:** personal identity and settings; edit name. Secondary: actual own/member business entries, admin, support/legal. Destructive: confirmed logout.
**Current → target:** identity → business → personal → support **becomes** identity → personal/history → clearly separated own/member business → admin → support/legal/logout.

| Element | Current | Decision / exact target | Reason / concrete assertion | Evidence |
|---|---|---|---|---|
| Identity/edit | First card; customer opens name sheet | **Retain** shared edit, trimmed validation, save feedback | ID-ACCOUNT-01: blank fails; valid name reads back under same profile PK | `app\src\components\AccountScreen.tsx:85-108,125-158` |
| Personal/work order | Mode/marketplace before account settings | **Design F14:** personal first in customer composition | ID-ACCOUNT-02: new order only parent+leaf ON; corrected legacy OFF | `app\src\components\AccountScreen.tsx:160-217,231-294` |
| Delegated work | Own-provider read only; no member-work entry | **Defect F10:** actual memberships → Business work; setup/manage own provider separately | ID-ACCOUNT-03: staff-only account finds its work without being called owner; setup paths remain | `app\src\components\AccountScreen.tsx:40-72,160-217`; `supabase\migrations\0052_merchant_staff.sql:181-210` |
| Coins/history | Error becomes zero; both flags OFF hides entry | **Defects F11/F12:** unavailable ≠ zero; retain history route while paused | ID-WALLET-01: seeded nonzero wallet remains readable both OFF; rejected read never shows manufactured zero | `app\src\components\AccountScreen.tsx:45-56,231-255` |
| Admin/support/logout | Separate admin check, support/legal, confirmed logout | **Retain** authorization boundary/contacts; mark eligibility read failure unavailable | ID-ACCOUNT-04: non-admin RPC denied; cancelled logout no call; support available OFF | `app\src\components\AccountScreen.tsx:75-83,219-228,296-306`; `supabase\migrations\0059_admin_identity_hardening.sql:7-19` |

**Before observation:** `102-me-customer.png` visibly has identity/mode/marketplace first. No personal details or flag/role values are inferred.

### S08 — Business tools — O28

Route/body: `app\app\(provider)\business-tools.tsx`; real API: `app\src\lib\providerBusiness.ts`.

**Primary:** Create, then Share after creation. Secondary: history/staff. Destructive: cancel open invite.
**Target:** owner/protection context → form + exact fee summary → current Create/Share → dated status history → feature-valid staff shortcut.

| Element | Current | Decision / exact target | Reason / concrete assertion | Evidence |
|---|---|---|---|---|
| Fee/protection | 3% banner leads | **Retain** current fixed 300bp/customer-funded policy | ID-BYO-01: 250000 + 7500 = 257500 paise; no Oorva-driven money change | `app\app\(provider)\business-tools.tsx:43-60,90-104`; `supabase\migrations\0016_leakage_programme.sql:126-141` |
| Form/service list | Arrays initially empty; no initial loading state | **Defect F11:** loading/error/retry separate from no eligible services | ID-BYO-02: rejected service read cannot say successful empty; server still rejects invalid service/contact/amount | `app\app\(provider)\business-tools.tsx:21-45,107-168`; `supabase\migrations\0016_leakage_programme.sql:167-188` |
| Success Share | Below entire completed create form | **Design F16:** Share current result first; Create another secondary | ID-BYO-03: returned expiry shown; remount never reconstructs token | `app\app\(provider)\business-tools.tsx:170-180`; `app\src\lib\providerBusiness.ts:13-18` |
| History/actions | Status/category/total; no dates; open Cancel, claimed booking link | **Retain** action split; add returned times/expiry and cancel confirmation | ID-BYO-04: expired no new claim/cancel action; claimed opens exact booking PK; cancelled confirmation no call | `app\app\(provider)\business-tools.tsx:182-209`; `supabase\migrations\0016_leakage_programme.sql:316-365` |
| Staff shortcut | Always rendered | **Defect F10:** require actual owner + `merchant_staff` | ID-STAFF-ENTRY-01: OFF hides shortcut, not BYO history or existing fee contract | `app\app\(provider)\business-tools.tsx:211-212`; `app\app\merchant-staff.tsx:75-81` |

**Visual:** source-only; no inspected business-tools frame.

### S09 — Provider/member Dashboard — O25

Wrapper: `app\app\(provider)\dashboard.tsx:1-3`. Bodies: `ProviderDashboard`, owner/member views, job cards/widgets; actual nested travel, recurring and proposal modules were read.

**Primary:** expiring decision, otherwise next valid work action. Secondary: metrics/history/management. Member actions remain narrower.
**Current → target:** header/online/staff/readiness/stats → travel/repeat/proposal history → new requests/next **becomes** actor/readiness → urgent decisions → next/active/upcoming → compact secondary modules.

| Element | Current | Decision / exact target | Reason / concrete assertion | Evidence |
|---|---|---|---|---|
| Business/actor header | Owner greeting; member role but little business identity | **Retain** redacted owner/member split; name selected business | ID-DASH-01: own A + staff B selection shows B role/jobs and no payout/KYC controls | `app\src\features\providerDashboard\ProviderDashboard.tsx:49-52,184-200`; `supabase\migrations\0052_merchant_staff.sql:212-247` |
| Online/readiness | Online leads; KYC-only fallback; unconditional receiving/not-bookable text | **Defect F05:** canonical readiness or unknown, separate preference label | ID-READY-01: online + rejected review never promises receiving; offline alone is not universal scheduled-booking denial | `app\src\features\providerDashboard\ProviderDashboardView.tsx:91-107`; `DashboardWidgets.tsx:52-69` in same directory; `supabase\migrations\0079_f7_platform_fees_and_identity.sql:222-275` |
| Urgent requests | Stats/empty repeat/sent proposal modules first | **Design F15:** pending decisions before secondary content | ID-DASH-02: requested booking action precedes empty/sent modules in tree and useful viewport | `app\src\features\providerDashboard\ProviderDashboardView.tsx:109-164` |
| Next/active jobs | Eight-status filter omits confirmed/delivery | **Defect F07:** include both; safe detail CTAs | ID-DASH-03: same confirmed/delivery booking PK visible in owner/member/history; no guessed Start trip | `app\src\features\providerDashboard\ProviderDashboard.tsx:37-46,159-182`; `app\src\components\status.tsx:94-109` |
| Request card | Category/area/countdown/issue/photos/schedule/estimate/privacy/decision | **Retain** typed RequestCard and decline sheet | ID-DASH-04: address hidden before acceptance, unavailable estimate stays explicit, expired Accept disabled | `app\src\features\providerDashboard\JobCards.tsx:20-106`; `supabase\migrations\0052_merchant_staff.sql:249-287` |
| Context/readback | Provider committed before jobs; readiness errors swallowed | **Defect F11:** provider-ID/request-generation snapshot and visible retry | ID-DASH-05: late A result cannot overwrite or be acted on under B context | `app\src\features\providerDashboard\ProviderDashboard.tsx:77-126,130-156` |
| Management/quotes | Staff shortcut unconditional; manager quote predicate already specific | **Defect F10 / retain:** gate shortcut; keep manager/status quote rule | ID-DASH-06: staff no quote; manager only allowed three statuses; OFF shortcut gone | `app\src\features\providerDashboard\BusinessDashboardView.tsx:49-69`; `supabase\migrations\0079_f7_platform_fees_and_identity.sql:686-690` |

**Before:** `117-dashboard-next-job.png` shows metrics/calendar/empty repeat content in the first viewport. `159-new-pro-dashboard-status.png` separately displays Under review and payout-unavailable reason. `158-new-pro-submit.png` is a dashboard toast/loading frame, **not** a stuck-loading or verified-success proof.

### S11 — Provider Account — O23

Wrapper: `app\app\(provider)\pro-account.tsx:1-5`; bodies: shared `AccountScreen`, `ProviderMeSections`.

**Primary:** own provider management or explicit delegated work, not mode-as-ownership. Secondary: service/review summary, personal/support.
**Target:** identity + canonical readiness → actual own/member work → compact service/settings/reviews → personal → support/legal/logout.

| Element | Current | Decision / exact target | Reason / concrete assertion | Evidence |
|---|---|---|---|---|
| Identity check/edit | KYC checkmark, header goes onboarding, row goes hub | **Defect F05:** canonical marketplace label; payout explicit; edit hub/basics | ID-READY-02: same verified-KYC/rejected-review provider differs only by labelled axis, not whole-provider claim | `app\src\components\AccountScreen.tsx:127-165`; `app\app\provider-profile\index.tsx:82-98` |
| Service enable | `active` toggle toasts “live” | **Defect F05:** “enabled”, preserve write/rollback | ID-READY-03: enabling draft/rejected service never changes or promises whole-provider live | `app\src\components\ProviderMeSections.tsx:39-58,73-119` |
| Payout settings | Explicit “Payout account & KYC” in Work settings | **Retain** payout-specific scope, secondary to overall readiness | ID-ACCOUNT-PRO-01: payout under review does not change admin review; no owner KYC controls for member-only context | `app\src\components\ProviderMeSections.tsx:60-66,122-130` |
| Reviews | Secondary rating/date/reply; read failure becomes empty | **Defect F11 / retain:** keep hierarchy, show unavailable/retry | ID-ACCOUNT-PRO-02: error ≠ “No reviews yet”; successful zero still empty | `app\src\components\ProviderMeSections.tsx:27-37,132-189` |
| Navigation groups | Owner-labelled work from mode, then marketplace/personal | **Design F14 / defect F10:** actual ownership/member groups; retain setup/personal paths | ID-ACCOUNT-PRO-03: owner A/member B sees distinct destinations; support/customer switch work OFF | `app\src\components\AccountScreen.tsx:160-229,263-306` |

**Before:** `138-me-provider.png` shows Work and Business tools before marketplace tools; visible checkmark is not evidence of gateway/admin/doc state.

### S19 — Admin Documents — O30

Route/body: `app\app\admin\documents.tsx`; API: `adminApi`.

**Primary:** review one pending credential. Secondary: private preview. Destructive: confirmed rejection.
**Target:** queue → provider/category/type → preview → expiry/reason → valid confirmed review.

| Element | Current | Decision / exact target | Reason / concrete assertion | Evidence |
|---|---|---|---|---|
| Pending queue | Oldest pending records; loading/error/empty | **Retain** canonical filter and admin guard | ID-DOC-ADMIN-01: same document ID removed after review; non-admin list denied | `app\app\admin\documents.tsx:31-45`; `supabase\migrations\0009_provider_onboarding.sql:1132-1149` |
| Scope context | Provider/type/time, unused category ID | **Design F03/F18:** add safe category label or General credential | ID-DOC-ADMIN-02: category-specific credential never presented as provider-wide approval | `app\app\admin\documents.tsx:101-114`; `app\src\lib\adminApi.ts:134-144` |
| Preview | 300-second signed URL | **Retain** private preview before action | ID-DOC-ADMIN-03: admin/owner allowed, unrelated user denied; no private credential path in public projection; public portfolio paths retained | `app\app\admin\documents.tsx:47-59`; `app\src\lib\adminApi.ts:370-375`; `supabase\migrations\0009_provider_onboarding.sql:1475-1480` |
| Review inputs/actions | Direct mutation; reason/expiry validation; global busy string | **Design F03:** confirmation and duplicate-operation prevention | ID-DOC-ADMIN-04: cancel no call; invalid reason/expiry denied; terminal document cannot be reviewed twice | `app\app\admin\documents.tsx:61-89,123-153`; `supabase\migrations\0088b_b6_money_notifications.sql:881-900` |
| Cross-role readback | Queue reload; owner focus-only freshness | **Defect F11 / retain:** authoritative queue readback and bounded owner refresh | ID-DOC-ADMIN-05: same document/provider re-read within 60 seconds focused-active or on focus/foreground; no KYC/review side effect | `app\app\admin\documents.tsx:74-89`; `app\src\features\providerOnboarding\useOnboardingData.ts:21-37` |

**Visual:** source-only. Backend pending guard is retained, not falsely reported missing.

### S25 — Admin People — O30

Route/body: `app\app\admin\people.tsx`.

**Primary:** outstanding submitted provider review. Secondary: audit; suspension separate.
**Target:** search/review queue → identity/persona → independent review/payout/readiness/availability → stored reason → valid action.

| Element | Current | Decision / exact target | Reason / concrete assertion | Evidence |
|---|---|---|---|---|
| Search/count/empty | Audit first; counts from current filtered rows; no empty body | **Defect F01 / design F18:** search first, truthful results count, no fake totals, explicit no results | ID-PEOPLE-01: Creator subset cannot become All total | `app\app\admin\people.tsx:27-36,79-88`; `supabase\migrations\0064_o2_provider_verification.sql:47-55` |
| State axes | Badge picks suspended/paused/review; no canonical readiness/reason in model | **Defect F01:** separate labelled axes from private canonical projection | ID-PEOPLE-02: approved+paused both visible; rejected+KYC verified stays not live | `app\app\admin\people.tsx:48-55,97-112`; `supabase\migrations\0064_o2_provider_verification.sql:14-46` |
| Review actions | All three whenever submitted | **Defect F01:** hide same target; disable approval missing existing account prerequisite; retain alternate review | ID-PEOPLE-03: approved no Approve; clarification no repeated Ask changes; unsubmitted no review | `app\app\admin\people.tsx:113-125`; `supabase\migrations\0088b_b6_money_notifications.sql:944-977` |
| Reason/confirm | Existing validation and confirm; previous reason not shown | **Retain** guard; display stored review reason beside state | ID-PEOPLE-04: blank reject reason/cancel no mutation; owner/admin reason agree | `app\app\admin\people.tsx:38-75`; `supabase\migrations\0088b_b6_money_notifications.sql:944-977` |
| Creator/refresh | Server persona; no latest-response search guard | **Retain** persona, **defect F11** response freshness | ID-PEOPLE-05: active proposal service changes classifier, not auth role; old query cannot overwrite new | `app\app\admin\people.tsx:27-35,89-96`; `supabase\migrations\0064_o2_provider_verification.sql:37-40` |

**Visual:** source-only. Do not reintroduce the already fixed admin-KYC override.

### S42 — Seva Coins — O23

Route/body: `app\app\coins.tsx`.

**Primary:** read value/history, not withdraw cash. Secondary: acknowledge conversion notice.
**Target:** count/value + immediate non-cash qualifier → enabled/paused eligibility → optional notice → ledger.

| Element | Current | Decision / exact target | Reason / concrete assertion | Evidence |
|---|---|---|---|---|
| Value/qualifier | Large rupee amount; non-cash below ledger | **Design F14:** adjacent non-cash/non-transferable qualifier | ID-COINS-01: denomination changes count, never stored paise/equivalent value | `app\app\coins.tsx:63-83,125-128` |
| Eligibility | Returned config policy; unconditional empty encouragement | **Defect F12 / retain** config: paused-aware eligible-booking text | ID-COINS-02: earning OFF never promises first reward; redemption OFF independent | `app\app\coins.tsx:75-95`; `supabase\migrations\0062_coins_hardening.sql:218-267` |
| Load/error/empty | `history=[]` before result; optional notice read coupled | **Defect F11:** explicit load/empty/stale/error; notice failure independent | ID-COINS-03: rejected or pending ledger never “No activity”; notice failure retains successful wallet | `app\app\coins.tsx:26-43,52-65,87-99` |
| Ledger rows | Kind/date/expiry/signed delta/reason, real ledger ID | **Retain** six kinds/units/history | ID-COINS-04: negative adjustments and expiry stay exact; other user's rows denied | `app\app\coins.tsx:15-22,97-121`; `supabase\migrations\0015_seva_coins.sql:24-60` |
| Conversion/refresh | Notice leads; acknowledgement persisted; focus reload | **Retain**, optional composition moves notice below balance | ID-COINS-05: acknowledgement persists; both flags OFF still read history; no historical credit rewrite | `app\app\coins.tsx:13,32-61`; `supabase\migrations\0047_coins_config.sql:1-28` |

**Before:** `103-coins-wallet.png` shows the value/policy card before History and non-cash text. Displayed amounts/config are not treated as verified account data.

### S46 — Legal/safety/privacy/help — O23

Route/body: `app\app\info\[topic].tsx`.

**Primary:** read topic or contact configured support; privacy records a deletion **request**.
**Target:** scoped summary → relevant policy → contextual support → separate confirmed danger action.

| Element | Current | Decision / exact target | Reason / concrete assertion | Evidence |
|---|---|---|---|---|
| Topic/scope | Universal “Every booking” home-style protection copy | **Design F13:** qualify inspected-quote versus accepted package/proposal workflow | ID-INFO-01: no universal visit/quote/code claim; no money-policy number changed | `app\app\info\[topic].tsx:12-37`; `supabase\migrations\0081_c2_creator_delivery.sql:664-680` |
| Support | Configured email/optional call/WhatsApp on help with launch errors | **Retain** contacts/failure feedback; contextual access elsewhere | ID-INFO-02: missing optional channel alone hidden; failed launch explicit; no invented contact | `app\app\info\[topic].tsx:106-137` |
| Delete action | Privacy/session gate, danger zone, destructive confirmation | **Retain**, label Request deletion and processing | ID-INFO-03: cancel no call; repeated requests one pending row; financial records unchanged | `app\app\info\[topic].tsx:61-85,138-153`; `supabase\migrations\0067_u3_account_deletion.sql:31-47` |
| Outcome | Recorded RPC or email fallback; neither executes erasure | **Retain** outcome distinction | ID-INFO-04: email says send message, not stored/deleted; fulfilment/SLA remains unverified | `app\src\lib\supabaseApi.ts:94-105`; `app\app\info\[topic].tsx:74-85` |

**Visual:** source-only.

### S47 — Job history — O25

Route/body: `app\app\jobs.tsx`.

**Primary:** open actual booking PK. Secondary: All/Active/Closed.
**Target:** own-business context/filter → current/stale feedback → status/schedule → customer/category/area/unread → truthful archetype metadata.

| Element | Current | Decision / exact target | Reason / concrete assertion | Evidence |
|---|---|---|---|---|
| Filter/actor | Own-provider RPC; header filters | **Retain** own history, not selected other-business history | ID-JOBS-01: actual owner/member use distinct authorized projections | `app\app\jobs.tsx:26-60`; `supabase\migrations\0001_init.sql:1375-1389` |
| Date/status | Unlabelled creation date then lower pill | **Design F15:** active scheduled date/status first; creation labelled | ID-JOBS-02: created yesterday/scheduled later never looks like yesterday's appointment | `app\app\jobs.tsx:93-109`; `app\src\lib\types.ts:376-389` |
| Visit fee | Every archetype shows Visit fee, proposal can show zero | **Design F15:** stored archetype, no non-visit zero-fee headline; existing detail for money | ID-JOBS-03: no invented job total/earning from visit fee | `app\app\jobs.tsx:111-118`; `supabase\migrations\0081_c2_creator_delivery.sql:664-680` |
| Unread/privacy/link | Booking PK, area and shared helpers | **Retain** exact identity/address privacy | ID-JOBS-04: identical customer names do not merge jobs; unread follows PK through filters | `app\app\jobs.tsx:81-110`; `supabase\migrations\0001_init.sql:1377-1382` |
| Refresh/empty | Pull/focus; errors hidden when old jobs exist | **Defect F11:** readable stale rows + Retry, filter-specific empty | ID-JOBS-05: failed refresh visible; zero Active ≠ no history | `app\app\jobs.tsx:26-41,65-80` |

**Before:** `128-job-history.png` actually shows proposal-category rows with Confirmed/Expired/Cancelled and zero Visit fee; that is not evidence of zero payment/earnings.

### S51 — Assigned business job — O25

Route/body: `app\app\merchant-job\[id].tsx`.

**Primary:** permitted chat or valid existing safety action. Secondary: private booking context.
**Target:** current status/allowed next action → schedule/customer/address → correctly attributed conversation → keyboard-safe composer.

| Element | Current | Decision / exact target | Reason / concrete assertion | Evidence |
|---|---|---|---|---|
| Current status | Raw header status; message-only subscription | **Defect F08:** shared StatusPill and existing booking subscription | ID-MJOB-01: remote cancellation re-reads same PK and disables send without refocus | `app\app\merchant-job\[id].tsx:27-49,135-146`; `app\src\lib\supabaseApi.ts:840-853` |
| Customer/address | Server-projected area/street | **Retain** accepted-address boundary, no phone expansion | ID-MJOB-02: member street/coordinates null before accepted_at, authorized after | `app\app\merchant-job\[id].tsx:151-160`; `supabase\migrations\0052_merchant_staff.sql:289-304` |
| Safety actions | No-show lacks schedule/grace; cancellation actual owner only | **Defect F08 / retain** owner difference: server eligibility projection, exact configured time | ID-MJOB-03: future/unscheduled/exact grace denied; manager not promoted to owner | `app\app\merchant-job\[id].tsx:63-85,103-133`; `supabase\migrations\0083_h3_home_booking_safety.sql:191-216` |
| Sender identity | All nonself messages “Customer” | **Defect F08:** self You; customer ID Customer; other authorized sender Business team | ID-MJOB-04: owner + two staff + customer correctly attributed using current IDs | `app\app\merchant-job\[id].tsx:183-198`; `supabase\migrations\0052_merchant_staff.sql:306-319` |
| Composer/read state | Blind append; no shared active-chat lifecycle | **Defect F08:** dedup message ID, shared unread active/read, clean blur | ID-MJOB-05: duplicate event once; open chat no own unread banner; preserve current terminal send rules | `app\app\merchant-job\[id].tsx:38-60`; `app\src\lib\unreadContext.tsx:120-133` |

**Visual:** source-only. No new member cancellation/no-show authority is proposed.

### S54 — Business staff — O28

Route/body: `app\app\merchant-staff.tsx`.

**Primary:** add/change existing-user access. Secondary/destructive: confirmed deactivate membership.
**Target:** owner-wide scope → current members/error → UUID form/role rights → confirmed contextual removal.

| Element | Current | Decision / exact target | Reason / concrete assertion | Evidence |
|---|---|---|---|---|
| Scope | Calls use current UID owner; scope unnamed | **Design F16:** explicit owner/business context and owner-wide access | ID-STAFF-01: no invented per-venue member permission dimension | `app\app\merchant-staff.tsx:19-35`; `supabase\migrations\0052_merchant_staff.sql:5-13,128-150` |
| UUID form | Existing user ID; no invitation sent | **Retain** contract; inline malformed-UUID feedback | ID-STAFF-02: unknown/self/malformed fails; no phone/email/link API added | `app\app\merchant-staff.tsx:86-105`; `supabase\migrations\0052_merchant_staff.sql:135-150` |
| Role rights | Staff reads/chat; manager adds quotes; no owner settings | **Retain** exact minimum-role distinction | ID-STAFF-03: manager quote allowed but members/payout/verification denied; staff quote denied | `app\app\merchant-staff.tsx:120-131`; `supabase\migrations\0052_merchant_staff.sql:45-68` |
| Member/remove | Active/inactive/UUID; immediate Remove | **Design F16:** confirm access removal, retain inactive row | ID-STAFF-04: cancel no mutation; confirm changes only same owner/member active bit | `app\app\merchant-staff.tsx:61-73,106-117`; `supabase\migrations\0052_merchant_staff.sql:153-166` |
| OFF/load/readback | Explicit OFF; failed read can look empty | **Defect F11:** null/loading/error/retry distinct; no successful-empty on denial | ID-STAFF-05: owner error Retry; manager owner-only error; OFF server denies management | `app\app\merchant-staff.tsx:22-42,75-84,106-117` |

**Visual:** source-only. `invited_at` does not establish an invitation acceptance lifecycle.

### S55 — Business work — O28

Route/body: `app\app\merchant-work.tsx`.

**Primary:** selected authorized business work. Secondary: explicitly labelled aggregate work, if retained.
**Target:** actual business/role selection → effective capability destinations → truthful load/empty/error.

| Element | Current | Decision / exact target | Reason / concrete assertion | Evidence |
|---|---|---|---|---|
| Business key | owner:type; no venue ID in response | **Defect F10:** add real business_id; key type:PK | ID-MWORK-01: two same-owner same-name venues remain distinct | `app\app\merchant-work.tsx:35-38`; `supabase\migrations\0052_merchant_staff.sql:181-209`; `0048_sports.sql:17-35` |
| Provider destination | Explicit providerId already passed | **Retain** selected-provider authorization | ID-MWORK-02: owner A/staff B opens B; unauthorized C denied, not fallback A | `app\app\merchant-work.tsx:39-44`; `supabase\migrations\0052_merchant_staff.sql:224-245` |
| Other destination scope | No selected shop/venue parameters; authorized aggregates/first shop | **Design F16:** selected IDs retained, or clearly label All businesses | ID-MWORK-03: selecting B shows B; spoofed ID never bypasses `_acts_for` | `app\app\merchant-work.tsx:45-53`; `supabase\migrations\0052_merchant_staff.sql:591-649`; `0074_p1b_rfq.sql:309-340` |
| Capability parents | Only merchant_staff tested | **Defect F10:** products+enquiries/RFQ parents; sports separately | ID-MWORK-04: products OFF/RFQ ON no RFQ link; sports OFF no new sports entry | `app\app\merchant-work.tsx:10-27,45-53`; `app\src\features\shops\components.tsx:9-15` |
| Error/refresh | Failure leaves null + forever skeleton; no Retry | **Defect F11:** explicit recovery and stale membership invalidation | ID-MWORK-05: removed/failed membership read never stays actionable | `app\app\merchant-work.tsx:11-35` |

**Visual:** source-only. Authorized aggregate data is not itself an unauthorized exposure; selected-context repair must preserve that distinction.

### S57 — Seven-step onboarding — O26

Route: `app\app\onboarding.tsx`; all seven shared section bodies, nested six-step service editor and package editor were read.

**Primary:** current Save/Continue, then agreement/submit. Secondary: supported Skip/preview.
**Target:** retain compact step/progress/footer → current required repair/error → actual fields → explicit save/readback; optional work remains optional.

| Element | Current | Decision / exact target | Reason / concrete assertion | Evidence |
|---|---|---|---|---|
| Steps/resume/footer | Seven STEP_KEYS, compact header, persistent footer | **Retain** existing wizard/controller | ID-ONB-01: missing Hours resumes Hours; submitted resumes Review; same terms version | `app\app\onboarding.tsx:20-66`; `app\src\features\providerOnboarding\parts.tsx:32-79`; `app\src\lib\onboarding\completeness.ts:86-92` |
| Basics/Hours draft | Unscoped device key | **Defect F04:** UID-scoped, race-safe draft recovery | ID-DRAFT-01: A never hydrates B; own resume works; sensitive payout fields excluded | `app\src\features\providerOnboarding\useOnboardingData.ts:45-69` |
| Service editor | Six substeps, exact IDs/configured fields, packages after save | **Retain** validation/IDs/outer Continue lock | ID-ONB-02: same service PK/category, expertise/travel/packages preserved; no duplicate row | `app\src\features\providerOnboarding\ServicesSection.tsx:117-226`; `services\EditorPanel.tsx:74-118` within that feature |
| Area/hours | Pin/radius, slots/time off/capacity | **Retain** private location, timezone and server bounds | ID-ONB-03: overlapping slots fail; radius 1..50/capacity 1..30 or null unchanged; no private reason leak | `app\src\features\providerOnboarding\AreaSection.tsx:117-150`; `supabase\migrations\0009_provider_onboarding.sql:554-576,593-634` |
| Required credentials | After optional links/photos; latest raw approved labelled Live | **Defect F02 / design F17:** canonical scoped requirements before optional work when needed | ID-DOC-01: valid A/missing B only B repair; replacement does not revoke valid old credential | `app\src\features\providerOnboarding\PortfolioSection.tsx:13-18,49-70,169-240`; `supabase\migrations\0009_provider_onboarding.sql:440-467` |
| Payout setup | Explicit account view; individual-only; supported skip | **Retain policy / defect F06:** legacy setup counts, no re-onboarding | ID-PAYOUT-01: legacy ID no row not missing; business toggle alone still cannot enable unsupported mapping | `app\src\features\providerOnboarding\PayoutSection.tsx:16-24,178-223`; `supabase\functions\provider-payout-account\index.ts:39-40` |
| Review/readback | Required checks + terms; reload swallows failure | **Defect F11 / retain guards:** write success separate from failed canonical re-read | ID-ONB-04: submitted is not approved/verified/live; saved-but-refresh-failed visible | `app\src\features\providerOnboarding\ReviewSection.tsx:27-50,68-109`; `supabase\migrations\0009_provider_onboarding.sql:815-837` |

**Visual:** no directly inspected wizard frame. The two submitted/dashboard frames are adjacent outcome observations only, not a wizard or gateway PASS.

### S64 — Provider profile section host — O26

Route: `app\app\provider-profile\[section].tsx`. Actual sections: Basics, Services, Area, Hours, Portfolio, Payouts; Review special case. All nested service steps/package editor were read.

**Primary:** Save/Done current section. Secondary: existing section-specific actions; removal confirmed where required.
**Target:** same host/returns → visible read/save state → required work/current form → persistent primary.

| Element | Current | Decision / exact target | Reason / concrete assertion | Evidence |
|---|---|---|---|---|
| Host/returns | Six validated keys, review special, controlled services/hub return | **Retain** navigation and unknown-section error | ID-SECTION-01: services→portfolio returns Services; normal edit hub; Done current terms no resubmit | `app\app\provider-profile\[section].tsx:8-44`; `app\src\features\providerOnboarding\sections.ts:13-23` |
| Basics | Photo/name/private gender/languages/experience/bio; unscoped draft | **Defects F04/F11:** own draft and visible readback failure, same validators | ID-SECTION-02: identity isolation, same PK, dirty edit preserved | `app\src\features\providerOnboarding\BasicsSection.tsx:21-39,56-82,130-154` |
| Service/package editor | Configured six steps, locked category, packages/rate items | **Retain**, current edit dominant; confirm package removal in composition | ID-SECTION-03: all expertise/travel/rights/deliverable fields retained on same IDs | `app\src\features\providerOnboarding\ServicesSection.tsx:77-91`; `services\ServiceCard.tsx:124-176`; `ProviderPackageEditor.tsx:79-148` within feature |
| Area/hours | Validated coverage/schedule/time off | **Retain** bounds/timezone/private reasons, secondary illustration | ID-SECTION-04: no implicit recurring cancellation or verification change | `app\src\features\providerOnboarding\AreaSection.tsx:117-150`; `HoursSection.tsx:80-108,165-199` within feature |
| Credential truth | Latest type ignores scope/expiry; approved→Live | **Defect F02:** current valid credential versus latest submission | ID-SECTION-05: expired approval not Live; scoped A cannot clear B; pending replacement coexists with valid approval | `app\src\features\providerOnboarding\PortfolioSection.tsx:13-18,49-70,232-269`; `supabase\migrations\0009_provider_onboarding.sql:257-278` |
| Credential placement | Optional link/photo controls first | **Design F17:** blocking required repair first, recommended remains optional | ID-SECTION-06: relevant rejected/missing requirement precedes optional editor | `app\src\features\providerOnboarding\PortfolioSection.tsx:21-46,169-240` |
| Payout section | Account-specific masked/status/refresh/edit; business unavailable | **Retain**, fix legacy setup only | ID-SECTION-07: payout verified/admin rejected remains two facts; member cannot submit owner's payout | `app\src\features\providerOnboarding\PayoutSection.tsx:16-24,301-355`; `supabase\functions\provider-payout-account\index.ts:63-119` |
| Price guidance | Failure swallowed, null still Checking | **Defect F11:** separate nonblocking Unavailable/Retry | ID-SECTION-08: service save remains entered/server-validated paise; no invented advice | `app\src\features\providerOnboarding\ServicesSection.tsx:56-63`; `services\PricingStep.tsx:37-56` within feature |

**Before:** `135-provider-profile-portfolio.png` shows optional link creation in its first viewport; no required-document fixture is inferred. `136-provider-profile-payouts.png` explicitly says Payout account Verified, not whole-provider approval.

### S65 — Provider profile hub — O26

Route/body: `app\app\provider-profile\index.tsx`; typed `GoLiveStatusCard`, existing completeness/sections.

**Primary:** repair actual blocking requirement, otherwise edit/manage. Secondary: preview/share and availability. Destructive: confirmed deactivate.
**Target:** canonical state/required repair → identity/sections → optional strength → preview/share → holiday/deactivate.

| Element | Current | Decision / exact target | Reason / concrete assertion | Evidence |
|---|---|---|---|---|
| Canonical state | Server go_live drives hub/card | **Retain**, repair backend reasons; reuse elsewhere | ID-HUB-01: each state matches same PK; score alone never enables Share | `app\app\provider-profile\index.tsx:81-98`; `app\src\features\providerOnboarding\GoLiveStatusCard.tsx:42-75` |
| Legacy setup tip | Optional check/step can say missing bank despite supported legacy account | **Defect F06:** recognize legacy identifier for setup only | ID-HUB-02: no forced new payout account/rail; pending setup still not verified | `app\app\provider-profile\index.tsx:100-124`; `app\src\lib\onboarding\completeness.ts:78-81`; `supabase\migrations\0009_provider_onboarding.sql:391-394` |
| Required/optional hierarchy | Top three strength tips before section list | **Design F17:** blocking repair then optional strength | ID-HUB-03: required rejection outranks optional portfolio tips; all sections reachable | `app\app\provider-profile\index.tsx:100-125`; `app\src\lib\onboarding\completeness.ts:58-68` |
| Preview/share | Own Preview; Share only state live | **Retain** owner preview/live share, separate paused availability | ID-HUB-04: draft owner preview allowed, public draft denied, no booking guarantee from Share | `app\app\provider-profile\index.tsx:64-68,127-136`; `supabase\migrations\0087_ui_redesign_flags_guest_read.sql:555-574` |
| Holiday/deactivate | Separate toggle/confirm; specific active-job guard | **Retain** exact guard, no state expansion; ID-Q01 resolved; qualify existing duties | ID-HUB-05: pause forces offline, no review/KYC rewrite; cancel no mutation; current guarded/allowed-state treatment and existing work/payment duties unchanged | `app\app\provider-profile\index.tsx:70-77,138-163`; `supabase\migrations\0009_provider_onboarding.sql:678-726` |
| Refresh | `refreshing=false`; post-load errors hidden | **Defect F11:** truthful stale/error/refresh and bounded canonical refresh | ID-HUB-06: admin/doc/payout update observed by canonical re-read; failed read never fabricates Live | `app\app\provider-profile\index.tsx:34-62,81-83`; `app\src\features\providerOnboarding\useOnboardingData.ts:21-38` |

**Before:** `130-provider-profile-hub.png` visibly shows You are live and an Add bank account strength tip together. Its exact hosted database cause is **not inferred**; ID-F06 separately provides a deterministic source reproduction.

## Canonical entity contracts

### Identity keys and independent state axes

| Contract | Actual identity / values | Important distinction / source |
|---|---|---|
| Customer | `profiles.id` PK/FK `auth.users.id`; booleans `role_customer`, `role_provider` can coexist. `preferred_language=en|te`. | `ActiveRole=customer|provider` is local tab preference, not authorization. `supabase\migrations\0001_init.sql:33-51`; `0045_preferred_language.sql:1-29`; `app\src\lib\auth.tsx:5-19,32-64`. |
| Deletion request | Separate request `id`; `user_id`; `pending|done|rejected`; one pending/user. | Exposed RPC inserts pending only, does not erase account. `supabase\migrations\0067_u3_account_deletion.sql:3-47`. |
| Membership | PK `(owner_id,member_id)`, `owner_id<>member_id`; schema role `owner|manager|staff`; `active` boolean, `invited_at`. | Public add accepts manager/staff only; actual owner implicit; no invitation acceptance. Covers owner's business types. `supabase\migrations\0052_merchant_staff.sql:5-68,128-166`. |
| Provider/business | `providers.id=profiles.id`; service PK with unique `(provider_id,category_id)`; shop PK plus unique owner; venue PK, multiple per owner. | Display names/owner:type are not venue PKs. `supabase\migrations\0001_init.sql:88-121`; `0049_shops_catalogue.sql:38-60`; `0048_sports.sql:17-35`. |
| Gateway/KYC | `pending|verified|rejected|under_review|needs_clarification|suspended`. Gateway `activated→verified`; other mapped statuses preserve meaning; unknown→pending. | Service-role sync, stale-event guard; not admin review. `supabase\migrations\0009_provider_onboarding.sql:1037-1050`; latest sync `0058_sports_payments.sql:174-255`. |
| Admin review | `pending|approved|rejected|needs_clarification`, independent `review_note`. | Latest review modifies these only; submitted/account/reason guards remain. `supabase\migrations\0064_o2_provider_verification.sql:3-5`; `0088b_b6_money_notifications.sql:944-977`. |
| Documents | Separate document PK; `doc_type`, nullable category scope; raw `pending|approved|rejected|expired|superseded`; expiry, reason, review metadata. | Any matching valid approval can satisfy requirement despite a pending replacement. `supabase\migrations\0009_provider_onboarding.sql:180-194,257-278,803-806`. |
| Setup completeness | Required name/photo/bio/languages/services/area/hours; recommended specialisations/portfolio/payout. | Percentage is not permission/verification. `supabase\migrations\0009_provider_onboarding.sql:368-398`; `app\src\lib\onboarding\completeness.ts:6-63`. |
| Base provider readiness | `draft|under_review|action_needed|live|suspended|deactivated`, reasons + independent `paused`. | Precedence is deactivated → suspended → unsubmitted draft → live predicate → action reason → under review. `supabase\migrations\0009_provider_onboarding.sql:477-486`. |
| Availability | `is_online`, `paused`, time off, hours, capacity, category/city/archetype/window. | Online setter only writes own preference. Base live does not imply every service/slot bookable. `supabase\migrations\0001_init.sql:770-783`; `0018_archetype_core.sql:239-282`; `0009_provider_onboarding.sql:313-365`. |
| Creator | Existing provider persona; admin `is_creator=exists(active proposal-archetype service)`. | No creator auth role/PK/status engine. Existing booking statuses `confirmed`/`delivery_pending` remain real active work. `supabase\migrations\0064_o2_provider_verification.sql:37-40`; `0088b_b6_money_notifications.sql:284-294`; `0023_proposal_milestone_booking.sql:838-853`. |

### Provider composite — retain the exact rule

Latest `_provider_is_live` requires:

1. Existing provider with payout-normalized `kyc_status='verified'`.
2. Independent `admin_review_status='approved'`.
3. Not suspended, not deactivated, and `submitted_at` present.
4. **At least one** active service whose category's required documents pass `_category_docs_ok`.

It does **not** require all services, `is_online`, a 100% profile score, or unpaused availability. Additional category/city/archetype/paused/time/leave/capacity predicates control actual discovery/booking. Do not “fix” these legitimate distinctions into one universal status.

Evidence: `supabase\migrations\0064_o2_provider_verification.sql:62-80`; `0018_archetype_core.sql:239-282`; `0079_f7_platform_fees_and_identity.sql:222-275`.

Document validity uses a matching provider/type, general or exact-category scope, raw approved and null expiry or expiry **on/after provider-local today**. The latest submission is not necessarily the currently satisfying credential. ID-T01 repairs explanations, **not this permission policy**.

### Resolved public-badge disposition — ID-D01 / ID-T20

**No new safe read projection is needed. Retain `public.get_provider_public_profile(uuid)` and its existing wire fields unchanged.** Its already-read source gives sufficient public-safe facts:

| Existing field | Exact predicate / meaning | Truthful consumer disposition |
|---|---|---|
| `badges.id_verified` | KYC `verified` **and** payout-account identifier has the escaped `acc_` shape | A legacy account-provenance indicator, **not an independent ID-document approval**. Keep the compatible wire field; do not emit a separate “ID verified/approved” or background-check badge from it. |
| `badges.payout_verified` | KYC `verified`, without account-shape requirement | Render **Payout account verified**, including a verified fund-account path where `id_verified=false`. It does not imply admin approval, document approval or currently bookable service/slot. |
| `badges.police_verified` | Approved, provider-local-unexpired `police_verification` document | Render **Police certificate approved**, independently of payout verification. |
| `credentials` | Existing approved/unexpired document-type labels | Preserve those server-projected credential labels. Do not fetch private documents to reconstruct them or invent a general ID-approval status. |

Evidence: `supabase\migrations\0087_ui_redesign_flags_guest_read.sql:575-591`; safe DTO `app\src\lib\onboarding\types.ts:237-245`. Independent base-live/admin predicate remains `supabase\migrations\0064_o2_provider_verification.sql:62-80`.

**Exact implementation:** O38I supplies `app\src\lib\onboarding\publicTrust.ts` with `providerPublicTrust(Pick<PublicProfile,'badges'|'credentials'> | null)`; O14 consumes it in the already-audited `app\src\features\providerProfile\{ProviderProfileScreen.tsx,ProviderProfileHero.tsx,ProviderProfileCallouts.tsx}`. It returns loaded/unavailable public badge presentation and unchanged credential labels, not a new identity status. Existing owner `GO_LIVE`/`reasonCopy` helpers have private owner-readiness inputs and cannot substitute for this public-safe presentation helper.

Tests: `app\src\lib\onboarding\__tests__\publicTrust.test.ts` checks equal payout wording for `(id=false,payout=true)` and `(id=true,payout=true)`, independent police/credential facts and missing-read unavailable. `app\src\features\providerProfile\__tests__\publicTrust.test.tsx` asserts no independent-ID claim in visible/accessibility text, no private document/account query/prop and the same truthful wording with cosmetic flags OFF.

Consumer paths come from the completed marketplace S63 handoff; S63 is **not re-audited or added to identity screen coverage**. Existing guarded listing/shop trust provenance is not reclassified as fabricated. Public portfolio paths remain legitimate; **private credential paths, account identifiers, admin reasons and payout-account records must not be added**.

### Lifecycle / actor / action / cross-view refresh matrix

Each workflow compares the **same PK** across its actors. Independent scenarios must use isolated providers/businesses/customers/slots.

| Case | Lifecycle / actor / allowed action | Actor-specific result / denied action | Canonical readback / refresh / evidence |
|---|---|---|---|
| ID-MX01 | Customer self saves provider Basics | Same profile/provider PK, role_provider true, draft; no new auth/admin/creator role | Account/onboarding re-read UID. `supabase\migrations\0009_provider_onboarding.sql:519-551`. |
| ID-MX02 | Self requests deletion twice | One pending request; profile/history remain; cannot target another user | Recorded/email UI outcome, not erased state. `supabase\migrations\0067_u3_account_deletion.sql:19-47`. |
| ID-MX03 | Owner adds absent/inactive member as staff/manager, feature ON | Same owner/member upsert active; no invitation delivery/self-promotion | Owner list reload, member focus/foreground refresh. `supabase\migrations\0052_merchant_staff.sql:128-150`. |
| ID-MX04 | Manager versus staff sends quote in inspecting/quote_sent/in_progress | Manager allowed; staff denied; neither gains owner payout/member/verification control | Same booking/quote readback; existing booking subscription. `supabase\migrations\0079_f7_platform_fees_and_identity.sql:686-690`. |
| ID-MX05 | Owner removes member or staff capability OFF | Delegation denied; actual owner work remains; view exception is F09 | Invalidate stale selected context; same membership stored inactive/OFF. `supabase\migrations\0052_merchant_staff.sql:27-68,153-166`. |
| ID-MX06 | Self submits complete current agreement | Records submission/terms; not automatic gateway/admin approval | Return/re-read canonical go_live, admin submitted queue. `supabase\migrations\0009_provider_onboarding.sql:815-837`. |
| ID-MX07 | Admin approves submitted provider with payout account but pending KYC | Admin Approved and payout pending, still not live; completed Approve disappears | Admin reload; owner canonical re-read within 60s focused-active or immediately focus/foreground. `supabase\migrations\0088b_b6_money_notifications.sql:944-977`. |
| ID-MX08 | Gateway activates payout on admin-rejected provider | KYC verified, review rejected unchanged, not live; stale callback ignored | Owner/admin canonical refetch. `supabase\migrations\0058_sports_payments.sql:195-252`; `0064_o2_provider_verification.sql:62-80`. |
| ID-MX09 | Admin approves/rejects one pending document | Changes document only; non-admin/repeated terminal review denied | Queue removes ID; owner requirement refetch; public safe credential refetch. `supabase\migrations\0088b_b6_money_notifications.sql:881-925`. |
| ID-MX10 | Required A valid, B missing; read as owner/admin/customer | Category blocked by B, A not expired; no private public credential data | Exact per-requirement projection/date refresh. `supabase\migrations\0009_provider_onboarding.sql:257-278,440-467`. |
| ID-MX11 | One service eligible, another category blocked | Base provider can remain live; blocked category remains blocked | Per-service `_is_bookable` and public/admin/owner readback; no all-services policy. `supabase\migrations\0064_o2_provider_verification.sql:70-79`; `0018_archetype_core.sql:255-280`. |
| ID-MX12 | Actual owner toggles online or holiday | Online preference only; holiday pauses and forces offline, no KYC/review rewrite | Immediate own readback, public refresh; existing work retained. `supabase\migrations\0001_init.sql:770-783`; `0009_provider_onboarding.sql:678-692`. |
| ID-MX13 | Admin suspends/restores | Suspend forces offline; Restore clears suspension only, not KYC/review/deactivation | Admin reload/owner refresh; no promise of automatic new work. `supabase\migrations\0088b_b6_money_notifications.sql:1006-1045`. |
| ID-MX14 | Self deactivates/reactivates | ID-Q01 resolved: exact existing guard retained, no `confirmed`/`delivery_pending` expansion; existing work/payment duties and payout/history remain | Owner/public canonical readback; no deactivation SQL/policy redesign. `supabase\migrations\0009_provider_onboarding.sql:695-726`. |
| ID-MX15 | Provider enables/removes active proposal service | Derived creator persona changes, auth roles do not | Same provider in admin/owner re-read. `supabase\migrations\0064_o2_provider_verification.sql:37-40`. |
| ID-MX16 | Paid proposal confirmed → provider starts → delivery_pending | Same booking remains active for customer/owner/authorized member; actions differ | Dashboard/history/member same PK; booking subscription. `supabase\migrations\0088b_b6_money_notifications.sql:284-294`; `0023_proposal_milestone_booking.sql:838-853`. |
| ID-MX17 | Actual customer/provider reports home no-show | Existing feature, exact party, archetype, status, schedule and strict grace required; manager/staff denied | New narrow eligibility read + existing mutation guard; no policy/money change. `supabase\migrations\0083_h3_home_booking_safety.sql:181-216`. |

**Refresh implementation constraint:** only messages/bookings are added to the inspected Realtime publication (`supabase\migrations\0001_init.sql:2123-2129`). Do not assume provider/document/payout subscriptions work or publish private tables. Extend the existing shared onboarding hook with one focus-scoped, active-only **60-second canonical re-read**, immediate own-mutation/focus/foreground re-read and provider-local-date boundary refresh. Existing booking/message subscriptions and shared unread controller remain appropriate for S51. Timer/request cleanup and stale-response guards are acceptance criteria, not verified runtime outcomes.

## Card contracts

| Template / existing body | Information order / role-state actions | Correction / named assertion |
|---|---|---|
| Provider readiness — `app\src\features\providerOnboarding\GoLiveStatusCard.tsx:30-75` | State → separate Holiday → exact action/wait reason → permitted Fix/Continue | Reuse typed helper/card, not KYC boolean. `ID-CARD-READY-01..03`; private owner reasons never public. |
| Admin provider — `app\app\admin\people.tsx:88-135` | Identity/persona → review/reason → payout → readiness → availability → valid target → secondary suspension | No completed Approve, preserve alternate reviews. `ID-CARD-ADMIN-01..03`. |
| Credential — `app\app\admin\documents.tsx:101-153`; `app\src\features\providerOnboarding\PortfolioSection.tsx:232-269` | Type/provider/category → current valid versus latest submission → expiry/reason → private preview → owner upload or admin pending review | No approved→provider Live collapse; preserve older valid replacement. `ID-CARD-DOC-01..03`. |
| Membership — `app\app\merchant-work.tsx:31-56`; `merchant-staff.tsx:106-131` | Actual business/role/scope → permitted destination → active/inactive → confirmed owner removal | Real business PK, capability parents, no invitations. `ID-CARD-MEM-01..03`. |
| Workspace job — `app\src\features\providerDashboard\JobCards.tsx:20-157` | Status/next action → schedule/category/customer → privacy-safe area → unread/urgency → correct monetary context | Different owner/manager/staff actions; all active states; no fake totals. `ID-CARD-JOB-01..04`. |
| Protected invite — `app\app\(provider)\business-tools.tsx:175-209` | Client/service → invite status → unchanged total → dates → open Cancel or claimed booking | Share only freshly returned link, never token recovery. `ID-CARD-BYO-01..03`. |
| Coin ledger — `app\app\coins.tsx:87-128` | Kind → time/expiry → signed value → reason; non-cash summary context | Six kinds, real ledger PK, error ≠ empty, history OFF readable. `ID-CARD-COIN-01..03`. |

All implementation checks include narrow width/large text, explicit loading/empty/error and action reachability; no image/device result is claimed here.

## Executable implementation tasks

**All tasks are proposals.** Every NEW migration path below uses an explicit **UNASSIGNED coordinator claim token**, not an executable or guessed numeric migration version. Coordinator alone assigns actual filenames/versions and shared registrations. Historical source migration names remain exact. Full file lists, steps and acceptance arrays are in JSON.

| Task / owner / prerequisites | Exact files/functions and ordered implementation | Named tests / required assertion | Class / later focused review |
|---|---|---|---|
| ID-T01 / O38I / independent | Claim `supabase\migrations\UNASSIGNED-ID-READINESS.sql`: private `_provider_document_requirement(uuid,text,uuid)` → repair `_provider_go_live` explanations → owner requirement projection → legacy setup check → admin `go_live`/reason/category projection → safe stored job archetype. Mirror `app\src\lib\onboarding\{types.ts,supabaseOnboarding.ts,completeness.ts}`, `adminApi.ts`, `types.ts`. Restore exact grants after changed read return shapes. | `supabase\tests\id_readiness.test.mjs`: A-valid/B-missing, scope, pending replacement, effective expiry, legacy setup, non-admin/private helper denial, job address/scope retained. | A / auth |
| ID-T02 / O38I / independent | Claim `supabase\migrations\UNASSIGNED-ID-STAFF-GATE.sql`: forward-replace only delegated view branch with merchant_staff check. Own branch, columns/sanitized intake/routing ambiguity/grants unchanged. | `supabase\tests\id_staff_gate.test.mjs`: delegated manager ON/OFF, actual owner OFF, staff/inactive/stranger denial, removal and routing ambiguity. | A / auth |
| ID-T03 / O38I / independent | Claim `supabase\migrations\UNASSIGNED-ID-BUSINESS-CONTEXT.sql`: additive `business_id` in `list_my_business_memberships`; new authorized `get_business_shop_context(uuid)`, old no-arg read retained. Mirror `app\src\features\merchantStaff\api.ts` and `shops\api.ts`. | `supabase\tests\id_business_context.test.mjs`: two same-name/same-owner venues distinct; select shop B; spoof/inactive/OFF denied; own/legacy behavior and private fields retained. | A / auth |
| ID-T04 / O38I / T03 shared-API lock | Claim `supabase\migrations\UNASSIGNED-ID-HOME-ACTION-READ.sql`: participant-safe `get_home_booking_action_eligibility(uuid)` returns exact party/status/time/flag capability and opens_at/server_now. Existing mutation unchanged. Typed `merchantStaff\api.ts` after T03. | `supabase\tests\id_home_actions.test.mjs`: future/unscheduled/before/exact/after grace, member/nonparty/flag/archetype denial, read has no mutation. | A / auth |
| ID-T05 / O26 / T01 | Extend `app\src\features\providerOnboarding\useOnboardingData.ts`: enabled/UID/generation/loading/stale/observable reload → one focused-active refresh/foreground/date boundary → update wizard/host/hub/save consumers → canonical credential rows → nonblocking price-guidance error in `services\PricingStep.tsx`. Keep dirty forms mounted. | `identityReadState.test.ts`, `documentPresentation.test.tsx`, `services\__tests__\guidance.test.tsx` in providerOnboarding: failure not empty, late UID dropped, saved/readback-error explicit, correct scoped docs; ≤60s focused-active canonical freshness and no private publication. | A / auth |
| ID-T06 / O26 / T05, same hook lock | `useOnboardingData.ts` draft API `useDraft(userId,sectionKey,value,restore)` → Basics/Hours call sites → cancel/reset on identity change → ignore legacy unscoped keys → clear own successful section. | `app\src\features\providerOnboarding\__tests__\draftIdentity.test.ts`: A/B isolation, late callback, legacy ignore, failed-save retention, no sensitive payout data. | A / auth |
| ID-T07 / O23 / T03,T05 | `app\src\components\AccountScreen.tsx`, `ProviderMeSections.tsx`: canonical readiness + payout-specific label, actual memberships/owner setup distinctions, truthful read errors, history entry while paused, enabled-not-live service copy. | `AccountScreen.identity.test.tsx`, `ProviderMeSections.identity.test.tsx` under components tests: customer/owner/member/admin, read error ≠ missing, both rewards OFF history, no member owner-KYC control. | A / auth |
| ID-T08 / O25 / T01,T05 | `providerDashboard\{ProviderDashboard.tsx,ProviderDashboardView.tsx,BusinessDashboardView.tsx,DashboardWidgets.tsx,model.ts}` + `app\app\jobs.tsx`: ordered active helper adds confirmed/delivery, safe CTA, canonical readiness, atomic selected context, capability shortcut gates, stale errors. | Existing `providerDashboard\__tests__\model.test.ts` plus `identity.test.tsx`/`jobsPresentation.test.tsx`: same PK states, old priorities, no guessed Start trip, A/B load race, member redaction, truthful online/unknown. | A / auth |
| ID-T09 / O25 / T04 | `app\app\merchant-job\[id].tsx`, `merchantStaff\api.ts`: booking+message subscriptions scoped/disposed → server action eligibility → sender ID labels/dedup → shared unread focus lifecycle → stale-action handling. | `app\src\features\merchantStaff\__tests__\merchantJob.test.tsx`: remote cancellation, exact grace, multi-team attribution, duplicates once, focused unread cleanup, member/nonparty denial. | A / auth |
| ID-T10 / O28 / T03 | Business tools/staff/work routes: null/loading/error/stale/retry; distinct business keys; exact domain-parent gates; preserve UUID role rules. | `app\src\features\merchantStaff\__tests__\workspaceState.test.tsx`: errors not empty/skeleton, unique venues, parent OFF/child ON, owner-only management. | A / auth |
| ID-T11 / O30 / T01 | `app\app\admin\{people.tsx,documents.tsx}`; new `app\src\features\adminPeople\model.ts` `providerReviewActions`: current-target suppression, separate axes/reason, truthful counts/latest query, scoped confirmed document review and authoritative reload. | `adminPeople\__tests__\{model.test.ts,reviewScreens.test.tsx}`: approved no Approve, missing-account disabled, alternates allowed, confirmation cancel, stale review, search race; latest-chain server guard tests in T01. | A / auth |
| ID-T12 / O23 / T07 | `app\app\coins.tsx`, Account entry: split optional notice storage from wallet reads; paused-aware eligible rewards; retain values/ledger/history. | `app\src\components\__tests__\CoinsScreen.state.test.tsx`: notice failure preserves data; both OFF history, errors not zero/empty, six-kind signed values unchanged. | A / money |
| ID-T13 / O23 + O26 / independent, shared-copy lock | `app\app\info\[topic].tsx`, `app\src\lib\onboarding\copy.ts`: workflow-qualified protections, request-not-erasure, contacts/agreement/policy values preserved. Public wording owner approval required, not assumed. | `app\src\components\__tests__\InfoScreen.policyScope.test.tsx`: no universal quote/code claim, request/email outcomes distinct, configured contacts/terms version unchanged. | A / money/legal wording |
| ID-T14 / O23 / T07,T12,T13 | Same Account/ProviderMeSections/Coins/Info bodies: optional new personal/work/reward/help composition, one controller, dirty name sheet retained. | `app\src\components\__tests__\accountComposition.test.tsx`: every S04/S11/S42/S46 target; parent/leaf OFF; non-cash qualifier order; all actor paths. | C account / none |
| ID-T15 / O25 / T08,T09 + shared-module handoff | Dashboard views/JobCards/jobs/merchant-job; coordinate `ProviderRecurringOverview.tsx` and `ProviderProposalInbox.tsx`: expose pending versus secondary sections without duplicate controller; urgent → next → upcoming → stats/history; schedule/archetype-safe metadata. | `providerDashboard\__tests__\composition.test.tsx`: urgent before empty/sent modules, correct next work/member context/date/non-visit metadata, flag parents. | C provider / none |
| ID-T16 / O28 / T03,T10 + O27/O29 locks | Business routes plus `merchant-enquiries.tsx`, `merchant-rfqs.tsx`, `merchant-shop.tsx`, `sports\manage\useSportsVenueManagementState.ts`: Share first; confirm access/invite removal; selected owner/shop/venue IDs retained and checked against authorized reads; aggregate label explicit. | `merchantStaff\__tests__\workspaceComposition.test.tsx`: Share/current total/token, confirmation cancel, select B, spoof denied, stable venues, flag parents. | C business / auth |
| ID-T17 / O26 / T05,T06 + O23 copy lock | Existing onboarding/profile hosts, Portfolio/Review/parts: required repair first, optional strength second, footer/return/terms/payout forms unchanged. Deactivation may require resolving currently blocking work; it does not remove existing work/payment duties. Exact existing guard frozen; no SQL/policy redesign. | `providerOnboarding\__tests__\composition.test.tsx`: seven steps, six sections/review returns, required-first/optional skip, canonical states, flags, dirty edit; **ID-DEACTIVATION-DUTIES-COPY** preserves duties/handler/payload and no added guard, with cosmetic flags ON/OFF. | C composition; A duties copy / none |
| ID-T18 / O30 / T11 | `app\app\admin\{people.tsx,documents.tsx}`: queue/search first, context/status/reason before valid action; existing corrected action model in both views. | `adminPeople\__tests__\composition.test.tsx`: queue-first, independent states, document context, corrected legacy OFF, non-admin denial. | C admin / none |
| ID-T19 / coordinator O38I / T01–T04 | Coordinator only: register allocated new migrations/test files in `supabase\tests\package.json` and `.github\workflows\deploy-backend.yml`; latest full-chain tests, isolated scenario harness, exact casts/actual values, targeted Codespace/lane validation and paired-role evidence. | Four new SQL files use `createHarness` + `r1-test-harness`; each scenario continues after a crash. New parse/test registrations actually selected by `run-all`. Focused auth/money reviews only for named changes. | A integration / none |
| ID-T20 / O38I → O14 / T01 shared-types lock only | **Retain `get_provider_public_profile(uuid)` unchanged**. Document legacy `id_verified` semantics in `app\src\lib\onboarding\types.ts`; add public-safe `publicTrust.ts` helper; O14 updates `ProviderProfileScreen.tsx`, `ProviderProfileHero.tsx`, `ProviderProfileCallouts.tsx` in `app\src\features\providerProfile`. Payout/certificate wording only; no independent ID claim, private read, new RPC or migration. | `onboarding\__tests__\publicTrust.test.ts`: **ID-PUBLIC-TRUST-PAYOUT-RAIL-PARITY**, credential independence, unavailable. `providerProfile\__tests__\publicTrust.test.tsx`: **ID-PUBLIC-TRUST-NO-INDEPENDENT-ID-CLAIM**, **NO-PRIVATE-READ**, legacy-OFF visible/accessibility truth. | A semantic wording / none |

### Runtime controls and execution order

- **O03/O05 own shared registry and parent graph**, not these UI lanes. Proposed default-OFF keys in group **Oorva experience**: `oorva_account_ux` (213), `oorva_provider_ux` (215), `oorva_onboarding_ux` (216), `oorva_business_staff_ux` (218), `oorva_admin_ops_ux` (220), all parented by `oorva_brand`. Each registry row must state the exact corrected-legacy OFF behavior. Missing key/parent OFF must fail closed for new composition.
- Existing `merchant_staff`, products/enquiries/RFQ, sports and home no-show capability gates retain their real server semantics. Do not replace them with a cosmetic flag. Business payout flag ON alone remains insufficient while entity/PAN mapping is unapproved.
- T01–T04 have disjoint SQL definitions/proposed files, but **T04 follows T03** for their shared client API file, and T09 follows both transitively. Coordinator serializes version allocation/registration. T06 follows T05 because both edit the same hook; C tasks follow their A fixes. Shared Account, policy-copy, proposal/recurring and destination files must not be concurrently edited by separate owners.
- Future SQL command selection: `scripts\cs-test.ps1 -Suite sql -Filter id_` after registration. Existing runner selects package commands; new SQL files are **not automatically discovered merely by existing on disk** (`supabase\tests\run-all.mjs:10-22`). Existing full-chain harness includes letter suffixes (`supabase\tests\r1-test-harness.mjs:47-69`).
- No package installation is proposed merely for tests. Use existing Jest-expo mocks/element traversal and PGlite harness. Every new assertion prints actual checked values; every SQL parameter is explicitly cast.
- **No cosmetic switch** gates payment recording, payout callback, refund/clawback, settlement/release, expiry cleanup, existing cancellation or readable history.

## Retain / no-change cases

| Case | Retain and test invariant | Evidence |
|---|---|---|
| Admin identity/review | Admins table only; provider review independent from KYC; do not re-report the old manual-KYC defect | `supabase\migrations\0059_admin_identity_hardening.sql:7-19`; `0064_o2_provider_verification.sql:62-80`; `0088b_b6_money_notifications.sql:944-977` |
| Document review safety | Pending-only locked review, existing expiry/reason checks, private signed preview | `supabase\migrations\0088b_b6_money_notifications.sql:881-900`; `app\src\lib\adminApi.ts:370-375` |
| Member actor differences | Owner/managers/staff ranks and selected provider ID; manager quotes do not imply owner payout/verification/cancellation | `supabase\migrations\0052_merchant_staff.sql:27-68,212-247`; `0079_f7_platform_fees_and_identity.sql:686-690`; `0061_h1_provider_cancellation_and_recurring_privacy.sql:15-31` |
| BYO | Fixed 3%, owner service constraint, bearer link returned once/hash stored, claimed booking ID, projected expiry | `supabase\migrations\0016_leakage_programme.sql:126-203,316-365` |
| Onboarding | Seven resumable steps, same section bodies, current agreement, persistent footer, optional work stays optional | `app\app\onboarding.tsx:22-65`; `app\app\provider-profile\[section].tsx:8-43`; `app\src\features\providerOnboarding\parts.tsx:32-79` |
| Business payout | Unsupported business mapping remains disabled even toggle ON; sensitive inputs not made drafts | `supabase\functions\provider-payout-account\index.ts:39-40,102-119`; `app\src\features\providerOnboarding\PayoutSection.tsx:201-223` |
| Coins/deletion | Paise/denomination/caps and six ledger kinds unchanged; own history RLS; deletion is idempotent request/email fallback | `supabase\migrations\0015_seva_coins.sql:24-60`; `0047_coins_config.sql:1-28`; `0067_u3_account_deletion.sql:31-47`; `app\src\lib\supabaseApi.ts:94-105` |
| Composite readiness | One eligible active service is enough for base live; blocked categories remain separately blocked; prior valid credential retained during replacement | `supabase\migrations\0064_o2_provider_verification.sql:70-79`; `0009_provider_onboarding.sql:257-278,803-806` |
| Public projection | Retain safe wire fields: legacy `id_verified` is not independent ID approval; payout/certificate labels use their real predicates. No new projection/private fields; ID-T20 corrects wording only. | `supabase\migrations\0087_ui_redesign_flags_guest_read.sql:575-591`; `app\src\lib\onboarding\types.ts:237-245` |

## Preservation boundaries, implementation gates and evidence limits

| ID | Exact decision / limitation | Default; does it block this audit? |
|---|---|---|
| ID-Q01 — **resolved** | Preserve `deactivate_provider_account` and its exact existing guarded-status list, including its current treatment of `confirmed`/`delivery_pending`. **No guard expansion, new SQL task or deactivation policy redesign in this plan.** `supabase\migrations\0009_provider_onboarding.sql:695-711`. | Copy: **“Deactivation may require resolving currently blocking work first. Deactivation does not remove existing work or payment duties.”** Class A, including Oorva OFF; ID-T17/ID-DEACTIVATION-DUTIES-COPY checks unchanged handler/payload. Not an open policy question or blocker. |
| ID-Q02 | Resolve the four explicit `UNASSIGNED-ID-*` coordinator claims against stream locks; existing historical deploy list explicitly ends with 0088a/b at `.github\workflows\deploy-backend.yml:427-429`. | Coordinator alone assigns/registers actual forward filenames. Claim paths are **not allocated versions or reservations**. |
| ID-Q03 | Approve exact public legal/protection/agreement/deletion-request wording. Runtime deletion fulfilment, SLA and gateway timing were not proved. | No new money/policy guarantee or technical contact; no source-audit blocker. |
| Runtime/device | No browser, native/device, gateway, SQL/app test or actual cross-role transition executed. | Assertions are future acceptance, not claimed PASS. Native/keyboard/responsive outcomes unverified. |
| Before images | Ten supplied PNGs inspected; seven direct owned-screen visual coverages. S08/S19/S25/S46/S51/S54/S55/S57 remain source-only for direct frames. | No screenshot = no visual PASS; unseen states remain source-backed conditional analysis. |

**Supplied provenance:** coordinator reports hosted run **44696642603**, head **229995fe3194de39684f12ef348d3e37930ae5f2**, completed/failure; app source matches audit snapshot because its diff only changes docs/14. This audit did not independently call GitHub. Three reported Home flag-coverage assertion failures are **not** used to conclude this app is broken. Visible demo-data watermarks are acknowledged; no feature settings/scenario state are inferred from filenames.

Inspected before files:

- S04: `before-web-44696642603\102-me-customer.png`.
- S11: `...\138-me-provider.png`.
- S09: `...\117-dashboard-next-job.png`, `...\158-new-pro-submit.png`, `...\159-new-pro-dashboard-status.png`.
- S42: `...\103-coins-wallet.png`.
- S47: `...\128-job-history.png`.
- S64: `...\135-provider-profile-portfolio.png`, `...\136-provider-profile-payouts.png`.
- S65: `...\130-provider-profile-hub.png`.

Only filenames/nonpersonal UI observations are recorded; no phone, personal test-account name, address or credential detail is reproduced. No after evidence exists in this audit.

### Files read

The JSON `filesRead` array is the complete read inventory, including full versus bounded/shared-contract-only reads and ten PNGs. It includes all 15 route wrappers/bodies; shared Account/ProviderMeSections/GuestGate/status/chat; all dashboard and onboarding sections/nested service/package bodies; auth/types/admin/onboarding/business/coins APIs; relevant latest SQL/Edge functions; and existing Jest/PGlite/registration infrastructure. Adjacent marketplace/sports files were read only to trace selected-context contracts, **not** to claim a second audit of their owned screens.

**Coverage complete.** The remaining work is the specifically enumerated implementation, policy/allocation gates and verification—not a generic “audit later.”


## Addressable source task cards

<a id="id-t01"></a>

### ID-T01

**Evidence findings:** ID-F01, ID-F02, ID-F03, ID-F06, ID-F15. **Logical WP:** O38I. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `supabase\migrations\UNASSIGNED-ID-READINESS.sql`; `app\src\lib\onboarding\types.ts`; `app\src\lib\onboarding\supabaseOnboarding.ts`; `app\src\lib\adminApi.ts`; `app\src\lib\types.ts`; `app\src\lib\onboarding\completeness.ts`; `supabase\tests\id_readiness.test.mjs`.

**Function scope:** `NEW public._provider_document_requirement(uuid,text,uuid)`; `public._provider_go_live(uuid)`; `public._provider_onboarding_checks(uuid)`; `public.get_my_provider_onboarding()`; `public.admin_list_providers(text,text)`; `public.admin_list_document_queue(integer)`; `public.get_provider_jobs()`; `public.get_my_business_provider_jobs(uuid)`.

**Required edits:**

1. Create the proposed forward migration only after coordinator allocates its unused version; do not edit 0009/0052/0064/0088 history.
2. Implement the private per-document requirement helper using provider-local date, exact nullable-category scope, any valid approved credential and separately latest nonsuperseded submission. Output satisfied/approved_document_id/latest_document_id/latest_status/effective_latest_status/expires_on/reject_reason.
3. Use per-code satisfaction in _provider_go_live; preserve precedence, any-eligible-service live rule, _category_docs_ok and _provider_is_live unchanged.
4. Extend owner onboarding read with document_requirements and server_local_date; keep raw documents and current private field boundaries. Recognize legacy provider account ID in payout setup check and stepDone.
5. Extend admin-only provider read with canonical go_live and review_note; document queue with category_name; add stored bookings.archetype to both existing safe job projections. Return extra metadata only, never provider payout identifiers in job/public data.
6. For changed RETURNS TABLE shapes, forward drop/recreate only the exact affected read functions, restore their authenticated grants and revoke public/anon as currently intended; new helper must not be executable by public/anon/authenticated.
7. Extend client types/normalizers with backward-compatible optional new fields; retain absence as unavailable where necessary. Add full-chain SQL tests using r1-test-harness and createHarness.

**Acceptance:**

- A-valid/B-missing produces no false A-expired reason; old valid approval plus pending replacement stays satisfied.
- Category-specific credential does not satisfy another category; general credential can; expired raw approval is effectively expired under existing inclusive provider-local validity rule.
- Legacy identifier/no payout row counts setup completed without changing KYC/admin/live policy or creating beneficiaries.
- Admin-only go_live/reason reads are denied to non-admin; public profile retains only existing safe badges/labels.
- Job projections preserve exact PK/scope/address masking and add only stored archetype; no totals/earnings recomputation.
- All class-A behavior remains when every Oorva switch is OFF.

**Tests (requirements, NOT RUN):**

- supabase\tests\id_readiness.test.mjs: ID-DOC-A-B, ID-DOC-SCOPE, ID-DOC-REPLACE, ID-DOC-EXPIRY, ID-LEGACY-PAYOUT, ID-ADMIN-READ-PRIVACY, ID-JOB-PROJECTION.
- app\src\lib\onboarding\__tests__\completeness.test.ts: legacy identifier/setup-versus-verification and existing gateway-unavailable continuation.
- app\src\lib\__tests__\supabaseApi.test.ts: added safe job archetype/read shape retains existing booking key.
- Future targeted command in Codespace: node run-all.mjs id_readiness (supabase\tests working directory), after ID-T19 registration.

**OFF behavior:** Always apply truth/private-read corrections; preserve current business capability guards and money-safety paths. No Oorva gate on reads/mutations..

<a id="id-t02"></a>

### ID-T02

**Evidence findings:** ID-F09. **Logical WP:** O38I. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `supabase\migrations\UNASSIGNED-ID-STAFF-GATE.sql`; `supabase\tests\id_staff_gate.test.mjs`.

**Function scope:** `public.service_request_provider_view`.

**Required edits:**

1. Forward-replace the latest 0052 view, adding _feature_enabled('merchant_staff') only to the delegated managed_provider_ids membership branch.
2. Preserve own auth.uid branch, active manager/owner rank, column order, sanitized intake, routed-provider count=1 suppression and authenticated read grant.
3. Add full-chain per-actor ON/OFF tests; do not patch only the dashboard UI.

**Acceptance:**

- Manager sees a singly routed delegated request ON and zero delegated rows OFF.
- Actual owner sees own request with merchant_staff OFF.
- Staff/inactive/stranger never gains manager request access; membership removal denies the same request immediately.
- Ambiguous routing remains suppressed; no private request/contact fields are added.
- Oorva brand/family OFF does not suppress this existing permission fix.

**Tests (requirements, NOT RUN):**

- supabase\tests\id_staff_gate.test.mjs: ID-STAFF-VIEW-ON-OFF, ID-OWNER-OFF, ID-ROLE-DENY, ID-REMOVED-DENY, ID-ROUTING-AMBIGUITY.
- Use createHarness and r1-test-harness; explicitly cast every SQL parameter.
- Future Codespace filter: node run-all.mjs id_staff_gate.

**OFF behavior:** merchant_staff OFF denies delegated view rows while actual owner branch remains; Oorva switches do not alter this..

<a id="id-t03"></a>

### ID-T03

**Evidence findings:** ID-F10, ID-F16. **Logical WP:** O38I. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `supabase\migrations\UNASSIGNED-ID-BUSINESS-CONTEXT.sql`; `app\src\features\merchantStaff\api.ts`; `app\src\features\shops\api.ts`; `supabase\tests\id_business_context.test.mjs`.

**Function scope:** `public.list_my_business_memberships()`; `NEW public.get_business_shop_context(uuid)`; `public.get_my_business_shop() retained`.

**Required edits:**

1. Add business_id UUID to list_my_business_memberships: provider PK, shop PK, venue PK; keep owner_id/role/type/name and owner-wide membership semantics.
2. Forward recreate the changed read return shape with existing feature/auth restrictions and restored grants.
3. Add get_business_shop_context(p_owner_id UUID): require products capability and _acts_for(owner,'staff'), select exactly that unique owner's shop, return the same explicit safe fields/business_role as current get_my_business_shop and GSTIN only to owner rank. Do not select all provider/payout fields.
4. Keep no-arg get_my_business_shop for existing clients. Add optional owner argument to getMyShop client that selects the new RPC only when explicit context is supplied.
5. Add business_id to BusinessMembership type and selected-context API tests; no new membership business_type/venue_id column or invite workflow.

**Acceptance:**

- One membership with two venues returns two distinct business IDs even if owner/name match.
- Provider/shop business IDs match their actual table PKs; membership identity remains owner/member.
- Selected authorized shop B returns B, not first eligible A; stranger/inactive/OFF delegation is denied.
- Owner keeps own selected shop access when merchant_staff OFF; products capability still gates this read.
- Legacy no-arg callers retain current default behavior and no additional private fields.

**Tests (requirements, NOT RUN):**

- supabase\tests\id_business_context.test.mjs: ID-MEM-BUSINESS-PKS, ID-MULTI-VENUE-SAME-NAME, ID-SHOP-SELECT-B, ID-SHOP-DENY, ID-SHOP-FLAG-PARENTS, ID-LEGACY-SHOP-READ.
- app\src\features\merchantStaff\__tests__\api.test.ts: business ID and providerId preservation.
- Future Codespace filter: node run-all.mjs id_business_context.

**OFF behavior:** Existing owner and delegated capability behavior preserved; additive identity/scope truth is not cosmetically gated..

<a id="id-t04"></a>

### ID-T04

**Evidence findings:** ID-F08. **Logical WP:** O38I. **Class:** A. **Source task prerequisites:** ID-T03.

**Proposed source files (canonical allocation takes precedence):** `supabase\migrations\UNASSIGNED-ID-HOME-ACTION-READ.sql`; `app\src\features\merchantStaff\api.ts`; `supabase\tests\id_home_actions.test.mjs`.

**Function scope:** `NEW public.get_home_booking_action_eligibility(uuid)`; `public._home_booking_safety_config() reused privately`; `public.report_no_show(uuid,text) unchanged`.

**Required edits:**

1. Follow ID-T03 because both tasks touch app\src\features\merchantStaff\api.ts; SQL definitions are disjoint but this shared client file is serialized.
2. Add an authenticated participant-safe read for exactly one booking PK. Require current user to be booking customer or _acts_for(provider,'staff'); unrelated callers receive not-found/denial.
3. Return booking_id/status/server_now, can_report_no_show boolean, report_party and opens_at computed using existing home_no_show_reporting, actual customer/provider identity, inspect_quote|fixed|time_based, accepted|en_route, scheduled_at and configured grace.
4. Use the same strict server-now > scheduled_at+grace predicate as report_no_show; manager/staff can read safe false capability but never actual-provider authority.
5. Do not mutate booking/payout/dispute in this read, expose admin config wholesale, or alter report_no_show/provider_cancel_booking.
6. Add typed API and full-chain allow/deny/boundary tests.

**Acceptance:**

- Flag OFF, future/unscheduled, before/exact grace, wrong archetype/status or wrong party cannot produce actionable true.
- Valid actual customer/provider after current configured grace receives correct absent-party value.
- Manager/staff receives false despite job/chat access; nonmember/nonparty denied.
- Changing configured grace changes the read without a client build/constant; read has no money/status side effects.
- Mutation independently retains existing guard even if a stale client attempts it; Oorva OFF does not affect safety resolution.

**Tests (requirements, NOT RUN):**

- supabase\tests\id_home_actions.test.mjs: ID-NOSHOW-BEFORE, ID-NOSHOW-EXACT, ID-NOSHOW-AFTER, ID-NOSHOW-UNSCHEDULED, ID-NOSHOW-PARENT-OFF, ID-NOSHOW-MEMBER-DENY, ID-NOSHOW-NONPARTY, ID-READ-NO-MUTATION.
- app\src\features\merchantStaff\__tests__\api.test.ts: no-show projection contains no private policy/payout fields.
- Future Codespace filter: node run-all.mjs id_home_actions.

**OFF behavior:** home_no_show_reporting OFF yields false capability and existing mutation rejection; no Oorva flag gates existing cancellation/refund/settlement..

<a id="id-t05"></a>

### ID-T05

**Evidence findings:** ID-F02, ID-F05, ID-F06, ID-F11. **Logical WP:** O26. **Class:** A. **Source task prerequisites:** ID-T01.

**Proposed source files (canonical allocation takes precedence):** `app\src\features\providerOnboarding\useOnboardingData.ts`; `app\src\features\providerOnboarding\parts.tsx`; `app\app\onboarding.tsx`; `app\app\provider-profile\[section].tsx`; `app\app\provider-profile\index.tsx`; `app\src\features\providerOnboarding\ReviewSection.tsx`; `app\src\features\providerOnboarding\PortfolioSection.tsx`; `app\src\features\providerOnboarding\ServicesSection.tsx`; `app\src\features\providerOnboarding\services\PricingStep.tsx`; `app\src\features\providerOnboarding\__tests__\identityReadState.test.ts`.

**Required edits:**

1. Extend existing useOnboardingData with an enabled owner-read option, authenticated UID/request generation, loading/refreshing/error/stale and reload returning an explicit success result or rejecting observably. Never read a selected other owner's private onboarding object.
2. Use one 60-second interval only while this owner screen is focused and AppState active, plus immediate own-mutation/focus/foreground refresh and a provider-local-date boundary refresh. Dispose on blur/UID change/disable and prevent overlapping/stale responses. The inspected Realtime publication contains only messages/bookings, so do not subscribe to or publish private provider/doc/payout tables.
3. Update wizard/section/hub and save callers to distinguish successful write from failed readback. Keep dirty local forms mounted; show Saved, refresh failed and Retry without a fabricated fresh/live outcome.
4. Render new document_requirements with latest submission versus valid credential and correct Approved/Expired labels; retain optional document/link/photo behaviors.
5. Give optional price guidance its own loading/error/retry state so failure is Unavailable, never perpetual Checking; do not block service save.
6. Use current ErrorState/InlineAlert/Skeleton/GoLiveStatusCard and existing UnreadProvider active-only polling pattern; do not introduce a parallel global status engine.

**Acceptance:**

- Initial failure, successful empty, successful zero and failed refresh are four distinguishable states.
- A late response for a prior UID cannot populate the next user's private data.
- Admin review/document/payout changes cause the same owner PK's canonical readiness to re-read within 60 seconds while focused/active, or immediately on foreground/focus; date expiry also refreshes without requiring a row UPDATE.
- Dirty Basics/service fields survive metadata/theme refresh; sensitive payout fields are never autosaved.
- Required/optional status and legacy setup correctness match ID-T01; no fake Live after submission or read failure. At most one focused-owner interval and no private-table publication change.

**Tests (requirements, NOT RUN):**

- app\src\features\providerOnboarding\__tests__\identityReadState.test.ts: ID-LOAD-INITIAL-ERROR, ID-LOAD-STALE, ID-LOAD-UID-RACE, ID-SAVE-READBACK-ERROR, ID-READINESS-INVALIDATION.
- app\src\features\providerOnboarding\__tests__\documentPresentation.test.tsx: ID-DOC-SCOPE, ID-DOC-REPLACEMENT, ID-DOC-EXPIRY, ID-DOC-APPROVED-NOT-LIVE.
- app\src\features\providerOnboarding\services\__tests__\guidance.test.tsx: failure is nonblocking Unavailable/Retry.
- Use existing Jest mocks/element traversal pattern; implementation-time browser/native interaction coverage must exercise actual effects and navigation.

**OFF behavior:** Always-correct identity reads/errors/dates in legacy and Oorva views. Actual business feature flags still control only their capabilities..

<a id="id-t06"></a>

### ID-T06

**Evidence findings:** ID-F04. **Logical WP:** O26. **Class:** A. **Source task prerequisites:** ID-T05.

**Proposed source files (canonical allocation takes precedence):** `app\src\features\providerOnboarding\useOnboardingData.ts`; `app\src\features\providerOnboarding\BasicsSection.tsx`; `app\src\features\providerOnboarding\HoursSection.tsx`; `app\src\features\providerOnboarding\__tests__\draftIdentity.test.ts`.

**Required edits:**

1. Change useDraft to explicit UID-scoped API and update Basics/Hours call sites with current authenticated user ID.
2. Reset hydration state/sequence and cancel pending timer/callback on UID or section-key change; no persistence while signed out.
3. Ignore/remove legacy unscoped draft keys without assigning them to a guessed account.
4. Clear own Hours draft after successful save as Basics already attempts, retaining failed-save drafts and no payout/PAN/bank persistence.
5. This task follows ID-T05 because both edit the same hook file; do not implement concurrently in separate lanes.

**Acceptance:**

- A draft cannot hydrate B on the same device, even with late AsyncStorage completion.
- A resumes its own draft and successful save clears only its own section.
- Signed-out state does not create/hydrate a provider draft.
- Sensitive payout fields never enter draft storage; no server or financial records are deleted.
- Behavior holds with all Oorva switches OFF.

**Tests (requirements, NOT RUN):**

- app\src\features\providerOnboarding\__tests__\draftIdentity.test.ts: ID-DRAFT-A-B, ID-DRAFT-UID-RACE, ID-DRAFT-LEGACY-IGNORE, ID-DRAFT-SAVE-FAIL, ID-DRAFT-SENSITIVE.

**OFF behavior:** Account isolation always applies..

<a id="id-t07"></a>

### ID-T07

**Evidence findings:** ID-F05, ID-F10, ID-F11, ID-F12. **Logical WP:** O23. **Class:** A. **Source task prerequisites:** ID-T03, ID-T05.

**Proposed source files (canonical allocation takes precedence):** `app\src\components\AccountScreen.tsx`; `app\src\components\ProviderMeSections.tsx`; `app\src\components\__tests__\AccountScreen.identity.test.tsx`; `app\src\components\__tests__\ProviderMeSections.identity.test.tsx`.

**Required edits:**

1. Use canonical owner readiness for provider identity display; label payout verification separately and route own profile edit to the existing hub/basics.
2. Read memberships under merchant_staff and add Business work for real active members. Keep own-provider creation/manage separate and retain legitimate venue/shop listing paths.
3. Replace swallowed own-provider/admin/coin absence with loading/unavailable/retry states; do not redirect to onboarding merely because own-provider read failed.
4. Retain readable Seva Coins history entry with paused-capability wording; no false zero on read failure.
5. ProviderMeSections service activation says enabled, not live; service/review read failures get independent Retry instead of successful-empty.

**Acceptance:**

- Owner/customer/member/admin variants preserve actual role differences without introducing auth roles.
- Verified KYC/admin rejected displays not-live readiness; service activation does not imply live.
- Member-only account finds Business work; no owner payout controls shown for another business.
- Both reward switches OFF preserve balance/history entry; unavailable is not zero.
- Confirmed logout, name validation, configured contacts and existing service write/rollback remain unchanged.

**Tests (requirements, NOT RUN):**

- app\src\components\__tests__\AccountScreen.identity.test.tsx: ID-ACCOUNT-CUSTOMER, ID-ACCOUNT-OWNER, ID-ACCOUNT-MEMBER, ID-ACCOUNT-ADMIN, ID-ACCOUNT-PROVIDER-READ-ERROR, ID-ACCOUNT-WALLET-OFF.
- app\src\components\__tests__\ProviderMeSections.identity.test.tsx: ID-SERVICE-ENABLED-NOT-LIVE, ID-REVIEWS-ERROR-NOT-EMPTY, ID-MEMBER-NO-OWNER-KYC.
- Use current Jest mocks/element traversal rather than adding a test package.

**OFF behavior:** Correct labels, membership entry gating, errors and existing history remain in legacy layout; domain capability OFF hides only invalid entry points..

<a id="id-t08"></a>

### ID-T08

**Evidence findings:** ID-F05, ID-F07, ID-F10, ID-F11. **Logical WP:** O25. **Class:** A. **Source task prerequisites:** ID-T01, ID-T05.

**Proposed source files (canonical allocation takes precedence):** `app\src\features\providerDashboard\ProviderDashboard.tsx`; `app\src\features\providerDashboard\ProviderDashboardView.tsx`; `app\src\features\providerDashboard\BusinessDashboardView.tsx`; `app\src\features\providerDashboard\DashboardWidgets.tsx`; `app\src\features\providerDashboard\model.ts`; `app\app\jobs.tsx`; `app\src\features\providerDashboard\__tests__\model.test.ts`; `app\src\features\providerDashboard\__tests__\identity.test.tsx`.

**Required edits:**

1. Extract the actual ordered active selection into existing model.ts as selectDashboardWork(jobs): incoming/next/rest; preserve current eight-status order and add confirmed/delivery_pending coverage.
2. Add safe detail navigation labels for new statuses; do not route confirmed proposal to startTrip.
3. Use canonical owner readiness/shared loading state and explicit unknown; revise OnlineCard preference wording without changing setOnline policy.
4. Commit selected provider/context/jobs together with providerId/UID request-generation guard; prevent old context data/actions on slow/failed switch.
5. Gate staff-management shortcut by merchant_staff and actual owner context; member view retains no payouts/KYC and only its current manager quotes.
6. Jobs shows refresh error alongside stale readable rows and filter-specific empty text; keep own get_provider_jobs scope and existing canonical status/unread helpers.

**Acceptance:**

- Confirmed/delivery_pending appear once in owner active list and agree with same PK in Jobs Active/member work.
- All prior active priorities and actual owner accept/decline/start semantics are unchanged.
- A late A-context load cannot replace B or combine B header with A actions.
- Staff/manager retain redacted data/action differences; no owner payout fetch for member.
- Online/marketplace/payout states are labelled independently with unknown on failed canonical read.

**Tests (requirements, NOT RUN):**

- app\src\features\providerDashboard\__tests__\model.test.ts: ID-DASH-ACTIVE-ALL, ID-DASH-PRIORITY, ID-DASH-PROPOSAL-CTA.
- app\src\features\providerDashboard\__tests__\identity.test.tsx: ID-DASH-CONTEXT-RACE, ID-DASH-OWNER-MEMBER, ID-DASH-READINESS-UNKNOWN, ID-DASH-STAFF-FLAG-OFF.
- app\src\features\providerDashboard\__tests__\jobsPresentation.test.tsx: ID-JOBS-STALE-ERROR and same-booking canonical status comparisons.

**OFF behavior:** Missing-active-work/identity/capability correctness always applies; composition remains legacy until its cosmetic flag is ON..

<a id="id-t09"></a>

### ID-T09

**Evidence findings:** ID-F08. **Logical WP:** O25. **Class:** A. **Source task prerequisites:** ID-T04.

**Proposed source files (canonical allocation takes precedence):** `app\app\merchant-job\[id].tsx`; `app\src\features\merchantStaff\api.ts`; `app\src\features\merchantStaff\__tests__\merchantJob.test.tsx`.

**Function scope:** `Existing report_no_show/provider_cancel_booking/send_booking_message policy remains unchanged`.

**Required edits:**

1. Subscribe to the booking row as well as messages using existing subscribeToBooking; generation-scope loads by route booking ID and UID, disposing on blur/change.
2. Use canonical statusLabel/StatusPill and eligibility response; schedule a bounded re-read at returned opens_at rather than enabling from a guessed local grace.
3. Classify message sender by self/customer_id/business team and deduplicate by message.id using existing useChat pattern.
4. Use shared useUnread.setActiveChat/markRead while focused and clear on blur; preserve server permitted terminal chat states.
5. Keep actual-provider-only cancellation and current confirmation; on authoritative access/status failure remove stale actionable controls while displaying recoverable error.

**Acceptance:**

- Remote cancellation updates current booking/header/composer without refocus.
- Future/unscheduled/before-grace no-show action absent; valid actual-party action follows server read.
- Manager/staff cannot cancel/report as owner; unauthorized route cannot expose address/chat.
- Multi-team senders labelled correctly, duplicate IDs render once, no self-chat unread banner.
- History remains readable under existing policy and no financial action is cosmetically gated.

**Tests (requirements, NOT RUN):**

- app\src\features\merchantStaff\__tests__\merchantJob.test.tsx: ID-MJOB-STATUS-PUSH, ID-MJOB-GRACE, ID-MJOB-TEAM-LABELS, ID-MJOB-DEDUP, ID-MJOB-UNREAD-CLEANUP, ID-MJOB-ROLE-DENY.
- Implementation-time browser test: two authorized actors compare the same booking PK before/after cancellation; separate provider/customer fixtures for other scenarios.

**OFF behavior:** Status/permission/actor corrections apply with Oorva OFF; home_no_show_reporting still controls its capability and existing cancellation/chat safety is preserved..

<a id="id-t10"></a>

### ID-T10

**Evidence findings:** ID-F10, ID-F11. **Logical WP:** O28. **Class:** A. **Source task prerequisites:** ID-T03.

**Proposed source files (canonical allocation takes precedence):** `app\app\(provider)\business-tools.tsx`; `app\app\merchant-staff.tsx`; `app\app\merchant-work.tsx`; `app\src\features\merchantStaff\__tests__\workspaceState.test.tsx`.

**Required edits:**

1. Use null/unloaded versus loaded-empty services/invites/members/memberships; initial ErrorState Retry and explicit refreshing/stale state for retained results.
2. Clear stale errors on successful reload; membership read denial must not display successful No staff or an actionable owner form.
3. Use business_type:business_id keys and keep providerId selection unchanged.
4. Apply actual merchant_staff/products/product_enquiries/product_rfq/sports parent combinations to entry points; do not gate BYO histories with staff feature.
5. Retain UUID-only role add/upsert, manager/staff explanations and server owner guards.

**Acceptance:**

- Every initial read failure offers Retry and no successful-empty/forever-skeleton claim.
- Two same-owner same-name venues produce distinct keys.
- Parent OFF/child ON hides invalid domain action while membership explanation remains truthful.
- Owner/member/multi-business variants retain their legitimate scopes and existing money rules.
- Removing a membership and re-reading removes delegated work actions, not the underlying user's account/history.

**Tests (requirements, NOT RUN):**

- app\src\features\merchantStaff\__tests__\workspaceState.test.tsx: ID-WORK-ERROR-NOT-EMPTY, ID-WORK-UNIQUE-KEYS, ID-WORK-PARENT-OFF, ID-STAFF-OWNER-DENY, ID-BYO-READ-ERROR.
- supabase\tests\merchant_staff.test.mjs existing permissions retained; new latest-chain coverage lives in ID-T02/03 tests.

**OFF behavior:** Existing business parents remain authoritative; truth/unique identity fixes always apply; actual owner work not dependent on member capability..

<a id="id-t11"></a>

### ID-T11

**Evidence findings:** ID-F01, ID-F03, ID-F11. **Logical WP:** O30. **Class:** A. **Source task prerequisites:** ID-T01.

**Proposed source files (canonical allocation takes precedence):** `app\app\admin\people.tsx`; `app\app\admin\documents.tsx`; `app\src\features\adminPeople\model.ts`; `app\src\features\adminPeople\__tests__\model.test.ts`; `app\src\features\adminPeople\__tests__\reviewScreens.test.tsx`.

**Function scope:** `public.admin_set_provider_review(uuid,text,text) unchanged`; `public.admin_review_document(uuid,boolean,text,date) unchanged`; `public.set_provider_suspended(uuid,boolean,text) unchanged`.

**Required edits:**

1. Implement providerReviewActions exact current-state view helper from ID-F01; same-state review target disappears while supported alternatives remain.
2. Render separate admin review/payout/readiness/availability and stored review note. Replace unconditional restore/approve promises with remaining-gate context.
3. Remove misleading filtered global count labels and add explicit no-results; generation-protect search/filter reads.
4. Show document category/general scope; add useConfirm and duplicate-operation prevention for review, retaining signed private preview and expiry/reason checks.
5. Re-read after mutation and on stale pending-state rejection, preserving server as final authority; do not add client KYC mutation.

**Acceptance:**

- Approved submitted card never shows actionable Approve in either layout.
- Paused/suspended does not conceal actual review fact; payout state never determines review action.
- Required reasons/confirmation/cancel semantics and non-admin server denial remain.
- Pending document row disappears after authoritative success; second review denied; no public document exposure.
- Late search response cannot overwrite a later filter; empty/error/loading remain distinct.

**Tests (requirements, NOT RUN):**

- app\src\features\adminPeople\__tests__\model.test.ts: ID-REVIEW-EACH-TARGET, ID-REVIEW-NO-ACCOUNT, ID-REVIEW-SUSPEND-INDEPENDENT.
- app\src\features\adminPeople\__tests__\reviewScreens.test.tsx: ID-REVIEW-CONFIRM-CANCEL, ID-DOCUMENT-SCOPE, ID-DOCUMENT-STALE, ID-SEARCH-RACE, ID-EMPTY-RETRY.
- supabase\tests\id_readiness.test.mjs includes non-admin denial, unchanged KYC and pending-document terminal guard against latest function definitions.

**OFF behavior:** All validity, state and confirmation corrections remain with Oorva/admin presentation OFF..

<a id="id-t12"></a>

### ID-T12

**Evidence findings:** ID-F11, ID-F12. **Logical WP:** O23. **Class:** A. **Source task prerequisites:** ID-T07.

**Proposed source files (canonical allocation takes precedence):** `app\app\coins.tsx`; `app\src\components\AccountScreen.tsx`; `app\src\components\__tests__\CoinsScreen.state.test.tsx`.

**Function scope:** `Existing get_my_coin_balance/get_coins_config/coin_ledger RLS unchanged`.

**Required edits:**

1. Separate wallet/config/history required read state from optional denomination-notice storage state; use explicit loading and loaded-empty, retaining stale data with error on failed refresh.
2. Make empty encouragement conditional on earning enabled; say eligible completed bookings and retain current configured caps/expiry/denomination facts without client entitlement calculation.
3. Retain history access when capabilities OFF and distinguish balance unavailable from zero.
4. Keep six ledger kinds/sign/value/date/reason and Seva Coins/non-cash/non-transferable language. No new money behavior.

**Acceptance:**

- Notice storage failure cannot discard successful wallet/history data.
- Both earning/redemption OFF retain existing positive/negative history and balance; no promise of new rewards.
- No false zero/empty on failed read; zero and empty after successful read remain valid.
- All paise, denomination conversion, caps, refunds/clawbacks and ledger RLS unchanged.
- No withdrawal/transfer added and no Oorva flag gates money-safety paths.

**Tests (requirements, NOT RUN):**

- app\src\components\__tests__\CoinsScreen.state.test.tsx: ID-COIN-LOAD-ERROR, ID-COIN-NOTICE-OPTIONAL, ID-COIN-BOTH-OFF, ID-COIN-PAUSED-EMPTY, ID-COIN-DELTA-PRESERVE.
- Retain app\src\lib\__tests__\coins.test.ts assertions; focused review verifies presentation did not alter calculations.

**OFF behavior:** History stays readable and disabled capabilities accurately explained in legacy and Oorva layouts; no financial engine changes..

<a id="id-t13"></a>

### ID-T13

**Evidence findings:** ID-F13. **Logical WP:** O23. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\app\info\[topic].tsx`; `app\src\lib\onboarding\copy.ts`; `app\src\components\__tests__\InfoScreen.policyScope.test.tsx`.

**Required edits:**

1. Use workflow-qualified wording: inspected-quote jobs require approved itemized quotes; fixed/proposal work follows its accepted package/proposal/payment schedule. Do not announce a new refund/hold/code rule.
2. Replace unsupported all-family guarantee wording with scope-neutral references to the booking's shown protections and support; retain existing approved policy numbers until money/legal owner approves exact changes.
3. Label privacy operation Request account deletion and explain pending processing, not instant erasure; retain recorded/email fallback distinction.
4. Keep supportContact and provider terms_version/acceptance behavior unchanged; O26 coordinates its shared copy file after any domain-read copy edits.

**Acceptance:**

- Terms/safety/provider summary no longer claims every family follows inspect-quote visit workflow.
- Deletion request does not claim fulfilment; email fallback does not claim request stored.
- No fee/cancellation/refund/payout-hold/entitlement number or agreement version changes.
- Guest sign-in help and configured support actions remain available with business and Oorva flags OFF.
- Exact public-policy copy receives the scoped money/legal owner approval; audit does not claim such approval exists.

**Tests (requirements, NOT RUN):**

- app\src\components\__tests__\InfoScreen.policyScope.test.tsx: ID-POLICY-SCOPE-HOME, ID-POLICY-PROPOSAL, ID-DELETE-REQUEST-NOT-ERASE, ID-DELETE-EMAIL-OUTCOME, ID-CONTACT-CONFIG-PRESERVE.
- Retain supabase\tests\account_deletion.test.mjs request idempotency/non-admin ownership behavior.

**OFF behavior:** Truthful policy scope and request semantics apply regardless of brand; working legacy contacts and policy retained..

<a id="id-t14"></a>

### ID-T14

**Evidence findings:** ID-F14. **Logical WP:** O23. **Class:** C. **Source task prerequisites:** ID-T07, ID-T12, ID-T13.

**Proposed source files (canonical allocation takes precedence):** `app\src\components\AccountScreen.tsx`; `app\src\components\ProviderMeSections.tsx`; `app\app\coins.tsx`; `app\app\info\[topic].tsx`; `app\src\components\__tests__\accountComposition.test.tsx`.

**Required edits:**

1. Use the five S04/S11, five S42 and four S46 placement rows and their exact targetHierarchy as implementation order.
2. Select new composition with effective parent+leaf only; use one AccountScreen/controller for both account modes.
3. Move personal/work groups according to actual actor context, not a new auth role.
4. Put non-cash qualifier adjacent to unchanged reward summary and keep contextual support/danger actions.
5. Retain class-A corrected legacy view for OFF; no theme/brand refresh remounts dirty Edit name.

**Acceptance:**

- Every owned screen preserves all important actions/metadata while implementing its documented hierarchy.
- Brand ON+leaf ON selects new composition; leaf OFF and parent OFF/leaf ON select corrected legacy.
- Admin/member/provider/customer variants are distinct only where permissions/purpose require.
- No lost wallet/deletion/support behavior; narrow/large-text/dirty-edit before-after evidence captured on supported platforms.

**Tests (requirements, NOT RUN):**

- app\src\components\__tests__\accountComposition.test.tsx: ID-ACCOUNT-ORDER, ID-ACCOUNT-ROLES, ID-COINS-QUALIFIER-ORDER, ID-INFO-CONTEXT, ID-ACCOUNT-FLAG-PARENTS.
- Implementation E2E cases: account name sheet survives theme update; coins both-OFF history; deletion confirmation cancel.

**OFF behavior:** Corrected existing account/legal/reward presentation; all class-A fixes remain..

<a id="id-t15"></a>

### ID-T15

**Evidence findings:** ID-F15. **Logical WP:** O25. **Class:** C. **Source task prerequisites:** ID-T08, ID-T09.

**Proposed source files (canonical allocation takes precedence):** `app\src\features\providerDashboard\ProviderDashboardView.tsx`; `app\src\features\providerDashboard\BusinessDashboardView.tsx`; `app\src\features\providerDashboard\JobCards.tsx`; `app\src\features\recurring\ProviderRecurringOverview.tsx`; `app\src\features\proposals\ProviderProposalInbox.tsx`; `app\app\jobs.tsx`; `app\app\merchant-job\[id].tsx`; `app\src\features\providerDashboard\__tests__\composition.test.tsx`.

**Required edits:**

1. Expose pending-action and secondary/history sections from existing recurring/proposal modules while retaining one set of data/action controllers.
2. Place urgent requests before next job, upcoming/active work and secondary metrics/history; collapse secondary empty modules rather than inserting tall spacers.
3. Member view names selected business and preserves current role controls with no owner financial panel.
4. Use stored job archetype from ID-T01: active schedule first, label created date when shown, no non-visit zero-fee headline or fabricated earning.
5. Use effective oorva_provider_ux parent selection and preserve corrected legacy render order OFF.

**Acceptance:**

- Tree/viewport order puts an expiring requested job before empty/sent recurring/proposal history and metrics.
- Confirmed/delivery work remains visible and CTA correct under both compositions.
- Member no owner payout/KYC controls; manager quotes/statuses unchanged.
- Job date/source field is explicitly correct; no money arithmetic/payload changes.
- Before/after web and native large-text/keyboard action reachability evidence is recorded at implementation.

**Tests (requirements, NOT RUN):**

- app\src\features\providerDashboard\__tests__\composition.test.tsx: ID-WORK-URGENT-FIRST, ID-WORK-SECONDARY-EMPTY, ID-WORK-MEMBER-CONTEXT, ID-WORK-SCHEDULE, ID-WORK-NONVISIT, ID-WORK-FLAG-PARENTS.

**OFF behavior:** Corrected legacy workspace, not removal of existing work or money safety..

<a id="id-t16"></a>

### ID-T16

**Evidence findings:** ID-F16. **Logical WP:** O28. **Class:** C. **Source task prerequisites:** ID-T03, ID-T10.

**Proposed source files (canonical allocation takes precedence):** `app\app\(provider)\business-tools.tsx`; `app\app\merchant-staff.tsx`; `app\app\merchant-work.tsx`; `app\app\merchant-enquiries.tsx`; `app\app\merchant-rfqs.tsx`; `app\app\merchant-shop.tsx`; `app\src\features\sports\manage\useSportsVenueManagementState.ts`; `app\src\features\merchantStaff\__tests__\workspaceComposition.test.tsx`.

**Required edits:**

1. S08 promote newly created Share, keep Create another subordinate, show returned expires_at and dated status history, confirm open invite cancellation; preserve fixed 3% totals.
2. S54 state owner-wide membership scope, list current/inactive members and exact role rights, retain UUID-only add form, and confirm Remove access with correct member/owner context.
3. S55 carry ownerId/shopId/venueId using returned business_id. Provider selection continues providerId unchanged.
4. MerchantEnquiries and MerchantRfqs consume shopId/ownerId, filter existing authorized lists by actual shop_id and carry the same context to Manage shop; never trust parameters as authorization.
5. MerchantShop uses explicit owner-aware getMyShop from ID-T03; existing business_role read-only behavior and owner-only product editing stay unchanged.
6. Sports useSportsVenueManagementState accepts initial venueId, selects it only from the authorized nextVenues list and refuses/labels unavailable selection rather than silently defaulting; existing actor and readable-history behavior preserved.
7. Use effective presentation parent/leaf; label deliberately unscoped alternatives All businesses and keep current capabilities' independent parents.

**Acceptance:**

- Invite Share is current primary after success; no token reconstruction or amount/policy change.
- Cancel removal makes no call; confirm only deactivates the correct member or open invite.
- Selecting shop B or venue B displays B's context; spoofed ID never bypasses server/authorized-list boundary.
- Same-owner same-name venues have stable unique keys and remain separate businesses under one membership scope.
- Child/parent presentation OFF retains corrected legacy and existing data/history; no phone invitation or per-business permission model is added.

**Tests (requirements, NOT RUN):**

- app\src\features\merchantStaff\__tests__\workspaceComposition.test.tsx: ID-BYO-SHARE-FIRST, ID-BYO-CANCEL-CONFIRM, ID-STAFF-REMOVE-CONFIRM, ID-SELECT-SHOP-B, ID-SELECT-VENUE-B, ID-SPOOFED-SELECTION, ID-BUSINESS-FLAG-PARENTS.
- Existing merchant_staff SQL plus ID-T03 latest-chain tests prove actor scope; later browser test uses one selected business PK across authorized views.

**OFF behavior:** Legacy workspace with class-A truth/feature/identity fixes; histories and money safety retained..

<a id="id-t17"></a>

### ID-T17

**Evidence findings:** ID-F17. **Logical WP:** O26. **Class:** C. **Source task prerequisites:** ID-T05, ID-T06.

**Proposed source files (canonical allocation takes precedence):** `app\app\onboarding.tsx`; `app\app\provider-profile\[section].tsx`; `app\app\provider-profile\index.tsx`; `app\src\features\providerOnboarding\PortfolioSection.tsx`; `app\src\features\providerOnboarding\ReviewSection.tsx`; `app\src\features\providerOnboarding\parts.tsx`; `app\src\features\providerOnboarding\__tests__\composition.test.tsx`.

**Required edits:**

1. Preserve seven STEP_KEYS/resume and the six-section-plus-review host, existing returnTo and Done behavior.
2. Use new canonical requirement projection to promote blocking required credentials before optional links/photos only when relevant.
3. Hub shows actual required repair before optional profile strength; leave required flags/weights and optional skip behavior unchanged.
4. Keep persistent footer and current field validation/media/payout form behavior; show save/readback feedback from ID-T05 without remounting dirty forms.
5. Apply resolved ID-Q01 preservation boundary: do not modify deactivate_provider_account or expand its active-state guard. Copy: Deactivation may require resolving currently blocking work first. Deactivation does not remove existing work or payment duties.
6. Select only the new composition with effective parent+leaf; retain corrected legacy OFF.

**Acceptance:**

- All seven wizard steps and all six edit sections/review accounted for, with unchanged field payloads and server validations.
- Required rejected/missing credential precedes optional material; recommended-only work stays optional.
- Owner draft/under_review/action_needed/live/suspended/deactivated cases render canonical state and valid actions.
- Preview/share, holiday/deactivate/reactivate, current terms and service return targets preserved. The exact existing deactivation guarded-status list and existing confirmed/delivery_pending treatment remain unchanged; existing work/payment duties are not removed.
- Narrow native/web keyboard, media and dirty-edit refresh evidence captured later; no fake verification success.

**Tests (requirements, NOT RUN):**

- app\src\features\providerOnboarding\__tests__\composition.test.tsx: ID-WIZARD-SEVEN, ID-SECTION-RETURNS, ID-REQUIRED-DOC-FIRST, ID-OPTIONAL-SKIP, ID-HUB-ACTION-FIRST, ID-ONBOARDING-FLAG-PARENTS, ID-DEACTIVATION-DUTIES-COPY (existing work/payment duties explicitly remain; no new guard/transition/policy call).
- Retain existing onboarding\__tests__\validation.test.ts and services\__tests__\model.test.ts, adding only behavior introduced by composition/navigation. No deactivation SQL change is authorized by this plan.

**OFF behavior:** Existing corrected wizard/profile composition with ID-Q01 duties copy retained; no rollout switch disables account repair or ongoing money safety..

<a id="id-t18"></a>

### ID-T18

**Evidence findings:** ID-F18. **Logical WP:** O30. **Class:** C. **Source task prerequisites:** ID-T11.

**Proposed source files (canonical allocation takes precedence):** `app\app\admin\people.tsx`; `app\app\admin\documents.tsx`; `app\src\features\adminPeople\__tests__\composition.test.tsx`.

**Required edits:**

1. Reorder People to search/filter/review queue, identity/independent states/reason, valid action; move Audit log secondary.
2. Render Documents as provider/category/type, private preview, expiry/reason and confirmed pending-only action.
3. Reuse ID-T11 action model/controller and loading/error behavior in both compositions; do not duplicate authorization/state rules.
4. Select only the composition with effective parent+leaf, preserving corrected legacy OFF.

**Acceptance:**

- S19/S25 placement rows implemented with no omitted important action/metadata.
- No repeated completed review button in either view; same stored state/reason across admin and owner.
- Non-admin direct access denied by server; signed preview private and no mass approval.
- Parent OFF/leaf ON and leaf OFF preserve all class-A fixes.
- Actual implementation-time before/after admin screenshots and interactions are required; source-only audit is not visual PASS.

**Tests (requirements, NOT RUN):**

- app\src\features\adminPeople\__tests__\composition.test.tsx: ID-QUEUE-FIRST, ID-STATE-AXES, ID-DOC-CONTEXT-FIRST, ID-ADMIN-FLAG-PARENTS.

**OFF behavior:** Corrected existing admin queue, not weaker review/permission safety..

<a id="id-t19"></a>

### ID-T19

**Evidence findings:** ID-F01, ID-F02, ID-F03, ID-F04, ID-F05, ID-F06, ID-F07, ID-F08, ID-F09, ID-F10, ID-F11, ID-F12, ID-F13, ID-F14, ID-F15, ID-F16, ID-F17, ID-F18. **Logical WP:** O38I. **Class:** A. **Source task prerequisites:** ID-T01, ID-T02, ID-T03, ID-T04.

**Proposed source files (canonical allocation takes precedence):** `supabase\tests\package.json`; `.github\workflows\deploy-backend.yml`; `supabase\tests\id_readiness.test.mjs`; `supabase\tests\id_staff_gate.test.mjs`; `supabase\tests\id_business_context.test.mjs`; `supabase\tests\id_home_actions.test.mjs`.

**Required edits:**

1. Coordinator resolves the four explicit UNASSIGNED-ID migration claim tokens against other streams and existing function locks, then assigns and registers actual filenames for parse/full-chain/deploy lists in order. Claim-token paths are not executable migration versions; never edit historical migrations or guess a numeric version.
2. Add the four named SQL tests to package scripts consumed by run-all; use r1-test-harness's full-chain regex that includes letter-suffix migrations, not only old partial o2_admin_status/merchant_staff fixtures.
3. Each new file imports createHarness and wraps independent scenarios so one crash cannot stop remaining checks; all assertion failures include JSON.stringify(actual rows/state) and every SQL parameter is explicitly cast.
4. Use isolated provider/business/customer/slot fixtures for distinct scenarios. Within one workflow compare the same entity PK across authorized actors; never merge identity by names or copy returned deterministic output as an expected value.
5. Run targeted app/SQL checks in the shared Codespace before lane push; lane CI confirms them. This is a future implementation verification requirement, not work performed by this read-only audit.
6. After integration, capture same-entity paired-role before/after evidence for these 15 screens. Screenshots require explicit scenario/flags/viewport and no phones/personal test-account details; the supplied failed hosted run is not an app PASS/failure diagnosis.

**Acceptance:**

- All four forward migrations and test files are actually registered, in allocated order, and full-chain uses latest 0088b functions before the new changes.
- Enabled/OFF/parent-OFF and authorized/unauthorized role assertions cover every affected capability; cosmetic OFF does not weaken class-A fixes or gate money safety.
- All reported defects have a named failing-before/passing-after assertion, no diagnostic-only or audit-later task.
- No new package needed solely to execute these tests; existing Jest/PGlite infrastructure reused.
- Focused auth/money implementation reviews occur only for listed tasks and no automatic Opus review is required.

**Tests (requirements, NOT RUN):**

- Future Codespace SQL filter: id_readiness id_staff_gate id_business_context id_home_actions via scripts\cs-test.ps1 -Suite sql -Filter id_.
- Future app filters: AccountScreen.identity, ProviderMeSections.identity, CoinsScreen.state, policyScope, identityReadState, draftIdentity, providerDashboard, merchantStaff, adminPeople.
- All assertions must report actual values on failure and use independent fixed future working-hour booking scenarios rather than near-midnight relative slots.

**OFF behavior:** Registration must exercise always-on truth and capability OFF behavior; no cosmetic flag gates cleanup/refund/payment/settlement/cancellation..

<a id="id-t20"></a>

### ID-T20

**Evidence findings:** ID-F05. **Logical WP:** O38I. **Class:** A. **Source task prerequisites:** ID-T01.

**Proposed source files (canonical allocation takes precedence):** `app\src\lib\onboarding\types.ts`; `app\src\lib\onboarding\publicTrust.ts`; `app\src\lib\onboarding\__tests__\publicTrust.test.ts`; `app\src\features\providerProfile\ProviderProfileScreen.tsx`; `app\src\features\providerProfile\ProviderProfileHero.tsx`; `app\src\features\providerProfile\ProviderProfileCallouts.tsx`; `app\src\features\providerProfile\__tests__\publicTrust.test.tsx`.

**Function scope:** `public.get_provider_public_profile(uuid) RETAIN UNCHANGED`; `No new public read/RPC, field, private query or migration`.

**Required edits:**

1. This is a narrow S63 integration handoff to O14, not an additional identity screen audit. T01 dependency serializes the shared existing onboarding/types.ts file; public wording does not depend on a new backend projection.
2. Document existing PublicProfile.badges.id_verified as the legacy KYC-plus-acc_-shape indicator, not an independent ID-document approval. Retain its wire name/value for compatibility; do not expose the identifier itself.
3. Add providerPublicTrust(profile: Pick<PublicProfile,'badges'|'credentials'> | null) in onboarding/publicTrust.ts. Return state loaded|unavailable, public badges keyed payout|police with label/description, and the unchanged server-projected credential labels. Existing GO_LIVE/reasonCopy helpers cannot be reused because they describe private owner readiness, not this public-safe trust DTO.
4. Render payout_verified=true as Payout account verified. Render police_verified=true as Police certificate approved, based solely on the existing server boolean; retain existing approved/unexpired credential labels separately. Never emit a separate ID verified/ID approved/background-check claim from id_verified.
5. O14 updates the already-audited ProviderProfileScreen/Hero/Callouts consumer path and its accessibility wording to use that public-safe presentation. A null/failed public read is unavailable, not a new verification claim or fallback that turns an account identifier into ID approval.
6. Do not change get_provider_public_profile, its safe fields, _provider_is_live, marketplace bookability, existing guarded listing provenance, shop verification, money or deactivation policy. Do not query or pass provider_documents, private payout account fields, account identifiers or admin notes to public cards.

**Acceptance:**

- The same verified payout truth renders the same Payout account verified label for public fixtures (id_verified=false,payout_verified=true) and (id_verified=true,payout_verified=true); acc_ shape never creates a second independent-ID badge.
- payout_verified=false with police_verified=true shows only the existing certificate-approval fact, not payout/ID/provider-wide approval. Existing credential labels remain server-projected and unchanged.
- A missing/failed public profile yields unavailable and no invented verified badge; tests inspect user-visible text and accessibility labels, not just helper constants.
- Public consumers import only the existing safe public DTO/helper; no private document/account/admin read or private prop is added, and no new SQL/RPC/migration is introduced.
- All truthful wording applies with oorva_brand/oorva_catalogue_ux OFF as class A. Existing actual live/paused/booking permissions and legitimate listing/shop verification semantics stay unchanged.

**Tests (requirements, NOT RUN):**

- app\src\lib\onboarding\__tests__\publicTrust.test.ts: ID-PUBLIC-TRUST-PAYOUT-RAIL-PARITY (identical payout display despite id_verified shape difference), ID-PUBLIC-TRUST-CREDENTIAL-INDEPENDENT, ID-PUBLIC-TRUST-UNAVAILABLE.
- app\src\features\providerProfile\__tests__\publicTrust.test.tsx: ID-PUBLIC-TRUST-NO-INDEPENDENT-ID-CLAIM (visible and accessibility wording), ID-PUBLIC-TRUST-NO-PRIVATE-READ (mock APIs assert no private document/payout query and safe props only), ID-PUBLIC-TRUST-LEGACY-OFF (same truth with cosmetic switches OFF).
- RPC retain rationale/test baseline is the exact current SQL in 0087:575-590 and existing public read/privacy fixtures. The helper/consumer behavior tests are the new change assertions; do not add a different public status or independently approve ID.

**OFF behavior:** Truthful public payout/credential wording always applies; cosmetic OFF must not restore an unsupported independent-ID claim..
