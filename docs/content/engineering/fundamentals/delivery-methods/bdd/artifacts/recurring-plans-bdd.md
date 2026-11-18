# Recurring Plans & Visits — BDD

**Status:** Behavior contract for B1; runtime implementation and CI validation pending.

## Discovery

- **Actors:** customer, provider, provider manager, authorized provider staff, recurring-occurrence generator, administrator.
- **Customer goal:** request a repeat service plan, understand its server-calculated quote, and manage future visits without losing a record of changes.
- **Provider goal:** accept or decline a plan and manage the visits it produces.
- **Scope:** recurring-plan validation and quotes; daily, alternate-day, weekly, monthly, and custom-date recurrence; accepted-plan generation; skip, pause, resume, cancellation, rescheduling, provider absence, holiday/time-off handling, reminders, access control, and compatibility with the legacy recurring-schedule RPC.
- **Out of scope:** recurring billing-cycle execution and payment collection (D1); customer or provider screens (C1/G); changes to the existing booking status model; recurrence for `inspect_quote` or `proposal` services.
- **Assumptions from the implementation plan:** only `time_based` and `fixed` archetypes can recur; the `recurring_bookings` master flag and its child flags are enforced server-side; category and admin-managed rules govern allowed frequencies and billing options; new customer-facing flags start OFF. Existing plans and bookings remain readable, and money-safety paths for existing work are not disabled by a feature switch.
- **Business-rule boundaries:** skip/reschedule cutoffs, generation horizon, maximum plan length, reminder lead time, and allowed frequencies come from validated admin-managed rules. Frequencies use schedule-local calendar dates and the plan's configured start time/timezone.
- **Unresolved questions:** none block defining this contract. Prices, fees, discount, time windows, and policy values must be resolved from existing server-side pricing logic and admin-managed rules; the client is never authoritative.

## Scenarios

### RP-01 — A disabled recurring feature refuses new plans

```gherkin
Feature: Recurring service plans
  Scenario: A customer cannot quote or create a plan while recurring bookings are disabled
    Given the administrator has disabled recurring bookings
    When a customer requests a recurring-plan quote or submits a new plan
    Then the server refuses the request with the feature-off response
    And the customer is not shown a recurring-plan entry point

  Scenario: Disabling recurring bookings stops new visits but preserves existing work
    Given an accepted plan already has visits and recurring bookings are disabled
    When the occurrence generator runs
    Then it creates no new visits
    And existing plans and visits remain readable and existing visits continue their normal lifecycle
```

### RP-02 — Child capabilities cannot bypass the recurring master switch

```gherkin
Feature: Recurring capability controls
  Scenario: A child capability remains unavailable when its parent is disabled
    Given recurring bookings are disabled
    And a recurring child capability is enabled
    When a customer or provider attempts the child capability
    Then the server refuses the action because the recurring master is disabled
```

### RP-03 — A quote validates the plan and uses server rules

```gherkin
Feature: Recurring-plan quotes
  Scenario: A customer receives a quote for a valid eligible plan
    Given the service category permits the selected archetype and frequency
    And the plan inputs satisfy the configured recurrence and billing rules
    When the customer requests a quote
    Then the quote contains the server-calculated visit price, applicable fees and tax, discount, and cycle total
    And it reports the first cycle's visit count, total visit count when bounded, billing frequency, and next ten dates
    And no plan or booking is created
```

### RP-04 — Invalid or ineligible recurrence details are rejected

```gherkin
Feature: Recurrence eligibility
  Scenario: A plan cannot use an unsupported service, frequency, or date definition
    Given a customer submits a plan with one or more invalid recurrence inputs
    And its category, archetype, frequency, interval, month day, or custom dates violate the plan rules
    When the customer requests a quote or creates the plan
    Then the server rejects the request without creating a plan or booking
```

### RP-05 — A valid plan waits for provider acceptance

```gherkin
Feature: Provider plan acceptance
  Scenario: Creating a plan does not schedule visits before provider approval
    Given a customer submits a valid recurring plan
    When the plan is created
    Then the plan is pending provider acceptance
    And no occurrence booking exists
    And the provider receives a plan-request notification
```

### RP-06 — A provider manager accepts or declines a plan

```gherkin
Feature: Provider plan decisions
  Scenario: An authorized manager accepts a pending plan
    Given a plan is pending provider acceptance
    When the provider or an authorized provider manager accepts it
    Then the plan is accepted
    And eligible visits are scheduled within the configured horizon
    And the customer receives an acceptance notification

  Scenario: A provider manager declines a pending plan with a reason
    Given a plan is pending provider acceptance
    When an authorized manager declines it with a reason
    Then the plan becomes cancelled
    And the customer receives a decline notification containing the decision
```

### RP-07 — Calendar frequencies produce the agreed dates

```gherkin
Feature: Recurrence dates
  Scenario: The plan follows its selected calendar frequency
    Given a plan uses daily, alternate-day, weekly, monthly, or custom-date recurrence
    When its dates are calculated within the configured plan range
    Then only dates matching that frequency, interval, weekdays, month day, or custom date list are returned
    And all dates are on or after the plan start and no later than its end or configured maximum length
```

### RP-08 — Shared date examples remain consistent

```gherkin
Feature: Recurrence date examples
  Scenario: Supported calendar examples return their specified first dates
    Given the recurrence inputs from the implementation plan's shared date fixture vectors
    When the plan dates are calculated
    Then each vector returns exactly its specified first dates in chronological order
```

### RP-09 — Generation creates individual visits and is safe to repeat

```gherkin
Feature: Recurring visit generation
  Scenario: An accepted plan produces one booking per eligible date
    Given an accepted active plan is inside its generation window
    When the occurrence generator runs
    Then an individual booking is created for each eligible available date
    And plan-level acceptance does not require the provider to accept each visit again
    And the generator records its progress

  Scenario: Re-running generation does not duplicate visits
    Given the generator has already processed an accepted plan's date window
    When the same window is generated again
    Then no date has more than one booking for that plan
    And a date already recorded as skipped or provider-unavailable is not recreated
```

### RP-10 — Generation respects plan limits

```gherkin
Feature: Plan limits
  Scenario: A plan stops at its configured end or maximum occurrence count
    Given an accepted plan has an end date or maximum occurrence count
    When the generator reaches that boundary
    Then it creates no later or additional visits
    And the plan is marked completed when its configured lifetime is exhausted
```

### RP-11 — Acceptance mode falls back to per-visit decisions when disabled

```gherkin
Feature: Provider acceptance mode
  Scenario: Disabling plan-level acceptance preserves per-visit provider decisions
    Given recurring bookings are enabled
    And recurring plan acceptance is disabled
    When a customer creates a plan and its visits are generated
    Then the plan uses occurrence-level acceptance
    And each visit follows the existing booking acceptance rules
```

### RP-12 — A customer skips a visit before the cutoff

```gherkin
Feature: Visit skipping
  Scenario: A customer skips an eligible future visit
    Given skip and pause are enabled
    And a customer owns a visit that is before the configured skip cutoff
    When the customer skips the visit
    Then no cancellation charge applies before the cutoff
    And any prepaid amount is refunded through the existing cancellation policy
    And a skipped change is recorded for the occurrence
    And repeating the request does not create another change or restore the visit
```

### RP-13 — A customer cannot skip after the cutoff

```gherkin
Feature: Visit skipping
  Scenario: A late skip request is refused
    Given a visit is at or beyond the configured skip cutoff
    When the customer attempts to skip it
    Then the server refuses the request
    And the visit and its change history remain unchanged
```

### RP-14 — Pause and resume preserve plan history

```gherkin
Feature: Recurring-plan pause
  Scenario: Pausing cancels only eligible future unpaid visits
    Given skip and pause are enabled
    And a customer owns an active plan with future unpaid visits
    When the customer pauses the plan
    Then the plan is paused
    And only future unpaid visits beyond the configured cutoff are cancelled and recorded
    And already-completed or otherwise ineligible visits are unchanged

  Scenario: Resuming an eligible plan fills its future schedule
    Given a customer owns a paused plan that has not been cancelled or completed
    When the customer resumes it
    Then the plan is active
    And eligible future visits are generated without duplicates

  Scenario: Cancelling an existing plan remains available when new plans are disabled
    Given a customer owns an existing plan with future visits
    And recurring bookings have been disabled
    When the customer cancels the plan with a reason
    Then the plan is cancelled and future visits follow the existing cancellation policy
    And cancellation changes are recorded and the provider is notified
    And the feature switch does not block this existing-work safety action
```

### RP-15 — Provider holidays and time off prevent new visits

```gherkin
Feature: Provider availability
  Scenario: A provider-unavailable date is recorded without creating a visit
    Given an accepted plan has a date during provider holiday mode or provider time off
    When the generator processes that date
    Then no booking is created for that date
    And a provider-unavailable change is recorded once
    And the customer receives an unavailability notification
```

### RP-16 — An occupied date does not block other occurrences

```gherkin
Feature: Visit availability
  Scenario: A conflicting provider booking excludes only the conflicting date
    Given an accepted plan has multiple dates and another booking occupies one provider window
    When the generator processes the plan
    Then the conflicting date is recorded as provider-unavailable with no new booking
    And other available dates still receive their individual bookings
```

### RP-17 — A new holiday does not silently cancel existing visits

```gherkin
Feature: Existing visit protection
  Scenario: Provider unavailability does not mass-cancel already-created future visits
    Given a provider has already-created future visits on an accepted plan
    When the provider enables holiday mode or records new time off
    Then those existing visits remain unchanged
    And the provider can report an affected visit as an absence through the cancellation policy
```

### RP-18 — Rescheduling requires an available time and both parties' decision

```gherkin
Feature: Visit rescheduling
  Scenario: A party requests a valid reschedule and the other party accepts
    Given rescheduling is enabled and a visit is before the configured cutoff
    And the requested time is within provider hours and has no conflicting booking
    When one party requests the new time and the other party accepts
    Then the visit moves to the requested time
    And the request and accepted change are recorded
    And the affected party receives the appropriate notification

  Scenario: A conflicting or declined reschedule does not move the visit
    Given a reschedule is requested for an occupied time or the other party declines it
    When the availability check or response is processed
    Then the original visit time remains unchanged
    And the outcome is recorded as declined when a request existed
```

### RP-19 — A provider absence follows the existing refund path

```gherkin
Feature: Provider absence
  Scenario: A provider reports absence for an existing paid visit
    Given a provider owns a recurring visit with a recorded payment
    When the provider reports an absence with a reason
    Then the occurrence is cancelled through the existing provider-cancellation policy
    And the paid amount is fully refunded
    And the absence is recorded and the customer is notified
```

### RP-20 — Recurring-plan data is limited to authorized participants

```gherkin
Feature: Recurring-plan access
  Scenario: An unrelated customer cannot read or change a plan
    Given a recurring plan and its visits belong to a customer and a provider
    When another customer attempts to read or change the plan
    Then the server refuses the request
    And the customer and provider participants can read permitted plan details

  Scenario: Provider staff without manager authority cannot decide a plan
    Given a plan is pending and provider staff does not have manager authority
    When the staff member attempts a plan-level decision
    Then the server refuses the decision

  Scenario: An authorized manager can decide a pending plan
    Given a plan is pending and the caller is an authorized provider manager
    When the manager responds to the plan
    Then the decision is accepted by the server
```

### RP-21 — Existing recurring-schedule callers keep their behavior

```gherkin
Feature: Legacy recurring schedule compatibility
  Scenario: A legacy caller can still create a weekly recurring schedule
    Given a caller uses the existing recurring-schedule contract
    When the legacy schedule is created
    Then it retains the existing weekly behavior and accepted provider behavior
    And no existing booking status or transition is removed or renamed
```

### RP-22 — Reminders are optional and idempotent

```gherkin
Feature: Upcoming visit reminders
  Scenario: An enabled reminder is queued once for an upcoming visit
    Given recurring bookings and recurring reminders are enabled
    And a visit is within the configured reminder window
    When the reminder job runs more than once
    Then the customer receives at most one reminder for that visit

  Scenario: Turning reminders off does not stop visit generation
    Given recurring bookings are enabled and recurring reminders are disabled
    When the reminder and occurrence jobs run
    Then no recurring reminder is queued
    And eligible visits are still generated
```

### RP-23 — Child switches gate only their own new capabilities

```gherkin
Feature: Recurring child capabilities
  Scenario: Skip, pause, and resume are refused when their child switch is off
    Given recurring bookings are enabled and recurring skip/pause is disabled
    When a customer attempts to skip, pause, or resume a plan
    Then the server refuses that action

  Scenario: Rescheduling is refused when its child switch is off
    Given recurring bookings are enabled and recurring rescheduling is disabled
    When either party requests or responds to a reschedule
    Then the server refuses that action and leaves the visit time unchanged

  Scenario: Prepaid package creation is refused when its child switch is off
    Given recurring bookings are enabled and prepaid recurring packages are disabled
    When a customer requests a quote or creates a prepaid-package plan
    Then the server refuses the prepaid-package option
    And existing plans and their money-safety operations remain available
```

## Acceptance criteria

1. The six date fixture vectors in the implementation plan produce exactly the listed dates.
2. A newly created plan has no bookings before provider acceptance; a decline requires a reason.
3. Repeated generation creates no duplicate booking and never recreates skipped or provider-unavailable dates.
4. A skip/unavailability ledger entry is unique per plan/date/kind; late skips and invalid reschedules do not alter the occurrence.
5. Provider holiday/time-off and an occupied window prevent only the affected new occurrence; already-created future visits are not automatically cancelled.
6. Every plan/visit query and mutation enforces participant and provider-role rules.
7. The master and child feature switches fail closed, while existing-work cancellation/refund paths remain available.
8. The legacy `create_recurring_schedule` contract and existing booking statuses remain supported.

## Automation readiness

Each row names one primary bounded context from the DDD artifact. These are planned assertions for `supabase/tests/recurring_plans.test.mjs`; local tests are not part of this artifact phase.

| Scenario IDs | Primary DDD context | Planned observable test |
|---|---|---|
| RP-01–RP-04 | Recurring Plan Management | Flag-off and child-parent-off rejections; valid quote has no writes; invalid/ineligible inputs are rejected. |
| RP-05–RP-06 | Provider Plan Acceptance | Create leaves zero occurrences; provider/manager acceptance generates; decline requires a reason and notifies. |
| RP-07–RP-10 | Occurrence Scheduling | Fixture vectors; one booking per eligible date; repeat generation is idempotent; end/max-occurrence limits hold. |
| RP-11 | Provider Plan Acceptance | Acceptance child flag off selects occurrence-level acceptance. |
| RP-12–RP-14 | Occurrence Change Management | Skip cutoff/idempotency; pause/resume behavior; recorded cancellation changes. |
| RP-15–RP-17 | Provider Availability | Holiday/time-off and overlap create unavailable changes only; pre-existing visits are untouched. |
| RP-18 | Occurrence Change Management | Request, accepted move, decline, cutoff, and occupied-window behavior. |
| RP-19 | Existing Booking Lifecycle | Provider absence uses the existing cancellation/refund path and records the change. |
| RP-20 | Recurring Plan Management | Participant reads, unauthorized customer rejection, and manager-versus-staff response authorization. |
| RP-21 | Legacy Booking Compatibility | Existing `create_recurring_schedule` contract still creates a weekly schedule with legacy behavior. |
| RP-22 | Recurring Notifications | Reminder feature gating and duplicate suppression; reminder-off does not disable generation. |
| RP-23 | Recurring Plan Management | Skip/pause, reschedule, and prepaid child-flag rejections; plan cancellation remains available with the master flag off. |

## Trace links

- DDD: [Recurring Plans & Visits — DDD](../../ddd/artifacts/recurring-plans-ddd.md)
- Traceability: owned by T2; planned artifact `../../bdd-ddd-tdd/artifacts/recurring-plans-traceability.md`.
- Governing plan: [Home Services, Recurring & Sports Payments](../../../../../../12-Home-Services-Recurring-Sports-Payments-Implementation-Plan.md), §§1 and 5.
- Related decision: [ADR-0001 — Feature Flag Registry](../../../../../../adr/ADR-0001-feature-flag-registry.md).
- Recurring lifecycle and occurrence-consistency ADR candidate: recorded in the DDD artifact; not yet approved or authored.
