# QuickServe — UI Redesign: AI Implementation Execution Plan (Document 2 of 2)

| | |
|---|---|
| **Status** | **Approved for implementation by the owner on 2026-11-18; doc 13 §I recommendations adopted where input was needed.** |
| **Code baseline** | Audit snapshot `main` @ `2c59548` (latest migration `0058_sports_payments.sql`); execution starts from `origin/main` @ `1586a09`. Doc 17 takes migration `0059`; this plan uses the next free migration number at merge time. |
| **Audience** | The implementing model and the agents it launches. Every step is meant to be followed literally. Do not make product or design decisions. If something is not specified here or in doc 13, **stop and report**; do not guess. |
| **Sequencing (overrides §5 where they conflict)** | [doc 17](17-Nearo-Audit-Remediation-Implementation-Plan.md) functional fixes take priority. **Q-00 is doc 17 task T1, owned there**: do not run it twice. R-01 waits for doc 17 H3, R-02 for U1, R-03 for B1, R-04 for B2, R-05 for O4 (or immediately if O4 is deferred), and R-06 for S2. B-01/G-01 wait for doc 17 X1 and R1; G-01 also waits for U3. H-01 and A-01 wait for U3; SH-01 waits for P1a; BD-01 waits for U3. Doc 12's `0059` reservation is released; every migration here takes the next free number at merge time. |
| **Rule zero** | Preserve every existing feature, route, API call, status, flag and test. Visual work never changes business logic, RPC arguments or navigation targets unless a task says so explicitly. |

---

## 0. Execution protocol (read fully before launching anything)

### 0.1 Roles
- **Integrator (lead model).** Creates worktrees, launches agents, reviews diffs, merges green lanes in the §5 order, and owns the integrator files (§0.4). It never implements a READY task itself while other READY tasks are waiting.
- **Task agent.** Runs one task in one worktree on one lane branch. It edits only files listed under *Owns* in its task, plus new files it creates under the paths named in the task.

### 0.2 Mandatory validation loop
Follow `.github/copilot-instructions.md` → **Fast validation loop**, rules 1–10. Summary:
1. Do not run local `npm`, `npx`, Jest, tsc or Expo. CI is the only test runner.
2. Push the lane: `git push origin HEAD:refs/heads/lane/<TASK-ID>`. `lane-ci.yml` runs app typecheck and Jest.
3. After a red run, read **all** failures (`gh run view <id> --log-failed`) and fix them in **one** push.
4. A task is done only when its lane run is green. Report the run ID.
5. Watch runs in the background (`gh run watch <id> --exit-status`); never poll in a loop.

### 0.3 Agent prompt template (integrator copies this, fills `<…>`)
```
You are implementing task <TASK-ID> from docs/14-UI-Redesign-AI-Execution-Plan.md in the QuickServe repo.
Worktree: <path>. Branch: lane/<TASK-ID>, created from origin/main @ <sha>.
1. Read docs/14 §0, §1, §2, §3 (only the component specs your task uses), and your task section in §4.
2. Read docs/13 sections referenced by your task.
3. Edit ONLY files listed under "Owns", plus new files at the paths your task names. Any other file is out of bounds: if you need it changed, stop and report.
4. Follow .github/copilot-instructions.md "Fast validation loop". No local npm/jest/tsc/expo.
5. Write the Jest tests listed in your task FIRST (they must fail for the intended reason), then implement.
6. Self-check: run `git diff --check`; grep your diff for '#[0-9A-Fa-f]{6}' and 'fontSize:' (both must be absent in new code); confirm every new Pressable has accessibilityRole + accessibilityLabel.
7. Commit with message "<type>(ui): <TASK-ID> <summary>" plus the repo's Co-authored-by trailer. Push lane/<TASK-ID>. Watch lane CI until green, fixing all failures per run in one push.
8. Report: files changed, test names added, lane CI run ID (green), and anything you could not do.
```

### 0.4 Integrator-owned files (agents must never edit these)
| File | Why |
|---|---|
| `.github/workflows/*` | Shared CI |
| `app/src/components/ui/index.ts` | Barrel. New components are **not** added here (see §2.3). |
| `app/src/i18n/en.ts`, `app/src/i18n/te.ts` | All new keys are added once by task **I-01** (integrator runs it) |
| `supabase/tests/package.json` | Test registration |
| `docs/01-PRD.md`, `docs/13-*.md`, `docs/14-*.md` | Status tables |

### 0.5 Feature flags
- New behavior flags (seeded **off** by task B-01): `home_v2`, `unified_search`, `guest_browse`, `creators_landing`, `booking_steps`, `book_again`.
- Read them with `useAppFeatureFlags().isOn('<key>')`. An unknown key evaluates to **false** (`app/src/lib/featureFlagModel.ts`), so flagged UI is safe to merge before B-01 is applied.
- Every flagged task must keep the **flag-off path identical to today** and test both states.

### 0.6 Owner orchestration override (2026-11-18)
The owner directed the integrator to start T-01 and C-07 while doc 17 T1/Q-00 is in progress; I-01 is integrator-owned and may proceed in parallel. These tasks have no shared-file conflict with Q-00. Their implementation and lane validation may proceed now; do not merge the UI foundation tasks until all code-owned Q-00 failures are green. The admin E2E step is explicitly owner-blocked until `DEMO_PROJECT=1` and `ADMIN_E2E_PHONE` are configured; never report that step as passed or weaken its guard.

**2026-11-19 · B-01 review privacy decision:** Guest provider details must not expose the private review `insights_*`, booking, or customer fields. Use an explicit public review projection in `getProviderDetail`, with matching column-level grants and public-row RLS; keep authenticated `getReviewForBooking` behavior unchanged. The `guest_browse` parent flag and the relevant products/sports child flags must fail closed server-side.

**2026-11-19 · O4 scope decision:** O4 remains deferred as a G3 task outside the current G1/G2 completion gate. Per the sequencing row above, R-05 may proceed immediately while O4 is deferred.

---

## 1. Approved design inputs (source of truth)

Implement exactly doc 13 §D. Exact token edits for task T-01:

```ts
// app/src/theme/tokens.ts — Palette interface: add these fields (after segmentThumb)
  /** Category identity (pillars) only. Never status, never CTA fill. */
  catHome: string; catHomeSoft: string;
  catShops: string; catShopsSoft: string;
  catSports: string; catSportsSoft: string;
  catCreators: string; catCreatorsSoft: string;

// lightPalette: change these values
  primary: '#1F4FD1', primaryPressed: '#1A40AA', primarySoft: '#EEF2FD', primaryText: '#1F4FD1',
  bubbleMine: '#1F4FD1', heroFrom: '#1F4FD1', heroTo: '#1A40AA',
// lightPalette: add
  catHome: '#0F766E', catHomeSoft: '#E6F4F1',
  catShops: '#B45309', catShopsSoft: '#FEF3E2',
  catSports: '#BE185D', catSportsSoft: '#FCE7F1',
  catCreators: '#6D28D9', catCreatorsSoft: '#F1EBFE',
// darkPalette: add (dark primary values stay unchanged)
  catHome: '#5EEAD4', catHomeSoft: '#0B2A27',
  catShops: '#FCD34D', catShopsSoft: '#2E2208',
  catSports: '#F9A8D4', catSportsSoft: '#33101F',
  catCreators: '#C4B5FD', catCreatorsSoft: '#221447',
```

Pillar keys used everywhere (type `Pillar` exported from `app/src/components/market/pillars.ts`, created by C-02):

| `Pillar` | Label (i18n key) | Ionicon | Accent tokens | Route | Shown when |
|---|---|---|---|---|---|
| `home` | `pillar.home` | `construct-outline` | `catHome` / `catHomeSoft` | Home v2 drills into the catalogue (H-01 step 5) | catalogue has ≥ 1 non-creator category |
| `shops` | `pillar.shops` | `storefront-outline` | `catShops` / `catShopsSoft` | `/shop` | `isOn('products')` |
| `sports` | `pillar.sports` | `football-outline` | `catSports` / `catSportsSoft` | `/sports` | `isOn('sports')` |
| `creators` | `pillar.creators` | `color-palette-outline` | `catCreators` / `catCreatorsSoft` | `/creators` if `isOn('creators_landing')`, else the existing `creative-events` family drill-down | catalogue `creative-events` family has ≥ 1 category |

---

## 2. Architecture facts the agents need

### 2.1 Relevant structure (verified at `2c59548`)
```
app/app/                 Expo Router routes (79 files; inventory in doc 13 §B)
app/app/_layout.tsx      Root Stack + auth guard (lines 56–61) + providers
app/app/(customer)/      Tabs: index (Home), bookings → features/activity/UnifiedActivityScreen, account → components/AccountScreen
app/src/theme/           tokens.ts, ThemeProvider.tsx (useTheme, makeStyles)
app/src/components/ui/   Primitives: Button, Card, Badge/Chip, Input, Screen/Header/Section/StickyFooter, EmptyState/ErrorState/InlineAlert, Skeleton*, StepIndicator, SegmentedControl, Toast, Confirm …
app/src/components/      App components (CategoryIcon, TopRatedCard, ProviderCard, StatusTimeline, …)
app/src/features/<area>/ Feature modules (catalogue, sports, shops, rfq, recurring, activity, booking, providerOnboarding, …)
app/src/lib/             api.ts, supabase.ts, featureFlags.ts, money.ts (formatINR), locationContext …
app/src/i18n/            en.ts (source), te.ts (Partial draft, falls back to en), index.tsx (useT)
e2e/web-smoke.mjs, e2e/all-services.mjs   Playwright web E2E (main only today)
```

### 2.2 Existing primitive APIs (reuse; do not re-implement)
- `Card({ variant?: 'elevated'|'outlined'|'filled'|'tinted', tint?, padding?, elevation?, gap?, onPress?, accessibilityLabel?, accessibilityHint?, style?, children })`
- `Chip({ label, selected, onPress, icon, leading, trailingIcon, count, disabled, check = true, accessibilityLabel, style })`
- `Badge({ label, tone?: 'neutral'|'primary'|'success'|'warning'|'danger'|'info', icon?, dot?, size?: 'sm'|'md' })`
- `Screen({ header?, footer?, scroll?, refreshing?, onRefresh?, padded?, gap?, inTabs?, safeTop?, gutter?, contentStyle?, children })`. The `footer` is sticky.
- `StepIndicator({ steps: string[], current: number })`
- `Skeleton({ width?, height?, radius?, style? })`
- `formatINR(paise: number)`. All money values are in **paise**.

### 2.3 Where new code goes
- New shared marketplace components: `app/src/components/market/<Name>.tsx`. Import by direct path (`../../src/components/market/ListingCard`), **not** through `ui/index.ts`. Their tests go in `app/src/components/market/__tests__/<Name>.test.tsx`.
- Pure logic (no React Native imports) goes in `*.ts` model files. Jest tests import model files only, **never** route files under `app/app/` (known Jest failure: Expo route files pull in React Native internals).
- Screen bodies extracted from routes go to `app/src/features/<area>/…`. The route file becomes a thin wrapper, like `app/app/venue/[id].tsx`.

### 2.4 i18n keys (added once by I-01; agents only read them with `const t = useT(); t('key')`)
```
pillar.home = Home services                 pillar.shops = Shops & products
pillar.sports = Sports & venues             pillar.creators = Creators & freelancers
pillar.home.sub = Repairs, cleaning, cooks & more
pillar.shops.sub = Products and bulk quotes from nearby shops
pillar.sports.sub = Book courts, turfs and coaching
pillar.creators.sub = Video, photos, design and more
home.searchPlaceholder = Search services, shops, venues…
home.popularIn = Popular in {city}
home.activeBooking = Active booking
trust.verified = Verified providers         trust.price = See the price before you pay
trust.payments = Secure online payments
ai.cardSubtitle = Describe the problem in English or తెలుగు
search.title = Search                       search.placeholder = What are you looking for?
search.scope.all = All   search.scope.services = Services   search.scope.shops = Shops
search.scope.sports = Sports   search.scope.creators = Creators
search.minChars = Type at least 2 letters   search.noResults = No results for "{q}"
search.seeAll = See all                     search.recent = Recent searches
tabs.home = Home  tabs.search = Search  tabs.bookings = Bookings  tabs.account = Account
badge.verified = Verified
listing.from = From {price}                 listing.perHour = {price}/hr
listing.kmAway = {km} km away
creators.title = Creators & freelancers     creators.how = How it works
creators.step1 = Send a brief   creators.step2 = Compare proposals
creators.step3 = Approve and pay   creators.step4 = Get delivery
booking.step.type = Booking type   booking.step.time = Date & time
booking.step.address = Address     booking.step.review = Review & pay
booking.bookAgain = Book again
guest.signInToContinue = Sign in to continue
error.generic = Something went wrong. Please try again.
error.network = You seem to be offline. Check your connection and retry.
error.signIn = Please sign in to continue.
ai.busy = QuickServe AI is busy. Try again in a minute.
feature.off = {feature} is not available right now
rfq.banner = Need bulk quantity? Get quotes from 3+ shops
compare.lowest = Lowest price
```
(`{x}` = interpolation variable; `useT()` supports `t(key, vars)`.)

---

## 3. Shared component specifications

All components:
- Use `useTheme()` tokens only (no hex, no raw `fontSize`).
- Render text through `<Text variant>`.
- Provide `accessibilityRole` and `accessibilityLabel` on every pressable.
- Have touch targets ≥ 48.
- Support dark mode through tokens.
- Ship with Jest tests for their pure helpers.

### 3.1 `SearchField` — `components/market/SearchField.tsx` (task C-01)
```ts
export interface SearchFieldProps {
  mode: 'entry' | 'input';          // entry = looks like an input, acts as a button (Home)
  value?: string;                   // required when mode='input'
  onChangeText?: (v: string) => void;
  onSubmit?: (v: string) => void;
  onPress?: () => void;             // required when mode='entry'
  placeholder: string;
  autoFocus?: boolean;
  testID?: string;
}
```
Behavior:
- Height 48, radius `radii.md`, `surface` background, 1 px `borderStrong` border, `shadows.sm`.
- Leading `search` icon (20, `muted`).
- In `input` mode, show a clear button (`close-circle`, 40 visual / 48 hit) when the value is non-empty.
- `entry` mode renders a `Pressable` with `accessibilityRole="search"` and label = placeholder; it is not editable.
- `input` mode uses `TextInput` with `returnKeyType="search"`.
- Web outline removal must be done in a `Platform.OS === 'web'` style object, **not** with an `as never` cast.

Tests: `searchQuery.ts` exports `normalizeQuery(s)`, which trims and collapses spaces, plus `isSearchable(s)`, which requires ≥ 2 characters. Unit test both.

### 3.2 `PillarCard`, `TrustStrip`, `VerifiedBadge`, `pillars.ts` (task C-02)
```ts
// pillars.ts (pure)
export type Pillar = 'home' | 'shops' | 'sports' | 'creators';
export const PILLAR_ORDER: Pillar[] = ['home', 'shops', 'sports', 'creators'];
export function visiblePillars(input: { hasHome: boolean; hasCreators: boolean; productsOn: boolean; sportsOn: boolean }): Pillar[];
export function pillarAccent(p: Pillar, colors: Palette): { fg: string; soft: string };

// PillarCard.tsx
export function PillarCard(props: { pillar: Pillar; title: string; subtitle: string; onPress: () => void; testID?: string }): JSX.Element;
// TrustStrip.tsx
export function TrustStrip(props: { items: { icon: IconName; label: string }[] }): JSX.Element; // exactly 3 items
// VerifiedBadge.tsx
export function VerifiedBadge(): JSX.Element; // <Badge tone="success" icon="shield-checkmark" label={t('badge.verified')} />
```
`PillarCard` layout:
- `Card variant="outlined"`, `minHeight: 132`, width set by the parent grid (`'48%'`).
- 44×44 circle filled with `soft`, containing the Ionicon (24) in `fg`.
- Title `calloutStrong` (2 lines max); subtitle `caption` + `muted` (2 lines max).
- `accessibilityLabel = "{title}. {subtitle}"`.

`TrustStrip` layout:
- A row of 3 equal columns, each with an icon (20, `primaryText`) above a `caption` label (center, 2 lines).
- `Card variant="filled"`. No gradient.

Tests: `visiblePillars` truth table. All on → 4 in `PILLAR_ORDER`. `productsOn=false` → no `shops`. `hasHome=false && hasCreators=false && !productsOn && !sportsOn` → `[]`.

### 3.3 `ListingCard` + `MediaImage` (task C-03)
```ts
export type ListingVariant = 'provider' | 'venue' | 'shop' | 'product' | 'creator';
export interface ListingCardProps {
  variant: ListingVariant;
  title: string;
  subtitle?: string;          // e.g. "Kondapur, Hyderabad · 2.1 km away"
  imageUrl?: string | null;   // venue/product/shop/creator image
  avatarName?: string;        // provider/creator: initials fallback via existing Avatar
  rating?: number | null;     // 0–5, shows RatingStars + value when not null
  ratingCount?: number;
  verified?: boolean;         // shows VerifiedBadge
  priceLabel?: string | null; // already formatted, e.g. t('listing.from', { price: formatINR(p) })
  tags?: string[];            // max 2 shown as Badge tone="neutral"
  layout?: 'row' | 'grid';    // grid = product 2-column tile
  onPress: () => void;
  testID?: string;
}
// MediaImage.tsx
export function MediaImage(props: { uri?: string | null; aspectRatio: number; radius?: number; fallbackIcon: IconName; accessibilityLabel?: string }): JSX.Element;
```
`ListingCard` layout:
- **`row` layout:** `Card` (one pressable, the `Card` itself; never wrap it in another `Pressable`). Media is `MediaImage` at aspect 16:9 for `venue`/`shop`, or `Avatar` 48 for `provider`/`creator` when there is no image. Then title (`bodyStrong`, 1 line), subtitle (`footnote` `muted`, 1 line), and a row of rating · tags · `VerifiedBadge`. Price (`calloutStrong`) sits right-aligned in the last row.
- **`grid` layout (product):** `MediaImage` 1:1, then title (2 lines), then price.
- **`MediaImage`:** `expo-image` with `contentFit="cover"` and a fixed `aspectRatio`. When `uri` is empty or fails to load, show a `surfaceAlt` box with `fallbackIcon` (28, `subtle`) centered. Show a `Skeleton` until loaded. The layout height never changes.

Tests: `listingModel.ts` exports `listingA11yLabel(props)`, which joins title, subtitle, rating, "verified" and price; unit test it. It also exports `visibleTags(tags)`, which returns at most 2.

### 3.4 `ChipRow` (task C-04)
```ts
export function ChipRow<T extends string>(props: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  accessibilityLabel: string;
}): JSX.Element;
```
A horizontal `ScrollView` of the existing `Chip` with `check={false}`, `selected={o.value === value}`, gap `spacing.sm`, and horizontal padding `spacing.lg`. Use `accessibilityRole="tablist"` on the container.

### 3.5 `PriceFooter` (task C-05)
```ts
export function PriceFooter(props: {
  caption: string;                 // e.g. "To pay now", "Repairs · visit fee"
  amountLabel: string;             // already formatted text
  cta: { title: string; onPress: () => void; disabled?: boolean; loading?: boolean; leftIcon?: IconName; accessibilityHint?: string };
  note?: { text: string; tone?: 'muted' | 'warningText' } | null;
  above?: React.ReactNode;         // optional message above the row (e.g. city mismatch)
  amountVariant?: 'amount' | 'text'; // 'amount' (default) = title2 tabular; 'text' = calloutStrong (proposal: "Fixed quote per brief", provider/[id].tsx:153-165)
}): JSX.Element;
```
Extract this from the existing footers in `app/app/provider/[id].tsx` (lines 143–180) and `app/app/book/[providerServiceId].tsx` (lines 276–300). The rendered output for both screens must be **pixel-identical** to today: same variants, `Button size="lg"` with `flex: 1`, and amount in `title2 tabular`. C-05 creates the component only. Adoption happens in HS-01/HS-02.

### 3.6 `QuoteCompareTable` (task C-06)
```ts
export interface CompareRow { id: string; who: string; pricePaise: number; detail1?: string; detail2?: string; rating?: number | null }
export function QuoteCompareTable(props: { rows: CompareRow[]; detailHeaders: [string?, string?]; selectLabel: string; onSelect: (id: string) => void; selectedId?: string | null }): JSX.Element;
```
- Rows are sorted by price ascending (pure helper `sortByPrice`).
- The lowest row gets `Badge tone="success" label={t('compare.lowest')}`.
- Each row is a `Card` with a `Button size="sm"` select.
- Tests: `sortByPrice` handles ties stably; the lowest-price badge goes only to the first row of the minimum.
- **Summary only.** `QuoteCompareTable` is a summary *above* detailed cards, never a replacement for them. Extra props: `warnings?: Record<string, string[]>` (per row id, rendered as `Badge tone="warning"`), `selectable?: (id: string) => boolean` (the select button is hidden when false), and `excludeFromLowest?: (id: string) => boolean` (incomplete quotes never get the lowest badge).

### 3.7 `friendlyError` (task C-07)
`app/src/lib/errors.ts`:
```ts
export function friendlyError(e: unknown): { key: 'error.generic' | 'error.network' | 'error.signIn' | 'ai.busy'; raw: string };
```
Mapping:
| Condition | Key |
|---|---|
| Message matches `/network|fetch failed|Failed to fetch/i` | `error.network` |
| `/JWT|not authenticated|401/i` | `error.signIn` |
| `/429|rate limit/i` | `ai.busy` |
| Anything else | `error.generic` |

- `raw` is kept for logs.
- Reuse the existing patterns in `src/lib/onboarding/supabaseOnboarding.ts` → `friendlyDbError`. Do **not** change that function.
- Jest: one case per mapping branch.

### 3.8 `BookingStepLayout` (task C-08; requires C-05 merged)
```ts
export function BookingStepLayout(props: { title: string; steps: string[]; current: number; footer: React.ReactNode; children: React.ReactNode; onBack?: () => void }): JSX.Element;
```
`Screen` with `header={<Header title onBack />}`, then `StepIndicator({ steps, current })` as the first child, then children. `footer` is passed through to `Screen footer`. No logic.

---

## 4. Task specifications

Format: **Owns** = files the task may edit or create. **Blocked by** = tasks that must be merged to `main` green first. **Parallel** = may run at the same time as listed tasks.

### Phase 0 — Baseline (strictly first)

#### Q-00 Make `main` E2E green (= doc 17 T1; executed there, listed here only as a dependency)
- **Objective:** Fix the 7 failed steps of run `44365580570` so the redesign has a trustworthy baseline: `home`, `home-family-drilldown-and-marketplace-entry-points`, `category-packers-movers`, `category-kitchen-cleaning`, `phase-6-sports-booking-request`, `my-activity-sports-segment`, `assistant`.
- **Owns:** `e2e/web-smoke.mjs`, `e2e/all-services.mjs`. An app file is allowed **only** when the root cause is a real app bug; list it in the report.
- **Steps:**
  1. Run `gh run view 44365580570 --log-failed > q00.log` and read every failed step.
  2. For each step, record the selector or assertion that failed and the actual page state (screenshot artifact).
  3. Classify each step as one of:
     - **(a) Stale selector or copy**, typically after the F1a/F1b sports UI merge. Update the E2E.
     - **(b) Real app bug.** Fix it in the app with a Jest test.
     - **(c) External rate limit (HTTP 429 from the AI).** Make the `assistant` step treat 429 as `skipped` with a log line, never as a pass.
  4. Fix all of them in one push to `lane/Q-00`. E2E runs on `main` only today, so ask the integrator to run Q-01 step 1 first, or merge after review and watch the `main` E2E run.
- **Acceptance:**
  - `e2e-web.yml` is green on `main` with 0 failed steps.
  - The assistant step is either green or explicitly skipped for 429.
- **Parallel:** none. This is the first task. Q-01 step 1 (workflow trigger) can be done alongside by the integrator.

#### Q-01 E2E on lanes + 3-viewport screenshot baseline (integrator)
- **Owns:** `.github/workflows/e2e-web.yml`, `e2e/web-smoke.mjs` (screenshot helper only; edit **after** Q-00 merges).
- **Steps:**
  1. Workflow triggers: `push` to `main` and to `lane/**`, plus `workflow_dispatch`. Add `concurrency: { group: e2e-shared-backend, queue: max, cancel-in-progress: false }`, because all runs share one Supabase demo backend and must not run at the same time; retain queued runs instead of replacing an existing pending run.
  2. Keep the existing screenshot directory: the workflow sets `SHOTS_DIR=${{ github.workspace }}/e2e-shots` (`e2e-web.yml:105`) and already uploads `e2e-shots` (`e2e-web.yml:228`). Only confirm `if: always()` and set retention to 14 days.
  3. Today `web-smoke.mjs` builds one context from `devices['iPhone 15']` (`web-smoke.mjs:26-34`), so an env var alone does nothing. Add a separate **screenshot-only pass**: read `E2E_VIEWPORTS` (default empty = skip). For each `WxH`, create a **new** `browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: W < 768, hasTouch: W < 768 })`, log in, and visit a fixed list of read-only routes (`/`, `/category/<first slug>`, `/sports`, `/shop`, `/bookings`, `/account`). Save each screenshot as `${SHOTS}/vp-${W}x${H}-<route>.png`. The functional steps keep the iPhone 15 context unchanged.
- **Acceptance:**
  - A `main` run uploads screenshots for all 3 viewports.
  - The integrator stores the artifact link in §7 as **baseline**.
- **Blocked by:** Q-00. **Parallel:** Phase 1 tasks.

### Phase 1 — Foundations (all parallel after Q-00 merges)

#### T-01 Design tokens
- **Owns:** `app/src/theme/tokens.ts`; new `app/src/theme/contrast.ts` (pure); new `app/src/theme/__tests__/contrast.test.ts`.
- **Steps:**
  1. **Test first:** `contrast.ts` exports `contrastRatio(fg, bg)` using WCAG relative luminance. The test asserts:
     - Every pair in doc 13 §D.1–D.2 meets its listed ratio (±0.02).
     - `text`/`textSecondary`/`muted` on `bg` and `surface` are ≥ 4.5 in light and dark.
     - `onPrimary` on `primary` is ≥ 4.5 in both palettes.
     - Every `cat*` on its `cat*Soft` is ≥ 4.5.
  2. Apply the §1 token edits exactly.
- **Regression watch:** Every screen reads `primary`. Nothing else changes.
- **Acceptance:** Lane CI is green, and the contrast test exists and passes.
- **Parallel:** all Phase 1 tasks.

#### B-01 Backend: flags + guest read access (security-sensitive: lower-model review required, rule 10)
- **Owns:** new `supabase/migrations/00NN_ui_redesign_flags_guest_read.sql` (the integrator assigns `NN` = next free number at merge time; never `0059`) and new `supabase/tests/guest_read_access.test.mjs`. Registration in `supabase/tests/package.json` is done by the integrator.
- **Steps:**
  1. Seed flags with the doc-12 pattern (`insert into public.feature_flags (key, enabled, label, description, group_name, sort_order) … on conflict (key) do nothing;`), all `enabled=false`, `group_name='Customer experience'`. Keys and labels:
     | Key | Label |
     |---|---|
     | `home_v2` | New home screen |
     | `unified_search` | Search everything |
     | `guest_browse` | Browse without signing in |
     | `creators_landing` | Creators landing page |
     | `booking_steps` | Step-by-step booking |
     | `book_again` | Book again |
  2. **Inventory of guest reads.** List every RPC or table read made by these screens when signed out:
     - Home: `get_catalog`, `listTopRated`, `getAppFeatures`
     - `category/[slug]`, `provider/[id]`
     - `sports/index` (`list_sports_activities`), `sports/[activity]` (`search_sports_venues`), `venue/[id]` (`getCustomerSportsVenue`, `getSportsSlots`)
     - `shop/index` (`search_shops`, `listProductCategories`), `products` (`searchProducts`), `product/[id]`, `shop/[id]`
     - `top-rated`, `location`
     - `category/[slug]` also calls `searchProviders` and `listCategories` (`app/app/category/[slug].tsx:80-104`).
     - **Storage:** `product/[id]` creates signed URLs in the private `product-images` bucket (`app/src/features/shops/api.ts:239-243`); the read policy allows only `authenticated` (`0049_shops_catalogue.sql:255-263`).

     Find each call in the source, and record the exact RPC/table name and argument list per screen; do not assume.
  3. **Test first:** `guest_read_access.test.mjs` uses `createHarness()` + `scenario()`. As role `anon`:
     - Each read in step 2 returns rows for active/verified data **without error**.
     - The scenario asserts it **cannot** see `phone`/`email`/address columns of providers or customers. Test this directly: `select phone from <table>` as anon must error or return null for every table/RPC the screens read.
     - As anon, a signed URL can be created only for images of **publicly visible** products (active shop + active product); it fails for any other object in `product-images`.
     - The scenario asserts that **every write RPC fails** (`create_fixed_booking`, `book_sports_slot`, `start_product_enquiry`, `create_service_request`).
  4. Migration:
     - `grant execute … to anon` only on the read RPCs that the test proves are needed.
     - **Rows** and **columns** are separate controls. RLS `select … to anon` policies limit *rows* to already-public ones (active + verified). *Columns* are limited by column-level `grant select (col1, col2…) … to anon` (pattern: existing shop grants in `0049_shops_catalogue.sql:135-141`), or by reading through a security-definer RPC that returns only public columns. Never grant table-wide select to anon.
     - Storage: add a storage `select` policy `to anon` on `product-images` that uses the same public-visibility check as `_product_image_access`, restricted to active products of active shops. **Never make the bucket public.**
     - If a read requires exposing a private column, **stop and report**.
- **Acceptance:**
  - Lane SQL run is green.
  - A lower-model review has no unresolved findings.
  - Migration applied on `main`.
- **Parallel:** all Phase 1 tasks.

#### I-01 i18n keys (integrator)
- **Owns:** `app/src/i18n/en.ts`, `app/src/i18n/te.ts`.
- **Steps:**
  1. Add every §2.4 key to `en.ts` with the exact English text.
  2. In `te.ts`, add Telugu drafts only for `pillar.*`, `tabs.*`, `trust.*` and the `search.scope.*` keys. Keep the existing `// review:` comment. Other keys fall back to English.
- **Acceptance:** Typecheck is green.
- **Parallel:** all.

#### C-07 `friendlyError`
- **Owns:** new `app/src/lib/errors.ts`, new `app/src/lib/__tests__/errors.test.ts`. Spec in §3.7.
- **Parallel:** all.

#### R-01 … R-07 Behavior-preserving file splits (no visual or logic change)
Common rules for all R tasks:
1. Move code only. Do not rename props or change JSX output, hooks order, effects, API calls or strings.
2. The route file becomes a thin wrapper that renders the extracted screen component.
3. Each extracted section is ≤ 300 lines.
4. Pure helpers move to `model.ts` with Jest tests, if the original file had untested pure helpers.
5. **Acceptance:**
   - Lane CI is green.
   - `main` E2E is green after merge, with no screenshot diffs beyond rendering noise. The integrator compares against the baseline.

| ID | Source file | Owns (new target folder) |
|---|---|---|
| R-01 | `app/app/booking/[id].tsx` (1,116) | `app/src/features/bookingDetail/*` + the route file |
| R-02 | `app/app/provider/[id].tsx` (642) | `app/src/features/providerProfile/*` + the route file |
| R-03 | `app/app/book/[providerServiceId].tsx` (684) | `app/src/features/booking/book/*` + the route file |
| R-04 | `app/src/features/activity/UnifiedActivityScreen.tsx` (628) | `app/src/features/activity/segments/*` + that file |
| R-05 | `app/app/(provider)/dashboard.tsx` (782) | `app/src/features/providerDashboard/*` + the route file |
| R-06 | `app/app/sports/manage.tsx` (706) | `app/src/features/sports/manage/*` + the route file |
| R-07 | `app/src/features/providerOnboarding/ServicesSection.tsx` (860) | `app/src/features/providerOnboarding/services/*` + that file |

R tasks run in parallel with each other and with T-01, I-01 and C-07, **but each R task first waits for its doc 17 hot-file owner** (see the Sequencing row in the header): R-01 after H3, R-02 after U1, R-03 after B1, R-04 after B2 and doc 17 S2 (sports segment first), R-05 after O4 (or immediately if O4 is deferred), R-06 after S2. R-07 has no wait.

### Phase 2 — Shared components (parallel; each blocked by T-01 + I-01)

| ID | Spec | Owns | Extra blocker |
|---|---|---|---|
| C-01 | §3.1 `SearchField` | `components/market/SearchField.tsx`, `components/market/searchQuery.ts`, tests | — |
| C-02 | §3.2 `pillars.ts`, `PillarCard`, `TrustStrip`, `VerifiedBadge` | those files + tests | — |
| C-03 | §3.3 `ListingCard`, `MediaImage`, `listingModel.ts` | those files + tests | C-02 (uses `VerifiedBadge`) |
| C-04 | §3.4 `ChipRow` | that file | — |
| C-05 | §3.5 `PriceFooter` | that file | — |
| C-06 | §3.6 `QuoteCompareTable`, `compareModel.ts` | those files + tests | — |
| C-08 | §3.8 `BookingStepLayout` | that file | C-05 |

**Acceptance for every C task:**
- Lane CI is green.
- Unit tests exist for the pure helpers.
- There are no hex or `fontSize` literals in the diff.
- Any additional component example is optional.

### Phase 3 — Screens (parallel where the blockers allow)

#### H-01 Home v2 (`home_v2`)
- **Owns:** `app/app/(customer)/index.tsx`, new `app/src/features/home/LegacyHome.tsx`, new `app/src/features/home/HomeV2.tsx`, new `app/src/features/home/homeModel.ts` + tests.
- **Blocked by:** C-01, C-02, C-03, C-04, and doc 17 U3 (same customer home route).
- **Steps:**
  1. Move the current `index.tsx` body into `LegacyHome.tsx` **unchanged**. The only exception is the AI card subtitle, which uses `t('ai.cardSubtitle')` in both homes (doc 13 §I-6).
  2. `index.tsx` = `flags.isOn('home_v2') ? <HomeV2/> : <LegacyHome/>`.
  3. `HomeV2` renders the sections in doc 13 §C.2 order:
     1. Location bar + bell (copy from Legacy).
     2. Search: when `isOn('unified_search')` is **on**, render `SearchField mode="entry"` → `router.push('/search')`. When it is **off**, render the existing inline search control and its category filtering exactly as in `LegacyHome` (do not use `SearchField` in this case).
     3. Active booking card (copy from Legacy).
     4. Pillar grid: `visiblePillars(...)` → `PillarCard` 2 per row, gap `spacing.md`.
     5. `Popular in {city}`: `ChipRow`-styled list of the first 8 `catalogue.categories` (catalogue order) → `router.push('/category/' + slug)`.
     6. AI card (Legacy markup, new subtitle).
     7. Top rated (`ListingCard variant="provider"`, horizontal; reuse Legacy snap logic).
     8. `TrustStrip` with `trust.verified`, `trust.price`, `trust.payments`.

     No `LinearGradient` import in `HomeV2`.
  4. Pillar `home` press: show the existing family drill-down UI (the Legacy `selectedFamily` view) filtered to all home verticals. Pillar `creators` press: see §1.
  5. `homeModel.ts`: `popularCategories(catalogue, n=8)` and `pillarInputs(catalogue, flags)`, both with Jest tests.
- **Regression watch:**
  - With `home_v2` off, Home must be identical (screenshots).
  - E2E steps `home` and `home-family-drilldown…` must stay green with the flag off.
- **Acceptance:**
  - Jest covers both helpers.
  - Q-02 adds E2E coverage for the flag-on state.

#### H-02 Search tab + screen (`unified_search`)
- **Owns:** `app/app/(customer)/_layout.tsx`, new `app/app/(customer)/search.tsx`, new `app/src/features/search/*` (`SearchScreen.tsx`, `searchModel.ts`, `api.ts`, tests).
- **Blocked by:** C-01, C-03, C-04, and doc 17 P1a (same shop/product files).
- **Steps:**
  1. Tabs: add `Tabs.Screen name="search"` between Home and Bookings with `href: flags.isOn('unified_search') ? undefined : null` (hidden when off) and the `search`/`search-outline` icon. Rename the "Me" title to `t('tabs.account')`. Change no other tab.
  2. `api.ts` → `searchEverything(q, ctx)` runs `Promise.allSettled` over:
     - `getCatalogue(city)`
     - `supabase.rpc('list_sports_activities')` (only if `sports` is on)
     - `searchProducts({ query: q, lat, lng })` (only if `products` is on)
     - `searchShops(lat, lng)` (only if `products` is on)

     A rejected source becomes an empty group plus a per-group `InlineAlert`, never a full-screen error.
  3. `searchModel.ts` → `groupResults(raw, q, scope)`:
     - Filter by `normalizeQuery`, case-insensitive `includes` on the name.
     - Split catalogue into `services` vs `creators` using the `creative-events` family verticals from `groupCatalogueFamilies`.
     - Return at most 5 per group.
     - Pure, with Jest tests: scope filtering, max 5, empty query → no groups, and the creators split.
  4. UI:
     - `SearchField mode="input" autoFocus`, then a scope `ChipRow`, then grouped `Section`s of `ListingCard`s.
     - Debounce 300 ms. When fewer than 2 characters → `search.minChars`.
     - Empty → `EmptyState` `search.noResults`.
     - Loading → 3 `Skeleton` cards.
  5. Navigation targets:
     | Result type | Route |
     |---|---|
     | Service or creator category | `/category/[slug]` |
     | Sports activity | `/sports/[activity]` |
     | Product | `/product/[id]` |
     | Shop | `/shop/[id]` |
- **Acceptance:**
  - With the flag off, the tab is hidden and `/search` shows `feature.off`.
  - Jest is green.

#### G-01 Guest browsing (`guest_browse`)
- **Owns:** `app/app/_layout.tsx`, `app/app/(auth)/login.tsx`, `app/app/(auth)/verify.tsx`, `app/app/(auth)/role.tsx`, `app/app/(customer)/_layout.tsx` (guest guards only; coordinate with H-02, which merges first), new `app/src/lib/authGate.ts` + tests, new `app/src/components/GuestGate.tsx`.
- **Blocked by:** B-01 (applied on `main`), H-02 (same customer layout file), doc 17 X1, R1, and U3 (same auth routes).
- **Steps:**
  1. `authGate.ts` (pure):
     - `BROWSE_SEGMENTS = ['(customer)', 'category', 'provider', 'sports', 'venue', 'shop', 'products', 'product', 'creators', 'top-rated', 'location', 'info', 'byo']`.
     - `isBrowseRoute(segments)` returns `true` for those segments. For `(customer)`, it is true only for the `index` and `search` tabs.
     - `safeReturnTo(path)` accepts only internal paths starting with `/` and **not** starting with `//`.
     - Jest covers both functions.
  2. Root guard (`_layout.tsx` lines 56–61): when signed out and `guest_browse` is on and `isBrowseRoute`, **do not redirect**. Otherwise `router.replace({ pathname: '/login', params: { returnTo: currentPath } })`. Move the protected `Stack.Screen` declarations that are browse routes (`(customer)`, `category/[slug]`, `provider/[id]`, `top-rated`, `location`) out of `Stack.Protected` **only when the flag is on**. Keep `book/*`, `booking/*`, `chat/*`, `quote/*`, `onboarding`, `jobs`, `assistant` protected.
  3. **Private tabs inside `(customer)`.** Opening the `(customer)` group also exposes the Bookings and Account tabs, which load personal data (`UnifiedActivityScreen.tsx:215`, `AccountScreen.tsx:38`). An effect redirect is not enough:
     - `GuestGate` wraps the Bookings and Account tab screens. When there is no session, it renders a sign-in prompt (`guest.signInToContinue` + `Button` → login with `returnTo`) and **does not mount** the data-loading screen.
     - Tab presses on Bookings/Account while signed out go to the same prompt (use the tab `listeners.tabPress` to route to login with `returnTo`).
     - Jest: `GuestGate` never renders its child without a session (pure `shouldRenderPrivate(session)` helper + test).
  4. **Commit actions (owned here).** Grep browse screens for direct writes: `grep -rn "supabase.rpc\|\.insert(\|startProductEnquiry\|bookSportsSlot\|create" app/app/product app/app/shop app/app/provider app/app/sports app/app/venue app/src/features/sports app/src/features/shops`. For each hit that is a user commit action, call `requireSignIn(returnTo)` (exported from `authGate.ts`; it returns `false` and routes to login when signed out) before the write. Record every call site in the report. If the owning screen task (HS-01, SH-01, SP-01, SP-02) has not merged yet, G-01 still owns these one-line insertions and the screen task rebases on top.
  5. **Return path through the real auth flow.** Today login passes `phone` and `inviteToken` to verify (`login.tsx:35-45`). Verify sets `choosingRole=true` and routes to `/role` (`verify.tsx:37-40`), and the role screen finishes sign-in (`role.tsx:58-81`). The protected group requires `!choosingRole` (`_layout.tsx:75-92`). Therefore:
     - Carry `returnTo` as a route param: login → verify → role.
     - In `role.tsx`, **after** the role is chosen and `setChoosingRole(false)` has run, call `router.replace(returnTo)` if `safeReturnTo(returnTo)` passes **and** the chosen role is customer. Otherwise keep today's navigation.
     - Invite tokens keep precedence: if `inviteToken` is present, ignore `returnTo`.
     - Returning customers still pass through role today; do not add a role-skip here (doc 17 U3 owns that).
- **Regression watch:**
  - With the flag off, behavior is identical: the E2E login flow passes unchanged.
  - Push registration (`NotificationsBridge`) must not run for guests.
- **Acceptance:**
  - Jest is green.
  - A new Q-02 E2E step "guest browses sports → taps Book → lands on login → OTP → role (customer) → returns to the venue" passes with the flag on.
  - A guest opening `/bookings` or `/account` directly sees the sign-in prompt, and no personal-data request is made (assert no network call to the activity/profile RPCs in the E2E step).

#### HS-01 Home services listing + provider profile
- **Owns:** `app/app/category/[slug].tsx`, `app/src/features/providerProfile/*`, `app/src/components/ProviderCard.tsx` (used by `category/[slug].tsx:241` **and** by `app/src/features/catalogue/ArchetypeCategory.tsx:117` for creator/proposal results). **Do not edit `TopRatedCard.tsx`**: the legacy Home uses it (`(customer)/index.tsx:388-390`) and must stay identical with `home_v2` off.
- **Blocked by:** R-02, C-03, C-05.
- **Steps:**
  1. Render category results with `ListingCard variant="provider"`. Keep sort/filter sheets and all data calls unchanged.
  2. Make `ProviderCard` delegate to `ListingCard` while keeping its exported props, so callers compile unchanged. **Preserve the proposal-mode price label and CTA** rendered for `ArchetypeCategory.tsx:117` (`ProviderCard.tsx:63-84`). Add a Jest test on a pure `providerCardModel(props)` that returns the same price label and CTA text as today for both normal and proposal mode.
  3. In the provider profile, replace the footer markup with `PriceFooter`, using the **same copy and logic**.
- **Acceptance:**
  - The E2E category steps are green.
  - The footer screenshot is unchanged.

#### HS-02 Step-by-step booking (`booking_steps`)
- **Owns:** `app/src/features/booking/book/*`, `app/app/book-fixed/[providerServiceId].tsx`, `app/app/recurring/new/[providerServiceId].tsx`.
- **Blocked by:** R-03, C-08.
- **Steps:**
  1. With the flag on, wrap each flow in `BookingStepLayout` with the steps `booking.step.type`/`time`/`address`/`review`. Omit `type` when `recurring_bookings` is off.
  2. Map each existing section to its step **without changing any validation, API call or price calculation**.
  3. Footer = `PriceFooter`, using the existing amount and CTA logic.
  4. With the flag off, render the current layout unchanged.
- **Acceptance:**
  - Existing booking E2E steps pass with the flag off and on (Q-02).
  - No change in the request payload. Assert this in Jest with a pure `buildBookingPayload` extraction if one exists; if none exists, state that in the report.

#### HS-03 Book again (`book_again`)
- **Owns:** `app/src/features/activity/segments/*` (after R-04).
- **Blocked by:** R-04.
- **Steps:**
  1. On completed one-time service bookings, add `Button variant="secondary" size="sm"` `booking.bookAgain`. It routes to `/book/[providerServiceId]` with the same `providerServiceId`, or to `/provider/[id]` if the service is no longer active.
  2. Show the button only when the flag is on.
- **Acceptance:**
  - Jest tests the pure `canBookAgain(booking)` truth table.
  - The E2E `my-activity-*` steps stay green.

#### SH-01 Shops & products
- **Owns:** `app/app/shop/index.tsx`, `app/app/shop/[id].tsx`, `app/app/products.tsx`, `app/app/product/[id].tsx`, `app/src/features/shops/components.tsx`.
- **Blocked by:** C-01, C-03, C-04.
- **Steps:**
  1. Shop home:
     - `SearchField mode="input"` (submits to `/products?q=`).
     - Product-category `ChipRow`.
     - `t('rfq.banner')` `Card variant="tinted" tint={colors.catShopsSoft}` → `/rfq/new`, only when `isOn('product_rfq')`.
     - Shops as `ListingCard variant="shop"`.
  2. Products: a 2-column grid of `ListingCard layout="grid" variant="product"`. Move the RFQ button into the banner at the top and remove the outline button only when the banner is shown.
  3. Product detail: `MediaImage` gallery (1:1). Show existing specs in a 2-column key/value list and existing actions as `PriceFooter`-style CTAs.
  4. Add `requireSignIn` on Enquire (if G-01 is merged).
- **Acceptance:** E2E `phase-7a-owner-submits-shop` + product steps are green.

#### SH-02 RFQ quote comparison
- **Owns:** `app/app/rfq/[id].tsx`, new `app/src/features/rfq/comparePresentation.ts` + `app/src/features/rfq/__tests__/comparePresentation.test.ts`.
- **Blocked by:** C-06, and doc 17 P1b (it changes the same comparison rules; merge P1b first).
- **Steps:**
  1. **Keep everything the screen shows today** (`rfq/[id].tsx:97-146`): subtotal, GST, delivery, unavailable items, changed brands, missing specifications, per-item offers, and today's selection gates (only a *sent* quote on an *open* RFQ, when enquiries are enabled).
  2. Add `QuoteCompareTable` as a summary **above** the existing detail cards. Build its rows in `comparePresentation.ts`: `who` = shop name, `pricePaise` = total, `detail1` = delivery, `detail2` = validity (only fields that exist in `features/rfq/api.ts` types). `warnings` = unavailable items / changed brand / missing specs. `excludeFromLowest` = quote does not cover every RFQ line. `selectable` = today's selection gate.
  3. `onSelect` calls the **existing** select function.
- **Acceptance:** Jest tests `comparePresentation.ts`: an incomplete quote never gets the lowest badge; warnings appear for unavailable items and changed brands; a non-selectable quote has no select action.

#### SP-01 Sports discovery
- **Owns:** `app/app/sports/index.tsx`, `app/app/sports/[activity].tsx`, new `app/src/features/sports/activityPresentation.ts` + `app/src/features/sports/__tests__/activityPresentation.test.ts`.
- **Blocked by:** C-02, C-03, C-04, and doc 17 S2 (sports files are owned there first).
- **Steps:**
  1. Hub: activities as a 2-column tile grid (sports accent); "My sports requests" and the provider-only "My venues" become `ListingCard`-row style. **Keep the `activeRole === 'provider'` condition.**
  2. Activity list:
     - The title comes from the activity `name` returned by `list_sports_activities`. Pass it as a route param from the hub; fall back to a title-cased slug.
     - Radius `ChipRow` 5/10/15 km (default 15), passed as `p_radius_km`.
     - Venues as `ListingCard variant="venue"` with `verified`.
     - Remove the `Pressable` wrapper and the `VERIFIED` text.
- **Acceptance:**
  - E2E sports steps are green.
  - Jest tests `titleFromSlug` in `activityPresentation.ts` (the route imports it; the test never imports the route).

#### SP-02 Venue booking, checkout, booking detail
- **Owns:** `app/src/features/sports/SportsVenueBookingScreen.tsx`, `app/app/sports-checkout/[id].tsx`, `app/app/sports-booking/[id].tsx`.
- **Blocked by:** C-05, Q-00, doc 17 S1 and S2 (same sports files).
- **Steps:**
  1. Slot grid states use the API contract `state: 'free' | 'taken' | 'blocked' | 'past'` (`app/src/features/sports/api.ts:25`). Today the screen hides every non-free slot (`SportsVenueBookingScreen.tsx:182-186,269-289`).
     | API state | Style | Selectable |
     |---|---|---|
     | `free` | outlined | yes |
     | selected `free` | `primary` fill | yes |
     | `taken`, `blocked` | `surfaceAlt` + label "Unavailable" | **no** (`accessibilityState.disabled`) |
     | `past` | hidden | — |
     Do **not** label cells "held" or "booked"; the backend does not distinguish them. Add a pure `slotCellState(slot, selectedIds)` helper in `app/src/features/sports/model.ts` with a Jest test proving `taken`/`blocked` are never selectable.
  2. The footer is `PriceFooter` with the existing total and CTA.
  3. Show the existing cancellation policy text above the footer before payment.
  4. **No change** to `bookSportsSlot` / `createSportsPayment` arguments.
- **Acceptance:** E2E `phase-6-sports-booking-request` + checkout steps are green.

#### CR-01 Creators landing (`creators_landing`)
- **Owns:** new `app/app/creators.tsx`, new `app/src/features/creators/*` + tests.
- **Blocked by:** C-02, C-03.
- **Steps:**
  1. Tiles for categories in the `creative-events` family (`getCatalogue` + `groupCatalogueFamilies`) → `/category/[slug]`.
  2. `creators.how` strip with 4 numbered steps (`creators.step1..4`).
  3. With the flag off, show `feature.off` + a link to Home.
- **Acceptance:** Jest tests `creatorCategories(catalogue)`.

#### CR-02 Proposal compare + delivery
- **Owns:** `app/app/request/[id].tsx`, `app/app/proposal/[id].tsx`.
- **Blocked by:** C-06, doc 17 C1 and C2 (they change the proposal and delivery flows first).
- **Steps:**
  1. Proposals on `request/[id]` use `QuoteCompareTable` as a summary above the existing proposal cards. `onSelect` opens the existing `proposal/[id]`.
  2. **Out of scope:** `app/app/proposal-delivery/[id].tsx` is the *creator's* submission form (`submitDelivery`, "Send to customer"). Do not restyle or change it. The *customer's* delivery review/acceptance (visible deliverables, revisions remaining, accept/request revision) is built by doc 17 **C1** in the booking detail delivery section; CR-02 does not touch it.
- **Acceptance:** E2E `proposal-flow-*` steps are green.

#### BD-01 Booking detail status header
- **Owns:** `app/src/features/bookingDetail/*`.
- **Blocked by:** R-01, C-07, and doc 17 U3 (status/help copy in the same booking detail).
- **Steps:**
  1. Error states use `friendlyError` + `t()`.
  2. Show the existing `StatusHero`/`StatusTimeline` at the top, with no logic change.
  3. Replace any remaining raw error text.
- **Acceptance:** E2E booking steps are green.

#### A-01 Assistant rate-limit state
- **Owns:** `app/app/assistant.tsx`.
- **Blocked by:** C-07 and doc 17 U3 (AI flag gate in the same route).
- **Steps:** When an AI call fails and `friendlyError(e).key === 'ai.busy'`, show `InlineAlert` `ai.busy` + a Retry `Button`. Never show the raw message.

#### M-01 / M-02 / M-03 Merchant surfaces (token compliance + sections)
| ID | Owns | Blocked by | Steps |
|---|---|---|---|
| M-01 | `app/src/features/providerDashboard/*` | R-05, T-01 | Replace the 3 hex literals with tokens; use `Badge` tones for statuses; `EmptyState` for empty lists. No logic change. |
| M-02 | `app/src/features/sports/manage/*` | R-06, T-01 | Same as M-01; use `ChipRow` for tab-like filters. |
| M-03 | `app/src/features/providerOnboarding/services/*` | R-07, T-01 | Same as M-01; make sure every input has a visible label. |

### Phase 4 — Integration, QA, polish

| ID | Owns | Blocked by | Steps / acceptance |
|---|---|---|---|
| Q-02 | `e2e/web-smoke.mjs`, `e2e/all-services.mjs` (+ integrator edits `e2e-web.yml`) | Each feature it covers | Flags are changed only by workflow SQL steps (the Management API `database/query` calls already used for demo resets, `e2e-web.yml:73-93`), not from the `.mjs` files. **Pass A** (existing run, the six flags off) asserts the legacy UI. The integrator then adds a workflow step `update public.feature_flags set enabled = true where key in ('home_v2','unified_search','guest_browse','creators_landing','booking_steps','book_again')` and **Pass B** `E2E_FLAGS=on node web-smoke.mjs`, where steps guarded by `process.env.E2E_FLAGS === 'on'` assert the new UI and the G-01 guest journey. **State safety:** before Pass A, a workflow step **snapshots** the six flags (`select key, enabled from public.feature_flags where key in (...)`) to `flags-snapshot.json` and fails the job if the snapshot fails. Pass A explicitly sets the six flags to `false` before running. The final `always()` step **restores the snapshot** (not blindly `false`) and fails loudly if the restore fails. All backend-mutating passes run under the `e2e-shared-backend` concurrency group (Q-01). **Acceptance:** both passes green on `main`, and a post-run query shows the six flags equal to the snapshot. |
| Q-03 | new `scripts/ci/ui-lint.sh` (+ integrator adds it to `lane-ci.yml`) | All Phase 3 merged | Fails when new or changed `app/**/*.tsx` lines contain `#[0-9A-Fa-f]{6}`, `fontSize:`, `fontFamily:` (outside `src/theme/` and `RouteErrorBoundary.tsx`), or `<Pressable` without `accessibilityRole` within 5 lines. **Two modes:** (1) **One-time redesign audit:** the integrator records the pre-redesign baseline SHA (the `main` SHA when Phase 1 starts) in §7, and Q-03 checks every line added between that baseline and `HEAD` (`git diff <baseline>...HEAD`). (2) **Ongoing lane gate:** in `lane-ci.yml`, check lines added relative to `git merge-base origin/main HEAD`. |
| Q-04 | `docs/14` §7 table | All | Manual device checklist (§6.2) on an EAS preview build. Record device, OS and pass/fail per row. |
| P2-01 | Remaining files with hex/`fontSize` literals not owned by any earlier task | Q-03 | Move `CategoryIcon` tints into `categoryGlyphTints` in `tokens.ts` with explicit dark values (doc 13 §D.5). Replace the `ActivityIndicator` in `location.tsx` with `Skeleton` rows. Leave `RouteErrorBoundary` literals in place but import them from `lightPalette`. |
| T-99 (integrator) | `docs/13`, `docs/14` status tables, `docs/01-PRD.md` | All | Update status tables with merged SHAs and run IDs. |

---

## 5. Dependency graph, parallel matrix, merge order

### 5.1 Graph
```
Q-00 ──► Q-01
  │
  ├──► T-01 ──┬──► C-01 ─┬──► H-01 ◄── C-02, C-03, C-04
  │           ├──► C-02 ─┼──► C-03 ──► HS-01 ◄── R-02, C-05
  ├──► I-01 ──┤          │            SH-01 ◄── C-01, C-04
  │           ├──► C-04 ─┘            SP-01 ◄── C-02, C-04
  │           ├──► C-05 ──► C-08 ──► HS-02 ◄── R-03
  │           └──► C-06 ──► SH-02 (+doc17 P1b), CR-02 (+doc17 C1, C2)
  ├──► C-07 ──► BD-01 ◄── R-01 ;  A-01
  ├──► B-01 ──► G-01 ◄── H-02, doc17 X1 + R1   (B-01 must be APPLIED on main)
  ├──► R-01..R-07 (independent)  R-04 ──► HS-03 ; R-05/6/7 ──► M-01/2/3 (+T-01)
  ├──► SP-02 ◄── C-05, doc17 S1 + S2 ;  SP-01 ◄── doc17 S2
  └──► CR-01 ◄── C-02, C-03
All Phase 3 ──► Q-02, Q-03 ──► P2-01 ──► Q-04 ──► T-99
```

### 5.2 Waves (launch everything in a wave in ONE response)

| Wave | Starts when | Tasks (agents) | Count |
|---|---|---|---|
| 0 | Approval | Q-00 is run as doc 17 T1 (not here) + Q-01 step 1 (integrator) | 0 |
| 1 | Q-00 (doc 17 T1) merged | T-01, C-07, R-07 (+ I-01 by integrator). B-01 after doc 17 X1 + R1. Each other R task after its doc 17 hot-file owner (header Sequencing row). | 3–9 |
| 2 | T-01 + I-01 merged | C-01, C-02, C-04, C-05, C-06, A-01 (C-07 merged), and BD-01/HS-03/M-01..03 as soon as their R task is merged | up to **11** |
| 3 | Blockers merged (incl. doc 17 owners) | C-03, C-08, then H-01, H-02, HS-01, HS-02, SH-01, SH-02, SP-01, SP-02, CR-01, CR-02, then G-01 (after H-02) | up to **13** |
| 4 | Phase 3 merged | Q-02, Q-03, then P2-01, Q-04, T-99 | 2–3 |

### 5.3 Shared-file conflict matrix (only the owner may edit)

| File | Owner | Others must not touch |
|---|---|---|
| `app/src/theme/tokens.ts` | T-01 (Phase 1), P2-01 (Phase 4) | everyone else |
| `app/src/i18n/en.ts`, `te.ts` | I-01 (integrator) | everyone. If a key is missing, report it; the integrator adds it. |
| `app/app/_layout.tsx` | G-01 | — |
| `app/app/(customer)/_layout.tsx` | H-02 | — |
| `app/app/(customer)/index.tsx` | H-01 | — |
| `app/src/features/activity/*` | R-04 → HS-03 (sequential) | — |
| `app/app/provider/[id].tsx` + `features/providerProfile/*` | R-02 → HS-01 (sequential) | — |
| `app/app/book/[providerServiceId].tsx` | doc 17 B1 → R-03 | — |
| `app/src/features/booking/book/*` | R-03 → HS-02 (sequential) | — |
| `app/app/book-fixed/[providerServiceId].tsx` | doc 17 B1 → HS-02 | — |
| `e2e/web-smoke.mjs` | doc 17 X1 → Q-00/T1 → Q-01 screenshot helper → doc 17 U1 → doc 17 U3 → Q-02 | — |
| `e2e/all-services.mjs` | Q-00/T1 → doc 17 H2b → doc 17 H3 → Q-02 | — |
| `.github/workflows/*`, `supabase/tests/package.json` | integrator | — |
| `components/market/*` | the C task that creates each file | screen tasks only import them |

**Tasks that can be validated independently** (pure helpers + lane CI): T-01, C-01…C-08, I-01, R-01…R-07, CR-01, HS-03. **Tasks that need integration on `main` before they are complete** (E2E is `main`/lane-serialized): Q-00, H-01, H-02, G-01, HS-01, HS-02, SH-01, SP-01, SP-02, CR-02, BD-01.

### 5.4 Merge order
1. Q-00
2. Q-01
3. Wave 1 in any order; B-01 merges alone because it adds a migration.
4. Wave 2 in any order.
5. Wave 3 in any order after blockers.
6. G-01 only after B-01 is **applied** on `main`.
7. Q-02, Q-03, P2-01, Q-04, T-99

---

## 6. Testing checklist

### 6.1 Automated (every lane / `main`)
- [ ] `lane-ci.yml`: app typecheck + Jest green (all lanes)
- [ ] SQL `run-all.mjs` green (B-01)
- [ ] `e2e-web.yml` green on `main` with 0 failed steps; screenshots for 360×640, 390×844, 768×1024
- [ ] Every new flag tested **on and off** (Q-02)
- [ ] Contrast test green (T-01)
- [ ] `ui-lint.sh` green (Q-03)

### 6.2 Manual device checklist (Q-04; record results in §7)
| # | Check | Android small (360 dp) | Android large | iPhone |
|---|---|---|---|---|
| 1 | Home v2: pillars render 2×2, no text clipping at font scale 1.0 and 1.3 | | | |
| 2 | Search: keyboard does not cover results; clear button works | | | |
| 3 | Guest: browse sports → Book → login → OTP → role → returns to venue; Bookings/Account tabs show sign-in prompt | | | |
| 4 | Home service booking end-to-end in Razorpay test mode | | | |
| 5 | Sports booking: slot select → pay online (test) → confirmation | | | |
| 6 | Shop: product grid images load; RFQ banner → form | | | |
| 7 | Creators: landing → category → provider → send brief | | | |
| 8 | Dark mode: every changed screen readable; no white flashes | | | |
| 9 | TalkBack / VoiceOver: pillars, listing cards and search read as one element each with full labels | | | |
| 10 | Back navigation from every new screen returns to the expected screen | | | |

### 6.3 Regression watchlist
- **Payment payloads:** `book`, `sports-checkout` and `proposal` must not change. HS-02 and SP-02 assert this.
- **Push registration** must not run for guests (G-01).
- **Provider role:** the `(provider)` tabs and the redirect at `(customer)/_layout.tsx` stay unchanged.
- **Feature-off paths:** must render today's UI exactly. Compare against the Q-01 baseline screenshots.
- **Deep links:** `byo/[token]` and `info/[topic]` stay public with `guest_browse` both on and off.

## 7. Status board (integrator updates after each merge)

| Task | Status | Agent | Lane run | Merged SHA |
|---|---|---|---|---|
| Q-00 / doc 17 T1 | Fix-forward `8148854` is on main at `10495c0`; it uses `get_my_provider`/`save_provider_basics`, preserves returning-provider routing, and avoids direct profile PATCH. Backend deploy `44512029762` succeeded; post-fix main E2E `44516641754` passed after RFQ quantity fix `5dd85fb` | 6c5934c4-e869-4e30-b4d4-dd2469724210 | 44508274961 (T1 lane CI green); 44502606916 (UI batch lane CI); 44502606943 (pre-fix UI batch E2E failed); 44507015621 (prior main deploy failure); 44507015463 (pre-fix main E2E failure); 44512029762 (main deploy success); 44516641754 (post-fix main E2E green) | `10495c0` (`8148854` source); prior commits `fb069de`, `4f33f44`, `f66c3a1`, `57a6698` |
| Q-01 | workflow trigger, 14-day retention, and queue:max merged; O2 seed fix is on main; post-fix main E2E `44457835276` passed with 0 failed steps and admin pass; two AI-limit steps were skipped; viewport screenshot pass sequenced after doc 17 H3/F8 | integrator | 44406412351; 44408156814; 44412263196; 44413775287 (cancelled before jobs); 44411077594 (proposal + admin failed); 44418061376 (X3 seed fix green); 44418061318 (E2E pending); 44419845866 (main E2E pending); 44419846387 (backend success); 44419845889 (app publish success); 44422452457 (app publish success); 44422452507 (main E2E pending); 44423228645 (backend success; 0063 applied); 44423228486 (demo reset failed; smoke not run); 44427389305 (backend success; 0064 applied); 44427389306 (app publish success); 44427389151 (demo reset failed; smoke not run); 44429275573 (backend success; 0065 applied); 44429275638 (demo reset failed; smoke not run); 44436860234 (lane seed reset/code smoke pass; admin config blocked); 44439583542 (backend success); 44439583544 (pre-setup code-owned pass; admin blocked); 44444203933 (backend success; 0066 applied); 44444204058 (app publish success); 44444203959 (pre-setup code-owned pass; admin blocked); 44449228932 (U3 lane smoke code-owned pass; admin blocked); 44451219523 (app publish success); 44451219515 (backend success; 0067 applied); 44451219597 (pre-setup code-owned pass; admin blocked); 44452693916/44453087353 (owner setup); 44452023387 (A-01 lane CI green); 44452023356 (pre-setup admin-only failure); 44454062046 (H-01 lane CI green); 44454062014 (pre-fix admin flow failure); 44454043918 (A-01 lane CI green); 44454043903 (pre-fix admin flow failure); 44457835276 (post-fix main E2E green; admin pass; AI-limit steps skipped); 44458045441 (A-01 lane CI green); 44458045387 (post-fix E2E pending); 44458119039 (U2 lane CI green); 44458119027 (E2E pending); 44458765488 (H-01 lane CI green); 44458765479 (E2E pending) | 5152f6c |
| T-01 | merged; contrast/typecheck/Jest green; lane E2E cancelled | 964b65b2-8e74-4f6e-beb3-cb43251cba18 | 44403000486 (lane CI); 44402999988 (E2E cancelled) | 3c707d8 |
| B-01 | implementation and registration complete; migration 0088; `guest_browse` gates anon only; lane CI `44491390283` green; lower-model security review clear; full-chain revalidation after 0071–0087 land | 2bbbd190-ab0e-4903-a493-029cc2acaa55 | 44491390283 (lane CI green); lower-model review (no high-confidence findings) | — |
| I-01 | merged; lane typecheck/Jest green | integrator | 44401816876 | cd56e88 |
| C-07 | merged; lane typecheck/Jest green; E2E run cancelled | 3626acf9-4fb6-4673-aebc-b393502e56c8 | 44402357918; 44402357939 (cancelled) | 5f751fa |
| R-01 | blocked by doc 17 H3 | — | — | — |
| R-02 | merged; lane CI green; U1 provider routing preserved | 38eb46d9-9945-45a0-8c63-3de7872492ea | 44421702081 | 8aa83ce |
| R-03 | behavior-preserving split complete on top of green B1; lane CI `44491359933` green; batch CI `44526017966` and E2E `44526017922` passed; merged to main at `b9efe2b`; main app publish `44531451761` and E2E `44531451860` passed | 5560dc27-45fc-42a9-aa74-592e66c8115d | 44491359933 (lane CI green); 44526017966 (batch CI green); 44526017922 (batch E2E green); 44531451761 (main app publish green); 44531451860 (main E2E green) | `b9efe2b` (`0a70f1d` source) |
| R-04 | blocked by doc 17 B2 and S2 (sports segment handoff) | — | — | — |
| R-05 | O4 deferred as G3; implementation green on `lane/R-05` @ `d78c095`; batch CI `44526017966` and E2E `44526017922` passed; merged to main at `b9efe2b`; main app publish `44531451761` and E2E `44531451860` passed | 2e2ed7f8-9e51-4c07-9ece-0999c2ca09f7 | 44495618758 (lane CI green); 44526017966 (batch CI green); 44526017922 (batch E2E green); 44531451761 (main app publish green); 44531451860 (main E2E green) | `b9efe2b` (`d78c095` source) |
| R-06 | blocked by doc 17 S2 | — | — | — |
| R-07 | merged; lane CI green; E2E cancelled before execution | 300c6bc6-044b-4430-84e0-d3a3d0c3ebfc | 44408117021 (green); 44408116941 (E2E cancelled) | 7c83274 (lane e629743) |
| C-01 | merged; lane CI green; code-owned E2E steps passed; admin step owner-blocked | 1fb8208b-f4e6-4809-94a5-2450f1f4578f | 44408144405 (green); 44408144270 (`ADMIN_E2E_PHONE` invalid/empty) | 9468a82 (lane 8ea2df3) |
| C-02 | merged; lane CI green; E2E cancelled before execution | 46d09a0a-7fdb-4228-8221-dfcd109d0f01 | 44407464640 (green); 44407464583 (E2E cancelled) | 1057cfa (lane 8a9a729) |
| C-03 | merged; lane CI green; E2E queued | 8fb08e8e-ea54-41ba-8913-7590c007d2de | 44412495451 (green); 44412495121 (E2E pending) | 72bb545 (lane c14fb0f) |
| C-04 | merged; lane CI green after test fixes; E2E cancelled | 2ad9ec1a-b7ad-47c3-98b5-c09729e3acce | 44408076817 (green); 44408076741 (E2E cancelled) | ff3c46d (lane 7b4a510) |
| C-05 | merged; lane CI green after type fix; E2E cancelled | 07879722-0a44-46a3-b508-a7924f3e168a | 44408097637 (green); 44408097628 (E2E cancelled) | f2ab430 (lane 5759992) |
| C-06 | merged; lane CI green; all code-owned E2E steps passed; admin step remains owner-blocked | 0328e331-9d52-4778-97e5-e6737df3e1a8 | 44407916876 (green); 44407916872 (`ADMIN_E2E_PHONE` invalid/empty) | b75808a (lane 19afe98) |
| C-08 | merged; lane CI green; E2E queued | ff027770-83f4-4c19-88e9-1dd0a4dabfda | 44412326937 (green); 44412370229 (E2E pending) | 674c6de (lane 49fb432) |
| H-01 | merged; lane CI and post-admin-fix lane E2E green; main app publish and E2E passed | 861e2a89-2c68-445a-b38e-9b0dc736ad51 | 44454062046 (pre-fix green); 44454062014 (H-01 steps passed; admin locator timeout); 44458765488 (post-fix lane CI green); 44458765479 (post-fix lane E2E green); 44464543378 (main app publish success); 44464543331 (main E2E success) | 76db124 |
| H-02 | lane CI green; batch CI `44526017966` and E2E `44526017922` passed; merged to main at `b9efe2b`; main app publish `44531451761` and E2E `44531451860` passed; old `44502606943` T1 failure was pre-fix | a9c54d32-3b09-4e80-9749-41a3bc589778 | 44474246349 (lane CI green); 44502606943 (pre-fix batch E2E); 44526017966 (batch CI green); 44526017922 (batch E2E green); 44531451761 (main app publish green); 44531451860 (main E2E green) | `b9efe2b` |
| G-01 | blocked by B-01, H-02, doc 17 R1/U3 | — | — | — |
| HS-01 | lane CI green; existing category Book/Schedule route preserved; per-lane E2E `44477499108` cancelled under batch rules; batch CI `44526017966` and E2E `44526017922` passed; merged to main at `b9efe2b`; main app publish `44531451761` and E2E `44531451860` passed | 4b4fc777-b51b-4af9-9b73-c67b8b27a8e2 | 44476597048 (pre-fix); 44477499112 (final lane CI green); 44477499108 (cancelled); 44502606943 (pre-fix batch E2E); 44526017966 (batch CI green); 44526017922 (batch E2E green); 44531451761 (main app publish green); 44531451860 (main E2E green) | `b9efe2b` |
| HS-02 | implementation green on `lane/HS-02` @ `97f67ca`; batch CI `44533768870` and E2E `44533768761` passed; merged to main at `1d35ca6`; main app publish/E2E running | dde6bc4f-a6c8-4acf-923e-23e49035e00e | 44496049356 (lane CI green); 44533768870 (batch CI green); 44533768761 (batch E2E green); 44536124524 (main app publish running); 44536124440 (main E2E running) | `1d35ca6` (`97f67ca` source) |
| HS-03 | blocked by R-04 | — | — | — |
| SH-01 | code merged to main with DB batch `0a0b0af`; B1 fixed-package assertions and SH-01 RFQ selector are included; retry deploy `44512029762` succeeded and post-fix main E2E `44516641754` passed | 703bb5a0-ac2f-4b45-8a73-94b5ce016007 | 44480873936 (lane CI); 44490343057 (stacked lane CI green); 44507015621 (prior deploy failure); 44512029762 (main deploy success); 44516641754 (main E2E green) | `0a0b0af` |
| SH-02 | implementation green on `lane/SH-02` @ `ae75765`; batch CI `44533768870` and E2E `44533768761` passed; merged to main at `1d35ca6`; main app publish/E2E running | 3af3596a-f0db-44ae-aaa6-0c801a85b8f5 | 44494682556 (lane CI green); 44533768870 (batch CI green); 44533768761 (batch E2E green); 44536124524 (main app publish running); 44536124440 (main E2E running) | `1d35ca6` (`ae75765` source) |
| SP-01 | implementation complete on `lane/SP-01` @ `0da92f8`; lane CI `44528216703` green; awaits S2/0080 on main before UI-batch E2E | 15116a34-6c5b-43f1-9fcc-559491ee8fdd | 44528216703 (lane CI green; no per-lane E2E) | — |
| SP-02 | implementation complete on `lane/SP-02` @ `f7285fa`; lane CI `44531092391` green; unavailable slot copy uses `sports.slotUnavailable`; awaits S2/0080 on main before UI-batch E2E; payment payload must remain unchanged | 4cbb47b3-46f1-42af-8b24-8b4c05274994 | 44531092391 (lane CI green; no per-lane E2E) | — |
| CR-01 | merged; lane CI green; existing Card/CategoryIcon retained per spec | 6878626f-8b83-4ae5-9c10-10eb19c470dd | 44414854482 (green) | 0a12c33 (lane 52f3ba6) |
| CR-02 | blocked by C-06 and doc 17 C1/C2 | — | — | — |
| BD-01 | blocked by R-01 and C-07 | — | — | — |
| A-01 | merged; lane CI, post-admin-fix lane E2E, main app publish, and main E2E passed | a0cd519f-5118-4f6e-b167-68b01c6e7e7c | 44452023387 (green); 44452023356 (pre-setup admin-only failure); 44454043918 (green); 44454043903 (admin locator timeout); 44458045441 (post-fix lane CI green); 44458045387 (post-fix lane E2E green); 44464706450 (main app publish success); 44464706447 (main E2E success) | 557bcb9 |
| M-01 | implementation green on `lane/M-01` @ `51b89b7`; token/badge/empty-state update only; batch CI `44533768870` and E2E `44533768761` passed; merged to main at `1d35ca6`; main app publish/E2E running | 5e80191a-2264-4c9a-b9d7-1ac9a47e6ecb | 44505210511 (lane CI green); 44533768870 (batch CI green); 44533768761 (batch E2E green); 44536124524 (main app publish running); 44536124440 (main E2E running) | `1d35ca6` (`51b89b7` source) |
| M-02 | blocked by R-06 and T-01 | — | — | — |
| M-03 | merged; lane CI green; E2E queued | 53f643d6-ed52-4e6d-b3f5-f84edbd0a207 | 44411999739 (green); 44411999701 (E2E pending) | 061d55b (lane 53c5bd9) |
| Q-02 | blocked by all covered Phase 3 tasks | — | — | — |
| Q-03 | blocked by all Phase 3 tasks | — | — | — |
| P2-01 | blocked by Q-03 | — | — | — |
| Q-04 | blocked by all; requires 3-device checklist on EAS preview | — | — | — |
| T-99 | blocked by all | integrator | — | — |

**E2E batch status (2026-11-19):** Lane E2E runs `44477499108` (HS-01), `44480874231` (SH-01), and `44481109622` (T1) were canceled to avoid per-lane runs. UI-batch E2E `44502606943` failed at T1 `new-pro-role` because a direct profile PATCH returned 403, then hit a cascading filechooser timeout. The earlier main E2E `44507015463` also timed out and the backend deploy `44507015621` stopped at the H2a SQL test. T1 fix-forward `8148854` is now on main at `10495c0`; backend deploy `44512029762` succeeded and post-fix main E2E `44516641754` passed. The pre-fix UI-batch run is historical. DB batch F2–F6 was fast-forwarded at `adfa141` after combined lane CI `44519475827` passed; backend deploy `44520271932` applied migrations 0075–0078, app publish `44520272944` succeeded, and main E2E `44520271806` passed. App-only `integrate/ui-batch-2` (H-02, HS-01, R-03, R-05) passed batch lane CI `44526017966` and E2E `44526017922`, then fast-forwarded main at `b9efe2b`; post-merge app publish `44531451761` succeeded and main E2E `44531451860` passed. App-only `integrate/ui-batch-3` (HS-02, SH-02, M-01) passed batch lane CI `44533768870` and E2E `44533768761`, then fast-forwarded main at `1d35ca6`; main app publish `44536124524` and E2E `44536124440` are running.

Latest E2E outcomes (Nov 19, 2026): H-01 lane run `44458765479` and main run `44464543331` passed; its main app publish `44464543378` succeeded. A-01 lane run `44458045387` and main run `44464706447` passed; its main app publish `44464706450` succeeded. U2's first main E2E `44465627435` exposed cancellation-dismissal and nested admin-shop issues; fix-forward `eeee6b3` corrected them. P1a main backend `44470999495` applied 0069, app publish `44470999525` succeeded, and main E2E `44470999417` passed.

Baseline screenshot artifact: *(Q-01 fills this)*

## 8. Definition of done (whole redesign)
1. Every §4 task is merged with a green lane run, and the `main` E2E is green.
2. All six flags were tested on and off, and the owner has enabled them in admin.
3. The §6.2 checklist passes on 3 devices.
4. There are zero new hex or `fontSize` literals outside `src/theme` (Q-03).
5. Doc 13 and doc 14 status tables are updated (T-99).
