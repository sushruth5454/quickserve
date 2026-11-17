# Sports Venue Discovery & Booking Requests — BDD

## Discovery

- **Actors:** customer, venue owner, administrator.
- **Goal:** discover verified sports venues, request an available slot, and pay the venue directly if the request is accepted.
- **Scope:** Phase 6 sports flag, venue/activity search, slot availability, booking requests and decisions, blocks, and request expiry.
- **Out of scope:** online payment, instant booking, and changes to the existing home-services booking state machine.
- **Assumptions from the implementation plan:** `sports` starts OFF; reads and mutations are server-gated; only verified venues are discoverable; prices are computed from venue rules and stored in paise.
- **Unresolved questions:** none block these scenarios. CI validation is pending.

## Scenarios

### SB-01 — A disabled sports feature refuses access

```gherkin
Feature: Sports venue booking requests
  Scenario: Sports reads and mutations are refused while the feature is off
    Given the administrator has left Sports & venues disabled
    When a customer searches or reads slots, an owner changes venue data, or an administrator manages sports venues
    Then the operation is refused with the feature-off response
    And direct table reads reveal no sports rows
```

### SB-02 — Search returns only verified venues

```gherkin
Feature: Sports venue discovery
  Scenario: A customer finds verified venues for an activity
    Given an active activity and a venue with an active resource are configured
    And the venue has not been verified by an administrator
    When a customer searches near a location for that activity
    Then that venue is not returned
    When an administrator verifies the venue and the customer searches again
    Then the venue is returned within the search radius with its minimum configured price
```

### SB-03 — A venue block prevents a request

```gherkin
Feature: Sports slot availability
  Scenario: A blocked time cannot be requested
    Given a verified venue has a resource with opening hours and a price rule
    And the owner has blocked the requested time
    When a customer requests a slot overlapping that block
    Then the request is refused as blocked
```

### SB-04 — Overlapping concurrent requests cannot double-book a resource

```gherkin
Feature: Sports slot requests
  Scenario: Only one customer wins a race for the same slot
    Given a verified resource has a free, priced slot
    When two customers request the same slot concurrently
    Then exactly one request succeeds
    And the other request is refused because the slot is no longer available
```

### SB-05 — The server snapshots the configured price

```gherkin
Feature: Sports booking price
  Scenario: A request uses the venue price rules
    Given a resource has a matching price rule for every requested slot
    When a customer requests one or more slots
    Then the server sums the matching per-slot prices
    And the booking stores that amount as its price snapshot in paise
```

### SB-06 — An owner accepts or declines a pending request

```gherkin
Feature: Sports booking decisions
  Scenario: The venue owner decides a pending request
    Given a booking request is pending and has not expired
    When the venue owner accepts it
    Then its status becomes accepted and the customer is notified
    When the venue owner declines a pending request with a reason
    Then its status becomes declined and the customer is notified with the decision
```

### SB-07 — Expiry releases an unaccepted slot

```gherkin
Feature: Sports request expiry
  Scenario: An expired request stops occupying its slot
    Given a booking request is still requested after its expiry time
    When the expiry job runs
    Then the request becomes expired
    And the slot is available for another request
```

### SB-08 — Sports requests are pay-at-venue only

```gherkin
Feature: Pay-at-venue sports booking
  Scenario: A customer requests a slot without online payment
    Given a customer selects a free slot at a verified venue
    When the customer sends a booking request
    Then the request is created without charging online
    And the app explains that payment is made directly to the venue after acceptance
```

## Automation readiness

| Scenario | Observable signal and current test evidence |
|---|---|
| SB-01 | `sports.test.mjs`: “all customer, owner, admin and expiry RPCs are refused while the flag is off”; direct RLS read assertion. |
| SB-02 | `sports.test.mjs`: “unverified venue is not searchable”; after verification, search returns the venue and configured minimum price. |
| SB-03 | `sports.test.mjs`: “blocked slot cannot be requested”. |
| SB-04 | `sports.test.mjs`: “two customers racing for one slot produce exactly one booking”. This covers the same-slot collision; arbitrary partial-window overlap is not separately asserted. |
| SB-05 | `sports.test.mjs`: “booking price is calculated from the server-side price rule”. |
| SB-06 | `sports.test.mjs` asserts acceptance and its notification. The decline branch is implemented but has no direct isolated assertion yet. |
| SB-07 | `sports.test.mjs`: “expired request releases its slot”. |
| SB-08 | Customer venue and booking screens state “Pay at the venue” / “No online payment”; no isolated assertion checks UI copy or payment behavior. |

## Trace links

- DDD: [Sports Bookings — DDD](../../ddd/artifacts/sports-bookings-ddd.md)
- Traceability: [Sports Bookings — Traceability](../../bdd-ddd-tdd/artifacts/sports-bookings-traceability.md)
- Governing decision: [PRD v2 implementation plan, decision D6 and Phase 6](../../../../../../11-PRD-v2-Implementation-Plan.md)

## Phase status

- **BDD:** scenarios defined from the Phase 6 plan and current implementation.
- **Implementation:** migration 0048, the sports routes, and isolated SQL assertions are present.
- **CI validation:** pending; local tests/builds were not run as requested.
