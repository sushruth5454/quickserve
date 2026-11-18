# QuickServe Phase 9 — Unified My Activity — BDD

**Status:** Implemented with additive participant-scoped contracts; shared CI registration and validation pending.

## Actors and assumptions

Customers use the existing Bookings route as a read-only activity view. The view composes customer-owned resources; each owning context remains authoritative for its data, status, and detail route.

- Services is the existing customer bookings list.
- Requests lists the signed-in customer's `service_requests`.
- Shop is visible only when `products` is on; enquiry and RFQ content also respects `product_enquiries` and `product_rfq`.
- Sports is visible only when `sports` is on and contains customer bookings, not venue-owner bookings.
- Each item retains its resource status and established label. There is no cross-resource status.
- Only known in-app detail routes may be followed. Customer activity must not expose another participant's records or private request details.
- A badge counts unread activity in visible segments only, using the owning resource's existing read-state source.

## Scenarios

### ACT-01 — Feature flags control segment visibility

```gherkin
Feature: Customer activity segments
  Scenario: Hide disabled product and sports segments
    Given the customer activity view is open
    And the products feature is disabled
    And the sports feature is disabled
    When the segment control is rendered
    Then Services and Requests remain available
    And Shop and Sports are absent
    And no Shop or Sports data is requested
```

### ACT-02 — Shop children respect their own feature gates

```gherkin
Feature: Shop activity
  Scenario: Hide disabled Shop resource types without changing the master segment gate
    Given products is enabled
    And product enquiries or product RFQs are disabled
    When the customer opens Shop
    Then the Shop segment remains visible
    And only resource types whose own feature gates are enabled are loaded
```

### ACT-03 — Resource statuses remain context-owned

```gherkin
Feature: Activity status display
  Scenario: Display native statuses in their own resource lists
    Given the customer has service bookings, service requests, enquiries, RFQs, and sports bookings
    When their activity is displayed
    Then each row uses that resource's existing status and label
    And no status is translated into a shared invented lifecycle
```

### ACT-04 — Details open through safe, resource-specific routes

```gherkin
Feature: Activity navigation
  Scenario: Open a selected activity item
    Given a customer selects an activity row
    When its detail action is invoked
    Then a booking opens its booking detail
    And a service request opens its request detail
    And an enquiry, RFQ, or sports booking opens its matching detail route
    And no arbitrary URL or untrusted row text is treated as a route
```

### ACT-05 — Badge counts unread activity in visible segments

```gherkin
Feature: Unified unread badge
  Scenario: Sum unread counts without counting hidden segments
    Given one or more visible activity segments contain unread items
    And one or more feature-gated segments are hidden
    When the activity badge is calculated
    Then each visible segment's established unread count is included exactly once
    And unread items from hidden segments are excluded
    And records belonging to another user are never counted
```

The badge uses `get_my_activity_unread_counts()`. Services adds customer chat unread from `get_unread_counts()` to unread non-chat notifications tied to customer-owned bookings, excluding `chat_message` notification rows. Requests counts `proposal_received` and `request_message` notifications by their customer-owned `request_id`; Shop combines `customer_unread` on owned enquiries with `rfq_quote_received` notifications by owned `rfq_id`; Sports counts accepted/declined notifications by customer-owned `sports_booking_id`. Each notification count is restricted to `user_id = auth.uid()`. Hidden feature-gated segments contribute zero. The global `count_unread_notifications()` contract is not used.

### ACT-06 — Lists remain private to the customer

```gherkin
Feature: Customer activity privacy
  Scenario: Load only activity the signed-in customer owns
    Given a signed-in customer has activity records
    And other customers and venue owners have separate records
    When the customer activity lists load
    Then only records authorized for that customer are displayed
    And private request address or contact details are not added to activity rows
```

### ACT-07 — Empty and failed segments remain isolated

```gherkin
Feature: Activity loading
  Scenario: One empty or unavailable resource does not corrupt other segments
    Given at least one visible segment has no records or its request fails
    When the customer changes segments or retries
    Then the affected segment shows its own empty or error state
    And other loaded segments retain their resource data and status labels
```

## Automation readiness

| Scenario | Test level and pass/fail signal | Status |
|---|---|---|
| ACT-01, ACT-02 | Jest model test: visible segments and totals follow product/sports flags; SQL contract test: Shop child flags gate source counts | Authored; not run |
| ACT-03, ACT-04 | Component test: resource-native status labels and safe route mapping remain distinct | Not added |
| ACT-05 | Jest model + SQL contract tests: visible total, booking chat de-duplication, per-resource counts, feature gates, and read clearing | Authored; not run |
| ACT-06 | SQL contract test: customer-only RFQ/sports lists and resource ownership restrict reads and notification counts | Authored; not run |
| ACT-07 | Component test: each resource has independent loading, empty, retry, and error behavior | Not added |

No local tests or builds were run, per request.

## Trace links

- DDD: [Unified My Activity — DDD](../../ddd/artifacts/unified-my-activity-ddd.md)
- Traceability: [Unified My Activity — Traceability](../../bdd-ddd-tdd/artifacts/unified-my-activity-traceability.md)
- Phase plan: [PRD v2 implementation plan](../../../../../../11-PRD-v2-Implementation-Plan.md), Phase 9

**CI validation pending.** Shared migration/test registration remains an integration task.
