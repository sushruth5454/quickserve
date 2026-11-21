# Oorva Critical audit - shared platform, authentication, AI and native

> **Implementation authority:** use [doc 18](../18-Oorva-Transformation-Implementation-Plan.md) and [`execution-plan.json`](../design/oorva/execution-plan.json) for the actual dispatch stage, file/function locks, migration claim and validation command. This source audit supplies verified current behavior, required changes and acceptance. A proposal filename is not a numeric reservation.


Source: `2f1e4638b145185b9e58c4c62e58f5c6dd491fa1`. Read-only source audit; no application changes or new runtime test PASS.

## Findings

| ID | Kind / priority | Actual behavior and exact target | Owner | Evidence |
|---|---|---|---|---|
| PF-F01 | confirmed-current-defect / P1 | Guest controls have independent, uncached and contradictory refresh paths. RootNavigator fetches getAppFeatures separately, waits without a local deadline on first guest entry, and converts any foreground fetch failure to guestBrowse=false. Each useAppFeatureFlags call independently fetches and silently retains its own prior state. There is no shared current flag snapshot/cache. Target: One independently validated, cache-first control provider feeds RootNavigator and every flag consumer; a transport/appearance failure must not invent a successful OFF result. | O05A | `app\app\_layout.tsx:58-97`; `app\src\lib\featureFlags.ts:18-41`; `supabase\migrations\0042_feature_registry.sql:38-53` |
| PF-F02 | confirmed-current-defect / P1 | Auth restoration has no explicit failure state or protection against a late initial result. AuthProvider's Promise.all has no catch/finally. Its initial then can overwrite a later onAuthChange session, and onAuthChange does not settle loading. getSession in supabaseApi discards the SDK error field. Target: Loading, known signed-out, authenticated and restore-error are distinct; a newer auth event outranks an older startup result, with a usable retry instead of permanent loader or false signed-out. | O05A | `app\src\lib\auth.tsx:30-54`; `app\src\lib\supabaseApi.ts:81-92`; `app\app\_layout.tsx:103-106` |
| PF-F03 | confirmed-current-defect / P1 | Post-OTP reads silently become new-user/customer state and provider defaults discard return intent. VerifyScreen catches profile and provider read errors as null, then classifies/routes them as missing records. The returning-provider route chooses dashboard before safe returnTo; RoleScreen also ignores safePath for a selected provider. Target: After OTP succeeds, retry failed profile/provider reads without re-verifying the consumed OTP. A valid invite wins, then explicit safe return intent, then the existing role default. | O13 | `app\app\(auth)\verify.tsx:44-67`; `app\app\(auth)\role.tsx:61-74`; `app\src\lib\returningUser.ts:7-9` |
| PF-F04 | confirmed-current-defect / P1 | Public location queries private addresses and the local address list is not identity-scoped. LocationPicker always invokes listMyAddresses, which requires a session, even though location is a guest-browse route. Its address list/effect is not keyed by userId. LocationProvider correctly clears saved selection on known sign-out, but does so while auth can still be loading and does not bind persisted saved selections to an owner. Refresh failure is hidden once addresses already exist. Target: Public location selection works without private queries. Saved list/editor and saved selection belong to the confirmed current actor, with explicit stale/error state and no late cross-actor restore. | O13 | `app\app\location.tsx:46-76`; `app\src\lib\supabaseApi.ts:431-444`; `app\src\lib\locationContext.tsx:148-158`; `app\src\lib\locationModel.ts:113-141` |
| PF-F05 | confirmed-current-defect / P1 | Provider access loading is blank and admin transport errors are presented as denial. ProviderTabs returns null while checking access. AdminLayout collapses amIAdmin errors to false and redirects home, so an unavailable permission check appears equivalent to a known non-admin. Admin effect is mount-only. Target: Show bounded readable loading; keep denied distinct from error/retry and bind permission checks to actor identity without mounting protected children prematurely. | O11 | `app\app\(provider)\_layout.tsx:42-60`; `app\app\admin\_layout.tsx:9-14`; `app\src\lib\adminApi.ts:319-328` |
| PF-F06 | confirmed-current-defect / P1 | BYO preview failures and committed claims do not have truthful recoverable UI states. Preview rejection sets both an error and preview=null, rendering 'invalid, expired or already used' even on transport failure; old token results are not invalidated. After claim commits, bookingId is local to the try and payment error leaves Accept & pay visible, but server has changed invite to claimed and rejects another claim. Target: Token-keyed loading/available/unavailable/error and known-claimed states; after commit, retain bookingId and replace Claim with the existing booking/payment recovery route. | O13 | `app\app\byo\[token].tsx:28-37`; `app\app\byo\[token].tsx:45-62`; `supabase\migrations\0016_leakage_programme.sql:239-330`; `supabase\migrations\0016_leakage_programme.sql:135-139` |
| PF-F07 | confirmed-current-defect / P1 | AI disabled UI still permits the query auto-send effect and handlers to issue a request. aiOn only selects the rendered off view. The q auto-send effect and send callback do not check it. The server independently rejects a disabled feature, so this is not a server authorization bypass. Target: Known disabled controls prevent new chat/transcription requests and cancel pending client generation; server checks remain unchanged and authoritative. | O36 | `app\app\assistant.tsx:99-102`; `app\app\assistant.tsx:182-192`; `app\app\assistant.tsx:282-286`; `supabase\functions\ai-assistant\index.ts:1246-1257` |
| PF-F08 | confirmed-current-defect / P1 | AI history and new-chat callbacks can restore an obsolete conversation. openConversation has no request generation/cancellation; explicit empty turns silently return. newChat aborts chat but does not invalidate history/photo/voice callbacks or clear voice/photo state. A late resume can repopulate the new conversation. Target: Conversation loads and all async results belong to a current conversation generation; new chat truly resets transient context and an explicit load failure/empty result is shown truthfully. | O36 | `app\app\assistant.tsx:144-167`; `app\app\assistant.tsx:399-408`; `app\src\lib\assistant\history.ts:82-105` |
| PF-F09 | confirmed-current-defect / P1 | Actual unread and pressed-destructive color pairs fail normal-text contrast. Independent measurements from current tokens: white/unread danger is3.7574 light and2.7861 dark; dark pressed destructive uses white on dangerText #FDA29B,1.9412. Primary/onPrimary and selected segmentThumb are already semantic/correct and must not be reported as current failures. Target: Unread, destructive default/pressed and new palette primary states use explicit semantic foreground/fill pairs that pass >=4.5:1. | O02/O06/O11/O36 | `app\src\components\ui\CountBadge.tsx:33-43`; `app\src\components\ui\Button.tsx:63-65`; `app\src\components\ui\IconButton.tsx:87-104`; `app\src\theme\tokens.ts:114-145` |
| PF-F10 | confirmed-current-defect / P2 | Essential actions and text are capped/truncated rather than reliably reflowing. Button forces one line and font scale1.3. Badge/chip/segment/step labels also force one line; StepIndicator uses fixed72-wide step items. Text's variant caps are below2.0. This source behavior cannot demonstrate the plan's requested large-text/full-essential-label acceptance. Target: Essential action/title/amount/status text remains complete at320logical width and200% font scale; controls grow or stack instead of silently truncating. | O06 | `app\src\components\ui\Button.tsx:115-118`; `app\src\components\ui\Stepper.tsx:87-90`; `app\src\theme\tokens.ts:251-274` |
| PF-F11 | confirmed-current-defect / P2 | Demo disclosure is an absolute overlay on tabs and sticky actions. DemoDataIndicator is absolute at bottom spacing.xl with zIndex100. Current-code web images show it occupying the tab/footer region, including verification and provider navigation. pointerEvents=none prevents interception but not visual obstruction. Target: Keep clear demo disclosure while reserving layout space outside primary actions/tab labels and toast layers. | O07 | `app\src\components\DemoDataIndicator.tsx:15-28`; `app\src\components\ui\Screen.tsx:81-89` |
| PF-F12 | required-design-change / P2 | Identity text and native identity still use context-specific legacy sources. Login/role/assistant/BYO/native permission/build strings are QuickServe; other receipt/checkout contexts intentionally use Nearo. No current Oorva runtime appearance system or integrated approved vector/native identity exists in this snapshot. Target: Apply the proposed approved Oorva identity through a contextual resolver and strict runtime contract without rewriting historical/technical identifiers. | O05B/O13/O33/O35/O36 | `app\app\(auth)\login.tsx:97-102`; `app\app\(auth)\role.tsx:88-95`; `app\app\assistant.tsx:421-428`; `app\app.json:3-16` |
| PF-F13 | required-design-change / P1 | Current native publishing cannot safely double as isolated Oorva candidate delivery. publish-app automatically publishes main app changes to preview and hardcoded apk-1/apk; build-apk separately declares APK_RUNTIME=apk-1 and channel apk. app.json has no expo-splash-screen plugin. No iOS-specific candidate path is supplied by these workflows. Target: One approved runtime/capability/channel source, isolated reviewed candidate updates and real supported-platform evidence before native cutover. | O33 | `.github\workflows\publish-app.yml:109-116`; `.github\workflows\build-apk.yml:12-16`; `app\app.json:38-64` |
| PF-F14 | required-design-change / P1 | There is no current launch controller implementing the required bounded, actual-destination reveal. Root waits for fonts and auth/guest loading, while notification launch lookup runs asynchronously after readiness. There is no implemented Oorva frame/geometry/motion/watchdog controller. This is a new requested feature, not evidence an existing native animation was tested. Target: Implement the fixed A.4.4 bootstrap and scaled native-identical reveal on capable candidates, with safe error/zero/reduced/OFF/deep-link behavior. | O34 | `app\app\_layout.tsx:164-178`; `app\src\lib\push.ts:125-129` |

## Screen placement audit

### S01 - `app\app\(auth)\login.tsx`

Authenticate with a normalized Indian mobile number and preserve the requested destination.

| Element | Current | Problem / retain | Exact target | Reason / test |
|---|---|---|---|---|
| Identity hero | Gradient, hammer icon and QuickServe before phone field. `app\app\(auth)\login.tsx:70` | Requested Oorva identity; old hero remains OFF. | Compact real selected logo/tagline; one phone action remains first task. | Do not bury sign-in under decoration. Test: Brand/UX ON/OFF at320 and large text. |
| Phone/action | Normalized phone input, validation, Send OTP immediately after error. `app\app\(auth)\login.tsx:30`; `app\app\(auth)\login.tsx:126` | Retain valid flow and server Auth call. | Keep input/error/action contiguous and keyboard reachable. | Authentication purpose is already clear. Test: Valid/invalid normalized numbers, submit failure/loading, no lost text. |
| Legal/help | Secondary links below benefits; help may require scroll. `app\app\(auth)\login.tsx:63`; `app\app\(auth)\login.tsx:188` | Keep discoverable legal/help, no new policy promise. | Secondary compact links after primary form, reachable by keyboard/scroll. | Keep operational support and existing legal topics. Test: Terms/privacy/help open existing routes; return intent preserved. |
| Demo/CTA region | Global demo badge overlays lower-right screen. `app\src\components\DemoDataIndicator.tsx:15` | Confirmed overlap risk in shared shell. | Reserved disclosure slot, not over form/footer/help. | Visible disclosure must not obstruct action. Test: No demo rectangle intersects help/CTA bounds. |

### S02 - `app\app\(auth)\role.tsx`

Choose the existing customer/provider persona and continue safely after profile save.

| Element | Current | Problem / retain | Exact target | Reason / test |
|---|---|---|---|---|
| Welcome/role terms | QuickServe headings and two existing persona cards. `app\app\(auth)\role.tsx:12`; `app\app\(auth)\role.tsx:88` | Brand change only; do not create merchant/creator auth enums. | Contextual Oorva welcome; retain same two choices and membership-driven secondary workspaces. | Personas are not new server permissions. Test: Only existing role booleans written. |
| Name/state | Current name loaded opportunistically; updates trim optional name. `app\app\(auth)\role.tsx:41`; `app\app\(auth)\role.tsx:56` | Retain existing profile schema and validation policy. | Keep name before choice and preserve entered value on refresh/theme changes. | No new mandatory identity/policy implied by redesign. Test: Draft name survives error/theme/role selection. |
| Continue/intent | Sticky action; provider default ignores safePath. `app\app\(auth)\role.tsx:61` | Completed role choice can discard original destination. | Invite then safe return intent then existing role default; grow long action labels. | Continuation must match user's original action. Test: Provider/customer/invite return matrix. |
| Benefits | Existing commercial benefit strings inside role cards. `app\app\(auth)\role.tsx:12` | Retain current policy unless verified/approved outward-copy change. | Subordinate to role/action, no invented payout guarantees or new pricing. | Marketing text must not change actual policy. Test: Existing commission terms loading and save-failure retry preserved. |

### S03 - `app\app\(auth)\verify.tsx`

Verify one OTP, then resolve real profile/role and original intent.

| Element | Current | Problem / retain | Exact target | Reason / test |
|---|---|---|---|---|
| OTP destination | Full formatted number and Edit before OTP. `app\app\(auth)\verify.tsx:105` | Retain; do not infer identity from display text. | Keep number/Edit/OTP adjacent and readable. | User must know where code went. Test: Edit returns safely; six-digit autofill retains existing behavior. |
| OTP/error/resend | 60-second local countdown, InlineAlert and explicit resend. `app\app\(auth)\verify.tsx:14`; `app\app\(auth)\verify.tsx:77` | Retain approved cooldown/auth calls, not a new server throttle. | Keep next to OTP with truthful busy/error. | No undocumented SMS configuration assumption. Test: Error/resend/countdown/disabled and retry cases. |
| Post-auth continuation | Read errors collapse to null; provider ignores safe return. `app\app\(auth)\verify.tsx:44` | Unknown is not a missing profile/provider. | Explicit loading/error/retry after one successful verification; preserve intended destination. | Prevents contradictory role state. Test: OTP-called-once profile/provider retry and returnTo matrix. |
| Primary footer/demo | Single footer Verify action plus floating demo indicator. `app\app\(auth)\verify.tsx:96` | Essential action must grow and not be obscured. | Auto-height full label above reserved demo strip. | Readable action and real disclosure at narrow/large text. Test: 320width/200%, keyboard and demo bounds. |

### S34 - `app\app\assistant-history.tsx`

Read/resume the current user's existing assistant conversations.

| Element | Current | Problem / retain | Exact target | Reason / test |
|---|---|---|---|---|
| Header | Past conversations plus last20 QuickServe subtitle. `app\app\assistant-history.tsx:33` | Identity-only change. | Contextual Oorva name; preserve real history limit. | Do not invent unlimited storage. Test: Brand OFF exact legacy subtitle; same limit. |
| List state | Explicit error, skeleton and true empty branches. `app\app\assistant-history.tsx:34` | Retain existing distinctions. | Continue showing error/retry separately from no conversations. | A request failure is not empty history. Test: Error/skeleton/empty/populated branches. |
| Conversation row | Owner summaries, accessible full title/time and open route. `app\app\assistant-history.tsx:45` | Retain existing owner-read scope; no new delete. | Date/title remain scannable with explicit open behavior. | Preview truncation is secondary; complete accessible title remains. Test: Open correct conversation; no new history delete action. |
| Destination load | Target assistant can silently return from empty/failed resume or restore an old load. `app\app\assistant.tsx:144` | Target state needs generation/error truth. | Explicit target load/retry/unavailable; no false successful empty chat. | Selecting a row must resolve that row. Test: A/B selection race and explicit unavailable/empty. |

### S35 - `app\app\assistant.tsx`

Use the existing advisory assistant, inspect real structured cards and review before any booking.

| Element | Current | Problem / retain | Exact target | Reason / test |
|---|---|---|---|---|
| Capability state | Off screen hides UI, but auto-send and handlers still run. `app\app\assistant.tsx:421`; `app\app\assistant.tsx:282` | Known OFF is not enforced at UI side-effect boundary. | No new request on known OFF, while preserving server rejection. | Visibility alone is not action availability. Test: Known OFF+q sends zero requests; later OFF aborts pending request. |
| History/new chat | Header actions load/reset asynchronous conversations. `app\app\assistant.tsx:399`; `app\app\assistant.tsx:144` | Late resume/voice/photo can restore obsolete context. | Generation-keyed current thread with explicit load/error/retry; full transient reset. | Same conversation identity must own all callbacks. Test: New-chat vs late load/photo/voice and selected-thread errors. |
| Cards/messages | Existing safety/diagnosis/estimate/provider/draft renderers; review-and-pay draft is explicitly not booked. `app\app\assistant.tsx:602`; `app\src\components\assistant\AssistantCards.tsx:287` | Retain advisory authority, adapt essential text and semantic foregrounds. | Entity-specific readable cards with actual estimates and explicit review CTA; no fabricated availability/ratings. | AI output is not authorization or payment truth. Test: Long provider/amount/draft labels; no booking write until existing review flow. |
| Composer/progress | Screen footer provides quick replies, transcription preview, text/voice Stop, photo privacy notice. `app\src\components\assistant\TextComposer.tsx:24`; `app\src\components\assistant\Composer.tsx:139` | Keep keyboard-safe footer; onPrimary replaces hardcoded white before new theme. | One current primary action; compact but retained privacy disclosure; semantic send/mic colors. | Avoid lost messages/unsafe photo enablement. Test: Send/Stop/voice-review transitions, keyboard/large-text, photo lock and OFF. |
| Header/location | QuickServe AI title, current location pill, optional greeting. `app\app\assistant.tsx:447`; `app\app\assistant.tsx:534` | Requested Oorva identity; do not duplicate global AI buttons inside chat. | Shared identity and one location-change action; secondary greeting. | Chat's primary content must remain visible. Test: Long place/title and unchanged /location/history destinations. |

### S39 - `app\app\byo\[token].tsx`

Preview a token-scoped protected booking and continue one committed claim into existing payment.

| Element | Current | Problem / retain | Exact target | Reason / test |
|---|---|---|---|---|
| Preview state | Undefined/null/preview; rejection sets null and false invalid/expired text. `app\app\byo\[token].tsx:28` | Transport error and successful unavailable are conflated. | Token-keyed loading/available/unavailable/error with Retry. | An outage is not an expired invite. Test: Null/error/old-token race cases. |
| Scope/price | Provider/client/schedule and canonical amount/fee/total; fee_bp CHECK300 currently matches3% label. `app\app\byo\[token].tsx:102`; `supabase\migrations\0016_leakage_programme.sql:135` | Retain server amounts/policy, grow long party/price rows. | Complete decisive names/scope and exact preview totals; no client fee calculation. | Never silently change money/policy during rebranding. Test: Full long names and exact server amounts; no fee-policy change. |
| Address/sign-in | Public preview; authenticated address form and contextual login footer. `app\app\byo\[token].tsx:81`; `supabase\migrations\0016_leakage_programme.sql:239` | Retain existing token/public vs claim/auth boundary. | Same guarded form and role continuation; no new public write. | Preview is not permission to claim. Test: Guest login+invite return, server self-claim/expired/address rejection. |
| Completed claim/payment | Booking id local; payment error leaves Accept & pay. `app\app\byo\[token].tsx:45`; `supabase\migrations\0016_leakage_programme.sql:310` | A committed claim must not stay actionable as unclaimed. | Retain known bookingId and replace claim with existing booking/payment recovery. | Do not retry claim to recover payment. Test: Claim committed+pay canceled/error -> no second claim, View booking persists. |

### S48 - `app\app\location.tsx`

Select an actual service location, with private saved addresses only for their confirmed owner.

| Element | Current | Problem / retain | Exact target | Reason / test |
|---|---|---|---|---|
| Public search/GPS | Debounced search, stale callback cleanup and explicit GPS/permission fallback. `app\app\location.tsx:100`; `app\app\location.tsx:148` | Retain existing public selection and actual geocoder behavior. | Keep search/GPS first with errors and explicit Settings when denied. | Guest browsing must not require private address read. Test: Short/long query, search fail/no-results, GPS denied/settings; selected public location remains usable. |
| Saved addresses | Always loaded without auth binding; private API rejects guest. `app\app\location.tsx:46`; `app\src\lib\supabaseApi.ts:431` | Guest gets auth error and actor-local state may persist. | Actor-scoped private section or sign-in entry; no guest private request. | Role-specific content must match authenticated owner. Test: Guest zero calls; actor change/late result cleared. |
| Saved selection | Context clears saved on !userId, including pending auth; cache has no owner. `app\src\lib\locationContext.tsx:148`; `app\src\lib\locationModel.ts:8` | Unknown auth is not confirmed sign-out or ownership. | Owner-bound saved cache and confirmed-auth hydration/reset. | Avoid false loss and cross-actor restoration. Test: Delayed restore same owner, actual logout, A->B and legacy cache. |
| Delete/details | Confirmed delete reloads; errors hidden when old list exists; row subtitle capped2lines. `app\app\location.tsx:65`; `app\app\location.tsx:255` | Known deleted/stale row and decisive address can mislead. | Remove confirmed deleted row, disclose reload error and show full saved address. | Completed action must disappear without an error-to-fresh claim. Test: Delete-success/reload-failure and long address cases. |
| Editor/footer | Existing address sheet validates line/city and snapshots map pin. `app\src\components\AddressEditor.tsx:68` | Retain server ownership and validation; close private draft on actor loss. | Current-actor editor with visible keyboard-safe Save and retained pin. | No private draft or completed save should cross actor boundaries. Test: Actor switch closes editor; successful save chooses current owned record; keyboard native evidence. |

## Exact implementation tasks

| ID / owner | Finding IDs / files | Ordered changes | Acceptance / tests |
|---|---|---|---|
| PF-T01 / O05A | PF-F01, PF-F02; `app\app\_layout.tsx`; `app\src\lib\auth.tsx`; `app\src\lib\supabaseApi.ts`; `app\src\lib\featureFlags.ts`; `app\src\branding\FeatureFlagsProvider.tsx`; `app\src\lib\authRestoreModel.ts`; `app\src\lib\__tests__\authRestoreModel.test.ts` | 1. Implement A.3.4's one control provider without losing get_app_features.archetypes or legacy defaults. 2. Propagate SDK session errors and distinguish restore pending/error/known null/session; add retry and latest-event-wins initialization. 3. Replace only the root duplicate fetch/loading-to-false state, keeping merged G-01 allowlists/protected tree/return intent. 4. Render restore error without exposing protected children; a valid later auth event settles loading and invalidates late initial results. | Offline foreground preserves last valid guest controls. Invalid appearance plus valid brand/UX OFF applies OFF immediately. getSession rejection has retry, not permanent spinner or invented sign-out. Sign-out/sign-in events outrank a stale initial promise. Tests: UI-CACHE-01..04; authRestoreModel: reject/retry, known-null, late-initial-after-signout, latest-login-event; Existing authGate/GuestGate and parent-feature tests; exact legacy/archetypes parity |
| PF-T02 / O13 | PF-F03; `app\app\(auth)\verify.tsx`; `app\app\(auth)\role.tsx`; `app\src\lib\returningUser.ts`; `app\src\lib\__tests__\authContinuation.test.ts` | 1. Separate successful OTP verification from mandatory profile/provider lookup so Retry never consumes the OTP again. 2. Keep failed lookup distinct from null row, with readable retry and no role/profile write on failure. 3. Add a pure shared destination resolver: invite first, safe returnTo second, existing role default last. Keep actual role selection and protected-tree timing. | Returning provider plus valid venue/booking intent returns to that destination rather than dashboard. Known-missing provider preserves the existing returningUserRole fallback, but provider lookup error does not impersonate a missing row. Invite continuation remains customer-oriented; malformed/external returnTo is not followed. Tests: authContinuation: profile error, provider error, OTP-called-once retry, customer/provider returnTo, invite precedence, known-null rows |
| PF-T03 / O13 | PF-F04; `app\app\location.tsx`; `app\src\lib\locationContext.tsx`; `app\src\lib\locationModel.ts`; `app\src\components\AddressEditor.tsx`; `app\src\lib\__tests__\locationModel.test.ts`; `app\src\lib\__tests__\locationActorState.test.ts` | 1. Skip listMyAddresses and private editor while signed out; offer contextual sign-in without blocking existing public search/GPS/areas. 2. Key list/editor loads to confirmed userId, cancel/ignore late loads, clear on actor change and expose reload failure. 3. Under the existing storage key, add versioned saved-selection owner metadata. Do not treat auth-loading null as confirmed logout; accept saved private cache only for its owner. Drop unknown-owner legacy saved selections, not public GPS/search/area choices. 4. After confirmed delete remove that row immediately; a reload failure may show stale remaining current-actor data with an error, never a successful fresh state. 5. Let saved-address rows show complete decisive address information. | Guest selection makes zero private address API calls. A->logout/B clears private list/editor/selection; a late A response cannot restore them. Delayed auth restore for owner A does not prematurely erase A's saved selection. Delete-success/reload-failure does not leave the deleted action row. Long address remains understandable at320width/200%. Tests: locationActorState: guest, loading->same-owner, A->B, logout, stale promise, legacy cache, delete/reload error; Existing locationModel/geocoding/address owner tests; no new public grants |
| PF-T04 / O11 | PF-F05; `app\app\(provider)\_layout.tsx`; `app\app\admin\_layout.tsx`; `app\src\lib\accessPresentation.ts`; `app\src\lib\__tests__\accessPresentation.test.ts` | 1. Replace provider checkingAccess=null render with an existing readable loader. 2. Use actor-keyed admin lookup with explicit transport error/retry and genuine denial redirect; reject stale actor results. 3. Keep actual owner/staff/admin backend permission and navigation distinctions; no broad client privilege inference. | No blank access-check frame. RPC error offers Retry without admin children or false denial. Known false denies; true allows only current actor; actor switch rechecks. Tests: accessPresentation: loading/error/retry/deny/allow/actor-switch; existing navigation role tests |
| PF-T05 / O13 | PF-F06; `app\app\byo\[token].tsx`; `app\src\lib\byoInvitePresentation.ts`; `app\src\lib\__tests__\byoInvitePresentation.test.ts` | 1. Use token/request-keyed loading/available/unavailable/error state; a failed fetch is not invalid/expired. 2. Store known claimed bookingId before invoking payment. Once claim commits, remove Claim and route recovery through existing booking/payment UI without re-claim. 3. Invalidate prior token callbacks and use canonical preview amounts, existing fee policy and backend state rejection. 4. Use auto-height participant/price rows and contextual sign-in; preserve technical invite token and URL scheme. | Network failure has Retry and no false invalid-link claim. Old-token response cannot enable a new token's action. Claim success + payment cancellation/error never calls claim twice and retains a View booking/payment recovery path. Expired/used null remains unavailable; self-claim/server invalid state still rejects. Tests: byoInvitePresentation: preview-null/error/stale-token, claim-success/payment-error/cancel, completed-action replacement; Existing BYO SQL guard/amount tests retained; targeted money/auth review |
| PF-T06 / O36 | PF-F07, PF-F08; `app\app\assistant.tsx`; `app\app\assistant-history.tsx`; `app\src\lib\assistant\history.ts`; `app\src\lib\assistant\conversationState.ts`; `app\src\lib\assistant\__tests__\conversationState.test.ts` | 1. Check effective ai capability in auto-send/send/transcribe entry points and invalidate pending work on OFF. 2. Use a conversation generation key for history, auto-resume, photo and voice callbacks; New chat aborts/reset transient state. 3. Show explicit selected-conversation loading/error/unavailable/empty without pretending it opened successfully. 4. Keep existing server feature/JWT gates, photo privacy lock, owner-only history RLS, stop/retry and review-before-book semantics. | Known ai OFF + q invokes zero transport calls. Late A resume cannot replace B or a new chat. New chat cannot inherit old voice/photo/draft callbacks. Explicit failed/empty conversation is visible and retryable; no unauthorized history read is introduced. Tests: conversationState: OFF auto-send, live OFF abort, A/B load race, new-chat resume race, stale photo/voice, selected-load error/empty |
| PF-T07 / O02 | PF-F09; `app\src\theme\tokens.ts`; `app\src\branding\colorContract.ts`; `app\src\branding\defaults.ts`; `app\src\branding\__tests__\validation.test.ts` | 1. Add onDanger and dangerPressed to strict planned color/default contracts; legacy onDanger=#FFFFFF and dangerPressed=#B42318 both themes. 2. Include destructive default/pressed, unread numeric, selected counts and assistant send controls in actual-used-pair validation. 3. Keep ordinary onPrimary/segmentThumb and unrelated legacy colors; new Oorva colors remain class B. | Every normal text foreground/fill pair passes4.5, including dark pressed. Unknown/malformed contrast-breaking runtime overrides reject appearance, not valid flags. Tests: Color fixtures: current failing unread/dark-pressed pairs rejected; chosen safe replacements and all Oorva/default pairs pass |
| PF-T08 / O06 | PF-F09, PF-F10; `app\src\components\ui\Button.tsx`; `app\src\components\ui\Badge.tsx`; `app\src\components\ui\CountBadge.tsx`; `app\src\components\ui\IconButton.tsx`; `app\src\components\ui\Text.tsx`; `app\src\components\ui\Input.tsx`; `app\src\components\ui\OTPInput.tsx`; `app\src\components\ui\SegmentedControl.tsx`; `app\src\components\ui\Stepper.tsx` | 1. Use onDanger/dangerPressed for destructive and dangerStrong/onDanger for unread counts; reuse CountBadge for IconButton numeric overlays. 2. Replace literal white on theme primary with onPrimary for chip/step/segment counts; O36 applies the same stable roles to assistant mic/send. 3. Remove one-line/tight-scaling constraints on decisive labels/actions/amounts; auto-height containers and critical type variants support200%. 4. Adapt step progress to width/count; reduced-motion rail updates are static. Keep native value/submit/quantity semantics. | Actual rendered used-pair checks pass both themes and all Oorva OFF. 320width/200% critical labels, counts and amounts remain complete and tappable. Seven-step/long-label progress never overflows available width; selection/value behavior unchanged. Tests: Primitive component tests: unread0/99+, dark destructive pressed, long action/full amount, long chip/status and narrow progress, reduced motion |
| PF-T09 / O07 | PF-F11; `app\src\components\DemoDataIndicator.tsx`; `app\src\components\ui\Screen.tsx`; `app\src\components\ui\Toast.tsx`; `app\src\components\ui\BottomSheet.tsx`; `app\src\components\ui\Confirm.tsx`; `app\src\components\RouteErrorBoundary.tsx` | 1. Place demo disclosure in one reserved shell slot, leaving primary footer/tab/toast regions free; keep actual demo detection/disclosure. 2. Retain Screen's measured footer/toast offsets and single header top inset; do not add arbitrary per-screen spacers. 3. Keep provider-independent crash fallback free of Reanimated/theme context imports; add native release hook only in O34. 4. Use semantic toast text/action/accent roles and explicit keyboard/reduced-motion acceptance for modal footers; preserve confirmation policy. | Demo marker is visible but intersects no CTA/tab/toast bounds. Footer moves with keyboard without double safe area; native tests required before platform PASS. Crash-before-provider stays readable; destructive confirmation keeps real backend reason/policy. Tests: Shell/overlay bounds at320/large-text, keyboard/footer/toast/demo; reduced-motion sheet/progress; crash fallback |
| PF-T10 / O05B | PF-F12; `app\src\branding\BrandLogo.tsx`; `app\src\branding\identity.ts`; `app\src\branding\defaults.ts` | 1. Implement pure context-keyed identity selection for legacy/Oorva/published supported display fields. 2. Supply explicit legacy labels for login, AI, support, BYO and the separately owned Nearo receipt/checkout contexts. 3. Bind only selected genuine vector/export assets; expose stable identity API for screen owners, not a global string replacement. | Brand OFF keeps each legacy context; unsupported appearance cannot freeze OFF. Historical financial snapshots, references, IDs and scheme unchanged. Tests: Identity context matrix: mixed legacy names, brand/runtime OFF, asset failure, selected assets, invalid schema |
| PF-T11 / O33 | PF-F13; `app\app.json`; `app\eas.json`; `app\native-release.json`; `.github\workflows\publish-app.yml`; `.github\workflows\build-apk.yml` | 1. Follow exact A.4.1 assets and A.4.5 canonical runtime/channel/capability manifest. 2. Coordinator applies shared workflow/profile edits after active owner locks; old apk-1 does not receive new native imports. 3. Use a reviewed candidate branch/runtime/channel and approved device-reachable non-production backend; record all running/native source identities. 4. Keep final public rights/native cutover/signing/iOS limitations as explicit real gates, not future source-audit questions. | Three cold starts after unrelated main publish retain reviewed code. Correct old-runtime/Expo-Go/web behavior; installed name/icon/splash/notification actual evidence. No iOS/public/native completion claim without its real build/device/gate. Tests: NATIVE-IDENTITY and actual supported-platform matrix; no main/native promotion before E1+D07b |
| PF-T12 / O34 | PF-F14; `app\app\_layout.tsx`; `app\src\branding\launchBootstrap.ts`; `app\src\branding\LaunchExperience.tsx`; `app\src\branding\launchModel.ts`; `app\assets\brand\launch-geometry.json`; `app\src\components\RouteErrorBoundary.tsx` | 1. Implement A.4.4 exactly: binary eligibility before native adapter,250ms cache/800ms first-live-controls/1000ms font bound and2500ms native watchdog. 2. Use native-identical bundled OS-themed frame0 with symbol already visible; freeze supported cached/bundled duration and scale phases, zero/reduced static path. 3. Settle protected auth/URL/notification intent; never route home as an animation side effect. OFF cancels without asset/schema dependency. 4. Use the required O33 GREEN candidate stack before D07b; record real geometry/routes/errors and delivery identities. | No symbol disappearance, unbounded native splash, unwanted resume replay or home-first deep-link flash. Web/Expo-Go/old binaries never evaluate missing module. All15 launch cases have truthful platform evidence or explicit resource gate, not a made-up success. Tests: LAUNCH-01..15 unit/frame/device/intent cases; local notification proves route intent only, not remote X2 |

## Canonical BYO lifecycle

- Public preview requires matching hashed token, status=open and expires_at>now.
- Claimable requires authenticated non-provider actor, open/unexpired row under FOR UPDATE, valid address/location and currently active KYC-verified unsuspended provider service.
- Current fee_bp CHECK=300; preview/claim calculate the same integer-paise fee. Do not replace this distinct private-invite rule with a guessed marketplace-live predicate.
- create_byo_invite: eligible owning provider/service -> open.
- claim_byo_invite: authenticated non-owner, open/unexpired -> claimed plus pending_payment booking and approved quote in one transaction.
- cancel_byo_invite: owning provider and stored status=open -> cancelled; its current predicate does not additionally test expires_at. Repeat/other-provider/claimed fails.
- list_my_byo_invites: owning provider only, latest100 by created_at; stored open with elapsed expires_at is projected as expired without changing its stored status.

## Retain and limits

- Existing role model, RLS, private money-policy boundaries, get_app_features.archetypes and G-01 guards remain authoritative.
- Existing3% BYO fee is CHECK-enforced, not a verified configurable-fee drift defect.
- Current primary/onPrimary, selected segmentThumb and measured Screen footer/toast infrastructure already work; retain them.
- Source audit and existing web captures do not prove native/keyboard/large-text/runtime acceptance.
- Scenario screenshot names do not prove actual route, actor or backend state.


## Addressable source task cards

<a id="pf-t01"></a>

### PF-T01

**Evidence findings:** PF-F01, PF-F02. **Logical WP:** O05A. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\app\_layout.tsx`; `app\src\lib\auth.tsx`; `app\src\lib\supabaseApi.ts`; `app\src\lib\featureFlags.ts`; `app\src\branding\FeatureFlagsProvider.tsx`; `app\src\lib\authRestoreModel.ts`; `app\src\lib\__tests__\authRestoreModel.test.ts`.

**Required edits:**

1. Implement A.3.4's one control provider without losing get_app_features.archetypes or legacy defaults.
2. Propagate SDK session errors and distinguish restore pending/error/known null/session; add retry and latest-event-wins initialization.
3. Replace only the root duplicate fetch/loading-to-false state, keeping merged G-01 allowlists/protected tree/return intent.
4. Render restore error without exposing protected children; a valid later auth event settles loading and invalidates late initial results.

**Acceptance:**

- Offline foreground preserves last valid guest controls.
- Invalid appearance plus valid brand/UX OFF applies OFF immediately.
- getSession rejection has retry, not permanent spinner or invented sign-out.
- Sign-out/sign-in events outrank a stale initial promise.

**Tests (requirements, NOT RUN):**

- UI-CACHE-01..04; authRestoreModel: reject/retry, known-null, late-initial-after-signout, latest-login-event
- Existing authGate/GuestGate and parent-feature tests; exact legacy/archetypes parity

**OFF behavior:** Correctness/accessibility remains active with every Oorva flag OFF..

<a id="pf-t02"></a>

### PF-T02

**Evidence findings:** PF-F03. **Logical WP:** O13. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\app\(auth)\verify.tsx`; `app\app\(auth)\role.tsx`; `app\src\lib\returningUser.ts`; `app\src\lib\__tests__\authContinuation.test.ts`.

**Required edits:**

1. Separate successful OTP verification from mandatory profile/provider lookup so Retry never consumes the OTP again.
2. Keep failed lookup distinct from null row, with readable retry and no role/profile write on failure.
3. Add a pure shared destination resolver: invite first, safe returnTo second, existing role default last. Keep actual role selection and protected-tree timing.

**Acceptance:**

- Returning provider plus valid venue/booking intent returns to that destination rather than dashboard.
- Known-missing provider preserves the existing returningUserRole fallback, but provider lookup error does not impersonate a missing row.
- Invite continuation remains customer-oriented; malformed/external returnTo is not followed.

**Tests (requirements, NOT RUN):**

- authContinuation: profile error, provider error, OTP-called-once retry, customer/provider returnTo, invite precedence, known-null rows

**OFF behavior:** Correctness/accessibility remains active with every Oorva flag OFF..

<a id="pf-t03"></a>

### PF-T03

**Evidence findings:** PF-F04. **Logical WP:** O13. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\app\location.tsx`; `app\src\lib\locationContext.tsx`; `app\src\lib\locationModel.ts`; `app\src\components\AddressEditor.tsx`; `app\src\lib\__tests__\locationModel.test.ts`; `app\src\lib\__tests__\locationActorState.test.ts`.

**Required edits:**

1. Skip listMyAddresses and private editor while signed out; offer contextual sign-in without blocking existing public search/GPS/areas.
2. Key list/editor loads to confirmed userId, cancel/ignore late loads, clear on actor change and expose reload failure.
3. Under the existing storage key, add versioned saved-selection owner metadata. Do not treat auth-loading null as confirmed logout; accept saved private cache only for its owner. Drop unknown-owner legacy saved selections, not public GPS/search/area choices.
4. After confirmed delete remove that row immediately; a reload failure may show stale remaining current-actor data with an error, never a successful fresh state.
5. Let saved-address rows show complete decisive address information.

**Acceptance:**

- Guest selection makes zero private address API calls.
- A->logout/B clears private list/editor/selection; a late A response cannot restore them.
- Delayed auth restore for owner A does not prematurely erase A's saved selection.
- Delete-success/reload-failure does not leave the deleted action row.
- Long address remains understandable at320width/200%.

**Tests (requirements, NOT RUN):**

- locationActorState: guest, loading->same-owner, A->B, logout, stale promise, legacy cache, delete/reload error
- Existing locationModel/geocoding/address owner tests; no new public grants

**OFF behavior:** Correctness/accessibility remains active with every Oorva flag OFF..

<a id="pf-t04"></a>

### PF-T04

**Evidence findings:** PF-F05. **Logical WP:** O11. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\app\(provider)\_layout.tsx`; `app\app\admin\_layout.tsx`; `app\src\lib\accessPresentation.ts`; `app\src\lib\__tests__\accessPresentation.test.ts`.

**Required edits:**

1. Replace provider checkingAccess=null render with an existing readable loader.
2. Use actor-keyed admin lookup with explicit transport error/retry and genuine denial redirect; reject stale actor results.
3. Keep actual owner/staff/admin backend permission and navigation distinctions; no broad client privilege inference.

**Acceptance:**

- No blank access-check frame.
- RPC error offers Retry without admin children or false denial.
- Known false denies; true allows only current actor; actor switch rechecks.

**Tests (requirements, NOT RUN):**

- accessPresentation: loading/error/retry/deny/allow/actor-switch; existing navigation role tests

**OFF behavior:** Correctness/accessibility remains active with every Oorva flag OFF..

<a id="pf-t05"></a>

### PF-T05

**Evidence findings:** PF-F06. **Logical WP:** O13. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\app\byo\[token].tsx`; `app\src\lib\byoInvitePresentation.ts`; `app\src\lib\__tests__\byoInvitePresentation.test.ts`.

**Required edits:**

1. Use token/request-keyed loading/available/unavailable/error state; a failed fetch is not invalid/expired.
2. Store known claimed bookingId before invoking payment. Once claim commits, remove Claim and route recovery through existing booking/payment UI without re-claim.
3. Invalidate prior token callbacks and use canonical preview amounts, existing fee policy and backend state rejection.
4. Use auto-height participant/price rows and contextual sign-in; preserve technical invite token and URL scheme.

**Acceptance:**

- Network failure has Retry and no false invalid-link claim.
- Old-token response cannot enable a new token's action.
- Claim success + payment cancellation/error never calls claim twice and retains a View booking/payment recovery path.
- Expired/used null remains unavailable; self-claim/server invalid state still rejects.

**Tests (requirements, NOT RUN):**

- byoInvitePresentation: preview-null/error/stale-token, claim-success/payment-error/cancel, completed-action replacement
- Existing BYO SQL guard/amount tests retained; targeted money/auth review

**OFF behavior:** Correctness/accessibility remains active with every Oorva flag OFF..

<a id="pf-t06"></a>

### PF-T06

**Evidence findings:** PF-F07, PF-F08. **Logical WP:** O36. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\app\assistant.tsx`; `app\app\assistant-history.tsx`; `app\src\lib\assistant\history.ts`; `app\src\lib\assistant\conversationState.ts`; `app\src\lib\assistant\__tests__\conversationState.test.ts`.

**Required edits:**

1. Check effective ai capability in auto-send/send/transcribe entry points and invalidate pending work on OFF.
2. Use a conversation generation key for history, auto-resume, photo and voice callbacks; New chat aborts/reset transient state.
3. Show explicit selected-conversation loading/error/unavailable/empty without pretending it opened successfully.
4. Keep existing server feature/JWT gates, photo privacy lock, owner-only history RLS, stop/retry and review-before-book semantics.

**Acceptance:**

- Known ai OFF + q invokes zero transport calls.
- Late A resume cannot replace B or a new chat.
- New chat cannot inherit old voice/photo/draft callbacks.
- Explicit failed/empty conversation is visible and retryable; no unauthorized history read is introduced.

**Tests (requirements, NOT RUN):**

- conversationState: OFF auto-send, live OFF abort, A/B load race, new-chat resume race, stale photo/voice, selected-load error/empty

**OFF behavior:** Correctness/accessibility remains active with every Oorva flag OFF..

<a id="pf-t07"></a>

### PF-T07

**Evidence findings:** PF-F09. **Logical WP:** O02. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\src\theme\tokens.ts`; `app\src\branding\colorContract.ts`; `app\src\branding\defaults.ts`; `app\src\branding\__tests__\validation.test.ts`.

**Required edits:**

1. Add onDanger and dangerPressed to strict planned color/default contracts; legacy onDanger=#FFFFFF and dangerPressed=#B42318 both themes.
2. Include destructive default/pressed, unread numeric, selected counts and assistant send controls in actual-used-pair validation.
3. Keep ordinary onPrimary/segmentThumb and unrelated legacy colors; new Oorva colors remain class B.

**Acceptance:**

- Every normal text foreground/fill pair passes4.5, including dark pressed.
- Unknown/malformed contrast-breaking runtime overrides reject appearance, not valid flags.

**Tests (requirements, NOT RUN):**

- Color fixtures: current failing unread/dark-pressed pairs rejected; chosen safe replacements and all Oorva/default pairs pass

**OFF behavior:** Correctness/accessibility remains active with every Oorva flag OFF..

<a id="pf-t08"></a>

### PF-T08

**Evidence findings:** PF-F09, PF-F10. **Logical WP:** O06. **Class:** A. **Source task prerequisites:** PF-T07.

**Proposed source files (canonical allocation takes precedence):** `app\src\components\ui\Button.tsx`; `app\src\components\ui\Badge.tsx`; `app\src\components\ui\CountBadge.tsx`; `app\src\components\ui\IconButton.tsx`; `app\src\components\ui\Text.tsx`; `app\src\components\ui\Input.tsx`; `app\src\components\ui\OTPInput.tsx`; `app\src\components\ui\SegmentedControl.tsx`; `app\src\components\ui\Stepper.tsx`.

**Required edits:**

1. Use onDanger/dangerPressed for destructive and dangerStrong/onDanger for unread counts; reuse CountBadge for IconButton numeric overlays.
2. Replace literal white on theme primary with onPrimary for chip/step/segment counts; O36 applies the same stable roles to assistant mic/send.
3. Remove one-line/tight-scaling constraints on decisive labels/actions/amounts; auto-height containers and critical type variants support200%.
4. Adapt step progress to width/count; reduced-motion rail updates are static. Keep native value/submit/quantity semantics.

**Acceptance:**

- Actual rendered used-pair checks pass both themes and all Oorva OFF.
- 320width/200% critical labels, counts and amounts remain complete and tappable.
- Seven-step/long-label progress never overflows available width; selection/value behavior unchanged.

**Tests (requirements, NOT RUN):**

- Primitive component tests: unread0/99+, dark destructive pressed, long action/full amount, long chip/status and narrow progress, reduced motion

**OFF behavior:** Correctness/accessibility remains active with every Oorva flag OFF..

<a id="pf-t09"></a>

### PF-T09

**Evidence findings:** PF-F11. **Logical WP:** O07. **Class:** A. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\src\components\DemoDataIndicator.tsx`; `app\src\components\ui\Screen.tsx`; `app\src\components\ui\Toast.tsx`; `app\src\components\ui\BottomSheet.tsx`; `app\src\components\ui\Confirm.tsx`; `app\src\components\RouteErrorBoundary.tsx`.

**Required edits:**

1. Place demo disclosure in one reserved shell slot, leaving primary footer/tab/toast regions free; keep actual demo detection/disclosure.
2. Retain Screen's measured footer/toast offsets and single header top inset; do not add arbitrary per-screen spacers.
3. Keep provider-independent crash fallback free of Reanimated/theme context imports; add native release hook only in O34.
4. Use semantic toast text/action/accent roles and explicit keyboard/reduced-motion acceptance for modal footers; preserve confirmation policy.

**Acceptance:**

- Demo marker is visible but intersects no CTA/tab/toast bounds.
- Footer moves with keyboard without double safe area; native tests required before platform PASS.
- Crash-before-provider stays readable; destructive confirmation keeps real backend reason/policy.

**Tests (requirements, NOT RUN):**

- Shell/overlay bounds at320/large-text, keyboard/footer/toast/demo; reduced-motion sheet/progress; crash fallback

**OFF behavior:** Correctness/accessibility remains active with every Oorva flag OFF..

<a id="pf-t10"></a>

### PF-T10

**Evidence findings:** PF-F12. **Logical WP:** O05B. **Class:** B. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\src\branding\BrandLogo.tsx`; `app\src\branding\identity.ts`; `app\src\branding\defaults.ts`.

**Required edits:**

1. Implement pure context-keyed identity selection for legacy/Oorva/published supported display fields.
2. Supply explicit legacy labels for login, AI, support, BYO and the separately owned Nearo receipt/checkout contexts.
3. Bind only selected genuine vector/export assets; expose stable identity API for screen owners, not a global string replacement.

**Acceptance:**

- Brand OFF keeps each legacy context; unsupported appearance cannot freeze OFF.
- Historical financial snapshots, references, IDs and scheme unchanged.

**Tests (requirements, NOT RUN):**

- Identity context matrix: mixed legacy names, brand/runtime OFF, asset failure, selected assets, invalid schema

**OFF behavior:** Existing per-context identity/composition remains when its effective brand/family switch is OFF..

<a id="pf-t11"></a>

### PF-T11

**Evidence findings:** PF-F13. **Logical WP:** O33. **Class:** B. **Source task prerequisites:** None.

**Proposed source files (canonical allocation takes precedence):** `app\app.json`; `app\eas.json`; `app\native-release.json`; `.github\workflows\publish-app.yml`; `.github\workflows\build-apk.yml`.

**Required edits:**

1. Follow exact A.4.1 assets and A.4.5 canonical runtime/channel/capability manifest.
2. Coordinator applies shared workflow/profile edits after active owner locks; old apk-1 does not receive new native imports.
3. Use a reviewed candidate branch/runtime/channel and approved device-reachable non-production backend; record all running/native source identities.
4. Keep final public rights/native cutover/signing/iOS limitations as explicit real gates, not future source-audit questions.

**Acceptance:**

- Three cold starts after unrelated main publish retain reviewed code.
- Correct old-runtime/Expo-Go/web behavior; installed name/icon/splash/notification actual evidence.
- No iOS/public/native completion claim without its real build/device/gate.

**Tests (requirements, NOT RUN):**

- NATIVE-IDENTITY and actual supported-platform matrix; no main/native promotion before E1+D07b

**OFF behavior:** Existing per-context identity/composition remains when its effective brand/family switch is OFF..

<a id="pf-t12"></a>

### PF-T12

**Evidence findings:** PF-F14. **Logical WP:** O34. **Class:** C. **Source task prerequisites:** PF-T01, PF-T02, PF-T11.

**Proposed source files (canonical allocation takes precedence):** `app\app\_layout.tsx`; `app\src\branding\launchBootstrap.ts`; `app\src\branding\LaunchExperience.tsx`; `app\src\branding\launchModel.ts`; `app\assets\brand\launch-geometry.json`; `app\src\components\RouteErrorBoundary.tsx`.

**Required edits:**

1. Implement A.4.4 exactly: binary eligibility before native adapter,250ms cache/800ms first-live-controls/1000ms font bound and2500ms native watchdog.
2. Use native-identical bundled OS-themed frame0 with symbol already visible; freeze supported cached/bundled duration and scale phases, zero/reduced static path.
3. Settle protected auth/URL/notification intent; never route home as an animation side effect. OFF cancels without asset/schema dependency.
4. Use the required O33 GREEN candidate stack before D07b; record real geometry/routes/errors and delivery identities.

**Acceptance:**

- No symbol disappearance, unbounded native splash, unwanted resume replay or home-first deep-link flash.
- Web/Expo-Go/old binaries never evaluate missing module.
- All15 launch cases have truthful platform evidence or explicit resource gate, not a made-up success.

**Tests (requirements, NOT RUN):**

- LAUNCH-01..15 unit/frame/device/intent cases; local notification proves route intent only, not remote X2

**OFF behavior:** Existing per-context identity/composition remains when its effective brand/family switch is OFF..
