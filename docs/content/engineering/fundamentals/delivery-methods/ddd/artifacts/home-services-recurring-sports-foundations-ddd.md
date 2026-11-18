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
| **Admin rules presentation (H1)** | Admin rules route, rules navigation entry, typed rules API adapter, human-unit input and display | The `admin_rules_editor` switch controls the admin UI entry point and editor. The API adapter calls only `admin_get_rules` and `admin_set_rules`; the server remains the authorization and validation boundary. Stored amounts remain integer paise and percentages remain integer basis points. |
| **Notification contract** | Addendum notification kinds and safe client-route mapping | Extend the existing kind constraint using its current expression; do not replace unrelated legacy kinds. Unknown route payloads fail closed. |
| **Availability** | Private `_assert_provider_window_free` helper | Acquires the provider advisory transaction lock and uses the existing overlap predicate. Callers must still validate provider hours, holidays, time-off, and business authorization. |

## H1 UI invariants

- The Rules entry point and editable rules controls are hidden when `admin_rules_editor` is off; hiding is a UI affordance, not a replacement for the admin-only RPC checks.
- The rules screen reads and writes through a typed adapter for the existing `admin_get_rules(p_key text)` and `admin_set_rules(p_key text, p_value jsonb)` contract. It does not read or write `app_config` directly.
- The UI displays paise as rupees and basis points as percentages, and converts back to integer storage units before saving. Invalid, non-finite, out-of-range, or unrepresentable values are not submitted; server validation errors remain visible to the admin.
- Loading, retryable error, and successful-save feedback are distinct screen states. A failed read or write must not be presented as a successful save.
- Child feature switches remain grouped with their parent. When a parent is off, each child is visibly disabled and explains that enabling the child alone cannot make it effective.

## H1 scenario and test mapping

| BDD scenario | Domain responsibility | Planned Jest coverage |
|---|---|---|
| `H1-SC-01` | Feature configuration / Admin rules presentation | Hide the Rules entry and editor when `admin_rules_editor` is off; expose it when on for the authorized admin UI. |
| `H1-SC-02` | Admin rules presentation | Loading/error/retry states and paise/basis-point formatting. |
| `H1-SC-03` | Admin policy configuration / Admin rules presentation | Exact rupee↔paise and percentage↔basis-point conversions; validation and save-error feedback. |
| `H1-SC-04` | Feature configuration | Parent/child grouping and disabled-child explanation while the parent is off. |

## Cross-cutting policy

- Feature-off prevents **new** capability use, but existing work remains readable and can be safely completed, cancelled, expired, refunded, or paid where applicable.
- Feature switches never gate payment webhooks, refunds, settlements, expiry cleanup, or customer cancellation of existing work.
- Addendum flags default off except explicitly admin-only configuration screens.
- No new `booking_status` enum values are introduced by W0.

## Trace links

- BDD: [Addendum Foundations — BDD](../../bdd/artifacts/home-services-recurring-sports-foundations-bdd.md)
- Traceability: [Addendum Foundations — Traceability](../../bdd-ddd-tdd/artifacts/home-services-recurring-sports-foundations-traceability.md)
- Implementation plan: [Home Services, Recurring & Sports Payments](../../../../../../12-Home-Services-Recurring-Sports-Payments-Implementation-Plan.md), W0
