# Oorva Critical audit — marketplace

> **Implementation authority:** use [doc 18](../18-Oorva-Transformation-Implementation-Plan.md) and [`execution-plan.json`](../design/oorva/execution-plan.json) for the actual dispatch stage, file/function locks, migration claim and validation command. This source audit supplies verified current behavior, required changes and acceptance. A proposal filename is not a numeric reservation.


| Scope | Baseline / evidence |
| --- | --- |
| Assigned coverage | 19 screens; six entity keys; seven card contracts |
| Immutable source | 2f1e4638b145185b9e58c4c62e58f5c6dd491fa1 |
| Root | `repository@2f1e4638b145185b9e58c4c62e58f5c6dd491fa1` |
| Date | November 20, 2026 |
| Evidence | 103 source files plus requirements/ownership context and eight supplied web PNGs |
| Mode | Read-only source audit. No app tests/builds/installs/production APIs, source/SQL/CI changes, commits, pushes or subagents. |

## Summary
Completed **19 screens / 101 placement elements**, **6 entities** (productOrder source-proven N/A), **7 card contracts**, **28 findings** (11 P1, 17 P2), and **26 executable implementation tasks**. There are **42 explicit retain elements** and **zero source-coverage blockers**. No implementation or runtime/visual PASS is claimed.

Highest-risk repairs: state-invalid shop actions, OFF-history/cancellation, suspended-shop quote selection, lost supplier quote history/deadlines/differences, misleading product/provider price projections, and product-delete/open-conversation key collision.

## Findings
| ID / priority / class | Current source-proven condition → exact target | Owner / screens | Evidence |
| --- | --- | --- | --- |
| MK-F01 / P1 / A | Admin shop card advertises Verify and other completed actions independently of current state — All shop rows render Under review/Verify/Reject/Suspend and reason Input. Latest admin_set_shop_status already rejects verified->verified and permits verification only from submitted/under_review/suspended. → UI mirrors actual server transition conditions, with Verify/Restore distinct and contextual destructive reason. | O31 / S30 | `app\app\admin\shops.tsx:19-84`; `app\app\admin\shops.tsx:96-128` |
| MK-F02 / P1 / A | submit_shop permits direct resets that the owner UI explicitly forbids — submit_shop only excludes suspended, then writes submitted and clears status_reason. Direct owner RPC can reset verified/submitted/under_review although UI disables those submissions. → Owner submission only draft/rejected; identity-triggered verified->submitted remains solely save_shop's intentional re-review path. | O38P / S53, S30 | `supabase\migrations\0049_shops_catalogue.sql:399-449`; `app\app\merchant-shop.tsx:353-411` |
| MK-F03 / P2 / A | Suspended owner shop still offers product editing that SQL rejects — Add product, Edit and Save product depend on product limits/draft only. save_product explicitly rejects shop.status=suspended. delete_product has no such suspension ban. → Readable suspended catalogue, no invalid writable editor, current removal authority preserved. | O27 / S53 | `app\app\merchant-shop.tsx:414-467`; `supabase\migrations\0049_shops_catalogue.sql:600-718` |
| MK-F04 / P1 / A | Capability OFF currently erases authorized history and blocks owner RFQ cancellation — Read helpers/RPCs and whole-screen branches depend on product/RFQ/enquiry flags. Shared activity also removes Shop segment and makes enquiry/RFQ history reads empty when capability OFF. cancel_rfq and RFQ mark-read are gated; shop unread zeroed. Existing p1b test deliberately expects cancellation denial with products OFF. → Separate read/actor authorization from new-work capability. Authorized existing records and owner cancellation of raw-open RFQ remain accessible after OFF; new create/send/select/edit remains closed. | O38P / S45, S50, S52, S53, S73, S74, S77 | `supabase\migrations\0087_ui_redesign_flags_guest_read.sql:1-57`; `supabase\migrations\0052_merchant_staff.sql:520-589` |
| MK-F05 / P1 / A | Supplier selection bypasses current verified-shop requirement — After shop sends live quote, admin can suspend/unverify it. compare_rfq_quotes still returns offer and select_supplier_quote creates/reuses an enquiry without checking shop.status, unlike start_product_enquiry/send_supplier_quote. → No new supplier selection/enquiry into currently unavailable shop; history stays readable. | O38P / S73, S74, S30 | `supabase\migrations\0050_rfq.sql:583-629`; `supabase\migrations\0049_shops_catalogue.sql:921-996` |
| MK-F06 / P2 / A | New product enquiry accepts a product excluded by current public catalogue projection — start_product_enquiry checks active product in verified shop but not active category or shop-category membership. get_product/search/list exclude those missing predicates. → New product-specific enquiry requires the same public catalogue eligibility; existing threads remain readable/repliable under their own rules. | O38P / S58, S76 | `supabase\migrations\0049_shops_catalogue.sql:805-919`; `supabase\migrations\0049_shops_catalogue.sql:921-996` |
| MK-F07 / P1 / A | RFQ actions/outcomes ignore temporal eligibility and conflate parent/quote state — Select/Send rely on raw open/sent; expiry is only enforced by SQL at command time. Lowest includes deadline-expired sent rows. Supplier list prioritizes rejected quote over cancelled RFQ. Admin raw-open count includes past-deadline rows until cleanup. → Consistent raw status plus effective deadline/action reason, separate parent outcome, no expired offer as current lowest. | O19 / S27, S52, S73, S74 | `app\app\rfq\[id].tsx:29-98`; `app\app\rfq\[id].tsx:157-212` |
| MK-F08 / P1 / A | Supplier detail loses saved quote terms/outcomes and reuses wrong-context drafts — Supplier list returns terminal my_outcome, but detail my_quote sent-only metadata has no line/totals. Inputs initialize blank, remain editable by role after RFQ closure, persist across id/shopId changes, and category schema matches non-unique name. → Latest own-shop quote fully readable; terminal state read-only; version/context-safe draft; category identity by UUID. | O38P / S52, S74 | `supabase\migrations\0074_p1b_rfq.sql:3-58`; `supabase\migrations\0074_p1b_rfq.sql:309-343` |
| MK-F09 / P1 / A | Primary supplier selection precedes critical difference warnings and is duplicated — Summary presenter handles unavailable/brand/missing specs only; changed specs, rounded quantity and delivery-late/missing terms appear in a later carousel with another Choose action. → All material non-equivalence information before a single selection action per offer. | O19 / S73 | `app\src\features\rfq\comparePresentation.ts:12-53`; `app\src\components\market\QuoteCompareTable.tsx:27-124` |
| MK-F10 / P2 / A | Unified search discards valid server product matches and exposes grouping categories as services — groupResults name-substring filters all kinds after server full-text product search. Catalogue grouping parents with archetype NULL are included as service results and route to an inspect-style category with no real bookable category. → Respect source-specific membership and category semantics. | O12 / S07 | `app\src\features\search\searchModel.ts:60-130`; `app\src\features\search\api.ts:28-81` |
| MK-F11 / P1 / A | Unified product result strips indicative unit-price and stock truth — Same SearchProduct displays only From amount in unified search while product surfaces correctly show price per unit, updated date, confirm-with-shop and unavailable warning. → Same product PK has one truthful product-card contract. | O12 / S07, S59, S58, S76 | `app\src\features\search\SearchScreen.tsx:161-225`; `app\src\components\market\ListingCard.tsx:31-133` |
| MK-F12 / P2 / A | Marketplace entry points ignore effective parent capabilities — Search always shows Shops/Sports scopes; product AI omits ai_assistant parent; member RFQ link and owner staff-management link render without their flags. → Hide only unavailable entry points while preserving other capabilities and existing history. | O12 / S07, S53, S59 | `app\src\features\search\SearchScreen.tsx:112-158`; `app\app\products.tsx:15-66` |
| MK-F13 / P2 / A | Guest and own-shop enquiry/AI commits do not use existing authentication handoff — Guest-browse product/shop screens invoke authenticated start_product_enquiry directly; actual shop owner also sees self-enquiry submit although SQL denies it. Product AI is authenticated and similarly has no sign-in handoff. → Sign in before composer/commit with safe return path; do not offer actual owner self-enquiry. | O18 / S58, S76, S59 | `app\app\product\[id].tsx:21-89`; `app\app\shop\[id].tsx:21-99` |
| MK-F14 / P1 / A | Top-rated public card projection loses archetype pricing and current leave — Query fetches visit_fee/category name+slug and raw is_online. Cards choose cheapest active visit_fee for every category, including proposal/fixed; active leave is masked in search but not top-rated. Supplied top-rated image corroborates proposal-type from-zero. → One safe ranked-provider DTO with real archetype/offer price meaning, effective presence and explicit selected-city rating context; preserve filtered trust/rating order. | O14 / S06, S87 | `app\src\lib\supabaseApi.ts:145-186`; `app\src\lib\apiTypes.ts:64-101` |
| MK-F15 / P1 / A | Package catalogue ignores selected service city — getCatalogueCategory is city-specific but listCataloguePackages only filters slug/active; inner service query has no selected-city restriction. Public visibility in provider's own live city does not bind customer city. → Current-city package results and correct location context. | O14 / S40 | `app\src\features\catalogue\api.ts:76-132`; `app\src\features\catalogue\ArchetypeCategory.tsx:15-65` |
| MK-F16 / P2 / A | Provider-specific package action silently restarts at all-provider category — Fixed/time footer Book provider routes to /category/slug while own packages are read-only; chosen provider_service_id is lost. → Explicit exact provider/service/package handoff or targeted proposal. | O14 / S63 | `app\src\features\providerProfile\ProviderProfileScreen.tsx:100-155`; `app\src\features\providerProfile\ProviderProfileScreen.tsx:158-236` |
| MK-F17 / P2 / A | Marketplace load failures can claim empty supply, setup or endless loading — Many initial []/null defaults still enter no-record/setup branches after catch. Enquiry messages remain null skeleton; errors generally lack Retry. Shop discovery uses a shared Promise.all for unrelated public/private sections. → Per-resource idle/loading/success/error plus honest stale state; empty only after successful current-scope read. | O18 / S27, S30, S45, S50, S52, S53, S58, S59, S73, S74, S75, S76, S77 | `app\app\admin\rfqs.tsx:14-63`; `app\app\admin\shops.tsx:19-84` |
| MK-F18 / P2 / A | Discovery/profile response scope and refresh can preserve stale truth — Home/category/provider/top-rated primarily use mount effects, lack cancellation for context reads, and some hide refresh errors. Category error isn't cleared on new success. Provider secondary-profile failure becomes null and makes unavailable false. → Scope-keyed current reads with focus/foreground refresh and explicit unknown temporal availability. | O12 / S06, S40, S59, S63, S87 | `app\src\features\home\HomeV2.tsx:39-82`; `app\src\features\home\HomeV2.tsx:210-265` |
| MK-F19 / P2 / A | Enquiry closed/reopen/refresh controls do not match every participant state — Closed footer tells staff to Reopen despite owner/customer-only status RPC. Reopen can collide with active twin; no pull/foreground refresh for counterpart changes. → Role-accurate closed instructions, safe active-thread navigation, concrete current-state refresh. | O19 / S45 | `app\app\enquiry\[id].tsx:18-75`; `app\app\enquiry\[id].tsx:75-130` |
| MK-F20 / P2 / A | Business work lists lose business identity for multi-business members — Enquiry RPC returns shop_name but row hides it; supplier list lacks shop_name entirely. Same RFQ can appear for multiple shops, while get_my_business_shop chooses only first accessible shop. → Explicit business labels keyed by actual shop_id; retain existing composite route. | O28 / S50, S52, S74 | `app\app\merchant-enquiries.tsx:15-53`; `app\app\merchant-rfqs.tsx:15-68` |
| MK-F21 / P2 / C | Home discovery needs one deliberate urgent-work and search/AI hierarchy — Legacy active work follows category grid; both home bodies place standalone AI after family discovery; HomeV2 already lifts active card before pillars. → Urgent existing work before exploration; one coherent search/AI hub. | O12 / S06 | `app\src\features\home\HomeV2.tsx:114-142`; `app\src\features\home\HomeV2.tsx:210-265` |
| MK-F22 / P2 / A | Narrow home pillar truncates a primary family title — 48% two-column card combines side 44px icon with two-line title; supplied Home portrait visibly ellipsizes creator-family destination. → Full family destination names at narrow/large-text sizes. | O08 / S06 | `app\src\components\market\PillarCard.tsx:32-64` |
| MK-F23 / P2 / C | Provider decision controls follow secondary biography/hours — Hero/trust/stats/About/Area-hours precede Services & rates; supplied profile screenshot corroborates this hierarchy. → Compact identity/availability then service/package choice before biography. | O14 / S63 | `app\src\features\providerProfile\ProviderProfileScreen.tsx:158-236`; `app\src\features\providerProfile\ProviderProfileHero.tsx:25-62` |
| MK-F24 / P2 / C | Existing-shop catalogue and inbox work are subordinate to management forms — Long always-expanded shop form precedes routine catalogue; Manage shop button precedes enquiry inbox. → Stage-appropriate workspace: new setup first, existing catalogue/work first. | O27 / S53, S50 | `app\app\merchant-shop.tsx:353-411`; `app\app\merchant-shop.tsx:414-467` |
| MK-F25 / P2 / C | Product/shop discovery gives optional forms priority over browsing and buries enquiry action — AI form precedes manual product search; shop general enquiry precedes catalogue; product enquiry follows all images/specs; customer enquiry preview ends at five without View all. → Browse-first discovery and one contextual existing enquiry path; no checkout. | O18 / S58, S59, S76, S77 | `app\app\product\[id].tsx:21-89`; `app\app\products.tsx:113-167` |
| MK-F26 / P2 / A | Creator landing has no successful-empty category state — Successful [] maps no cards and immediately shows How it works, without location/availability explanation. → Truthful location-aware empty recovery, no fabricated creators or undefined brief category. | O21 / S43 | `app\src\features\creators\CreatorsScreen.tsx:16-97`; `app\src\features\creators\creatorCategories.ts:1-8` |
| MK-F27 / P2 / A | RFQ cancel confirmation promises supplier notification not queued by current command — Confirmation says suppliers will be told; cancel_rfq only updates sent quotes/requst state and does not enqueue cancellation notification. → Promise only persisted closure/outcomes; cancellation secondary but accessible. | O19 / S73 | `app\app\rfq\[id].tsx:29-98`; `supabase\migrations\0074_p1b_rfq.sql:285-306` |
| MK-F28 / P1 / A | Hard product deletion can violate the open-enquiry key and cannot preserve all valid histories — Two valid open enquiries for one customer/shop (product+general or two distinct products) have different current keys. delete_product hard-deletes; FK ON DELETE SET NULL collapses them onto the unique open NULL-product key. Current function does not preserve immutable context. Existing ws3 delete test covers only one open thread and explicitly expects it to remain open. → Hard deletion succeeds without closing/merging messages or changing enquiry IDs; original product context remains an immutable private key. | O38P / S53, S45, S50 | `supabase\migrations\0049_shops_catalogue.sql:9-140`; `supabase\migrations\0069_ws3_shop_product_remediation.sql:90-110` |

23 confirmed-current-defect findings and five required-design-change findings. Requirement changes are not presented as already-failing old tests. Full per-finding ordered repairs, actors, files, risks and assertions are in the JSON and task table below.

## Public trust: filtered truth is not fabricated Verified
- search_providers wrapper calls _search_providers_phase0 then _is_bookable; live helper requires KYC verified, admin approved, not suspended/deactivated, submitted, active docs-eligible service.
- listTopRated explicit filters are KYC/suspended/paused/rated/city/self; providers_read RLS adds _provider_is_live for public reads. Its constant Verified rendering is therefore not fabricated for these real reads.
- search_shops/get_shop filter status=verified; search_products/get_product/list_shop_products join verified shop, active category and shop mapping. Safe Verified shop text may use this provenance without exposing private shop status.
- get_provider_public_profile returns safe derived badges and current leave. Current id_verified is derived from KYC plus acc_ payout-account shape, and payout_verified from KYC. Identity auditor must decide/correct semantic truth; marketplace must not fetch private records to reproduce it.
- Creator landing returns categories only; no people verification or portfolio can be inferred. Social links are explicitly provider-submitted/not OAuth-verified.

Evidence: `app\src\lib\supabaseApi.ts:145-186`; `supabase\migrations\0087_ui_redesign_flags_guest_read.sql:123-261`; `supabase\migrations\0087_ui_redesign_flags_guest_read.sql:497-540`; `supabase\migrations\0018_archetype_core.sql:239-283`; `supabase\migrations\0064_o2_provider_verification.sql:62-80`; `supabase\migrations\0049_shops_catalogue.sql:805-919`; `supabase\migrations\0069_ws3_shop_product_remediation.sql:153-212`; `supabase\migrations\0087_ui_redesign_flags_guest_read.sql:542-645`; `app\src\features\creators\CreatorsScreen.tsx:16-97`; `app\src\features\providerProfile\ProviderPortfolioSection.tsx:18-62`

O38I owns canonical provider readiness and public badge semantics. This stream independently verified actual consumer SQL/read projections and identifies only concrete projection/placement defects.
Never supply public cards with private documents, actual payout identifiers, admin reasons, shop GSTIN/owner identity or customer precise RFQ location to reconstruct status.

## Supplied before-artifact observations
Run 44696642603; head `229995fe3194de39684f12ef348d3e37930ae5f2`. Read-only diff against audit SHA changed only docs/14, so application code matches. Run failure and scenario filenames do not prove application defects or settings.
| Actual file | Actual owned screen/content observed |
| --- | --- |
| 20-home-FAILED.png | S06 — Visible search/active-work/four family tiles; creator-family title visibly ellipsized. No personal location/account strings reproduced. |
| 16-phase-7a-shop-and-product-browse.png | S58 — Actually product detail: unit price/age/indicative disclaimer/stock/specs and lower enquiry composer. Not proof of a shop-list state. |
| 18-phase-7a-rfq-create-and-details.png | S73 — RFQ detail visibly Open with needed-by, Cancel above requested items and empty comparison. No selected-state claim. |
| 161-phase-7a-admin-approves-submitted-shop.png | S30 — Scrolled reason/action block; another visible row has Verified badge. Same-row invalid action is source-proven, not inferred from this crop. |
| 60-phase-7a-owner-submits-shop.png | S40 — Actually a time-based session-package category, not merchant-shop. No S53 visual evidence from this file. |
| 69-provider-detail.png | S63 — Hero/trust/stats/About/Area-hours precede visible service choice; sticky action present. No personal provider details reproduced. |
| 23-top-rated-see-all.png | S87 — Proposal-type service row visibly has from-zero amount, corroborating source pricing defect. Names not reproduced. |
| 17-phase-7a-product-enquiry.png | S45 — Open conversation, dated message and sticky composer. No closed-role or permission claim inferred. |

The file named owner-submits-shop is actually a session-package category: **no S53 visual claim**. All eight are before observations only; personal names/account/location details are not reproduced. Other coverage is source-only.

## Screen-by-screen placement audit
### S06 — `app\app\(customer)\index.tsx`
Discover available marketplace families and resume existing work.
**Current:** Location/bell → Search → HomeV2 active booking; legacy grid before active booking → Pillars/families and popular chips → Separate AI card → Top rated/trust
**Target:** Compact location/bell → Urgent existing-work summary → Single search/AI hub → Effective families → Popular and ranked providers → Trust explanation
**Primary:** Search or choose a live family; resume actionable work first.
**Real bodies:** `app\src\features\home\HomeV2.tsx`; `app\src\features\home\LegacyHome.tsx`; `app\src\features\home\homeModel.ts`; `app\src\features\catalogue\CatalogueSections.tsx`; `app\src\components\market\PillarCard.tsx`; `app\src\components\market\ListingCard.tsx`

| Element | Current | Problem / retain | Exact target / reason | Evidence | Named assertion / finding |
| --- | --- | --- | --- | --- | --- |
| Location/bell | First horizontal row with selected place and unread badge. | retain: Retain accessible location and notification navigation. | Keep one compact top row. Discovery depends on selected place. | `app\src\features\home\HomeV2.tsx:210-265` | MK-S06-location-bell: place change reloads scope; bell opens /notifications. [retain] |
| Active work | HomeV2 after search; legacy after category grid. | required-design-change: Legacy ordering delays actionable work; HomeV2 ordering is already better. | Directly below location, using services-auditor canonical priority rather than a new booking enum. Existing work outranks exploration. | `app\src\features\home\HomeV2.tsx:114-142`; `app\src\features\home\HomeV2.tsx:210-265` | MK-S06-priority: same booking PK/action appears before family tiles. [MK-F21] |
| AI | Separate card after pillars/popular; conditional empty-search exit also exists. | required-design-change: Disconnected from search and unnecessarily repeated. | One search/AI hub; reuse existing assistant route and query handoff. Discoverability without duplicate capabilities. | `app\src\features\home\HomeV2.tsx:345-389`; `app\src\features\home\HomeV2.tsx:210-265` | MK-S06-single-ai: one default AI entry; assistant OFF leaves manual search. [MK-F21] |
| Pillar labels | 48%-width cards, 44px side icon, two-line title. | confirmed-current-defect: Supplied portrait image visibly truncates creator-family title. | Stack icon above title on narrow cards; below 360 logical px use one column; preserve full family names. Primary destinations must be identifiable. | `app\src\components\market\PillarCard.tsx:32-64` | MK-S06-pillar-labels: all family names readable at 320/393px and 200% text. [MK-F22] |
| Data/error | Catalogue/top-rated/bookings share Promise.all; error hidden once categories exist. | confirmed-current-defect: Secondary failure can block catalogue initialization or conceal failed refresh. | Independent section outcomes, focus/foreground reads and scope cleanup. Failed secondary data is not no catalogue. | `app\src\features\home\HomeV2.tsx:39-82`; `app\src\features\home\HomeV2.tsx:210-265` | MK-S06-independent-reads: reject top-rated only; catalogue/work render with section retry. [MK-F18] |
| Ranked cards | Verified prop with cheapest active visit_fee and raw online field. | confirmed-current-defect: Trust is filtered, not fabricated; price/presence lacks archetype and leave context. | Retain trust provenance; consume MK-T12 public card projection. Identity, price and availability are separate truths. | `app\src\features\home\HomeV2.tsx:416-459`; `app\src\lib\supabaseApi.ts:145-186` | MK-S06-ranked: proposal has no zero visit-price claim; leave is not Online. [MK-F14] |
**Actors/states:**
- Customer: existing booking -> canonical status/next step and actual booking ID, not a product order.
- Guest with guest_browse ON: public discovery only; no private booking row.
- Products/sports OFF: corresponding discovery family hidden; other live families remain.
**Current refresh:** Mount/city effect and pull; no focus refresh; booking read errors become an empty array.
**Loading / empty / error:** Initial shared error Retry; catalogue/pillar skeletons; refresh error can be hidden behind prior categories.
**Runtime:** NOT RUN. Supplied before artifact observed; no after PASS.

### S07 — `app\app\(customer)\search.tsx`
Search existing categories, products, shops and activities, not invented providers.
**Current:** Header → Search → All five scope chips → Minimum-query/skeleton → Grouped results/error/empty
**Target:** Location-aware query → Effective scopes → Loading/error/retry → Kind-specific grouped results → Contextual assistance
**Primary:** Open the actual result's existing route.
**Real bodies:** `app\src\features\search\SearchScreen.tsx`; `app\src\features\search\api.ts`; `app\src\features\search\searchModel.ts`; `app\src\components\market\ListingCard.tsx`

| Element | Current | Problem / retain | Exact target / reason | Evidence | Named assertion / finding |
| --- | --- | --- | --- | --- | --- |
| Query lifecycle | 300ms debounce and active-request cleanup. | retain: Retain minimum-query and stale-request cancellation. | Keep while fixing result membership. Older search cannot overwrite a newer query. | `app\src\features\search\SearchScreen.tsx:31-99` | MK-S07-query-race: delayed A cannot replace B; short query issues no search. [retain] |
| Scope chips | All/services/shops/sports/creators always rendered. | confirmed-current-defect: Products/sports OFF still advertise unusable scopes. | Remove unavailable scopes and reset invalid selection to All. Disabled capability is not empty search. | `app\src\features\search\SearchScreen.tsx:112-158`; `app\src\features\search\api.ts:28-81` | MK-S07-scope-off: disabled scope chip and request absent. [MK-F12] |
| Result membership | Server full-text products are re-filtered by name substring; all catalogue rows included. | confirmed-current-defect: Brand/model matches can vanish; null-archetype grouping parents become fake bookable results. | Keep server product membership; local-name filter other kinds; exclude grouping parents. Client must respect the real source query. | `app\src\features\search\searchModel.ts:60-130`; `supabase\migrations\0069_ws3_shop_product_remediation.sql:113-151` | MK-S07-brand: different-name brand match remains; null-archetype parent never routes as a provider. [MK-F10] |
| Product money/stock | Generic From amount; no unit, stock, price age, indicative qualifier or signed photo. | confirmed-current-defect: Fields already present in SearchProduct are dropped. | Reuse ShopProductCard and IndicativePrice with signed image/fallback. Cross-unit indicative offers are not checkout prices. | `app\src\features\search\SearchScreen.tsx:161-225`; `app\src\features\shops\components.tsx:1-89` | MK-S07-product: same PK has identical unit/price/stock across search, products and detail. [MK-F11] |
| Result identity | Category rows use provider/creator variants; shop rows have area/distance. | retain: Retain that these are categories or shops, not named creators/portfolios. | Explicit kind/category action text; safe shop offerings/trust. Do not imply a category match is a particular person. | `app\src\features\search\SearchScreen.tsx:161-225`; `app\src\features\search\searchModel.ts:60-130` | MK-S07-kind: category has no personal rating/verification claim and routes by slug. [retain] |
**Actors/states:**
- Public viewer, unified_search OFF: feature-off information and Home only.
- Query >=2 normalized characters: enabled grouped sources; no private RFQ data.
- One failed source: surviving groups plus a source-specific error, not a zero-result claim.
**Current refresh:** Query/location/capability effects; no pull; query edit repeats search.
**Loading / empty / error:** Pending skeletons and per-group alerts; no explicit retry; minimum two normalized characters.
**Runtime:** NOT RUN. Source-only for this screen; no visual PASS.

### S27 — `app\app\admin\rfqs.tsx`
Administrative RFQ activity, not order management.
**Current:** Error → Open/quote metrics → Response time → Read-only recent requests
**Target:** Compact metrics → Effective lifecycle/deadline context → Recent outcomes → Recoverable empty/error
**Primary:** Review aggregate/recent activity.
**Real bodies:** `app\app\admin\rfqs.tsx`

| Element | Current | Problem / retain | Exact target / reason | Evidence | Named assertion / finding |
| --- | --- | --- | --- | --- | --- |
| Metrics | Open and quotes/RFQ before response time. | retain: Retain aggregate scope and exact units. | Compact metric group; no sales/order controls. No order engine exists here. | `app\app\admin\rfqs.tsx:14-63`; `supabase\migrations\0050_rfq.sql:667-709` | MK-S27-no-order: only dashboard read; no purchase/payment action. [retain] |
| Recent status | Raw status interpolation. | confirmed-current-defect: Raw open can outlive deadline until cleanup; labels differ from other roles. | Canonical RFQ presenter plus expires_at and effective-open metric. Same lifecycle meaning across roles. | `app\app\admin\rfqs.tsx:14-63`; `supabase\migrations\0050_rfq.sql:667-709` | MK-S27-expiry: past-deadline raw open is explained and excluded from effective Open. [MK-F07] |
| Request identity | Title/city/quote_count; chevron=false; no onPress. | retain: Retain no invalid customer-owned detail link. | Keep read-only recent row and expose created_at. Admin dashboard scope does not authorize customer-private RFQ. | `app\app\admin\rfqs.tsx:14-63`; `supabase\migrations\0050_rfq.sql:311-341` | MK-S27-admin-scope: no customer-detail action for non-owner admin. [retain] |
| Failure/retry | Inline error; skeleton only before first payload. | confirmed-current-defect: First failed fetch has no retry action. | ErrorState Retry; successful empty distinct from unavailable. No false zero-valued dashboard. | `app\app\admin\rfqs.tsx:14-63` | MK-S27-retry: failure exposes Retry, not successful zero metrics. [MK-F17] |
| Refresh | Focus and pull call shared load. | retain: Retain authoritative mutation-free reload. | Keep load/freshness indicator. No local badge/state fabrication. | `app\app\admin\rfqs.tsx:14-63` | MK-S27-focus: revisiting reloads counts. [retain] |
**Actors/states:**
- public.admins member: aggregate/recent summaries only, all request states.
- Non-admin: admin_rfq_dashboard denied; no aggregate read.
- Admin is not automatically customer owner: no get_rfq detail privilege.
**Current refresh:** Focus and pull.
**Loading / empty / error:** Initial skeleton; InlineAlert; successful recent-empty; missing Retry.
**Runtime:** NOT RUN. Source-only for this screen; no visual PASS.

### S30 — `app\app\admin\shops.tsx`
Review shop verification and product-category activation.
**Current:** Metrics → Status filter → Full shop cards/all actions → Category switches
**Target:** Queue/filter → Identity/status → Valid actions → Contextual reason/confirmation → Secondary category management
**Primary:** Perform a permitted shop review transition.
**Real bodies:** `app\app\admin\shops.tsx`; `app\src\features\shops\components.tsx`

| Element | Current | Problem / retain | Exact target / reason | Evidence | Named assertion / finding |
| --- | --- | --- | --- | --- | --- |
| Review queue | Default submitted filter and all six real states. | retain: Retain submitted-first work queue. | Keep above shop details. Pending review is primary work. | `app\app\admin\shops.tsx:19-84`; `app\app\admin\shops.tsx:96-128` | MK-S30-filter: each real ShopStatus available, default submitted. [retain] |
| Verify/restore | Verify renders for every shop. | confirmed-current-defect: Verified/draft/rejected rows expose an action latest SQL rejects. | Verify only submitted/under_review; Restore verification for suspended; no same-state completed action. UI must match current server conditions. | `app\app\admin\shops.tsx:96-128`; `supabase\migrations\0064_o2_provider_verification.sql:133-166` | MK-S30-verified-no-verify: same verified shop PK has no Verify; direct reverify denied. [MK-F01] |
| Reason/destructive action | Always-present reason and four equal-area controls. | confirmed-current-defect: Reason dominates even when irrelevant; visibility-changing action has no confirmation. | Reason in contextual Reject/Suspend/return-to-review confirmation; preserve current admin authority. Deliberate status action, not accidental demotion. | `app\app\admin\shops.tsx:19-84`; `app\app\admin\shops.tsx:96-128` | MK-S30-reason: blank reject/suspend denied; cancel confirmation performs no mutation. [MK-F01] |
| Readback | Mutation awaits load and shows refreshed status/reason. | retain: Retain server readback and reason. | Keep readback before success; no optimistic verified badge. A completed command is not a current row projection. | `app\app\admin\shops.tsx:19-84`; `app\app\admin\shops.tsx:96-128` | MK-S30-readback: refreshed admin row is authoritative. [retain] |
| Categories | Enable/Disable below all shop rows. | retain: Retain separate category activation model. | Secondary collapsible category section. Category active is not shop status. | `app\app\admin\shops.tsx:130-145`; `supabase\migrations\0049_shops_catalogue.sql:482-532` | MK-S30-category-off: shop status unchanged; category products hidden. [retain] |
**Actors/states:**
- Admin submitted/under_review: Verify allowed after completeness checks.
- Admin verified: Verify denied by current SQL but still displayed in current UI.
- Admin suspended: verified restoration allowed; reason visible.
- Non-admin: all admin reads/writes rejected.
**Current refresh:** Focus/pull; status and category mutations await load.
**Loading / empty / error:** InlineAlert/skeleton; failed initial fetch can coexist with No shops match.
**Runtime:** NOT RUN. Supplied before artifact observed; no after PASS.

### S40 — `app\app\category\[slug].tsx`
Find a provider/package using actual archetype and selected location.
**Current:** Category availability gate → Inspect filters/providers OR fixed/time packages OR proposal brief/packages/providers
**Target:** Title/location → Archetype action → Applicable filters → Real provider/package cards → Recovery
**Primary:** Book/schedule inspect work, choose fixed/session package, or request proposals.
**Real bodies:** `app\app\category\[slug].tsx`; `app\src\features\catalogue\ArchetypeCategory.tsx`; `app\src\features\booking\packages\PackageCard.tsx`; `app\src\components\ProviderCard.tsx`

| Element | Current | Problem / retain | Exact target / reason | Evidence | Named assertion / finding |
| --- | --- | --- | --- | --- | --- |
| Archetype router | getCatalogueCategory(city) selects InspectQuoteCategory or ArchetypeCategory. | retain: Retain existing router and no-service-here state. | No universal service card/booking path. Different purchase intents already exist. | `app\app\category\[slug].tsx:46-99`; `app\src\features\catalogue\ArchetypeCategory.tsx:15-65` | MK-S40-archetypes: all four archetypes keep correct action and route. [retain] |
| Inspect filters | Sticky chips and filter-sheet live count/footer. | retain: Retain applicable filters; online presence is not a reserved slot. | Keep controls; do not promise a free time slot from Online. Presence and availability differ. | `app\app\category\[slug].tsx:100-208`; `app\app\category\[slug].tsx:286-411` | MK-S40-filter: apply/reset preserves sort and correct result count. [retain] |
| Package geography | listCataloguePackages takes category slug, no selected city. | confirmed-current-defect: City A category can display city B providers/packages. | Pass city; inner provider join and exact normalized city restriction, retaining RLS. Live somewhere is not available in selected city. | `app\src\features\catalogue\ArchetypeCategory.tsx:15-65`; `app\src\features\catalogue\ArchetypeCategory.tsx:69-162` | MK-S40-city: two-city fixture returns only selected-city packages. [MK-F15] |
| Async category scope | No reset/error-clear/cancellation for category slug/city promise. | confirmed-current-defect: Old response/error can overwrite new context. | Scope-key cleanup, reset and focus reload. Title, eligibility and action must describe same context. | `app\app\category\[slug].tsx:46-99`; `app\src\features\catalogue\ArchetypeCategory.tsx:15-65` | MK-S40-race: old-city response cannot revive an unavailable category. [MK-F18] |
| Provider truth | Search output passed verified; proposal uses Request proposal. | retain: Retain SQL-filtered trust and distinct proposal action. | Use public card fields, never private docs/payout data. No invented verified creator. | `app\app\category\[slug].tsx:217-285`; `app\src\features\catalogue\ArchetypeCategory.tsx:69-162` | MK-S40-trust: non-live/suspended provider absent; proposal no visit-fee sale. [retain] |
**Actors/states:**
- Category not live in city: unavailable; no commit.
- Inspect: Book/Schedule with real provider_service_id.
- Fixed/time: instant only for positive fixed package price; range/from/quote -> proposal.
- Proposal: real provider/package brief, not visit payment.
**Current refresh:** Inspect effect/pull; package/proposal mount/slug effects, no pull/focus refresh.
**Loading / empty / error:** Category skeleton/unavailable/error; package/provider skeleton/empty/retry; proposal package/provider errors share state.
**Runtime:** NOT RUN. Supplied before artifact observed; no after PASS.

### S43 — `app\app\creators.tsx`
Enter existing creator-category brief/proposal journeys.
**Current:** Title → Category cards or loading/error → How it works
**Target:** Location/title → Live categories or truthful empty → Category-scoped brief entry → How it works
**Primary:** Choose a real creator category.
**Real bodies:** `app\src\features\creators\CreatorsScreen.tsx`; `app\src\features\creators\creatorCategories.ts`

| Element | Current | Problem / retain | Exact target / reason | Evidence | Named assertion / finding |
| --- | --- | --- | --- | --- | --- |
| Category identity | Actual catalogue family cards route by slug. | retain: Retain categories, not fabricated named creators. | Explicit category cards. No people query on this route. | `app\src\features\creators\CreatorsScreen.tsx:16-97`; `app\src\features\creators\creatorCategories.ts:1-8` | MK-S43-categories: only returned creator-family categories render. [retain] |
| Successful empty | Empty category map then How it works. | confirmed-current-defect: No location-specific unavailable explanation. | EmptyState with Change location/Browse services; no invented general brief category. Useful recovery without fictitious supply. | `app\src\features\creators\CreatorsScreen.tsx:16-97` | MK-S43-empty: city-aware empty and no unsupported brief submit. [MK-F26] |
| Loading/error | Skeletons and ErrorState Retry. | retain: Retain explicit failure vs loading. | Keep retry before process explanation. Failure is not zero creators. | `app\src\features\creators\CreatorsScreen.tsx:16-97` | MK-S43-error: failure exposes Retry, not No creators found. [retain] |
| Portfolio claims | No portfolio/social-stat read. | retain: Retain no stock work or fabricated verification. | Real samples only on real provider profile. Evidence must belong to actual provider. | `app\src\features\creators\CreatorsScreen.tsx:16-97`; `app\src\features\providerProfile\ProviderPortfolioSection.tsx:18-62` | MK-S43-no-fake: no supplied portfolio means none invented. [retain] |
| Process/OFF | Four informational steps follow discovery; OFF card/Home action. | retain: Retain subordinate explanation and fallback. | After category/empty content; preserve ordinary category path. Landing is not creator authorization. | `app\src\features\creators\CreatorsScreen.tsx:16-97`; `app\src\features\home\homeModel.ts:1-46` | MK-S43-off: OFF hides landing but does not disable enabled creator categories. [retain] |
**Actors/states:**
- Landing ON/live categories: open category, then real creator/proposal.
- Successful zero categories: current code leaves category area blank.
- Landing OFF: Home fallback; underlying creator category drill-down remains available.
**Current refresh:** Mount/city/flag effect; Retry; no pull.
**Loading / empty / error:** Skeleton/error explicit; successful empty unexplained.
**Runtime:** NOT RUN. Source-only for this screen; no visual PASS.

### S45 — `app\app\enquiry\[id].tsx`
Read, reply to and resolve a participant-owned shop conversation.
**Current:** Shop/product header and Close/Reopen → Role/status card → Dated messages → Open shop → Sticky composer/error
**Target:** Compact identity/status/permitted action → Thread → Role-specific closed/OFF explanation → Permitted reply/read-only footer
**Primary:** Reply while open, otherwise read or use permitted reopen.
**Real bodies:** `app\app\enquiry\[id].tsx`; `app\src\features\shops\components.tsx`

| Element | Current | Problem / retain | Exact target / reason | Evidence | Named assertion / finding |
| --- | --- | --- | --- | --- | --- |
| Participant/sender identity | from_shop_user treats team replies as shop-side; messages have timestamps. | retain: Retain replying-as-shop and actual sender direction. | Keep explicit business context and dated messages. Display name is not identity or authorization. | `app\app\enquiry\[id].tsx:75-130`; `supabase\migrations\0052_merchant_staff.sql:650-724` | MK-S45-team: staff shop-side bubbles do not grant close rights. [retain] |
| Close/Reopen | Customer or business_role owner header control. | confirmed-current-defect: Old closed thread can collide with another open thread on same natural key. | Return participant-safe active_enquiry_id/can_reopen; show Open active conversation when collision exists. Avoid predictable unique-index failure without granting staff authority. | `app\app\enquiry\[id].tsx:18-75`; `app\app\enquiry\[id].tsx:75-130` | MK-S45-reopen-collision: old closed plus current open -> navigate active, no failing Reopen. [MK-F19] |
| Closed explanation | All roles told Reopen this enquiry to reply. | confirmed-current-defect: Manager/staff cannot perform that action. | Customer/owner permitted reopen; staff/manager ask customer/owner, read-only. Next step must be achievable by current actor. | `app\app\enquiry\[id].tsx:75-130`; `supabase\migrations\0049_shops_catalogue.sql:1044-1063` | MK-S45-staff-closed: no editable reply or instruction to self-reopen. [MK-F19] |
| Refresh/error | Focus/local writes load; no pull/foreground refresh; failed load can leave skeleton. | confirmed-current-defect: Cannot refresh counterpart closure/messages in place. | Screen pull/foreground scoped reload and recoverable error. Current status needs authoritative refresh. | `app\app\enquiry\[id].tsx:18-75`; `app\app\enquiry\[id].tsx:75-130` | MK-S45-counterpart: owner closes same PK; customer pulls -> closed and composer disabled. [MK-F19, MK-F17] |
| Feature OFF | Whole thread replaced and RPC reads gated. | required-design-change: Existing history inaccessible. | Authorized read-only history/mark-read survive; new messages/reopen remain gated. Disabling new work must not erase records. | `app\app\enquiry\[id].tsx:18-75`; `app\app\enquiry\[id].tsx:75-130` | MK-S45-off: participant reads with parents OFF; outsider still denied. [MK-F04] |
**Actors/states:**
- Customer participant: open reply/close; closed reopen subject to unique-open constraint.
- Actual owner: reply/read/close/reopen.
- Manager/staff: reply/read/mark shop side; no close/reopen.
- Outsider: read/write denied.
**Current refresh:** Focus plus awaited local write load; mark-read after reads; no active-thread subscription/pull.
**Loading / empty / error:** Footer-only error; messages null remains skeleton after failure.
**Runtime:** NOT RUN. Supplied before artifact observed; no after PASS.

### S50 — `app\app\merchant-enquiries.tsx`
Prioritize enquiries across authorized businesses.
**Current:** Error → Manage shop → Enquiries/unread/date → Empty
**Target:** Business-labelled work inbox → Unread/status/time → Recovery → Secondary manage link
**Primary:** Open a conversation requiring attention.
**Real bodies:** `app\app\merchant-enquiries.tsx`; `app\src\features\shops\components.tsx`

| Element | Current | Problem / retain | Exact target / reason | Evidence | Named assertion / finding |
| --- | --- | --- | --- | --- | --- |
| Primary inbox | Manage my shop button precedes enquiries. | required-design-change: Management dominates reply work. | Enquiries first, management in secondary header/menu. Primary purpose is responding. | `app\app\merchant-enquiries.tsx:15-53` | MK-S50-priority: first actionable content is an enquiry. [MK-F24] |
| Business context | RPC returns shop_name but row omits it. | confirmed-current-defect: Multi-business member cannot identify business from row. | Shop name/group keyed by shop_id; never first-shop inference. Context must survive routing. | `app\app\merchant-enquiries.tsx:15-53`; `supabase\migrations\0052_merchant_staff.sql:591-648` | MK-S50-business: identical products across two shops show distinct business labels. [MK-F20] |
| Unread/time | shop_unread n new and last-message date. | retain: Retain business-side server unread; show useful time too. | Compact unread/status/date-time metadata. This is not per-staff personal unread. | `app\app\merchant-enquiries.tsx:15-53`; `supabase\migrations\0052_merchant_staff.sql:650-724` | MK-S50-read: member mark-read clears shop side only. [retain] |
| Failed load | Error then No enquiries yet from initial []. | confirmed-current-defect: Failure is represented as successful absence. | ErrorState Retry; empty only after success; stale marker after refresh failure. No false-empty inbox. | `app\app\merchant-enquiries.tsx:15-53` | MK-S50-error: rejected RPC shows Retry, not No enquiries yet. [MK-F17] |
| OFF history | Capability OFF replaces list. | required-design-change: Authorized history disappears. | Read-only history plus OFF explanation. Preserve existing work. | `app\app\merchant-enquiries.tsx:15-53`; `supabase\migrations\0052_merchant_staff.sql:591-648` | MK-S50-off: owner/active member reads history; inactive member denied. [MK-F04] |
**Actors/states:**
- Owner: own-shop conversations.
- Active manager/staff with merchant_staff ON: assigned-business conversations and reply/read only.
- Inactive/unrelated member: no rows or guessed-ID access.
**Current refresh:** Focus/pull.
**Loading / empty / error:** Skeleton/list/empty; false-empty after failed initial read.
**Runtime:** NOT RUN. Source-only for this screen; no visual PASS.

### S52 — `app\app\merchant-rfqs.tsx`
Open routed RFQs and read recent supplier outcomes in the chosen business.
**Current:** Header/error → RFQ rows → Manage shop
**Target:** Business context → Current deadline-aware requests → Separate historical outcomes → Secondary manage link
**Primary:** Open a routed RFQ or read its outcome.
**Real bodies:** `app\app\merchant-rfqs.tsx`; `app\src\features\rfq\components.tsx`

| Element | Current | Problem / retain | Exact target / reason | Evidence | Named assertion / finding |
| --- | --- | --- | --- | --- | --- |
| Composite routing | shop_id:rfq_id key and both route IDs. | retain: Retain multi-business routing. | Keep both IDs. RFQ ID alone can be ambiguous. | `app\app\merchant-rfqs.tsx:15-68`; `supabase\migrations\0074_p1b_rfq.sql:3-58` | MK-S52-route: same RFQ for two shops opens chosen shopId. [retain] |
| Business label | Summary lacks shop_name. | confirmed-current-defect: Identical rows cannot identify business. | Add safe shop_name to summary and render/group it. Name is display, shop_id remains key. | `app\app\merchant-rfqs.tsx:15-68`; `supabase\migrations\0074_p1b_rfq.sql:309-343` | MK-S52-label: two assigned shops have distinct labels. [MK-F20] |
| Outcome | Selected/rejected quote takes precedence over cancelled/expired RFQ; fallback Reply ignores deadline. | confirmed-current-defect: Cancellation can become only Not selected; expired work can suggest reply. | Show parent state and quote outcome separately; reply only if eligible/live. Independent records are not a universal enum. | `app\app\merchant-rfqs.tsx:15-68`; `supabase\migrations\0074_p1b_rfq.sql:309-343` | MK-S52-cancelled: Cancelled + Not selected, never Reply. [MK-F07] |
| Needed-by/history | Item count/location/date; SQL current or updated within 30 days. | retain: Retain historical read; not open-only. | Current/history grouping and expiry metadata. Recent outcomes already exist. | `app\app\merchant-rfqs.tsx:15-68`; `supabase\migrations\0074_p1b_rfq.sql:309-343` | MK-S52-history: terminal request updated within 30 days remains. [retain] |
| Failure/OFF | Error can look empty; OFF removes history. | required-design-change: Different conditions are conflated. | Retry failure; preserve authorized read-only history when new RFQs OFF. Truthful absence/permission. | `app\app\merchant-rfqs.tsx:15-68`; `supabase\migrations\0074_p1b_rfq.sql:309-343` | MK-S52-off-error: no false empty and no lost authorized history. [MK-F17, MK-F04] |
**Actors/states:**
- Owner/manager: quote only if assigned verified shop/live RFQ.
- Staff: assigned RFQ read, not send.
- Terminal RFQ: separate parent state and quote outcome, no stale Reply.
**Current refresh:** Focus/pull.
**Loading / empty / error:** Skeleton/list/empty; failed initial read can claim no recent RFQs.
**Runtime:** NOT RUN. Source-only for this screen; no visual PASS.

### S53 — `app\app\merchant-shop.tsx`
Manage an owner's shop/catalogue or direct delegated members to permitted work.
**Current:** Status/staff/submit → Long expanded shop form → Catalogue/enquiry toolbar → Inline editor → Product rows
**Target:** Status/readiness/permission → Existing-shop catalogue and work links → Contextual product editor → Collapsed shop details
**Primary:** New shop: save/submit; existing shop: manage catalogue.
**Real bodies:** `app\app\merchant-shop.tsx`; `app\src\features\shops\components.tsx`; `app\src\features\shops\SpecFields.tsx`; `app\src\features\shops\format.ts`; `app\src\features\shops\specs.ts`

| Element | Current | Problem / retain | Exact target / reason | Evidence | Named assertion / finding |
| --- | --- | --- | --- | --- | --- |
| Verification status | Top badge/reason; submit disabled for submitted/review/verified, absent for suspended. | retain: Retain client state suppression; RPC reset gap is MK-F02. | State-specific status and only needed action. Submission is not verification. | `app\app\merchant-shop.tsx:353-411`; `supabase\migrations\0049_shops_catalogue.sql:399-449` | MK-S53-submit: verified/submitted/review no enabled Submit; suspended cannot submit. [MK-F02; client retain / separate server repair] |
| Re-verification warning | Verified identity delta confirmation then authoritative reload. | retain: Retain current warning; blanket nonidentity demotion is already fixed in 0069. | Keep warning beside identity save. Do not re-report repaired doc17 behavior. | `app\app\merchant-shop.tsx:192-242`; `supabase\migrations\0069_ws3_shop_product_remediation.sql:3-88` | MK-S53-reverify: description/delivery/category edit preserves verified; identity edit prompts then submitted. [retain] |
| Catalogue priority | Address/GST/category form precedes routine catalogue. | required-design-change: Existing-shop work buried under unrelated fields. | Catalogue/work links after readiness; contextual shop details; new shop keeps setup. Purpose changes after shop exists. | `app\app\merchant-shop.tsx:353-411`; `app\app\merchant-shop.tsx:414-467` | MK-S53-priority: existing catalogue before address fields; new shop setup first. [MK-F24] |
| Suspended editor | Add/Edit/Save product still enabled. | confirmed-current-defect: save_product rejects suspended shop. | Disable writable product editor with reason; retain read and current removal semantics. No knowingly rejected action. | `app\app\merchant-shop.tsx:414-467`; `supabase\migrations\0049_shops_catalogue.sql:600-718` | MK-S53-suspended: no writable editor; direct save denied; owner read remains. [MK-F03] |
| Effective navigation | Member RFQ and owner staff links unconditional. | confirmed-current-defect: Disabled capabilities still have entry points. | Gate RFQ by products/product_rfq; staff by merchant_staff. Role is not capability availability. | `app\app\merchant-shop.tsx:287-349`; `app\app\merchant-shop.tsx:353-411` | MK-S53-links: OFF capability removes only its link, not owner catalogue. [MK-F12] |
| Product controls | Six photos/specs/units, independent stock/listed, confirmed hard Remove. | confirmed-current-defect: Normal history retention is correct, but simultaneous open product/general contexts collide when FK nulls. | Keep hard deletion/confirmation and preserve immutable enquiry context; never close or merge history. Retain normal behavior and repair the source-proven key collision. | `app\app\merchant-shop.tsx:287-349`; `app\app\merchant-shop.tsx:414-467` | MK-S53-remove: product gone; two open enquiry PKs/messages retained without unique-key collision. [MK-F28] |
**Actors/states:**
- Actual owner draft/rejected: save, catalogue edit unless suspended, submit complete shop.
- Verified owner: nonidentity edits retain verification; identity edits -> submitted after warning.
- Suspended owner: read and save shop details retaining suspension; product save/submission denied; current removal still permitted.
- Manager/staff: read-only business navigation, no owner catalogue writes.
**Current refresh:** Focus/pull and awaited mutation load; product save preserves unsaved shop draft.
**Loading / empty / error:** InlineAlert/skeleton; failed first read can leave a blank setup draft.
**Runtime:** NOT RUN. Source-only for this screen; no visual PASS.

### S58 — `app\app\product\[id].tsx`
Understand a real item and enquire, not purchase/reserve it.
**Current:** Header → Image grid → Repeated title/attributes → Price/stock/specs → Shop link → Enquiry form
**Target:** Compact identity/image → Indicative unit price/age/stock → Verified-shop context → Contextual Ask shop → Expandable specs
**Primary:** Send an enquiry when permitted.
**Real bodies:** `app\app\product\[id].tsx`; `app\src\features\shops\components.tsx`

| Element | Current | Problem / retain | Exact target / reason | Evidence | Named assertion / finding |
| --- | --- | --- | --- | --- | --- |
| Images/action | All images and long specs precede only enquiry form. | required-design-change: Primary enquiry can be below long content. | Compact media plus contextual sticky Ask shop opening existing composer. Findability without checkout. | `app\app\product\[id].tsx:21-89` | MK-S58-long: long specs/photos do not bury Ask shop; no Cart/Buy. [MK-F25] |
| Money/stock | IndicativePrice has unit/date/disclaimer; stock separate. | retain: Retain null vs zero and non-reserving stock semantics. | Keep beside identity. Price is not guaranteed sale. | `app\app\product\[id].tsx:21-89`; `app\src\features\shops\components.tsx:1-89` | MK-S58-price: null Ask shop, zero formatted per unit, false stock unavailable. [retain] |
| Shop trust | get_product joins verified shop, active category and mapping. | retain: Retain server-filtered provenance, not fabricated product certification. | Safe Shop verified text and shop link; no private admin/doc read. Public card need not recompute private readiness. | `supabase\migrations\0049_shops_catalogue.sql:805-919`; `app\app\product\[id].tsx:21-89` | MK-S58-trust: hidden shop/category/mapping item absent. [retain] |
| Guest/owner action | Direct authenticated RPC, no local sign-in/self-enquiry guard. | confirmed-current-defect: Known invalid action offered. | requireSignIn return path/draft; safe own-shop can_enquire projection. Match actual server permissions. | `app\app\product\[id].tsx:21-89`; `supabase\migrations\0049_shops_catalogue.sql:921-996` | MK-S58-actor: guest signs in before RPC, owner no send, customer allowed. [MK-F13] |
| Unavailable/error | Null item explicit unavailable; exception leaves old content and no Retry. | confirmed-current-defect: Stale action can look current. | Separate failure/unavailable; retry and clear changed scope. Visibility can change. | `app\app\product\[id].tsx:21-89` | MK-S58-refresh: suspension clears CTA; network failure exposes Retry. [MK-F17] |
**Actors/states:**
- Guest: public read; target sign in before enquiry.
- Customer: active verified-shop item -> enquiry if parents ON, including availability questions for out-of-stock item.
- Actual owner: self-enquiry server-denied; manage instead.
- Hidden item/shop/category: unavailable, no stale commit.
**Current refresh:** Focus/pull, then signed image resolution.
**Loading / empty / error:** Initial skeleton/inline error; null product unavailable; no exception retry.
**Runtime:** NOT RUN. Supplied before artifact observed; no after PASS.

### S59 — `app\app\products.tsx`
Find products with manual filters and optional existing AI assistance.
**Current:** AI form → Manual search → Price/stock/categories → Apply → RFQ → Results
**Target:** Manual search/location → Applied filters → Contextual AI → Secondary RFQ → Results/error/empty
**Primary:** Apply search/filters and open a product.
**Real bodies:** `app\app\products.tsx`; `app\src\features\shops\components.tsx`

| Element | Current | Problem / retain | Exact target / reason | Evidence | Named assertion / finding |
| --- | --- | --- | --- | --- | --- |
| Manual search | Optional multiline AI precedes manual query. | required-design-change: Optional assist dominates reliable manual path. | Manual search first; compact contextual AI; applied filter summary. Clear primary action. | `app\app\products.tsx:113-167` | MK-S59-order: manual input first; layout OFF retains old composition plus A fixes. [MK-F25] |
| AI parents | !demo && ai_product_search only. | confirmed-current-defect: Server also requires ai_assistant and products. | Require all effective parents/build availability and sign-in. Child ON cannot bypass parent OFF. | `app\app\products.tsx:15-66`; `app\src\lib\featureFlagModel.ts:1-16` | MK-S59-AI-off: assistant OFF/child ON hides AI; manual search works. [MK-F12, MK-F13] |
| Product cards | ShopProductCard keeps signed photo/fallback, unit/age/disclaimer and stock. | retain: Retain richer existing contract. | Reuse in unified search. Same entity, same semantics. | `app\app\products.tsx:113-167`; `app\src\features\shops\components.tsx:1-89` | MK-S59-card: same PK has same price/unit/stock in all discovery. [retain] |
| Applied scope | Draft filters; Apply/submit/pull; loadRef prevents query per keystroke. | confirmed-current-defect: Retain deliberate apply, but location/stale results need scope control. | Applied-state label and context-key response rejection. Edited controls are not yet queried filters. | `app\app\products.tsx:68-109` | MK-S59-scope: no old-location result overwrite; dirty filter not labelled applied. [MK-F18] |
| Failure/empty | Failed first read leaves [] and No products found. | confirmed-current-defect: False successful absence. | Retry; empty only after successful current-scope read. Truthful availability. | `app\app\products.tsx:68-109`; `app\app\products.tsx:113-167` | MK-S59-error: rejected RPC never says No products found. [MK-F17] |
| RFQ entry | One effectively gated multi-shop quote link. | retain: Retain RFQ, not bulk cart. | Secondary near filters/results. No order engine. | `app\app\products.tsx:113-167`; `app\src\features\rfq\components.tsx:1-24` | MK-S59-RFQ: parent OFF hides entry. [retain] |
**Actors/states:**
- Public products ON: catalogue search/details, no orders.
- Effective AI ON: authenticated AI -> validated filters and database rows.
- products OFF/product_rfq child ON: no new RFQ.
- Guest AI commit must sign in before invocation.
**Current refresh:** Focus via loadRef, pull and Apply; not automatic on filter keystrokes.
**Loading / empty / error:** Inline error/skeleton/list/empty; no successful-read marker.
**Runtime:** NOT RUN. Source-only for this screen; no visual PASS.

### S63 — `app\app\provider\[id].tsx`
Evaluate provider, choose service/package and proceed through correct existing flow.
**Current:** Hero/trust → Stats/About/area-hours → Services/packages → Portfolio → Reviews → Sticky footer
**Target:** Compact identity/trust → Availability → Service/package choice → Relevant portfolio → About/hours → Reviews → Correct sticky action
**Primary:** Book chosen inspect service/package or request targeted proposal.
**Real bodies:** `app\src\features\providerProfile\ProviderProfileScreen.tsx`; `app\src\features\providerProfile\ProviderProfileHero.tsx`; `app\src\features\providerProfile\ProviderProfileCallouts.tsx`; `app\src\features\providerProfile\ProviderProfileOverview.tsx`; `app\src\features\providerProfile\ProviderServicesSection.tsx`; `app\src\features\providerProfile\ProviderPortfolioSection.tsx`; `app\src\features\providerProfile\ProviderReviewsSection.tsx`; `app\src\components\ProviderServicePackages.tsx`; `app\src\features\providerProfile\ProfileParts.tsx`; `app\src\components\ProviderProfileAttributes.tsx`

| Element | Current | Problem / retain | Exact target / reason | Evidence | Named assertion / finding |
| --- | --- | --- | --- | --- | --- |
| Selection placement | About/area-hours precede service selection. | required-design-change: Decision controls below secondary biography; screenshot confirms order. | Services/packages directly after identity/availability. Footer should refer to visible choice. | `app\src\features\providerProfile\ProviderProfileScreen.tsx:158-236`; `app\src\features\providerProfile\ProviderProfileOverview.tsx:30-86` | MK-S63-order: services before About/hours. [MK-F23] |
| Package continuity | Footer for fixed/time routes to whole category; packages read-only. | confirmed-current-defect: Book this provider can lose provider intent. | Choose own provider_service_id/package.id; use canPayInstantly and exact existing book/request routes. No silent restart at all-provider discovery. | `app\src\features\providerProfile\ProviderProfileScreen.tsx:100-155`; `app\src\features\providerProfile\ProviderServicesSection.tsx:32-128` | MK-S63-package: exact providerServiceId/packageId; non-fixed targeted brief. [MK-F16] |
| Availability failure | Public-profile errors -> null; unavailable only considers pub. | confirmed-current-defect: Paused detail can get enabled CTA when secondary read fails. | Respect detail.paused always; temporal unknown explained and refreshed, never treated available. Missing data is not availability. | `app\src\features\providerProfile\ProviderProfileScreen.tsx:55-71`; `app\src\features\providerProfile\ProviderProfileScreen.tsx:100-155` | MK-S63-fail: paused detail + failed public read never enables Book. [MK-F18] |
| Trust | Hero payout_verified/kyc fallback; public ID/bank/police/credentials. | retain: Retain filtered provenance; badge semantic repair belongs identity auditor. | Consume approved public DTO; no private documents/payout IDs. Do not mislabel filtered Verified fabricated. | `app\src\features\providerProfile\ProviderProfileScreen.tsx:100-155`; `app\src\features\providerProfile\ProviderProfileCallouts.tsx:26-52` | MK-S63-trust: approved public fields only; no private status recomputation. [retain] |
| Sticky city/preview | Archetype-aware PriceFooter; preview removes it; other city offers switch. | retain: Retain preview suppression and explicit city switch. | Keep one state-valid sticky action. Avoid end-of-form city failure. | `app\src\features\providerProfile\ProviderProfileScreen.tsx:158-236` | MK-S63-preview: no footer; other-city click switches before booking. [retain] |
| Portfolio/reviews | Only actual photos/links; provider-submitted/not OAuth-verified disclaimer; dated reviews. | retain: Retain real evidence and disclaimers. | Relevant samples before long biography where useful. No fabricated work or social verification. | `app\src\features\providerProfile\ProviderPortfolioSection.tsx:18-62`; `app\src\features\providerProfile\ProviderReviewsSection.tsx:39-156` | MK-S63-portfolio: absent data produces no invented samples; dates/disclaimer retained. [retain] |
**Actors/states:**
- Live inspect: selected service booking.
- Fixed/time: target exact package/provider; non-fixed -> targeted proposal.
- Paused/on leave: read only, no booking.
- Owner preview=1: no commit footer.
- Guest: public projection; sign in before authenticated action.
**Current refresh:** Mount/id/category and pull; no focus; previous selected ID retained.
**Loading / empty / error:** Initial detail Retry; secondary public read silently null; loaded-page refresh error hidden.
**Runtime:** NOT RUN. Supplied before artifact observed; no after PASS.

### S73 — `app\app\rfq\[id].tsx`
Compare customer-owned RFQ offers and select supplier into enquiry.
**Current:** Request/status → Cancel → Requested items → Summary with select → Detailed horizontal cards with second select → No-payment note
**Target:** Request/effective lifecycle → Offers with critical differences before action → Requested/offer detail expansion → One selection per offer → Secondary confirmed cancel
**Primary:** Select eligible supplier -> returned enquiry ID, never order.
**Real bodies:** `app\app\rfq\[id].tsx`; `app\src\features\rfq\components.tsx`; `app\src\features\rfq\comparePresentation.ts`; `app\src\components\market\QuoteCompareTable.tsx`

| Element | Current | Problem / retain | Exact target / reason | Evidence | Named assertion / finding |
| --- | --- | --- | --- | --- | --- |
| Request dates | Status/recipient count/delivery/needed-by before items. | retain: Retain needed-by separate from expires_at. | Compact summary with visible quote deadline. Delivery need is not expiry. | `app\app\rfq\[id].tsx:104-156`; `supabase\migrations\0050_rfq.sql:311-341` | MK-S73-dates: distinct needed-by and quote-deadline labels. [retain] |
| Eligibility | Raw open/sent and enquiries gate; no deadline comparison. | confirmed-current-defect: Post-deadline selection stays visible until cleanup. | Server can_select/block reason plus conservative deadline masking/reload. No knowingly rejected action. | `app\app\rfq\[id].tsx:29-98`; `app\app\rfq\[id].tsx:157-212` | MK-S73-expired: no Choose after quote/RFQ cutoff; live partial remains selectable with warnings. [MK-F07] |
| Differences before choose | Summary action precedes later spec/quantity/delivery warnings; two selection controls. | confirmed-current-defect: User can select before seeing critical non-equivalence. | Extend existing presenter with all flags; one expandable offer/action. Lowest total is not equivalent scope. | `app\src\features\rfq\comparePresentation.ts:12-53`; `app\src\components\market\QuoteCompareTable.tsx:27-124` | MK-S73-warnings: changed specs, rounded quantity, missing/late delivery before sole selection. [MK-F09] |
| Totals/lowest | Server money fields; incomplete excluded, but deadlines ignored for lowest. | confirmed-current-defect: Retain arithmetic; expired offer must not win lowest. | Existing getLowestQuoteId over live complete offers; no client total recompute. Comparable current offers only. | `app\app\rfq\[id].tsx:29-98`; `app\app\rfq\[id].tsx:157-212` | MK-S73-lowest: partial/expired never lowest complete live; paise unchanged. [MK-F07, MK-F09] |
| Cancel | Large button before items; confirmation promises suppliers told. | confirmed-current-defect: Destructive action dominates; SQL queues no cancellation notification. | Contextual confirmed cancel; copy promises only persisted outcomes. No unsupported push promise. | `app\app\rfq\[id].tsx:29-98`; `app\app\rfq\[id].tsx:104-156` | MK-S73-cancel-copy: no unsent notification promise; dismiss means no RPC. [MK-F27] |
| Handoff/OFF | select returns enquiry_id, replace; OFF hides history/cancel. | required-design-change: Retain no-payment handoff; history/safe cancellation must survive OFF. | Read-only history and owner cancel of open work; no new choose when OFF. No invented order lifecycle. | `app\app\rfq\[id].tsx:29-98`; `supabase\migrations\0050_rfq.sql:583-629` | MK-S73-off: own read/cancel survives; new selection disabled; no payment/order created. [MK-F04] |
**Actors/states:**
- RFQ owner/live sent quote: select only with effective parents, deadline/shop eligibility; partial offers remain allowed with warnings.
- RFQ terminal: historical offers, no select.
- Other customer/supplier/non-owning admin: get_rfq/compare denied; use own role projection.
**Current refresh:** Focus/pull; cancel reload; selection navigates. No deadline timer.
**Loading / empty / error:** Inline error/skeleton; no Retry; zero-quotes copy still invites replies on terminal RFQ.
**Runtime:** NOT RUN. Supplied before artifact observed; no after PASS.

### S74 — `app\app\rfq\merchant\[id].tsx`
Read routed needs and send/revise quote only with live business permission.
**Current:** Request/deadline → Items/quote inputs → Delivery/notes → Estimated total → Sticky Send for raw-open owner/manager
**Target:** Business/state and actual prior outcome → Requested lines with permitted inputs or saved terms → Delivery/exact estimate → Eligible send or read-only explanation
**Primary:** Send next version while eligible, otherwise read actual latest quote.
**Real bodies:** `app\app\rfq\merchant\[id].tsx`; `app\src\features\shops\SpecFields.tsx`; `app\src\features\rfq\components.tsx`; `app\src\features\rfq\quoteMath.ts`

| Element | Current | Problem / retain | Exact target / reason | Evidence | Named assertion / finding |
| --- | --- | --- | --- | --- | --- |
| Role | canQuote owner/manager; staff no Send. | retain: Retain minimum-manager authority. | Keep server _acts_for(manager) and explicit read-only staff. Local role switch is not authorization. | `app\app\rfq\merchant\[id].tsx:104-169`; `supabase\migrations\0074_p1b_rfq.sql:60-175` | MK-S74-staff: no button and RPC denied. [retain] |
| Terminal inputs | Role alone renders writable fields; raw open controls footer. | confirmed-current-defect: Closed/expired/unverified shop can get writable controls; expired raw open can Send. | Safe can_send_quote/deadline predicate controls both fields and footer; explain block. Role is not availability. | `app\app\rfq\merchant\[id].tsx:104-169`; `app\app\rfq\merchant\[id].tsx:173-270` | MK-S74-terminal: no editable/send controls when terminal or temporally unavailable. [MK-F08, MK-F07] |
| Saved quote | my_quote sent-only, no items/totals; form initialized blank. | confirmed-current-defect: Selected/rejected/expired quote disappears; revision not based on saved terms. | Latest own version with items/totals/status; hydrate once per context/version, terminal read-only. List outcome must be inspectable. | `supabase\migrations\0074_p1b_rfq.sql:3-58`; `app\src\features\rfq\api.ts:1-154` | MK-S74-history: actual ID/version/lines/totals preserved; other shop excluded. [MK-F08] |
| Context/schema | Any current draft survives id/shopId changes; category matched by name. | confirmed-current-defect: Old line IDs or non-unique display name can misbind editor. | Key rfq_id+shop_id; category_id readback/schema lookup; preserve dirty only within same context. Names are not PKs. | `app\app\rfq\merchant\[id].tsx:47-103`; `supabase\migrations\0074_p1b_rfq.sql:3-58` | MK-S74-key: two-context navigation resets IDs and uses category UUID. [MK-F08] |
| Amounts/GST | estimateQuoteTotals; unavailable zero; GSTIN constrains rates; server recomputes. | retain: Retain real math and bounds. | Estimate adjacent to fields; saved history uses server money. Do not trust client totals. | `app\app\rfq\merchant\[id].tsx:47-103`; `app\app\rfq\merchant\[id].tsx:104-169` | MK-S74-round: 2.5*101 paise ->253 line, 5% tax ->13; nonzero GST without GSTIN denied. [retain] |
| Failure | Footer error; failed read offers back route, no Retry. | confirmed-current-defect: Failure does not prove empty/no RFQ. | Retry/back plus stale-send suppression; preserve same-context unsent draft. Avoid overwrite/wrong-context send. | `app\app\rfq\merchant\[id].tsx:104-169`; `app\app\rfq\merchant\[id].tsx:173-270` | MK-S74-retry: same-context draft retained labelled unsent; failed changed context cannot send. [MK-F17] |
**Actors/states:**
- Assigned owner/manager, verified shop, live open RFQ: send new version withdraws old sent.
- Staff: read only; direct send denied.
- Closed/expired/cancelled or shop unavailable: read-only saved own-shop quote.
- Unrelated/inactive member: denied.
**Current refresh:** Focus read; submit replaces supplier list; current drafts not scoped by context.
**Loading / empty / error:** Skeleton/footer error/back link; no saved terminal quote or Retry.
**Runtime:** NOT RUN. Source-only for this screen; no visual PASS.

### S75 — `app\app\rfq\new.tsx`
Create RFQ with explicit item specs, quantity/unit, needed-by and location.
**Current:** Category/title → Items/specs → Date → Delivery/location → Notes → Sticky send
**Target:** Category/title → Items/spec/quantity-unit → Needed-by → Delivery/location → Notes → Sticky validated send
**Primary:** Send one request to server-routed verified shops.
**Real bodies:** `app\app\rfq\new.tsx`; `app\src\features\shops\SpecFields.tsx`; `app\src\features\rfq\components.tsx`

| Element | Current | Problem / retain | Exact target / reason | Evidence | Named assertion / finding |
| --- | --- | --- | --- | --- | --- |
| Category | Active category selection resets incompatible specs. | retain: Retain actual category UUID and reset. | Before item details. Schema belongs to category. | `app\app\rfq\new.tsx:54-117`; `app\app\rfq\new.tsx:125-234` | MK-S75-category: switching clears old specs, sends selected UUID. [retain] |
| Items | Description/brand/quantity/unit/SpecFields; Add stops at 20. | retain: Retain explicit requirements, no automatic equivalent product. | Bounded line form with compact units. Comparison uses RFQ item IDs. | `app\app\rfq\new.tsx:125-234`; `supabase\migrations\0050_rfq.sql:211-309` | MK-S75-lines: 1/20 valid; 21, zero/invalid quantity, unsupported specs denied. [retain] |
| Date/location | Presets and delivery/location after items. | retain: Retain needed-by separate from expiry and server-owned routing. | Visible before submission. Customer cannot inject recipient IDs. | `app\app\rfq\new.tsx:125-234`; `supabase\migrations\0050_rfq.sql:211-309` | MK-S75-routing: isolated shops prove category/radius/delivery and <=10 recipients. [retain] |
| Submit | Sticky single primary with busy/error and basic gates. | retain: Retain sticky submit and returned RFQ ID route. | Add field validation feedback without changing server constraints. Primary action already not buried. | `app\app\rfq\new.tsx:54-117`; `app\app\rfq\new.tsx:125-234` | MK-S75-create: actual returned ID; failure retains input and no success. [retain] |
| Category failure | Failure followed by empty category text; no Retry. | confirmed-current-defect: Load failure conflated with no active categories. | Retry beside section; empty only after success. Recoverable form. | `app\app\rfq\new.tsx:54-117`; `app\app\rfq\new.tsx:125-234` | MK-S75-retry: failed category read retries without losing items. [MK-F17] |
**Actors/states:**
- Authenticated caller/products+product_rfq ON: create own request; no client customer_id/recipient list.
- Guest: new RFQ is not browse route; sign in.
- Parent OFF: no new RFQ; existing history target remains readable.
**Current refresh:** Categories on enabled effect; local form draft.
**Loading / empty / error:** Footer error/text loading; failed vs successful-empty not distinguished.
**Runtime:** NOT RUN. Source-only for this screen; no visual PASS.

### S76 — `app\app\shop\[id].tsx`
Understand verified shop, browse catalogue and enquire.
**Current:** Identity/description/fulfillment → Expanded general enquiry → Catalogue
**Target:** Compact identity/trust/fulfillment → Catalogue → Contextual Ask shop → Secondary details
**Primary:** Browse product or ask shop.
**Real bodies:** `app\app\shop\[id].tsx`; `app\src\features\shops\components.tsx`

| Element | Current | Problem / retain | Exact target / reason | Evidence | Named assertion / finding |
| --- | --- | --- | --- | --- | --- |
| Identity | Name/address/pickup/delivery radius. | retain: Retain field honesty; no shop hours/rating/photo model in this projection. | Compact trust/location/fulfillment, no invented attributes. Archetype-specific contract. | `app\app\shop\[id].tsx:21-99`; `supabase\migrations\0087_ui_redesign_flags_guest_read.sql:888-917` | MK-S76-fields: guest address/coordinates remain redacted; no invented hours/stars. [retain] |
| General composer | Full message form before catalogue. | required-design-change: Secondary form pushes browsing below it. | Compact Ask shop action; composer contextual, catalogue first. Browse without unrelated form scroll. | `app\app\shop\[id].tsx:21-99` | MK-S76-order: catalogue before expanded composer; existing shopId/null productId payload. [MK-F25] |
| Products | Shared real card with signed first image/fallback. | retain: Retain indicative unit price/stock. | Reuse same template in all product paths. Same PK same semantics. | `app\app\shop\[id].tsx:21-99`; `app\src\features\shops\components.tsx:1-89` | MK-S76-product: same price/unit/stock as /products/detail. [retain] |
| Commit actor | Direct enquiry RPC, no guest/self guard. | confirmed-current-defect: Offers known invalid action. | Reuse sign-in/own-shop safe eligibility. Match backend. | `app\app\shop\[id].tsx:21-99`; `supabase\migrations\0049_shops_catalogue.sql:921-996` | MK-S76-actor: no anonymous/self send; valid customer allowed. [MK-F13] |
| Read failure | Missing shop explicit; exception retains old rows/action, no Retry. | confirmed-current-defect: Old eligibility appears current. | Unavailable/error/stale distinct and retry. Verification changes must invalidate commit. | `app\app\shop\[id].tsx:21-99` | MK-S76-refresh: suspension clears ask/catalogue; failed network read Retry. [MK-F17] |
**Actors/states:**
- Public verified shop: safe fields/products only.
- Guest: address/coordinates redacted; sign in for enquiry.
- Customer: general enquiry uses null product_id.
- Actual owner: manage instead of self-enquire.
**Current refresh:** Focus/pull plus signing images.
**Loading / empty / error:** InlineAlert/initial skeleton; successful empty catalogue explicit.
**Runtime:** NOT RUN. Source-only for this screen; no visual PASS.

### S77 — `app\app\shop\index.tsx`
Enter product search, categories, existing conversations and nearby shops.
**Current:** Product search → Categories → Five enquiries → Nearby shops
**Target:** Search/location → Category discovery → Unread history preview/View all → Shop cards
**Primary:** Search products/open relevant shop or conversation.
**Real bodies:** `app\app\shop\index.tsx`; `app\src\features\shops\components.tsx`

| Element | Current | Problem / retain | Exact target / reason | Evidence | Named assertion / finding |
| --- | --- | --- | --- | --- | --- |
| Search | First product query and button. | retain: Retain honest existing /products entry. | Keep primary; AI contextual in product search. No duplicate search/AI hub. | `app\app\shop\index.tsx:21-109` | MK-S77-query: trim q to /products; no cart. [retain] |
| Categories | Real active chips route category slug. | retain: Retain active source and correct filter. | Compact fully readable discovery. Category is filter, not order. | `app\app\shop\index.tsx:21-109`; `supabase\migrations\0049_shops_catalogue.sql:482-532` | MK-S77-category: correct slug; no invented inactive category. [retain] |
| Enquiry preview | First five own conversations only. | required-design-change: No View all here; OFF hides preview/history access. | Unread preview and existing activity Shop destination; history survives OFF. Do not lose existing work. | `app\app\shop\index.tsx:21-109`; `supabase\migrations\0087_ui_redesign_flags_guest_read.sql:919-955` | MK-S77-history: sixth conversation reachable; OFF doesn't erase authorized history. [MK-F04, MK-F25] |
| Shop cards | Name/area/distance/category slugs/pickup-delivery. | retain: Retain verified-only provenance; no fabricated stars/image. | Shop template with readable categories and fulfillment. Do not recompute private trust. | `app\app\shop\index.tsx:21-109`; `supabase\migrations\0049_shops_catalogue.sql:805-919` | MK-S77-trust: suspension removes same shop PK from list/detail. [retain] |
| Partial failure | Categories/shops/enquiries one Promise.all. | confirmed-current-defect: One private error can suppress discovery and claim no shops. | Independent section outcomes/retry; successful-empty only. Read failure is not no supply. | `app\app\shop\index.tsx:21-109` | MK-S77-partial: enquiry failure preserves successful shops/categories. [MK-F17] |
**Actors/states:**
- Public products ON: verified shops and active categories.
- Guest enquiries read: empty safely, no private rows.
- Customer: own unread preview, target View all uses existing activity.
**Current refresh:** Focus/pull, currently shared batch.
**Loading / empty / error:** Nearby skeleton; other sections can look empty while loading; false-empty after failure.
**Runtime:** NOT RUN. Source-only for this screen; no visual PASS.

### S87 — `app\app\top-rated.tsx`
Rank real rated providers in selected city.
**Current:** Near you/count → Provider/service/stars/jobs/from-visit-fee rows
**Target:** Explicit selected city and rating meaning → Archetype/effective-availability cards → Honest empty/error/retry
**Primary:** Open actual provider profile.
**Real bodies:** `app\app\top-rated.tsx`; `app\src\components\TopRatedCard.tsx`; `app\src\lib\supabaseApi.ts`

| Element | Current | Problem / retain | Exact target / reason | Evidence | Named assertion / finding |
| --- | --- | --- | --- | --- | --- |
| Trust/ranking | Rating_avg then rating_count; verified/not suspended/not paused/self excluded; RLS live filter. | retain: Retain real order and filtered Verified. | Keep public trust source. Hardcoded prop after server filtering is not fabricated trust. | `app\src\lib\supabaseApi.ts:145-186`; `supabase\migrations\0087_ui_redesign_flags_guest_read.sql:123-261` | MK-S87-rank: non-live/self/unrated absent; order by real avg/count. [retain] |
| Price | Cheapest active visit_fee for all archetypes. | confirmed-current-defect: Proposal/fixed can show from zero unrelated to real offer. | Fetch archetype/real package summary and render correct price semantics. Legacy zero visit fee is not free service. | `app\src\components\TopRatedCard.tsx:11-209`; `app\src\lib\supabaseApi.ts:145-186` | MK-S87-price: proposal quote-per-brief; inspect Visit fee; fixed/session actual package. [MK-F14] |
| Presence | Avatar gets raw is_online; leave not in query. | confirmed-current-defect: Profile can report current leave while this row says online. | Effective online/leave from safe public server projection. Presence consistency for same provider PK. | `app\src\components\TopRatedCard.tsx:11-209`; `app\src\lib\supabaseApi.ts:145-186` | MK-S87-leave: same active-leave provider never Online on ranked/home. [MK-F14] |
| Location | Near you without city; query is exact city, no distance output. | required-design-change: Can imply a proximity rank not computed. | Show selected city and Rated in city; retain rating sort. Honest geographic context. | `app\app\top-rated.tsx:16-59`; `app\src\lib\supabaseApi.ts:145-186` | MK-S87-city-label: displayed city matches query; no uncomputed distance rank. [MK-F14] |
| Refresh/error | Mount/city/pull; error only if list null. | confirmed-current-defect: Old city rows survive failed new-city read silently. | Focus/scoped reset and visible retry/stale marker. No stale context masquerading fresh. | `app\app\top-rated.tsx:16-59` | MK-S87-failure: city B failure doesn't display city A as current. [MK-F18] |
**Actors/states:**
- Public viewer: live rated non-self city providers, public fields only.
- Successful zero: no rated pros, not fabricated ratings.
- Failure after city change: target stale/error, not old city presented current.
**Current refresh:** Mount/city/pull only.
**Loading / empty / error:** Initial skeleton/error/empty; loaded-list errors hidden.
**Runtime:** NOT RUN. Supplied before artifact observed; no after PASS.

## Actual entity lifecycle, permissions, actions and refresh
### shop — present
**Identity / keys:**
- shops.id UUID PK
- shops.owner_id UNIQUE FK profiles.id: one shop per actual owner
- shop_categories PK(shop_id,category_id)
- business_members PK(owner_id,member_id), not a globally unique business name
**Canonical stored/read fields:**
- owner_id,name(2..100),description<=1500,address_line<=220,city/area<=100,lat[-90,90],lng[-180,180] paired nullable
- delivery_radius_km int 1..250; offers_delivery,offers_pickup,whatsapp_contact booleans; gstin nullable uppercase 15-character value
- status: draft|submitted|under_review|verified|rejected|suspended; status_reason; created_at,updated_at
- Private/owner projection get_my_business_shop: business_role owner|manager|staff; gstin only for business_role owner. It selects the first accessible shop, preferring actual ownership, not a universal business identity.
- Public search: id,name,description,city,area,offers_delivery,offers_pickup,distance_km,active category_slugs. Public detail additionally safe address/coordinates/delivery radius/whatsapp_contact; anon address='' and coordinates=NULL. No owner_id/GSTIN/status_reason in public detail.
- Admin projection: status/reason, owner display name, full review address/GSTIN/coordinates/categories/timestamps; authorization is public.admins.user_id=auth.uid().
| Actual state/value | Meaning |
| --- | --- |
| draft | Created owner shop, not public; owner can complete and submit. |
| submitted | Awaiting review, including verified/rejected identity-change re-submission. |
| under_review | Administrative review, not public. |
| verified | Publicly discoverable only with effective product/guest gates; not proof of product stock or shop opening hours. |
| rejected | Status reason retained; UI labels Changes requested; owner may edit/resubmit. |
| suspended | Not public; cannot submit or save products; shop details can be edited without clearing suspension. |
**Composite truth:**
- Latest _shops_products_enabled = products AND _guest_browse_enabled; authenticated/service_role satisfies guest helper independently of guest_browse. _shop_is_visible requires this AND status=verified.
- Public shop existence does not imply any active products, stock, rating, opening hours or a shop photograph; those are not fields in this public shop contract.
- save_shop normalizes identity fields. Changes to name/address_line/city/area/lat/lng/gstin demote verified or rejected to submitted and clear reason; suspended remains suspended. Description/delivery/pickup/category-only edits do not demote verified.
- Actual owner writes use owner_id=auth.uid(), not merely a client role label. Staff membership grants specific enquiry/RFQ operations through _acts_for; no owner catalogue permission is inferred from UI role switching.
| Transition | Actor / predicate / command / effect |
| --- | --- |
| 1 | Authenticated actual owner/no row -> draft via save_shop, products effective ON, valid categories/fields; readback get_my_business_shop. |
| 2 | Actual owner/non-suspended complete row -> submitted via current submit_shop. CURRENT GAP: source only excludes suspended, so verified/submitted/under_review can be reset directly although client disables this. MK-T02 restricts to draft/rejected. |
| 3 | Actual owner verified/rejected + identity delta -> submitted via latest save_shop; owner warning/readback and admin queue update; public row disappears until approved. |
| 4 | Admin -> verified only from submitted/under_review/suspended after completeness; current server denies draft/rejected/verified -> verified. UI currently ignores this; MK-T01. |
| 5 | Admin can set under_review/rejected/suspended from any existing row under current SQL; rejected/suspended require nonblank <=500 reason. Do not invent a narrower administrative transition policy. Same-state actions should not masquerade as pending work. |
| 6 | Admin status change locks shop, writes status/reason/updated_at and admin_audit_log. Current admin client awaits admin_list_shops reload; other-role readbacks occur on focus/pull, not automatic live synchronization. |
| Role / scenario | Sees | Allowed | Denied | Readback / other-role update |
| --- | --- | --- | --- | --- |
| Public customer/guest — Same shop PK verified -> suspended -> restored | Verified-only safe list/detail, then absence, then safe restored row | Browse/enquire only when effective and eligible | Read admin reason/GSTIN/owner ID or verify shop | Re-read search_shops/get_shop; no private status recomputation |
| Actual owner — Same shop PK verified, nonidentity vs identity edit | get_my_business_shop status/reason and catalogue | Nonidentity save; confirmed identity re-review; submit draft/rejected target | Verify own shop or clear suspension by save | Await owner reload; public projection disappears only for actual status change |
| Manager/staff — Active/inactive business_members row | Assigned work and safe business context when merchant_staff enabled | Read/reply enquiries; manager may send quotes | Actual-owner shop/catalogue writes | Owner/other staff re-read same business work; revoked member loses access |
| Administrator — Same submitted/verified/suspended shop PK | Private review projection with canonical status/reason | Only currently permitted transition, reason/confirmation where needed | Re-verify already verified shop | Admin list reload; owner focus/pull status; public list/detail visibility agrees |
| View | Read | Write | Actual refresh |
| --- | --- | --- | --- |
| S30 admin | admin_list_shops/admin_shop_dashboard/admin_list_product_categories | admin_set_shop_status/admin_set_product_category_active | Focus/pull and await load after mutation |
| S53 owner | get_my_business_shop; list_my_products only on owner branch | save_shop/submit_shop/save_product/delete_product | Focus/pull and awaited load; preserves unsaved shop draft after product save |
| S77/S76/search | search_shops/get_shop | Only separate enquiry creation | Shop list/detail focus/pull; unified search query/location effects |
**Evidence:** `supabase\migrations\0049_shops_catalogue.sql:9-140`; `supabase\migrations\0049_shops_catalogue.sql:159-249`; `supabase\migrations\0049_shops_catalogue.sql:399-449`; `supabase\migrations\0049_shops_catalogue.sql:482-532`; `supabase\migrations\0052_merchant_staff.sql:5-69`; `supabase\migrations\0052_merchant_staff.sql:591-648`; `supabase\migrations\0064_o2_provider_verification.sql:133-166`; `supabase\migrations\0069_ws3_shop_product_remediation.sql:3-88`; `supabase\migrations\0087_ui_redesign_flags_guest_read.sql:1-57`; `supabase\migrations\0087_ui_redesign_flags_guest_read.sql:888-917`; `supabase\migrations\0059_admin_identity_hardening.sql:7-19`
**Not observed:** No runtime shop rows or deployed settings queried. Administrative from-state policy beyond explicit SQL is not invented.

### product — present
**Identity / keys:**
- products.id UUID PK; shop_id/category_id FKs
- product_images.id PK, path UNIQUE, product_id FK ON DELETE CASCADE; image sort_order 0..5
- Product name/brand/model are not unique identity
- product_enquiries.product_id nullable FK ON DELETE SET NULL, which interacts with its open-thread unique key
**Canonical stored/read fields:**
- id,shop_id,category_id,name(2..120),brand/model<=80,description<=2000,specs JSON object
- unit exactly piece|sqft|box|kg|litre|bag|metre|set
- indicative_price_paise nullable nonnegative int; NULL means ask price, zero is a valid indicative value; price_updated_at
- in_stock boolean,active boolean,search tsvector,created_at,updated_at; no product.status enum
- Read DTO includes category_slug/category_name,image_paths; search adds shop_name,city,area,distance_km. Detail has no distance.
- Up to six distinct uploaded shop-owned image paths; owner max 500 rows; category specs validated in SQL against attribute_schema.
| Actual state/value | Meaning |
| --- | --- |
| active=true,in_stock=true | Listed and stated in stock, subject to verified shop/active category/mapping and capability gates. |
| active=true,in_stock=false | Still public if other predicates pass; unavailable stock warning, availability enquiry remains supported. |
| active=false,in_stock=any | Paused from public catalogue, still owner-readable. |
| deleted row | Latest delete_product hard-deletes; image rows cascade; enquiry product FK nulls if delete succeeds. This is not a soft-delete status. |
**Composite truth:**
- get_product/list_shop_products/latest search_products require effective products, product.active, shops.status=verified, product_categories.active and matching shop_categories entry.
- in_stock is descriptive and an optional search filter, not reserved inventory, a checkout guarantee or a product-order state.
- Latest search vector includes name,brand,model,description and category name, English prefix tsquery. Unified search incorrectly re-filters these rows by product name.
- price_updated_at changes only on actual indicative-price change, not every description edit; update timestamp remains separate.
- save_product is actual-owner-only, locks shop, rejects suspended shop, validates specs/unit/price/images and category membership. Existing same-category products may still be edited when that category has been disabled.
- Latest delete_product hard-deletes and is actual-owner/capability checked; it does not reject suspended shops. Do not invent a suspended-removal ban.
- Deletion edge: two open enquiries for the same shop/customer with distinct products, or one product and general enquiry, collapse to the same NULL product key during FK SET NULL. Current unique index makes deletion fail; MK-F28 preserves immutable context rather than closing/merging messages.
| Transition | Actor / predicate / command / effect |
| --- | --- |
| 1 | Actual owner with non-suspended shop and effective products -> insert/edit via save_product; fields active/in_stock independent; readback list_my_products and public get_product where visible. |
| 2 | Actual owner sets active false/true or stock false/true via save_product; no stock reservation or purchase side effect. |
| 3 | Admin disables category via admin_set_product_category_active -> product row unchanged but public search/list/detail disappears; owner retains management row. |
| 4 | Admin/shop identity transition away from verified -> product row unchanged but all public catalogue reads exclude it. |
| 5 | Actual owner delete_product -> row removed/image paths returned for storage cleanup; messages kept and product FK NULL if unique-open key permits. MK-T26 repairs colliding-history case without undoing hard deletion. |
| Role / scenario | Sees | Allowed | Denied | Readback / other-role update |
| --- | --- | --- | --- | --- |
| Public customer/guest — Same product PK listed -> stock false -> paused/category disabled/shop suspended | Unit indicative price/age; stock warning when false; absence when visibility predicate fails | Open real detail/shop and enquire when permitted | Infer order, reserve stock, edit price or read owner/admin fields | Re-read product/search; null is unavailable, exception is not null |
| Actual owner — Same product PK stock/listed edit and removal | Owner list includes paused/out-of-stock/category-disabled products | Save if shop not suspended; confirmed removal under current permission | Edit another shop; exceed schema/image/price limits | Await list_my_products reload; public row follows server visibility |
| Manager/staff — Assigned shop | Read-only shop/work navigation, not owner catalogue list through this UI | Enquiry/RFQ actions separately authorized | save_product/delete_product by membership alone | No catalogue permission fabricated from business_role |
| Administrator — Category active -> inactive | Dashboard active product count and category switches | Category activation, not direct product-order workflow | Infer stock/order truth from active product count | Public product projections exclude disabled category |
| View | Read | Write | Actual refresh |
| --- | --- | --- | --- |
| S59/S07 | search_products; signedProductImage(path,3600) | None | Manual Apply/focus/pull for S59; debounced query/context for S07 |
| S58/S76 | get_product/list_shop_products and signed paths | Separate start_product_enquiry, not order | Focus/pull; stale/error fixes specified |
| S53 | list_my_products | save_product/delete_product | Await owner reload and retain enquiry history |
**Evidence:** `supabase\migrations\0049_shops_catalogue.sql:9-140`; `supabase\migrations\0049_shops_catalogue.sql:600-718`; `supabase\migrations\0049_shops_catalogue.sql:805-919`; `supabase\migrations\0049_shops_catalogue.sql:921-996`; `supabase\migrations\0069_ws3_shop_product_remediation.sql:90-110`; `supabase\migrations\0069_ws3_shop_product_remediation.sql:113-151`; `supabase\migrations\0069_ws3_shop_product_remediation.sql:153-212`; `app\src\features\shops\api.ts:4-137`; `app\src\features\shops\api.ts:150-224`; `app\src\features\shops\api.ts:240-372`; `app\src\features\shops\components.tsx:1-89`; `app\src\features\shops\format.ts:1-18`
**Not observed:** No live stock counts or storage availability observed; stock is the source boolean, not inventory quantity.

### productOrder — not-present
**Identity / keys:**
- N/A — no product-order record in assigned marketplace.
**Canonical stored/read fields:**
- N/A — no cart/order/payment fields to invent.
**Composite truth:**
- Source-proven N/A in this marketplace: product detail starts enquiry; supplier selection closes RFQ and creates/reuses an enquiry, explicitly no payment taken. No product-order or cart table/RPC/route was found in the scoped app/shops/RFQ/Supabase source search.
| Transition | Actor / predicate / command / effect |
| --- | --- |
| 1 | N/A: do not convert selected supplier, enquiry status, product stock, Razorpay service-payment orders or service bookings into a fabricated product-order lifecycle. |
| Role / scenario | Sees | Allowed | Denied | Readback / other-role update |
| --- | --- | --- | --- | --- |
| All assigned roles — Product enquiry or supplier selection | Actual enquiry/RFQ/quote outcome | Read or coordinate next steps through enquiry | Checkout, pay, track shipment, cancel product order or claim purchase completion | No new order/payment engine in this transformation |
| View | Read | Write | Actual refresh |
| --- | --- | --- | --- |
| S58/S76/S73/S74 | Product/RFQ/quote/enquiry contracts only | start_product_enquiry/select_supplier_quote | Returned enquiry ID is actual navigation target |
**Evidence:** `app\app\product\[id].tsx:21-89`; `app\app\shop\[id].tsx:21-99`; `app\src\features\rfq\api.ts:164-247`; `supabase\migrations\0050_rfq.sql:583-629`; `supabase\migrations\0050_rfq.sql:7-97`
**Not observed:** No claim about future product strategy or systems outside this frozen repository. The scoped source search is corroboration, not the sole evidence of N/A.

### rfq — present
**Identity / keys:**
- rfqs.id UUID PK; customer_id/category_id FKs
- rfq_items.id UUID PK; UNIQUE(rfq_id,seq)
- rfq_recipients PK(rfq_id,shop_id)
- rfqs UNIQUE(customer_id,idempotency_key) WHERE key IS NOT NULL, added in 0070; current createRfq calls v1 without a key
**Canonical stored/read fields:**
- customer_id,category_id,title(3..120),city/area(2..100),lat/lng required bounded coordinates,needs_delivery boolean,needed_by date,notes<=2000
- status open|closed|expired|cancelled; expires_at default now()+7 days; created_at,updated_at; nullable idempotency_key
- Items: seq 1..20,description(2..500),brand_pref<=80,specs JSON object,quantity numeric(12,3)>0<=1000000,unit piece|sqft|box|kg|litre|bag|metre|set,created_at
- Customer read returns own coordinates/customer_id/category_id/items/recipient_count. Supplier projection excludes customer_id and precise coordinates. Admin dashboard returns aggregates/recent id/title/city/status/created_at/quote_count.
- Current RFQ read does not persist or return selected enquiry ID. Selection returns that ID only for the command handoff; do not assume RFQ and general enquiry are 1:1.
| Actual state/value | Meaning |
| --- | --- |
| open | Accepts eligible quotes/selection only while expires_at>now(); raw open alone is insufficient. |
| closed | Supplier selected; enquiry handoff, not a sale/order/payment. |
| expired | Cleanup persisted expiry; raw open may already be temporally expired. |
| cancelled | Owner cancelled; outstanding sent quotes rejected. |
**Composite truth:**
- _product_rfq_enabled = product_rfq AND latest _shops_products_enabled (products and guest gate); product_enquiries is not a general RFQ parent, but supplier selection additionally requires it.
- create_rfq requires authenticated UID, not a separately asserted customer-role enum. SQL validates active category, title/location/date/items/specs, and requires at least one recipient.
- Routing: verified shops in requested category; not the same owner UID; valid shop coordinates; distance <= that shop's delivery radius; needs_delivery additionally requires offers_delivery; nearest/id order, max 10.
- needed_by is desired delivery date, not quote expires_at. Raw state and temporal eligibility must be displayed separately; UI must not claim a read persisted expired.
- Supplier list: current live open RFQs OR r.updated_at within 30 days; returns both rfq_status and latest my_outcome, not a universal combined enum.
- Current all participant read helpers/read RPCs depend on capability flags. Current cancellation also does; MK-F04 records explicit requirement change, including the existing contrary test expectation.
| Transition | Actor / predicate / command / effect |
| --- | --- |
| 1 | Authenticated UID -> open via create_rfq, complete validated items and routed recipients; no partial RFQ if no eligible shops. Notifications queued to routed shop owners. |
| 2 | RFQ customer/open/live -> closed via select_supplier_quote on sent/live quote; other sent quotes rejected; command returns actual enquiry ID; no payment. |
| 3 | RFQ customer/raw open -> cancelled via cancel_rfq; all sent quotes -> rejected; locks RFQ; current function requires effective RFQ flag and queues no cancellation notification. |
| 4 | service_role -> expired via expire_rfqs for raw open whose expires_at passed, skip-locked rows; qualifying sent quotes expire. Function has no feature gate, preserving expiry cleanup. |
| 5 | No implemented reopen, admin RFQ state edit or product-order transition. Admin uses aggregate read only. |
| Role / scenario | Sees | Allowed | Denied | Readback / other-role update |
| --- | --- | --- | --- | --- |
| RFQ customer — Same RFQ PK open -> select or cancel | Own request/items and all nonwithdrawn current/historic comparisons | Select eligible sent offer; cancel own open request | Read another customer's RFQ; change recipients or money totals | get_rfq status matches supplier list rfq_status and admin dashboard; selected quote outcome agrees |
| Recipient shop owner/manager — Same RFQ PK for explicit shop_id | Item/requirement/location summary and own shop's quote | Send/revise while verified/live/authorized | Read competing supplier terms or customer coordinates/ID through business DTO | Customer compare sees real new quote version; supplier list/detail must agree |
| Staff — Active assigned recipient | Same routed request and authorized own-shop work | Read only for quote send | Send quote; select/cancel customer request | Focus/pull reads outcome; membership revocation denies |
| Administrator — Same RFQ represented in recent dashboard | Aggregate/recent summary, not automatic owner detail privilege | Read/refresh | Use customer select/cancel by admin status alone | Dashboard counts/recent state read back current rows |
| View | Read | Write | Actual refresh |
| --- | --- | --- | --- |
| S75 create | Active product category schema | create_rfq | Navigate to returned id on success; retain form on error |
| S73 customer | get_rfq/compare_rfq_quotes | select_supplier_quote/cancel_rfq | Focus/pull; cancel reload; selection -> returned enquiry |
| S52/S74 supplier | list_my_supplier_rfqs/get_supplier_rfq_for_business with explicit shop_id | Manager-minimum send_supplier_quote_for_business | Focus/pull list, focus detail, replace list after send |
| S27 admin | admin_rfq_dashboard | None | Focus/pull |
**Evidence:** `supabase\migrations\0050_rfq.sql:7-97`; `supabase\migrations\0050_rfq.sql:99-191`; `supabase\migrations\0050_rfq.sql:211-309`; `supabase\migrations\0050_rfq.sql:311-341`; `supabase\migrations\0050_rfq.sql:583-629`; `supabase\migrations\0050_rfq.sql:631-665`; `supabase\migrations\0050_rfq.sql:667-709`; `supabase\migrations\0050_rfq.sql:730-742`; `supabase\migrations\0053_activity_contracts.sql:3-34`; `supabase\migrations\0052_merchant_staff.sql:520-589`; `supabase\migrations\0070_nearo_r1.sql:13-16`; `supabase\migrations\0074_p1b_rfq.sql:3-58`; `supabase\migrations\0074_p1b_rfq.sql:285-306`; `supabase\migrations\0074_p1b_rfq.sql:309-343`; `app\src\features\rfq\api.ts:1-154`; `app\src\features\rfq\api.ts:164-247`; `supabase\migrations\0087_ui_redesign_flags_guest_read.sql:1-57`; `supabase\tests\p1b.test.mjs:407-424`
**Not observed:** Expiry invocation schedule and current stored rows unverified. No inferred notification on cancellation.

### supplierQuote — present
**Identity / keys:**
- supplier_quotes.id UUID PK; rfq_id/shop_id FKs; UNIQUE(rfq_id,shop_id,version)
- Unique one sent per(rfq_id,shop_id); unique one selected per rfq_id
- supplier_quote_items.id PK; UNIQUE(quote_id,rfq_item_id)
- RFQ item identity is not a product_id, brand name or assumed product equivalence
**Canonical stored/read fields:**
- version int>0,status sent|withdrawn|selected|rejected|expired,valid_until
- delivery_charge_paise bigint>=0,delivery_days NULL or0..365,notes<=2000,subtotal_paise/gst_paise/total_paise bigint>=0,created_at,updated_at
- Quote item: rfq_item_id,brand/model<=80,specs object,unit_price_paise bigint,quantity numeric(12,3),gst_rate_bp in0/500/1200/1800/2800,available boolean,line_total_paise bigint,created_at
- available line price and delivery each0..1000000000000; nonzero GST requires shop GSTIN; offered_quantity defaults requested and must be requested..2*requested; one line per RFQ item
- Comparison adds requested fields, unavailable_count,complete,arrives_after_needed_by,delivery_terms_missing,brand_differs,specs_missing/missing_spec_keys,specs_differ/differing_spec_keys,quantity_rounded_up.
- Current business detail my_quote returns only sent version id/status/validity/delivery/notes, omitting lines and totals and every terminal quote. This is a current projection gap, not missing quote storage.
| Actual state/value | Meaning |
| --- | --- |
| sent | Current candidate for that shop; usable only before quote/RFQ deadlines and while RFQ open. |
| withdrawn | Earlier sent version replaced by a later version; not current customer comparison. |
| selected | Customer selected supplier into enquiry; not paid or ordered. |
| rejected | Other supplier selected or RFQ cancelled; separate parent RFQ status needed to explain which. |
| expired | Persisted by cleanup after validity or RFQ expiry; temporal expiration may precede this stored value. |
**Composite truth:**
- Send requires effective RFQ parents, verified shop, _acts_for(owner_id,'manager'), routed shop recipient, raw open RFQ with future expires_at, validated complete line set.
- valid_until = least(supplied value or RFQ expiry,RFQ expiry), must be future. UI wrapper sends NULL, using RFQ cutoff.
- Per available line L=round(offered_quantity*unit_price_paise); tax=round(L*gst_rate_bp/10000); unavailable line contributes zero; totals sum per-line values plus delivery. Total <=9007199254740991. Comparison displays these server amounts, not a new client checkout.
- Incomplete/changed-brand/spec/rounded-quantity/delivery-missing or late offers are not automatically equivalent. Current server permits selection of incomplete live offers; redesign must warn, not invent a complete-only rejection rule.
- Current select_supplier_quote checks owner/RFQ/quote state and flags but does NOT recheck shop.status=verified. A sent quote from a suspended shop can create an enquiry even though start_product_enquiry rejects that shop; MK-F05.
- Selection/expiry/cancellation lock RFQ then quote rows; current sender locks shop then RFQ. A new locked shop guard must also normalize sender to RFQ -> shop -> quote to avoid lock inversion.
| Transition | Actor / predicate / command / effect |
| --- | --- |
| 1 | Owner/manager/live recipient -> sent version max(version)+1 via send_supplier_quote_for_business; prior sent -> withdrawn atomically; server stores exact line/tax/total and queues quote-received notification. |
| 2 | RFQ customer/sent live quote + open live RFQ -> selected; other sent -> rejected; RFQ -> closed; enquiry created/reused, no payment. |
| 3 | RFQ customer/cancel raw open -> sent quotes rejected, RFQ cancelled. Do not label every rejected quote merely Not selected without parent explanation. |
| 4 | service_role expiry -> qualifying sent quotes expired; closed/selected records unaffected by expiry loop. |
| 5 | No separate manual withdraw action implemented on assigned UI; withdrawn is the version-replacement outcome. No paid/fulfilled/order statuses. |
| Role / scenario | Sees | Allowed | Denied | Readback / other-role update |
| --- | --- | --- | --- | --- |
| Customer owning RFQ — Same quote PK/version across sent -> selected | Server total/tax/delivery, coverage and every difference flag | Choose while eligible; read history | Edit supplier money or select expired/terminal quote | Same quote selected in comparison and supplier latest outcome; RFQ closed; returned enquiry exists |
| Shop owner/manager — Own quote v1 -> v2 and selected/rejected/expired | Target actual latest own-shop terms/amounts/outcome | Send next version only while permitted | Edit terminal offer or access another shop's quote | v1 withdrawn, v2 sent; customer uses v2; historical terms unchanged |
| Staff — Assigned shop quote | Read-only own-shop quote and RFQ | Read | Send or revise | Read updates on focus/pull; actor identity remains member_id, not owner impersonation |
| Administrator — Quote activity | Counts/averages, not customer/supplier detail authority | Dashboard read | Select supplier by admin status alone | Current nonwithdrawn counts come from dashboard readback |
| View | Read | Write | Actual refresh |
| --- | --- | --- | --- |
| S73 | compare_rfq_quotes | select_supplier_quote | Focus/pull; command returns enquiry id; no temporal invalidation now |
| S52 | latest my_outcome plus current sent quote_status | None | Focus/pull, 30-day history predicate |
| S74 | get_supplier_rfq_for_business current sent-only metadata | send_supplier_quote_for_business | Focus; no own saved item/totals hydrate; target MK-T07 |
**Evidence:** `supabase\migrations\0050_rfq.sql:7-97`; `supabase\migrations\0050_rfq.sql:583-629`; `supabase\migrations\0050_rfq.sql:631-665`; `supabase\migrations\0074_p1b_rfq.sql:3-58`; `supabase\migrations\0074_p1b_rfq.sql:60-175`; `supabase\migrations\0074_p1b_rfq.sql:204-283`; `supabase\migrations\0074_p1b_rfq.sql:285-306`; `supabase\migrations\0074_p1b_rfq.sql:309-343`; `app\src\features\rfq\api.ts:1-154`; `app\app\rfq\merchant\[id].tsx:47-103`; `app\app\rfq\merchant\[id].tsx:104-169`; `app\app\rfq\merchant\[id].tsx:173-270`; `app\src\features\rfq\comparePresentation.ts:12-53`; `app\src\features\rfq\quoteMath.ts:1-24`
**Not observed:** No concurrency execution performed. Lock-order risk is a constraint on the proposed repair, not a claim that the current source was observed deadlocking.

### enquiry — present
**Identity / keys:**
- product_enquiries.id UUID PK
- Current one-open UNIQUE(shop_id,customer_id,coalesce(product_id,zero UUID)) WHERE status=open
- product_id FK ON DELETE SET NULL; shop_id/customer_id FKs
- product_enquiry_messages.id PK; enquiry_id/sender_id FKs; display names and product names are not keys
**Canonical stored/read fields:**
- shop_id,product_id nullable,customer_id,status open|closed,last_message_at,shop_unread int>=0,customer_unread int>=0,created_at
- Message sender_id,from_shop boolean,body length1..2000,created_at; body trimmed by _product_enquiry_post
- Participant DTO: shop_name/product_name,status,both unread counters,last_message_at,from_shop_user,business_role. Customer summary has customer_unread; merchant summary has customer_name/shop_unread.
- Public detail does not expose customer thread/message data. Participant RPCs require actual customer or _acts_for(shop.owner_id,'staff').
- No immutable original-product context currently exists; deletion NULL changes current natural key. MK-T26 adds a private immutable context to preserve rather than close/merge open history.
| Actual state/value | Meaning |
| --- | --- |
| open | Participant can reply subject to effective enquiry capability; one open thread per current key. |
| closed | Readable history; no message post; customer/actual owner can request reopen, subject to unique-open constraint. |
**Composite truth:**
- Latest enquiry capability = products AND product_enquiries AND guest helper. All current read helpers/list/get/messages/mark read are also gated; target read-only history separates actor scope from new-work capability.
- start_product_enquiry requires auth UID, verified shop, not actual shop owner; optional product must belong to shop and be active. It currently omits active category and shop-category mapping checks present in get_product (MK-F06).
- Start locks shop and reuses an existing open same-key thread; otherwise creates it; _product_enquiry_post appends actual sender and updates business/customer unread.
- From shop: shop_unread=0,customer_unread+=1. From customer: shop_unread+=1,customer_unread=0. mark_enquiry_read clears only viewer side; staff shares the business-side count.
- send_enquiry_message permits actual customer or active staff-minimum business actor; _product_enquiry_post rejects closed thread. Suspension does not erase existing conversation or add a new reply ban.
- set_product_enquiry_status permits actual customer or actual shop owner only, not manager/staff; only open/closed text values; reopen may fail current unique index.
- Supplier selection creates/reuses an open general-shop thread (product_id NULL); several RFQs can share one general thread. No RFQ:enquiry 1:1 invariant.
- Latest hard product deletion can collide open-thread keys; existing ws3 test proves intent to preserve open history. Repair must not auto-close or merge conversations to avoid the collision.
| Transition | Actor / predicate / command / effect |
| --- | --- |
| 1 | Authenticated non-owner customer -> open via start_product_enquiry, effective parents and valid shop/product; reuse current open same-key record; post initial message and notification. |
| 2 | RFQ selection -> existing/new open general enquiry via select_supplier_quote; post selection/no-payment coordination message and return enquiry ID. |
| 3 | Customer/business owner/manager/staff open -> open via send_enquiry_message; business role checked server-side; unread and last_message_at update. |
| 4 | Customer or actual owner open -> closed or closed -> open via set_product_enquiry_status; staff/manager denied; unique-open invariant protects duplicates. |
| 5 | Customer or authorized business member -> viewer unread zero via mark_enquiry_read, without altering counterpart counter/status. |
| 6 | Product delete -> product_id NULL if current unique key permits; messages and enquiry ID preserved. Target immutable context fixes collisions without changing history status. |
| Role / scenario | Sees | Allowed | Denied | Readback / other-role update |
| --- | --- | --- | --- | --- |
| Customer participant — Same enquiry PK open -> closed -> reopen | Own/shop messages, actual state and own unread | Reply while open, close/reopen if no active twin, mark customer side read | Other customer's thread or closed reply | Merchant list/detail after focus/pull sees same status/message; shop_unread unaffected by customer mark-read |
| Actual owner — Same enquiry PK | Business-side messages/unread and customer context | Reply open, close/reopen, mark business side read | Other shop by guessed id | Customer refresh sees real closure/reply; same persisted ID |
| Active manager/staff — Same enquiry open vs closed | Authorized team-side conversation | Read/reply open; mark shop side read | Close/reopen or bypass closed-state send | Owner/customer can read same appended message; closed explanation names permitted actor |
| Guest/outsider/admin not participant — Any guessed enquiry PK | No private thread/messages | None | Read/write by public shop visibility or admin role alone | Denied even after feature-off historic-read repair |
| View | Read | Write | Actual refresh |
| --- | --- | --- | --- |
| S45 | get_product_enquiry/list_product_enquiry_messages then mark_enquiry_read | send_enquiry_message/set_product_enquiry_status | Focus/local write load; target pull/foreground and collision-safe reopen readback |
| S50 | list_shop_product_enquiries, all authorized businesses | None | Focus/pull |
| S77 | list_my_product_enquiries, own customer, first five shown | None | Focus/pull; guest read returns empty safely |
| S58/S76/S73 | Public product/shop or own RFQ | Start enquiry/select quote | Route to actual returned enquiry ID |
**Evidence:** `supabase\migrations\0049_shops_catalogue.sql:9-140`; `supabase\migrations\0049_shops_catalogue.sql:921-996`; `supabase\migrations\0049_shops_catalogue.sql:1044-1063`; `supabase\migrations\0049_shops_catalogue.sql:1090-1103`; `supabase\migrations\0052_merchant_staff.sql:520-589`; `supabase\migrations\0052_merchant_staff.sql:591-648`; `supabase\migrations\0052_merchant_staff.sql:650-724`; `supabase\migrations\0050_rfq.sql:583-629`; `supabase\migrations\0087_ui_redesign_flags_guest_read.sql:1-57`; `supabase\migrations\0087_ui_redesign_flags_guest_read.sql:919-955`; `supabase\migrations\0069_ws3_shop_product_remediation.sql:90-110`; `app\app\enquiry\[id].tsx:18-75`; `app\app\enquiry\[id].tsx:75-130`; `app\app\merchant-enquiries.tsx:15-53`; `app\app\shop\index.tsx:21-109`
**Not observed:** No active conversation or push delivery observed. No inferred per-staff unread state or automatic cross-role realtime subscription.

## Seven card contracts
### service
**Current:** CatalogueSections.CategoryTile; ArchetypeCategory -> PackageCard for fixed/time/proposal; inspect branch -> provider cards
**Identity:** Category.id/slug for service discovery; package.id and provider_service_id for an actual offering. Grouping parent with archetype NULL is not a bookable service.
**Information order:** Category icon or real package identity → Service/package title → Applicable archetype action → Package amount/price_type/unit or explicit inspect visit fee → Only relevant duration/inclusions/turnaround → Provider/trust/rating when a real provider is represented → One contextual action; expanded full terms
**Current truth / retain:** Retain existing archetype router, real terms and canPayInstantly. Current generic top-rated pricing ignores archetype; unified search includes grouping parents; package catalogue lacks selected-city filter.
**Exact changes:**
- Exclude NULL-archetype grouping rows from search service results.
- Keep inspect Book/Schedule, fixed/time positive-fixed package action and nonfixed targeted proposal distinct.
- Pass selected city into existing package API and maintain provider/package IDs.
- Reuse packageDisplayPrice/canPayInstantly; include unit and preserve all expanded inclusions/exclusions/deliverables without applying creator-only metadata to every service.
**States:** Category live/unavailable in selected city; inspect_quote/fixed/time_based/proposal; price_type fixed|range|from|quote; Active package with effective public provider visibility; Provider paused/on-leave distinct from online presence
**Role/action contract:**
- Public viewer: choose existing category/package; sign in before authenticated action.
- Customer inspect: book selected provider_service_id; offline permits scheduling, not guaranteed immediate slot.
- Customer package: instant only for fixed positive price; otherwise targeted proposal.
- Owner preview: view terms, no public commit footer.
- Unavailable family/category/provider: no new-work CTA.
**Loading / empty / responsive:** Category/package skeleton, recoverable read error and genuine zero packages are distinct. At narrow widths title/price/unit wrap without truncating meaning; long terms expandable, action stays visible. Do not invent service imagery.
**Assertions:**
- MK-CARD-service-archetypes: four archetypes produce correct route/action and no universal visit-price label.
- MK-CARD-service-price: fixed/range/from/quote keep correct unit and no direct payment for nonfixed.
- MK-CARD-service-city: cross-city packages absent; grouping parent never bookable.
- MK-CARD-service-small: 320px/200% text retains title, price semantics and primary action.
**Evidence:** `app\src\features\catalogue\CatalogueSections.tsx:11-78`; `app\src\features\catalogue\ArchetypeCategory.tsx:15-65`; `app\src\features\catalogue\ArchetypeCategory.tsx:69-162`; `app\src\features\booking\packages\PackageCard.tsx:9-90`

### provider
**Current:** ProviderCard -> ListingCard; inline category ListingCard; TopRatedCard/TopRatedRow; HomeV2 inline ListingCard
**Identity:** providers.id for person/profile; provider_services.id for chosen service. Human name/city is not identity.
**Information order:** Avatar/name and server-backed trust → Chosen service/category/archetype → Effective response/leave state, not a free-slot promise → Rating plus count → Location/distance and relevant experience/jobs → Archetype-correct price meaning → Primary profile/booking action; secondary context
**Current truth / retain:** Verified is currently supplied as a constant by several components, but search_providers and direct provider RLS filter through _provider_is_live: this is not fabricated verification. Top-rated projection loses archetype and leave truth; profile hero conflates bank-ready mark with general Verified semantics owned by identity audit.
**Exact changes:**
- Keep trust provenance; consume identity-auditor canonical public trust/readiness, never query private provider_documents/provider_payout_accounts or actual payout identifiers.
- Extend public ranked-card projection with archetype price summary and effective availability; no proposal-from-zero or leave-as-online.
- Reuse ListingCard/ProviderCard and typed price helpers, not separate role-specific labels.
- Keep explicit actual provider_service_id/package.id through action.
**States:** Live filter: kyc verified + admin approved + not suspended/deactivated + submitted + an active docs-eligible service; Paused or current leave blocks relevant new-booking action but not reading profile; Online means response presence, not bookable time slot; Owner preview is a separate presentation context
**Role/action contract:**
- Public: open real provider profile.
- Inspect customer: Book/Schedule for actual service ID.
- Proposal customer: request brief to actual provider, no visit payment.
- Package customer: selected own package flow, not restart at all providers.
- Unavailable/unknown temporal eligibility: explain/refresh, do not infer availability from a failed read.
**Loading / empty / responsive:** Avatar fallback without a fictitious portrait; current rating/count retained; skeleton/empty/error distinct. Narrow row can wrap service/price semantics; action and availability reason remain readable.
**Assertions:**
- MK-CARD-provider-filtered-trust: unapproved/suspended/non-live excluded; no private fields requested.
- MK-CARD-provider-price: proposal/fixed/session/inspect have correct labels; zero legacy visit_fee never implies free proposal.
- MK-CARD-provider-leave: same provider ID agrees across search/top-rated/home/profile.
- MK-CARD-provider-unknown: paused detail plus failed secondary read cannot enable booking.
**Evidence:** `app\src\components\ProviderCard.tsx:82-129`; `app\src\components\TopRatedCard.tsx:11-209`; `app\src\components\market\ListingCard.tsx:31-133`; `app\src\lib\supabaseApi.ts:145-186`

### shop
**Current:** ShopMarketplaceScreen inline Card; unified search ListingCard; ShopDetailScreen summary; merchant/admin status cards are private projections, not public cards
**Identity:** shops.id; category_slugs display only; no shop-name uniqueness assumption.
**Information order:** Storefront fallback icon and shop name → Verified-shop provenance from filtered public read → Area/city and actual distance when returned → Readable active category labels → Pickup/delivery terms actually supported → Open shop; contextual Ask shop only when permitted
**Current truth / retain:** Retain truthful fields: no shop image, opening-hours, shop rating or stock count exists in public DTO. search_shops/get_shop filter verified; public status/reason/GSTIN/owner ID need not be exposed. Guest address/coordinates are explicitly redacted.
**Exact changes:**
- Use a shared shop card presentation over ShopResult, not an admin ShopStatus object.
- Show readable categories and fulfillment; do not fabricate stars, Open now, photos or third-party verification.
- General enquiry composer contextual, below catalogue priority.
- Gate commit by sign-in, self-shop safe eligibility and effective enquiry parents; keep public guest projection redaction.
**States:** Public row present only if effective products and verified shop; Verified with zero products is valid; Pickup/delivery booleans independent; Suspended/re-review/rejected/draft shop absent publicly; owner/admin private views retain state/reason
**Role/action contract:**
- Public viewer: open actual shop ID.
- Authenticated non-owner: start general enquiry if parents ON.
- Guest: sign in before enquiry; no private account fields.
- Actual owner: manage shop rather than self-enquire.
- Admin: private status actions belong admin review card, not public listing.
**Loading / empty / responsive:** Storefront fallback, not invented media. Compact wrapped name/location/fulfillment; no empty decorative image band. Retry vs genuine no verified shops, and public absence vs network failure, remain distinct.
**Assertions:**
- MK-CARD-shop-trust: same verified shop ID listed/detail; suspension removes both.
- MK-CARD-shop-guest: address/coordinates redacted; no owner/GST/reason fields.
- MK-CARD-shop-no-fiction: no fabricated hours/stars/photo.
- MK-CARD-shop-actor: guest sign-in and owner self-enquiry suppression; server still enforces.
**Evidence:** `app\app\shop\index.tsx:21-109`; `app\app\shop\[id].tsx:21-99`; `app\src\features\search\SearchScreen.tsx:161-225`; `app\src\features\shops\api.ts:4-137`

### product
**Current:** ShopProductCard + IndicativePrice in products/shop catalogue; generic ListingCard in unified search; detail own Card
**Identity:** products.id, shop_id, category_id. Brand/model/title are descriptive, not keys.
**Information order:** First real signed image or explicit no-photo fallback → Product name → Brand/model and real shop → Indicative price per explicit unit; NULL ask-price distinct from zero → Price updated date and confirmation qualifier → Stock warning/availability → Distance or area when returned → Open product; permitted enquiry on detail
**Current truth / retain:** Existing ShopProductCard preserves money/stock semantics; unified search discards them and labels amount From. Product is catalogue/enquiry, not inventory reservation or order.
**Exact changes:**
- Reuse ShopProductCard/IndicativePrice in unified search instead of maintaining a second price formatter.
- Resolve signed image using existing signedProductImage; fall back on signing failure.
- Do not hide out-of-stock products except explicit inStockOnly filter; keep availability enquiries.
- Make Ask shop contextual/sticky on long detail, not Buy/Add to cart.
- Keep stock/listed/category/shop status separate.
**States:** active/in_stock two independent booleans; Price NULL/zero/positive; Public visibility requires verified shop/active category/mapping; Hidden/deleted product is unavailable, not a network error; Shop verification is not product-quality certification
**Role/action contract:**
- Public: open detail/shop.
- Customer: enquiry if effective parents and safe eligibility.
- Actual owner: catalogue edit through owner screen; no self-enquiry.
- Manager/staff: no owner price/catalogue write by membership alone.
- No role: cart, checkout, stock reservation or product payment.
**Loading / empty / responsive:** Real 76px image/fallback in current row; support wrapped title/unit/qualifier at 320px and large text. Preserve unit and stock if compacting; empty only after successful current-scope read.
**Assertions:**
- MK-CARD-product-parity: same product PK has same price/unit/age/stock in search/products/shop/detail.
- MK-CARD-product-price-null-zero: ask-price vs zero explicit, no implied free checkout.
- MK-CARD-product-unavailable: stock false visible warning; active false or category/shop hidden excluded.
- MK-CARD-product-image-error: signed URL failure gives fallback, not fictitious photo.
**Evidence:** `app\src\features\shops\components.tsx:1-89`; `app\src\features\shops\format.ts:1-18`; `app\src\features\search\SearchScreen.tsx:161-225`; `app\app\product\[id].tsx:21-89`

### creator
**Current:** CreatorsScreen category Card; ProposalCategory ProviderCard and PackageCard; provider profile portfolio
**Identity:** Creator is a provider offering proposal/creator categories, not a separate invented creators table/status. Landing category UUID/slug is not a person's ID.
**Information order:** Landing: category icon/title/action, explicitly a category → Actual creator card: avatar/name/trust → Relevant creator service or real package → Real portfolio preview only when fetched for that provider → Rating/count and location → Actual deliverables/turnaround/revisions/usage rights where present → Request targeted proposal, never a visit-fee purchase
**Current truth / retain:** Landing currently reads categories only and correctly invents no portfolios or follower counts. Empty categories lack explanation. Provider links explicitly state provider-submitted/not OAuth-verified; retain this distinction.
**Exact changes:**
- Keep landing category cards category-specific; don't render fake personal verification or portfolios.
- Use public provider/package card contract once a real creator is loaded.
- Retain explicit social-link disclaimer and actual portfolio file paths; no inferred OAuth verification.
- Successful no-category state offers location/services recovery; no new undefined general brief category.
**States:** creators_landing OFF falls back to existing category drill-down; Catalogue/category availability by city/archetype; Actual creator availability follows provider safe projection; Package price_type and proposal lifecycle remain separate
**Role/action contract:**
- Public landing: choose existing category.
- Customer actual creator/package: targeted /request/new with category/provider/package IDs.
- Owner preview: read own profile, no commit footer.
- Unavailable creator/category: explain; no fabricated sample or direct payment.
**Loading / empty / responsive:** Existing category skeleton/error Retry retained; explicit city empty. Narrow cards wrap full category/name; actual portfolio thumbnails only when available; no decorative blank band.
**Assertions:**
- MK-CARD-creator-category-not-person: no person badge/rating for category result.
- MK-CARD-creator-real-portfolio: absent portfolio means none invented; disclaimer retained.
- MK-CARD-creator-brief: exact targeted IDs and no zero visit-fee sale.
- MK-CARD-creator-off-empty: landing OFF preserves ordinary enabled category path; zero categories explicit.
**Evidence:** `app\src\features\creators\CreatorsScreen.tsx:16-97`; `app\src\features\creators\creatorCategories.ts:1-8`; `app\src\features\catalogue\ArchetypeCategory.tsx:69-162`; `app\src\components\ProviderCard.tsx:82-129`

### rfq
**Current:** MerchantRfqsScreen ListItem; customer detail summary; AdminRfqsScreen recent ListItem
**Identity:** rfqs.id; supplier card context is(shop_id,rfq_id), not RFQ id alone.
**Information order:** Request title and effective RFQ state → Business label on supplier surface → Category/item count and location → Needed-by and delivery need → Quote deadline → Separate quote outcome/coverage context → Permitted detail/prepare/read action; cancellation secondary on customer detail
**Current truth / retain:** Supplier list preserves composite IDs and recent outcomes, but omits shop name and lets rejected quote hide cancelled RFQ. Raw open/sent is not time eligibility. Admin card correctly has no invalid customer-detail action.
**Exact changes:**
- Introduce domain-specific rfqViewState over raw RFQ state, expires_at, quote outcome and safe server eligibility; not a universal enum.
- Show RFQ cancellation/expiry independently from selected/rejected quote outcome.
- Add safe shop_name to supplier list; preserve shop_id route.
- Keep existing 30-day supplier history and authorized history when new capabilities OFF.
- Do not add product-order/sales/fulfillment statuses.
**States:** Raw open|closed|expired|cancelled; Raw open past expires_at -> display deadline passed, no new-work action; do not claim state was persisted; Supplier my_outcome independent of parent; Selected closes RFQ into enquiry, not paid/order
**Role/action contract:**
- Customer owner/open: view/compare, eligible select, cancel own open work even when new feature OFF target.
- Owner/manager recipient: prepare/revise only if verified/live/authorized.
- Staff: read only.
- Admin: aggregate/recent read, not automatic customer owner.
- Outsider: no private RFQ.
**Loading / empty / responsive:** No image needed. Status visible beside title, metadata wraps; needed-by/expiry never truncated into one ambiguous date. Skeleton/error/real empty separate; history reads are not empty capability states.
**Assertions:**
- MK-CARD-rfq-parent-outcome: cancelled + rejected shows both, no Reply.
- MK-CARD-rfq-deadline: raw open past cutoff no send/select.
- MK-CARD-rfq-two-businesses: same RFQ two shops distinct correct routes.
- MK-CARD-rfq-off-history: authorized history/cancel retained, new create/send/select denied.
**Evidence:** `app\app\merchant-rfqs.tsx:15-68`; `app\app\rfq\[id].tsx:104-156`; `app\app\admin\rfqs.tsx:14-63`; `supabase\migrations\0074_p1b_rfq.sql:309-343`

### supplierQuote
**Current:** QuoteCompareTable + detailed horizontal Card, backed by buildComparePresentation; merchant detail lacks saved full quote card
**Identity:** supplier_quotes.id/version plus shop_id/rfq_id; each offered line matches real rfq_item_id, not a guessed catalogue product.
**Information order:** Shop name, version and actual quote outcome → Server total with subtotal/GST/delivery → Coverage and unavailable lines → Brand/spec differences and missing keys → Offered/requested quantity difference → Delivery terms/late warning and validity cutoff → Expandable full terms → One eligible Select supplier or read-only outcome
**Current truth / retain:** Server exact amounts and rich comparison flags already exist. Summary loses changed-spec, rounded-quantity and delivery warnings before selection; duplicate CTA in detailed carousel. Expiry ignored. Merchant saved terminal quote omitted.
**Exact changes:**
- Extend existing buildComparePresentation with every server flag and safe temporal selection predicate.
- Use one offer card/action, show warnings before action, make full lines expandable.
- Keep incomplete live offers selectable as current server allows, but never label them lowest complete equivalent quote.
- Use server money fields and existing comparison helpers; no new client authoritative total.
- Return latest own-shop terms to merchant/staff as read-only when terminal; retain actual version/outcome.
**States:** sent|withdrawn|selected|rejected|expired; Incomplete vs complete is coverage, not lifecycle; Validity/RFQ deadline and current verified shop affect eligibility; Selected is enquiry handoff, not paid/ordered
**Role/action contract:**
- RFQ customer: choose current eligible sent offer; historical states read-only.
- Owner/manager: send next version only while safe can_send_quote; previous sent withdrawn.
- Staff: read saved own-shop quote, no send.
- Other shop/outsider: cannot read competitor private terms.
- No role: Pay now/Place order/Shipment tracking.
**Loading / empty / responsive:** Vertical compact offer cards at narrow widths; do not require horizontal scrolling to discover warnings/action. Status/totals/dates wrap. Real zero quotes is distinct from failure; terminal zero quote copy does not invite future replies.
**Assertions:**
- MK-CARD-quote-warnings-before-action: every critical difference visible before only select.
- MK-CARD-quote-lowest: partial/expired/terminal excluded; stable equal-price ordering retained.
- MK-CARD-quote-money: persisted per-line rounding and total unchanged, no recomputation.
- MK-CARD-quote-history: sent/selected/rejected/expired own terms readable; staff cannot send.
**Evidence:** `app\src\features\rfq\comparePresentation.ts:12-53`; `app\src\components\market\QuoteCompareTable.tsx:27-124`; `app\src\components\market\compareModel.ts:10-29`; `app\app\rfq\[id].tsx:104-156`

## Implementation-ready task table
New SQL migration paths are **UNASSIGNED:MK-SQL-STATE** and **UNASSIGNED:MK-SQL-PUBLIC-CARDS** coordinator claims, never guessed numeric filenames. Historical defining SQL names remain exact. Steps below are implementation work, not future generic audit tasks. All named tests are proposed assertions, **not run**.

| Task / finding / owner / class / review | Exact files and SQL functions | Ordered edits | Acceptance / named test file:case / prerequisites |
| --- | --- | --- | --- |
| MK-T01 / MK-F01 / O31 / A / none | `app\app\admin\shops.tsx`; `app\src\features\shops\shopReviewPresentation.ts`; `app\src\features\shops\__tests__\shopReviewPresentation.test.ts`<br>Functions: admin_set_shop_status: consume current 0064 contract, do not edit it for this UI fix | 1. Add shopReviewActions(status: ShopStatus): ReviewAction[] with action id/label/requiresReason/confirmation intent; current ShopStatusLabel remains label source.<br>2. Mirror existing SQL Verify origins; suspended label Restore verification; no completed same-state transition control. Preserve currently authorized other admin transitions rather than inventing policy.<br>3. Move reason into confirmed destructive action; require trimmed reason for reject/suspend; keep awaited load and source row after mutation. | Verified/draft/rejected never display Verify; submitted/under_review do; suspended displays Restore, not a pending verification claim.; Non-admin RPC still denied; blank reason sends no call; cancelling dialog sends no call.; Same shop PK read by owner/admin/public after approved action agrees; server-denied stale action refreshes, never optimistic success.<br>Tests: `app\src\features\shops\__tests__\shopReviewPresentation.test.ts`: MK-ADMIN-six-state-actions, MK-ADMIN-reason-and-cancel; `e2e\web-smoke.mjs`: MK-ADMIN-same-shop-cross-role-no-verify<br>Depends: None<br>OFF: Applies with every Oorva flag OFF; admin recovery/read remains available when product discovery OFF. |
| MK-T02 / MK-F02 / O38P / A / auth | `UNASSIGNED:MK-SQL-STATE`; `supabase\tests\oorva_marketplace_lifecycle.test.mjs`<br>Functions: submit_shop | 1. Forward-replace latest submit_shop; after actual-owner FOR UPDATE lookup assert state in draft/rejected.<br>2. Retain effective-products/completeness/categories and reason-clear update; do not alter identity-delta save_shop.<br>3. Retain authenticated grants and add latest-chain actor/state assertions. | Actual owner draft/rejected complete -> submitted; owner verified/submitted/under_review/suspended -> denied with row unchanged.; Manager/staff/other owner denied, even if client fabricates owner role.; Verified description-only save remains verified; confirmed identity edit still submitted; parent OFF blocks new submission.<br>Tests: `supabase\tests\oorva_marketplace_lifecycle.test.mjs`: MK-SHOP-owner-submit-allowed, MK-SHOP-reviewed-reset-denied, MK-SHOP-submit-roles-and-parent<br>Depends: None<br>OFF: State guard always applies; capability OFF rejects new submit, not authorized historic reads. |
| MK-T03 / MK-F03 / O27 / A / none | `app\app\merchant-shop.tsx`; `app\src\features\shops\manage\shopManageModel.ts`; `app\src\features\shops\manage\__tests__\shopManageModel.test.ts`<br>Functions: save_product/delete_product existing guards retained | 1. Add shopManageActions({shop,actualOwner,productsEnabled}) with explicit canEditProducts/canSubmit/canSaveDetails; no new universal status enum.<br>2. Use it for Add/Edit/Save product and stale-editor transitions; show suspended reason.<br>3. Keep owner shop-details save preserving suspension and current allowed removal; members stay read-only. | Suspended never has writable product editor; status change while editor open disables save.; Non-suspended actual owner still edits; staff/manager cannot; existing catalogue remains visible.; No new server suspension ban on removal, no bypass of existing save_product guard.<br>Tests: `app\src\features\shops\manage\__tests__\shopManageModel.test.ts`: MK-MANAGE-suspended-product-edit, MK-MANAGE-owner-member-actions, MK-MANAGE-refreshed-suspension<br>Depends: None<br>OFF: A fixes always apply; products OFF gives authorized read-only existing shop/catalogue, no new edit. |
| MK-T04 / MK-F04 / O38P / A / auth | `UNASSIGNED:MK-SQL-STATE`; `supabase\tests\oorva_marketplace_lifecycle.test.mjs`; `app\src\features\shops\api.ts`; `app\src\features\rfq\api.ts`; `app\app\enquiry\[id].tsx`; `app\app\merchant-enquiries.tsx`; `app\app\merchant-rfqs.tsx`; `app\app\merchant-shop.tsx`; `app\app\rfq\[id].tsx`; `app\app\rfq\merchant\[id].tsx`; `app\app\shop\index.tsx`; `app\src\features\activity\UnifiedActivityScreen.tsx`; `app\src\features\activity\model.ts`; `app\src\features\activity\segments\ShopSegment.tsx`<br>Functions: _product_enquiry_participant; _rfq_is_customer; _rfq_shop_recipient; _rfq_can_read; _rfq_quote_can_read; get_product_enquiry; list_product_enquiry_messages; list_my_product_enquiries; list_shop_product_enquiries; mark_enquiry_read; get_my_business_shop; list_my_products; get_rfq; list_my_customer_rfqs; get_supplier_rfq_for_business; list_my_supplier_rfqs; compare_rfq_quotes; cancel_rfq; get_my_activity_unread_counts: shop branches only; mark_my_activity_notification_read: RFQ branch only; _product_image_access: actual-owner historic image read only | 1. Extract participant/owner/recipient identity checks from capability checks in the named read helpers and read RPCs. Retain active membership, merchant_staff switch, exact customer/shop authorization and public guest-private denial.<br>2. Remove capability guard from raw-open owner cancel_rfq and safe mark-read only; retain transactional status/quote update and role/state checks. New create/send/select/reopen/catalogue edits keep capability guards.<br>3. Owner OFF workspace reads existing shop/products without fetching gated active categories or offering editors; public product/shop discovery stays OFF. Allow owner-only _product_image_access(p_manage=false) independent of new-upload capability; new upload/delete storage operations keep original capability/owner checks; public access remains gated.<br>4. Customer/merchant detail/history routes remain read-only OFF. S05 shared services owner applies existing sports-history pattern to hasShopHistory using authorized enquiry/RFQ reads; visibleActivitySegments and ShopSegment must not erase historic rows merely because products OFF.<br>5. Only shop unread branches lose new-capability gates; RFQ notification mark-read remains owner-scoped. Do not alter services/sports/money branches.<br>6. New latest-chain assertions encode required OFF behavior. Existing p1b test is capped at74 and deliberately tests old behavior: either retain it explicitly as historical or upgrade loader+replace conflicting assertion, never claim it validates the new migration. | For each product/enquiry/RFQ parent OFF/child ON: own existing history still readable; outsider and inactive member denied; new create/send/select/edit denied.; Owner cancellation of open RFQ works OFF and rejects sent quotes atomically; other customer and terminal cancel denied.; Shop activity/history remains reachable with all messages already read, not only when unread count>0; own unread/mark-read still consistent OFF.; Public discovery remains hidden; expiry/payment/refund/settlement code unchanged and ungated by cosmetics.<br>Tests: `supabase\tests\oorva_marketplace_lifecycle.test.mjs`: MK-OFF-existing-enquiry-role-matrix, MK-OFF-existing-RFQ-role-matrix, MK-OFF-cancel-owner-not-outsider, MK-OFF-new-work-denied, MK-OFF-shop-unread; `app\src\features\activity\__tests__\model.test.ts`: MK-OFF-read-history-keeps-shop-segment; `e2e\web-smoke.mjs`: MK-OFF-same-entity-history-cancel-private-backend<br>Depends: None<br>OFF: This task defines OFF: deny new capabilities, preserve authorized existing history/read metadata and safe owner cancellation. |
| MK-T05 / MK-F05, MK-F06 / O38P / A / concurrency | `UNASSIGNED:MK-SQL-STATE`; `supabase\tests\oorva_marketplace_lifecycle.test.mjs`; `app\src\features\rfq\api.ts`; `e2e\web-smoke.mjs`<br>Functions: select_supplier_quote; send_supplier_quote_for_business; compare_rfq_quotes; start_product_enquiry; NEW _can_start_product_enquiry(uuid,uuid) | 1. Add internal stable _can_start_product_enquiry(shopId,nullableProductId): boolean: authenticated non-owner, effective enquiry parents, verified shop, optional active product in active mapped category. It cannot be replaced by _shop_is_visible, which lacks actor/product predicates. Revoke direct PUBLIC/anon/authenticated execution; definer read/write RPCs call it.<br>2. Use predicate inside start_product_enquiry after shop lock, preserving general enquiry and stock-false permission.<br>3. Select resolves RFQ/shop ids, locks RFQ -> shop -> quote, rechecks identities/state/verified shop before any quote/RFQ/enquiry write.<br>4. Change sender to same RFQ -> shop ordering; preserve all manager/recipient/GST/quantity/rounding checks.<br>5. Comparison returns can_select and selection_block_reason (closed,rfq_expired,quote_expired,shop_unavailable,feature_off or NULL), with no private shop fields; retain historical rows. | Valid sent quote -> suspend shop -> selection rejected, no state/message/enquiry changes.; Disabled product category or removed mapping -> new product enquiry denied; active mapped out-of-stock item still allowed; existing conversation not erased.; Allowed live partial selection still closes RFQ/opens enquiry without money; non-owner/nonrecipient denials retained.; Two-connection private PostgreSQL send/select/suspend interleavings have consistent lock order and at most one selected; no claim that sequential PGlite proves concurrency.<br>Tests: `supabase\tests\oorva_marketplace_lifecycle.test.mjs`: MK-SELECT-suspended-shop-atomic-denial, MK-ENQUIRY-public-eligibility, MK-SELECT-live-partial-allowed; `e2e\web-smoke.mjs`: MK-SELECT-private-concurrent-revise-select-suspend<br>Depends: None<br>OFF: New start/select/send remains fail-closed under actual capability parents, regardless of Oorva flags; history/cleanup remains safe. |
| MK-T06 / MK-F07, MK-F09 / O19 / A / money | `app\src\features\rfq\rfqStateModel.ts`; `app\src\features\rfq\components.tsx`; `app\src\features\rfq\comparePresentation.ts`; `app\src\features\rfq\__tests__\comparePresentation.test.ts`; `app\src\features\rfq\__tests__\rfqStateModel.test.ts`; `app\app\rfq\[id].tsx`; `app\app\merchant-rfqs.tsx`; `app\app\rfq\merchant\[id].tsx`; `app\app\admin\rfqs.tsx`; `UNASSIGNED:MK-SQL-STATE`<br>Functions: admin_rfq_dashboard safe deadline projection/effective count; compare_rfq_quotes safe action projection from MK-T05 | 1. Add rfqViewState input/output contract specified in MK-F07; current RfqStatusLabel maps raw enum only and cannot represent parent+outcome+deadline, so it consumes this domain-specific helper rather than inventing a universal status.<br>2. Extend existing buildComparePresentation options with rfqExpiresAt/nowMs and safe can_select; warnings include every server difference/coverage/delivery flag before action.<br>3. Remove duplicated carousel selection/cheapest logic; one offer with expandable full lines, one eligible action. Keep server money fields and existing getLowestQuoteId/stable sorting.<br>4. Set one timeout for nearest relevant deadline strictly greater than now to re-read eligibility; no timer for already expired rows and no zero-delay reload loop. Cleanup on context/blur; focus/pull also reload.<br>5. Supplier list shows parent RFQ and quote outcome separately; terminal/no-quote copy never invites new reply.<br>6. Admin dashboard recent projection includes expires_at; effective Open filters both raw open and deadline. Expose raw status/deadline explanation, do not claim a read persisted expiry. | Fixed clock before/at/after RFQ and quote cutoffs: Send/Choose/lowest agree with eligibility.; Live incomplete offer allowed with clear coverage, never lowest complete; changed specs/qty/delivery warnings precede sole selection.; Cancelled+rejected and expired+expired show both facts; selected preserved; exact server subtotal/GST/delivery/total unchanged.; All correctness remains with Oorva OFF; no new order/paid state.<br>Tests: `app\src\features\rfq\__tests__\rfqStateModel.test.ts`: MK-RFQ-deadline-boundaries, MK-RFQ-parent-outcome-labels; `app\src\features\rfq\__tests__\comparePresentation.test.ts`: MK-COMPARE-all-warnings-before-action, MK-COMPARE-expired-lowest, MK-COMPARE-partial-live-permission; `supabase\tests\oorva_marketplace_lifecycle.test.mjs`: MK-ADMIN-effective-open-deadline<br>Depends: MK-T05, MK-T07<br>OFF: Always-correct status/amount/action presenter; disabled new selection remains hidden while historic comparison readable. |
| MK-T07 / MK-F08 / O38P / A / auth | `UNASSIGNED:MK-SQL-STATE`; `app\src\features\rfq\api.ts`; `app\src\features\rfq\supplierQuoteModel.ts`; `app\src\features\rfq\__tests__\supplierQuoteModel.test.ts`; `app\app\rfq\merchant\[id].tsx`<br>Functions: get_supplier_rfq_for_business | 1. JSON readback adds category_id/shop_name, latest own quote of any stored outcome with item IDs/brand/model/specs/quantity/GST/availability/line totals, aggregate amounts/delivery/notes/validity/version.<br>2. Add safe can_send_quote and send_block_reason using actual role, verified shop, RFQ raw state/deadline and effective parents; keep recipient/member access and no competing terms/customer coordinates.<br>3. supplierQuoteModel hydrates UI strings from saved paise/quantity without recomputing persisted money; contextKey=rfq.id+shop_id, revisionKey=latestQuote.id/version.<br>4. Preserve dirty same-context draft on refetch; reset on context switch. Category schema by category_id, never name.<br>5. Render terminal quote as saved read-only terms; only eligible state gets editor/send, including input editability. | For same quote PK all roles authorized to see it agree on version/status/line quantities/server total.; Selected/rejected/expired retained; manager/staff read own only; staff no Send.; Duplicate category names cannot choose wrong schema; two-context navigation never sends old rfq_item_id.; No-GSTIN UI offers zero only; server tax/quantity checks unchanged.<br>Tests: `supabase\tests\oorva_marketplace_lifecycle.test.mjs`: MK-SUPPLIER-latest-terminal-own-read, MK-SUPPLIER-cross-shop-denial, MK-SUPPLIER-can-send-state-role; `app\src\features\rfq\__tests__\supplierQuoteModel.test.ts`: MK-SUPPLIER-hydrate-real-version, MK-SUPPLIER-context-reset-dirty-preserve, MK-SUPPLIER-category-id<br>Depends: None<br>OFF: Read-only existing quote remains; new send/revise disabled; staff revocation remains effective. |
| MK-T08 / MK-F10 / O12 / A / none | `app\src\features\search\searchModel.ts`; `app\src\features\search\__tests__\searchModel.test.ts`<br>Functions: No SQL change | 1. Apply local name matching only to kinds whose source was fetched without full-text query; preserve server product membership/order.<br>2. Filter out category.archetype===null before grouping; keep creators split using real catalogue family model.<br>3. Make existing category fixtures complete with nonnull archetype; retain five-result cap and case/normalization behavior. | Server brand/model/description match with unrelated product name appears.; Grouping parent omitted; service/creator category actual route preserved.; Existing scope/normalization/cap tests still assert real behavior.<br>Tests: `app\src\features\search\__tests__\searchModel.test.ts`: MK-SEARCH-preserve-server-product-match, MK-SEARCH-no-group-parent, MK-SEARCH-scope-cap-order<br>Depends: None<br>OFF: Fix applies whenever existing unified_search is enabled, independent of Oorva flag; unified_search OFF still performs no requests. |
| MK-T09 / MK-F11 / O12 / A / none | `app\src\features\search\SearchScreen.tsx`; `app\src\features\search\__tests__\SearchScreen.test.tsx`<br>Functions: No SQL change | 1. Replace product renderResult generic ListingCard with existing ShopProductCard and actual SearchProduct.<br>2. Resolve first image via signedProductImage in scope-cleaned result-image effect; tolerate failures as real fallback, not missing rows.<br>3. Keep category/shop/activity rendering independent; no new indicative formatter or money engine. | Same PK price/unit/update qualifier/stock equal across unified search and existing product components.; NULL/zero/box/sqft and stock false explicit; image failure fallback; no Buy/Cart.; Typing new query cannot apply old query image/result to current product.<br>Tests: `app\src\features\search\__tests__\SearchScreen.test.tsx`: MK-SEARCH-product-price-stock-contract, MK-SEARCH-product-image-fallback, MK-SEARCH-product-query-cleanup<br>Depends: None<br>OFF: All Oorva flags OFF still gets correct product truth; products OFF has no product requests/results. |
| MK-T10 / MK-F12 / O12 / A / none | `app\src\features\search\SearchScreen.tsx`; `app\app\products.tsx`; `app\app\merchant-shop.tsx`; `app\src\features\search\__tests__\SearchScreen.test.tsx`; `app\src\features\shops\manage\__tests__\shopManageModel.test.ts`<br>Functions: Existing server parent/auth gates retained | 1. Build scope options from actual effective products/sports, not unconditional enum; reset disappearing selected scope.<br>2. Product AI conjunction includes build availability,products,ai_assistant,ai_product_search; don't assume FEATURE_PARENTS contains it.<br>3. Gate only staff/RFQ discovery links by their existing capabilities; history entry behavior supplied by MK-T04, not removed here. | Parent OFF/child ON produces no invalid chip/AI/link/call.; Other enabled family/manual search and owner capabilities still work.; Oorva OFF does not suppress these correctness fixes.<br>Tests: `app\src\features\search\__tests__\SearchScreen.test.tsx`: MK-GATE-scope-off-reset, MK-GATE-AI-parent-off; `app\src\features\shops\manage\__tests__\shopManageModel.test.ts`: MK-GATE-staff-RFQ-links<br>Depends: None<br>OFF: Actual capability parent/child semantics govern new work; cosmetic leaves have no authorization role. |
| MK-T11 / MK-F13 / O18 / A / auth | `UNASSIGNED:MK-SQL-STATE`; `app\src\features\shops\api.ts`; `app\app\product\[id].tsx`; `app\app\shop\[id].tsx`; `app\app\products.tsx`; `app\src\features\shops\__tests__\customerActions.test.tsx`<br>Functions: get_product/get_shop additive can_enquire and enquiry_block_reason projection using MK-T05 predicate | 1. Keep public DTO redaction; add safe can_enquire plus reason sign_in/own_shop/feature_off or NULL. If changing RETURNS TABLE, DROP/recreate exact RPC signature in forward migration and restore explicit grants; never broaden columns.<br>2. Guest sees Sign in to ask shop (or use AI) before editable private message/AI composer. Call existing requireSignIn with safe route; do not put message/address/account data in URL.<br>3. Authenticated non-owner gets existing composer; owner gets Manage shop instead of self-enquiry; server remains ultimate authority.<br>4. No new private draft-storage system: guest cannot enter a draft before sign-in; preserve authenticated same-context draft on ordinary retry. | Guest mutation/invocation count remains zero before auth and returns to correct browse route.; Own-shop send suppressed and direct SQL still denied; authorized customer and out-of-stock enquiry allowed.; No owner_id/GSTIN/admin reason/private payout data appears in public read; guest address/coordinates remain redacted.<br>Tests: `app\src\features\shops\__tests__\customerActions.test.tsx`: MK-ACTOR-guest-sign-in-before-composer, MK-ACTOR-owner-manage-not-enquire, MK-ACTOR-customer-allowed; `supabase\tests\guest_read_access.test.mjs`: MK-ACTOR-safe-public-action-projection<br>Depends: MK-T05<br>OFF: No new enquiry/AI when capability OFF; sign-in handoff doesn't bypass server; existing history unchanged. |
| MK-T12 / MK-F14 / O14 / A / auth | `UNASSIGNED:MK-SQL-PUBLIC-CARDS`; `app\src\lib\supabaseApi.ts`; `app\src\lib\apiTypes.ts`; `app\src\lib\demo\demoApi.ts`; `app\src\components\providerCardModel.ts`; `app\src\components\TopRatedCard.tsx`; `app\src\features\home\HomeV2.tsx`; `app\app\top-rated.tsx`; `app\src\components\__tests__\providerCardModel.test.ts`<br>Functions: NEW list_top_rated_public(p_city text,p_limit int) | 1. O38I supplies bounded safe RPC reusing existing canonical helpers. Output: id,city,rating_avg/rating_count,jobs_completed,years_experience,effective is_online,on_leave_until,profiles(full_name,avatar_url), active public provider_services with id/category archetype/name/slug/visit_fee/skill_level and package price_type/price/min/max/unit. No private readiness fields.<br>2. Apply guest helper, canonical live/bookable eligibility, exact normalized city, exclude auth.uid, rating_count>0, same avg/count sort and bounded limit; current leave suppresses Online but does not fabricate a booked slot.<br>3. Existing listTopRated facade maps typed DTO; update TopRatedProvider/Service and demo shape. Extend existing providerCardModel to accept archetype price summary rather than duplicate helpers.<br>4. Reuse presenter in home and TopRatedCard/Row; proposal quote-per-brief, inspect explicitly visit fee, fixed/session real public package price_type/unit.<br>5. Deterministic generic-card headline: order public services by existing category.sort_order then provider_service.id; lead is first, plus count of others. For that service only: inspect uses labelled visit fee, proposal uses quote-per-brief, fixed/time uses first public package by sort_order/id with its price_type and unit. Never minimize amounts across different units/archetypes; no package -> No packages listed and View profile, not a fictional free offer. Show selected city and rating-based rank in header. | Mixed archetype fixtures cannot render proposal-from-zero or wrong visit-fee package price.; Same provider on current leave consistent across public profile/search/ranking/home; filtered trust remains legitimate.; Header identifies selected city and rating ordering, not uncomputed distance ranking.; Public safe columns only; city/self/rating/limit behavior retained; demo not asserted as production verification.<br>Tests: `app\src\components\__tests__\providerCardModel.test.ts`: MK-PROVIDER-archetype-price, MK-PROVIDER-leave-presence, MK-PROVIDER-mixed-units-stable-headline; `supabase\tests\guest_read_access.test.mjs`: MK-PROVIDER-ranked-public-columns, MK-PROVIDER-ranked-eligibility-city-self; `e2e\web-smoke.mjs`: MK-PROVIDER-no-proposal-zero-price<br>Depends: None<br>OFF: Correct ranked data regardless of Oorva identity/layout; guest_browse OFF denies anon, signed-in reads keep actual role/capability rules. |
| MK-T13 / MK-F15 / O14 / A / none | `app\src\features\catalogue\api.ts`; `app\src\features\catalogue\ArchetypeCategory.tsx`; `app\src\features\catalogue\__tests__\api.test.ts`<br>Functions: Existing public provider/service/package RLS | 1. Require listCataloguePackages(categorySlug,city) and pass location.city from fixed/time and proposal branches.<br>2. Use nested providers!inner and exact escaped case-insensitive city filter; return city in typed card context.<br>3. Keep current active package/service and public RLS; don't use private onboarding data to evaluate eligibility. | Isolated city A/B provider packages in same category only return selected city.; City text with LIKE metacharacters is escaped; no nullable parent embed bypass.; No cross-city card after location change; unavailable category/provider remains absent.<br>Tests: `app\src\features\catalogue\__tests__\api.test.ts`: MK-PACKAGE-city-inner-filter, MK-PACKAGE-city-escaping, MK-PACKAGE-public-projection; `e2e\web-smoke.mjs`: MK-PACKAGE-two-city-visible-result<br>Depends: None<br>OFF: Same correct city in legacy/Oorva compositions; capability/archetype OFF still denies new work. |
| MK-T14 / MK-F16 / O14 / A / none | `app\src\features\providerProfile\ProviderProfileScreen.tsx`; `app\src\features\providerProfile\ProviderServicesSection.tsx`; `app\src\features\providerProfile\model.ts`; `app\src\features\providerProfile\__tests__\model.test.ts`<br>Functions: Existing booking/proposal endpoints untouched | 1. Model selected service/package together; reset invalid package on provider/service/readback change.<br>2. Render actual own packages as choices; reuse PackageCard/packageDisplayPrice/canPayInstantly, not a new price rule.<br>3. Route positive fixed exact IDs to existing book path; nonfixed exact provider/category/package to request/new; no generic Book when package missing. | Two providers in same category: profile A never routes to provider B or all-provider category as the Book outcome.; All four price types correct; paused/unknown/preview has no invalid commit.; Existing inspect/proposal service behavior and server money untouched.<br>Tests: `app\src\features\providerProfile\__tests__\model.test.ts`: MK-PROFILE-package-exact-route, MK-PROFILE-nonfixed-targeted-brief, MK-PROFILE-selection-reset<br>Depends: None<br>OFF: Provider intent and valid route fixed with Oorva OFF; no bypass of booking capability/readiness. |
| MK-T15 / MK-F17 / O18 / A / none | `app\app\admin\rfqs.tsx`; `app\app\admin\shops.tsx`; `app\app\enquiry\[id].tsx`; `app\app\merchant-enquiries.tsx`; `app\app\merchant-rfqs.tsx`; `app\app\merchant-shop.tsx`; `app\app\product\[id].tsx`; `app\app\products.tsx`; `app\app\rfq\[id].tsx`; `app\app\rfq\merchant\[id].tsx`; `app\app\rfq\new.tsx`; `app\app\shop\[id].tsx`; `app\app\shop\index.tsx`<br>Functions: No SQL change | 1. Each owning screen adds successful/current resource state, not just []/null defaults; existing ErrorState/Retry/Skeleton/EmptyState reused.<br>2. Only successful current-scope []/null enters empty/unavailable; failure preserves clear error and optional stale marker, with unsafe commit disabled until eligibility refresh.<br>3. Shop index reads public catalogue/shops and own history independently; one failed source doesn't discard successful others.<br>4. Merchant setup form requires successful no-shop read, not failed lookup. RFQ category Retry preserves entered items; enquiry failed read exits skeleton to retry. | For every listed screen: initial reject -> error+Retry, not zero/setup/eternal skeleton; success empty -> correct empty.; Refetch failure shows stale state honestly; successful retry clears error.; No diagnostic-only commit or false live PASS; assertion includes actual resource/error/data state.<br>Tests: `app\src\features\shops\__tests__\readStates.test.tsx`: MK-READ-product-shop-error-empty, MK-READ-merchant-failed-setup, MK-READ-independent-shop-sections; `app\src\features\rfq\__tests__\readStates.test.tsx`: MK-READ-RFQ-category-retry-draft, MK-READ-supplier-history-error; `e2e\web-smoke.mjs`: MK-READ-admin-and-enquiry-retry<br>Depends: None<br>OFF: Honest read states in both compositions and authorized OFF history. Capability errors never silently become empty data. |
| MK-T16 / MK-F18 / O12 / A / none | `app\src\features\home\HomeV2.tsx`; `app\src\features\home\LegacyHome.tsx`; `app\app\category\[slug].tsx`; `app\src\features\catalogue\ArchetypeCategory.tsx`; `app\app\products.tsx`; `app\src\features\providerProfile\ProviderProfileScreen.tsx`; `app\app\top-rated.tsx`<br>Functions: No SQL change | 1. Use existing useFocusEffect plus AppState foreground read pattern; each async read captures immutable city/slug/provider/service scope and ignores stale completion.<br>2. Reset category error/loading/selection on context; retain same-context selection only if ID still exists.<br>3. Home independent catalogue/rated/active-work outcomes; show secondary failure and retry rather than blocking catalogue or hiding work failure.<br>4. Profile always uses detail.paused; failed temporal public read remains unknown with refresh, never available by null fallback.<br>5. Top-rated/product context failure cannot relabel old-city data current; preserve deliberate Apply semantics for draft product filters. | Deferred old context cannot overwrite current even when it finishes last.; Focus/foreground reloads same PK; successful retry clears old error; unmount cleans callbacks.; Paused detail plus failed secondary read never enables Book; no duplicate mutation/refetch race.<br>Tests: `app\src\features\home\__tests__\HomeV2.test.tsx`: MK-FRESH-home-independent-results, MK-FRESH-home-scope-cleanup; `app\src\features\providerProfile\__tests__\ProviderProfileScreen.test.tsx`: MK-FRESH-paused-unknown, MK-FRESH-profile-context; `app\src\features\catalogue\__tests__\ArchetypeCategory.test.tsx`: MK-FRESH-city-race; `e2e\web-smoke.mjs`: MK-FRESH-top-rated-city-error<br>Depends: MK-T13<br>OFF: Freshness truth always applies, not gated by cosmetic UX; actual capability OFF still honored. |
| MK-T17 / MK-F19 / O19 / A / auth | `UNASSIGNED:MK-SQL-STATE`; `app\src\features\shops\api.ts`; `app\src\features\shops\enquiryPresentation.ts`; `app\src\features\shops\__tests__\enquiryPresentation.test.ts`; `app\app\enquiry\[id].tsx`<br>Functions: get_product_enquiry; set_product_enquiry_status | 1. Participant readback adds server can_change_status plus can_reopen/active_enquiry_id for same stable context; expose no sibling body or outsider identity.<br>2. Status RPC remains actual owner/customer only; normalize duplicate-open conflict while unique index stays authoritative.<br>3. enquiryPresentation({status,fromShopUser,businessRole,canChangeStatus,canReopen,activeEnquiryId}) returns state action and closed explanation; server canChangeStatus, not business-role text alone, authorizes state control; current ShopStatusLabel cannot represent enquiry actor rules.<br>4. Add in-place pull and focused foreground reload; mark-read safe OFF; closed staff gets explicit no-reopen instruction and read-only footer. | Closed staff/manager no edit or impossible Reopen direction; owner/customer allowed action only.; Open twin -> Open active conversation; no duplicate/merge of enquiry PKs.; Counterpart closure + pull/foreground makes status/footer agree; unread clears correct side only.; Outsider and inactive membership denied throughout.<br>Tests: `app\src\features\shops\__tests__\enquiryPresentation.test.ts`: MK-ENQUIRY-closed-role-actions, MK-ENQUIRY-active-twin-route; `supabase\tests\oorva_marketplace_lifecycle.test.mjs`: MK-ENQUIRY-reopen-role-context, MK-ENQUIRY-unread-side; `e2e\web-smoke.mjs`: MK-ENQUIRY-same-PK-counterpart-refresh<br>Depends: MK-T26, MK-T04<br>OFF: Existing read/mark-read remains; new reply/reopen capability stays OFF; no new staff authority. |
| MK-T18 / MK-F20 / O28 / A / auth | `UNASSIGNED:MK-SQL-STATE`; `app\src\features\rfq\api.ts`; `app\app\merchant-enquiries.tsx`; `app\app\merchant-rfqs.tsx`; `app\app\rfq\merchant\[id].tsx`<br>Functions: list_my_supplier_rfqs | 1. Add shop_name to supplier-list table return; DROP/recreate if return signature changes and restore explicit authenticated grants.<br>2. Render existing enquiry.shop_name and returned supplier shop_name in row/header grouping.<br>3. Retain shop_id:rfq_id keys/route shopId and exact recipient/member checks; do not introduce name-based lookup or first-shop global state. | Same RFQ routed to two assigned shops yields two named rows with exact chosen shopId.; Duplicate shop/product/category names never become identity; inactive member denied.; Own-business quote lines never appear in other business context.<br>Tests: `supabase\tests\oorva_marketplace_lifecycle.test.mjs`: MK-BUSINESS-two-shop-same-RFQ; `app\src\features\rfq\__tests__\supplierQuoteModel.test.ts`: MK-BUSINESS-explicit-shop-route; `e2e\web-smoke.mjs`: MK-BUSINESS-inbox-context<br>Depends: MK-T07<br>OFF: Authorized historic business label retained OFF; no new membership permission. |
| MK-T19 / MK-F21 / O12 / C / none | `app\src\features\home\HomeV2.tsx`; `app\src\features\home\LegacyHome.tsx`; `app\src\features\home\homeModel.ts`<br>Functions: No SQL change | 1. After coordinator registers oorva_home_ux, branch only composition on effective brand+leaf while retaining home_v2/unified_search and capability predicates.<br>2. Render location/bell -> canonical urgent summary -> one search/AI hub -> effective families/popular/rated/trust.<br>3. Reuse homeFeatureState/pillarInputs/popularCategories and services-auditor canonical priority; no new booking enum or financial logic. | Urgent action precedes exploration; one default AI entry; contextual query handoff reused.; Brand OFF/leaf ON and leaf OFF preserve existing selected composition, A fixes still present.; AI/family OFF accurately removes new entry; existing work/cancellation still accessible.<br>Tests: `app\src\features\home\__tests__\HomeV2.test.tsx`: MK-HOME-Oorva-hierarchy, MK-HOME-single-AI, MK-HOME-leaf-parent-off; `e2e\web-smoke.mjs`: MK-HOME-explicit-flag-matrix-before-after<br>Depends: MK-T16, MK-T20<br>OFF: Legacy composition with all A fixes; no capability or money-safety paths depend on this flag. |
| MK-T20 / MK-F22 / O08 / A / none | `app\src\components\market\PillarCard.tsx`; `app\src\features\home\HomeV2.tsx`; `app\src\components\market\__tests__\PillarCard.test.tsx`<br>Functions: No SQL change | 1. Narrow PillarCard stacks icon above full title below600 logical px; HomeV2 one-column below360, otherwise existing two-column capacity.<br>2. Remove destination-title ellipsis that loses family name; support wrap/large text while preserving full accessibility label/touch target.<br>3. Do not change pillarInputs/visiblePillars or infer runtime flags from failed Home scenario. | 320/393px and 200% font: full family labels, no horizontal overflow/overlap; correct routes.; Oorva brand/leaf OFF but home_v2 ON still gets accessibility repair.; Capture approved before/after actual flag scenarios later; existing supplied image is before only.<br>Tests: `app\src\components\market\__tests__\PillarCard.test.tsx`: MK-PILLAR-narrow-readable, MK-PILLAR-large-text-route; `e2e\web-smoke.mjs`: MK-PILLAR-portrait-before-after<br>Depends: None<br>OFF: Existing accessibility fix always applies; legacy home body retained if home_v2 OFF. |
| MK-T21 / MK-F23 / O14 / C / none | `app\src\features\providerProfile\ProviderProfileScreen.tsx`; `app\src\features\providerProfile\ProviderProfileHero.tsx`; `app\src\features\providerProfile\ProviderProfileOverview.tsx`<br>Functions: No SQL change | 1. Effective oorva_catalogue_ux selects compact identity/availability -> actual service/package choice -> relevant portfolio -> About/hours/reviews.<br>2. Reuse existing extracted sections and sticky PriceFooter; no loss of real terms, badges, reviews or state.<br>3. Do not alter identity badge policy or server booking behavior for layout. | Selection visible before biography/hours in new composition; legacy section order when leaf/brand OFF.; Exact package/provider action from MK-T14; paused/preview behavior identical in both layouts.; Long content/large text does not hide active action or reason.<br>Tests: `app\src\features\providerProfile\__tests__\ProviderProfileScreen.test.tsx`: MK-PROFILE-Oorva-order, MK-PROFILE-leaf-off-invariants; `e2e\web-smoke.mjs`: MK-PROFILE-selection-before-after<br>Depends: MK-T14, MK-T16<br>OFF: Existing composition retained; all A truth/selection/refresh fixes active. |
| MK-T22 / MK-F24 / O27 / C / none | `app\app\merchant-shop.tsx`; `app\app\merchant-enquiries.tsx`; `app\src\features\shops\manage\ShopDetailsSection.tsx`; `app\src\features\shops\manage\ProductEditorSection.tsx`<br>Functions: No SQL change | 1. Effective oorva_merchant_shop_ux: new shop keeps setup/save; existing shop puts readiness, catalogue/work links and contextual editor before collapsed details.<br>2. Extract presentation sections only; keep owner controller/drafts/readbacks and identity confirmation stable.<br>3. Inbox shows business-labelled unread work before secondary Manage link. | New vs existing primary purpose correct; no lost dirty state on section/theme/flag toggle.; Suspended/member guard/read-only behavior preserved; Remove and identity re-review confirmations still required.; Both brand/leaf OFF combinations keep legacy composition with A fixes.<br>Tests: `app\src\features\shops\manage\__tests__\shopManageModel.test.ts`: MK-WORKSPACE-new-existing-priority, MK-WORKSPACE-dirty-draft-preserved, MK-WORKSPACE-off-guards; `e2e\web-smoke.mjs`: MK-WORKSPACE-catalogue-before-after<br>Depends: MK-T03, MK-T18<br>OFF: Existing workspace composition retained, no owner/role/amount changes. |
| MK-T23 / MK-F25 / O18 / C / none | `app\app\products.tsx`; `app\app\product\[id].tsx`; `app\app\shop\[id].tsx`; `app\app\shop\index.tsx`; `app\src\features\activity\UnifiedActivityScreen.tsx`<br>Functions: No SQL change | 1. Effective oorva_shops_ux: manual search first, optional AI contextual, compact applied filters/RFQ secondary.<br>2. Shop compact identity -> catalogue; general Ask shop opens composer. Product detail keeps visible Ask shop action and expandable full specs with unit/price/stock intact.<br>3. View all links to /bookings?segment=shop. Current UnifiedActivityScreen does not parse a route segment: O16 adds validated useLocalSearchParams segment support using existing ActivitySegment, waiting for history visibility before selecting. No new order screen.<br>4. Retain public/shop auth and OFF-history behavior from prerequisite repairs. | Long product/specs has reachable Ask shop; catalogue before expanded composer; no Cart/Buy.; Sixth enquiry reachable in existing Shop segment, including read history when new capability OFF.; Brand/leaf OFF legacy composition; identical RPC/price/role behavior; invalid segment param safely falls back.<br>Tests: `app\src\features\shops\__tests__\customerLayouts.test.tsx`: MK-SHOPS-search-catalogue-action-order, MK-SHOPS-leaf-off; `app\src\features\activity\__tests__\model.test.ts`: MK-SHOPS-validated-segment-parameter; `e2e\web-smoke.mjs`: MK-SHOPS-sixth-enquiry-view-all, MK-SHOPS-detail-before-after<br>Depends: MK-T04, MK-T10, MK-T11<br>OFF: Old composition retained with A fixes and authorized existing records; no cosmetic gate on cancellation. |
| MK-T24 / MK-F26 / O21 / A / none | `app\src\features\creators\CreatorsScreen.tsx`; `app\src\features\creators\__tests__\CreatorsScreen.test.tsx`<br>Functions: No SQL change | 1. After successful load derive actual creatorCategories; length zero renders existing EmptyState with current city and location/services navigation.<br>2. Keep existing ErrorState Retry, skeletons and OFF Home fallback.<br>3. Do not add named creator/portfolio/follower data or undefined general brief category. | Loading/error/success-zero/success-categories distinct.; No invented creators/portfolio or unsupported brief submit.; creators_landing OFF preserves ordinary enabled category drill-down.<br>Tests: `app\src\features\creators\__tests__\CreatorsScreen.test.tsx`: MK-CREATORS-empty-city-recovery, MK-CREATORS-error-not-empty, MK-CREATORS-off-fallback<br>Depends: None<br>OFF: Truthful empty state independent of Oorva branding; landing capability OFF still uses existing fallback. |
| MK-T25 / MK-F27 / O19 / A / none | `app\app\rfq\[id].tsx`; `app\src\features\rfq\__tests__\RfqDetailScreen.test.tsx`<br>Functions: cancel_rfq state effects retained; MK-T04 removes unsafe capability gate | 1. Replace unsupported suppliers-will-be-told copy with request closure/outstanding quotes not selected; explicit no payment.<br>2. Keep destructive confirmation but secondary contextual placement, not dominant before request content.<br>3. After confirmed cancel await canonical reload; no new notification implementation. | Dismiss -> zero calls; confirm -> same RFQ cancelled and sent quotes rejected; no payment.; No push/notification promise unsupported by SQL.; Owner safe cancellation remains reachable OFF; terminal request no repeated pending cancel.<br>Tests: `app\src\features\rfq\__tests__\RfqDetailScreen.test.tsx`: MK-CANCEL-truthful-confirmation, MK-CANCEL-dismiss-no-call, MK-CANCEL-terminal-no-repeat<br>Depends: MK-T04<br>OFF: Cancellation truth/safety always applies; cosmetic and new-RFQ capability OFF cannot strand existing open owner request. |
| MK-T26 / MK-F28 / O38P / A / concurrency | `UNASSIGNED:MK-SQL-STATE`; `supabase\tests\oorva_marketplace_lifecycle.test.mjs`; `supabase\tests\ws3_delete_product.test.mjs`<br>Functions: NEW _preserve_enquiry_product_context() trigger; start_product_enquiry; select_supplier_quote; get_product_enquiry/set_product_enquiry_status stable-context collision checks | 1. Add private product_context_id UUID with no product FK; backfill current product_id. BEFORE INSERT trigger sets from product_id server-side; UPDATE preserves OLD context even for FK SET NULL, preventing spoof/change.<br>2. Replace unique one-open index to use shop_id/customer_id/coalesce(product_context_id,zero UUID). Migration backfill is deterministic for surviving pointers; do not infer originals for already NULL history.<br>3. Change start/reuse lookup and RFQ general enquiry lookup to product_context_id (NULL only for genuine general thread). Preserve MK-T05 lock order/guards and 0069 hard delete/image cascade.<br>4. Supply same stable context to collision-safe reopen in MK-T17; no auto-close/merge/PK replacement.<br>5. Extend existing hard-deletion regression intent: open history remains open. Register latest-chain cases; do not soften deletion to hide the conflict. | Product+general open for same shop/customer -> hard delete succeeds, product/image rows gone, both enquiry PKs/messages/status=open retained, pointers NULL/context distinct.; Two product threads then two deletes -> no unique collision or merge; next general start/RFQ selection reuses only general-context thread.; Reopening only conflicts with same stable context; cross-owner deletion and unauthorized history denied.; Two concurrent starts/reopens still enforce one open per stable context; private PostgreSQL interleaving test required for concurrency claim.<br>Tests: `supabase\tests\oorva_marketplace_lifecycle.test.mjs`: MK-DELETE-product-plus-general-open, MK-DELETE-two-products-context, MK-DELETE-general-reuse-after-delete, MK-DELETE-context-immutable; `supabase\tests\ws3_delete_product.test.mjs`: hard deletion keeps enquiry history and cascades product image rows (retain); `e2e\web-smoke.mjs`: MK-DELETE-private-concurrent-context-invariant<br>Depends: MK-T05<br>OFF: Integrity always applies, including Oorva OFF; actual product deletion capability remains existing products/owner guard. |

## Retain / no-change invariants
- Server-filtered public provider/shop trust is legitimate; do not fabricate a new private-data verification calculation.
- Current verified-shop nonidentity edits retain verification; identity edits already warn and send to submitted.
- Quote/GST/quantity/paise rounding stays server-owned; partial offers remain selectable when live, with explicit differences and no lowest-complete claim.
- Supplier selection creates/reuses an enquiry, takes no payment and creates no product order. Several RFQs may share one general enquiry.
- Manager-minimum supplier send and staff enquiry reply/read scope remain; staff cannot close/reopen customer conversation.
- Keep normal hard deletion/image cascade/open message history; repair the context-key collision without reverting to soft delete or closing/merging history.
- Creator landing contains real categories only; portfolio/social-link claims must remain actual and explicitly provider-submitted where appropriate.
- Existing focus/pull and post-mutation authoritative readbacks are retained; new work cannot rely on hidden controls for authorization.

## Runtime controls, integration and review gates
Existing status/permission/truth/accessibility fixes always apply, even oorva_brand and every Oorva UX leaf OFF. Capability OFF still denies new create/send/select/edit; participant history and safe owner cancellation target remain accessible.
Brand identity is coordinator/identity scope, not re-audited here.
| Target class-C key / parent | Admin registration / default | OFF behavior |
| --- | --- | --- |
| oorva_home_ux / oorva_brand | Oorva home and search; group Oorva UX; sort 10; default OFF | Existing selected home/search composition remains, including all class-A fixes. |
| oorva_catalogue_ux / oorva_brand | Oorva service discovery; group Oorva UX; sort 20; default OFF | Existing category/profile composition with all truth/action fixes. |
| oorva_shops_ux / oorva_brand | Oorva shops presentation; group Oorva UX; sort 30; default OFF | Existing shop/product composition; historical records remain readable. |
| oorva_merchant_shop_ux / oorva_brand | Oorva shop workspace; group Oorva UX; sort 40; default OFF | Existing shop workspace composition with class-A guards/readbacks. |
These Oorva keys are target names from the draft ownership/flag plan, not implemented flags at the frozen SHA. Coordinator O03 must register explicit labels/descriptions/group/sort/default OFF and parent-effective evaluation before dependent class-C tasks.
- Leaf ON/brand OFF -> legacy composition, class-A fixes still active.
- Leaf OFF/brand ON -> legacy composition, class-A fixes still active.
- Effective leaf ON -> only family composition changes; identical RPC authorization/money behavior.
- Capability parent OFF/child ON -> no new work; authorized history and specified safe cancellation still resolve.

- O38P alone composes marketplace forward SQL and shared shops/RFQ APIs; serialize all changes to named functions.
- O38I supplies public provider RPC/readiness; no duplicate readiness implementation.
- O08/coordinator owns shared primitive changes; O18 shared product card; consumers reuse rather than edit concurrently.
- O16 owns shared activity history/deep-link additions; marketplace report supplies exact narrow dependency.
- Coordinator alone registers migrations/tests/workflows; no source/CI edits performed in this audit.
supabase/tests/run-all.mjs executes only package.json-registered commands. Coordinator adds parse entries for forward migrations plus node oorva_marketplace_lifecycle.test.mjs to supabase/tests/package.json and normal ordered deploy/full-chain lists at implementation time. Do not assume a new test filename auto-runs.
- No listed test has been executed in this audit.
- New SQL cases use createHarness/scenario, explicit casts and latest full numbered migration chain including letter-suffixed files; p1b current loader <=74 is not proof of new current behavior.
- Isolated shop/provider/customer/items/date per scenario; one workflow intentionally compares the same PK across authorized actor projections.
- Fixed future working-hours service fixtures and fixed past expiry fixtures; do not use boundary-sensitive relative slots.
- Every assertion prints JSON.stringify(actual relevant rows/state) on failure; no diagnostics-only round.
- Targeted Codespace validation and focused auth/money/concurrency review happen later, then lane CI; no installs on owner Windows.
- Before/after screenshots must record actual flags/actor/entity PK and operation; no scenario-name state inference, no personal details in reports.

## Risks / decisions / not verified
**No source-coverage blocker.** New migration allocation is an explicit coordinator claim, not an already-reserved filename. Auth, money and concurrency repairs require the focused implementation reviews named per task, not a review launched by this audit. Preserve the current broad admin transitions unless the product owner separately changes policy.
- No runtime/device/app tests performed in this source audit.
- No builds, installs, commits, pushes, source/SQL/docs/CI changes, production API calls or subagents.
- Only eight supplied PNGs inspected; no new capture, after screenshot or visual PASS.
- Runtime feature values, live data and account state are not inferred from screenshot filenames/scenarios.
- expire_rfqs definition and service_role grant verified; external invocation cadence and live cleanup lag unverified.
- Current metadata describes stored fields; proposed can_select/can_send_quote/can_enquire/product_context_id and new public RPC are explicitly target repairs, not present fields.
- No product order, separate creator lifecycle, guaranteed free slot, shop rating/hours/photo, RFQ:enquiry 1:1 or human-name uniqueness is invented.
- Same-entity workflow assertions compare actual PKs across authorized projections; scenarios use isolated fixtures.

No assigned screen/entity is deferred to another generic audit. Shared identity readiness and activity ownership have exact consumer contracts/tasks above.

## Evidence inventory
All owned route and actual feature bodies read. Shared supporting files may be targeted ranges; exact cited ranges are at the frozen SHA. Original brand brief read only as context; historical checkout draft plan searched only for ownership/target flag names, never current-code evidence.
Exact source paths/ranges are cited above and in JSON. Files read (including targeted reads/searches and supplied context/artifacts):
- `app\app\(customer)\bookings.tsx`
- `app\app\(customer)\index.tsx`
- `app\app\(customer)\search.tsx`
- `app\app\_layout.tsx`
- `app\app\admin\rfqs.tsx`
- `app\app\admin\shops.tsx`
- `app\app\category\[slug].tsx`
- `app\app\creators.tsx`
- `app\app\enquiry\[id].tsx`
- `app\app\merchant-enquiries.tsx`
- `app\app\merchant-rfqs.tsx`
- `app\app\merchant-shop.tsx`
- `app\app\product\[id].tsx`
- `app\app\products.tsx`
- `app\app\provider\[id].tsx`
- `app\app\rfq\[id].tsx`
- `app\app\rfq\merchant\[id].tsx`
- `app\app\rfq\new.tsx`
- `app\app\shop\[id].tsx`
- `app\app\shop\index.tsx`
- `app\app\top-rated.tsx`
- `app\src\components\ProviderCard.tsx`
- `app\src\components\ProviderProfileAttributes.tsx`
- `app\src\components\ProviderServicePackages.tsx`
- `app\src\components\TopRatedCard.tsx`
- `app\src\components\market\ListingCard.tsx`
- `app\src\components\market\PillarCard.tsx`
- `app\src\components\market\QuoteCompareTable.tsx`
- `app\src\components\market\compareModel.ts`
- `app\src\components\providerCardModel.ts`
- `app\src\features\activity\UnifiedActivityScreen.tsx`
- `app\src\features\activity\api.ts`
- `app\src\features\activity\model.ts`
- `app\src\features\activity\segments\ShopSegment.tsx`
- `app\src\features\ai\productSearch.ts`
- `app\src\features\booking\packages\PackageCard.tsx`
- `app\src\features\booking\packages\packageModel.ts`
- `app\src\features\catalogue\ArchetypeCategory.tsx`
- `app\src\features\catalogue\CatalogueSections.tsx`
- `app\src\features\catalogue\api.ts`
- `app\src\features\creators\CreatorsScreen.tsx`
- `app\src\features\creators\creatorCategories.ts`
- `app\src\features\home\HomeV2.tsx`
- `app\src\features\home\LegacyHome.tsx`
- `app\src\features\home\__tests__\homeModel.test.ts`
- `app\src\features\home\homeModel.ts`
- `app\src\features\providerProfile\ProfileParts.tsx`
- `app\src\features\providerProfile\ProviderPortfolioSection.tsx`
- `app\src\features\providerProfile\ProviderProfileCallouts.tsx`
- `app\src\features\providerProfile\ProviderProfileHero.tsx`
- `app\src\features\providerProfile\ProviderProfileOverview.tsx`
- `app\src\features\providerProfile\ProviderProfileScreen.tsx`
- `app\src\features\providerProfile\ProviderReviewsSection.tsx`
- `app\src\features\providerProfile\ProviderServicesSection.tsx`
- `app\src\features\providerProfile\model.ts`
- `app\src\features\rfq\__tests__\comparePresentation.test.ts`
- `app\src\features\rfq\api.ts`
- `app\src\features\rfq\comparePresentation.ts`
- `app\src\features\rfq\components.tsx`
- `app\src\features\rfq\quoteMath.ts`
- `app\src\features\search\SearchScreen.tsx`
- `app\src\features\search\__tests__\searchModel.test.ts`
- `app\src\features\search\api.ts`
- `app\src\features\search\searchModel.ts`
- `app\src\features\shops\SpecFields.tsx`
- `app\src\features\shops\api.ts`
- `app\src\features\shops\components.tsx`
- `app\src\features\shops\format.ts`
- `app\src\features\shops\specs.ts`
- `app\src\lib\api.ts`
- `app\src\lib\apiTypes.ts`
- `app\src\lib\authGate.ts`
- `app\src\lib\featureFlagModel.ts`
- `app\src\lib\featureFlags.ts`
- `app\src\lib\onboarding\availability.ts`
- `app\src\lib\onboarding\supabaseOnboarding.ts`
- `app\src\lib\supabaseApi.ts`
- `app\src\lib\unreadContext.tsx`
- `e2e\web-smoke.mjs`
- `supabase\functions\ai-assistant\index.ts`
- `supabase\functions\ai-assistant\product_search.ts`
- `supabase\migrations\0001_init.sql`
- `supabase\migrations\0009_provider_onboarding.sql`
- `supabase\migrations\0013_review_matching.sql`
- `supabase\migrations\0017_creator_config.sql`
- `supabase\migrations\0018_archetype_core.sql`
- `supabase\migrations\0049_shops_catalogue.sql`
- `supabase\migrations\0050_rfq.sql`
- `supabase\migrations\0052_merchant_staff.sql`
- `supabase\migrations\0053_activity_contracts.sql`
- `supabase\migrations\0056_home_services_catalogue.sql`
- `supabase\migrations\0059_admin_identity_hardening.sql`
- `supabase\migrations\0064_o2_provider_verification.sql`
- `supabase\migrations\0069_ws3_shop_product_remediation.sql`
- `supabase\migrations\0070_nearo_r1.sql`
- `supabase\migrations\0074_p1b_rfq.sql`
- `supabase\migrations\0087_ui_redesign_flags_guest_read.sql`
- `supabase\tests\guest_read_access.test.mjs`
- `supabase\tests\o2_admin_status.test.mjs`
- `supabase\tests\p1b.test.mjs`
- `supabase\tests\package.json`
- `supabase\tests\run-all.mjs`
- `supabase\tests\ws3_delete_product.test.mjs`
- `planning-session\critical-audit\audit-protocol.txt`
- `planning-session\critical-audit\audit-manifest.json`
- `planning-session\critical-addendum-source.txt`
- `planning-session\oorva-source.txt`
- `repository\docs\18-Oorva-Transformation-Implementation-Plan.md`
- `planning-session\critical-audit\before-web-44696642603\20-home-FAILED.png`
- `planning-session\critical-audit\before-web-44696642603\16-phase-7a-shop-and-product-browse.png`
- `planning-session\critical-audit\before-web-44696642603\18-phase-7a-rfq-create-and-details.png`
- `planning-session\critical-audit\before-web-44696642603\161-phase-7a-admin-approves-submitted-shop.png`
- `planning-session\critical-audit\before-web-44696642603\60-phase-7a-owner-submits-shop.png`
- `planning-session\critical-audit\before-web-44696642603\69-provider-detail.png`
- `planning-session\critical-audit\before-web-44696642603\23-top-rated-see-all.png`
- `planning-session\critical-audit\before-web-44696642603\17-phase-7a-product-enquiry.png`

**Audit status:** completed. Only the two assigned session reports were written. Implementation and runtime verification remain NOT RUN by design.


## Addressable source task cards

<a id="mk-t01"></a>

### MK-T01

**Evidence findings:** MK-F01. **Logical WP:** O31. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\app\admin\shops.tsx`; `app\src\features\shops\shopReviewPresentation.ts`; `app\src\features\shops\__tests__\shopReviewPresentation.test.ts`.

**Function scope:** `admin_set_shop_status: consume current 0064 contract, do not edit it for this UI fix`.

**Required edits:**

1. Add shopReviewActions(status: ShopStatus): ReviewAction[] with action id/label/requiresReason/confirmation intent; current ShopStatusLabel remains label source.
2. Mirror existing SQL Verify origins; suspended label Restore verification; no completed same-state transition control. Preserve currently authorized other admin transitions rather than inventing policy.
3. Move reason into confirmed destructive action; require trimmed reason for reject/suspend; keep awaited load and source row after mutation.

**Acceptance:**

- Verified/draft/rejected never display Verify; submitted/under_review do; suspended displays Restore, not a pending verification claim.
- Non-admin RPC still denied; blank reason sends no call; cancelling dialog sends no call.
- Same shop PK read by owner/admin/public after approved action agrees; server-denied stale action refreshes, never optimistic success.

**Tests (requirements, NOT RUN):**

- {"path": "app\\src\\features\\shops\\__tests__\\shopReviewPresentation.test.ts", "cases": ["MK-ADMIN-six-state-actions", "MK-ADMIN-reason-and-cancel"]}
- {"path": "e2e\\web-smoke.mjs", "cases": ["MK-ADMIN-same-shop-cross-role-no-verify"]}

**OFF behavior:** Applies with every Oorva flag OFF; admin recovery/read remains available when product discovery OFF..

<a id="mk-t02"></a>

### MK-T02

**Evidence findings:** MK-F02. **Logical WP:** O38P. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `UNASSIGNED:MK-SQL-STATE`; `supabase\tests\oorva_marketplace_lifecycle.test.mjs`.

**Function scope:** `submit_shop`.

**Required edits:**

1. Forward-replace latest submit_shop; after actual-owner FOR UPDATE lookup assert state in draft/rejected.
2. Retain effective-products/completeness/categories and reason-clear update; do not alter identity-delta save_shop.
3. Retain authenticated grants and add latest-chain actor/state assertions.

**Acceptance:**

- Actual owner draft/rejected complete -> submitted; owner verified/submitted/under_review/suspended -> denied with row unchanged.
- Manager/staff/other owner denied, even if client fabricates owner role.
- Verified description-only save remains verified; confirmed identity edit still submitted; parent OFF blocks new submission.

**Tests (requirements, NOT RUN):**

- {"path": "supabase\\tests\\oorva_marketplace_lifecycle.test.mjs", "cases": ["MK-SHOP-owner-submit-allowed", "MK-SHOP-reviewed-reset-denied", "MK-SHOP-submit-roles-and-parent"]}

**OFF behavior:** State guard always applies; capability OFF rejects new submit, not authorized historic reads..

<a id="mk-t03"></a>

### MK-T03

**Evidence findings:** MK-F03. **Logical WP:** O27. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\app\merchant-shop.tsx`; `app\src\features\shops\manage\shopManageModel.ts`; `app\src\features\shops\manage\__tests__\shopManageModel.test.ts`.

**Function scope:** `save_product/delete_product existing guards retained`.

**Required edits:**

1. Add shopManageActions({shop,actualOwner,productsEnabled}) with explicit canEditProducts/canSubmit/canSaveDetails; no new universal status enum.
2. Use it for Add/Edit/Save product and stale-editor transitions; show suspended reason.
3. Keep owner shop-details save preserving suspension and current allowed removal; members stay read-only.

**Acceptance:**

- Suspended never has writable product editor; status change while editor open disables save.
- Non-suspended actual owner still edits; staff/manager cannot; existing catalogue remains visible.
- No new server suspension ban on removal, no bypass of existing save_product guard.

**Tests (requirements, NOT RUN):**

- {"path": "app\\src\\features\\shops\\manage\\__tests__\\shopManageModel.test.ts", "cases": ["MK-MANAGE-suspended-product-edit", "MK-MANAGE-owner-member-actions", "MK-MANAGE-refreshed-suspension"]}

**OFF behavior:** A fixes always apply; products OFF gives authorized read-only existing shop/catalogue, no new edit..

<a id="mk-t04"></a>

### MK-T04

**Evidence findings:** MK-F04. **Logical WP:** O38P. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `UNASSIGNED:MK-SQL-STATE`; `supabase\tests\oorva_marketplace_lifecycle.test.mjs`; `app\src\features\shops\api.ts`; `app\src\features\rfq\api.ts`; `app\app\enquiry\[id].tsx`; `app\app\merchant-enquiries.tsx`; `app\app\merchant-rfqs.tsx`; `app\app\merchant-shop.tsx`; `app\app\rfq\[id].tsx`; `app\app\rfq\merchant\[id].tsx`; `app\app\shop\index.tsx`; `app\src\features\activity\UnifiedActivityScreen.tsx`; `app\src\features\activity\model.ts`; `app\src\features\activity\segments\ShopSegment.tsx`.

**Function scope:** `_product_enquiry_participant`; `_rfq_is_customer`; `_rfq_shop_recipient`; `_rfq_can_read`; `_rfq_quote_can_read`; `get_product_enquiry`; `list_product_enquiry_messages`; `list_my_product_enquiries`; `list_shop_product_enquiries`; `mark_enquiry_read`; `get_my_business_shop`; `list_my_products`; `get_rfq`; `list_my_customer_rfqs`; `get_supplier_rfq_for_business`; `list_my_supplier_rfqs`; `compare_rfq_quotes`; `cancel_rfq`; `get_my_activity_unread_counts: shop branches only`; `mark_my_activity_notification_read: RFQ branch only`; `_product_image_access: actual-owner historic image read only`.

**Required edits:**

1. Extract participant/owner/recipient identity checks from capability checks in the named read helpers and read RPCs. Retain active membership, merchant_staff switch, exact customer/shop authorization and public guest-private denial.
2. Remove capability guard from raw-open owner cancel_rfq and safe mark-read only; retain transactional status/quote update and role/state checks. New create/send/select/reopen/catalogue edits keep capability guards.
3. Owner OFF workspace reads existing shop/products without fetching gated active categories or offering editors; public product/shop discovery stays OFF. Allow owner-only _product_image_access(p_manage=false) independent of new-upload capability; new upload/delete storage operations keep original capability/owner checks; public access remains gated.
4. Customer/merchant detail/history routes remain read-only OFF. S05 shared services owner applies existing sports-history pattern to hasShopHistory using authorized enquiry/RFQ reads; visibleActivitySegments and ShopSegment must not erase historic rows merely because products OFF.
5. Only shop unread branches lose new-capability gates; RFQ notification mark-read remains owner-scoped. Do not alter services/sports/money branches.
6. New latest-chain assertions encode required OFF behavior. Existing p1b test is capped at74 and deliberately tests old behavior: either retain it explicitly as historical or upgrade loader+replace conflicting assertion, never claim it validates the new migration.

**Acceptance:**

- For each product/enquiry/RFQ parent OFF/child ON: own existing history still readable; outsider and inactive member denied; new create/send/select/edit denied.
- Owner cancellation of open RFQ works OFF and rejects sent quotes atomically; other customer and terminal cancel denied.
- Shop activity/history remains reachable with all messages already read, not only when unread count>0; own unread/mark-read still consistent OFF.
- Public discovery remains hidden; expiry/payment/refund/settlement code unchanged and ungated by cosmetics.

**Tests (requirements, NOT RUN):**

- {"path": "supabase\\tests\\oorva_marketplace_lifecycle.test.mjs", "cases": ["MK-OFF-existing-enquiry-role-matrix", "MK-OFF-existing-RFQ-role-matrix", "MK-OFF-cancel-owner-not-outsider", "MK-OFF-new-work-denied", "MK-OFF-shop-unread"]}
- {"path": "app\\src\\features\\activity\\__tests__\\model.test.ts", "cases": ["MK-OFF-read-history-keeps-shop-segment"]}
- {"path": "e2e\\web-smoke.mjs", "cases": ["MK-OFF-same-entity-history-cancel-private-backend"]}

**OFF behavior:** This task defines OFF: deny new capabilities, preserve authorized existing history/read metadata and safe owner cancellation..

<a id="mk-t05"></a>

### MK-T05

**Evidence findings:** MK-F05, MK-F06. **Logical WP:** O38P. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `UNASSIGNED:MK-SQL-STATE`; `supabase\tests\oorva_marketplace_lifecycle.test.mjs`; `app\src\features\rfq\api.ts`; `e2e\web-smoke.mjs`.

**Function scope:** `select_supplier_quote`; `send_supplier_quote_for_business`; `compare_rfq_quotes`; `start_product_enquiry`; `NEW _can_start_product_enquiry(uuid,uuid)`.

**Required edits:**

1. Add internal stable _can_start_product_enquiry(shopId,nullableProductId): boolean: authenticated non-owner, effective enquiry parents, verified shop, optional active product in active mapped category. It cannot be replaced by _shop_is_visible, which lacks actor/product predicates. Revoke direct PUBLIC/anon/authenticated execution; definer read/write RPCs call it.
2. Use predicate inside start_product_enquiry after shop lock, preserving general enquiry and stock-false permission.
3. Select resolves RFQ/shop ids, locks RFQ -> shop -> quote, rechecks identities/state/verified shop before any quote/RFQ/enquiry write.
4. Change sender to same RFQ -> shop ordering; preserve all manager/recipient/GST/quantity/rounding checks.
5. Comparison returns can_select and selection_block_reason (closed,rfq_expired,quote_expired,shop_unavailable,feature_off or NULL), with no private shop fields; retain historical rows.

**Acceptance:**

- Valid sent quote -> suspend shop -> selection rejected, no state/message/enquiry changes.
- Disabled product category or removed mapping -> new product enquiry denied; active mapped out-of-stock item still allowed; existing conversation not erased.
- Allowed live partial selection still closes RFQ/opens enquiry without money; non-owner/nonrecipient denials retained.
- Two-connection private PostgreSQL send/select/suspend interleavings have consistent lock order and at most one selected; no claim that sequential PGlite proves concurrency.

**Tests (requirements, NOT RUN):**

- {"path": "supabase\\tests\\oorva_marketplace_lifecycle.test.mjs", "cases": ["MK-SELECT-suspended-shop-atomic-denial", "MK-ENQUIRY-public-eligibility", "MK-SELECT-live-partial-allowed"]}
- {"path": "e2e\\web-smoke.mjs", "cases": ["MK-SELECT-private-concurrent-revise-select-suspend"]}

**OFF behavior:** New start/select/send remains fail-closed under actual capability parents, regardless of Oorva flags; history/cleanup remains safe..

<a id="mk-t06"></a>

### MK-T06

**Evidence findings:** MK-F07, MK-F09. **Logical WP:** O19. **Class:** A. **Source task prerequisites:** MK-T05, MK-T07.

**Proposed source files (canonical allocation takes precedence):** `app\src\features\rfq\rfqStateModel.ts`; `app\src\features\rfq\components.tsx`; `app\src\features\rfq\comparePresentation.ts`; `app\src\features\rfq\__tests__\comparePresentation.test.ts`; `app\src\features\rfq\__tests__\rfqStateModel.test.ts`; `app\app\rfq\[id].tsx`; `app\app\merchant-rfqs.tsx`; `app\app\rfq\merchant\[id].tsx`; `app\app\admin\rfqs.tsx`; `UNASSIGNED:MK-SQL-STATE`.

**Function scope:** `admin_rfq_dashboard safe deadline projection/effective count`; `compare_rfq_quotes safe action projection from MK-T05`.

**Required edits:**

1. Add rfqViewState input/output contract specified in MK-F07; current RfqStatusLabel maps raw enum only and cannot represent parent+outcome+deadline, so it consumes this domain-specific helper rather than inventing a universal status.
2. Extend existing buildComparePresentation options with rfqExpiresAt/nowMs and safe can_select; warnings include every server difference/coverage/delivery flag before action.
3. Remove duplicated carousel selection/cheapest logic; one offer with expandable full lines, one eligible action. Keep server money fields and existing getLowestQuoteId/stable sorting.
4. Set one timeout for nearest relevant deadline strictly greater than now to re-read eligibility; no timer for already expired rows and no zero-delay reload loop. Cleanup on context/blur; focus/pull also reload.
5. Supplier list shows parent RFQ and quote outcome separately; terminal/no-quote copy never invites new reply.
6. Admin dashboard recent projection includes expires_at; effective Open filters both raw open and deadline. Expose raw status/deadline explanation, do not claim a read persisted expiry.

**Acceptance:**

- Fixed clock before/at/after RFQ and quote cutoffs: Send/Choose/lowest agree with eligibility.
- Live incomplete offer allowed with clear coverage, never lowest complete; changed specs/qty/delivery warnings precede sole selection.
- Cancelled+rejected and expired+expired show both facts; selected preserved; exact server subtotal/GST/delivery/total unchanged.
- All correctness remains with Oorva OFF; no new order/paid state.

**Tests (requirements, NOT RUN):**

- {"path": "app\\src\\features\\rfq\\__tests__\\rfqStateModel.test.ts", "cases": ["MK-RFQ-deadline-boundaries", "MK-RFQ-parent-outcome-labels"]}
- {"path": "app\\src\\features\\rfq\\__tests__\\comparePresentation.test.ts", "cases": ["MK-COMPARE-all-warnings-before-action", "MK-COMPARE-expired-lowest", "MK-COMPARE-partial-live-permission"]}
- {"path": "supabase\\tests\\oorva_marketplace_lifecycle.test.mjs", "cases": ["MK-ADMIN-effective-open-deadline"]}

**OFF behavior:** Always-correct status/amount/action presenter; disabled new selection remains hidden while historic comparison readable..

<a id="mk-t07"></a>

### MK-T07

**Evidence findings:** MK-F08. **Logical WP:** O38P. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `UNASSIGNED:MK-SQL-STATE`; `app\src\features\rfq\api.ts`; `app\src\features\rfq\supplierQuoteModel.ts`; `app\src\features\rfq\__tests__\supplierQuoteModel.test.ts`; `app\app\rfq\merchant\[id].tsx`.

**Function scope:** `get_supplier_rfq_for_business`.

**Required edits:**

1. JSON readback adds category_id/shop_name, latest own quote of any stored outcome with item IDs/brand/model/specs/quantity/GST/availability/line totals, aggregate amounts/delivery/notes/validity/version.
2. Add safe can_send_quote and send_block_reason using actual role, verified shop, RFQ raw state/deadline and effective parents; keep recipient/member access and no competing terms/customer coordinates.
3. supplierQuoteModel hydrates UI strings from saved paise/quantity without recomputing persisted money; contextKey=rfq.id+shop_id, revisionKey=latestQuote.id/version.
4. Preserve dirty same-context draft on refetch; reset on context switch. Category schema by category_id, never name.
5. Render terminal quote as saved read-only terms; only eligible state gets editor/send, including input editability.

**Acceptance:**

- For same quote PK all roles authorized to see it agree on version/status/line quantities/server total.
- Selected/rejected/expired retained; manager/staff read own only; staff no Send.
- Duplicate category names cannot choose wrong schema; two-context navigation never sends old rfq_item_id.
- No-GSTIN UI offers zero only; server tax/quantity checks unchanged.

**Tests (requirements, NOT RUN):**

- {"path": "supabase\\tests\\oorva_marketplace_lifecycle.test.mjs", "cases": ["MK-SUPPLIER-latest-terminal-own-read", "MK-SUPPLIER-cross-shop-denial", "MK-SUPPLIER-can-send-state-role"]}
- {"path": "app\\src\\features\\rfq\\__tests__\\supplierQuoteModel.test.ts", "cases": ["MK-SUPPLIER-hydrate-real-version", "MK-SUPPLIER-context-reset-dirty-preserve", "MK-SUPPLIER-category-id"]}

**OFF behavior:** Read-only existing quote remains; new send/revise disabled; staff revocation remains effective..

<a id="mk-t08"></a>

### MK-T08

**Evidence findings:** MK-F10. **Logical WP:** O12. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\src\features\search\searchModel.ts`; `app\src\features\search\__tests__\searchModel.test.ts`.

**Required edits:**

1. Apply local name matching only to kinds whose source was fetched without full-text query; preserve server product membership/order.
2. Filter out category.archetype===null before grouping; keep creators split using real catalogue family model.
3. Make existing category fixtures complete with nonnull archetype; retain five-result cap and case/normalization behavior.

**Acceptance:**

- Server brand/model/description match with unrelated product name appears.
- Grouping parent omitted; service/creator category actual route preserved.
- Existing scope/normalization/cap tests still assert real behavior.

**Tests (requirements, NOT RUN):**

- {"path": "app\\src\\features\\search\\__tests__\\searchModel.test.ts", "cases": ["MK-SEARCH-preserve-server-product-match", "MK-SEARCH-no-group-parent", "MK-SEARCH-scope-cap-order"]}

**OFF behavior:** Fix applies whenever existing unified_search is enabled, independent of Oorva flag; unified_search OFF still performs no requests..

<a id="mk-t09"></a>

### MK-T09

**Evidence findings:** MK-F11. **Logical WP:** O12. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\src\features\search\SearchScreen.tsx`; `app\src\features\search\__tests__\SearchScreen.test.tsx`.

**Required edits:**

1. Replace product renderResult generic ListingCard with existing ShopProductCard and actual SearchProduct.
2. Resolve first image via signedProductImage in scope-cleaned result-image effect; tolerate failures as real fallback, not missing rows.
3. Keep category/shop/activity rendering independent; no new indicative formatter or money engine.

**Acceptance:**

- Same PK price/unit/update qualifier/stock equal across unified search and existing product components.
- NULL/zero/box/sqft and stock false explicit; image failure fallback; no Buy/Cart.
- Typing new query cannot apply old query image/result to current product.

**Tests (requirements, NOT RUN):**

- {"path": "app\\src\\features\\search\\__tests__\\SearchScreen.test.tsx", "cases": ["MK-SEARCH-product-price-stock-contract", "MK-SEARCH-product-image-fallback", "MK-SEARCH-product-query-cleanup"]}

**OFF behavior:** All Oorva flags OFF still gets correct product truth; products OFF has no product requests/results..

<a id="mk-t10"></a>

### MK-T10

**Evidence findings:** MK-F12. **Logical WP:** O12. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\src\features\search\SearchScreen.tsx`; `app\app\products.tsx`; `app\app\merchant-shop.tsx`; `app\src\features\search\__tests__\SearchScreen.test.tsx`; `app\src\features\shops\manage\__tests__\shopManageModel.test.ts`.

**Function scope:** `Existing server parent/auth gates retained`.

**Required edits:**

1. Build scope options from actual effective products/sports, not unconditional enum; reset disappearing selected scope.
2. Product AI conjunction includes build availability,products,ai_assistant,ai_product_search; don't assume FEATURE_PARENTS contains it.
3. Gate only staff/RFQ discovery links by their existing capabilities; history entry behavior supplied by MK-T04, not removed here.

**Acceptance:**

- Parent OFF/child ON produces no invalid chip/AI/link/call.
- Other enabled family/manual search and owner capabilities still work.
- Oorva OFF does not suppress these correctness fixes.

**Tests (requirements, NOT RUN):**

- {"path": "app\\src\\features\\search\\__tests__\\SearchScreen.test.tsx", "cases": ["MK-GATE-scope-off-reset", "MK-GATE-AI-parent-off"]}
- {"path": "app\\src\\features\\shops\\manage\\__tests__\\shopManageModel.test.ts", "cases": ["MK-GATE-staff-RFQ-links"]}

**OFF behavior:** Actual capability parent/child semantics govern new work; cosmetic leaves have no authorization role..

<a id="mk-t11"></a>

### MK-T11

**Evidence findings:** MK-F13. **Logical WP:** O18. **Class:** A. **Source task prerequisites:** MK-T05.

**Proposed source files (canonical allocation takes precedence):** `UNASSIGNED:MK-SQL-STATE`; `app\src\features\shops\api.ts`; `app\app\product\[id].tsx`; `app\app\shop\[id].tsx`; `app\app\products.tsx`; `app\src\features\shops\__tests__\customerActions.test.tsx`.

**Function scope:** `get_product/get_shop additive can_enquire and enquiry_block_reason projection using MK-T05 predicate`.

**Required edits:**

1. Keep public DTO redaction; add safe can_enquire plus reason sign_in/own_shop/feature_off or NULL. If changing RETURNS TABLE, DROP/recreate exact RPC signature in forward migration and restore explicit grants; never broaden columns.
2. Guest sees Sign in to ask shop (or use AI) before editable private message/AI composer. Call existing requireSignIn with safe route; do not put message/address/account data in URL.
3. Authenticated non-owner gets existing composer; owner gets Manage shop instead of self-enquiry; server remains ultimate authority.
4. No new private draft-storage system: guest cannot enter a draft before sign-in; preserve authenticated same-context draft on ordinary retry.

**Acceptance:**

- Guest mutation/invocation count remains zero before auth and returns to correct browse route.
- Own-shop send suppressed and direct SQL still denied; authorized customer and out-of-stock enquiry allowed.
- No owner_id/GSTIN/admin reason/private payout data appears in public read; guest address/coordinates remain redacted.

**Tests (requirements, NOT RUN):**

- {"path": "app\\src\\features\\shops\\__tests__\\customerActions.test.tsx", "cases": ["MK-ACTOR-guest-sign-in-before-composer", "MK-ACTOR-owner-manage-not-enquire", "MK-ACTOR-customer-allowed"]}
- {"path": "supabase\\tests\\guest_read_access.test.mjs", "cases": ["MK-ACTOR-safe-public-action-projection"]}

**OFF behavior:** No new enquiry/AI when capability OFF; sign-in handoff doesn't bypass server; existing history unchanged..

<a id="mk-t12"></a>

### MK-T12

**Evidence findings:** MK-F14. **Logical WP:** O14. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `UNASSIGNED:MK-SQL-PUBLIC-CARDS`; `app\src\lib\supabaseApi.ts`; `app\src\lib\apiTypes.ts`; `app\src\lib\demo\demoApi.ts`; `app\src\components\providerCardModel.ts`; `app\src\components\TopRatedCard.tsx`; `app\src\features\home\HomeV2.tsx`; `app\app\top-rated.tsx`; `app\src\components\__tests__\providerCardModel.test.ts`.

**Function scope:** `NEW list_top_rated_public(p_city text,p_limit int)`.

**Required edits:**

1. O38I supplies bounded safe RPC reusing existing canonical helpers. Output: id,city,rating_avg/rating_count,jobs_completed,years_experience,effective is_online,on_leave_until,profiles(full_name,avatar_url), active public provider_services with id/category archetype/name/slug/visit_fee/skill_level and package price_type/price/min/max/unit. No private readiness fields.
2. Apply guest helper, canonical live/bookable eligibility, exact normalized city, exclude auth.uid, rating_count>0, same avg/count sort and bounded limit; current leave suppresses Online but does not fabricate a booked slot.
3. Existing listTopRated facade maps typed DTO; update TopRatedProvider/Service and demo shape. Extend existing providerCardModel to accept archetype price summary rather than duplicate helpers.
4. Reuse presenter in home and TopRatedCard/Row; proposal quote-per-brief, inspect explicitly visit fee, fixed/session real public package price_type/unit.
5. Deterministic generic-card headline: order public services by existing category.sort_order then provider_service.id; lead is first, plus count of others. For that service only: inspect uses labelled visit fee, proposal uses quote-per-brief, fixed/time uses first public package by sort_order/id with its price_type and unit. Never minimize amounts across different units/archetypes; no package -> No packages listed and View profile, not a fictional free offer. Show selected city and rating-based rank in header.

**Acceptance:**

- Mixed archetype fixtures cannot render proposal-from-zero or wrong visit-fee package price.
- Same provider on current leave consistent across public profile/search/ranking/home; filtered trust remains legitimate.
- Header identifies selected city and rating ordering, not uncomputed distance ranking.
- Public safe columns only; city/self/rating/limit behavior retained; demo not asserted as production verification.

**Tests (requirements, NOT RUN):**

- {"path": "app\\src\\components\\__tests__\\providerCardModel.test.ts", "cases": ["MK-PROVIDER-archetype-price", "MK-PROVIDER-leave-presence", "MK-PROVIDER-mixed-units-stable-headline"]}
- {"path": "supabase\\tests\\guest_read_access.test.mjs", "cases": ["MK-PROVIDER-ranked-public-columns", "MK-PROVIDER-ranked-eligibility-city-self"]}
- {"path": "e2e\\web-smoke.mjs", "cases": ["MK-PROVIDER-no-proposal-zero-price"]}

**OFF behavior:** Correct ranked data regardless of Oorva identity/layout; guest_browse OFF denies anon, signed-in reads keep actual role/capability rules..

<a id="mk-t13"></a>

### MK-T13

**Evidence findings:** MK-F15. **Logical WP:** O14. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\src\features\catalogue\api.ts`; `app\src\features\catalogue\ArchetypeCategory.tsx`; `app\src\features\catalogue\__tests__\api.test.ts`.

**Function scope:** `Existing public provider/service/package RLS`.

**Required edits:**

1. Require listCataloguePackages(categorySlug,city) and pass location.city from fixed/time and proposal branches.
2. Use nested providers!inner and exact escaped case-insensitive city filter; return city in typed card context.
3. Keep current active package/service and public RLS; don't use private onboarding data to evaluate eligibility.

**Acceptance:**

- Isolated city A/B provider packages in same category only return selected city.
- City text with LIKE metacharacters is escaped; no nullable parent embed bypass.
- No cross-city card after location change; unavailable category/provider remains absent.

**Tests (requirements, NOT RUN):**

- {"path": "app\\src\\features\\catalogue\\__tests__\\api.test.ts", "cases": ["MK-PACKAGE-city-inner-filter", "MK-PACKAGE-city-escaping", "MK-PACKAGE-public-projection"]}
- {"path": "e2e\\web-smoke.mjs", "cases": ["MK-PACKAGE-two-city-visible-result"]}

**OFF behavior:** Same correct city in legacy/Oorva compositions; capability/archetype OFF still denies new work..

<a id="mk-t14"></a>

### MK-T14

**Evidence findings:** MK-F16. **Logical WP:** O14. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\src\features\providerProfile\ProviderProfileScreen.tsx`; `app\src\features\providerProfile\ProviderServicesSection.tsx`; `app\src\features\providerProfile\model.ts`; `app\src\features\providerProfile\__tests__\model.test.ts`.

**Function scope:** `Existing booking/proposal endpoints untouched`.

**Required edits:**

1. Model selected service/package together; reset invalid package on provider/service/readback change.
2. Render actual own packages as choices; reuse PackageCard/packageDisplayPrice/canPayInstantly, not a new price rule.
3. Route positive fixed exact IDs to existing book path; nonfixed exact provider/category/package to request/new; no generic Book when package missing.

**Acceptance:**

- Two providers in same category: profile A never routes to provider B or all-provider category as the Book outcome.
- All four price types correct; paused/unknown/preview has no invalid commit.
- Existing inspect/proposal service behavior and server money untouched.

**Tests (requirements, NOT RUN):**

- {"path": "app\\src\\features\\providerProfile\\__tests__\\model.test.ts", "cases": ["MK-PROFILE-package-exact-route", "MK-PROFILE-nonfixed-targeted-brief", "MK-PROFILE-selection-reset"]}

**OFF behavior:** Provider intent and valid route fixed with Oorva OFF; no bypass of booking capability/readiness..

<a id="mk-t15"></a>

### MK-T15

**Evidence findings:** MK-F17. **Logical WP:** O18. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\app\admin\rfqs.tsx`; `app\app\admin\shops.tsx`; `app\app\enquiry\[id].tsx`; `app\app\merchant-enquiries.tsx`; `app\app\merchant-rfqs.tsx`; `app\app\merchant-shop.tsx`; `app\app\product\[id].tsx`; `app\app\products.tsx`; `app\app\rfq\[id].tsx`; `app\app\rfq\merchant\[id].tsx`; `app\app\rfq\new.tsx`; `app\app\shop\[id].tsx`; `app\app\shop\index.tsx`.

**Required edits:**

1. Each owning screen adds successful/current resource state, not just []/null defaults; existing ErrorState/Retry/Skeleton/EmptyState reused.
2. Only successful current-scope []/null enters empty/unavailable; failure preserves clear error and optional stale marker, with unsafe commit disabled until eligibility refresh.
3. Shop index reads public catalogue/shops and own history independently; one failed source doesn't discard successful others.
4. Merchant setup form requires successful no-shop read, not failed lookup. RFQ category Retry preserves entered items; enquiry failed read exits skeleton to retry.

**Acceptance:**

- For every listed screen: initial reject -> error+Retry, not zero/setup/eternal skeleton; success empty -> correct empty.
- Refetch failure shows stale state honestly; successful retry clears error.
- No diagnostic-only commit or false live PASS; assertion includes actual resource/error/data state.

**Tests (requirements, NOT RUN):**

- {"path": "app\\src\\features\\shops\\__tests__\\readStates.test.tsx", "cases": ["MK-READ-product-shop-error-empty", "MK-READ-merchant-failed-setup", "MK-READ-independent-shop-sections"]}
- {"path": "app\\src\\features\\rfq\\__tests__\\readStates.test.tsx", "cases": ["MK-READ-RFQ-category-retry-draft", "MK-READ-supplier-history-error"]}
- {"path": "e2e\\web-smoke.mjs", "cases": ["MK-READ-admin-and-enquiry-retry"]}

**OFF behavior:** Honest read states in both compositions and authorized OFF history. Capability errors never silently become empty data..

<a id="mk-t16"></a>

### MK-T16

**Evidence findings:** MK-F18. **Logical WP:** O12. **Class:** A. **Source task prerequisites:** MK-T13.

**Proposed source files (canonical allocation takes precedence):** `app\src\features\home\HomeV2.tsx`; `app\src\features\home\LegacyHome.tsx`; `app\app\category\[slug].tsx`; `app\src\features\catalogue\ArchetypeCategory.tsx`; `app\app\products.tsx`; `app\src\features\providerProfile\ProviderProfileScreen.tsx`; `app\app\top-rated.tsx`.

**Required edits:**

1. Use existing useFocusEffect plus AppState foreground read pattern; each async read captures immutable city/slug/provider/service scope and ignores stale completion.
2. Reset category error/loading/selection on context; retain same-context selection only if ID still exists.
3. Home independent catalogue/rated/active-work outcomes; show secondary failure and retry rather than blocking catalogue or hiding work failure.
4. Profile always uses detail.paused; failed temporal public read remains unknown with refresh, never available by null fallback.
5. Top-rated/product context failure cannot relabel old-city data current; preserve deliberate Apply semantics for draft product filters.

**Acceptance:**

- Deferred old context cannot overwrite current even when it finishes last.
- Focus/foreground reloads same PK; successful retry clears old error; unmount cleans callbacks.
- Paused detail plus failed secondary read never enables Book; no duplicate mutation/refetch race.

**Tests (requirements, NOT RUN):**

- {"path": "app\\src\\features\\home\\__tests__\\HomeV2.test.tsx", "cases": ["MK-FRESH-home-independent-results", "MK-FRESH-home-scope-cleanup"]}
- {"path": "app\\src\\features\\providerProfile\\__tests__\\ProviderProfileScreen.test.tsx", "cases": ["MK-FRESH-paused-unknown", "MK-FRESH-profile-context"]}
- {"path": "app\\src\\features\\catalogue\\__tests__\\ArchetypeCategory.test.tsx", "cases": ["MK-FRESH-city-race"]}
- {"path": "e2e\\web-smoke.mjs", "cases": ["MK-FRESH-top-rated-city-error"]}

**OFF behavior:** Freshness truth always applies, not gated by cosmetic UX; actual capability OFF still honored..

<a id="mk-t17"></a>

### MK-T17

**Evidence findings:** MK-F19. **Logical WP:** O19. **Class:** A. **Source task prerequisites:** MK-T26, MK-T04.

**Proposed source files (canonical allocation takes precedence):** `UNASSIGNED:MK-SQL-STATE`; `app\src\features\shops\api.ts`; `app\src\features\shops\enquiryPresentation.ts`; `app\src\features\shops\__tests__\enquiryPresentation.test.ts`; `app\app\enquiry\[id].tsx`.

**Function scope:** `get_product_enquiry`; `set_product_enquiry_status`.

**Required edits:**

1. Participant readback adds server can_change_status plus can_reopen/active_enquiry_id for same stable context; expose no sibling body or outsider identity.
2. Status RPC remains actual owner/customer only; normalize duplicate-open conflict while unique index stays authoritative.
3. enquiryPresentation({status,fromShopUser,businessRole,canChangeStatus,canReopen,activeEnquiryId}) returns state action and closed explanation; server canChangeStatus, not business-role text alone, authorizes state control; current ShopStatusLabel cannot represent enquiry actor rules.
4. Add in-place pull and focused foreground reload; mark-read safe OFF; closed staff gets explicit no-reopen instruction and read-only footer.

**Acceptance:**

- Closed staff/manager no edit or impossible Reopen direction; owner/customer allowed action only.
- Open twin -> Open active conversation; no duplicate/merge of enquiry PKs.
- Counterpart closure + pull/foreground makes status/footer agree; unread clears correct side only.
- Outsider and inactive membership denied throughout.

**Tests (requirements, NOT RUN):**

- {"path": "app\\src\\features\\shops\\__tests__\\enquiryPresentation.test.ts", "cases": ["MK-ENQUIRY-closed-role-actions", "MK-ENQUIRY-active-twin-route"]}
- {"path": "supabase\\tests\\oorva_marketplace_lifecycle.test.mjs", "cases": ["MK-ENQUIRY-reopen-role-context", "MK-ENQUIRY-unread-side"]}
- {"path": "e2e\\web-smoke.mjs", "cases": ["MK-ENQUIRY-same-PK-counterpart-refresh"]}

**OFF behavior:** Existing read/mark-read remains; new reply/reopen capability stays OFF; no new staff authority..

<a id="mk-t18"></a>

### MK-T18

**Evidence findings:** MK-F20. **Logical WP:** O28. **Class:** A. **Source task prerequisites:** MK-T07.

**Proposed source files (canonical allocation takes precedence):** `UNASSIGNED:MK-SQL-STATE`; `app\src\features\rfq\api.ts`; `app\app\merchant-enquiries.tsx`; `app\app\merchant-rfqs.tsx`; `app\app\rfq\merchant\[id].tsx`.

**Function scope:** `list_my_supplier_rfqs`.

**Required edits:**

1. Add shop_name to supplier-list table return; DROP/recreate if return signature changes and restore explicit authenticated grants.
2. Render existing enquiry.shop_name and returned supplier shop_name in row/header grouping.
3. Retain shop_id:rfq_id keys/route shopId and exact recipient/member checks; do not introduce name-based lookup or first-shop global state.

**Acceptance:**

- Same RFQ routed to two assigned shops yields two named rows with exact chosen shopId.
- Duplicate shop/product/category names never become identity; inactive member denied.
- Own-business quote lines never appear in other business context.

**Tests (requirements, NOT RUN):**

- {"path": "supabase\\tests\\oorva_marketplace_lifecycle.test.mjs", "cases": ["MK-BUSINESS-two-shop-same-RFQ"]}
- {"path": "app\\src\\features\\rfq\\__tests__\\supplierQuoteModel.test.ts", "cases": ["MK-BUSINESS-explicit-shop-route"]}
- {"path": "e2e\\web-smoke.mjs", "cases": ["MK-BUSINESS-inbox-context"]}

**OFF behavior:** Authorized historic business label retained OFF; no new membership permission..

<a id="mk-t19"></a>

### MK-T19

**Evidence findings:** MK-F21. **Logical WP:** O12. **Class:** C. **Source task prerequisites:** MK-T16, MK-T20.

**Proposed source files (canonical allocation takes precedence):** `app\src\features\home\HomeV2.tsx`; `app\src\features\home\LegacyHome.tsx`; `app\src\features\home\homeModel.ts`.

**Required edits:**

1. After coordinator registers oorva_home_ux, branch only composition on effective brand+leaf while retaining home_v2/unified_search and capability predicates.
2. Render location/bell -> canonical urgent summary -> one search/AI hub -> effective families/popular/rated/trust.
3. Reuse homeFeatureState/pillarInputs/popularCategories and services-auditor canonical priority; no new booking enum or financial logic.

**Acceptance:**

- Urgent action precedes exploration; one default AI entry; contextual query handoff reused.
- Brand OFF/leaf ON and leaf OFF preserve existing selected composition, A fixes still present.
- AI/family OFF accurately removes new entry; existing work/cancellation still accessible.

**Tests (requirements, NOT RUN):**

- {"path": "app\\src\\features\\home\\__tests__\\HomeV2.test.tsx", "cases": ["MK-HOME-Oorva-hierarchy", "MK-HOME-single-AI", "MK-HOME-leaf-parent-off"]}
- {"path": "e2e\\web-smoke.mjs", "cases": ["MK-HOME-explicit-flag-matrix-before-after"]}

**OFF behavior:** Legacy composition with all A fixes; no capability or money-safety paths depend on this flag..

<a id="mk-t20"></a>

### MK-T20

**Evidence findings:** MK-F22. **Logical WP:** O08. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\src\components\market\PillarCard.tsx`; `app\src\features\home\HomeV2.tsx`; `app\src\components\market\__tests__\PillarCard.test.tsx`.

**Required edits:**

1. Narrow PillarCard stacks icon above full title below600 logical px; HomeV2 one-column below360, otherwise existing two-column capacity.
2. Remove destination-title ellipsis that loses family name; support wrap/large text while preserving full accessibility label/touch target.
3. Do not change pillarInputs/visiblePillars or infer runtime flags from failed Home scenario.

**Acceptance:**

- 320/393px and 200% font: full family labels, no horizontal overflow/overlap; correct routes.
- Oorva brand/leaf OFF but home_v2 ON still gets accessibility repair.
- Capture approved before/after actual flag scenarios later; existing supplied image is before only.

**Tests (requirements, NOT RUN):**

- {"path": "app\\src\\components\\market\\__tests__\\PillarCard.test.tsx", "cases": ["MK-PILLAR-narrow-readable", "MK-PILLAR-large-text-route"]}
- {"path": "e2e\\web-smoke.mjs", "cases": ["MK-PILLAR-portrait-before-after"]}

**OFF behavior:** Existing accessibility fix always applies; legacy home body retained if home_v2 OFF..

<a id="mk-t21"></a>

### MK-T21

**Evidence findings:** MK-F23. **Logical WP:** O14. **Class:** C. **Source task prerequisites:** MK-T14, MK-T16.

**Proposed source files (canonical allocation takes precedence):** `app\src\features\providerProfile\ProviderProfileScreen.tsx`; `app\src\features\providerProfile\ProviderProfileHero.tsx`; `app\src\features\providerProfile\ProviderProfileOverview.tsx`.

**Required edits:**

1. Effective oorva_catalogue_ux selects compact identity/availability -> actual service/package choice -> relevant portfolio -> About/hours/reviews.
2. Reuse existing extracted sections and sticky PriceFooter; no loss of real terms, badges, reviews or state.
3. Do not alter identity badge policy or server booking behavior for layout.

**Acceptance:**

- Selection visible before biography/hours in new composition; legacy section order when leaf/brand OFF.
- Exact package/provider action from MK-T14; paused/preview behavior identical in both layouts.
- Long content/large text does not hide active action or reason.

**Tests (requirements, NOT RUN):**

- {"path": "app\\src\\features\\providerProfile\\__tests__\\ProviderProfileScreen.test.tsx", "cases": ["MK-PROFILE-Oorva-order", "MK-PROFILE-leaf-off-invariants"]}
- {"path": "e2e\\web-smoke.mjs", "cases": ["MK-PROFILE-selection-before-after"]}

**OFF behavior:** Existing composition retained; all A truth/selection/refresh fixes active..

<a id="mk-t22"></a>

### MK-T22

**Evidence findings:** MK-F24. **Logical WP:** O27. **Class:** C. **Source task prerequisites:** MK-T03, MK-T18.

**Proposed source files (canonical allocation takes precedence):** `app\app\merchant-shop.tsx`; `app\app\merchant-enquiries.tsx`; `app\src\features\shops\manage\ShopDetailsSection.tsx`; `app\src\features\shops\manage\ProductEditorSection.tsx`.

**Required edits:**

1. Effective oorva_merchant_shop_ux: new shop keeps setup/save; existing shop puts readiness, catalogue/work links and contextual editor before collapsed details.
2. Extract presentation sections only; keep owner controller/drafts/readbacks and identity confirmation stable.
3. Inbox shows business-labelled unread work before secondary Manage link.

**Acceptance:**

- New vs existing primary purpose correct; no lost dirty state on section/theme/flag toggle.
- Suspended/member guard/read-only behavior preserved; Remove and identity re-review confirmations still required.
- Both brand/leaf OFF combinations keep legacy composition with A fixes.

**Tests (requirements, NOT RUN):**

- {"path": "app\\src\\features\\shops\\manage\\__tests__\\shopManageModel.test.ts", "cases": ["MK-WORKSPACE-new-existing-priority", "MK-WORKSPACE-dirty-draft-preserved", "MK-WORKSPACE-off-guards"]}
- {"path": "e2e\\web-smoke.mjs", "cases": ["MK-WORKSPACE-catalogue-before-after"]}

**OFF behavior:** Existing workspace composition retained, no owner/role/amount changes..

<a id="mk-t23"></a>

### MK-T23

**Evidence findings:** MK-F25. **Logical WP:** O18. **Class:** C. **Source task prerequisites:** MK-T04, MK-T10, MK-T11.

**Proposed source files (canonical allocation takes precedence):** `app\app\products.tsx`; `app\app\product\[id].tsx`; `app\app\shop\[id].tsx`; `app\app\shop\index.tsx`; `app\src\features\activity\UnifiedActivityScreen.tsx`.

**Required edits:**

1. Effective oorva_shops_ux: manual search first, optional AI contextual, compact applied filters/RFQ secondary.
2. Shop compact identity -> catalogue; general Ask shop opens composer. Product detail keeps visible Ask shop action and expandable full specs with unit/price/stock intact.
3. View all links to /bookings?segment=shop. Current UnifiedActivityScreen does not parse a route segment: O16 adds validated useLocalSearchParams segment support using existing ActivitySegment, waiting for history visibility before selecting. No new order screen.
4. Retain public/shop auth and OFF-history behavior from prerequisite repairs.

**Acceptance:**

- Long product/specs has reachable Ask shop; catalogue before expanded composer; no Cart/Buy.
- Sixth enquiry reachable in existing Shop segment, including read history when new capability OFF.
- Brand/leaf OFF legacy composition; identical RPC/price/role behavior; invalid segment param safely falls back.

**Tests (requirements, NOT RUN):**

- {"path": "app\\src\\features\\shops\\__tests__\\customerLayouts.test.tsx", "cases": ["MK-SHOPS-search-catalogue-action-order", "MK-SHOPS-leaf-off"]}
- {"path": "app\\src\\features\\activity\\__tests__\\model.test.ts", "cases": ["MK-SHOPS-validated-segment-parameter"]}
- {"path": "e2e\\web-smoke.mjs", "cases": ["MK-SHOPS-sixth-enquiry-view-all", "MK-SHOPS-detail-before-after"]}

**OFF behavior:** Old composition retained with A fixes and authorized existing records; no cosmetic gate on cancellation..

<a id="mk-t24"></a>

### MK-T24

**Evidence findings:** MK-F26. **Logical WP:** O21. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\src\features\creators\CreatorsScreen.tsx`; `app\src\features\creators\__tests__\CreatorsScreen.test.tsx`.

**Required edits:**

1. After successful load derive actual creatorCategories; length zero renders existing EmptyState with current city and location/services navigation.
2. Keep existing ErrorState Retry, skeletons and OFF Home fallback.
3. Do not add named creator/portfolio/follower data or undefined general brief category.

**Acceptance:**

- Loading/error/success-zero/success-categories distinct.
- No invented creators/portfolio or unsupported brief submit.
- creators_landing OFF preserves ordinary enabled category drill-down.

**Tests (requirements, NOT RUN):**

- {"path": "app\\src\\features\\creators\\__tests__\\CreatorsScreen.test.tsx", "cases": ["MK-CREATORS-empty-city-recovery", "MK-CREATORS-error-not-empty", "MK-CREATORS-off-fallback"]}

**OFF behavior:** Truthful empty state independent of Oorva branding; landing capability OFF still uses existing fallback..

<a id="mk-t25"></a>

### MK-T25

**Evidence findings:** MK-F27. **Logical WP:** O19. **Class:** A. **Source task prerequisites:** MK-T04.

**Proposed source files (canonical allocation takes precedence):** `app\app\rfq\[id].tsx`; `app\src\features\rfq\__tests__\RfqDetailScreen.test.tsx`.

**Function scope:** `cancel_rfq state effects retained; MK-T04 removes unsafe capability gate`.

**Required edits:**

1. Replace unsupported suppliers-will-be-told copy with request closure/outstanding quotes not selected; explicit no payment.
2. Keep destructive confirmation but secondary contextual placement, not dominant before request content.
3. After confirmed cancel await canonical reload; no new notification implementation.

**Acceptance:**

- Dismiss -> zero calls; confirm -> same RFQ cancelled and sent quotes rejected; no payment.
- No push/notification promise unsupported by SQL.
- Owner safe cancellation remains reachable OFF; terminal request no repeated pending cancel.

**Tests (requirements, NOT RUN):**

- {"path": "app\\src\\features\\rfq\\__tests__\\RfqDetailScreen.test.tsx", "cases": ["MK-CANCEL-truthful-confirmation", "MK-CANCEL-dismiss-no-call", "MK-CANCEL-terminal-no-repeat"]}

**OFF behavior:** Cancellation truth/safety always applies; cosmetic and new-RFQ capability OFF cannot strand existing open owner request..

<a id="mk-t26"></a>

### MK-T26

**Evidence findings:** MK-F28. **Logical WP:** O38P. **Class:** A. **Source task prerequisites:** MK-T05.

**Proposed source files (canonical allocation takes precedence):** `UNASSIGNED:MK-SQL-STATE`; `supabase\tests\oorva_marketplace_lifecycle.test.mjs`; `supabase\tests\ws3_delete_product.test.mjs`.

**Function scope:** `NEW _preserve_enquiry_product_context() trigger`; `start_product_enquiry`; `select_supplier_quote`; `get_product_enquiry/set_product_enquiry_status stable-context collision checks`.

**Required edits:**

1. Add private product_context_id UUID with no product FK; backfill current product_id. BEFORE INSERT trigger sets from product_id server-side; UPDATE preserves OLD context even for FK SET NULL, preventing spoof/change.
2. Replace unique one-open index to use shop_id/customer_id/coalesce(product_context_id,zero UUID). Migration backfill is deterministic for surviving pointers; do not infer originals for already NULL history.
3. Change start/reuse lookup and RFQ general enquiry lookup to product_context_id (NULL only for genuine general thread). Preserve MK-T05 lock order/guards and 0069 hard delete/image cascade.
4. Supply same stable context to collision-safe reopen in MK-T17; no auto-close/merge/PK replacement.
5. Extend existing hard-deletion regression intent: open history remains open. Register latest-chain cases; do not soften deletion to hide the conflict.

**Acceptance:**

- Product+general open for same shop/customer -> hard delete succeeds, product/image rows gone, both enquiry PKs/messages/status=open retained, pointers NULL/context distinct.
- Two product threads then two deletes -> no unique collision or merge; next general start/RFQ selection reuses only general-context thread.
- Reopening only conflicts with same stable context; cross-owner deletion and unauthorized history denied.
- Two concurrent starts/reopens still enforce one open per stable context; private PostgreSQL interleaving test required for concurrency claim.

**Tests (requirements, NOT RUN):**

- {"path": "supabase\\tests\\oorva_marketplace_lifecycle.test.mjs", "cases": ["MK-DELETE-product-plus-general-open", "MK-DELETE-two-products-context", "MK-DELETE-general-reuse-after-delete", "MK-DELETE-context-immutable"]}
- {"path": "supabase\\tests\\ws3_delete_product.test.mjs", "cases": ["hard deletion keeps enquiry history and cascades product image rows (retain)"]}
- {"path": "e2e\\web-smoke.mjs", "cases": ["MK-DELETE-private-concurrent-context-invariant"]}

**OFF behavior:** Integrity always applies, including Oorva OFF; actual product deletion capability remains existing products/owner guard..
