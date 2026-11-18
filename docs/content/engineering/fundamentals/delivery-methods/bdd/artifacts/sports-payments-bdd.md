# Sports Online Payments & Settlement — BDD

## Discovery

- **Actors:** customer, verified venue owner, administrator, payment gateway, and scheduled expiry/settlement worker.
- **Goal:** reserve sports capacity safely, support online payment where a venue is configured for it, and refund or settle every resulting payment correctly.
- **Scope:** migration `0058_sports_payments.sql` and its SQL behavior tests: capacity, online booking/payment lifecycle, expiry, cancellation/refunds, payout creation, and preservation of legacy pay-at-venue requests.
- **Out of scope:** payment edge-function routing, venue payout-account enrollment, payout release changes, and app UI. Those belong to E2/F/G or the integrator.
- **Business assumptions from the plan:** `sports_online_payments` is a child of `sports` and defaults OFF; online payment also requires the venue to allow `online` and have a verified owner payout account. Prices, fees, commission, cutoffs, and refund rules come from server-managed sports rules or venue cancellation rules, never client-supplied amounts. Money is integer paise and commission is basis points.
- **Compatibility rule:** the existing `request_sports_slot` pay-at-venue flow and its legacy statuses remain available and unchanged for old clients.
- **Unresolved questions:** none block implementation; CI validation is pending.

## Scenarios

### SP-01 — Online instant booking holds capacity and quotes server-side

```gherkin
Feature: Sports online booking
  Scenario: An instant online booking reserves capacity until payment
    Given online sports payments are enabled for a venue with a verified payout account
    And an instant resource has enough remaining capacity and a server price rule
    When a customer books a slot online for the requested participants
    Then the booking is pending payment with a server-calculated total in paise
    And its payment hold expires at the configured hold deadline
    And the reserved participants reduce the slot's remaining capacity
```

### SP-02 — Concurrent reservations cannot exceed resource capacity

```gherkin
Feature: Sports resource capacity
  Scenario: Concurrent customers compete for the last available capacity
    Given overlapping active bookings occupy all but one participant place on a resource
    When two customers concurrently request the overlapping time for one participant each
    Then exactly one request succeeds
    And the other is refused because capacity is no longer available
```

### SP-03 — Participant counts are bounded by resource capacity

```gherkin
Feature: Sports participant capacity
  Scenario: A booking cannot request more participants than the resource can hold
    Given a resource has a configured capacity
    When a customer requests more participants than the remaining capacity
    Then the booking is refused without reserving the slot
```

### SP-04 — A repeated idempotency key returns the existing booking

```gherkin
Feature: Idempotent sports booking
  Scenario: Retrying a booking request does not create another hold
    Given a customer has created a sports booking with an idempotency key
    When the same customer submits the same key again
    Then the existing booking is returned
    And no second capacity hold or payment attempt is created
```

### SP-05 — Online booking requires all venue and feature prerequisites

```gherkin
Feature: Sports online-payment eligibility
  Scenario: Online booking is refused when it is not enabled for this venue
    Given the sports parent flag is off, or online payments are off, or the venue disallows online payment
    Or the verified venue owner has no verified payout account
    When a customer requests an online sports booking
    Then the server refuses the request
    And the slot is not reserved
```

### SP-06 — Approval-mode online booking becomes payable only after acceptance

```gherkin
Feature: Approval-mode sports booking
  Scenario: An accepted online request waits for customer payment
    Given an approval-mode venue accepts a customer's online booking request
    When the owner decides the request before it expires
    Then the booking becomes awaiting payment
    And its pay-by deadline is the earlier of the configured approval window and 30 minutes before start
    And the customer receives a sports_payment_due notification
    When the customer pays before that deadline
    Then the booking becomes accepted and records its paid time
```

### SP-07 — Instant pay-at-venue booking remains immediate and payment-free

```gherkin
Feature: Pay-at-venue compatibility
  Scenario: Instant pay-at-venue booking is accepted without online collection
    Given an instant resource allows pay-at-venue
    When a customer books an available slot using pay-at-venue
    Then the booking becomes accepted immediately
    And both parties receive a sports_booking_confirmed notification
    And no online payment is created
```

### SP-08 — Legacy pay-at-venue request behavior is preserved

```gherkin
Feature: Legacy sports booking requests
  Scenario: Existing clients can continue to request a pay-at-venue slot
    Given the existing sports feature is enabled
    When an existing client calls request_sports_slot with its established arguments
    Then the existing request, decision, status, and expiry behavior is preserved
    And the online-payment feature flag is not required for this legacy flow
```

### SP-09 — Only the booking customer can prepare a valid payment

```gherkin
Feature: Sports payment preparation
  Scenario: A customer prepares or reuses a payment attempt for their payable booking
    Given a customer owns a pending-payment or awaiting-payment booking before its deadline
    When the customer prepares payment
    Then the server returns the existing created attempt or creates one for the booking's server total
    When another user attempts to prepare payment for that booking
    Then the attempt is refused
```

### SP-10 — Failed payment can be retried while the hold remains valid

```gherkin
Feature: Sports payment retry
  Scenario: A failed attempt does not consume a valid booking hold
    Given a sports booking is still within its payment deadline
    When its payment attempt fails
    Then the attempt is marked failed and sports_payment_failed is sent
    When the customer retries
    Then a new payment attempt can be prepared for the same booking
```

### SP-11 — Verified payment accepts a booking only for the exact amount

```gherkin
Feature: Sports payment recording
  Scenario: A valid payment is recorded against its booking
    Given a payable booking has a payment attempt
    When the gateway confirms payment for exactly the attempt amount
    Then the payment is recorded once and the booking becomes accepted
    And the booking records paid_at and sends sports_booking_confirmed

  Scenario: A gateway amount mismatch is refused
    Given a sports payment attempt has a server-stored amount
    When payment recording receives a different amount
    Then the mismatch is refused without accepting the booking
```

### SP-12 — Expiry releases capacity and late payment is fully refunded

```gherkin
Feature: Sports payment expiry
  Scenario: An unpaid hold or approval deadline expires
    Given a pending-payment hold or awaiting-payment deadline has passed
    When the expiry worker runs
    Then the booking becomes expired and sports_booking_expired is sent
    And created payment attempts are retired
    And the slot's capacity is available to another customer

  Scenario: A payment arrives after its booking can no longer be accepted
    Given the booking hold has expired or the booking has been cancelled
    When the gateway confirms a late payment
    Then the payment remains recorded as paid
    And a full refund is queued and sports_refund_issued is sent
```

### SP-13 — Cancellation refunds follow the configured policy

```gherkin
Feature: Sports cancellation refunds
  Scenario: Customer cancellation uses the applicable time window
    Given an online-paid sports booking has venue cancellation rules or the default sports rules
    When the customer cancels at least the full-refund cutoff before start
    Then the eligible booking amount is fully refunded
    When the customer cancels between the full and partial cutoffs
    Then the configured partial refund is applied, capped at 5000 basis points
    When the customer cancels inside the partial-refund cutoff
    Then the booking amount is not refunded
    And a customer cancellation never refunds the customer fee

  Scenario: Venue cancellation refunds the entire customer payment
    Given an online-paid sports booking includes a customer fee
    When the venue cancels the booking
    Then the full payment including the customer fee is refunded
```

### SP-14 — Completion creates the venue owner's payout

```gherkin
Feature: Sports settlement
  Scenario: A completed online booking is settled once
    Given an online-paid sports booking is completed
    When the settlement path creates its payout
    Then gross is the price less recorded refunds
    And commission uses the booking-time basis-point snapshot with 18 percent GST on commission
    And the payout identifies the venue owner as payee
    And its release time follows the configured release delay
    And its transfer is allocated against the sports payment
```

### SP-15 — Turning off new online bookings does not strand existing work

```gherkin
Feature: Safe sports feature disablement
  Scenario: Existing online bookings still resolve after online payments are disabled
    Given an online sports booking or payment already exists
    And the online-payment feature is turned off
    When payment recording, expiry, cancellation, refund, or settlement runs
    Then the existing work is safely resolved
    And new online bookings are refused
    But pay-at-venue bookings remain available under the sports parent flag
```

### SP-16 — Customer read models expose the authoritative checkout amount and deadline

```gherkin
Feature: Sports booking read contract
  Scenario: Customer venue and booking reads describe current payment eligibility
    Given the sports parent is enabled and a verified venue has payment modes and resource rules
    When the customer reads the venue or one of their bookings
    Then the venue reports payment_modes and an online_payment_ready boolean
    And each resource reports booking_mode and capacity
    And the booking reports server total_paise, customer_fee_paise, payment_mode, refund_paise,
      participants, hold_expires_at, pay_by, and paid_at
    And online_payment_ready is true only when the effective online-payment feature is on,
      the venue allows online payment, and its owner payout account is activated
    And an online checkout displays total_paise and uses hold_expires_at for pending_payment
      or pay_by for awaiting_payment, never the request expires_at
    And the read result contains no payout-account identifiers or account details
```

### SP-17 — Merchant staff retain scoped sports reads and the parent read guard

```gherkin
Feature: Sports business read authorization
  Scenario: An active staff member reads only their assigned sports business
    Given merchant staff is enabled and an active member is assigned to a verified venue owner
    When the member reads business venues, booking lists, and a booking detail
    Then each authorized result preserves business_role
    And the result includes the same payment and capacity fields as the customer read contract
    And a nonmember cannot read that venue or booking

  Scenario: Sports reads remain subject to the sports parent switch
    Given sports is disabled
    When a member calls a business venue or booking read RPC
    Then the RPC is rejected
    And direct sports_bookings participant reads return no rows
```

### SP-18 — Owner payout readiness is independent of online booking eligibility

```gherkin
Feature: Venue payout-account readiness
  Scenario: An owner can check an activated payout account before enabling online payment
    Given the owner has an activated payout account
    And the venue accepts only pay-at-venue
    And sports_online_payments is off
    When the owner reads the management venue
    Then venue.payout_account_ready is true
    And online_payment_ready is false

  Scenario: An unactivated account is not ready and staff are not represented as owners
    Given the payout account is not activated
    When the owner reads the management venue
    Then venue.payout_account_ready is false
    When assigned staff reads the management venue
    Then venue.business_role remains staff
    And venue.payout_account_ready is absent
    And neither result exposes payout-account identifiers, status, or bank details
```

## Automation readiness

| Scenario | Planned observable SQL-test evidence |
|---|---|
| SP-01–SP-04 | `sports_payments.test.mjs`: instant hold and server total; overlapping race; capacity boundary; idempotency returns one booking. |
| SP-05 | Flag-off and parent-off/child-on rejection; online mode/account prerequisites; pay-at-venue unaffected. |
| SP-06–SP-08 | Approval request → awaiting_payment → accepted; instant pay-at-venue; legacy `request_sports_slot` compatibility. |
| SP-09–SP-11 | Attempt reuse/new retry; non-owner rejection; failure then retry; exact amount accepted; mismatch refused. |
| SP-12 | Hold expiry and pay-by expiry release capacity; created-attempt retirement; late paid attempt queues full refund. |
| SP-13 | Full/partial/zero cancellation refunds; venue cancellation includes fee; customer cancellation excludes fee. |
| SP-14 | Completion creates a single payout with expected commission, GST, payee, release time, and transfer allocation. |
| SP-15 | New online request is blocked while existing payment/refund/cancel/expiry/settlement paths and pay-at-venue remain safe. |
| SP-16 | Customer venue and booking reads expose accurate payment-mode/readiness and resource/booking fields; pending and approved checkout deadlines map to `hold_expires_at` and `pay_by`; payout identifiers are absent. |
| SP-17 | `get_my_business_sports_venues`, `get_my_business_sports_bookings`, `get_business_sports_booking`, and participant RLS preserve active staff scope, `business_role`, and the parent-flag guard. |
| SP-18 | `get_my_business_sports_venues` exposes owner-only `payout_account_ready` from activation state alone; it stays independent of online mode/feature eligibility and is absent for staff. |

These are acceptance criteria for E1's SQL tests; payment-edge routing tests are owned by E2. Tests and CI evidence are pending.

## Trace links

- DDD: [Sports Payments & Settlement — DDD](../../ddd/artifacts/sports-payments-ddd.md)
- Existing sports context: [Sports Venue Discovery & Booking Requests — DDD](../../ddd/artifacts/sports-bookings-ddd.md)
- Foundation money-safety rule: [Addendum Foundations — BDD](home-services-recurring-sports-foundations-bdd.md), W0-SC-04
- Governing plan: [Home Services, Recurring & Sports Payments](../../../../../../12-Home-Services-Recurring-Sports-Payments-Implementation-Plan.md), decisions R5–R10 and §6
- ADR: no separate ADR is identified by the plan; see the DDD artifact's ADR candidate for the shared-payment/payout boundary.
- Traceability: deferred to T2.

## Phase status

- **BDD:** acceptance scenarios defined from the implementation plan.
- **Implementation and SQL tests:** pending the artifact merge gate.
- **Local tests/builds:** not run, as required by the lane instructions.
- **CI validation:** pending.
