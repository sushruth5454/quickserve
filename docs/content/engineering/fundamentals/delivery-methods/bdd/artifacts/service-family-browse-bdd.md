# QuickServe Service-Family Browsing — BDD

**Status:** Behavior specified; implementation in progress.

## Scope and actors

Customers discover local services, learning sessions, sports venues, and shops from one home screen. Existing category verticals remain the detailed catalogue groups; this change adds a clear customer-facing family selector without changing booking or commerce workflows.

## Scenarios

### SF-01 — Customers can choose a service family

```gherkin
Feature: Service-family discovery
  Scenario: A customer selects a family and sees only its categories
    Given the customer has a catalogue containing multiple verticals
    When the customer selects Home & vehicle services
    Then only categories mapped to that family are shown
    And the other families remain available from the selector
```

### SF-02 — Search respects the selected family

```gherkin
Feature: Family-scoped search
  Scenario: Search narrows the selected catalogue family
    Given the customer has selected a service family
    When the customer searches for a category
    Then results are limited to matching categories in that family
    And selecting All restores matches across all service families
```

### SF-03 — Marketplace entry points remain feature-gated

```gherkin
Feature: Sports and shop discovery
  Scenario: Sports and Shop Local appear only when their features are enabled
    Given the sports or products feature is disabled
    When the customer views the home screen
    Then the corresponding entry point is not shown
    When the feature is enabled and the customer selects its entry point
    Then the app opens the existing sports or shop workflow
```

### SF-04 — Existing service workflows are preserved

```gherkin
Feature: Category workflow integrity
  Scenario: Selecting a category still opens its existing booking flow
    Given a customer selects a category from a family
    When the category is opened
    Then the existing category route and archetype-specific flow are used
    And no booking, quote, or payment is created by selecting a family
```

### SF-05 — Home-screen trust copy does not overpromise payment behavior

```gherkin
Feature: Accurate marketplace expectations
  Scenario: Home-screen copy does not promise a universal payment hold
    Given the home screen includes services, sports, and product entry points
    When the customer reads its general trust message
    Then payment handling is described as workflow-specific
    And sports pay-at-venue requests are not represented as escrow bookings
```

## Automation readiness

| Scenario | Test evidence | Validation |
|---|---|---|
| SF-01 | `app/src/features/catalogue/__tests__/model.test.ts` family mapping test | Pending CI |
| SF-02 | Home-screen selector state and filtered catalogue rendering | Pending E2E |
| SF-03 | Existing feature-flag checks on sports/products entry points | Pending E2E |
| SF-04 | Existing category route remains unchanged | Pending E2E |
| SF-05 | Home-screen trust copy review | Pending UI validation |

## Trace links

- DDD: [Service-Family Discovery — DDD](../../ddd/artifacts/service-family-browse-ddd.md)
- Traceability: [Service-Family Browse — Traceability](../../bdd-ddd-tdd/artifacts/service-family-browse-traceability.md)
