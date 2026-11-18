# QuickServe — Home Services Expansion, Recurring Bookings & Sports Online Payments: Implementation Plan

| | |
|---|---|
| **Scope** | PRD addendum (2026-11-18): (1) expanded Home Services catalogue, (2) one-time + recurring bookings, (3) provider recurring management, (4) home-service pricing & payments, (5) sports in-app payments, (6) schema, (7) customer UX, (8) merchant UX, (9) admin controls |
| **Code baseline** | `sushruth5454/quickserve` `main` after Phase 9 (latest migration `0053_activity_contracts.sql`) |
| **Audience** | The coding model that implements this. Every step is written to be followed literally. **Read §0 and §2 before touching code.** |
| **Rule zero** | These are **additions**. Do not remove, rename or rewrite existing features, tables, statuses or screens. Preserve the four-family marketplace (Home services, Creators & events, Sports, Shops). |

---

## ⚡ PARALLEL EXECUTION — MANDATORY INSTRUCTIONS FOR THE IMPLEMENTING MODEL

> **You MUST run this plan with as many parallel background agents as possible.**
> 1. Read the **Task board** below. A task is **READY** when every task in its *Blocked by* column is **merged to `main` with green CI**.
> 2. In **ONE response**, launch **one background agent per READY task** (`task` tool, `agent_type: "general-purpose"`, `timeout: 0`, prompt = §0.3 template with the task ID). **Never** implement a READY task yourself while other READY tasks wait. **Never** launch READY tasks one per response.
> 3. Do **not** wait for a whole wave to finish. The moment a task merges green, re-read the board and launch every task that just became READY — in one response.
> 4. While agents run, you (the integrator) only: create worktrees, review finished diffs, merge in the order of the *Merge order* column, do integrator-owned edits (§0.5), watch CI, and send fixes back to the same agent with `write_agent`.
> 5. Before launching, print the current board as a table (Task · Status · Agent ID) so the owner can see what is running in parallel. Update it after every merge.
> 6. **BDD → DDD → TDD per feature:** before changing runtime code, the named artifact owner adds the feature's BDD scenarios and DDD ownership mapping, then the implementation task writes/updates failing tests, then implements. Do not start implementation first and promise artifacts later. Artifact ownership is defined in §0.7.
> 7. Target concurrency: **Wave 1 = 10 agents, Wave 2 = 8 agents, Wave 3 = 5 agents.** If fewer are running, you are not following this plan.

### Task board (unit of parallel work = one task = one agent = one worktree/branch)

Legend: **Mig** = migration number the task owns (only one task per number). **Parallel with** = tasks that run at the same time without conflict. **Merge order** = order the integrator merges into `main` (migrations must merge in numeric order; UI/test-only tasks merge any time after their blockers).

| ID | Task (section) | Mig | Blocked by | Parallel with | Merge order |
|---|---|---|---|---|---|
| **W0** | Foundations: flags, notification kinds, rules config, overlap helper, cron check (§3) — **integrator does this itself, no agent** | 0054 | Phase 9 green | — | 1 |
| **A1** | Catalogue migration: new columns, re-parent existing slugs, seed new categories, admin category RPCs + SQL test (§4.2, §4.4) | 0055 | W0 | B1, E1, A2, H1, C1a, C1b, F1a, F1b, T0 | 2 |
| **A2** | Admin category editor UI: `admin/services.tsx` + `admin/category/[id].tsx` + reorder (§4.3 first bullet) | — | W0 (codes against §4.2.4 RPC names) | all Wave 1 | after A1 |
| **A3** | Customer catalogue groups + icons: `catalogue/model.ts`, `CatalogueSections.tsx`, `CategoryIcon.tsx`, Jest (§4.3 bullets 2–3) | — | A1 merged | B2, E2, C1*, F1*, H1, D*, G* | any after A1 |
| **B1** | Recurring engine migration: schema changes, `recurring_occurrence_changes`, `_recurrence_dates`, all §5.4 RPCs, generator + cron, holiday rules, SQL test (§5) | 0056 | W0 | A1, E1, A2, H1, C1a, C1b, F1a, F1b, T0 | 3 |
| **E1** | Sports payments migration: schema, `book_sports_slot`, capacity, holds, `prepare/record_sports_payment`, expiry, cancel/refund, `_create_sports_payout`, payout generalisation, SQL test (§6.2–§6.4 SQL parts) | 0057 | W0 | A1, B1, A2, H1, C1a, C1b, F1a, F1b, T0 | 4 |
| **E2** | Payment edge functions for sports: `create-payment` `kind:'sports'`, verify/webhook routing, `provider-payout-account` venue owners, `release-payouts` payee, `demo_settle_payment` note, Deno tests (§6.2 last bullet, §6.3 edge bullet) | — | E1 merged | A3, B2, C2, F2, G*, D1 (D1 must **not** touch edge functions until E2 merged) | 5 |
| **H1** | Admin rules screen `admin/rules.tsx` + `adminRulesApi.ts` + Jest conversions (§7) | — | W0 | all Wave 1 | any after W0 |
| **C1a** | Recurring pure-TS: `features/recurring/types.ts`, `dates.ts`, Jest with §5.7 vectors, typed `api.ts` per §5.4 names (§9 C1) | — | W0 | all Wave 1 | any after W0 |
| **C1b** | Customer recurring screens: wizard `recurring/new/[providerServiceId].tsx`, plan detail `recurring/[id].tsx`, One-time/Repeat toggle in book screens, "Repeat plans" filter in My Activity (§9 C1) — imports C1a types; if C1a not merged yet, create the same file paths with identical content from §5.6 and let the integrator dedupe | — | W0 | all Wave 1 | after C1a |
| **F1a** | Sports customer booking UI: venue duration/participants/payment choice, `sports-checkout/[id].tsx`, booking list/detail statuses (§8 F1 items 1–3) | — | W0 (codes against §6.5) | all Wave 1 | any after W0 |
| **F1b** | Venue settings UI in `sports/manage.tsx` (booking mode, capacity, payment modes, payout status) + `sports/index.tsx` copy (§8 F1 item 4) | — | W0 | all Wave 1 (F1a edits different files) | any after W0 |
| **T0** | E2E scaffolding: new step functions in `e2e/all-services.mjs` for catalogue groups, recurring wizard, sports checkout (behind `optional` until their features merge); validate each lane's BDD/DDD files exist (§12 items 1–2) | — | W0 | all Wave 1 | any |
| **B2** | Recurring hardening pass: review B1 against §5.8, add missing tests, fix CI failures reported by integrator (only if B1 report lists gaps) | 0056 fixes only | B1 merged | A3, E2, D1, G1, G2, C2, F2 | after B1 |
| **D1** | Recurring billing migration: `recurring_billing_cycles`, payment parent check, cycle RPCs, credits/refunds, `process_recurring_billing` cron, occurrence payouts, SQL test (§10 items 1–5, 7) | 0058 | B1 merged **and** E1 merged | A3, E2, G1, G2, C2, F2, T1 | 6 |
| **D2** | Recurring billing edge functions: `create-payment` `kind:'recurring_cycle'`, verify/webhook routing, Deno tests (§10 item 6) | — | D1 merged **and** E2 merged | G*, C2, F2, T1 | 7 |
| **G1** | Provider recurring UX: `merchant-calendar.tsx`, repeat-requests section in dashboard, `recurring/provider/[id].tsx`, holiday banner (§11 items 1–4, 6) | — | B1 merged | A3, E2, D1, D2, G2, C2, F2, T1 | any after B1 |
| **G2** | Venue calendar + merchant earnings rows (recurring + sports `payee_id`) in `sports/manage.tsx` tabs and `earnings.tsx` (§11 items 1, 5) | — | E1 merged **and** F1b merged | A3, B2, D*, G1, C2, F2, T1 | any after blockers |
| **C2** | Wire customer recurring UI to real B1/D1 RPCs, billing-cycle display, fix type drift (§9 C2) | — | B1 merged (billing parts wait for D1) | A3, E2, D*, G*, F2, T1 | any after blockers |
| **F2** | Wire sports UI to real E1/E2, cancellation preview, fix type drift (§8 F2) | — | E1 and E2 merged | A3, B2, D*, G*, C2, T1 | any after blockers |
| **T1** | Turn T0 `optional` steps into required E2E steps once their feature is merged; enable new flags/demo categories in E2E DEMO reset (integrator applies workflow edit) (§12 item 1) | — | each feature it covers | everything in Wave 2 | last-but-one |
| **T2** | Traceability artifacts with real CI run IDs, status tables in this doc and `01-PRD.md`, owner production checklist (§12 items 2–4) | — | all tasks merged green | — | last |

**Max parallel snapshot (what should be running at once):**
- **After W0 merges → launch 10 agents in one response:** A1, A2, B1, E1, H1, C1a, C1b, F1a, F1b, T0.
- **As soon as A1 merges → launch A3.** As soon as B1 merges → launch B2 (if needed), G1, C2. As soon as E1 merges → launch E2 (and G2 once F1b is in). As soon as B1 + E1 merge → launch D1. As soon as D1 + E2 merge → launch D2. Keep T1 running alongside Wave 2.
- **Only these are strictly sequential:** W0 → {A1, B1, E1} (migrations merge in order 0055 → 0056 → 0057) → D1 (0058) → D2; and E1 → E2 (shared payment edge functions). Everything else is parallel.

### File-conflict rules that make this parallelism safe
| Shared file | Owner (only this task may edit it) |
|---|---|
| `supabase/tests/package.json`, `.github/workflows/deploy-backend.yml`, `.github/workflows/e2e-web.yml`, `supabase/tests/review_fixes.test.mjs`, `app/src/lib/unread.ts` | Integrator only |
| `supabase/functions/create-payment`, `verify-payment`, `razorpay-webhook` | E2 first, then D2 (never concurrently) |
| `app/src/lib/adminApi.ts` | A2 only (H1 uses new `adminRulesApi.ts`) |
| `app/app/sports/manage.tsx` | F1b (settings section) → then G2 (calendar/earnings tabs; rebase on F1b) |
| `app/app/book/[providerServiceId].tsx`, `book-fixed/[providerServiceId].tsx` | C1b only |
| `app/app/(provider)/dashboard.tsx` | G1 only |
| `app/src/features/activity/UnifiedActivityScreen.tsx` | C1b only |
| `e2e/all-services.mjs` | T0 → T1 (feature tasks put their E2E steps in their final report; T0/T1 paste them) |

---

## 🔀 FEATURE SWITCHES — MANDATORY (project rule: every feature is configurable and can be enabled/disabled)

> **Project rule:** every feature and sub-feature in this plan must be (1) **switchable on/off by an admin at runtime** via `feature_flags` (no app update), (2) **configurable** via admin-editable `app_config` rules or per-category/per-venue settings, (3) **enforced on the server** (RPC refuses when off), and (4) **hidden in the app** when off. A task is **not done** until its switches exist, are enforced, are hidden in the UI and have flag-off tests.

### Switch matrix (W0 creates all of these, disabled by default unless stated)

| Flag key | Parent (child is effective only if parent is ON) | Controls | Server enforcement (owner task) | UI hidden when OFF (owner task) | Default |
|---|---|---|---|---|---|
| `home_services_catalogue_v2` | — | Grouped Home-services view + new categories visible to customers | catalogue read RPC returns only legacy categories (A1) | groups collapse to legacy flat list (A3) | off |
| `admin_category_editor` | — | Admin create/edit/reorder categories | `admin_upsert_category`, `admin_reorder_categories` refuse (A1) | "New service"/"Edit"/reorder hidden (A2) | **on** (admin-only tool) |
| `recurring_bookings` | — | Master switch for repeat plans | `quote/create_recurring_plan`, `respond_recurring_plan` refuse; generator skips (B1) | One-time/Repeat toggle, "Repeat plans" filter hidden (C1b) | off |
| `recurring_skip_pause` | `recurring_bookings` | Customer skip visit, pause/resume | `skip_recurring_visit`, `pause/resume_recurring_plan` refuse (B1) | Skip/Pause/Resume buttons hidden (C1b) | off |
| `recurring_reschedule` | `recurring_bookings` | Reschedule requests (both sides) | `request/respond_visit_reschedule` refuse (B1) | Reschedule actions hidden (C1b, G1) | off |
| `recurring_plan_acceptance` | `recurring_bookings` | Provider accepts whole plan (`acceptance_mode='plan'`); when OFF all plans use per-visit acceptance | `create_recurring_plan` forces `acceptance_mode='occurrence'` (B1) | "Accept plan" hidden, per-visit accept shown (G1) | off |
| `recurring_reminders` | `recurring_bookings` | Upcoming-visit reminders | `queue_recurring_reminders` returns 0 (B1) | — | off |
| `recurring_billing` | `recurring_bookings` | Weekly/monthly billing cycles | cycle RPCs refuse; `create_recurring_plan` allows only `per_visit` (D1) | weekly/monthly payment options hidden (C1b/C2) | off |
| `recurring_prepaid_packages` | `recurring_bookings` | Prepaid package plans | `create_recurring_plan` refuses `prepaid_package` (B1/D1) | prepaid option hidden (C1b) | off |
| `sports_online_payments` | `sports` (existing) | Master switch for paying sports bookings in-app | `book_sports_slot` refuses `online`; `prepare_sports_payment` refuses (E1) | "Pay online", checkout screen hidden; sports copy says pay at venue (F1a/F1b) | off |
| `sports_instant_booking` | `sports` | Instant-confirm resources (`booking_mode='instant'`) | when OFF every booking follows approval flow (E1) | instant badge/"Book" hidden → "Send request" (F1a); booking-mode setting hidden (F1b) | off |
| `sports_capacity_slots` | `sports` | Capacity > 1 resources (coaching, classes, pools) | capacity treated as 1, participants forced to 1 (E1) | participants picker + capacity setting hidden (F1a/F1b) | off |
| `sports_multi_slot` | `sports` | Booking more than one consecutive slot | `book_sports_slot` refuses `p_slots > 1` (E1) | duration picker hidden (F1a) | off |
| `merchant_calendar` | — | Provider/venue calendar screen | list RPCs still work (they are reads); flag gates the screen | calendar entry points hidden (G1/G2) | off |
| `admin_rules_editor` | — | Admin rules screen | `admin_set_rules` refuses (W0) | admin "Rules" row hidden (H1) | **on** (admin-only tool) |

Existing flags reused unchanged: `sports` (master for all sports), `merchant_staff`, archetype flags in `app_config.archetype_flags` (`time_based` and `fixed` must be ON for recurring plans of that archetype).

### Configuration (not on/off, but admin-editable without an app update)
| Setting | Where | Owner |
|---|---|---|
| Allowed recurrence frequencies (global), horizon, max plan length, skip/reschedule cut-offs, reminder hours, payment-due hours, allowed payment frequencies, default recurring discount | `app_config.recurring_rules` via `admin_set_rules` | W0 + H1 |
| Per-category: recurrence allowed, allowed frequencies, recurring discount, archetype, pricing units, cancellation policy, required verification docs, active, city availability, order, parent group | `categories` via `admin_upsert_category` / existing `admin_set_category_active`, `admin_set_category_city` | A1 + A2 |
| Sports: hold minutes, approval pay window, commission, customer fee, refund windows and %, payout release hours | `app_config.sports_rules` via `admin_set_rules` | W0 + H1 |
| Per-venue/resource: payment modes, booking mode, capacity, cancellation rules | `sports_venues` / `sports_resources` via venue owner RPCs (E1) + admin override | E1 + F1b |
| Commission tiers / category overrides | existing `admin/commission.tsx` | existing |
| Geography | existing `admin/geography.tsx` | existing |

### Implementation rules for switches
1. **Helper per area** (W0): `_recurring_feature(p_key text) returns boolean` = `_feature_enabled('recurring_bookings') and _feature_enabled(p_key)`; `_sports_feature(p_key text)` = `_feature_enabled('sports') and _feature_enabled(p_key)`. Same pattern as `_shops_enquiries_enabled` (`0049`). Use these in every RPC; never check a child flag alone.
2. **App helper** (W0, integrator): `useFeature(key)` in `app/src/lib/featureFlags.ts` that applies the same parent rule client-side (parent map hard-coded to the table above). UI tasks use only this helper.
3. **Switch-off behaviour (safety — never strand money or customers):**
   - Turning a flag OFF blocks **new** actions only. Existing plans, bookings and payments stay readable.
   - **Never gate money-safety jobs**: payment recording (webhook/verify), refunds, payout release, booking/hold **expiry**, and customer **cancel** of an existing booking/plan always run regardless of flags (otherwise money or slots get stuck).
   - `recurring_bookings` OFF: generator creates no new occurrences; already-created occurrences proceed normally; plans show "Paused by QuickServe" banner (computed, status not changed).
   - `recurring_billing` OFF: no new cycles; existing `due` cycles can still be paid until `due_at + grace`, then follow the normal failed-cycle path.
   - `sports_online_payments` OFF: existing `pending_payment`/`awaiting_payment` bookings can still be paid until their hold/pay-by expires; new bookings are pay-at-venue only (if the venue allows) else refused with a clear message.
4. **Admin UI:** the existing `admin/features.tsx` lists all flags from the registry grouped by `group_name` — put these flags in groups `Home services`, `Recurring`, `Sports payments`, `Admin tools`, with `description` text that explains what users see when OFF. Show child flags indented/greyed when the parent is OFF (A2 or H1 may extend `admin/features.tsx`; **owner: H1**).
5. **Tests (every task):** for each flag it enforces — ON works; OFF refuses new action with the "turned off" message; parent OFF + child ON still refuses; switch-off mid-flight keeps money-safety paths working (pay/refund/expire/cancel). UI: Jest test that `useFeature` hides the entry point.
6. **Done-when addition for every task:** "All switches in the matrix that this task owns exist, are enforced server-side, are hidden in the app, and have the tests in rule 5."

---

## 0. How to execute this plan (orchestration — READ FIRST)

### 0.1 You MUST use parallel background agents

This plan is split into **lanes**. Lanes in the same **wave** are independent and **must run in parallel as background agents** (`task` tool, `agent_type: "general-purpose"`, `timeout: 0`). Launch every lane of a wave in **one** response. Do not implement lanes yourself one by one. You (the parent) are the **integrator**: you own shared files, merging, CI watching and fixing integration failures.

Launch as many parallel agents as the wave allows. While they run, do the integrator work for that wave (§0.4). Never poll agents in a loop — wait for the completion notification.

### 0.2 Each lane works in its own git worktree

The main checkout `C:\Users\snizampuram\source\quickserve-main-verify` is shared. Two agents editing it at once will corrupt each other's staging. **Before launching a wave**, create one worktree per lane:

```powershell
$root = 'C:\Users\snizampuram\source\quickserve-main-verify'
git -C $root fetch origin
git -C $root worktree add "C:\Users\snizampuram\source\qs-lane-<X>" -b lane/<X> origin/main
```

Give each agent its worktree path in its prompt. Agents commit to `lane/<X>` and **do not push to `main`**. They may `git push origin lane/<X>` for backup. CI (deploy, EAS, E2E) runs **only on `main`**, so lanes cannot self-validate in CI — the integrator merges lanes into `main` one at a time and watches CI (§0.4).

### 0.3 Lane agent prompt template (copy, fill the `<…>` parts)

```
You are implementing Task <ID> (Task board, top of docs/12-Home-Services-Recurring-Sports-Payments-Implementation-Plan.md)
in the QuickServe repo. Other agents are implementing other tasks IN PARALLEL in their own worktrees.
Work ONLY in the git worktree <path> on branch lane/<ID>. Edit ONLY the files your task owns; the
"File-conflict rules" table at the top of the doc lists files you must never touch.
1. Read the Task board, docs/12-...md sections 0, 1, 2 and your task's section <§N> completely before editing.
2. Read docs/11-PRD-v2-Implementation-Plan.md §2 (rules, templates, gotchas).
3. If you are the named BDD/DDD artifact owner in §0.7: create and commit those BDD/DDD files first,
   report the artifact commit to the parent, and wait until the parent confirms it is on main before
   writing tests or runtime code. If you are not the artifact owner and the artifacts are not on main,
   only inspect source and prepare a written contract; do not edit runtime files yet.
4. After the artifact gate, implement exactly your task's owned files. Do NOT edit any file in the "Integrator-owned files"
   table (§0.5). If you need a change there, write it in your final report under "Integrator requests".
5. Your migration number is <NNNN or "none">. Do not create any other migration file.
   If your task is UI-only and its backend is not merged yet, code against the documented contract
   (§5.6 / §6.5) through a typed API module only; never invent RPC names.
6. Never run npm/npx install, deno remote imports, pip, local builds or local tests on this machine.
   All validation runs in GitHub Actions after the integrator merges your branch.
7. Before every commit: git checkout -- app/tsconfig.json (if it changed). Commit with trailers:
   Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
7. Finish with a report: commits, files changed, RPC signatures added (exact), notification kinds used,
   tests added, "Integrator requests", and every assumption you made. Do not claim anything was tested.
```

### 0.4 Integrator loop (parent, per wave)

1. Create worktrees, launch all lanes of the wave in parallel (one response, multiple `task` calls).
2. While they run: prepare the integrator-owned registration edits for that wave (§0.5) on a scratch branch.
3. When a lane finishes: review its diff (`git -C <root> diff origin/main...lane/<X>`), check it against its "Done when" list and the "Contract" it must expose. Reject/return work that touches files it does not own.
4. Merge lanes into `main` **in migration-number order** (lowest first). For each lane:
   `git -C <root> checkout integrate/full-booking; git -C <root> merge --no-ff lane/<X>`, then add the integrator registration edits for that migration (§2.2), commit, `git push origin HEAD:main`.
5. Watch CI for that push (§2.1 step 6). Fix failures yourself or `write_agent` the same lane agent with the exact failing log lines. **Do not merge the next lane until the current one is green** (migrations are applied in list order by `deploy-backend.yml`).
6. Remove worktrees after merge: `git -C <root> worktree remove C:\Users\snizampuram\source\qs-lane-<X>`.

### 0.5 Integrator-owned files (lanes must NOT edit these)

| File | Why |
|---|---|
| `supabase/tests/package.json` | Every migration adds a line; parallel edits always conflict. |
| `.github/workflows/deploy-backend.yml` | Migration list order = deploy order. |
| `supabase/tests/review_fixes.test.mjs` (full-chain migration array) | Same. |
| `docs/11-PRD-v2-Implementation-Plan.md`, `docs/12-…md` status lines | Single source of status. |
| `app/src/lib/unread.ts` `SAFE_ROUTE` / `notificationRoute` | Shared by all notification kinds. Wave 0 adds all routes up front. |
| `supabase/functions/create-payment/index.ts`, `verify-payment`, `razorpay-webhook` | Shared payment entry points. **Exception:** Lane E owns them in Wave 1, Lane D owns them in Wave 2 (sequential, never at the same time). |

### 0.6 Wave plan and what runs in parallel

> The **Task board** at the top of this document is the authoritative, finer-grained version of this table. Lanes below are groups of tasks (Lane A = A1–A3, B = B1–B2, C = C1a/C1b/C2, D = D1–D2, E = E1–E2, F = F1a/F1b/F2, G = G1–G2, H = H1, T = T0–T2). Schedule by **task**, not by lane.

| Wave | Lanes (run **in parallel**) | Migration numbers | Depends on |
|---|---|---|---|
| **0** (integrator only, small, sequential) | W0 Foundations | `0054_addendum_foundations.sql` | Phase 9 green |
| **1** | **A** Catalogue + admin category editor · **B** Recurring engine (backend) · **E** Sports payments (backend + payment entry points) · **H** Admin rule controls (UI) · **C1** Recurring pure-TS module + customer recurring UI against the §5.6 contract · **F1** Sports customer/venue UI against the §8.6 contract | A=`0055`, B=`0056`, E=`0057`, H=none, C1=none, F1=none | W0 |
| **2** | **D** Recurring billing & payments · **G** Merchant portal (provider recurring calendar, sports venue calendar/earnings) · **C2** wire customer recurring UI to merged B/D RPCs · **F2** wire sports UI to merged E RPCs | D=`0058` | B (for D, G, C2), E (for F2) |
| **3** (integrator + 1 agent) | **T** End-to-end tests, BDD/DDD/traceability artifacts, PRD status update | none | all |

### 0.7 BDD/DDD/TDD ownership (do not duplicate or race on artifact files)

The W0 foundation BDD/DDD/traceability packet is already authored at the three files linked in §3. Every lane must read its feature BDD/DDD before implementation. These are the only artifact writers:

| Feature | BDD/DDD owner (writes before implementation) | TDD owner | Traceability owner |
|---|---|---|---|
| Expanded Home Services catalogue/admin categories | A1 writes `home-services-catalogue-{bdd,ddd}.md` before migration 0055 code; A2/A3 add test references to their final reports, not the artifact files | A1 SQL + A2/A3 Jest/E2E | T2 |
| Recurring plan lifecycle, provider schedule, skip/reschedule/absence | B1 writes `recurring-plans-{bdd,ddd}.md` before migration 0056 code; C/G do not edit those files | B1 SQL + C1 Jest + G1 UI/E2E | T2 |
| Recurring cycle billing/refunds | D1 writes `recurring-billing-{bdd,ddd}.md` before migration 0058 code | D1 SQL/Deno + C2 Jest/E2E | T2 |
| Sports online payments/settlement | E1 writes `sports-payments-{bdd,ddd}.md` before migration 0057 code; E2/F/G do not edit those files | E1 SQL + E2 Deno + F/G app/E2E | T2 |
| Admin rules screen | H1 extends the W0 foundations BDD/DDD scenarios with UI scenarios before UI code; do not make a duplicate admin-rules artifact | H1 Jest | T2 |
| Cross-feature | T0/T2 never invent or replace BDD/DDD; they only verify links and consolidate scenario/test/source mappings | T1/T2 E2E/traceability | T2 |

**If the named artifact owner is still writing:** dependent implementation tasks may prepare a worktree or inspect source, but must not change runtime code until the BDD and DDD files are committed in the owner branch. Merge the artifacts before merging implementation. Tests must map to BDD scenario IDs; every behavior needs a DDD context/aggregate, test reference and implementation file in the final traceability table.

Merge order inside Wave 1: `0055` (A) → `0056` (B) → `0057` (E) → UI-only lanes (H, C1, F1) in any order. Wave 2: `0058` (D) → G → C2 → F2.

Lanes C1/F1/H are UI-only and compile against the **contracts** in §5.6 and §8.6. They must call RPCs only through a typed API module, so wiring changes in Wave 2 are confined to that module.

---

## 1. Decisions made for this plan (owner may override — recorded per autopilot instruction)

| # | Decision | Reason |
|---|---|---|
| R1 | **Recurring bookings are built on the existing `recurring_schedules` + `time_based` session engine** (`0022_time_based_booking.sql:348-390`, materializer `:1263-1339`), generalised. No second recurring system. | Reuses one-booking-row-per-occurrence, unique `(recurring_schedule_id, scheduled_at)` index and the provider overlap trigger (`0021:556-597`). |
| R2 | Recurrence is allowed for archetypes **`time_based`** and **`fixed`** only. `inspect_quote`/`proposal` stay one-time (quotation is per job). AC "every 6 months" = a `fixed` AC-service package with `monthly`, `interval_count=6`. | Quotation-per-visit cannot be prepaid or auto-scheduled safely. |
| R3 | **Do not add `booking_status` enum values.** Occurrences use existing statuses. Skips/absences/reschedules are recorded in a new table, not new statuses. | Enum additions break the state machine (doc 11 D4) and need separate migrations. |
| R4 | A provider-unavailable date (holiday mode `providers.paused`, `provider_time_off`) produces **no booking row**; a `recurring_occurrence_changes` row with `kind='provider_unavailable'` is written and the customer notified. | Customers must not be charged for undeliverable visits. |
| R5 | Sports keeps its own tables (`0048_sports.sql`). Sports payments reuse **`payments`, `refunds`, `payouts`, `payout_transfers`** by adding a nullable `sports_booking_id` FK. No parallel payments system. | One reconciliation surface; existing webhook/refund/payout jobs keep working. |
| R6 | Sports "confirmed" stays status **`accepted`** (existing UI/unread counts use it). New sports statuses: `pending_payment` (instant booking, slot held) and `awaiting_payment` (approved, customer must pay). `sports_bookings.status` is a text check constraint, so it can be extended. | Preserves Phase 6/9 behaviour. |
| R7 | Sports overlap protection = per-resource advisory lock + capacity count (existing pattern `0048:721-825`). **No exclusion constraints** (PGlite tests rewrite `gist`→`btree`, doc 11 §2.2). | Test harness compatibility; same guarantee under the lock. |
| R8 | Sensitive categories (babysitting, elderly assistance) are seeded **inactive** with `restricted=true` and required documents (police verification). Admin activates per city only after verification. | Safety requirement. |
| R9 | **Every feature and sub-feature is behind its own admin switch** (see "Feature switches" matrix at the top), disabled by default except admin-only tools; children require their parent ON; money-safety jobs are never gated. Catalogue rows ship `active=false` until admin enables. | Project rule: everything configurable and enable/disable-able (doc 11 D3). |
| R10 | Business numbers (sports commission, recurring discount, hold minutes, skip cutoff) are **admin config in `app_config`**, seeded with conservative defaults (§3.3). The owner must confirm them before enabling flags in production. | No hardcoded commissions. |

---

## 2. Rules for every lane

### 2.1 Workflow
Identical to `docs/11-PRD-v2-Implementation-Plan.md` §2.1, with these additions:
- `gh workflow run` returns **HTTP 403** for this account. E2E runs only on pushes to `main` that touch `app/**`, `supabase/migrations/**`, `e2e/**`. To re-run E2E, push a real fix; never push empty commits.
- Edge-function/migration pushes trigger **Deploy backend (Supabase)**; it runs Deno tests, SQL tests (PGlite), then applies migrations via the Management API, then deploys functions.
- An E2E run that starts **before** the same push's migration is applied can fail on new RPCs (seen in run `44261082696`). If the only failures are "function does not exist"/timeouts on new screens and the backend run then succeeds, push the next real change and re-check.

### 2.2 New migration checklist
Use doc 11 §2.2 exactly (integrator does steps 2–4). Additional gotchas found in this codebase:
- **Notification kinds:** do **not** retype the full list. Use the dynamic append pattern from `0050_rfq.sql:707-727` (reads current `notifications_kind_check`, re-adds it `or kind in (...)`). Wave 0 adds **all** kinds for this plan at once.
- **Cron:** schedule only when `cron` exists, unschedule first (pattern `0048_sports.sql:1037-1046`). Whether `pg_cron` is enabled on the live project is **unverified**; Wave 0 adds a deploy-step verification (§3.4).
- **Overlap on UPDATE:** `_reserve_booking_service_window` is a **BEFORE INSERT** trigger only (`0021:594-597`). Any RPC that moves `service_window`/`scheduled_at` (reschedule) must call the shared check `_assert_provider_window_free` added in Wave 0.
- **Latest function definitions:** many functions are redefined in later migrations. Before calling or replacing a function, find its **latest** definition: `rg -n "function public.<name>\(" supabase/migrations` and read the highest-numbered file.
- **PGlite stubs:** only `st_makepoint, st_setsrid, st_distance, st_dwithin, st_x, st_y`. No `pg_cron`, no `pg_net`; guard with `to_regnamespace`.
- Money: integer **paise** (`int`/`bigint`), never decimals. Percentages: basis points (`_bp`).

### 2.3 RPC, admin and feature-gate templates
Use doc 11 §2.3–§2.4 verbatim. Every customer/merchant RPC: `_require_uid()`, `_feature_enabled('<flag>')` assert, ownership assert, server-computed amounts, `revoke … from public, anon; grant … to authenticated`. Every admin RPC: `_is_admin()` assert + `admin_audit_log` insert. Service-role jobs: `revoke all … from public, anon, authenticated; grant … to service_role`.

### 2.4 Tests per lane (all run in CI only)
- SQL: one isolated test file per lane in `supabase/tests/<lane>.test.mjs` that loads the **full real chain** (copy prelude + loader from `review_fixes.test.mjs:1-80`) and adds its migration last. Minimum cases are listed in each lane's "Tests" list.
- Pure TS logic: Jest tests under `app/src/features/<feature>/__tests__/`.
- UI flows: steps in `e2e/all-services.mjs` (Lane T consolidates).
- Every flagged RPC: (a) works with flag on, (b) refused with flag off, (c) other user refused, (d) admin RPC refused for normal user, (e) parent flag off + child on still refused, (f) money-safety paths (pay, refund, expire, cancel existing) still work with the flag off. See "Feature switches" rule 5.

### 2.5 UI rules (customer simplicity)
- Every new screen has **loading (Skeleton), error (ErrorState with retry), empty (EmptyState), success (toast)** states — copy existing patterns from `app/src/features/activity/UnifiedActivityScreen.tsx`.
- Max one primary action per screen. Plain words ("Every day", "Mon–Sat at 8:00 AM"). Show money with `formatINR` from `app/src/lib/money.ts`. Never compute a payable amount in the app; display the server quote.
- Back navigation: use `router.back()` only when `router.canGoBack()`, else `router.replace(<parent>)` (known bug class in this app: stacked "Me" screens).
- Hide entry points when the flag is off (`useAppFeatureFlags().isOn(...)`).

---

## 3. Wave 0 — Foundations (integrator, migration `0054_addendum_foundations.sql`)

Small, sequential, merged **before** launching Wave 1. Prevents shared-constraint conflicts.

### 3.1 Feature flags
Insert **every** flag of the "Feature switches" matrix (top of this doc) in one statement, with `group_name` and a `description` that says what users see when it is OFF. Defaults: all `false` except `admin_category_editor` and `admin_rules_editor` (`true`). Example shape:
```sql
insert into public.feature_flags (key, enabled, label, description, group_name, sort_order) values
  ('recurring_bookings', false, 'Recurring bookings', 'Customers book repeating home-service visits. Off: one-time booking only.', 'Recurring', 70),
  ('recurring_skip_pause', false, 'Skip & pause visits', 'Customers skip a visit or pause a plan. Off: buttons hidden.', 'Recurring', 71),
  -- … one row per matrix entry …
  ('admin_rules_editor', true, 'Admin rules editor', 'Admins edit recurring and sports rules.', 'Admin tools', 95)
on conflict (key) do nothing;
```
Also add `_recurring_feature(text)`, `_sports_feature(text)` (Feature switches rule 1) and the app `useFeature(key)` helper (rule 2) with a Jest test for the parent rule.

### 3.2 Notification kinds (append, dynamic pattern from `0050_rfq.sql:707-727`)
`recurring_plan_requested, recurring_plan_accepted, recurring_plan_declined, recurring_plan_paused, recurring_plan_resumed, recurring_plan_cancelled, recurring_visit_upcoming, recurring_visit_skipped, recurring_visit_unavailable, recurring_visit_reschedule_requested, recurring_visit_rescheduled, recurring_visit_cancelled_by_provider, recurring_visit_completed, recurring_payment_due, recurring_payment_failed, sports_booking_confirmed, sports_payment_due, sports_payment_failed, sports_booking_expired, sports_booking_cancelled, sports_refund_issued`.

Integrator also adds app routes in `app/src/lib/unread.ts` `notificationRoute`: `recurring_*` → `/recurring/<data.plan_id>` (or `/booking/<booking_id>` when `booking_id` present); `sports_*` → `/sports-booking/<data.sports_booking_id>`. Add `/recurring/` to `SAFE_ROUTE`.

### 3.3 Admin-configurable rules (`app_config`), seeded defaults
```sql
insert into public.app_config (key, value) values
 ('recurring_rules', '{"frequencies":["daily","alternate_days","weekly","monthly","custom"],
   "horizon_days":28,"max_plan_days":365,"skip_cutoff_hours":12,"reschedule_cutoff_hours":12,
   "reminder_hours_before":12,"payment_due_hours_before":24,
   "payment_frequencies":["per_visit","weekly","monthly","prepaid_package"],
   "recurring_discount_bp":0}'::jsonb),
 ('sports_rules', '{"payment_hold_minutes":10,"approval_pay_window_minutes":60,
   "commission_bp":1000,"customer_fee_paise":0,"full_refund_hours":24,
   "partial_refund_hours":6,"partial_refund_bp":5000,"release_after_hours":24}'::jsonb)
on conflict (key) do nothing;
```
Add `admin_get_rules(p_key text) returns jsonb` and `admin_set_rules(p_key text, p_value jsonb)` (admin-only, audit-logged, key ∈ `('recurring_rules','sports_rules')`, validate every field type/range server-side: hours 0–720, bp 0–5000, minutes 5–1440, arrays ⊂ allowed values). Add readers `_recurring_rule(p_path text) returns text` and `_sports_rule(p_path text) returns text` (private, `stable`).

### 3.4 Shared helpers
- `_assert_provider_window_free(p_provider uuid, p_window tstzrange, p_exclude_booking uuid)`: takes `pg_advisory_xact_lock(hashtext(p_provider::text))` and applies **the same predicate** as `_reserve_booking_service_window` (`0021:570-588`) excluding `p_exclude_booking`. Private.
- Deploy workflow verification (integrator, in `deploy-backend.yml` after the migration step): query `select jobname, schedule from cron.job` via the Management API and print it. If `cron` schema is missing, print a `::warning::` saying recurring generation and expiry jobs will not run until `pg_cron` is enabled (README "Scheduled jobs").

### 3.5 Done when
Backend CI green; SQL test `addendum_foundations.test.mjs` proves: flags default off; kinds insertable; `admin_set_rules` validates and rejects bad values and non-admins; `_assert_provider_window_free` rejects an overlap and ignores the excluded booking.

---

## 4. Lane A — Expanded Home Services catalogue + admin category editor (migration `0055_home_services_catalogue.sql`)

**Parallel with:** B, E, H, C1, F1. **Files you own:** `0055_*.sql`, `supabase/tests/home_services_catalogue.test.mjs`, `app/app/admin/services.tsx` (+ new `app/app/admin/category/[id].tsx`), `app/src/lib/adminApi.ts` (category functions only), `app/src/features/catalogue/model.ts`, `CatalogueSections.tsx`, `app/src/components/CategoryIcon.tsx`, catalogue Jest tests.

### 4.1 Existing (verified)
`categories` has `slug, name, icon, pricing_mode, sort_order, active, vertical, parent_id, archetype, location_modes, pricing_units, intake_schema, payment_template, cancellation_policy, commission_bp, lead-time bounds, restricted, config_version, requires_docs, recommended_docs` (`0001:78-85`, `0018:7-20`, `0009:34-36`, `0017:14-18`). City availability: `category_cities` (`0018:186-218`). Admin today can only toggle active/city-live (`0041:145-208`, `admin/services.tsx`). Packages support units `job, hour, day, session, person, plate, sqft, bhk, seat, litre, event, month` (`0017:258-280`).

### 4.2 Migration steps
1. Add columns: `categories.recurrence_allowed boolean not null default false`, `categories.allowed_frequencies text[] not null default '{}'` (subset of `recurring_rules.frequencies`), `categories.recurring_discount_bp int check (0..5000)` nullable (null = use rule default).
2. Extend `service_packages.unit` check to also allow `'visit','kg','piece'` (drop/recreate the check with the full existing list + new values; copy list from `0017:269`).
3. Seed **parent groups** (`vertical='household-help' | 'home-repairs' | 'home-other'`, `archetype` null, `parent_id` null, `active=false`) and **child categories** below with `parent_id` = group. Use `insert … on conflict (slug) do update set parent_id = excluded.parent_id` so existing slugs (`house-cleaning`, `electrician`, `plumber`, `ac-repair`, `appliance-repair`, `carpenter`, `painter`, `pest-control`, `water-tank-cleaning`) are **re-parented, not duplicated or renamed**.

| Group | Child slug | Archetype | Recurrence | Default unit |
|---|---|---|---|---|
| Household help | `home-cleaning` (existing `house-cleaning` keeps its slug; map label "Home cleaning") | fixed | daily, alternate_days, weekly | visit |
| | `deep-cleaning` | fixed | monthly | bhk |
| | `bathroom-cleaning` | fixed | weekly, monthly | piece |
| | `kitchen-cleaning` | fixed | weekly, monthly | visit |
| | `sofa-carpet-cleaning` | fixed | monthly | piece |
| | `full-house-cleaning` | fixed | monthly | bhk |
| | `dishwashing` | time_based | daily, alternate_days, weekly | hour |
| | `laundry-ironing` | fixed | weekly, alternate_days | kg |
| | `cooking-meal-prep` | time_based | daily, weekly | hour |
| | `daily-cook` | time_based | daily, weekly | month |
| | `part-time-cook` | time_based | daily, weekly | hour |
| | `full-time-cook` | time_based | daily | month |
| | `maid-household-helper` | time_based | daily, alternate_days, weekly | hour |
| Repair & maintenance | `electrician`, `plumber`, `carpenter`, `painter` (existing) | inspect_quote | none | job |
| | `ac-repair` (existing, label "AC servicing & repair") | inspect_quote | none | job |
| | `ac-servicing` (new, fixed service package) | fixed | monthly (interval 3/6) | visit |
| | `fridge-washing-machine-repair` | inspect_quote | none | job |
| | `ro-water-purifier-service` | fixed | monthly (interval 3/6) | visit |
| | `pest-control`, `water-tank-cleaning` (existing) | fixed | monthly | visit |
| | `appliance-installation` | fixed | none | piece |
| Other services | `gardening` | time_based | weekly, alternate_days | hour |
| | `packers-movers` | inspect_quote | none | job |
| | `home-sanitisation` | fixed | monthly | bhk |
| | `babysitting` | time_based | daily, weekly | hour — **`active=false`, `restricted=true`, `requires_docs` incl. police verification** |
| | `elderly-assistance` | time_based | daily, weekly | hour — same as babysitting |

   All new rows: `active=false`, no `category_cities` rows (admin enables per city). Provide `intake_schema` with only safe fields (e.g. `{"bhk":{"type":"integer","minimum":1,"maximum":10}}`, `brief`). Never put phone/address in intake.
4. Admin RPCs (admin-only, audited, bump `config_version` on every change):
   - `admin_upsert_category(p jsonb) returns uuid` — create/edit: slug (create only, `^[a-z0-9-]{3,60}$`), name, icon, parent_id (must be a group or null; no cycles; max depth 2), vertical, archetype, pricing_units, recurrence_allowed, allowed_frequencies (⊂ `recurring_rules.frequencies`), recurring_discount_bp, cancellation_policy (must exist in `cancellation_policies`), requires_docs, restricted, sort_order, intake_schema (must be a JSON object).
   - `admin_reorder_categories(p_ids uuid[])` — sets `sort_order` = array index × 10 within one parent.
   - `admin_set_category_active` already exists — keep; additionally refuse activating a `restricted` category with empty `requires_docs`.
   - `admin_list_categories` — extend output with the new columns (replace function with `drop function` + recreate only if the return type changes; keep all existing output fields).
5. Customer read RPC/view used by the catalogue must return `parent_id`, `recurrence_allowed`, `allowed_frequencies` (find it: `rg -n "listCategories" app/src/lib` → the RPC/table it calls; extend select).

### 4.3 App
- `admin/services.tsx`: add "New service" button and per-row "Edit" → `admin/category/[id].tsx` form (fields of 4.2.4, grouped: Basics, Booking type, Recurring, Verification, Cities). Up/down reorder within a group. Loading/error/empty/success states.
- `catalogue/model.ts`: map verticals `household-help`, `home-repairs`, `home-other`, `cleaning`, `auto` → family "Home services" (rename family label from "Home & vehicle services" only in display text; keep its key). Inside the family, render **groups → child categories** (use `parent_id`). Unmapped verticals still go to "More services".
- `CategoryIcon.tsx`: add icon keys for every new slug (Ionicons names already used by the app; fall back to generic tools icon).

### 4.4 Tests (`home_services_catalogue.test.mjs`)
Existing slugs keep their ids and become children (no duplicates); new categories inactive; admin can create/edit/reorder/disable; non-admin refused; cycle/depth-3 parent refused; restricted category cannot be activated without docs; `config_version` increments; `allowed_frequencies` outside rules refused. Jest: family/group mapping for new verticals.

### 4.5 Done when
Admin can add, edit, disable and reorder a category and sub-category without an app update; customers see Home services → groups → categories only for active + city-live rows.

---

## 5. Lane B — Recurring engine v2, backend (migration `0056_recurring_plans_v2.sql`)

**Parallel with:** A, E, H, C1, F1. **Files you own:** `0056_*.sql`, `supabase/tests/recurring_plans.test.mjs`.

### 5.1 Existing (verified)
`recurring_schedules` (weekly only, `weekdays int[]`, `start_time`, `timezone`, `session_duration_min`, `payment_mode ∈ per_session|pack_prepaid|monthly_prepaid`, `starts_on/ends_on/generated_through`, `status ∈ active|paused|cancelled|completed`) (`0022:348-390`); unique partial index on bookings `(recurring_schedule_id, scheduled_at)`; `create_recurring_schedule`, `materialize_recurring_schedule(uuid, date)`, `generate_recurring_sessions(int)` (`FOR UPDATE SKIP LOCKED`), `cancel_recurring_schedule(uuid, boolean)` (`0022:1194-1373`). **No cron schedules the generator. No pause/resume/skip RPC. Holiday mode does not stop materialization** (`0031:1-4`). Provider acceptance is per booking only.

### 5.2 Schema changes (all `add column if not exists`, keep existing columns)
`recurring_schedules`:
- Replace frequency check: `frequency in ('daily','alternate_days','weekly','monthly','custom')`. Existing rows stay `weekly`.
- `interval_count int not null default 1 check (1..12)` (monthly: every N months; weekly: every N weeks).
- `month_day int check (1..28)` (monthly; cap 28 to avoid short months).
- `custom_dates date[]` (custom: explicit dates, max 120, all ≥ `starts_on`).
- `max_occurrences int check (1..400)`, `occurrences_created int not null default 0`.
- `archetype text not null default 'time_based' check (archetype in ('time_based','fixed'))`, `package_qty numeric(10,2)` (fixed packages).
- `provider_acceptance text not null default 'pending' check (in ('pending','accepted','declined'))`, `acceptance_mode text not null default 'plan' check (in ('plan','occurrence'))`, `decided_at timestamptz`, `decline_reason text`.
- `paused_at timestamptz`, `pause_until date`, `billing_frequency text not null default 'per_visit' check (in ('per_visit','weekly','monthly','prepaid_package'))` (maps legacy `payment_mode`: `per_session→per_visit`, `pack_prepaid→prepaid_package`, `monthly_prepaid→monthly`; backfill with one `update`).
- Constraint: weekdays required only for `weekly`/`alternate_days`? → **rule**: `weekly` requires non-empty `weekdays`; `daily`/`alternate_days`/`monthly`/`custom` ignore `weekdays` (store `'{}'`); `monthly` requires `month_day`; `custom` requires `custom_dates`. Relax the existing weekdays NOT-EMPTY check accordingly (find it in `0022:348-390`, drop by name, re-add conditional check).

New table `recurring_occurrence_changes`:
`id uuid pk, schedule_id uuid not null fk, booking_id uuid fk null, occurrence_date date not null, original_at timestamptz not null, kind text check (in ('skipped','provider_unavailable','reschedule_requested','rescheduled','reschedule_declined','provider_absent','cancelled')), new_at timestamptz, actor_id uuid, reason text (≤300), created_at`. Unique `(schedule_id, occurrence_date, kind)` where `kind in ('skipped','provider_unavailable')` (partial unique index) — this is what makes skips idempotent and stops the generator re-creating a skipped date. RLS: customer of schedule, provider of schedule (and `_acts_for(provider,'staff')`), admin may select; no direct writes.

### 5.3 Date algorithm (single source of truth)
`_recurrence_dates(p_schedule recurring_schedules, p_from date, p_to date) returns setof date` (immutable-style, `stable`):
- `daily`: every date in range ≥ `starts_on`.
- `alternate_days`: dates where `(d - starts_on) % (2*interval_count) = 0`… **simplify:** `alternate_days` ⇒ `(d - starts_on) % 2 = 0` (interval ignored).
- `weekly`: `extract(isodow from d) = any(weekdays)` and `((d - date_trunc('week', starts_on)::date) / 7) % interval_count = 0`.
- `monthly`: `extract(day from d) = month_day` and months since `starts_on` `% interval_count = 0`.
- `custom`: `d = any(custom_dates)`.
- Always clip to `[starts_on, coalesce(ends_on, starts_on + max_plan_days)]`.
Lane C1 implements the **same** algorithm in TS (`app/src/features/recurring/dates.ts`). Both lanes share the **fixture vectors** in §5.7 so they cannot diverge.

### 5.4 RPCs (signatures are the contract — do not change names/args)
| RPC | Who | Behaviour |
|---|---|---|
| `quote_recurring_plan(p jsonb) returns jsonb` | customer | Validates inputs, computes **server-side**: `per_visit_paise`, `visits_in_first_cycle`, `visits_total` (if ends/max), `discount_bp`, `discount_paise`, `platform_fee_paise`, `gst_paise` (if applicable today — reuse the same fee logic as `_create_session_booking`/`create_fixed_booking`), `total_paise_per_cycle`, `billing_frequency`, `first_dates` (next 10). No writes. Input keys: `provider_service_id, package_id, archetype, frequency, interval_count, weekdays, month_day, custom_dates, start_date, end_date, max_occurrences, start_time, duration_min, package_qty, billing_frequency`. |
| `create_recurring_plan(p jsonb) returns uuid` | customer | Same validation as quote + flag `recurring_bookings` + category `recurrence_allowed` and frequency ∈ `allowed_frequencies` + billing ∈ rules. Creates schedule with `provider_acceptance='pending'`, **does not materialize**, notifies provider `recurring_plan_requested`. Wrap legacy `create_recurring_schedule` callers: keep old RPC working (it may call the new one with `frequency='weekly'`, `provider_acceptance='accepted'` to preserve current behaviour). |
| `respond_recurring_plan(p_id uuid, p_accept boolean, p_reason text)` | provider (`_acts_for(provider,'manager')`) | Pending only. Accept: `provider_acceptance='accepted'`, run `materialize_recurring_schedule` for the horizon, notify `recurring_plan_accepted`. Decline requires reason, `status='cancelled'`, notify `recurring_plan_declined`. |
| `pause_recurring_plan(p_id uuid, p_until date default null)` / `resume_recurring_plan(p_id uuid)` | customer | Pause: `status='paused'`, cancel **future unpaid** occurrences beyond `skip_cutoff_hours` via the existing customer-cancel path with zero penalty; record `cancelled` changes. Resume: `status='active'`, materialize. Notify provider. |
| `skip_recurring_visit(p_booking_id uuid, p_reason text default '')` | customer | Only before `scheduled_at - skip_cutoff_hours`. Cancels that booking through the existing cancellation path (no charge before cutoff; refund if prepaid), inserts `skipped` change. Idempotent: second call returns without error. Notify provider. |
| `cancel_recurring_plan(p_id uuid, p_reason text)` | customer | Wrap/replace `cancel_recurring_schedule`: cancel future occurrences per policy, `status='cancelled'`, notify. |
| `request_visit_reschedule(p_booking_id uuid, p_new_at timestamptz, p_reason text)` | provider or customer | Before cutoff; new time within provider hours; `_assert_provider_window_free(...)`; inserts `reschedule_requested`; notifies the other party. |
| `respond_visit_reschedule(p_change_id uuid, p_accept boolean)` | the other party | Accept: update booking `scheduled_at`, `service_window` (call `_assert_provider_window_free` again inside the lock), insert `rescheduled`; decline → `reschedule_declined`. |
| `report_provider_absence(p_booking_id uuid, p_reason text)` | provider | Cancels the occurrence via the provider-cancel path (`decline_session_booking` for time_based; latest provider-cancel RPC for fixed) → full refund of anything paid; inserts `provider_absent`; notifies `recurring_visit_cancelled_by_provider`. |
| `list_my_recurring_plans()` / `get_recurring_plan(p_id uuid) returns jsonb` | customer, provider (staff via `_acts_for`) | Plan + upcoming/past occurrences + changes. |
| `list_provider_recurring_schedule(p_provider_id uuid, p_from date, p_to date)` | provider/staff | Calendar rows (occurrence bookings + plan names). |
| `generate_recurring_occurrences(p_limit int default 100) returns int` | service_role | Replaces scheduling role of `generate_recurring_sessions` (keep the old function, make it call the new one). For each `active` + `accepted` plan (`FOR UPDATE SKIP LOCKED`): dates from `_recurrence_dates(generated_through+1, today+horizon_days)`; skip dates with a `skipped`/`provider_unavailable` change; if provider `paused` or date overlaps `provider_time_off` → insert `provider_unavailable` change (unique idx makes it idempotent) + notify customer; else create the occurrence via `_create_session_booking` (time_based) or the fixed creator (find latest `create_fixed_booking` definition; factor a private `_create_fixed_occurrence` that skips customer-auth checks and takes `p_customer_id`). Catch `unique_violation` (already exists) and `provider_unavailable` overlap errors per date (record `provider_unavailable`, continue). Stop at `max_occurrences`. Advance `generated_through`. Set `status='completed'` when past `ends_on`/max. |
| `queue_recurring_reminders() returns int` | service_role | For occurrences starting within `reminder_hours_before` not yet reminded: `_queue_notification(..., 'recurring_visit_upcoming', ..., collapse_key 'recurring-reminder:<booking_id>')`. Idempotent via collapse key + `notifications` existence check. |

Occurrence status when plan is `accepted` and `acceptance_mode='plan'`: create bookings so the provider does **not** re-accept each visit. Check `archetype_transitions` for `time_based`/`fixed`; if the creator inserts `pending_payment`/`requested`, add a **system** transition to `accepted` after payment (see Lane D) — add needed `archetype_transitions` rows (`actor='system'`) in this migration. `acceptance_mode='occurrence'` keeps today's per-booking accept.

Cron (guarded): `generate-recurring-occurrences` `'17 * * * *'` (hourly) → `select case when public._feature_enabled('recurring_bookings') then public.generate_recurring_occurrences() end`; `recurring-visit-reminders` `'*/15 * * * *'`.

### 5.5 Holiday/unavailability rules
- New holiday (`providers.paused=true` or a new `provider_time_off` period): the generator stops creating future dates (above). **Already-created** future occurrences are **not** auto-cancelled; the provider must use `report_provider_absence` (UI shows them a banner listing affected visits). Rationale: avoids mass cancellation on an accidental toggle.
- Max jobs/day and working hours are enforced by `_create_session_booking`/fixed creator; treat their rejection as `provider_unavailable` for that date.

### 5.6 Contract for UI lanes (C1, G) — TypeScript types (put in `app/src/features/recurring/types.ts`, owned by C1)
```ts
export type Frequency = 'daily' | 'alternate_days' | 'weekly' | 'monthly' | 'custom';
export type BillingFrequency = 'per_visit' | 'weekly' | 'monthly' | 'prepaid_package';
export interface RecurringPlanInput { provider_service_id: string; package_id: string | null; archetype: 'time_based' | 'fixed';
  frequency: Frequency; interval_count: number; weekdays: number[]; month_day: number | null; custom_dates: string[];
  start_date: string; end_date: string | null; max_occurrences: number | null; start_time: string; duration_min: number | null;
  package_qty: number | null; billing_frequency: BillingFrequency; address_id: string; description: string; }
export interface RecurringQuote { per_visit_paise: number; visits_in_first_cycle: number; visits_total: number | null;
  discount_bp: number; discount_paise: number; platform_fee_paise: number; gst_paise: number;
  total_paise_per_cycle: number; billing_frequency: BillingFrequency; first_dates: string[]; }
export type PlanStatus = 'active' | 'paused' | 'cancelled' | 'completed';
export type ChangeKind = 'skipped' | 'provider_unavailable' | 'reschedule_requested' | 'rescheduled' | 'reschedule_declined' | 'provider_absent' | 'cancelled';
```

### 5.7 Shared date fixture vectors (copy into both SQL and Jest tests)
| Input | Expected first dates |
|---|---|
| weekly, weekdays [1..6], start 2026-12-07 (Mon) | 12-07, 12-08, 12-09, 12-10, 12-11, 12-12, 12-14 |
| alternate_days, start 2026-12-07 | 12-07, 12-09, 12-11, 12-13 |
| weekly, weekdays [7], start 2026-12-07 | 12-13, 12-20, 12-27 |
| monthly, month_day 7, interval 6, start 2026-12-07 | 2026-12-07, 2027-06-07, 2027-12-07 |
| daily, start 2026-12-30, end 2027-01-02 | 12-30, 12-31, 01-01, 01-02 |
| custom [2026-12-25, 2026-12-31] | 12-25, 12-31 |

### 5.8 Tests (`recurring_plans.test.mjs`)
Fixture vectors; create→pending (no bookings) → provider accepts → occurrences = horizon count, one booking per date; generator run twice creates no duplicates; skip before cutoff (no charge, change row, generator does not recreate); skip after cutoff refused; pause cancels future unpaid, resume regenerates; provider holiday → `provider_unavailable` rows, no booking; overlapping booking from another customer → that date `provider_unavailable`, other dates fine; reschedule into an occupied slot refused; reschedule accept moves window; provider absence refunds paid occurrence; flag off refuses; other customer cannot read/skip; staff cannot respond to plan (manager can); legacy `create_recurring_schedule` still works; `max_occurrences` stops generation.

### 5.9 Done when
All tests green in CI; with the flag on, a plan produces individual booking rows, each with its own status; skips/absences are records, never fake completed bookings.

---

## 6. Lane E — Sports online payments, backend (migration `0057_sports_payments.sql`)

**Parallel with:** A, B, H, C1, F1. **Files you own (Wave 1):** `0057_*.sql`, `supabase/tests/sports_payments.test.mjs`, `supabase/functions/create-payment/index.ts`, `verify-payment/index.ts`, `razorpay-webhook/index.ts`, `release-payouts/index.ts`, `supabase/functions/_shared/payout-beneficiary.ts`, `provider-payout-account/index.ts`, their Deno tests.

### 6.1 Existing (verified)
Sports tables/RPCs `0048_sports.sql` (statuses `requested, accepted, declined, cancelled, completed, expired`; `request_sports_slot(uuid, timestamptz, int default 1, text)` with advisory lock and server price `:721-825`; `get_sports_slots` `:661-719`; `decide_sports_booking` `:889-927`; `cancel_sports_booking` `:929-957`; `expire_sports_requests` cron every 5 min `:959-1046`). Pay-at-venue only; no payment/refund/settlement fields; no capacity; UI books one slot. Payments: Razorpay **Orders** via `create-payment`, HMAC-verified `verify-payment` + webhook, recorders dedupe by gateway payment id; `_queue_refund`/`_refund_partial`; `process-refunds` with idempotency header; `payouts` (one per **booking**, `booking_id not null unique`, `provider_id not null references providers`) and `payout_transfers`; beneficiary in `provider_payout_accounts` keyed by `provider_id` (`0009:198`).

### 6.2 Schema
- `sports_venues`: `payment_modes text[] not null default '{pay_at_venue}'` (⊂ `online, pay_at_venue`), `cancellation_rules jsonb` (null = `sports_rules` defaults).
- `sports_resources`: `booking_mode text not null default 'approval' check (in ('instant','approval'))`, `capacity int not null default 1 check (1..100)` (coaching/classes/pools > 1).
- `sports_bookings`: extend status check to add `pending_payment`, `awaiting_payment`; add `payment_mode text not null default 'pay_at_venue' check (in ('online','pay_at_venue'))`, `participants int not null default 1 check (1..50)`, `hold_expires_at timestamptz`, `pay_by timestamptz`, `customer_fee_paise int not null default 0`, `total_paise int` (price + fee), `commission_bp int`, `refund_paise int not null default 0`, `paid_at timestamptz`, `idempotency_key text` with unique `(customer_id, idempotency_key)` where not null.
- `payments`: `add column sports_booking_id uuid references sports_bookings(id)`; drop/recreate the "exactly one parent" check if one exists (find the current check on `payments` parents introduced in `0022:321-344`) to allow `num_nonnulls(booking_id, pack_purchase_id, sports_booking_id) = 1`; partial unique index: one `created` payment per `sports_booking_id`.
- `payouts`: `alter column booking_id drop not null`, `alter column provider_id drop not null`, add `sports_booking_id uuid unique references sports_bookings(id)`, `payee_id uuid references profiles(id)`; check `num_nonnulls(booking_id, sports_booking_id) = 1` and `coalesce(provider_id, payee_id) is not null`. **Read every reader of `payouts.provider_id`** (`rg -n "provider_id" supabase/migrations/*.sql | rg payouts`, `claim_due_transfers` latest def `0021:1103`, `release-payouts/index.ts`, earnings RPCs) and use `coalesce(p.provider_id, p.payee_id)` where the payee is needed. Provider earnings views must keep filtering `provider_id` (unchanged behaviour).
- `provider_payout_accounts.provider_id` FK: change to `references profiles(id)` (provider ids are profile ids, so existing rows stay valid). Allow `provider-payout-account` function to enrol a verified **venue owner** (has a `sports_venues` row with `status='verified'`) as well as a provider. Name stays; document it as "merchant payout account".

### 6.3 Flows (all under advisory lock on resource; all amounts server-side)
- **Slot occupancy** (update `get_sports_slots` + request check): a slot's used capacity = sum(`participants`) of overlapping bookings in (`accepted`) ∪ (`requested`, `awaiting_payment`, `pending_payment` with unexpired `expires_at`/`pay_by`/`hold_expires_at`). Free if used + requested participants ≤ capacity. Return `remaining` per slot.
- **New RPC** `book_sports_slot(p_resource_id uuid, p_starts_at timestamptz, p_slots int, p_participants int, p_payment_mode text, p_note text, p_idempotency_key text) returns jsonb` (keep `request_sports_slot` working unchanged for old clients):
  - `p_payment_mode='online'` requires flag `sports_online_payments` and `'online' = any(venue.payment_modes)` and a venue-owner payout account in a verified state (else error "This venue does not accept online payment yet").
  - instant + online → `pending_payment`, `hold_expires_at = now() + payment_hold_minutes`; return `{booking_id, status, total_paise, hold_expires_at}`.
  - approval + online → `requested` (owner decides); on accept → `awaiting_payment`, `pay_by = least(starts_at - 30 min, now() + approval_pay_window_minutes)`, notify `sports_payment_due`.
  - instant + pay_at_venue → `accepted` immediately, notify `sports_booking_confirmed` (both parties).
  - approval + pay_at_venue → today's flow (`requested` → `accepted`).
  - Same `idempotency_key` for the same customer returns the existing booking (no second hold).
- `prepare_sports_payment(p_booking_id uuid, p_user_id uuid) returns table(payment_id uuid, amount int, purpose text, url text)` — customer must own; status `pending_payment`/`awaiting_payment` and hold/pay_by not expired; reuses the existing `created` attempt or creates one for `total_paise`.
- `record_sports_payment_paid(p_order_id text, p_payment_id text, p_amount int)` — dedupe by gateway id; amount must equal payment amount; if booking still payable → `accepted`, `paid_at`, notify `sports_booking_confirmed`; if hold expired/cancelled → keep payment `paid` and **queue full refund** (late-payment pattern from `record_session_payment_paid`, `0022:842-884`), notify `sports_refund_issued`.
- Failure: webhook/verify `payment.failed` → payment `failed`, notify `sports_payment_failed`; customer may retry while hold valid (prepare creates a new attempt).
- Expiry (extend `expire_sports_requests`): expire `pending_payment` past `hold_expires_at` and `awaiting_payment` past `pay_by` → `expired`, notify `sports_booking_expired`, retire `created` payment attempts (same as existing retired-link handling in `process-refunds`).
- Cancel (extend `cancel_sports_booking`): online-paid bookings compute refund from venue `cancellation_rules` or `sports_rules`: ≥ `full_refund_hours` before start → 100 %; ≥ `partial_refund_hours` → `partial_refund_bp`; else 0. Customer fee is non-refundable on customer cancel, refunded on venue cancel. Venue cancel → always 100 % incl. fee. Use `_refund_partial`/`_queue_refund`; store `refund_paise`; notify `sports_booking_cancelled` (+ `sports_refund_issued` when > 0).
- Settlement: when `expire_sports_requests` marks an online-paid `accepted` booking `completed`, create a payout: `gross = price_paise - refund_paise`, `commission = round(gross * commission_bp / 10000)` (snapshot `commission_bp` from `sports_rules` at booking time), GST on commission 18 % (same as `_create_payout` `0001:573-610`), `payee_id = venue.owner_id`, `release_after = now() + release_after_hours`; transfers allocated against the sports payment. Write a private `_create_sports_payout(p_sports_booking_id uuid)`; do not modify `_create_payout`.
- Edge functions: add `kind: 'sports'` to `create-payment` (calls `prepare_sports_payment`); `verify-payment` and `razorpay-webhook` route by looking up the payment row's parent (`sports_booking_id` not null → `record_sports_payment_paid`). Keep existing branches byte-for-byte where possible. Demo mode: extend `demo_settle_payment` (`0030:736-777`) to accept sports payments for **demo venues only** (demo marker on owner, same rule as providers).

### 6.4 Tests (`sports_payments.test.mjs` + Deno tests for routing)
Instant online: hold → pay → accepted; second customer cannot take held slot; hold expiry frees slot; late payment after expiry → refund queued; payment failure then retry succeeds; approval online: requested → accept → awaiting_payment → pay → accepted; pay_by expiry; pay-at-venue instant → accepted immediately; capacity resource accepts N participants then refuses; idempotency key returns same booking; cancel refunds 100/50/0 % by time; venue cancel refunds fee too; completion creates payout with correct commission/GST and `payee_id`; flag off refuses online but pay-at-venue still works; amount mismatch refused; non-owner cannot prepare payment; existing `request_sports_slot` tests still pass. Deno: payment routing picks sports recorder.

### 6.5 Contract for UI lane F (TypeScript, put in `app/src/features/sports/api.ts`, owned by F1)
```ts
export type SportsPaymentMode = 'online' | 'pay_at_venue';
export type SportsBookingStatus = 'pending_payment' | 'requested' | 'awaiting_payment' | 'accepted' | 'declined' | 'cancelled' | 'completed' | 'expired';
export interface BookSlotResult { booking_id: string; status: SportsBookingStatus; total_paise: number; hold_expires_at: string | null; pay_by: string | null; }
// RPCs: book_sports_slot, get_sports_slots (adds `remaining`), cancel_sports_booking, decide_sports_booking
// Payment: create-payment edge function with body { kind: 'sports', sportsBookingId }
```

---

## 7. Lane H — Admin rule controls (UI only, Wave 1)

**Files you own:** `app/app/admin/rules.tsx` (new), link row in `app/app/admin/index.tsx`, `app/src/lib/adminApi.ts` (rules functions only — coordinate: Lane A edits category functions in the same file; **H adds its functions in a new file `app/src/lib/adminRulesApi.ts` instead** to avoid conflicts).

Screens: "Recurring rules" (frequencies checklist, horizon, skip/reschedule cutoff, reminder hours, payment due hours, payment frequencies, default recurring discount %) and "Sports rules" (hold minutes, approval pay window, commission %, customer fee ₹, refund windows, partial refund %, release hours). Uses `admin_get_rules`/`admin_set_rules` (Wave 0). Show values in human units (₹, %, hours) and convert to paise/bp on save. Cancellation windows per category: link to category editor (Lane A). Commission rates: existing `admin/commission.tsx` (no change). Provider verification requirements: category editor `requires_docs` (Lane A). Geography: existing `admin/geography.tsx`.

Tests: Jest for unit conversions (₹↔paise, %↔bp, validation messages). Done when admin can change every rule without an app update and invalid values show the server's error.

---

## 8. Lane F — Sports customer & venue UI

### F1 (Wave 1, against §6.5 contract) — files you own
`app/app/venue/[id].tsx`, `app/app/sports/bookings.tsx`, `app/app/sports-booking/[id].tsx`, new `app/app/sports-checkout/[id].tsx`, `app/app/sports/index.tsx` (copy only), `app/app/sports/manage.tsx` (venue settings section only), `app/src/features/sports/**`.

1. Venue screen: choose activity/resource → date → start slot → **duration** (1–4 consecutive slots, only offered when all are free) → participants (only when capacity > 1) → payment choice (only the modes the venue allows; "Pay online" hidden when flag off) → primary button "Book" (instant) / "Send request" (approval). Show server price from `get_sports_slots`; refresh slots on focus and every 30 s while visible; on `book_sports_slot` "slot taken" error, refresh and show "That slot was just booked. Pick another time."
2. Checkout screen `sports-checkout/[id]`: summary (venue, court, time, participants, price, fee, total), countdown to `hold_expires_at`/`pay_by`, "Pay ₹X" via `usePayment` (`app/src/lib/payments.tsx`) with `kind: 'sports'`, retry on failure, expired state with "Choose another slot".
3. Booking detail/list: status labels — pending_payment "Complete payment", requested "Waiting for venue", awaiting_payment "Venue approved — pay now", accepted "Confirmed" (+ "Pay at venue" or "Paid"), cancelled/expired/declined/completed; refund amount when > 0; cancel button shows the refund the policy will give **from the server** (add a read RPC request to integrator if needed: `preview_sports_cancellation(p_id) returns jsonb`).
4. Venue settings in `sports/manage.tsx`: per resource booking mode (instant/approval) and capacity; per venue payment modes and payout-account status with link to payout setup. Update `sports/index.tsx` copy: remove "QuickServe does not collect sports payments" only when the flag is on.

### F2 (Wave 2) — wire to merged E RPCs, fix type drift, add E2E steps (instant online in demo mode, approval flow, pay-at-venue, expiry display).

---

## 9. Lane C — Customer recurring booking UX

### C1 (Wave 1, against §5.6 contract) — files you own
`app/src/features/recurring/**` (types, `dates.ts` + Jest using §5.7 vectors, `api.ts`, components), new `app/app/recurring/new/[providerServiceId].tsx`, `app/app/recurring/[id].tsx`, entry points in `app/app/book/[providerServiceId].tsx` and `app/app/book-fixed/[providerServiceId].tsx` (add a "One-time / Repeat" segmented choice **only** when the category `recurrence_allowed` and flag `recurring_bookings` is on; one-time path unchanged).

Steps of the recurring wizard (one screen, sections, sticky summary):
1. How often: big buttons from the category's `allowed_frequencies` — "Every day", "Every other day", "Weekly", "Monthly", "Choose dates". Weekly shows weekday chips with presets "Mon–Sat", "Weekends".
2. When: start date, time, visit duration (time_based) or package/quantity (fixed).
3. Until: "No end date" / "End on date" / "Number of visits".
4. Address (existing picker), instructions, photos (existing components).
5. Payment: per visit / weekly / monthly / prepaid package — only the options allowed by `recurring_rules` and flag `recurring_billing` (when off: per visit only).
6. Summary (server `quote_recurring_plan`): price per visit, visits this cycle, discount, platform fee, taxes, **total per cycle**, payment frequency, next 5 dates (from server `first_dates`; the TS `dates.ts` is only for instant preview while editing). Primary: "Send request to <provider>".

Plan detail `recurring/[id]`: status chip, schedule summary in words, provider acceptance state, upcoming visits (each opens existing `/booking/[id]`), past visits, changes (skipped/unavailable/rescheduled), actions: Skip next visit, Pause / Resume, Cancel plan, Respond to reschedule. Confirm dialogs explain charges/refunds in one sentence. Add a "Plans" sub-filter inside My Activity → Services (`UnifiedActivityScreen` `ServicesSegment`: a third segmented option "Repeat plans").

### C2 (Wave 2)
Wire to merged B/D RPCs; billing cycle display (paid/due/next charge) from Lane D; E2E steps.

---

## 10. Lane D — Recurring billing & payments (migration `0058_recurring_billing.sql`, Wave 2)

**Depends on B merged. Files you own:** `0058_*.sql`, `supabase/tests/recurring_billing.test.mjs`, payment edge functions (after E is merged — rebase first).

1. Table `recurring_billing_cycles`: `id, schedule_id fk, period_start date, period_end date, visits_planned int, visit_booking_ids uuid[], amount_paise int, status text check (in ('upcoming','due','paid','failed','cancelled','settled')), due_at timestamptz, payment_id uuid fk, credited_paise int default 0, created_at`; unique `(schedule_id, period_start)`.
2. `payments.recurring_cycle_id uuid fk` + extend the one-parent check (coordinate with E's check: now `num_nonnulls(booking_id, pack_purchase_id, sports_booking_id, recurring_cycle_id) = 1`).
3. Billing rules:
   - `per_visit`: no cycles; each occurrence carries its own due obligation (existing session/fixed payment schedule). Due `payment_due_hours_before` the visit; reminder `recurring_payment_due`; unpaid at due time → occurrence cancelled per policy (no charge) + notify.
   - `weekly`/`monthly`: generator (B) calls `_ensure_billing_cycle(schedule, period)` when it creates occurrences; amount = Σ server price of **created, non-cancelled** occurrences in the period (minus recurring discount) + platform fee rule. Cycle `due` at `period_start - payment_due_hours_before`. Occurrences in a paid cycle are created with their obligations marked paid-by-cycle (link `payment_schedule.payment_id` to the cycle payment) so `prepare_session_payment` never charges them again.
   - `prepaid_package`: reuse `pack_purchases`/`pack_sessions` (`0022:279-317`); occurrences allocate pack sessions.
   - Credits: skipped/cancelled/unavailable/provider-absent occurrences inside a **paid** cycle → refund that visit's share via `_queue_refund` on the cycle payment (or credit to next cycle — **decision: refund**, simpler to reconcile). Unused pack sessions at plan cancel → pro-rata refund of the unused share.
4. RPCs: `prepare_recurring_cycle_payment(p_cycle_id uuid, p_user_id uuid)`, `record_recurring_cycle_paid(p_order_id text, p_payment_id text, p_amount int)` (dedupe, amount check, late-after-cancel → refund), `list_plan_billing(p_schedule_id uuid)`; `process_recurring_billing()` service-role cron every 15 min: mark cycles `due`, notify, mark `failed` after grace and pause plan with notification `recurring_payment_failed`.
5. Provider payouts: each **completed** occurrence creates its payout through the existing completion/auto-confirm path; transfers allocate against the cycle payment (generalise `_create_payout` allocation to accept a payment id list — read `0001:573-610` first; if change is non-trivial, write `_create_occurrence_payout`).
6. Edge functions: `create-payment` `kind: 'recurring_cycle'`; verify/webhook route by `recurring_cycle_id`.
7. Tests: weekly cycle amount = visits × price − discount; paying cycle marks occurrences paid, `prepare_session_payment` refuses double charge; skip after paying refunds that visit; provider absence refunds; unpaid cycle → failed → plan paused; per-visit unpaid occurrence cancelled with no charge; duplicate webhook no double credit; amount mismatch refused; late payment after cancel refunded; pack plan allocates sessions and refunds unused on cancel.

---

## 11. Lane G — Merchant portal UX (Wave 2)

**Files you own:** new `app/app/merchant-calendar.tsx`, new `app/app/recurring/provider/[id].tsx`, `app/app/(provider)/dashboard.tsx` (add "Repeat requests" section + calendar link only), `app/app/sports/manage.tsx` (calendar/earnings tabs only — F1 owns the settings section; G must rebase on F1), `app/app/(provider)/earnings.tsx` (recurring/sports rows only).

1. Booking calendar (`merchant-calendar`): day/week list (no third-party calendar package) of occurrence bookings and sports bookings for the selected business (`list_provider_recurring_schedule`, `get_my_business_sports_bookings`), status colour + label, tap → existing booking/merchant-job/sports-booking screen.
2. Repeat requests: pending plans with schedule-in-words, first dates, earnings per visit (server); Accept plan / Decline (reason). For `acceptance_mode='occurrence'`, per-visit accept stays in the existing jobs list.
3. Plan screen for provider: upcoming/completed visits; actions per visit: Mark completed (existing session completion RPC), Request reschedule, Report absence; holiday banner listing future visits during time off with "Report absence for these".
4. Availability & pricing: link to existing Hours section and service/package editor (no new editor); show `recurrence_allowed` packages with a "Repeat available" badge.
5. Earnings: include recurring occurrence payouts and sports payouts (`payee_id`), grouped by date; pending vs released.
6. Staff roles (Phase 10): staff view only; managers can accept/decline/reschedule; only owners change pricing/payout (`_acts_for` checks are server-side — UI hides actions by `business_role`).

---

## 12. Lane T — End-to-end, artifacts, status (Wave 3)

1. `e2e/all-services.mjs` steps (demo project, demo payment mode, flags enabled by the existing reset step — add the new flags to the E2E reset SQL in `.github/workflows/e2e-web.yml` integrator-owned: enable `recurring_bookings`, `recurring_billing`, `sports_online_payments` and activate 3 new demo categories **only in the DEMO project reset step**):
   - one-time cleaning booking (fixed) unchanged path;
   - recurring daily-cook plan: create → provider accepts → upcoming visits listed → skip one → pause → resume;
   - weekly billing cycle paid in demo mode → occurrence shows Paid;
   - provider reports absence → customer sees cancelled visit + refund;
   - sports instant online: book → checkout → paid → Confirmed; second user sees slot taken;
   - sports approval online: request → venue accepts → pay → Confirmed; sports pay-at-venue instant;
   - sports cancel with refund amount shown.
   Demo fixtures must be isolated (existing `seed-all-services.sql` + `demo_only` markers) and never used by production code paths.
2. BDD/DDD/traceability artifacts per feature (`home-services-catalogue`, `recurring-plans`, `recurring-billing`, `sports-payments`, `admin-rules`) in `docs/content/engineering/fundamentals/delivery-methods/{bdd,ddd,bdd-ddd-tdd}/artifacts/` with real CI run IDs.
3. Update this doc's status table and `docs/01-PRD.md` addendum status.
4. **Owner production checklist** (not automatable): Razorpay test-mode payment for a sports booking and a recurring cycle; webhook events `order.paid`, `payment.failed`, refunds visible in Razorpay dashboard; venue-owner payout account verification; confirm R10 business numbers; confirm `pg_cron` jobs listed by the deploy step; then enable flags city by city.

---

## 13. Requirements traceability (PRD addendum → lane)

| PRD item | Lane(s) |
|---|---|
| 1 Expanded Home Services, admin-managed categories | A (+H links) |
| 2 One-time & recurring booking, all frequencies, pause/resume/skip/cancel, one booking per occurrence | B (backend), C (UI) |
| 3 Provider accept plan/occurrence, schedule, complete, absence/reschedule, notifications, no overlaps, holidays | B, G, W0 (kinds, overlap helper) |
| 4 Pricing models, transparent breakdown, per-visit/weekly/monthly/prepaid, no charge for skipped, refunds, reconciliation, idempotency | A (units), B (quote), D (billing) |
| 5 Sports instant/approval/pay-at-venue, real-time availability, concurrency, expiry, failure/retry, refunds, settlement, notifications | E (backend), F (UI), G (calendar/earnings) |
| 6 Schema/architecture, idempotent background generation | W0, A, B, D, E |
| 7 Customer UX | C, F |
| 8 Merchant UX | G, F1 (venue settings) |
| 9 Admin controls | A, H, existing commission/geography screens |
| 10 Audit, tests, RLS, no demo-only completion claims | every lane's Tests + T |

## 14. Status

| Wave/Lane | Status | CI evidence |
|---|---|---|
| W0 | Not started | — |
| A, B, E, H, C1, F1 | Not started | — |
| D, G, C2, F2 | Not started | — |
| T | Not started | — |
