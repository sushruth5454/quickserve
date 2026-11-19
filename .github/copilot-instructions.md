# QuickServe Project Instructions

## Runtime configuration and feature switches

Every new feature and independently deployable sub-feature must be configurable and enableable/disableable at runtime by an administrator. Do not ship a new customer or merchant capability that can only be turned off by deploying another app build.

For each feature:

1. Register an explicit `feature_flags` key with a clear label, description (including user-visible OFF behavior), group and sort order. Default new customer-facing capabilities to OFF unless the product owner explicitly approves otherwise.
2. Put tunable business rules (limits, frequencies, prices/fees, cutoffs, cancellation/refund policy, commission, geography) in validated admin-managed database configuration or per-category/per-business records. Never rely on client-provided values for authorization, availability or money.
3. Enforce the switch and its parent switches in every relevant server RPC/Edge Function. A hidden app control is not authorization. Child features fail closed when a parent is disabled.
4. Hide or clearly disable every app entry point when its effective feature switch is OFF. Keep existing rows, plans and bookings readable.
5. Add tests for enabled behavior, feature-off rejection, parent-off/child-on rejection, and authorized/unauthorized roles.
6. Never gate money-safety paths for existing work: payment recording, refunds, settlement/payout release, expiry cleanup and customer cancellation must continue to safely resolve in-flight records after a feature is disabled.

Before calling a feature complete, verify the admin control, server enforcement, app behavior, and flag-off tests together.

## Parallel implementation

For implementation plans that define parallel tasks, use one background agent and isolated worktree per ready task. Launch all independent ready tasks concurrently; keep shared CI registration, integration and ordered database migration merges with the coordinating agent. Never let parallel agents edit the same shared file.

## Fast validation loop (CI-only testing)

All builds, tests and installs run only in GitHub Actions; each CI round takes minutes, so minimise the number of rounds.

1. **One push fixes every known failure.** After a failed run, read the full failed log (`gh run view <id> --log-failed`), list every `FAIL:` line and every uncaught error, find the root cause of each, and fix all of them in a single commit. Never push a fix for one failure while others in the same log are unaddressed.
2. **Diagnose before guessing.** Every new assertion message must include the actual values it checked (`JSON.stringify` of the relevant rows/state), so one failed run is enough to identify the cause. Do not push "diagnostic-only" commits.
3. **Isolate test fixtures from the start.** Each scenario gets its own provider/venue/resource, customer where relevant, and a unique date/time slot. Never reuse a provider, resource or slot across scenarios. Do not rely on `now()`-relative times near day boundaries; use fixed future dates/times inside working hours.
4. **Tests keep going after a crash.** CI runs SQL checks through `supabase/tests/run-all.mjs`, which runs every registered test file in parallel, records a crashed file as a failure and continues, and prints every `FAIL:` line and error in one summary. New SQL test files use `createHarness()` from `supabase/tests/harness.mjs` and wrap each scenario in `await scenario('ID', async () => { ... })` so a crash inside one scenario does not stop the rest of that file. Run a subset with `node run-all.mjs <filter>`.
5. **Cast every SQL test parameter explicitly** (`$1::timestamptz`, `$2::int`, `$3::uuid`) and qualify columns in joins, to avoid PGlite ambiguity errors.
6. **Authors validate their own lane before handoff.** A feature agent's task is not done until its lane branch has a green CI run. Agents must report the run ID and fix their own failures; the coordinator only integrates green lanes.
7. **Run CI on lane branches in parallel.** Push each lane to `origin` as `lane/<task>` (`git push origin HEAD:lane/<task>`). `.github/workflows/lane-ci.yml` then runs only the affected test jobs (Deno, SQL, app typecheck/Jest) in parallel with no deploy steps, so several features are validated at once. Only `main` deploys migrations and Edge Functions, in numeric migration order; merge a lane to `main` only after its lane run is green. Deno tests and SQL checks are shared scripts (`scripts/ci/deno-checks.sh`, `supabase/tests/run-all.mjs`), so new `*_test.ts` directories and newly registered SQL tests run on both lanes and `main` automatically.
8. **Watch CI without blocking, and stay under the GitHub API limit (5,000 requests/hour per account, shared by every agent).** Monitor runs in the background with `gh run watch <id> --exit-status --interval 60` and keep working on independent lanes. Never poll in a loop. Run at most **one** watcher per run, and only the integrator watches E2E runs. Agents watch only their own lane CI run. Prefer `gh run view <id> --json status,conclusion` once over repeated `gh run list`. If `gh api rate_limit` shows `core.remaining` < 500, stop all watchers, wait for `core.reset`, and do only git (push/pull) work meanwhile.
9. **Self-review before push.** Run `git diff --check`, re-read changed SQL for column/table names against the defining migration, and confirm shared registrations (test package scripts, workflow migration lists, full-chain test file lists) include the new migration/test.
10. **Reviews stay focused.** Do not trigger Opus reviews automatically; use a lower-model review only for money, auth or concurrency changes, and fix all findings in one pass.
