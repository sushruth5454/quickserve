# QuickServe Addendum Foundations — DDD

**Status:** Domain boundaries recorded; W0 implementation and CI validation pending.

## Domain framing

The existing feature registry and `app_config` remain the configuration source of truth. W0 adds no parallel booking, payment, notification, or feature-flag subsystem. It establishes shared gates consumed by the catalogue, recurring-plan, sports-payment, and admin-rule bounded contexts.

## Ubiquitous language

| Term | Meaning |
|---|---|
| Feature flag | Runtime, admin-controlled on/off capability stored in `public.feature_flags`. |
| Parent flag | Master capability required for any child capability to be effective. |
| Child flag | A narrower capability that is effective only when its own flag and parent are both enabled. |
| Runtime rule | Validated admin-managed policy value stored in an allowlisted `public.app_config` key. |
| Money-safety path | Payment recording, refund processing, payout release, expiry, or cancellation of already-existing work; it remains operable when new-work flags are off. |
| Provider-window guard | A serialized database check for conflicts with active exclusive provider bookings, reusable by create and reschedule flows. |

## Bounded contexts and invariants

| Context | Owns | Invariants and boundary |
|---|---|---|
| **Feature configuration** | `feature_flags`, parent-child effective checks, client `useFeature` helper | Registry is the source of truth. Child flags fail closed unless the parent is enabled. The client hides affordances, but every server write independently enforces the same gate. |
| **Admin policy configuration** | Allowlisted `recurring_rules` and `sports_rules` JSON in `app_config`; admin read/write RPCs | Only admins can write. RPC validates keys, types, enums and ranges; every write is audited. Business decisions never trust client-provided policy values. |
| **Notification contract** | Addendum notification kinds and safe client-route mapping | Extend the existing kind constraint using its current expression; do not replace unrelated legacy kinds. Unknown route payloads fail closed. |
| **Availability** | Private `_assert_provider_window_free` helper | Acquires the provider advisory transaction lock and uses the existing overlap predicate. Callers must still validate provider hours, holidays, time-off, and business authorization. |

## Cross-cutting policy

- Feature-off prevents **new** capability use, but existing work remains readable and can be safely completed, cancelled, expired, refunded, or paid where applicable.
- Feature switches never gate payment webhooks, refunds, settlements, expiry cleanup, or customer cancellation of existing work.
- Addendum flags default off except explicitly admin-only configuration screens.
- No new `booking_status` enum values are introduced by W0.

## Trace links

- BDD: [Addendum Foundations — BDD](../../bdd/artifacts/home-services-recurring-sports-foundations-bdd.md)
- Traceability: [Addendum Foundations — Traceability](../../bdd-ddd-tdd/artifacts/home-services-recurring-sports-foundations-traceability.md)
- Implementation plan: [Home Services, Recurring & Sports Payments](../../../../../../12-Home-Services-Recurring-Sports-Payments-Implementation-Plan.md), W0
