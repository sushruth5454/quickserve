# QuickServe — UI/UX Audit & Design Specification (Document 1 of 2)

| | |
|---|---|
| **Status** | **PROPOSAL — awaiting owner approval. No app code has been changed.** |
| **Code baseline** | `sushruth5454/quickserve` `main` @ `2c59548` (latest migration `0058_sports_payments.sql`) |
| **Companion** | [`14-UI-Redesign-AI-Execution-Plan.md`](14-UI-Redesign-AI-Execution-Plan.md): task breakdown, agent assignments, file ownership and dependency graph for the implementing model |
| **Supersedes** | Visual sections of [`02-UX-UI-Design.md`](02-UX-UI-Design.md) §2 (tokens) and §3 (navigation) once approved. Everything else in 02 stays valid. |

## 0. How this audit was done (and its limits)

| Evidence used | What it proves |
|---|---|
| Full read of `app/app/_layout.tsx`, `app/app/(customer)/_layout.tsx`, `app/app/(customer)/index.tsx`, `app/app/sports/[activity].tsx`, `app/src/theme/tokens.ts`, `ThemeProvider.tsx`, `components/ui/Button.tsx`, `components/tabOptions.tsx`, `features/catalogue/model.ts`, `lib/featureFlags.ts` | Navigation, home layout, design tokens, button behavior, category grouping, flag mechanics |
| Scripted scan of all 79 route files plus 84 component and feature `.tsx` files (163 total) | Screen inventory, file sizes, loading/empty/error state coverage, hardcoded colors and font sizes, i18n coverage |
| WCAG 2.1 contrast computed for every proposed color pair (Python, relative-luminance formula) | Every proposed text/background pair is ≥ 4.5:1 |
| Latest `main` E2E run `44365580570` (Playwright, web) | Which journeys are currently red |

**Not done, by instruction (§9.2 of the brief: do not rebuild or restart the app):** I did not render the app on iOS/Android or take new screenshots. Visual statements describe the code (layout, tokens, copy). They do not describe what was observed on a device. The execution plan's first phase captures screenshots on three viewports in CI. That becomes the visual baseline before any change.

## A. Executive summary

QuickServe's **design foundation is stronger than its customer experience.** The token system is already production-grade:
- AA-annotated light and dark palettes
- Inter type scale with Dynamic Type caps
- 4-pt spacing
- 48-pt minimum touch size
- Reduced-motion-aware buttons
- Shared `Screen`/`Header`/`Card`/`EmptyState`/`ErrorState`/`Skeleton` primitives used by almost every screen

The template-like feel comes from **information architecture and journey design**, not from colors or fonts:

1. **Signed-out users cannot browse anything.** Every route except `info/*` and `byo/*` redirects to `/login` (`app/app/_layout.tsx:56-61`). This is the largest conversion risk.
2. **The home screen does not show the four marketplaces.** It shows catalogue "families" (`Home & vehicle services`, `Creators & events`, `Beauty & wellness`, `Learning & sessions`, `More services`; `features/catalogue/model.ts:34-38`). Sports and Shops are appended only when their flags are on (`(customer)/index.tsx`). Creators sit inside "Creators & events".
3. **Search covers only service-category names**, filtered on the device. It cannot find a shop, product, venue, sports activity, creator or provider. It is also hidden when no service categories exist.
4. **The main E2E suite is red** (7 failed steps in run `44365580570`, including `home` and `home-family-drilldown`). A redesign cannot be validated until this baseline is green.
5. **Nine screens are 580–1,116 lines long.** Without first splitting them into feature modules, parallel redesign work will collide in the same files.
6. **Localization is mostly not wired.** Only 4 UI files use `src/i18n`, and only `en` and `te` locale files exist. The home AI card still advertises "English, हिंदी or తెలుగు".
7. **Visual polish gaps are localized:**
   - A decorative gradient banner with vague copy
   - 43 inline glyph tints in `CategoryIcon.tsx` (a deliberate neutral-tile design; dark mode derives them at runtime with `lighten()`)
   - 102 hex literals across 27 files
   - Ad-hoc UI such as the plain-text `VERIFIED` label on venue cards, slug-derived page titles, and nested pressables

**Recommendation:**
- Keep the token architecture and Inter.
- Make one restrained brand refinement: a deeper primary and four category accents.
- Spend the effort on guest browsing, a four-pillar home, unified search, consistent listing cards, and per-category journeys.
- Gate every behavioral change behind admin feature flags.

## B. Screen inventory

79 route files, grouped by marketplace area. "Loading/Empty/Error UI" = the file references the shared `Skeleton`/`FullScreenLoader`, `EmptyState`, or `ErrorState`/`InlineAlert`. A `—` can be valid: for example, a form has no empty state. Thin wrappers (`venue/[id]`, `support/[id]`, `(customer)/account`, `(customer)/bookings`, `(provider)/pro-account`, `admin/support/[id]`) delegate to a component in `src/features/*` or `src/components/*`.

| Area | Route file (`app/app/…`) | Lines | Loading UI | Empty UI | Error UI | Flag-gated |
|---|---|---:|:---:|:---:|:---:|:---:|
| Admin | `admin/ai` | 60 | ✓ | ✓ | — | — |
| Admin | `admin/booking/[id]` | 74 | ✓ | ✓ | — | — |
| Admin | `admin/bookings` | 46 | ✓ | — | ✓ | — |
| Admin | `admin/category/[id]` | 514 | ✓ | ✓ | ✓ | ✓ |
| Admin | `admin/coins` | 208 | ✓ | — | ✓ | — |
| Admin | `admin/commission` | 270 | ✓ | — | ✓ | — |
| Admin | `admin/features` | 120 | ✓ | — | ✓ | — |
| Admin | `admin/geography` | 295 | ✓ | — | ✓ | — |
| Admin | `admin/index` | 114 | ✓ | ✓ | — | ✓ |
| Admin | `admin/people` | 104 | ✓ | — | ✓ | — |
| Admin | `admin/rfqs` | 64 | ✓ | ✓ | ✓ | — |
| Admin | `admin/rules` | 208 | ✓ | — | ✓ | ✓ |
| Admin | `admin/services` | 170 | ✓ | ✓ | ✓ | ✓ |
| Admin | `admin/shops` | 135 | ✓ | — | ✓ | — |
| Admin | `admin/sports` | 168 | ✓ | ✓ | ✓ | ✓ |
| Admin | `admin/support/[id]` | 8 | — | — | — | — |
| Admin | `admin/support/index` | 27 | — | ✓ | — | — |
| Creators & proposals | `proposal/[id]` | 95 | ✓ | — | ✓ | — |
| Creators & proposals | `request/[id]` | 68 | ✓ | ✓ | ✓ | — |
| Creators & proposals | `request/new` | 126 | — | — | ✓ | ✓ |
| Customer shared | `(customer)/account` | 6 | — | — | — | — |
| Customer shared | `(customer)/index` | 459 | ✓ | ✓ | ✓ | ✓ |
| Customer shared | `assistant` | 583 | — | ✓ | — | — |
| Customer shared | `assistant-history` | 76 | ✓ | ✓ | ✓ | — |
| Customer shared | `coins` | 131 | ✓ | — | ✓ | — |
| Customer shared | `notifications` | 169 | ✓ | ✓ | ✓ | — |
| Customer shared | `support/[id]` | 8 | — | — | — | — |
| Customer shared | `support/index` | 27 | — | ✓ | — | — |
| Customer shared | `support/new` | 35 | — | — | ✓ | — |
| Entry & auth | `(auth)/login` | 178 | — | — | ✓ | — |
| Entry & auth | `(auth)/role` | 171 | — | — | ✓ | — |
| Entry & auth | `(auth)/verify` | 126 | — | — | ✓ | — |
| Entry & auth | `byo/[token]` | 151 | ✓ | — | ✓ | — |
| Entry & auth | `info/[topic]` | 112 | — | — | — | — |
| Entry & auth | `location` | 380 | ✓ | — | ✓ | — |
| Entry & auth | `onboarding` | 66 | ✓ | — | ✓ | — |
| Home services | `(customer)/bookings` | 2 | — | — | — | — |
| Home services | `book-fixed/[providerServiceId]` | 186 | ✓ | — | ✓ | ✓ |
| Home services | `book/[providerServiceId]` | 684 | ✓ | — | ✓ | ✓ |
| Home services | `booking/[id]` | 1116 | ✓ | — | ✓ | — |
| Home services | `category/[slug]` | 373 | ✓ | ✓ | ✓ | — |
| Home services | `chat/[bookingId]` | 184 | ✓ | — | ✓ | — |
| Home services | `provider/[id]` | 642 | ✓ | — | ✓ | — |
| Home services | `quote/[bookingId]` | 496 | ✓ | — | ✓ | — |
| Home services | `recurring/[id]` | 362 | ✓ | ✓ | ✓ | ✓ |
| Home services | `recurring/new/[providerServiceId]` | 615 | ✓ | — | ✓ | ✓ |
| Home services | `top-rated` | 60 | ✓ | ✓ | ✓ | — |
| Merchant / provider | `(provider)/business-tools` | 216 | — | ✓ | ✓ | — |
| Merchant / provider | `(provider)/dashboard` | 782 | ✓ | — | ✓ | — |
| Merchant / provider | `(provider)/earnings` | 472 | ✓ | ✓ | ✓ | — |
| Merchant / provider | `(provider)/pro-account` | 6 | — | — | — | — |
| Merchant / provider | `jobs` | 120 | ✓ | ✓ | ✓ | — |
| Merchant / provider | `merchant-calendar` | 199 | ✓ | ✓ | ✓ | ✓ |
| Merchant / provider | `merchant-enquiries` | 54 | ✓ | ✓ | ✓ | — |
| Merchant / provider | `merchant-job/[id]` | 102 | ✓ | — | ✓ | — |
| Merchant / provider | `merchant-rfqs` | 62 | ✓ | ✓ | ✓ | — |
| Merchant / provider | `merchant-shop` | 442 | ✓ | — | ✓ | — |
| Merchant / provider | `merchant-staff` | 133 | ✓ | — | ✓ | ✓ |
| Merchant / provider | `merchant-work` | 59 | ✓ | ✓ | ✓ | ✓ |
| Merchant / provider | `proposal-delivery/[id]` | 35 | — | — | ✓ | — |
| Merchant / provider | `proposal/compose/[requestId]` | 62 | — | — | ✓ | — |
| Merchant / provider | `provider-profile/[section]` | 45 | ✓ | — | ✓ | — |
| Merchant / provider | `provider-profile/index` | 163 | ✓ | — | ✓ | — |
| Merchant / provider | `recurring/provider/[id]` | 377 | ✓ | ✓ | ✓ | ✓ |
| Merchant / provider | `rfq/merchant/[id]` | 213 | ✓ | — | ✓ | — |
| Merchant / provider | `sports/manage` | 706 | ✓ | ✓ | ✓ | ✓ |
| Shops & products | `enquiry/[id]` | 131 | ✓ | — | ✓ | — |
| Shops & products | `product/[id]` | 90 | ✓ | — | ✓ | — |
| Shops & products | `products` | 168 | ✓ | ✓ | ✓ | ✓ |
| Shops & products | `rfq/[id]` | 151 | ✓ | — | ✓ | — |
| Shops & products | `rfq/new` | 213 | — | — | ✓ | — |
| Shops & products | `shop/[id]` | 101 | ✓ | — | ✓ | — |
| Shops & products | `shop/index` | 110 | ✓ | ✓ | ✓ | — |
| Sports | `sports-booking/[id]` | 166 | ✓ | — | ✓ | — |
| Sports | `sports-checkout/[id]` | 158 | ✓ | — | ✓ | — |
| Sports | `sports/[activity]` | 89 | ✓ | ✓ | ✓ | ✓ |
| Sports | `sports/bookings` | 90 | ✓ | ✓ | ✓ | — |
| Sports | `sports/index` | 103 | ✓ | ✓ | ✓ | ✓ |
| Sports | `venue/[id]` | 8 | — | — | — | — |

### B.1 Screen-by-screen audit (customer-facing and merchant-critical screens)

Priority: **P0** blocks usability, trust or conversion · **P1** consistency/discoverability · **P2** polish. Type: **F** functional · **V** visual · **A** architecture/maintainability.

| # | Screen / file | Current implementation (verified in code) | Problem | Recommendation | Customer benefit | Type | Pri |
|---|---|---|---|---|---|---|---|
| S1 | Root guard `app/app/_layout.tsx` | Signed-out users on any route except `info`/`byo` are sent to `/login`. | Customers must register before seeing a single provider, venue or shop. | Add guest browsing behind flag `guest_browse`: allow-list browse routes. Ask for sign-in only on a commit action (book, pay, enquire, request quote, chat). Return to the same screen after login. | Try before committing, fewer abandoned installs | F | **P0** |
| S2 | Home `app/app/(customer)/index.tsx` | Header: location + bell. Greeting. Inline search. "Choose a category" grid of families, plus Sports/Shop cards when flags are on. Then active booking, AI card, gradient "Know what happens next" banner, Top rated carousel. | Four marketplaces not visible; active booking appears below the category grid; gradient banner copy is vague; search scope is narrow. | Home v2 (flag `home_v2`), §C.2. Order: location bar → search entry → active booking → 4 marketplace pillars → popular services row → AI card → Top rated → trust strip. Remove the gradient. | Instant understanding of what the app offers, faster resumption | F+V | **P0** |
| S3 | Home search (same file) | `TextInput` filters `catalogue.categories` by `name.includes(query)` on device; hidden when there are no service categories. | No results for shops/products/venues/creators/providers; uses `outlineStyle:'none' as never` web hack. | Tapping search opens a new `app/app/search.tsx` (flag `unified_search`). It searches categories, sports activities, products and shops in parallel using existing APIs (§E.0). | Customers find anything from one box | F | **P0** |
| S4 | Customer tabs `(customer)/_layout.tsx` | Home · Bookings · Me | "Me" is ambiguous for first-time users. No search tab. | Tabs: Home · Search · Bookings · Account. Search tab is shown only when `unified_search` is on. | Search always one tap away | V | P1 |
| S5 | Category `category/[slug].tsx` (373 lines) | Provider list with sort/filter sheets. E2E `category-packers-movers` and `category-kitchen-cleaning` currently fail. | Red E2E: behavior unverified. Provider cards differ from venue, shop and creator cards. | Fix E2E first (Phase 0). Then use the shared `ListingCard` (§D.7). | Comparable listings across categories | F+V | **P0** (E2E) / P1 |
| S6 | Provider `provider/[id].tsx` (642) | Profile, packages, reviews; sticky `Screen footer` with price ("visit fee") + `Book {name}` / `Request proposal` CTA (lines 143–180), including a city-mismatch message | Good footer pattern, but the markup is duplicated in `book/[…]`; the file is very large. | Split into `features/providerProfile/*`; extract the footer into the shared `PriceFooter` without changing its copy or behavior. | Same trusted price+action bar everywhere | A | P1 |
| S7 | Book `book/[providerServiceId].tsx` (684), `book-fixed/[…]` (186), `recurring/new/[…]` (615) | `book` has a sticky "To pay now ₹X" + lock-icon CTA + free-cancellation note (lines 276–300). No booking screen uses `StepIndicator`/`Stepper`. | Three booking entry points with different structures; no visible progress. | One `BookingStepLayout` (`StepIndicator` + content + `PriceFooter`) used by all three; keep business logic unchanged. | Same mental model for every booking | A+V | P1 |
| S8 | Booking detail `booking/[id].tsx` (1,116) | Status hero, timeline, quote, chat entry, payment, review | Largest file in the app; every change risks regressions. | Split into `features/bookingDetail/*` sections with no visual change first, then apply the new status header. | Stable, clear tracking | A | **P0** (enabler) |
| S9 | Activity `features/activity/UnifiedActivityScreen.tsx` (628) | Segmented list across bookings, recurring, sports, RFQs, enquiries. E2E `my-activity-sports-segment` fails. | Red E2E; large file. | Fix E2E; split segments into one file each; add a "Book again" action on completed bookings (P1). | Find and repeat past orders | F+A | **P0** (E2E) / P1 |
| S10 | Sports hub `sports/index.tsx` (103) | "My sports requests" card, "My venues" card (only when `activeRole === 'provider'`), activity list | Entry cards are text-only `Card`s with no icons; activities are listed as plain rows. | Activity grid with icons (`PillarCard`-style tiles in the sports accent); "My bookings" `ListingCard` row; keep the provider-only condition. | Faster activity choice | V | P1 |
| S11 | Sports activity `sports/[activity].tsx` (89) | Title = slug with dashes replaced (lower-case, e.g. "table tennis"); fixed 15 km radius; plain-text `VERIFIED` label; `Pressable` wrapping a `Card`; photo only if present | Lower-case title; inconsistent badge; two nested focus targets; layout jumps when photos are missing. | Activity display name from `list_sports_activities`; `VerifiedBadge`; `ListingCard` with an image placeholder; radius chips 5/10/15 km. | Professional, scannable venue list | V | P1 |
| S12 | Venue `features/sports/SportsVenueBookingScreen.tsx` (367), `sports-checkout/[id]` (158), `sports-booking/[id]` (166) | Slots, duration, payment mode, checkout, booking status. E2E `phase-6-sports-booking-request` fails. | Red E2E after the F1a/F1b merge. | Fix E2E first. Then a slot grid with clear available/held/booked states, sticky "₹X · Continue", and a cancellation/refund preview before paying. | Trustworthy paid booking | F+V | **P0** (E2E) / P1 |
| S13 | Shop `shop/index.tsx` (110), `products.tsx` (168), `product/[id]` (90), `shop/[id]` (101) | Product search input, categories, my enquiries, shop list. RFQ button on products. | Shops use `Card` + text; no product image grid; the RFQ entry is a secondary outline button above the product list (`products.tsx:157`), easy to miss. | Product grid using `ListingCard` (`variant="product"`); a "Need bulk quantity? Get quotes from 3+ shops" banner at the top of `products`; shop header with call/WhatsApp/enquire actions. | Faster product comparison, visible bulk RFQ | V | P1 |
| S14 | RFQ `rfq/new.tsx` (213), `rfq/[id]` (151), flag `product_rfq` | Form + quote list | No side-by-side comparison. | `QuoteCompareTable` (price, delivery days, validity, shop rating), lowest-price highlight, "Select supplier" CTA. | Easier supplier choice | V | P1 |
| S15 | Creators `request/new.tsx` (126), `request/[id]` (68), `proposal/[id]` (95), `proposal-delivery/[id]` (35) | Brief form, proposals, delivery | No creator discovery screen with portfolios; proposals list is plain. | Creators pillar landing: categories → `ListingCard` (`variant="creator"`) with portfolio thumbnails → profile → "Send brief". `ProposalCompareCard` for quotes. Delivery screen shows revisions remaining. | Choose creators by portfolio, not by name | F+V | P1 |
| S16 | Auth `(auth)/login.tsx`, `verify.tsx`, `role.tsx` | Phone OTP; role picker | Role choice is asked before the user has seen any value. | With `guest_browse` on: login is only reached from a commit action. Role picker remains for providers; customers default to customer. | Shorter path to first value | F | P1 |
| S17 | Location `location.tsx` (380) | GPS/saved/search address | Uses `ActivityIndicator` directly (1 of 5 such files). | Replace with `Skeleton` rows; keep logic. | Consistent loading | V | P2 |
| S18 | Provider dashboard `(provider)/dashboard.tsx` (782) | Jobs, requests, recurring section, earnings tiles; 3 hex literals | Very large; mixed concerns. | Split into `features/providerDashboard/*` sections; tokenize colors. | Professional merchant tool | A+V | P1 |
| S19 | Provider onboarding `features/providerOnboarding/ServicesSection.tsx` (860) | Service + package editor | Largest feature file. | Split per editor panel; no behavior change. | Lower regression risk | A | P1 |
| S20 | Sports manage `sports/manage.tsx` (706) | Venue settings, resources, bookings | Large; mixed tabs. | Split per tab into `features/sports/manage/*`. | Easier venue management | A | P1 |
| S21 | Assistant `assistant.tsx` (583) | AI chat with voice. E2E step failed with HTTP 429 (rate limit). | Rate limit is not shown as a friendly state. | On 429, show `InlineAlert` "QuickServe AI is busy. Try again in a minute" + retry; E2E treats 429 as a skip. | No dead ends | F | P1 |
| S22 | Error boundary `components/RouteErrorBoundary.tsx` | 8 hex literals, 5 raw font sizes | Hardcoded colors on purpose? Unverified: it may render outside `ThemeProvider`. | Keep literals but source them from exported `lightPalette` constants; no behavior change. | Consistent crash screen | V | P2 |
| S23 | Admin (17 screens) | Consistent `Screen`/`Header`/`Skeleton` usage | Internal tool; acceptable. | Token compliance only; no redesign. | — | V | P2 |

## C. Navigation and information architecture

### C.1 Target navigation map

```
Root Stack
├── (auth)        login · verify · role                       ← only from a commit action when guest_browse=on
├── (customer) Tabs
│   ├── Home      index (Home v2)
│   ├── Search    search            [flag unified_search]     ← new route app/app/search.tsx (tab entry)
│   ├── Bookings  UnifiedActivityScreen (segments: All · Services · Repeat · Sports · Quotes)
│   └── Account   AccountScreen (renamed tab label from "Me")
├── Home services   category/[slug] → provider/[id] → book | book-fixed | recurring/new → booking/[id]
├── Shops           shop → products → product/[id] | shop/[id] → enquiry/[id];  rfq/new → rfq/[id]
├── Sports          sports → sports/[activity] → venue/[id] → sports-checkout/[id] → sports-booking/[id]
├── Creators        creators (new pillar landing) → category/[slug] → provider/[id] → request/new → request/[id] → proposal/[id] → proposal-delivery/[id]
└── (provider) Tabs  Jobs · Earnings · Me   (unchanged structure; visual refresh only)
```

### C.2 Home v2 information hierarchy (top → bottom)

1. **Location bar** (existing `Pressable`, unchanged behavior) + notifications `IconButton`.
2. **Search entry**: `SearchField` in `mode="entry"`. It is not editable on Home; tapping it pushes `/search`. Placeholder: `Search services, shops, venues…`.
3. **Active booking card**, if any (moved up from below the grid; existing card content).
4. **Marketplace pillars**: 2×2 grid of `PillarCard`. Order: Home services · Shops & products · Sports & venues · Creators & freelancers. A pillar is hidden when its flag is off or it has no content (rules in Document 2, task H-02).
5. **Popular in {city}**: horizontal chips of up to 8 service categories, taken from catalogue order (existing data, no new API).
6. **QuickServe AI card**: existing; copy fixed to languages actually supported (§D.10).
7. **Top rated near you**: existing carousel, rendered with `ListingCard variant="provider"`.
8. **Trust strip**: `TrustStrip` with three items: `Verified providers` · `See the price before you pay` · `Secure online payments`. Gradient banner removed.

Beauty & wellness, Learning and "More services" are reached inside **Home services** as sections, so the four product pillars stay pure.

## D. Complete design system

The existing architecture (`app/src/theme/tokens.ts` → `ThemeProvider` → `useTheme()`/`makeStyles()`) is kept. **Only the tokens below change or are added.** All other token values in `tokens.ts` stay exactly as they are.

### D.1 Color — changed light tokens

| Token | Current | **New** | Contrast check |
|---|---|---|---|
| `primary` | `#1E5EFF` | **`#1F4FD1`** | white on it 6.78:1 (was 5.12) |
| `primaryPressed` | `#1849CC` | **`#1A40AA`** | white on it 8.91:1 |
| `primarySoft` | `#EEF3FF` | **`#EEF2FD`** | `#1F4FD1` on it 6.06:1 |
| `primaryText` | `#1E5EFF` | **`#1F4FD1`** | on `bg #F6F7F9` 6.33:1 |
| `bubbleMine` | `#1E5EFF` | **`#1F4FD1`** | white text 6.78:1 |
| `heroFrom` / `heroTo` | `#1E5EFF` / `#1849CC` | **`#1F4FD1` / `#1A40AA`** (kept for compatibility; Home stops using the gradient) | — |

Dark palette primary values stay unchanged (`#2A62EA`, white text 5.21:1; `primaryText #7DA0FF` on surface 6.86:1).

Rationale: a deeper blue reads as more established and trustworthy, and it raises contrast on CTAs. The brand stays recognizable, so this is not a rebrand.

### D.2 Color — new category accent tokens

These are used **only** for category identity (pillar icons, category tiles, small tags). They are never used for status (success/warning/danger keep their meaning) and never as a CTA fill. Add them to `Palette` as `catHome`, `catHomeSoft`, `catShops`, `catShopsSoft`, `catSports`, `catSportsSoft`, `catCreators`, `catCreatorsSoft`.

| Pillar | Light fg | Light soft bg | fg on soft | Dark fg | Dark soft bg | fg on soft |
|---|---|---|---|---|---|---|
| Home services | `#0F766E` | `#E6F4F1` | 4.84:1 | `#5EEAD4` | `#0B2A27` | 10.33:1 |
| Shops & products | `#B45309` | `#FEF3E2` | 4.58:1 | `#FCD34D` | `#2E2208` | 10.80:1 |
| Sports & venues | `#BE185D` | `#FCE7F1` | 5.13:1 | `#F9A8D4` | `#33101F` | 9.38:1 |
| Creators & freelancers | `#6D28D9` | `#F1EBFE` | 6.11:1 | `#C4B5FD` | `#221447` | 9.03:1 |

### D.3 Color — unchanged semantic set (for reference)

Light: `success #12B76A / successText #067647`, `warning #F79009 / warningText #B54708`, `danger #F04438 / dangerText #B42318`, `info #0BA5EC / infoText #026AA2`, `text #101828` (16.56:1 on bg), `textSecondary #344054`, `muted #667085` (4.64:1 on bg), `subtle #98A2B3` (**decorative only**, 2.58:1), `bg #F6F7F9`, `surface #FFFFFF`, `border #EAECF0`, `borderStrong #D0D5DD`, `outline #8C95A6` (3.02:1, control boundaries only).

**Usage rules:**
1. CTA fill = `primary` only.
2. Green is for status only.
3. Readable text must use `text`, `textSecondary` or `muted`. Never use `subtle` for readable text.
4. At most **one** category accent per card.
5. No gradients except media scrims (`overlay`).

### D.4 Typography

The `typography` record in `tokens.ts` is kept. **Variant names do not change** (renaming would touch every screen). Usage rules:

| Use | Variant | Size/line |
|---|---|---|
| Screen title (large header) | `title1` | 24/30 bold |
| Section header | `title3` | 17/22 semibold |
| Card title | `bodyStrong` | 16/24 semibold |
| Body / descriptions | `body` | 16/24 |
| Secondary line (area, distance) | `footnote` + `muted` | 13/18 |
| Price on cards | `calloutStrong` | 15/20 semibold |
| Price in sticky footer | `title3` | 17/22 |
| Badges/tags | `captionStrong` | 12/16 |
| Buttons | `button` (built into `Button`) | 16/20 |
| Large money totals | `numeric` | 28/34 tabular |

Rules:
1. All text goes through `<Text variant=…>`. Never set a raw `fontSize`/`fontFamily` (15 raw `fontSize` occurrences exist today).
2. Titles use `numberOfLines={1}`. Descriptions use `numberOfLines={2}`.
3. Never use all-caps literal strings. Use the `overline` variant if caps are required.

### D.5 Spacing, radii, elevation, icons

The scales in `tokens.ts` are kept. Standards:
- **Spacing:**
  - Screen gutter `spacing.lg` (16)
  - Card padding `spacing.lg`
  - Gap between sibling cards `spacing.md` (12)
  - Gap between sections `spacing.section` (28)
  - Inline icon–text gap `spacing.sm` (8)
- **Radii:**
  - Badge `xs` (6)
  - Inner panel `sm` (8)
  - Buttons/inputs `md` (12)
  - Cards/images `lg` (16)
  - Bottom sheets `xl` (24)
  - Chips/avatars `pill`
- **Elevation:**
  - Cards rest at `shadows.sm` (`Card variant="outlined"` default)
  - Only floating elements use `md`/`lg`
  - Dark mode uses border + tone, no shadow (existing behavior)
- **Icons:**
  - Ionicons outline style; filled only for the selected tab
  - Sizes from `iconSize` (14/16/20/24/28)
  - Category glyphs keep `MaterialCommunityIcons` and the deliberate neutral tile + tinted glyph design in `CategoryIcon`. The 43 inline tints move into a named `categoryGlyphTints` map in `tokens.ts` with explicit light and dark values, replacing runtime `lighten()`. Pillar accents (§D.2) are used only by pillar-level UI.

### D.6 Interaction standards

- **Touch targets:** ≥ `minTouch` (48). Every pressable has `accessibilityRole` and `accessibilityLabel`.
- **Exactly one pressable per card.** Use `Card onPress`; never wrap a `Card` in a `Pressable`.
- **Pressed feedback:** existing `Button` spring 0.98 scale with reduced-motion respect. Cards use opacity 0.85.
- **Motion:** only `motion.fast`/`motion.base`. No decorative loops.

### D.7 Component standards (new shared components)

Full prop contracts are in Document 2 §3. Summary:

| Component | Purpose | Replaces |
|---|---|---|
| `SearchField` | Shared search input (`mode="entry"` non-editable button, or `"input"`) | Inline `TextInput` on Home, `Input` on Shop |
| `PillarCard` | One marketplace pillar tile with category accent | `BrowseFamilyCard` (local to Home) |
| `ListingCard` | One card for provider, venue, shop, product and creator results (`variant`) | Five ad-hoc card layouts |
| `VerifiedBadge` | Shield icon + "Verified" in `success` tone | Plain `VERIFIED` text |
| `TrustStrip` | 3 trust statements, icon + text | Gradient banner |
| `ChipRow` | Horizontal single-select filter/radius/category chips | Ad-hoc chip rows |
| `MediaImage` | `expo-image` with fixed aspect ratio, skeleton and icon placeholder | Conditional `Image` rendering |
| `PriceFooter` | `Screen footer` content: price label + amount + primary CTA + optional note | Duplicated footer markup in `provider/[id]` and `book/[…]` (extracted, not redesigned) |
| `QuoteCompareTable` | Side-by-side comparison of RFQ quotes / creator proposals | Plain lists |
| `BookingStepLayout` | Step indicator + content + `PriceFooter` | Three different booking layouts |

The existing `Button`, `Card`, `Badge`/`Chip`, `Input`, `BottomSheet`, `EmptyState`/`ErrorState`/`InlineAlert`, `Skeleton*`, `Screen`/`Header`/`Section`/`StickyFooter`, `SegmentedControl`, `Stepper`, `Toast` and `Confirm` are kept unchanged.

### D.8 State standards (every data screen)

| State | Standard |
|---|---|
| Loading | `Skeleton` shaped like the final content (≥ 2 placeholder cards). `ActivityIndicator` only inside buttons. |
| Empty | `EmptyState` with icon + one-sentence title + next action (e.g. "Change area", "Browse services"). |
| Error | `ErrorState` with `onRetry`. Never show a raw Postgres/Edge message to customers. Map it with a shared `friendlyError()`, generalized from the existing `friendlyDbError()` in `src/lib/onboarding/supabaseOnboarding.ts` (Document 2 task C-07). |
| Success | `Toast` for small actions; full `StatusHero` for booking/payment confirmation. |
| Feature off | `InlineAlert` "{Feature} is not available right now", plus a link back to Home. |
| Rate limited (AI) | `InlineAlert` "busy, try again in a minute" + retry. |

### D.8a Merchant experience standards

Merchant screens (`(provider)/*`, `merchant-*`, `sports/manage`) keep their current layouts. They receive:
1. The same tokens and `ListingCard`/`Badge` language.
2. Sectioned files (Document 2, workstream M).
3. Status pills from `components/status.tsx` for every job/booking state.

### D.9 Light and dark theme

Keep the current automatic `useColorScheme()` switch. Every new token has a light and a dark value (§D.1–D.2). No manual theme toggle is added in this redesign (P2 candidate).

### D.10 Language and copy

Only `en` and `te` exist in `src/i18n`, and 4 UI files use it.
- **P1:** every string introduced by this redesign is added to `src/i18n/en.ts` and read through `useT()` from `src/i18n`. `te.ts` is a `Partial` draft that falls back to English (`src/i18n/index.tsx:119`). Telugu entries are added as drafts and need native-speaker review before release.
- **Copy fix:** the AI card must not advertise Hindi until a `hi` locale exists. New copy: `Describe the problem in English or తెలుగు`.
- **Rules:** money is formatted with `formatINR`; distances as `1.2 km`; dates as `Mon, 24 Nov · 6:00 PM`.

## E. Improved customer journeys

### E.0 Unified search (all pillars)

`/search`: one `SearchField` (`mode="input"`, autofocus) + `ChipRow` scope chips `All · Services · Shops · Sports · Creators`. On submit (debounced 300 ms, minimum 2 characters), the screen calls these existing APIs **in parallel**:
- `getCatalogue(city)`: filtered on device by name; split into Services vs Creators using the catalogue families
- `supabase.rpc('list_sports_activities')`: filtered on device by name
- `searchProducts({ query, lat, lng, … })` from `features/shops/api.ts`
- `searchShops(lat, lng)` from the same file. It is location-only, so results are filtered on device by shop name.

The sports and shop calls run only when their pillar flags are on (`sports`, `products`). Results render as grouped sections of `ListingCard`, with at most 5 per group plus "See all". **No new backend RPC is required for v1.**

### E.1 Home services

Home → **Home services** pillar → category section list (existing `CatalogueSections`) → `category/[slug]` (provider `ListingCard`s with sort/filter) → `provider/[id]` (portfolio, packages, reviews, `PriceFooter` "From ₹X · Book") → `BookingStepLayout`. Steps:
1. **Booking type:** one-time or repeat. The repeat option is shown only when `recurring_bookings` is on.
2. **Date and time**
3. **Address**
4. **Review price:** `PriceBreakdown`
5. **Pay or confirm**

Then `booking/[id]`: status header + timeline + chat + receipt. After completion: review prompt and **Book again**.

### E.2 Shops & products

Shops pillar → `shop`. The screen shows:
- `SearchField` + product category chips
- "Get quotes from multiple shops" banner (when `product_rfq` is on)
- Nearby shops as `ListingCard variant="shop"`

Path: `products` (2-column product grid; price "from ₹" + shop + distance) → `product/[id]` (gallery, specs table, "Enquire" and "Call shop") → `enquiry/[id]` chat.

Bulk path: `rfq/new` → `rfq/[id]` with `QuoteCompareTable` → "Select supplier".

### E.3 Sports & venues

Sports pillar → `sports` (activity grid with icons; "My bookings") → `sports/[activity]` (venue `ListingCard`s with photo, distance, "from ₹/hr", `VerifiedBadge`, radius `ChipRow`) → `venue/[id]`:
1. Date strip
2. Slot grid (available / held / booked / past)
3. Duration stepper
4. Participants (when capacity flag is on)
5. Payment choice (online or pay at venue, per venue settings and `sports_online_payments`)
6. Cancellation policy preview

Then `sports-checkout/[id]` → `sports-booking/[id]` (status, venue directions, cancel/refund preview).

### E.4 Creators & freelancers

Creators pillar → **new** `creators` landing (flag `creators_landing`):
- Creator categories from the catalogue's `creative-events` family (video editing, photography, design, social media, web), shown as tiles
- A 4-step "How it works" strip: Send a brief → Compare proposals → Approve and pay → Get delivery
- *(P2, needs a new portfolio listing API)*: featured creators as `ListingCard variant="creator"` with 3 portfolio thumbnails

Path: `provider/[id]` (portfolio grid first, packages, reviews) → `request/new` (brief: what, budget range, deadline, references) → `request/[id]` (proposals via `QuoteCompareTable`) → `proposal/[id]` (accept + pay milestone) → `proposal-delivery/[id]` (delivery files, revisions remaining *if the API already exposes a revision count; otherwise a reported backend gap*, approve/request revision) → review.

## F. Prioritized improvement roadmap

| Pri | Item | Section |
|---|---|---|
| **P0** | Make `main` E2E green (7 failing steps) and capture a 3-viewport screenshot baseline | §B S5, S9, S12 |
| **P0** | Guest browsing with login on commit (`guest_browse`) + backend read access verified for anonymous users | §B S1 |
| **P0** | Home v2 with 4 pillars, active booking on top, trust strip (`home_v2`) | §C.2 |
| **P0** | Unified search screen + tab (`unified_search`) | §E.0 |
| **P0** | Split the 9 largest files (no behavior change) so parallel work is safe | §B S6–S9, S18–S20 |
| **P1** | Tokens: deeper primary + category accents | §D.1–D.2 |
| **P1** | Shared components: `SearchField`, `PillarCard`, `ListingCard`, `VerifiedBadge`, `TrustStrip`, `ChipRow`, `MediaImage`, `PriceFooter`, `QuoteCompareTable`, `BookingStepLayout` | §D.7 |
| **P1** | Per-pillar journey refresh (Home services, Shops, Sports, Creators) | §E.1–E.4 |
| **P1** | Book again, friendly errors, AI 429 state, i18n for new strings | §B S9, S21, §D.8, §D.10 |
| **P1** | Merchant dashboard / onboarding / sports manage split + token compliance | §D.8a |
| **P2** | Move `CategoryIcon` tints into `categoryGlyphTints`; remaining hex/fontSize literals, `ActivityIndicator` → `Skeleton`, admin token compliance, manual theme toggle | §B S17, S22, S23 |

## G. Implementation plan

See **Document 2**: [`14-UI-Redesign-AI-Execution-Plan.md`](14-UI-Redesign-AI-Execution-Plan.md). It lists exact files, steps, dependencies, regressions to watch and acceptance criteria for every task.

## H. Testing strategy (summary; full checklist in Document 2 §8)

| Area | How |
|---|---|
| iOS / Android | EAS preview builds (`build-apk.yml` for Android); manual checklist on 1 small Android (360×640), 1 large Android, 1 iPhone. |
| Screen sizes | Playwright web smoke on 360×640, 390×844 and 768×1024 viewports; screenshots uploaded as CI artifacts. |
| Navigation | E2E steps per pillar (Document 2 task Q-02). |
| Accessibility | Jest contrast test over every token pair (Q-01); `accessibilityLabel`/role lint via grep gate; font scale 1.3 spot-check. |
| Booking & payment | Existing E2E booking/sports/proposal steps stay required; Razorpay test mode unchanged. |
| Regression | Every lane: typecheck + Jest (lane CI); `main`: full web E2E. Every feature flag is tested in **both** on and off states. |

## I. Decisions requiring owner approval

| # | Decision | Recommended |
|---|---|---|
| 1 | Guest browsing (no login to browse) | **Yes**, behind `guest_browse` |
| 2 | Four pillars on Home; Beauty/Learning move inside Home services | **Yes** |
| 3 | Primary color `#1E5EFF` → `#1F4FD1` plus four category accents | **Yes** |
| 4 | Remove the gradient guarantee banner and replace it with a trust strip | **Yes** |
| 5 | Add a Search tab; rename "Me" → "Account" | **Yes** |
| 6 | Remove "हिंदी" from AI copy until a Hindi locale exists | **Yes** |
| 7 | New Creators landing route `app/app/creators.tsx` | **Yes**, behind `creators_landing` |
| 8 | Flag only *behavior* changes (`home_v2`, `unified_search`, `guest_browse`, `creators_landing`, `booking_steps`, `book_again`). Pure visual consistency swaps (shared cards, badges, chips) ship unflagged, protected by E2E + screenshot review. This avoids keeping two copies of every screen. | **Yes** |
