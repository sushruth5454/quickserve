# QuickServe Addendum Foundations — BDD

**Status:** Source behavior for W0; implementation and CI validation pending.

## Scope and actors

W0 establishes admin-managed feature switches, parent/child switch semantics, validated runtime rules, notification-kind compatibility, and a shared provider-window availability check. It does not expose the new marketplace workflows or enable their flags.

## Scenarios

### W0-SC-01 — Every addendum feature has an admin switch

```gherkin
Feature: Runtime feature registry
  Scenario: All planned capabilities are independently registered and initially disabled
    Given the addendum foundation migration has been applied
    When the app requests its feature registry
    Then every flag in the plan's feature-switch matrix is present with its documented label and group
    And every customer-facing capability is disabled until an admin explicitly enables it
    And admin-only configuration tools are visible only to authorized admins
```

### W0-SC-02 — Child switches fail closed when a parent is off

```gherkin
Feature: Parent-enforced feature switches
  Scenario: A child capability cannot bypass its parent switch
    Given recurring_bookings is disabled
    And recurring_skip_pause is enabled
    When a customer attempts to skip a recurring visit
    Then the server rejects the action because recurring bookings are disabled
    And the customer app hides the skip action
```

### W0-SC-03 — Admin can update valid rules at runtime

```gherkin
Feature: Admin-managed booking rules
  Scenario: An admin changes configured recurrence and sports rules
    Given the caller is an admin
    When the admin saves a valid recurring or sports rules object
    Then subsequent server decisions use the new values without an app update
    And the change is recorded in the admin audit log

  Scenario: Invalid rules and non-admin writes are rejected
    Given the caller is not an admin or the rules object violates a range/type constraint
    When the caller attempts to update booking rules
    Then the server rejects the change without changing the saved configuration
```

### W0-SC-04 — Money-safety and existing booking actions survive switch-off

```gherkin
Feature: Safe feature disablement
  Scenario: Turning a new capability off blocks new work without stranding existing work
    Given an online sports booking is awaiting payment or a recurring visit already exists
    And the corresponding feature flag is turned off
    When the customer completes payment, requests a refund, cancels an existing booking, or the expiry job runs
    Then the existing payment, refund, cancellation, or expiry path remains available
    And new bookings or new recurring occurrences are not admitted
```

### W0-SC-05 — Provider-window checks are serialized and reusable

```gherkin
Feature: Shared provider availability guard
  Scenario: A reschedule or occurrence-generation call cannot overlap an exclusive booking
    Given an active exclusive booking occupies a provider time window
    When another transaction checks or reserves an overlapping window for that provider
    Then the shared guard serializes the check and rejects the overlap
    And an explicitly excluded booking does not conflict with its own window
```

## Trace links

- DDD: [Addendum Foundations — DDD](../../ddd/artifacts/home-services-recurring-sports-foundations-ddd.md)
- Traceability: [Addendum Foundations — Traceability](../../bdd-ddd-tdd/artifacts/home-services-recurring-sports-foundations-traceability.md)
- Implementation plan: [Home Services, Recurring & Sports Payments](../../../../../../12-Home-Services-Recurring-Sports-Payments-Implementation-Plan.md), W0
- Planned migration: `supabase/migrations/0054_addendum_foundations.sql`
