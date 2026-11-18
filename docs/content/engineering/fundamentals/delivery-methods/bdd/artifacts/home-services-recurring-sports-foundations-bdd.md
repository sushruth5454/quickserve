# QuickServe Addendum Foundations — BDD

**Status:** Source behavior for W0; implementation and CI validation pending.

## Scope and actors

W0 establishes admin-managed feature switches, parent/child switch semantics, validated runtime rules, notification-kind compatibility, and a shared provider-window availability check. It does not expose the new marketplace workflows or enable their flags.

## Scenarios

### H1-SC-01 — Admin rules entry point follows its feature switch

```gherkin
Feature: Admin rules editor visibility
  Scenario: An authorized admin opens the rules editor while enabled
    Given the caller is an authorized admin
    And admin_rules_editor is enabled
    When the caller opens the admin home
    Then the Rules entry point is visible
    And opening Rules loads the recurring and sports rules

  Scenario: The rules editor is unavailable while disabled
    Given admin_rules_editor is disabled
    When a caller opens the admin home or navigates to the rules route
    Then the Rules entry point is hidden
    And the rules screen does not expose editable rule controls
```

### H1-SC-02 — Rules display loading, error, and formatted values

```gherkin
Feature: Admin rules presentation
  Scenario: Saved integer rules are displayed in human units
    Given the rules are loading
    When the rules response is received
    Then a loading state is replaced by the Recurring rules and Sports rules sections
    And paise amounts are displayed as rupees
    And basis-point percentages are displayed as percentages

  Scenario: Rules fail to load
    Given the rules request fails
    When the screen handles the failure
    Then an error state is shown with a retry action
    And the screen does not present unsaved defaults as saved rules
```

### H1-SC-03 — Admin edits and saves rules without losing storage precision

```gherkin
Feature: Admin rules editing
  Scenario: Valid human-unit values are converted and saved
    Given an authorized admin has loaded the current rules
    When the admin enters valid rupee, percentage, and other rule values
    And saves the recurring or sports rules
    Then the client sends integer paise and basis-point values to admin_set_rules
    And a successful save is acknowledged
    And the saved values remain displayed in human units

  Scenario: Invalid values or a rejected save are not reported as successful
    Given an authorized admin is editing rules
    When an amount or percentage is malformed or outside the supported range
    Then validation identifies the invalid input and prevents the save
    When the server rejects an otherwise submitted rules object
    Then the server error is shown and the screen does not show a success state
```

### H1-SC-04 — Child feature switches explain their disabled parent

```gherkin
Feature: Parent and child feature switch presentation
  Scenario: Child switches are visibly dependent on a disabled parent
    Given a feature-switch group contains a parent and child switches
    And the parent switch is disabled
    When an admin views the feature-switch registry
    Then the child switches are grouped beneath and visually de-emphasized from the parent
    And each child is disabled for interaction
    And an explanation says that the child cannot take effect until its parent is enabled
```

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
