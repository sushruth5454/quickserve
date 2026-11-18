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
