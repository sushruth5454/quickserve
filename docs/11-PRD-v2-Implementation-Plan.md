# QuickServe — PRD v2 Implementation Plan

| | |
|---|---|
| **Scope** | Turn the PRD v2 ("Sangareddy All-in-One Local Marketplace") into small, safe, admin-switchable changes on top of the existing QuickServe code |
| **Code baseline** | `sushruth5454/quickserve` @ `9cbe984` (2026-11-17). Latest migration `0041_admin_support.sql`. 70 public tables. Last full E2E run `43938899799`: 143 screens, 0 failures |
| **Audience** | The coding model that implements this. Every step is written to be followed literally |
| **Source** | PRD v2 Google Doc (shared 2026-11-17) and the repository |

---

## Summary

- **Build PRD v2 gradually on the existing app. Do not rewrite.** Home services and creators already work end to end. The new work is mostly additive.
- **Every new feature has an admin on/off switch** (feature flag) and is enforced **on the server**, not only hidden in the app.
- **Order:** Phase 0 (feature switch registry), then config (commission, coins), creator revisions, Telugu, geography, sports, products, AI, staff roles.
- **Locked decisions:** 100 coins = ₹10; admin stays inside the app; existing booking statuses are not renamed; products and sports get their own tables.
- **Estimated effort:** about 30–45 working days for Phases 0–8, excluding deferred items. These are estimates, not a measured work breakdown.

---

## 1. Locked decisions

| # | Decision | Reason |
|---|---|---|
| D1 | **100 coins = ₹10** (1 coin = 10 paise). The ledger stays in **paise**; only the coin↔paise factor changes. | Owner decision (2026-11-17). PRD §8. |
| D2 | **Admin stays inside the Expo app** (`app/app/admin/**`). A separate Next.js admin is deferred. | It already exists and works. A second deployable is not needed for the pilot. |
| D3 | **Every new feature is behind a feature flag** that the admin can switch off at any time. The server refuses the action when the flag is off. | Owner requirement. |
| D4 | **Do not rename existing booking statuses.** The app uses 19 `booking_status` values in its state machine (`archetype_transitions`). Show PRD-style labels in the UI instead. | Renaming breaks the live state machine and every migration since 0001. |
| D5 | **Products & shops use their own tables.** Do not reuse `bookings`, `service_requests` or `proposals` for products. | PRD §2.2 rule. Different data (brands, specs, GST per line, delivery). |
| D6 | **Sports phase 1 uses its own tables and "pay at venue" booking requests.** No online sports payment in phase 1. | PRD §2.3: instant booking only when availability is reliable. Keeps the core booking engine untouched. |
| D7 | **Commission is admin-configurable.** Seed the config with today's values so behaviour does not change until the admin changes it. | PRD: "do not hardcode commissions". Today it is hardcoded in SQL. |
| D8 | **No new npm packages for Telugu.** Use a small in-repo translation module. | This corporate machine must not download from public package registries; builds run in GitHub Actions. |
| D9 | **AI never decides money, availability, verification or prices.** AI output is a draft the user confirms. | PRD §6 safety rules. |

---

## 2. Rules for the implementing model (read before every phase)

### 2.1 Workflow

1. Work in `C:\Users\snizampuram\source\quickserve-main-verify` (branch `integrate/full-booking`). Push with `git push origin HEAD:main`.
2. Always pass `--repo sushruth5454/quickserve` to `gh`.
3. **Never run `npm install`, `npx <package-not-installed>`, `deno` remote imports or `pip` on this machine.** Only run tools that already exist in `app/node_modules` and `supabase/tests/node_modules`.
4. Before every commit run `git checkout -- app/tsconfig.json` (Expo rewrites it).
5. One phase = one or more small commits. Never mix two phases in one commit.
6. After pushing, check the GitHub Actions runs:
   - `supabase/**` changes trigger **Deploy backend (Supabase)**. It runs the SQL tests, then applies migrations and deploys functions.
   - `app/**` changes trigger **Publish app to Expo Go (EAS Update)**. It runs `npx tsc --noEmit` and `npx jest`.
   - Run **E2E web smoke test** manually: `gh workflow run e2e-web.yml --repo sushruth5454/quickserve --ref main`.
7. A phase is **done** only when: both workflows succeed, the E2E run shows `failed steps: 0, page errors: 0, console errors: 0`, and the phase's own "Done when" list is true.
8. If a step is ambiguous, stop and ask the owner. Do not guess business rules (prices, percentages, legal text).

### 2.2 New migration checklist (every migration)

| Step | File | What to add |
|---|---|---|
| 1 | `supabase/migrations/00NN_<name>.sql` | The migration. Use the next free number. |
| 2 | `supabase/tests/package.json` | `node parse.cjs ../migrations/00NN_<name>.sql && ` in the `test` chain, after the previous migration. |
| 3 | `.github/workflows/deploy-backend.yml` | `("00NN", "00NN_<name>.sql"),` in the migration list, after the previous one. Keep the same 14-space indent. |
| 4 | `supabase/tests/review_fixes.test.mjs` (and any other test that loads the full chain, e.g. a new `prd_v2.test.mjs`) | `'00NN_<name>.sql',` at the end of the migration file array. |

**Gotchas**
- **Adding a value to a Postgres enum and using it in the same migration fails** ("unsafe use of new enum value"). Put `alter type ... add value` in its own migration (see `0020_proposal_enum_values.sql`).
- **PGlite tests stub PostGIS.** Only `st_makepoint`, `st_setsrid`, `st_distance`, `st_dwithin`, `st_x`, `st_y` exist. `using gist` is rewritten to `using btree`, so **do not use exclusion constraints**. Prevent overlaps with an advisory lock + `not exists` check (pattern: `accept_proposal` in `0038_proposal_lead_time.sql`).
- **The notifications kind list is one check constraint.** To add a kind, drop and recreate `notifications_kind_check` with the **full** list copied from the latest migration that defines it (currently `0041_admin_support.sql`) plus the new kinds.
- **A new booking status transition** needs a row in `public.archetype_transitions (archetype, from_status, to_status, actor)` or `_set_status` rejects it.
- Money is always **integer paise**. Never store rupees as decimals.

### 2.3 Server function template

Every new RPC follows this shape.

```sql
create or replace function public.<name>(<params>)
returns <type>
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public._require_uid();
begin
  perform public._assert(public._feature_enabled('<flag_key>'), '<Feature name> is turned off right now.');
  -- ownership / role checks, e.g.
  -- perform public._assert(<row>.owner_id = v_uid, 'not allowed');
  -- validate every input; compute every amount on the server
  ...
end;
$$;

revoke execute on function public.<name>(<arg types>) from public, anon;
grant execute on function public.<name>(<arg types>) to authenticated;
```

**Admin-only RPCs** start with `perform public._assert(public._is_admin(), 'admin only');` and insert into `public.admin_audit_log (admin_id, action, target_id, details)`.

**Private helpers** (names starting `_`): `revoke execute ... from public, anon, authenticated;`.

### 2.4 App feature-gating template

```tsx
import { useAppFeatureFlags } from '../src/lib/featureFlags';
const flags = useAppFeatureFlags();
if (!flags.isOn('<flag_key>')) return null; // hide the entry point
```

Hide every entry point (home shortcut, tab segment, menu row) when the flag is off. **Still enforce on the server** (2.3).

### 2.5 Test template

- SQL behaviour tests go in `supabase/tests/prd_v2.test.mjs` (created in Phase 0 by copying the prelude, helpers `ok/as/fails/one` and migration loader from `review_fixes.test.mjs`). Add `&& node prd_v2.test.mjs` at the end of the `test` script in `supabase/tests/package.json`.
- Each feature needs at least: (a) works when the flag is on, (b) refused with the "turned off" message when the flag is off, (c) another user cannot read or change it, (d) admin-only RPC refused for a normal user.
- App logic helpers (pure functions) get Jest tests in `app/src/lib/__tests__/`.
- User flows get steps in `e2e/all-services.mjs`.

---

## 3. Current state (what exists)

| Area | Status | Evidence |
|---|---|---|
| Home services (inspect & quote, fixed packages) | Built | `0018`–`0019`, `0029`; 8 + 3 live categories |
| Creators & events (proposals, milestones, deliverables, start code, urgent) | Built | `0023`, `0039`, `0040`; 19 live categories |
| Time-based sessions (tutor) | Built | `0022` |
| Payments | Razorpay Orders + hosted checkout (test mode) | `supabase/functions/create-payment`, `verify-payment` |
| Coins | Ledger in paise, 1 coin = ₹1, 2% earn, 10% redemption cap, 6-month expiry | `0015_seva_coins.sql`, `app/src/lib/coins.ts` |
| Commission | Hardcoded: 0% for 30 days, then 12% / 10% (50 jobs) / 8% (200 jobs), repeat customer −4% floored at 5% | `0016_leakage_programme.sql` `_commission_bp` |
| Admin | In-app dashboard, features (3 switches), services/cities, people, bookings/disputes, support | `0041`, `app/app/admin/**` |
| Feature flags | `app_config.features` jsonb with a hardcoded whitelist of 3 keys | `0041` `admin_set_feature` |
| Geography | Live cities from `category_cities`; hardcoded `POPULAR_AREAS` | `app/src/lib/locationModel.ts:50` |
| Telugu | None. "Language: English" shows "coming soon" | `app/src/components/AccountScreen.tsx` |
| AI | Gemini assistant; `ai_usage` logs only `transcribe`, `voice_chat`, `photo` | `0006_ai_assistant_v2.sql` |
| Products & shops | None | — |
| Sports | None | — |
| Staff roles | None | — |

---

## 4. Phase plan

| Phase | Name | Flag(s) | Depends on | Effort (days) |
|---|---|---|---|---|
| 0 | Feature switch registry | — | — | 1–1.5 |
| 1 | Commission config | — (config) | 0 | 1.5–2 |
| 2 | Coins: 100 = ₹10 + configurable rules | `coins_earning`, `coins_redemption` | 0 | 2–3 |
| 3 | Creator revisions | `creator_revisions` | 0 | 1.5–2 |
| 4 | Telugu + English | `telugu_language` | 0 | 3–5 |
| 5 | Geography (states → districts → cities → areas) | `area_picker` | 0 | 2–3 |
| 6 | Sports phase 1 (booking requests) | `sports` | 0, 5 | 4–6 |
| 7a | Shops, catalogue, search, enquiries | `products`, `product_enquiries` | 0, 5 | 5–7 |
| 7b | Requests for quotation (RFQ), supplier quotes, comparison | `product_rfq` | 7a | 4–6 |
| 8 | AI: usage/cost logging, product search, quote extraction | `ai_product_search`, `ai_quote_extract` | 7a/7b | 4–6 |
| 9 | Unified "My Activity" | — | 6, 7 | 1–2 |
| 10 | Merchant staff roles | `merchant_staff` | 7a | 3–4 |
| — | **Deferred:** Next.js admin, online product checkout/cart/returns, instant paid sports slots, subscriptions, sponsored listings, referral campaigns | | | |

---

## Phase 0 — Feature switch registry

**Goal:** adding a new admin switch must need only one `insert` row, with no code edits in the admin screen.

### 0.1 Migration `0042_feature_registry.sql`

```sql
create table if not exists public.feature_flags (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{2,48}$'),
  enabled boolean not null default false,
  label text not null check (char_length(label) between 2 and 60),
  description text not null default '',
  group_name text not null default 'General',
  sort_order int not null default 100,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);
alter table public.feature_flags enable row level security;
revoke all on public.feature_flags from anon, authenticated;

-- Carry over the three existing switches with their current values.
insert into public.feature_flags (key, enabled, label, description, group_name, sort_order)
select k, coalesce((select (value ->> k)::boolean from public.app_config where key = 'features'), true), l, d, g, s
  from (values
    ('ai_assistant', 'AI assistant', 'Voice/text matching and AI booking drafts.', 'AI', 10),
    ('urgent_requests', 'Urgent creator requests', 'Creator and event requests from 2 hours away.', 'Bookings', 20),
    ('fixed_asap', 'ASAP for fixed-price services', 'Immediate cleaning and similar package bookings.', 'Bookings', 30)
  ) v(k, l, d, g, s)
on conflict (key) do nothing;
```

Then replace these functions (same names and signatures as in `0041`, so callers keep working):

| Function | New behaviour |
|---|---|
| `_feature_enabled(p_key text)` | `select coalesce((select enabled from public.feature_flags where key = p_key), false)`. **Unknown keys are OFF.** |
| `get_app_features()` | `jsonb_object_agg(key, enabled)` over `feature_flags` `|| jsonb_build_object('archetypes', <app_config archetype_flags>)`. Keep `grant execute ... to anon, authenticated`. |
| `admin_set_feature(p_key, p_enabled)` | Keep the `archetype:` branch from 0041. Otherwise `update public.feature_flags set enabled = p_enabled, updated_at = now(), updated_by = v_uid where key = p_key;` and if `not found` raise `'unknown feature'`. Audit log. Return `get_app_features()`. |
| **new** `admin_list_features()` | Admin only. Returns `table (key, enabled, label, description, group_name, sort_order, updated_at)` ordered by `group_name, sort_order`. |

**Every later phase adds its own flag** with:
```sql
insert into public.feature_flags (key, enabled, label, description, group_name, sort_order)
values ('<key>', false, '<Label>', '<One sentence>', '<Group>', <n>)
on conflict (key) do nothing;
```
New flags start **OFF** in production. The admin turns them on.

### 0.2 App

| File | Change |
|---|---|
| `app/src/lib/adminApi.ts` | `AdminFeatures` → `Record<string, boolean> & { archetypes: Record<string, boolean> }`. Add `listFeatures()` calling `admin_list_features`. |
| `app/src/lib/featureFlags.ts` | `DEFAULT_FEATURES = { ai_assistant: true, urgent_requests: true, fixed_asap: true, archetypes: {...} }` (all other keys default **false** if the fetch fails). Return `{ ...features, isOn: (key) => features[key] === true }`. Re-fetch when the app returns to the foreground (`AppState` `active`). |
| `app/app/admin/features.tsx` | Delete the hardcoded `FEATURES` array. Load `listFeatures()`, group by `group_name`, render one `Switch` per row. Keep the "Service types" section as is. |
| Existing callers (`(customer)/index.tsx`, `request/new.tsx`, `PackageBookingScreen.tsx`) | Switch to `flags.isOn('<key>')`. Behaviour must not change. |

### 0.3 Tests (`supabase/tests/prd_v2.test.mjs`, created now)
- The three migrated flags keep their previous values.
- An unknown key returns `false` from `_feature_enabled`.
- `admin_set_feature('does_not_exist', true)` fails with `unknown feature`.
- `admin_list_features()` is refused for a normal user.

**Done when:** admin Features screen shows the 3 switches from the database; toggling AI off still blocks the AI function (existing check in `supabase/functions/ai-assistant/index.ts`); E2E green.

---

## Phase 1 — Commission config

**Goal:** the admin sets the founding (free) period, tiers and category overrides. Default values = today's values.

### 1.1 Migration `0043_commission_config.sql`

```sql
insert into public.app_config (key, value) values ('commission', '{
  "founding_days": 30,
  "tiers": [{"min_jobs": 200, "bp": 800}, {"min_jobs": 50, "bp": 1000}, {"min_jobs": 0, "bp": 1200}],
  "repeat_discount_bp": 400,
  "repeat_floor_bp": 500
}'::jsonb) on conflict (key) do nothing;
```

- Replace `_commission_bp(p_provider_id uuid, p_at timestamptz)`:
  - If `p_at < provider.created_at + founding_days days` → `0`.
  - Else the `bp` of the first tier (tiers sorted by `min_jobs` desc) with `jobs_completed >= min_jobs`.
- Replace the 4-argument `_commission_bp(p_provider_id, p_customer_id, p_booking_id, p_at)`:
  1. `v_bp := _commission_bp(p_provider_id, p_at)`.
  2. If `v_bp > 0` and the booking's category has `categories.commission_bp is not null` → `v_bp := categories.commission_bp`.
  3. Repeat-customer rule as today, using `repeat_discount_bp` and `repeat_floor_bp` from config.
- **New** `get_commission_terms()` (authenticated, any user): returns `{founding_days, tiers, my_bp, my_free_until}` where `my_*` is for the caller if they are a provider (else null). Used by the app instead of hardcoded text.
- **New** `admin_set_commission(p_config jsonb)` (admin): validate `founding_days` 0–365, each `bp` 0–3000, `min_jobs` ≥ 0, last tier `min_jobs = 0`. Store; audit.
- **New** `admin_set_category_commission(p_category_id uuid, p_bp int)` (admin): `p_bp` null or 0–3000.

**Gotcha:** `_coin_platform_cap` calls the 2-argument version. That is fine; keep it.

### 1.2 App — remove hardcoded commission text

| File | Line today | Change |
|---|---|---|
| `app/app/(auth)/role.tsx` | 24 `'0% commission for your first 30 days'` | Use `get_commission_terms().founding_days`. If the call fails, show `'Low commission on in-app jobs'`. |
| `app/src/lib/providerInsights.ts` `tierProgress` | tiers hardcoded | Accept `tiers` and `foundingDays` as parameters. Update its Jest test. |
| `app/app/(provider)/earnings.tsx` | 345 `'Then 12%, falling to 10% at 50 jobs.'` | Build from `tiers`. |
| `app/app/quote/[bookingId].tsx` | already uses `rateBp` | No change; verify it reads the server value. |
| **new** `app/app/admin/commission.tsx` | — | Form: founding days, tiers table, repeat discount/floor, per-category override list. Link from admin dashboard. |

### 1.3 Tests
- Defaults reproduce today: day 10 → 0; 0 jobs → 1200; 60 jobs → 1000; 250 jobs → 800; repeat customer at 1200 → 800; floor 500.
- Change `founding_days` to 90 → a 60-day-old provider gets 0.
- Category override 500 applies after founding.
- Invalid config rejected; normal user refused.

**Done when:** admin can change founding days to 90 and the provider earnings screen shows the new date without an app update.

---

## Phase 2 — Coins: 100 coins = ₹10, configurable rules

**Goal:** 1 coin = 10 paise. Earning, caps, budget and redemption come from admin config. Earning and redemption each have a switch.

### 2.1 Migration `0044_coins_config.sql`

```sql
insert into public.app_config (key, value) values ('coins', '{
  "coin_paise": 10,
  "earn_rate_bp": 100,
  "per_txn_cap_paise": 2000,
  "first_txn_bonus_paise": 1000,
  "monthly_cap_paise": 100000,
  "redeem_cap_bp": 1000,
  "expiry_months": 6,
  "pilot_budget_paise": 1000000
}'::jsonb) on conflict (key) do nothing;
-- flags
insert into public.feature_flags (key, enabled, label, description, group_name, sort_order) values
  ('coins_earning', true, 'Coins: earning', 'Customers earn coins on completed in-app bookings.', 'Coins', 10),
  ('coins_redemption', true, 'Coins: redemption', 'Customers can use coins as a discount.', 'Coins', 20)
on conflict (key) do nothing;
```

Values above are the **PRD values** (1% earn, max ₹20 per booking, ₹10 first-booking bonus, ₹10,000 pilot budget, 10% redemption cap). `monthly_cap_paise` keeps today's ₹1,000. **Confirm these numbers with the owner before enabling in production.**

Changes to `0015_seva_coins.sql` functions (redefine them in 0044):

| Today | New |
|---|---|
| Earn: `floor(eligible / 5000) * 100` (2%, whole ₹1) | `amount = floor(eligible * earn_rate_bp / 10000 / coin_paise) * coin_paise`; `amount = least(amount, per_txn_cap_paise)`; add `first_txn_bonus_paise` if this is the customer's first completed in-app booking (no prior `earn` ledger row); then the monthly cap; then the **pilot budget**: `amount = least(amount, budget - total ever credited with kind in ('earn','bonus'))`. If `coins_earning` is off → return 0. |
| Redemption rounding `floor(x / 100) * 100` (lines 233, 306) | `floor(x / coin_paise) * coin_paise` |
| Redemption 10% cap hardcoded (`* 10 / 100`) | `* redeem_cap_bp / 10000` |
| Expiry `interval '6 months'` | `make_interval(months => expiry_months)` |
| Redemption RPCs | First line: `perform public._assert(public._feature_enabled('coins_redemption'), 'Coins can''t be used right now.');`. Preview returns `maximum_paise = 0` when off. |

**Existing balances keep the same rupee value.** A ₹50 balance (5,000 paise) now displays as **500 coins**. Add a one-time in-app notice: "Coins are now 10 paise each. Your balance value hasn't changed."

New admin RPC `admin_coin_summary()` → `{issued_paise, redeemed_paise, expired_paise, outstanding_paise (liability), budget_paise, budget_left_paise}`. New `admin_set_coins_config(p_config jsonb)` with validation (all ≥ 0, `coin_paise` ∈ {1, 10, 100}, rates ≤ 10000).

### 2.2 App

| File | Change |
|---|---|
| `app/src/lib/coins.ts` | `COIN_PAISE = 10`; `coinPaiseToCoins(p) = Math.floor(p / COIN_PAISE)`; earn/redeem helpers take the config. |
| `app/src/lib/__tests__/coins.test.ts` | Rewrite expectations for 10-paise coins and PRD rules (e.g. ₹2,150 job at 1% = 2,150 paise → capped 2,000 paise = 200 coins). |
| `app/src/components/AccountScreen.tsx` line 126 | `'100 coins = ₹10 · valid for 6 months'` (months from config). Hide row if both coin flags off. |
| Coins screen (`app/app/coins.tsx`) and booking coin preview | Show coins and the ₹ value side by side ("500 coins · ₹50"). |
| **new** `app/app/admin/coins.tsx` | Summary from `admin_coin_summary`, config form. |

### 2.3 Tests
- ₹2,150 eligible → 200 coins (per-booking cap). First booking → + 100 coins bonus.
- Budget exhausted → earn returns 0; ledger unchanged.
- `coins_earning` off → 0; `coins_redemption` off → redeem refused, preview 0.
- Existing balance in paise unchanged after migration.

**Done when:** Ravi's coin balance shows 10× the old coin count with the same ₹ value; admin can see liability and switch earning/redemption off.

---

## Phase 3 — Creator revisions

**Goal:** after a creator submits deliverables, the customer can request a revision (up to an allowed number) instead of only accepting.

### 3.1 Migration `0045_creator_revisions.sql`

- Flag `('creator_revisions', false, 'Creator revisions', 'Customers can ask creators to revise delivered work.', 'Creators', 10)`.
- `alter table public.bookings add column if not exists revisions_allowed int not null default 2 check (revisions_allowed between 0 and 10), add column if not exists revisions_used int not null default 0 check (revisions_used >= 0);`
- Replace `bookings_delivery_status_check` with `('not_applicable','pending','submitted','revision_requested','accepted')`.
- `insert into public.archetype_transitions values ('proposal', 'completion_requested', 'delivery_pending', 'customer') on conflict do nothing;`
- **New** `request_revision(p_booking_id uuid, p_note text)`: customer only; flag on; `archetype='proposal'`, `status='completion_requested'`, `delivery_status='submitted'`, `revisions_used < revisions_allowed`, note 5–1000 chars. Set `delivery_status='revision_requested'`, `revisions_used = revisions_used + 1`, `completion_requested_at = null`; `_set_status(id, 'delivery_pending', uid, 'revision requested: ' || note)`; notify provider kind `revision_requested`.
- Replace `submit_delivery`: accept `delivery_status in ('pending','revision_requested')`.
- Add notification kind `revision_requested` (full constraint list, see 2.2 gotchas).
- `revisions_allowed`: set on proposal booking insert from the proposal's deliverables `revisions` field if present, else `2`. Add an optional "Revisions included" number to the proposal composer (`app/app/proposal/compose/[requestId].tsx`) stored in `p_deliverables` as `{"type":"revisions","qty":N}`.

**Gotcha:** `auto_confirm_completions` (latest in `0030_review_fixes.sql`) completes `completion_requested` bookings automatically: after **168 h (7 days)** for proposals with deliverables, 24 h otherwise. Setting `completion_requested_at = null` on a revision stops auto-completion; `submit_delivery` sets it again. Add a SQL test that a booking with a pending revision is **not** auto-completed.

### 3.2 App
- `app/app/booking/[id].tsx`: when customer, `status='completion_requested'`, `delivery_status='submitted'`, flag on and revisions left → button **"Request changes (N left)"** opening a note sheet.
- Provider sees "Revision requested" with the note and the existing "Submit delivery" button.
- `app/src/components/StatusTimeline.tsx` proposal flow: label `delivery_pending` with `revisions_used > 0` as "Revision in progress".

### 3.3 Tests
Revision allowed once, twice, third refused (default 2); flag off refused; provider cannot call it; resubmission moves back to `completion_requested`.

---

## Phase 4 — Telugu + English

**Goal:** every screen text comes from translation files; user picks English or తెలుగు; admin can hide the picker.

### 4.1 Files
| File | Content |
|---|---|
| `app/src/i18n/en.ts` | `export const en = { 'home.search.placeholder': 'Search for a service', ... } as const;` |
| `app/src/i18n/te.ts` | `export const te: Partial<Record<keyof typeof en, string>> = { ... };` |
| `app/src/i18n/index.tsx` | `LanguageProvider` (AsyncStorage key `quickserve.lang.v1`, values `'en' \| 'te'`), `useT()` returning `t(key, vars?)`. Missing Telugu key → English. `{name}` placeholders replaced from `vars`. |
| `app/app/_layout.tsx` | Wrap with `LanguageProvider`. |
| Migration `0046_preferred_language.sql` | `alter table public.profiles add column if not exists preferred_language text not null default 'en' check (preferred_language in ('en','te'));` + flag `('telugu_language', false, 'Telugu language', 'Show the language picker and Telugu text.', 'App', 40)`. |

### 4.2 Steps
1. Build the module and the Language picker in `AccountScreen` (replace "coming soon"). Hidden when `telugu_language` is off; then force `'en'`.
2. Convert screens **in this order**, one commit per group: auth (login, verify, role) → home + location → category + provider + book → bookings + booking detail → account + support → provider dashboard + jobs → onboarding → creators/proposals → admin (English only is acceptable for admin).
3. Key naming: `<screen>.<element>`. Never build sentences by joining fragments; use one key with `{placeholders}`.
4. Telugu text: draft, then **a native Telugu speaker must review** before the flag is turned on. Mark unreviewed entries with a `// review` comment.
5. Save `preferred_language` to the profile when changed (for push notification language later).

**Gotchas:** Inter has no Telugu glyphs. Do not force `fontFamily` on Telugu text; let the system font render it. Check on a real Android and iPhone. Telugu text is longer; check buttons don't overflow.

**Done when:** with the flag on and Telugu selected, the converted screens show Telugu, untranslated keys fall back to English, and E2E (English) is still green.

---

## Phase 5 — Geography

**Goal:** admin manages states → districts → cities → areas. Remove hardcoded `POPULAR_AREAS`.

### 5.1 Migration `0047_geography.sql`
```sql
create table public.geo_states (id uuid primary key default gen_random_uuid(), name text not null unique, active boolean not null default true);
create table public.geo_districts (id uuid primary key default gen_random_uuid(), state_id uuid not null references public.geo_states(id), name text not null, active boolean not null default true, unique (state_id, name));
create table public.geo_cities (id uuid primary key default gen_random_uuid(), district_id uuid not null references public.geo_districts(id), name text not null, lat double precision, lng double precision, active boolean not null default true, unique (district_id, name));
create table public.geo_areas (id uuid primary key default gen_random_uuid(), city_id uuid not null references public.geo_cities(id), name text not null, lat double precision not null check (lat between -90 and 90), lng double precision not null check (lng between -180 and 180), active boolean not null default true, sort_order int not null default 100, unique (city_id, name));
```
- RLS on; `select` policy `to anon, authenticated using (active)` on all four.
- Seed only names: Telangana → Sangareddy (district) → Sangareddy (city). **Do not invent coordinates.** Areas (Kandi, Pothireddypally, …) are added by the admin using Google Places (below).
- Admin RPCs: `admin_upsert_geo(kind text, id uuid, parent_id uuid, name text, lat float8, lng float8, active bool)` with validation; audit.
- Flag `('area_picker', true, 'Area quick picks', 'Show admin-managed areas in the location picker.', 'App', 50)`.

### 5.2 App
- `app/src/lib/locationModel.ts`: delete `POPULAR_AREAS`; add `listAreas()` (select active areas with city name) in `supabaseApi.ts`.
- `app/app/location.tsx` and `app/src/features/providerOnboarding/AreaSection.tsx`: use `listAreas()`; hide the section if the flag is off or the list is empty.
- **New** `app/app/admin/geography.tsx`: tree list with active switches; "Add area" uses the existing `searchPlaces` + `resolvePlace` from `app/src/lib/locationContext.tsx` to fill name and coordinates.
- Keep `category_cities` and `resolve_service_city` unchanged (city launch gating already works).

**Done when:** admin adds "Kandi" via Places, it appears in the location picker, and turning it off hides it.

---

## Phase 6 — Sports phase 1 (booking requests, pay at venue)

**Goal:** customers find venues, see free slots and send booking requests; venue owners accept/decline. No online payment.

### 6.1 Migration `0048_sports.sql`
Flag: `('sports', false, 'Sports & venues', 'Venue discovery and booking requests.', 'Marketplace', 30)`.

| Table | Columns (all `id uuid pk default gen_random_uuid()`, `created_at timestamptz default now()`) |
|---|---|
| `sports_activities` | `slug text unique`, `name text`, `icon text`, `active boolean default true`, `sort_order int`. Seed: badminton, cricket-turf, football-turf, swimming, tennis, table-tennis, coaching, fitness. |
| `sports_venues` | `owner_id uuid → profiles`, `name`, `description`, `address_line`, `city`, `area`, `lat`, `lng`, `amenities text[]`, `status text check in ('draft','submitted','verified','rejected','suspended') default 'draft'`, `status_reason text`. |
| `sports_resources` | `venue_id → sports_venues on delete cascade`, `activity_id → sports_activities`, `name` ("Court 1"), `slot_minutes int check in (30,60,90,120) default 60`, `active boolean default true`. |
| `sports_hours` | `venue_id`, `weekday smallint 0–6`, `opens time`, `closes time`, pk `(venue_id, weekday)`. |
| `sports_price_rules` | `resource_id`, `weekday smallint null` (null = every day), `starts time`, `ends time`, `price_paise int > 0`, `label text` ('Peak'/'Off-peak'). |
| `sports_blocks` | `resource_id`, `starts_at timestamptz`, `ends_at timestamptz`, `reason text`. |
| `sports_bookings` | `customer_id`, `venue_id`, `resource_id`, `starts_at`, `ends_at`, `status text check in ('requested','accepted','declined','cancelled','completed','expired')`, `price_paise int` (snapshot), `note text`, `expires_at timestamptz`, `decided_at timestamptz`. Index `(resource_id, starts_at)`. |

RLS: venues/resources/hours/price rules/activities readable by everyone when `status='verified'`/`active`; owners full access to their own rows via RPCs only; `sports_bookings` readable by the customer and the venue owner.

RPCs (all check `_feature_enabled('sports')`):

| RPC | Rules |
|---|---|
| `save_sports_venue(...)`, `save_sports_resource(...)`, `set_sports_hours(...)`, `save_sports_price_rule(...)`, `add_sports_block(...)`, `submit_sports_venue(id)` | Owner only. Server validates times (`opens < closes`), price > 0. |
| `admin_set_venue_status(id, status, reason)` | Admin. Reason required unless `verified`. |
| `search_sports_venues(p_activity_slug, p_lat, p_lng, p_radius_km default 15)` | Verified venues with an active resource for the activity, ordered by distance (`extensions.st_distance`). Returns min price. |
| `get_sports_slots(p_resource_id, p_date date)` | Slots inside opening hours (IST) with state `free`/`taken`/`blocked`/`past`. Never returns customer data. |
| `request_sports_slot(p_resource_id, p_starts_at, p_slots int default 1, p_note text)` | Customer; not the owner; starts in future, ≤ 30 days; aligned to `slot_minutes`; inside hours. `perform pg_advisory_xact_lock(hashtext(p_resource_id::text));` then assert no `sports_bookings` with status `requested`/`accepted` overlapping and no overlapping block. Price = sum of the matching price rule per slot (fail if a slot has no rule). Insert `requested`, `expires_at = least(starts_at - interval '30 minutes', now() + interval '2 hours')`. Notify owner `sports_booking_requested`. |
| `decide_sports_booking(p_id, p_accept boolean, p_reason text)` | Owner; status `requested`; not expired. Notify customer `sports_booking_accepted`/`sports_booking_declined`. |
| `cancel_sports_booking(p_id)` | Customer before start, or owner with reason. |
| `expire_sports_requests()` | Cron every 5 min: `requested` past `expires_at` → `expired`; `accepted` past `ends_at` → `completed`. Schedule like `0023_proposal_milestone_booking.sql` lines 1530–1533 (`cron.schedule`). |

Add the 3 notification kinds (full constraint list).

### 6.2 App
- Customer: Home "Sports" shortcut (flag); `app/app/sports/index.tsx` (activities), `app/app/sports/[activity].tsx` (venues list), `app/app/venue/[id].tsx` (photos, amenities, date picker, slot grid, "Request booking", "Pay at venue" note).
- Owner: Me → "My venues" (flag) → create/edit venue, courts, hours, prices, blocks; requests inbox with Accept/Decline.
- Admin: People screen tab "Venues" (verify/reject/suspend). Services screen section "Sports activities" with switches.
- Notifications: add `/venue/` and `/sports-booking/` to the `SAFE_ROUTE` regex in `app/src/lib/unread.ts`.

### 6.3 Tests
Two customers requesting the same slot at the same time → exactly one succeeds. Blocked slot refused. Unverified venue not searchable. Expired request frees the slot. Flag off → all RPCs refused.

**Done when:** a demo venue owner accepts a request from Ravi and both see the status; E2E covers search → slot → request → accept.

---

## Phase 7a — Shops, catalogue, search, enquiries

Flags: `('products', false, 'Products & shops', 'Shop catalogues and product search.', 'Marketplace', 40)`, `('product_enquiries', false, 'Product enquiries', 'Customers message shops about products.', 'Marketplace', 41)`.

### Migration `0049_shops_catalogue.sql`

| Table | Key columns |
|---|---|
| `product_categories` | `slug unique`, `name`, `parent_id`, `icon`, `active`, `sort_order`, `attribute_schema jsonb` (e.g. tiles: size, finish, material). Seed: tiles, sanitaryware, electrical, plumbing, hardware, paints, construction, lighting, home-improvement, other. |
| `shops` | `owner_id → profiles unique` (one shop per owner for now), `name`, `description`, `address_line`, `city`, `area`, `lat`, `lng`, `delivery_radius_km int default 10`, `offers_delivery bool`, `offers_pickup bool`, `whatsapp_contact bool default false`, `gstin text null`, `status` (`draft`/`submitted`/`under_review`/`verified`/`rejected`/`suspended`), `status_reason`. |
| `shop_categories` | `(shop_id, category_id)` pk — what the shop sells (used for RFQ routing). |
| `products` | `shop_id`, `category_id`, `name`, `brand`, `model`, `description`, `specs jsonb` (validated against `attribute_schema` keys), `unit text check in ('piece','sqft','box','kg','litre','bag','metre','set')`, `indicative_price_paise int null`, `price_updated_at`, `in_stock bool`, `active bool`, `search tsvector generated always as (to_tsvector('simple', coalesce(name,'')||' '||coalesce(brand,'')||' '||coalesce(model,''))) stored`, gin index. |
| `product_images` | `product_id`, `path text` (Storage bucket `product-images`, folder = `shop_id`), `sort_order`. Max 6 per product. |
| `product_enquiries` | `shop_id`, `product_id null`, `customer_id`, `status open/closed`, `last_message_at`, `shop_unread int`, `customer_unread int`. |
| `product_enquiry_messages` | `enquiry_id`, `sender_id`, `from_shop bool`, `body 1–2000`. |

RPCs: `save_shop`, `submit_shop`, `admin_set_shop_status`, `save_product` (owner; price ≥ 0; max 500 products per shop), `delete_product`, `search_products(p_query, p_category_slug, p_lat, p_lng, p_radius_km default 15, p_max_price_paise, p_in_stock_only, p_limit default 30)` (verified shops, active products, `websearch_to_tsquery('simple', p_query)`, distance order), `get_shop(p_id)`, `start_product_enquiry(p_shop_id, p_product_id, p_body)`, `send_enquiry_message`, `mark_enquiry_read`. Notification kinds `product_enquiry`, `product_enquiry_reply`. Copy the support thread pattern from `0041` (`support_threads` / `_support_post`).

**Gotcha:** check that PGlite supports `tsvector` generated columns in the SQL tests. If not, use a trigger to fill `search`.

### App
- Customer: Home "Shop local" shortcut (flag); `app/app/shop/index.tsx` (categories, nearby shops, search), `app/app/products.tsx` (results + filters), `app/app/product/[id].tsx`, `app/app/shop/[id].tsx`, `app/app/enquiry/[id].tsx` (thread; reuse `SupportConversation` layout).
- Merchant: Me → "My shop" (flag): shop details (Places for address), categories, delivery options, submit for verification; catalogue list + product editor (photos via existing image picker pattern); enquiries inbox.
- Admin: People tab "Shops" (verify/reject/suspend); Services section "Product categories" switches; dashboard tiles (shops, products, open enquiries).
- Indicative prices are labelled **"Indicative price — confirm with shop"**.

---

## Phase 7b — Requests for quotation (RFQ) and comparison

Flag: `('product_rfq', false, 'Bulk quotations (RFQ)', 'Customers request quotes from several shops.', 'Marketplace', 42)`.

### Migration `0050_rfq.sql`

| Table | Key columns |
|---|---|
| `rfqs` | `customer_id`, `category_id`, `title`, `city`, `area`, `lat`, `lng`, `needs_delivery bool`, `needed_by date`, `notes`, `status open/closed/expired/cancelled`, `expires_at default now()+7 days`. |
| `rfq_items` | `rfq_id`, `seq`, `description`, `brand_pref`, `specs jsonb`, `quantity numeric > 0`, `unit`. 1–20 items. |
| `rfq_recipients` | `(rfq_id, shop_id)` pk, `routed_at`. |
| `supplier_quotes` | `rfq_id`, `shop_id`, `version`, `status sent/withdrawn/selected/rejected/expired`, `valid_until` (capped at `rfqs.expires_at`), `delivery_charge_paise`, `delivery_days`, `notes`, `subtotal_paise`, `gst_paise`, `total_paise` — **all totals computed on the server**. Unique `(rfq_id, shop_id) where status='sent'`. |
| `supplier_quote_items` | `quote_id`, `rfq_item_id`, `brand`, `model`, `specs jsonb`, `unit_price_paise`, `quantity`, `gst_rate_bp int check in (0,500,1200,1800,2800)`, `available bool`, `line_total_paise`. |

RPCs:
- `create_rfq(...)`: customer; routes to up to **10** verified shops that sell the category (`shop_categories`) and whose `delivery_radius_km` covers the point (copy `route_service_request` from `0035_request_coordinates.sql`). Notify shops `rfq_received`.
- `send_supplier_quote(p_rfq_id, p_items jsonb, p_delivery_charge_paise, p_delivery_days, p_valid_until, p_notes)`: recipient shop only; one quote line per RFQ item (unavailable allowed); recompute all totals; previous `sent` quote by the same shop → `withdrawn`. Notify customer `rfq_quote_received`.
- `compare_rfq_quotes(p_rfq_id)`: customer only. Returns per quote: totals, delivery, validity, count of unavailable items, and per-item flags `brand_differs` (quote brand ≠ requested brand, case-insensitive), `specs_missing`. **Never marks two items as equivalent.**
- `select_supplier_quote(p_quote_id)`: customer; marks it `selected`, others `rejected`, RFQ `closed`; opens a `product_enquiries` thread with that shop for next steps. **No payment.**
- `expire_rfqs()` cron.

### App
- `app/app/rfq/new.tsx` (category, items with quantity/unit/brand, delivery area via location, needed-by date), `app/app/rfq/[id].tsx` (quotes list + side-by-side comparison table; cheapest total highlighted; brand differences shown in amber; "Choose this supplier"), merchant RFQ inbox + quote composer.
- Admin dashboard: open RFQs, quotes per RFQ, average response time.

### Tests (7a + 7b)
Unverified shop not searchable; customer A cannot read customer B's RFQ; shop not routed cannot quote; client-sent totals ignored; GST computed per line; selecting a quote rejects others; flags off → refused.

---

## Phase 8 — AI additions

Flags: `('ai_product_search', false, 'AI product search', 'Natural-language product search.', 'AI', 20)`, `('ai_quote_extract', false, 'AI quote reading', 'Read uploaded supplier quotations.', 'AI', 30)`.

### 8.1 Usage and cost logging (migration `0051_ai_usage_v3.sql`)
- `alter table public.ai_usage` drop and recreate the `kind` check to add `'product_search'`, `'quote_extract'`, `'chat'`; add columns `feature text`, `model text`, `input_tokens int`, `output_tokens int`, `cost_micros_usd bigint`, `latency_ms int`, `ok boolean`.
- `app_config` key `ai_limits`: `{"product_search_per_day": 30, "quote_extract_per_day": 10, "monthly_budget_usd": 50}`. Server refuses with "Daily limit reached" when exceeded.
- Admin screen `app/app/admin/ai.tsx`: calls per feature per day, cost this month vs budget, error rate.

### 8.2 AI product search
- In `supabase/functions/ai-assistant/index.ts` add `mode: "product_search"` (reuse auth, CORS, feature gate pattern). Prompt the model to return **only** JSON `{category_slug, query, brand, max_price_paise, in_stock_only}` and validate it (unknown category → null). Then call `search_products` with those filters and return database rows. The model never writes product names, prices or availability.
- App: on `app/app/products.tsx`, an "Ask in your words" field (flag) that fills filters; user can edit them.

### 8.3 AI quote extraction (customer uploads an outside quotation photo)
- `mode: "quote_extract"`: image → JSON items `{description, brand, model, quantity, unit, unit_price_paise, gst_rate_bp, delivery_charge_paise, valid_until}`. Validate types and ranges.
- Customer **reviews and edits** the extracted lines, then saves them as an "outside quote" (`external_quotes` + `external_quote_items`, owned by the customer, linked to an RFQ) so it appears in `compare_rfq_quotes` marked "Uploaded by you".
- Label: "Read by AI — check every line before comparing."

### 8.4 Rules (from PRD §6)
Never send phone numbers/addresses to the model; strip them before sending. No AI action changes prices, payments, verification, coins or availability.

---

## Phase 9 — Unified "My Activity"

- `app/app/(customer)/bookings.tsx`: add a top segmented control: **Services** (existing), **Requests** (creator `service_requests`), **Shop** (enquiries + RFQs, flag `products`), **Sports** (`sports_bookings`, flag `sports`). Hide segments whose flag is off.
- Each segment keeps its own list and status labels. Do not merge status models.
- Tab badge = total unread across visible segments.

---

## Phase 10 — Merchant staff roles (later)

Flag `('merchant_staff', false, 'Staff accounts', 'Shops and providers can add staff.', 'Marketplace', 60)`.
- Table `business_members (owner_id, member_id, role check in ('owner','manager','staff'), active, invited_at)`.
- Helper `_acts_for(p_owner uuid, p_min_role text) returns boolean`.
- Phase 1 scope only: staff can view jobs/enquiries/RFQs and chat; managers can also send quotes/proposals; only owners change payouts, prices, verification data.
- Requires touching every provider RPC that checks `provider_id = v_uid`; list them with `grep -n "provider_id = v_uid" supabase/migrations/*.sql` and update one RPC per commit with a test each.

---

## 5. Risks / decisions needed

| # | Item | Needed from owner |
|---|---|---|
| R1 | Coin numbers (1% earn, ₹20 cap, ₹10 first bonus, ₹10,000 budget) are PRD proposals | Confirm before switching `coins_earning` on in production. Tax/legal advice on rewards (PRD §8). |
| R2 | Commission founding period (seeded 30 days; PRD says 60–90) and category rates (PRD 5%) | Set in admin after Phase 1. |
| R3 | Telugu translations need a native reviewer | Name a reviewer before enabling `telugu_language`. |
| R4 | Products/sports need real merchants to be useful | Founding merchant programme (PRD §7.1): 20–30 merchants. |
| R5 | GST/TCS for marketplace transactions | Professional advice before any online product payment (deferred). |
| R6 | Live payments | Razorpay live keys + Route activation (founder task). |

---

## 6. Per-phase checklist (copy into each PR description)

- [ ] Migration added and registered in all 3 places (2.2)
- [ ] New flag inserted with `enabled = false` (except where this plan says `true`)
- [ ] Every new RPC checks the flag, the caller's ownership/role, and validates inputs
- [ ] Amounts computed on the server in paise
- [ ] SQL tests: works / flag off / other user refused / admin-only refused
- [ ] App hides entry points when the flag is off
- [ ] Admin can switch it off in **Admin → Features**
- [ ] Notification kinds and `SAFE_ROUTE` updated if new notifications
- [ ] `git checkout -- app/tsconfig.json` before commit
- [ ] Deploy backend ✅, Publish app ✅, E2E ✅ (0 failed steps)

---

## References

- PRD v2 (Google Doc): https://docs.google.com/document/d/10gUvzJCPRGi7Kxq96171T2mShvsIG82JM9PXW-ZFTZQ
- Existing plans: `docs/01-PRD.md`, `docs/03-Pricing-Payments-Commission.md`, `docs/07-Multi-Category-Expansion-Plan.md`, `docs/09-Smart-Matching-Creators-OnPlatform-Strategy.md`
- Closed-system reward points in India (law-firm commentary): https://www.lexstartpartners.com/post/are-reward-points-legal-in-india
