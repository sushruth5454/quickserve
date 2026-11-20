# Nearo — Audit Remediation: Implementation Plan (Deliverable F)

| | |
|---|---|
| **Status** | Owner decisions D1–D7 recorded on 2026-11-18 in [doc 15 §7](15-Nearo-Functional-Audit-Report.md#7-owner-decisions). **Start only after the owner approves execution.** |
| **Baseline** | `main` @ `bfa999f`; latest migration `0058_sports_payments.sql` |
| **Audience** | The implementing (lower-capability) model and its agents. Every WP points to **source task rows** in the appendices. Those rows hold the exact files, required change, acceptance criteria and tests. This doc adds ownership, ordering, migration numbers and integration rules. **Do not redesign anything; implement the source rows.** |
| **Relationship to other plans** | [doc 12](12-Home-Services-Recurring-Sports-Payments-Implementation-Plan.md) remaining tasks (D1, D2, F2, G2, T1, T2) and [doc 14](14-UI-Redesign-AI-Execution-Plan.md) UI redesign are sequenced in §6. **This plan takes priority:** it fixes money, security and privacy defects. |

---

## 0. Execution protocol (read fully before launching anything)

### 0.1 Roles
Same as doc 14 §0.1:
- **Integrator.** Launches agents, merges green lanes in the §4 order, owns the integrator files (§0.4) and renumbers migrations.
- **WP agent.** Exactly one WP, one worktree, one lane branch `lane/<WP-ID>`.

### 0.2 Mandatory loop
Follow `.github/copilot-instructions.md` → **Fast validation loop**, rules 1–16, especially rules 11, 12 and 16:
1. CI only; no local npm, jest, tsc, deno or expo.
2. Push `git push origin HEAD:refs/heads/lane/<WP-ID>`.
3. Read **all** failures and fix them in one push.
4. A WP is done only when its lane is green and its run ID is reported.
5. Use a lower-model review **only** for money, auth or concurrency WPs (marked 🔒). Never trigger Opus reviews automatically.
6. Before each lane push, copy `scripts/cs-test.ps1` from current `origin/main` to `$env:TEMP`, run the narrow Codespace suite, and push only after `cs-test result: PASS`.
7. Every `integrate/**` batch needs green lane CI and private `e2e-local`; hosted `e2e-web` runs only on `main` after deploy. Never dispatch hosted E2E on lanes or batches.
8. E2E flag values come from `e2e/e2e-flags.json`; add any new switch the smoke test requires ON.

### 0.3 Agent prompt template
```
You implement work package <WP-ID> from docs/17-Nearo-Audit-Remediation-Implementation-Plan.md.
Worktree <path>, branch lane/<WP-ID> from origin/main @ <sha>. Reserved migration: <NNNN_name.sql or "none">.
1. Read docs/17 §0, your WP row in §2, and the relevant shared-resource locks in §3.
2. For EACH source task ID in your WP (e.g. WS6-T01), open the appendix docs/audit/15-WSn-*.md, find the row
   in "## Remediation tasks", and read the whole row: Files, Required change, Acceptance criteria and Tests.
   Also read the finding rows it references (e.g. WS6-02) in "## Findings".
3. Before changing anything, RE-VERIFY every cited path:line against the current code (the cited line numbers are
   from bfa999f and may have moved). For SQL, find the LATEST `create or replace function` of every function you will
   change: `grep -n "create or replace function public.<name>" supabase/migrations/*.sql | tail -1`.
   If the code no longer matches the finding, STOP and report — do not guess.
4. Edit only files and SQL functions listed under "Owns" in your WP (or new files you create). Need anything else → stop and report.
5. TDD: write the failing tests listed in the source rows FIRST (SQL: new file supabase/tests/<wp-id>.test.mjs using
   createHarness()/scenario() from harness.mjs, explicit param casts, isolated fixtures, and the FULL migration chain
   0001..<your migration> — never an early subset). Report new test filenames to the integrator; do not edit
   supabase/tests/package.json. The integrator adds registrations before lane CI.
6. Implement. All new/changed SQL goes in your reserved migration file(s) (forward-only; never edit an applied migration).
   Follow §0.5 when a new enum value must be used. Start each file with a header comment:
   -- WP <id>; owns: <function list>; sources: <task ids>
7. Self-check: run git diff --check, confirm no hex/fontSize literals in new UI code, and confirm every changed money path has a test asserting exact paise.
8. Before pushing, run the current-main Codespace check as described in rules 11/12/16; then commit "<type>(<area>): <WP-ID> <summary>" plus the Co-authored-by trailer and push lane/<WP-ID>. Watch lane CI; fix all failures per run in one push. Do not dispatch hosted e2e-web on lanes or batches.
9. Report: source task IDs done, files and functions changed, tests added (names), lane run ID, deviations or blockers.
```

### 0.4 Integrator-owned files and duties
| Item | Rule |
|---|---|
| `.github/workflows/*` | Integrator only. On merge, add the WP migration to the explicit list in `deploy-backend.yml` (around line 397), with the `0019 is live` guard unchanged. |
| Migration renumbering | If WPs merge in a different order than §4, the integrator renames: `git mv` the file, then replace the filename string in `supabase/tests/*.mjs` and in `deploy-backend.yml`. This is a mechanical change; no SQL edits. |
| `supabase/tests/package.json` | Integrator only. Agents report new test filenames; the integrator adds registrations and resolves textual merge conflicts. |
| `app/src/i18n/en.ts`, `te.ts` | Agents may **append** keys under a `// <WP-ID>` comment block; the integrator resolves conflicts. |
| `docs/15`, `docs/16`, `docs/17` status tables | Integrator only |

### 0.5 Known gotchas (apply in every WP)
1. **Postgres enum values:** add new enum values (for example notification kinds) in the WP migration with `alter type … add value if not exists`, but **do not use the new value in the same migration/transaction**. If it must be used, split it into two migrations (`NNNNa_…_enum.sql`, `NNNNb_….sql`). This failed before on the proposal enum.
2. **PGlite:** cast every parameter (`$1::uuid`, `$2::int`, `$3::timestamptz`) and qualify columns in joins. Compare dates as `::text`.
3. **Jest:** never import Expo route files (`app/app/**`) in tests; put pure helpers in `app/src/features/**` model files.
4. **Feature flags:** read them with `useAppFeatureFlags().isOn('<key>')`. New flags are seeded `enabled=false` in the WP migration with `on conflict (key) do nothing`. Unknown keys evaluate to false.
5. **Money:** integer paise only. Assert exact paise in tests (e.g. `assert.equal(row.amount, 193760)`).
6. **Latest definitions:** older SQL test files load only early migrations (doc 15 §1.3). Never treat their pass as proof of current behavior; WP-T2 fixes this.

### 0.6 Source-row reconciliation decision
**2026-11-18 · X3:** WS8-T02 and WS6-T04 overlap. X3 owns `demo_settle_payment`, `_allocate_payout`, `_create_payout`, `_create_sports_payout`, `claim_due_transfers`, and the demo-project setting/seed. Demo settlement requires server-owned `raw_app_meta_data.demo_only` and `app_config.deployment.is_demo_project = true` (default false); do not add an `allow_in_production` override or depend on `app.environment`, which has no definition in this repository. Demo payout rows use the new `payout_status` value `demo`, but demo payments must not create `payout_transfers`; the allocators return without transfers for demo payouts, and transfer claims also exclude `pay_demo_` payment ids. Add the enum value in `0060a`; use it only in the function migration `0060b`.

**2026-11-18 · U3 / P1a:** Source rows are authoritative when they name files omitted from the original WP ownership lists. U3 therefore also owns the account-deletion migration/test and the `info`, location, customer-home, shared API/type/demo API, status, booking-detail, and `e2e/web-smoke.mjs` (`login-help-link` step only) files named by WS1-T07/T08/T09/T12/T14. The existing `addresses_own` policy in `0001_init.sql:1912-1913` is owner-scoped, so no address-RLS migration is needed; U3 uses migration `0067` for the deletion-request RPC. The SMS dashboard throttle is unavailable in this repo; use a 60-second client cooldown as the conservative documented “wait a minute” default, without claiming it matches the dashboard. Help uses the existing `support@quickserve.app` default. U3's booking-detail edit is sequenced after F3 and before U2; its E2E step follows T1 and U1. U3 may implement non-shared files in parallel, but cannot complete/merge until the sequenced file owners land. P1a keeps WS3-T05 ownership and completes its two RFQ schema-field screens before P1b's WS3-T04/T09 edits to the same RFQ files; P1b must rebase after P1a merges.

**2026-11-18 · Booking-detail migration order:** The §3.2 ownership sequence is F3 → U3 → U2 → B1, so B1 follows U3 `0067` and U2 `0068`; its current migration assignment is `0073` after the 2026-11-19 integrator reordering.

**2026-11-18 · O1/S1 shared sports functions:** O1's notification migration redefines sports payment/booking functions also changed by S1 and edits `sports_payments.test.mjs`. S1 must start from a main branch containing O1, preserve O1's notification inserts, and follow O1 → S1 for the shared functions.

**2026-11-18 · S1/D3 refund scope:** D3's non-refundable ₹5 fee applies to late customer cancellations. Venue cancellations retain the full customer-payment refund (service plus fee) specified by WS4-F17 and the 0058 `cancel_sports_booking` implementation; only a paid customer cancellation can create the retained-share payout.

**2026-11-18 · H2b/H3 E2E ownership:** WS2-T07 and WS2-T13 require steps in `e2e/all-services.mjs`, omitted from their original ownership cells. H2b owns `recurring-plan-skip-pause-resume-web`; H3 owns its home-service money steps. The file sequence is T1 → H2b → H3 → doc 14 Q-02. U3's `e2e/web-smoke.mjs` login-help step is a separate file.

**2026-11-18 · H2b SQL ownership:** WS2-T06, WS2-T09, and WS7-T02 require H2b to redefine `_queue_notification`, `queue_recurring_reminders`, and `_recurring_plan_payload`; these functions are added to the H2b ownership and §3.1 lock list.

**2026-11-18 · U2/WS1-T03 reconciliation:** WS2-T03's detailed source row names `public.preview_cancellation`; use that exact RPC name rather than the earlier WP-summary name. WS1-T03 requires the `booking-fc3-cancel-copy` E2E step; U2 owns only that step in `e2e/web-smoke.mjs`, sequenced after U3 and before doc 14 Q-02. The owner-approved U2 scope authorizes cancellation UI only for statuses permitted by the current server policy; do not add server cancellation states or alter refund rules.

**2026-11-19 · O2 demo-seed compatibility:** O2's `admin_review_status` defaults to `pending`, and `_provider_is_live` requires `approved`; the DEMO-only seed explicitly approves only its synthetic providers so seed bookings remain bookable. Production defaults and admin authorization remain unchanged. The full-chain seed test covers migrations through 0065. Creator/event activation is migration-managed (0024); the seed preserves pre-seed category state.

**2026-11-19 · Integrator migration reordering:** To merge the currently ready lanes without waiting for unrelated, unstarted work, the sequence after U3 is U2 `0068` → P1a `0069` → R1 `0070` → F1 `0071` → S1 `0072` → B1 `0073` → P1b `0074` → F2 `0075` → F4 `0076` → F5 `0077` → F6 `0078` → F7 `0079` → S2 `0080` → C2 `0081` → C1 `0082`; later migrations retain their listed order. The integrator owns the filename and test/deploy-registry renumbering.

**2026-11-19 · B1/WS6-T21 dependency reconciliation:** WS6-T21 explicitly depends on WS6-T03 and WS6-T11, both owned by F2. Assign WS6-T21 to F2 so its quote preview uses the finalized commissionable subtotal and snapshot rate. B1 remains ready after U2 for WS9-T09, WS2-T04, and WS9-T05; F2's QuoteView/client preview follows B1.

**2026-11-19 · B1 E2E ownership:** WS2-T04 and WS9-T09 require assertions in the existing `archetype-fixed-package-book-mocked-payment` step in `e2e/all-services.mjs`. B1 owns only those fixed-package/price assertions; sequence this file T1 → H2b → B1 → H3 → doc 14 Q-02 so B1 can proceed before H3 without concurrent edits.

**2026-11-19 · B1 sample fixture reconciliation:** Doc 16 §3.2 and this plan's §8 require the exact ₹999 + ₹29 = ₹1,028 sample. The CI DEMO house-cleaning package, preseeded booking/quote/item/payment schedule, SQL assertion, and E2E Pay assertion now use 99900 + 2900 = 102800 paise; other archetype prices are unchanged. This is demo/test data only and does not change production prices.

**2026-11-19 · F2/H2a recurring function lock:** WS6-T03 explicitly requires `_create_fixed_occurrence` to set the commissionable subtotal. H2a owns its latest definition in `0065_h2a_recurring_correctness.sql`; F2 owns the follow-up commission change after H2a, and doc 12 D1 must follow F2. WS6-T11 also assigns `_finalize_session_completion` to F2; latest definition is `0043_commission_config.sql:148`. These are separate from owner decision D1 (commission rates) in doc 15 §7.

**2026-11-19 · WS5 creator delivery ownership:** C2 owns WS5-T02/T07 deliver-by and overdue cancel/dispute behavior plus WS5-T11 contact screening; C1 owns WS5-T01/T14/T04/T05 acceptance-window, payment-default and delivery behavior. D2's 72-hour acceptance window belongs to C1; the required deliver-by date, default one revision and overdue customer cancellation belong to C2. For `creator_delivery_deadline` OFF, follow WS5-T07: hide the compose field and ignore a newly supplied deadline; when ON, require and validate it. Any deadline already stored on an existing booking remains readable and its overdue refund path remains available if the flag is later disabled. C2 may redefine `send_proposal` after F2 and `accept_proposal` after F2/F7; it may redefine `cancel_booking` and only the delivery-deadline branch of `_cancel_booking_by_policy` after F4, and `submit_delivery` for contact screening before C1's later delivery-state/reminder changes. C1 extends `_cancel_booking_by_policy` for payment-default after C2 and extends `submit_delivery` after C2; completion/payment-default functions remain C1 after F2/F4. Their shared `app/app/booking/[id].tsx` edits are sequential C2 → C1.

**2026-11-19 · F7 platform-fee and payout identity scope:** F7 owns the proposal fee config change in `accept_proposal` after F2 and before C2. The recurring-plan 2,900-paise snapshot remains in the H2a/doc 12 D1 lock and is not changed by F7. Keep `business_payout_identity` default-OFF; do not enable business submissions until the owner selects supported legal-entity types and required KYC/PAN fields. The current form’s generic Business choice is not enough to infer a gateway `business_type`; tax placeholders remain zero and no tax invoices/live payments before D4 review.

**2026-11-19 · F5 / WS6-T14 G2 boundary:** G2 F5 delivers the append-only webhook event log and `payment_captured` journal events from the home/session/pack recorders. Refund, transfer and reversal journal writers are explicitly deferred to G3 under the F5 catalogue note; they remain residual work and WS6-T14's full “every money movement” acceptance must not be reported complete until that G3 work lands.

**2026-11-19 · Owner-directed migration sequencing:** The owner requested integrating P1a, R1, F1, and S1 ahead of the original WP order. This authorizes code/migration integration only; G1 exit criteria remain open and G2/live payments stay prohibited until the documented release gates pass. No live Razorpay keys, payouts, or production payment/data operations are authorized.

**2026-11-18 · T2:** WS2-T12 explicitly specifies a new `ws2_lifecycle_latest.test.mjs` full-chain suite. T2 owns that suite, its package registration, and the shared RP-27 test fixture correction described below; it does not change unrelated existing test expectations that encode known later-migration behavior (including WS2-31). CI runs for X3, F3, and T2 all failed the existing RP-27 recurring-plan fixture with `outside_working_hours`. T2 must make that test-only fixture deterministic without changing production code or weakening the RP-27 assertions. U3 independently carried the same test-only fixture correction in its branch; T2 owns the migration-free fix so it can merge before X3/F3, and those branches must merge main and rerun afterward. The original WP table's reference to early-loader suites is superseded by this source-row-aligned scope.

**2026-11-18 · U1:** WS1-T01 explicitly requires a provider-profile E2E step, omitted from the original U1 ownership cell. U1 owns that step in `e2e/web-smoke.mjs`; because T1 also edits that file, T1 merges first and U1 then merges/revalidates against the resulting main.

**2026-11-18 · X1/Q-00:** Main E2E run 44395541860 reported `DEMO_PROJECT` and `ADMIN_E2E_PHONE` as empty. X1's security migration is merged, but the admin E2E assertion is blocked until the owner sets repository variable `DEMO_PROJECT=1` and secret `ADMIN_E2E_PHONE` to a dedicated demo test phone included in that project's SMS test-OTP list; the old public admin phone must be removed from production `sms_test_otp`. Do not hard-code a phone, bypass the demo guard, or report the blocked step as passed.

**2026-11-18 · Owner (X1 follow-up):** repo variable `DEMO_PROJECT=1` and secret `ADMIN_E2E_PHONE` are set for a dedicated automation-only test account. The Supabase `sms_test_otp` and admin test-account updates completed through one-time workflows `44452693916` and `44453087353`; do not hardcode the test phone in app code or demo seeds. Revalidate E2E after the setup.

**2026-11-18 · Owner decisions on owner-blocked items:**
- **X2: unblocked with placeholders.** Use Supabase test OTPs (`sms_test_otp`) for all logins for now. Do not integrate MSG91 yet: add only the configuration placeholders (`SMS_PROVIDER`, `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`, `MSG91_SENDER_ID`) as empty or unset settings, documented with no real values, and leave the code path inert while they are empty. The same applies to the Expo `projectId` and FCM settings (placeholders only; push delivery on devices stays unverified). **F8 is no longer blocked by X2:** it proceeds in Razorpay **test mode** with the existing test keys.
- **B3: deferred by the owner** (the CA review happens later). Keep it out of the current waves. Tax fields stay 0 or placeholder-only per D4.
- **U4: deferred by the owner** until the rebrand. Keep the "Seva Coins" naming, and do not start the U4 copy sweep in the current waves.

---

## 1. Release gates

| Gate | Meaning | Exit criteria |
|---|---|---|
| **G1 — Closed pilot** | Real users, **Razorpay test keys only**, demo payments disabled, real SMS OTP | All G1 WPs merged; E2E green; doc 15 P0-01, 02, 04 and 09 closed |
| **G2 — Live payments** | Razorpay live keys and real payouts | All G2 WPs merged; all 13 P0s closed; WP-F8 Razorpay test-mode lane green; daily reconciliation running; receipts and provider statements live; CA review done (D4); separate production project re-decided by the owner (D5, deferred) |
| **G3 — Scaling** | Open sign-ups across cities | G3 WPs merged; concurrency proof (WP-S3); Telugu provider surfaces |
| **Later** | Improvements | — |

---

## 2. Work package catalogue

Legend:
- **Mig** = reserved migration number. Renumber per §0.4 if the merge order changes.
- **🔒** = money/auth/concurrency WP that needs a lower-model review.
- **Sources** = task rows in the appendices that hold the full specification.
- **Cx** = complexity.

### Gate G1 — closed pilot

| WP | Title | Sources (full spec) | Owns: files / SQL functions | Mig | Depends | Cx |
|---|---|---|---|---|---|---|
| **X1** 🔒 | Close the public admin backdoor; require a confirmed phone for the admin allowlist; E2E admin via a secret | WS8-T01 (+WS8-04) | admin allowlist function(s) from `0041`; `e2e/web-smoke.mjs` admin login lines only | 0059 | — | S |
| **X2** | SMS OTP via **MSG91** (D5) + push readiness (Expo projectId, FCM). Separate prod Supabase project + deploy approval gate is **deferred by the owner** until testing is complete; re-decide before G2. | WS8-T10, WS7-17, WS7-T14 | **Integrator + owner** (secrets, workflows, `app.json`/`eas.json`) | — | D5 | M |
| **X3** 🔒 | Make demo settlement unforgeable; exclude demo money from payouts | WS8-T02, WS6-T04 | `demo_settle_payment`, `_allocate_payout`, `_create_payout`, `_create_sports_payout`, `claim_due_transfers`; demo-project setting/seed | 0060a/b | — | M |
| **H1** 🔒 | Close provider-cancellation abuse; hide the customer address before plan acceptance and after decline | WS2-T01, WS2-T08 | `provider_cancel_booking`; recurring plan provider read RPC/policy | 0061 | — | S |
| **F3** 🔒 | Coin fixes: approval independent of the redemption switch; no double subtraction in QuoteView; single restore; preview shows "already redeemed"; earning never blocks close | WS9-T01, T02, T03, T04, T16 | `_apply_quote_coins`, `_restore_coins_for_terminal_booking`, `get_coin_redemption_preview`, coin earn on close; `app/app/booking/[id].tsx` (coins default only); `app/src/components/QuoteView.tsx` (coin due only) | 0062 | — | M |
| **O1** 🔒 | Notifications: notify the right party on cancellation; harden sports notification inserts | WS7-T01, T08 | `_on_booking_event_notify`; notification-only changes to `request_sports_slot`, `book_sports_slot`, `decide_sports_booking`, `_refund_unmatched_sports_capture`, `record_sports_payment_paid`, `cancel_sports_booking`, `expire_sports_requests` | 0063 | — | S |
| **O2** 🔒 | Provider verification: separate admin approval from payout KYC; admin document review screen; shop verification rules | WS7-T03, T04, WS3-T11 | provider status fields/RPCs; `app/app/admin/people.tsx`, new `app/app/admin/documents.tsx`; `app/app/admin/shops.tsx`; DEMO-only provider approval in `supabase/seed-all-services.sql` and `supabase/tests/all_services_seed.test.mjs` | 0064 | — | M |
| **H2a** 🔒 | Recurring correctness (SQL): accepted plan ⇒ paid visits confirmed; lock prices at acceptance; plan edge cases | WS2-T02, T05, T10 | `respond_recurring_plan`, occurrence generator and prepare functions (latest `0057`) | 0065 | — | M |
| **H2b** | Recurring UX: payment-due notice + per-visit Pay; web-safe confirmations; plan request shows earnings/area; date-time pickers; calendar opens the visit; recurring deep links | WS2-T06, T07, T09, T15, WS7-T02 | `_queue_notification`, `queue_recurring_reminders`, `_recurring_plan_payload`; `app/app/recurring/**`, `app/src/features/recurring/**`, `app/app/merchant-calendar.tsx`, push routing for recurring kinds, `e2e/all-services.mjs` (`recurring-plan-skip-pause-resume-web` step only) | 0066 (enum split if needed) | H2a | M |
| **U2** | Truthful home-service cancel: server refund preview RPC + policy-driven copy + every allowed cancel state | WS1-T03, WS2-T03 | `public.preview_cancellation` (calls `_cancellation_outcome` read-only); cancel UI in `app/app/booking/[id].tsx`; `e2e/web-smoke.mjs` (`booking-fc3-cancel-copy` step only) | 0068 | F3, U3 (same file) | M |
| **B1** | Server-sourced booking prices; fixed Pay includes the platform fee; show every quote line kind | WS9-T09, WS2-T04, WS9-T05 | `app/app/book/**`, `app/app/book-fixed/**`, `app/src/features/booking/packages/PackageBookingScreen.tsx`, `app/src/lib/money.ts`, `app/src/components/QuoteView.tsx` (line kinds only), `PriceRow.tsx`; booking-price preview RPCs; `e2e/all-services.mjs` (fixed-package price assertions only) | 0073 | F3, U2 (shared files) | M |
| **U1** | Booking entry and "Book again" routed by archetype | WS1-T01, WS1-T02, WS2-T14 | `app/app/provider/[id].tsx`, `app/src/features/activity/**` (book-again only), `e2e/web-smoke.mjs` (provider-profile E2E step only) | — | T1 (shared E2E file; merge T1 first) | S |
| **U3** 🔒 | Account basics: truthful deletion; manage saved addresses; contextual location permission; skip the role screen for returning users; plain OTP errors; public help path; status copy; respect the AI flag on all entry points | WS1-T06…T12, T14 | `components/AccountScreen.tsx`, `components/AddressEditor.tsx`, `app/app/location.tsx`, `app/app/info/[topic].tsx`, `app/app/(customer)/index.tsx` (location prompt only), `app/src/lib/locationContext.tsx`, `app/app/(auth)/**`, `app/app/assistant.tsx` (flag gate only), `app/app/category/[slug].tsx` (AI entry only), `app/src/lib/supabaseApi.ts`, `app/src/lib/apiTypes.ts`, `app/src/lib/demo/demoApi.ts`, `app/src/components/status.tsx`, `app/app/booking/[id].tsx` (status/help copy only), `e2e/web-smoke.mjs` (`login-help-link` step only), new `0067_u3_account_deletion.sql` and `supabase/tests/account_deletion.test.mjs` | 0067 | F3 (booking detail), T1 and U1 (E2E file sequence) | M |
| **P1a** | Shops: verified shops stay live on non-identity edits; unit + price date on prices; schema-driven spec fields; better product search; drop the WhatsApp promise; product removal | WS3-T01, T02, T05, T06, T08, T12 | `save_shop`, product save/search RPCs; `app/app/merchant-shop.tsx`, `app/app/shop/**`, `app/app/product/**`, `app/app/products.tsx`, `app/app/rfq/new.tsx` and `app/app/rfq/merchant/[id].tsx` (WS3-T05 schema fields only), `app/src/features/shops/**` | 0069 | — | M |
| **P1b** | RFQ: honest comparison; GST clarity + earnings preview + "no commission"; cancel RFQ + outcomes; pack rounding; single quote-math source with tests; form basics | WS3-T03, T04, T07, T09, T10, T13 | RFQ RPCs incl. `send_supplier_quote_for_business`; `app/app/rfq/**`, `app/app/merchant-rfqs.tsx`, `app/src/features/rfq/**` | 0074 | P1a | M |
| **R1** 🔒 | Reliability: idempotency keys for booking and request creation; EXECUTE privilege hygiene + regression guard; storage bucket limits; global AI budget; minor hardening | WS8-T05, T06, T07, T12, T13 | create-booking/request RPCs (idempotency param only); grants; bucket policies; AI usage config | 0070 | — | M |
| **T1** | E2E green (same as doc 14 Q-00): discovery, category, sports, assistant-limit steps | WS1-T04, T05, WS4-T04 | `e2e/web-smoke.mjs`, `e2e/all-services.mjs` | — | X1 (same file; merge X1 first) | S |
| **T2** | Add lifecycle coverage on the latest definitions | WS2-T12 | new `supabase/tests/ws2_lifecycle_latest.test.mjs`; `supabase/tests/package.json`; `supabase/tests/recurring_plans.test.mjs` (RP-27 fixture only) | — | — | M |

### Gate G2 — live payments

| WP | Title | Sources | Owns | Mig | Depends | Cx |
|---|---|---|---|---|---|---|
| **F1** 🔒 | Payment recorders: race-safe home-service recorders; never overwrite a captured payment id; refund extra/unrecordable captures on a new row; stop acknowledging rejected captures | WS6-T01, T02, T05, WS8-T03, T04 | `record_payment_paid` and the home/session/pack recorders; `supabase/functions/razorpay-webhook/**`, `verify-payment/**` | 0071 | X3 | L |
| **F2** 🔒 | Commission correctness: `subtotal_commissionable`; commission on fixed, add-ons and proposals per owner D1; rate snapshot; restrict quote item kinds; server quote preview matches payout | WS6-T00 (decision), T03, T11, T12, T21, WS5-T03 | `send_quote`, `send_fixed_addons`, `create_fixed_booking`, `_create_fixed_occurrence` (after H2a), `accept_proposal`, `_finalize_session_completion`, completion/settlement functions calling `_create_payout`; `get_quote_settlement_preview`; `app/src/lib/money.ts`, `app/app/quote/[bookingId].tsx`, `app/src/components/QuoteView.tsx` | 0075 | **owner D1**, F1, B1 (QuoteView), H2a | L |
| **F4** 🔒 | Refund & dispute engine: coins in cancellation/dispute refunds; refund stuck states; dispute edge cases; dispute window | WS6-T06, T08, T10, T17 | `_cancellation_outcome`, cancel RPCs, `resolve_dispute`, refund retry/terminal handling | 0076 | F3, F1 | M |
| **F6** 🔒 | Reconciliation & chargebacks: transfer `processing` reconciliation; chargeback + refund webhooks; daily reconciliation; payout/refund alert | WS6-T07, T15, T16, WS8-T09, T11 | new reconciliation function + scheduled job; webhook dispute handlers (new code paths in `razorpay-webhook`) | 0078 | F1, F5 | L |
| **F5** 🔒 | Append-only webhook log and capture journal (G2); refund/transfer/reversal journal writers may finish in G3 | WS6-T14 | append-only webhook log; `payment_captured` journal events from home/session/pack recorders; remaining journal writers deferred explicitly to G3 | 0077 | F1 | L |
| **F7** | Fees & tax config: admin-configurable platform fees; tax placeholders (0 until review); server-side billing rules incl. bill photo; business/GST identity on the payout form (default-OFF; gateway entity/KYC mapping owner-blocked) | WS6-T13, T18, WS9-T12, WS9-T11, WS7-T10 | `_platform_fee_config`, `admin_get_platform_fees`, `admin_set_platform_fees`; `create_booking`, `_create_session_booking`, `purchase_session_pack`, `accept_proposal` (after F2; before C2), `send_quote` validation (after F2); `provider-payout-account/**`; `features/providerOnboarding/PayoutSection.tsx` | 0079 | F2, **D4** for tax wording | M |
| **F8** 🔒 | Payment test lane: Deno signature/refund tests; Razorpay **test-mode** E2E lane (Orders API); company-controlled checkout host; checkout trust copy | WS6-T19, T20, T22, WS9-T15 | `supabase/functions/**/*_test.ts`, new workflow (integrator), checkout host config | — | F1, F6, S2, H3; X2 does not block TEST mode | L |
| **S1** 🔒 | Sports money: app calls `create-payment` with `booking_id`; correct status, amount and deadline in lists; venue retained-share payout; blocks respect holds; close the legacy/overload bypass; per-slot capacity; late capture never reduces the venue payout | WS4-T01, T02, T03, T06, T10, T11, WS6-T09 | `app/src/features/sports/api.ts`, `docs/12` §6.5 only; `list_my_customer_sports_bookings`, `_create_sports_payout`, `request_sports_slot`, `book_sports_slot`, `cancel_sports_booking`, `record_sports_payment_paid`, block/hold functions | 0072 | **D3** | M |
| **S2** 🔒 | Sports ops & UX: readable/cancellable bookings with `sports` off; refund preview + safe cancel; operator booking list; edit/delete price rules; hoarding limit; payment-failure notice; configurable windows; form fixes | WS4-T05, WS8-T08, WS4-T07, T08, T09, T13, T16, T17, T19 | `app/app/sports/**`, `app/app/sports-*/**`, `app/src/features/sports/**`, sports read/config RPCs; `app/src/features/activity/segments/SportsSegment.tsx` (after R-04; parallel with B2's non-sports receipt segment); sports rules in `app/app/admin/rules.tsx`/`adminRulesApi.ts` after doc 12 H1; `app/app/admin/sports.tsx` reason form; sports demo payment handling in `app/src/lib/payments.tsx`; `razorpay-webhook/index.ts` sports payment-failed case after F6 | 0080 | S1, doc 12 H1, F6 | M |
| **C2** 🔒 | Creator scope clarity and delivery deadline: overdue delivery dispute/cancel; deliver-by; agreed revisions; structured brief; package carried into request; compose shows the brief; contact screening; Q&A + cancel request; fee shown before accept; labels | WS5-T02, T06…T12, T15, T16 | `create_service_request`, `bookings.delivery_due_at`, `proposals.delivery_due_at`, `send_proposal`/proposal create, `accept_proposal` (after F2/F7), `cancel_booking` and delivery-deadline branch of `_cancel_booking_by_policy` (after F4; before C1), `dispute_booking`, `submit_delivery` contact screening (before C1); `app/app/request/**`, `app/app/proposal/compose/**`, `app/app/proposal/[id].tsx`, `app/src/features/bookingDetail/CancelSection.tsx` (after R-01), `features/proposals/**`; seed `creator_delivery_deadline=false`; OFF hides/ignores new deadline input, ON requires a valid date, and existing stored deadlines remain money-safe | 0081 | F2, F4, F7, D2 | L |
| **C1** 🔒 | Creator money safety: unpaid balance after delivery; acceptance window from config + reminders; show delivered work; correct post-delivery copy | WS5-T01, T14, T04, T05 | `submit_delivery` (after C2 screening), `request_completion`, `accept_delivery`, `request_revision`, `auto_confirm_completions`, `_finalize_completion` (after F2); `cancel_proposal_payment_default` and `_cancel_booking_by_policy` (after C2); `app/src/lib/supabaseApi.ts`, `app/src/lib/apiTypes.ts`, `app/src/lib/types.ts`, `app/src/lib/demo/demoApi.ts`, `supabase/functions/schedule-reminders/index.ts`, `app/app/proposal-delivery/**`, `app/app/proposal/[id].tsx`, `app/src/features/bookingDetail/DeliverySection.tsx` (after R-01) | 0082 | **D2**, B1, F2, F4, C2 | M |
| **H3** | Home stuck states + no-show actions; E2E for home-service money paths | WS2-T11, T13 | timeout/no-show functions + scheduled job; provider job actions UI (`merchant-job/[id].tsx`, `app/src/features/bookingDetail/ActionsRow.tsx` after R-01); `e2e/all-services.mjs` (WS2-T13 steps only) | 0083 | F4, T1, H2b (shared E2E file) | L |
| **B2** | Customer payment receipt (non-tax) | WS9-T06 | new receipt table/RPC/screen; non-sports activity receipt segment (after R-04) and `app/src/features/bookingDetail/PaymentsSection.tsx` (after R-01) | 0084 | F1, F5 | L |
| **B4** | Provider earnings statement + venue payouts visible + honest failed-payout copy | WS9-T08, WS7-T05 | `app/app/(provider)/earnings.tsx`, statement RPC | 0085 | F2, S1 | M |
| **B6** | Payments list readability + money notifications (payment received, refund done, payout sent, verification, suspension) | WS9-T14, WS7-T07 | `notifications_kind_check` text-constraint extension; `_on_booking_event_notify` (after O1); `record_payment_paid` and home/session/pack recorders (after F1/F5); `complete_refund` (after F4); `complete_transfer`, `fail_transfer`, `record_payout_gateway_event`; `admin_review_document`, `admin_set_provider_review`, `set_provider_suspended` (notification-only extensions after O2); `app/src/features/bookingDetail/PaymentsSection.tsx` (after B2) | 0088a/b | F1, F4, F5, O1, O2, B2, B4 | L |
| **O3** | Admin money visibility + actions (retry payout/refund, audit-logged) + audit-log viewer | WS7-T06, T15 | `app/app/admin/booking/[id].tsx`, new admin RPCs | 0086 | F1, F4 | L |
| **B3** | Tax invoices (service, platform fee, commission) | WS9-T07 | new invoice tables/numbering | later | **D4 professional review** | L |

### Gate G3 — scaling, and Later

| WP | Title | Sources | Gate | Depends | Cx |
|---|---|---|---|---|---|
| **S3** 🔒 | Participant pricing; protect future bookings from venue changes; sports dispute + admin tooling; **prove double-booking safety under real Postgres concurrency** (not PGlite) | WS4-T12, T14, T15, T18 | G3 | S2 | L |
| **C3** | Remote mode for creator categories | WS5-T13 | G3 | C2 | L |
| **O4** | Staff by phone; review reply; dashboard wording and grouping | WS7-T09, T11, T12 | G3 (T09 earlier if staff are used in pilot) | — | M |
| **O5** | Telugu for provider surfaces and notifications | WS7-T13 | G3 | O4, B6 | L |
| **B5** | Coin wallet comprehension + coins admin and accounting | WS9-T10, T13 | Later | F3 | M |
| **U4** | Rebrand to **Nearo**: single brand constant, then a copy sweep | WS1-T13, WS4-T20 | per **D6** (touches many files; run when no other UI lane is open) | all UI WPs of the current wave merged | M |
| **U5** | Top-rated = bookable pros near me | WS1-T15 | Later | — | S |

**Coverage check:** all 146 source tasks (WS1 15, WS2 15, WS3 13, WS4 20, WS5 16, WS6 23, WS7 15, WS8 13, WS9 16) are assigned to exactly one WP above.

---

## 3. Shared-resource ownership (prevents parallel conflicts)

### 3.1 SQL function locks (only the listed WP may redefine them; later WPs wait)
| Function(s) | Owner order |
|---|---|
| `provider_cancel_booking` | H1 |
| `demo_settle_payment`, `_allocate_payout` | X3 |
| `_create_payout` | X3 → F2 |
| `_finalize_session_completion` | F2 (WS6-T11 rate snapshot) |
| `_create_sports_payout` | X3 → S1 → S2 → S3 |
| `claim_due_transfers` | X3 → (F6 reads only) |
| `request_sports_slot`, `book_sports_slot`, `record_sports_payment_paid`, `cancel_sports_booking` | O1 → S1 (preserve O1 notification inserts) |
| `_apply_quote_coins`, `_restore_coins_for_terminal_booking`, `get_coin_redemption_preview` | F3 |
| `_cancellation_outcome`, home-service cancel RPCs, `resolve_dispute` | F4; later creator-specific changes by C1/C2 follow F4 (U2 only *calls* `_cancellation_outcome`) |
| `record_payment_paid` + home/session/pack recorders | F1 → F5 (insert journal rows) → B6 (notifications) |
| `_on_booking_event_notify` | O1 → B6 (payment/dispute notification branches only; preserve O1 cancellation/sports inserts) |
| `complete_refund` | F4 → B6 (refund notification only) |
| `complete_transfer`, `fail_transfer`, `record_payout_gateway_event` | B6 (notification inserts only; preserve transfer/payout status and retry logic) |
| `admin_review_document`, `admin_set_provider_review`, `set_provider_suspended` | O2 → B6 (document/verification/suspension notification only) |
| `send_quote`, `send_fixed_addons`, `create_fixed_booking` | F2 → F7 (`send_quote` validation only) |
| `_finalize_completion`, `auto_confirm_completions` | F2 → C1 (proposal commission then delivery acceptance/release window) |
| `accept_proposal` | F2 → F7 (proposal platform-fee config) → C2 (delivery-date copy) |
| `create_service_request` | C2 (creator brief/contact screening) |
| `send_proposal` | F2 → C2 (deadline/contact screening after the commission snapshot) |
| `cancel_proposal_payment_default` | F4 → C1 (proposal payment-default policy) |
| `_cancel_booking_by_policy` | F4 → C2 (overdue `delivery_pending`/`provider_fault` path) → C1 (proposal payment-default policy) |
| `cancel_booking` | F4 → C2 (delivery deadline) |
| `dispute_booking` | C2 (delivery deadline) |
| `submit_delivery` | C2 (WS5-T11 contact screening) → C1 (delivery state/reminders) |
| `request_completion`, `accept_delivery`, `request_revision` | C1; C1 also owns delivery API/UI and reminders |
| `_sports_rule`, `admin_set_rules` sports allow-list | doc 12 H1 → S2 (sports keys only) |
| `respond_recurring_plan`, recurring generator/prepare except `_create_fixed_occurrence` | H2a → doc 12 **D1** (recurring billing) |
| `_create_fixed_occurrence` | H2a → F2 → doc 12 **D1** (recurring billing) |
| `_queue_notification`, `queue_recurring_reminders`, `_recurring_plan_payload` | H2b |
| sports `list_my_customer_sports_bookings`, `_create_sports_payout`, `record_sports_payment`, holds/blocks | S1 → S2 → S3 |
| `save_shop`, product RPCs | P1a |
| RFQ RPCs | P1b |

### 3.2 Hot app files (sequential edits)
| File | Order |
|---|---|
| `app/app/booking/[id].tsx` | F3 → U3 (status/help copy only) → U2 → B1 → R-01 (thin route wrapper; feature edits move to sections below) |
| `app/src/features/bookingDetail/StatusHeader.tsx` | R-01 → BD-01 (after C-07/U3) |
| `app/src/features/bookingDetail/CancelSection.tsx` | R-01 → C2 |
| `app/src/features/bookingDetail/DeliverySection.tsx` | R-01 → C1 (component work may parallelize; shared SQL functions remain C2 → C1 per §3.1) |
| `app/src/features/bookingDetail/PaymentsSection.tsx` | R-01 → B2 → B6 |
| `app/src/features/bookingDetail/ActionsRow.tsx` | R-01 → H3 |
| `app/app/proposal/[id].tsx` | C2 (delivery date) → C1 (delivery status/copy) |
| `app/src/lib/supabaseApi.ts`, `app/src/lib/apiTypes.ts`, `app/src/lib/demo/demoApi.ts` | C1 → B-01 |
| `app/app/book/[providerServiceId].tsx` | B1 → doc 14 R-03 |
| `app/app/book-fixed/[providerServiceId].tsx` | B1 → doc 14 HS-02 |
| `app/src/components/QuoteView.tsx` | F3 → B1 (line kinds) → F2 (server settlement preview) |
| `app/app/quote/[bookingId].tsx` | F2 |
| `app/src/lib/money.ts` | B1 → F2 |
| `app/app/provider/[id].tsx` | U1 → (doc 14 R-02) |
| `app/app/(customer)/index.tsx` (U3 location prompt only) | U3 → (doc 14 H-01) |
| `app/app/rfq/new.tsx`, `app/app/rfq/merchant/[id].tsx` (schema fields) | P1a → P1b |
| `app/src/features/activity/**` | U1 → doc 14 R-04 (segment split) → S2 (`SportsSegment`) ∥ B2 (non-sports receipt segment) |
| `app/app/admin/rules.tsx`, `app/src/lib/adminRulesApi.ts` | doc 12 H1 → S2 (sports rule fields only) |
| `app/app/admin/sports.tsx` | S2 (WS4-T19 reason map) → S3 (WS4-T15 admin tooling) |
| `app/src/lib/payments.tsx` | S2 (sports demo payment route) → F8 (checkout trust/host) |
| `app/app/(provider)/earnings.tsx` | B4 |
| `app/src/features/sports/**`, `app/app/sports*/**` | S1 → S2 → S3 |
| `supabase/functions/razorpay-webhook/**` | F1 → F5 → F6 → S2 (sports payment-failed route) → F8 |
| `supabase/functions/verify-payment/**` | F1 → F6 → F8 |
| `e2e/web-smoke.mjs` | X1 → T1 → doc 14 Q-01 screenshot helper → U1 → U3 → U2 → doc 14 Q-02 |
| `e2e/all-services.mjs` | T1 → H2b → B1 → H3 → doc 14 Q-02 |

---

## 4. Waves, dependency graph and merge order

### 4.1 Waves (launch every task in a wave in ONE response, as background agents)
| Wave | Starts | WPs (parallel) | Agents |
|---|---|---|---|
| **A** | Owner approval | X1, X3, H1, F3, O1, O2, H2a, U1, U3, P1a, R1, T2 (+ X2 by integrator/owner) | **12** |
| **A′** | Its blocker merged | T1 (after X1), H2b (after H2a), U2 (after F3), B1 (after U2), P1b (after P1a) | 5 |
| **B** | Owner-directed early integration of F1/S1 (owner D1/D3 answered); G2 remains closed until G1 exit | F1, S1, F2, F4, F5, S2; C2 after F2+F4; C1 after C2+F2+F4+B1+D2 | up to 6 |
| **B′** | Blockers merged | F6, F7, B2, B4, H3 | up to 5 |
| **C** | Blockers merged | F6, F7, F8, B2, O3, then B6 | up to 6 |
| **D** | G2 exit | S3, C3, O4, O5, B5, U4, U5, B3 (after D4) | up to 8 |

### 4.2 Graph
```
X1 ─► T1 ─► U1 ───────────────────────► H3 ─► F8
X3 ─► F1 ─┬─► F2 ─┬─► F7          F4 ─► H3
          │       ├─► C2 ─► C3
          │       └─► B4
          ├─► F4 ─► O3
          ├─► F5 ─► F6 ; F5 ─► B2 ─► B6 (+O1)
          └─► F8 (+X2)
F3 ─► U2 ─► B1 ─► F2 (WS6-T21 after T03/T11) ;  H2a ─► F2 ;  F3 ─► F4 ;  F3 ─► B5 ;  F3 ─► U3 (booking detail)
F2 + F4 ─► C2 (WS5-T02/T07; 0081) ─► C1 (WS5-T01/T14/T04/T05; 0082)
T1 ─► U1 ─► U3 (E2E file sequence)
H2a ─► H2b ;  H2a ─► F2 ─► doc12 D1
S1 ─► S2 ─► S3 ;  S1 ─► B4
P1a ─► P1b
H1, O1, O2, P1a, R1, T2 : independent
Decisions: D1 ─► F2 · D2 ─► C1, C2 · D3 ─► S1 · D4 ─► F7(tax copy), B3 · D5 ─► X2 · D6 ─► U4
```

### 4.3 Merge order (migrations must merge in numeric order; renumber per §0.4 when needed)
`0059 X1 → 0060a enum → 0060b X3 → 0061 H1 → 0062 F3 → 0063 O1 → 0064 O2 → 0065 H2a → 0066 H2b → 0067 U3 → 0068 U2 → 0069 P1a → 0070 R1 → 0071 F1 → 0072 S1 → 0073 B1 → 0074 P1b → 0075 F2 → 0076 F4 → 0077 F5 → 0078 F6 → 0079 F7 → 0080 S2 → 0081 C2 → 0082 C1 → 0083 H3 → 0084 B2 → 0085 B4 → 0086 O3 → 0087 doc 14 B-01 → 0088a/b B6`.

**Owner migration reorder (2026-11-19):** O3 moves from 0087 to 0086; doc 14 B-01 moves from 0088 to 0087; B6 is reserved for 0088a/b. B6 must not block B-01.

WPs without migrations (T1, T2, X2, F8) merge whenever they are green; U1 merges after T1 because both own `e2e/web-smoke.mjs`.

**Doc 12 D1 reservation of `0059` is released** by this plan. D1 takes the next free number when it starts, after H2a has merged.

---

## 5. Acceptance criteria per gate (in addition to each source row's criteria)

**G1 exit:**
1. E2E `main` green with 0 failed steps.
2. A new SQL test proves that a non-confirmed phone and the old E2E phone are **not** admins on the production config path (X1).
3. A SQL test proves that a user who sets their own metadata `demo_only=true` cannot settle a payment, and that demo payments never reach `claim_due_transfers` (X3).
4. SQL tests prove that a provider cannot cancel a paid or in-progress booking with `customer_payment_default`, and that the address is null in the provider plan view before acceptance (H1).
5. Quote approval succeeds with `coins_redemption` off, and coins are restored exactly once (F3).
6. Accepting a plan leaves paid visits confirmed after 15 minutes (H2a).
7. Every amount shown before payment equals the server amount (B1 Jest tests + E2E assertion on the fixed package Pay label = ₹1,028.00 for a ₹999 package).
8. Real SMS OTP verified on a device (X2; manual, recorded in §7).

**G2 exit:**
1. All 13 doc 15 P0s have a closing test.
2. Exact-paise tests for every doc 16 §3 sample: inspect 193760, fixed 82218 (if D1 = 15%), recurring 54336, sports 105840, late-cancel 52920, proposal 1811200 (if D1 = 8%).
3. Concurrent verify + webhook test: one payment row and no refund (F1).
4. F8 test-mode lane green for order → capture → refund → payout.
5. Daily reconciliation job produces an empty mismatch report on the test lane (F6).
6. A receipt is generated for every payment and refund (B2).
7. A provider statement matches the payout rows (B4).
8. The admin can retry a payout and the audit log shows it (O3).

---

## 6. Sequencing with docs 12 and 14

| Existing plan item | Decision |
|---|---|
| doc 12 **F2** (wire sports UI to real payments) | **Superseded** by S1 + S2 |
| doc 12 **G2** (venue calendar/earnings) | Earnings → B4; calendar stays in doc 12, after S2 |
| doc 12 **D1/D2** (recurring billing) | After H2a, F1, and F2. Re-check its spec against H2a's price snapshot. |
| doc 12 **T1/T2** | Merge into T1/T2 here |
| doc 14 **Q-00** | **= T1 here** (one owner) |
| doc 14 **Phase 1** (T-01 tokens, C-07, I-01) | May run in parallel with Wave A: no shared files |
| doc 14 **R-01…R-07 file splits** | **Wait** until the hot-file owners in §3.2 have merged (booking detail: after H3; provider profile: after U1; activity: after B2; sports manage: after S2; dashboard: after O4 or immediately if O4 is deferred) |
| doc 14 **B-01 / G-01** (guest browse) | After X1 and R1; both use the next free migration number |

---

## 7. Status board (integrator updates after every merge)

| WP | Gate | Status | Agent | Lane run | Migration | Merged SHA |
|---|---|---|---|---|---|---|
| X1 | G1 | merged; owner test env/OTP/admin setup completed; returning-role admin route fixed in 17461fd; main E2E 44457835276 passed with admin step green | b49bc035-5681-4314-af7a-c0bfe704be85 | 44390538759; 44452693916 (OTP setup succeeded); 44453087353 (admin setup succeeded); 44451219597 (pre-setup; code-owned pass, admin blocked); 44457835276 (post-fix main E2E green; admin passed) | 0059 | 173be83 (lane 92cb959) |
| X2 | G1 | owner-approved TEST-only: Supabase `sms_test_otp`; MSG91/DLT and Expo projectId/FCM remain unset and inert; real SMS/push delivery remains blocked pending owner credentials/template and device validation; separate production project decision before G2 | integrator + owner | 44452693916 (test OTP setup succeeded) | — | — |
| X3 | G1 | 0060a/b deployed; legacy E2E seed fix and O2 approval-compatible demo seed verified; post-fix main E2E passed all required steps including admin | daa94142-b851-4a4e-8185-b0ddb5ffd01c | 44404269482; 44418061376 (seed fix green); 44418061318 (E2E pending); 44411077594 (proposal + admin failure); 44419846387 (backend success); 44419845866 (main E2E pending); 44422452507 (main E2E pending); 44423228486 (demo reset failed; smoke not run); 44427389151 (demo reset failed; smoke not run); 44429275638 (demo reset failed; smoke not run); 44439583544 (pre-setup code pass; admin blocked); 44444203959 (pre-setup reset/code pass; admin blocked); 44451219597 (pre-setup reset/code pass; admin blocked); 44452693916/44453087353 (owner setup); 44457835276 (post-fix main E2E green) | 0060a/b | 9bd12a5 (lane 7562163); b044510 (lane c2441c2) |
| H1 | G1 | merged; 0061 applied and recorded by successful main deployment | 043f0559-145b-424b-a6ee-3a5d2a81eee5 | 44411611254 (revalidation green); 44411611318 (E2E pending); 44412263137 (main success) | 0061 | 83ca69f (lane 7fc2ed9) |
| F3 | G1 | scope-corrected lane green; lower-model review clear; 0062 applied and recorded on main | f8bfe61d-b277-4cba-8fb4-8bb0ef7659ca | 44414018378 (green); 44412649463 (prior green); 44419846387 (main success) | 0062 | 6e89494 (lane 68c1c4d) |
| O1 | G1 | merged; lower-model review clear; 0063 applied and recorded on main | ff25279d-1209-44db-9fee-42a727ac6c33 | 44390988731 (prior green); 44420825698 (revalidated green); 44423228645 (main success) | 0063 | 66931b8 |
| O2 | G1 | merged; 0064 applied; demo-seed fix on main; post-fix main E2E reset, code-owned steps, and admin step passed | db2d3708-01f6-481c-a6a6-0f4f6bb17fca | 44392429239 (prior green); 44425010957 (revalidated green); 44427389305 (main success); 44435464586 (seed test green); 44436860237 (comment follow-up green); 44436860234 (pre-setup admin failure); 44439583542 (main backend success); 44439583544 (pre-setup code pass; admin blocked); 44444203959 (pre-setup code pass; admin blocked); 44451219597 (pre-setup code pass; admin blocked); 44452693916/44453087353 (owner setup); 44457835276 (post-fix main E2E green) | 0064 | 5c962d9; follow-up a501fc3 |
| H2a | G1 | merged; 0065 applied; shared `h2a.test.mjs` fixture repair `92ca401` merged to main as `71951da`; lane CI `44511017570` green; backend deploy retry `44512029762` succeeded; post-fix main E2E `44516641754` passed | bbba8810-4b2c-49d0-8ab6-f6262ad7176c | 44392157222; 44428059570 (earlier fixture failures fixed); 44428516193 (prior green); 44429275573 (prior main success); 44507015621 (blocked); 44511017570 (fix lane CI); 44512029762 (main deploy success); 44516641754 (main E2E green) | 0065 | 4856883 |
| H2b | G1 | merged; 0066 applied; lane CI and lower-model review green; recurring E2E step passed; lane-only assistant timeout not reproduced on main; post-fix main E2E 44457835276 passed with admin; AI limit paths skipped | e5fb46bc-9408-4df7-9ff8-5bdf75f0a538 | 44433698320 (ai_usage failure; fixed); 44434278137 (prior green); 44433698314 (prior E2E pending); 44440036124 (revalidated green); 44440036120 (recurring step passed; assistant/admin failures); 44439583544 (pre-setup assistant pass; admin blocked); 44444203933 (0066 applied); 44444204058 (app publish success); 44444203959 (pre-setup code pass; admin blocked); 44451219597 (pre-setup assistant/code pass; admin blocked); 44452693916/44453087353 (owner setup); 44457835276 (post-fix main E2E green) | 0066 | 4136362 (lane afc109b) |
| U2 | G1 | merged as `19149de`; lane CI/review green; 0068 applied and app publish passed; fix-forward `eeee6b3` resolved the cancellation dismissal and nested admin-shop steps; main E2E `44470999417` passed | 5eb40283-1c18-4d5f-8a4c-9e0673180b86 | 44458119039 (lane CI green); 44458119027 (pre-merge fallback; 0068 absent); 44465627380 (0068 applied); 44465627372 (app publish); 44465627435 (3 failed steps); `eeee6b3`; 44470999417 (main E2E green) | 0068 | 19149de |
| B1 | G1 | lane CI/review green; exact Doc 16 ₹999 + ₹29 fixture; migration 0073 merged to main at `0a0b0af`; combined lane CI `44489521830` green; prior deploy `44507015621` stopped at H2a test; retry `44512029762` succeeded and post-fix main E2E `44516641754` passed | d634ce91-6b9e-44ef-8979-7bff3f823834 | 44472477826; 44476343386; 44489521830 (batch lane CI green); 44507015621 (deploy failed); 44512029762 (main deploy success); 44516641754 (main E2E green) | 0073 | 0a0b0af |
| U1 | G1 | merged; lane CI green; E2E remains queued | c44e9364-73ac-4c6e-919f-ab14808f8b64 | 44413025536 (lane CI); 44413025293 (E2E pending) | — | 7c7f3b7 (lane 290a0c7) |
| U3 | G1 | merged; 0067 applied and recorded; lower-model review and lane CI green; U3 web-smoke and post-fix main E2E passed | bc0c8141-772b-4d97-9181-1286094f2f57 | 44399638736 (partial); 44423704672 (prior green); 44425332784 (post-rename green); 44423704687 (prior E2E pending); 44449228926 (lane CI green); 44449228932 (pre-fix admin failure); 44451219515 (0067 applied); 44451219523 (app publish success); 44451219597 (pre-setup code pass; admin blocked); 44452693916/44453087353 (owner setup); 44457835276 (post-fix main E2E green) | 0067 | 5731418 (lane de23c6c) |
| P1a | G1 | merged as `eeee6b3`; current-main lane CI green; migration 0069 applied; main app publish and E2E passed | 3f745efa-75d9-4e5b-bee7-be8d2fe6fea0 | 44395068717 (prior base); 44467553727 (current-main lane CI green); 44467123824 (pre-fix lane E2E failed only at U2 modal dismissal; admin steps passed); 44470999495 (0069 applied); 44470999525 (app publish success); 44470999417 (main E2E success) | 0069 | eeee6b3 |
| P1b | G1 | migration 0074 merged to main at `0a0b0af`; combined lane CI `44489521830` green; backend deploy retry `44512029762` succeeded; the RFQ quantity fix `5dd85fb` and post-fix main E2E `44516641754` passed | a1da8d43-6977-44a8-9e45-25e435995465 | 44476284421; 44489521830 (batch lane CI green); 44507015621 (deploy failed); 44512029762 (main deploy success); 44516641754 (main E2E green); commits `daa26bd`/`f84c835` | 0074 | 0a0b0af |
| R1 | G1 | merged as `91b5fcd`; 0070 previously applied; earlier UI-batch/main E2E failures included T1 role setup; T1 fix-forward is now on main at `10495c0`; backend deploy `44512029762` and post-fix main E2E `44516641754` succeeded | d2882009-c908-4082-a75e-94d2bf52d65a | 44476452837 (prior backend success); 44487041930 (prior E2E failure); 44502606943 (pre-fix UI-batch failure); 44507015621 (deploy failure); 44507015463 (pre-fix main E2E failure); 44512029762 (main deploy success); 44516641754 (main E2E green); T1 `8148854` / `44508274961` (lane green) | 0070 | 91b5fcd |
| T1 | G1 | fix `8148854` uses authenticated `get_my_provider` and `save_provider_basics` instead of direct profile PATCH and preserves returning-provider routing; fix-forward is on main at `10495c0`; backend deploy `44512029762` succeeded and main E2E `44516641754` passed | 6c5934c4-e869-4e30-b4d4-dd2469724210 | 44508274961 (lane CI green; E2E-only file change); 44507015463 (pre-fix main E2E failure); 44512029762 (backend deploy success); 44516641754 (post-fix main E2E green) | — | `10495c0` (`8148854` source) |
| T2 | G1 | RP-29 isolated-provider, future-safe date-offset fix merged; main SQL validation green | f9d40dc6-5959-43b3-b3fc-0e885a212f8b | 44410255193; 44411901585 (lane green); 44410255110 (E2E pending); 44413775484 (main success) | — | caed73d; c409974 (lane f05803e); 61a5f78 (lane 4052664) |
| F1 | G2 | migration 0071 merged to main at `0a0b0af`; batch CI `44489521830` green; prior deploy `44507015621` stopped at H2a test; retry `44512029762` succeeded and post-fix main E2E `44516641754` passed | f585de6d-23a0-4b78-a795-0153ebe81f77 | 44474617328; 44489521830 (batch lane CI green); 44507015621 (deploy failed); 44512029762 (main deploy success); 44516641754 (main E2E green) | 0071 | 0a0b0af |
| F2 | G2 | lane green at `ed79b89`; registered SQL test passed (120/120 checks); focused lower-model review clear; migration 0075 applied by successful main deploy `44520271932`; app publish `44520272944` and main E2E `44520271806` passed | 235c290c-22ae-418f-aaba-a70aa2a92293 | 44514183082 (lane green); 44519475827 (combined DB batch green); 44520271932 (0075 applied); 44520272944 (app publish green); 44520271806 (main E2E green) | 0075 | `adfa141` |
| F4 | G2 | original WS6 refund/dispute scope only; lane green at `fe93f5d`; focused lower-model review clear; migration 0076 applied by successful main deploy `44520271932`; app publish and main E2E passed | 8afe921c-cf83-4cff-976d-4ab72265f39c | 44502957340 (lane CI green); 44519475827 (combined DB batch green); 44520271932 (0076 applied); 44520272944 (app publish green); 44520271806 (main E2E green) | 0076 | `adfa141` |
| F6 | G2 | lane green at `78776ac`, includes F5 and H2a fixes; Deno and SQL passed (app job skipped because no app paths); lower-model review clear; migration 0078 applied by successful main deploy `44520271932`; app publish and main E2E passed | 025d435c-6475-432a-8151-b41e9fce8646 | 44513551431 (Deno/SQL green; app skipped); 44519475827 (combined DB batch green); 44520271932 (0078 applied); 44520272944 (app publish green); 44520271806 (main E2E green) | 0078 | `adfa141` |
| F5 | G2 | webhook duplicate-payload conflict detection and G2/G3 boundary complete at `88c4cc1`; lane CI and focused re-review green; migration 0077 applied by successful main deploy `44520271932`; refund/transfer/reversal journal writers remain deferred to G3; app publish and main E2E passed | 1b2fc5b9-fcc4-485c-88c1-594a40f58ec5 | 44497183227 (lane CI green); 44519475827 (combined DB batch green); 44520271932 (0077 applied); 44520272944 (app publish green); 44520271806 (main E2E green) | 0077 | `adfa141` |
| F7 | G2 | migration 0079 merged with S2 0080 at `d69d4e3`; combined CI `44538545996` passed. Lower-model review retracted the `PayoutSection` finding as intentional: Business is disabled, Individual is the only selectable choice, and the server rejects unsupported Business submissions before upsert/gateway calls. Business payout remains default-OFF and owner-blocked pending entity/KYC mapping; H2a/D1 recurring fees and D4 tax review remain unchanged. Main deploy `44539719118` applied 0079/0080; shared E2E fix-forward is in progress | cc4a9d08-a749-4364-b6c8-f2f8b7432cc8 | 44521949213 (green without F7 SQL registration); 44532403636 (green with registered F7 test); 44538545996 (ordered F7/S2 batch CI green); 44539719118 (0079/0080 applied); lower-model review clear | 0079 | `d69d4e3` |
| F8 | G2 | implementation complete on `lane/F8` at `06a466d`; code merged to main in DB batch 5 at `51b0842`; lane CI `44595787928` green; lower-model payment/security review found no high-confidence findings. Checkout E2E remains owner-blocked pending an isolated TEST Supabase/Razorpay environment and approved company-controlled HTTPS `CHECKOUT_PAGE_URL`; never use live keys or the shared demo project | f0a2ebda-3b54-410d-ab69-aadf66457599 | 44595787928 (lane CI green); lower-model review `dee3f9c9-1557-40f5-ade5-ab66fb308bb0` clear; checkout E2E owner-blocked | — | `51b0842` |
| S1 | G2 | migration 0072 merged to main at `0a0b0af`; batch CI `44489521830` green; prior deploy `44507015621` stopped at H2a test; retry `44512029762` succeeded and post-fix main E2E `44516641754` passed | 190cae34-4263-4cb9-8b16-fa1895ce73e1 | 44474185719; 44489521830 (batch lane CI green); 44507015621 (deploy failed); 44512029762 (main deploy success); 44516641754 (main E2E green) | 0072 | 0a0b0af |
| S2 | G2 | migration 0080 merged after F7 0079 at `d69d4e3`; combined CI `44538545996` passed; webhook lower-model review is clear. Main E2E `44539719141` failed two sports steps; fix-forward `fea901b` passed lane CI `44543329103`, merged to main at `90b7da3`, and main E2E `44545260319` passed | da77e068-440b-4057-9eb9-1e596efd6dfb | 44517409154 (non-webhook lane CI green); 44520129148 (S2/F6 lane CI green); 44533606941 (F7/S2 full-chain green); 44538545996 (ordered F7/S2 batch CI green); 44539719118 (main deploy applied 0079/0080); 44539719141 (pre-fix main E2E failed); 44543329103 (fix-forward lane CI green); 44545260319 (main E2E green); lower-model webhook review clear | 0080 | `90b7da3` |
| C1 | G2 | migration 0082 merged to main at `8663e06`; lane CI `44589543600`, final lower-model review, and combined DB batch CI `44598533157` are green. Main deploy `44599377704` and app publish `44599377715` succeeded; main E2E `44599377760` failed and fix-forward is in progress (see doc 14 §7) | 3f5ca91c-d37c-4af6-9ee2-fdc722ab32c3 | 44589543600 (lane CI); final review clear; 44598533157 (combined batch CI); 44599377704 (main deploy); 44599377715 (app publish); 44599377760 (main E2E failed) | 0082 | `8663e06` |
| C2 | G2 | migration 0081 merged to main at `8663e06`; lane CI `44566894698`, final lower-model review, and combined DB batch CI `44598533157` are green. Main deploy `44599377704` and app publish `44599377715` succeeded; main E2E `44599377760` failed and fix-forward is in progress (see doc 14 §7) | 9e89880c-8fb1-4aba-8dca-f30e06ca9c9e | 44566894698 (lane CI); final review clear; 44598533157 (combined batch CI); 44599377704 (main deploy); 44599377715 (app publish); 44599377760 (main E2E failed) | 0081 | `8663e06` |
| H3 | G2 | migration 0083 merged to main at `8663e06`; lane CI `44592148458`, lower-model review, and combined DB batch CI `44598533157` are green. Main deploy `44599377704` and app publish `44599377715` succeeded; main E2E `44599377760` failed; H3 fixture fix-forward is in progress (see doc 14 §7) | a4d4c288-5bf0-48c9-b3d5-de9273571e5c | 44592148458 (lane CI); lower-model review clear; 44598533157 (combined batch CI); 44599377704 (main deploy); 44599377715 (app publish); 44599377760 (main E2E failed) | 0083 | `8663e06` |
| B2 | G2 | migration 0084 merged to main at `8663e06`; lane CI `44595108901`, lower-model review, and combined DB batch CI `44598533157` are green. Main deploy `44599377704` and app publish `44599377715` succeeded; main E2E `44599377760` failed and fix-forward is in progress (see doc 14 §7) | db967723-ebc9-47f7-8cc6-d6b40be15522 | 44595108901 (lane CI); lower-model review clear; 44598533157 (combined batch CI); 44599377704 (main deploy); 44599377715 (app publish); 44599377760 (main E2E failed) | 0084 | `8663e06` |
| B4 | G2 | implementation at `d25d1f5`; source lane CI `44523067442`, focused lower-model review, and B4-only batch CI `44605909397` are green. DB batch 5 at `51b0842` passed lane CI `44646185479` and private E2E `44646184676`; `guest_browse` is pinned ON only in the E2E manifest, while production remains default-OFF. Fast-forwarded to main; backend deploy `44648061411` applied 0085-0087. Hosted E2E run `44649171473` still failed during reset with HTTP 400. Fix-forward `0aea241` adds sanitized reset errors and a PII-safe state snapshot; lane CI `44650315766` and private E2E `44650315775` passed; post-deploy hosted validation pending | 807950c2-09b4-4cc0-8084-ce97cdd6efb6 | 44523067442 (B4 source lane); 44605909397 (B4 batch CI); 44641076318 (prior main backend green); 44641076647 (prior main E2E green); 44646185479 (B5 lane CI green); 44646184676 (B5 private E2E green); 44648061411 (main backend green); 44648061361 (pre-ordering-fix E2E reset failed); 44649171473 (post-ordering-fix E2E reset failed HTTP 400); 44650315766 (diagnostics lane CI green); 44650315775 (diagnostics private E2E green) | 0085 | `51b0842` |
| B6 | G2 | implementation complete on `lane/B6` at `cf90d4b`; migrations renumbered to 0088a/b. Codespace SQL/app checks and lane CI `44619678497` are green; lower-model money review found no high-confidence findings. Unblocked for the next DB batch after B5 migrations 0085-0087; integrate as 0088a/b after rebasing and validating against current main | 2a891318-f319-4137-adaf-ecefb4b86da9 | 44619678497 (lane CI green); lower-model review clear | 0088a/b | — |
| O3 | G2 | lane green at `3db245b`; reuses F4's audited refund retry; lower-model review clear. Integrated into DB batch 5 as migration 0086; bill-photo fixture corrected and integrated. Renumbered O3 SQL filter passed Codespace 2/2; batch at `51b0842` passed lane CI `44646185479` and private E2E `44646184676`; backend deploy `44648061411` applied 0085-0087. Hosted E2E run `44649171473` still failed during reset with HTTP 400. Fix-forward `0aea241` adds sanitized reset errors and a PII-safe state snapshot; lane CI `44650315766` and private E2E `44650315775` passed; post-deploy hosted validation pending | d417d1f2-59e3-44bb-81b3-3016af817af3 | 44513318423 (O3 lane CI); 44623503980 (follow-up lane CI); lower-model review clear; Codespace SQL PASS; 44646185479 (B5 lane CI green); 44646184676 (B5 private E2E green); 44648061411 (main backend green); 44649171473 (post-ordering-fix E2E reset failed HTTP 400); 44650315766 (diagnostics lane CI green); 44650315775 (diagnostics private E2E green) | 0086 | `51b0842` |
| B3 | G2 | DEFERRED — owner will engage CA later; no tax invoices before review and no live payments before D4 review | — | — | later | — |
| S3 | G3 | deferred until G2/S2 | — | — | — | — |
| C3 | G3 | deferred until C2 | — | — | — | — |
| O4 | G3 | deferred outside the current G1/G2 + doc14 completion gate; R-05 may proceed per doc14 sequencing | — | — | — | — |
| O5 | G3 | deferred until O4 and B6 | — | — | — | — |
| B5 | Later | deferred until F3 | — | — | — | — |
| U4 | Later | DEFERRED until rebrand; keep "Seva Coins" for now and choose replacement name then | — | — | — | — |
| U5 | Later | deferred | — | — | — | — |

Manual verification log (device, OS, date, result): SMS OTP · push delivery · Razorpay test-mode checkout on Android and iPhone.

## 8. Definition of done (whole remediation)
1. All G1 and G2 WPs are merged with green lanes, and `main` E2E plus the F8 payment lane are green.
2. Every doc 15 P0 and P1 marked G1/G2 is closed with a named test, recorded in the appendix status columns by the integrator.
3. Doc 16 samples are reproduced exactly by SQL tests.
4. Owner decisions D1–D7 are recorded in doc 15 §7.
5. Items needing real users (doc 15 E28) are scheduled for the closed pilot with the 11 personas.
