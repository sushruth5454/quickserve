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
4. **Tests keep going after a crash.** Wrap each scenario in a guarded block (for example `await scenario('RP-07', async () => { ... })`) that records an uncaught error as a failure and continues, so one run reports every broken scenario. Exit non-zero at the end if any failure was recorded.
5. **Cast every SQL test parameter explicitly** (`$1::timestamptz`, `$2::int`, `$3::uuid`) and qualify columns in joins, to avoid PGlite ambiguity errors.
6. **Authors validate their own lane before handoff.** A feature agent's task is not done until its lane branch has a green CI run. Agents must report the run ID and fix their own failures; the coordinator only integrates green lanes.
7. **Run CI on lane branches in parallel.** Lane branches (`lane/**`) run the SQL/Deno/Jest test jobs without deploy steps, so several features are validated at the same time. Only `main` deploys migrations and Edge Functions, in numeric migration order.
8. **Watch CI without blocking.** Monitor runs in the background (`gh run watch <id> --exit-status`) and keep working on independent lanes; never poll in a loop.
9. **Self-review before push.** Run `git diff --check`, re-read changed SQL for column/table names against the defining migration, and confirm shared registrations (test package scripts, workflow migration lists, full-chain test file lists) include the new migration/test.
10. **Reviews stay focused.** Do not trigger Opus reviews automatically; use a lower-model review only for money, auth or concurrency changes, and fix all findings in one pass.
