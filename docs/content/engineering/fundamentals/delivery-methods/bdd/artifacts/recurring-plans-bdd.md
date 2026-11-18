# Recurring Plans & Visits — BDD

**Status:** Behavior contract for B1; runtime changes are committed on the B1 lane and CI validation is pending.

## Discovery

- **Actors:** customer, provider, provider manager, authorized provider staff, recurring-occurrence generator, administrator.
- **Customer goal:** request a repeat service plan, understand its server-calculated quote, and manage future visits without losing a record of changes.
- **Provider goal:** accept or decline a plan and manage the visits it produces.
- **Scope:** recurring-plan validation and quotes; daily, alternate-day, weekly, monthly, and custom-date recurrence; accepted-plan generation; skip, pause, resume, cancellation, rescheduling, provider absence, holiday/time-off handling, reminders, access control, and compatibility with the legacy recurring-schedule RPC.
- **Out of scope:** recurring billing-cycle execution and payment collection (D1); customer or provider screens (C1/G); changes to the existing booking status model; recurrence for `inspect_quote` or `proposal` services.
- **Assumptions from the implementation plan:** only `time_based` and `fixed` archetypes can recur; the `recurring_bookings` master flag and its child flags are enforced server-side; category and admin-managed rules govern allowed frequencies and billing options; new customer-facing flags start OFF. Existing plans and bookings remain readable, and money-safety paths for existing work are not disabled by a feature switch.
- **Business-rule boundaries:** skip/reschedule cutoffs, generation horizon, maximum plan length, reminder lead time, and allowed frequencies come from validated admin-managed rules. Frequencies use schedule-local calendar dates and the plan's configured start time/timezone. B1 v2 supports `per_visit` only; its cycle/prepaid billing is rejected until D1 is integrated. Positive v2 recurring discounts are rejected until both archetype charge paths apply them. The legacy schedule RPC keeps its existing payment-mode contract.
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

  Scenario: Cycle billing is not quoted even when its flags are enabled
    Given recurring billing-cycle or prepaid flags have been enabled by an administrator
    When the customer requests a quote or creates a plan with weekly, monthly, or prepaid billing
    Then v2 weekly, monthly, and prepaid billing frequencies are rejected until D1's cycle engine is integrated
    And no plan or booking is created

  Scenario: A discount is not quoted until occurrence charges apply it
    Given a time-based or fixed category or the global recurring rules have a positive discount
    When the customer requests a quote or creates a plan
    Then the server rejects the request until both occurrence charge paths apply the configured discount
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

  Scenario: Accepting a plan materializes eligible near-term visits before returning
    Given the first eligible visit is 30 to 90 minutes away
    When the provider or manager accepts the plan
    Then the first visit exists before the acceptance RPC returns
    And the customer does not wait for the next hourly generator run
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
    And the auto-accepted plan materializes its first eligible visit before creation returns
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
    And its first eligible visit is materialized before the RPC returns
    And no existing booking status or transition is removed or renamed

  Scenario: New legacy schedule requests obey recurring and category eligibility
    Given recurring bookings are disabled or the service category disallows weekly recurrence
    When a caller submits a new legacy recurring-schedule request
    Then the server refuses the request

  Scenario: Existing legacy schedules remain readable and cancellable when recurring is disabled
    Given a legacy weekly schedule already exists
    And recurring bookings have been disabled
    When its participant reads or cancels that schedule
    Then the schedule remains readable and cancellation remains available
    And accepted-provider and per-occurrence lifecycle semantics are unchanged
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

  Scenario: Cycle billing remains unavailable until its engine is integrated
    Given recurring bookings and recurring billing child flags are enabled
    When a customer quotes or creates a weekly, monthly, or prepaid plan
    Then the server refuses the unsupported billing frequency
```

### RP-24 — Expected per-date domain errors are recorded and the batch continues

```gherkin
Feature: Per-date recurring occurrence failures
  Scenario: A v2 service or category invalidation affects only new dates
    Given an accepted v2 plan's service or category is no longer recurrence-eligible
    And another accepted plan has a valid occurrence in the same generation batch
    When the generator processes both plans
    Then each affected date is recorded as provider-unavailable and the customer is notified
    And the invalidated plan remains eligible for future dates
    And the valid plan still generates its occurrence in the same batch

  Scenario: A provider verification lapse marks only affected dates unavailable
    Given an accepted recurring plan's provider lacks a required, current verification
    And recurring skip/pause is disabled
    And another accepted plan has a valid occurrence in the same generation batch
    When the generator processes both plans
    Then each affected date is recorded as provider-unavailable and the customer is notified
    And the plan remains active with its generation progress advanced through the examined dates
    And the valid plan still generates its occurrence in the same batch
    And retrying the same dates creates no duplicate change or notification

  Scenario: An expired pack or an exhausted pack affects only its planned dates
    Given an accepted legacy plan references an expired pack or a pack with no unused sessions
    And another accepted plan has a valid occurrence in the same generation batch
    When the generator processes both plans
    Then the affected date is recorded as provider-unavailable and the customer is notified
    And the plan is not system-paused or blocked by the skip/pause feature flag
    And the valid plan still generates its occurrence in the same batch
```

### RP-25 — Recurring pending-payment visits reserve their provider window

```gherkin
Feature: Recurring visit reservations
  Scenario: A pending recurring occurrence remains reserved after the generic hold window
    Given a recurring occurrence is still pending payment after 30 minutes
    When another booking attempts to reserve an overlapping provider window
    Then the new booking is refused under the provider's serialized overlap lock
    And the recurring occurrence can still follow its existing payment and acceptance lifecycle

  Scenario: A status-only payment transition does not rerun the insert overlap guard
    Given a one-time pending booking predates a recurring occurrence in the same provider window
    And the one-time pending hold has aged beyond 30 minutes
    When its payment webhook transitions it from pending payment to requested
    Then the payment and status transition complete without the overlap trigger rolling them back
    And the recurring occurrence remains a single booking row
```

### RP-26 — Unexpected generator errors remain surfaced

```gherkin
Feature: Recurring generator error handling
  Scenario: An unclassified database error is not converted into an unavailable date
    Given the generator encounters an error outside recognized provider/service/pack availability cases
    When the generator processes the affected plan
    Then the database error propagates to the job caller
    And it is not silently recorded as ordinary provider unavailability
```

### RP-27 — Near-term first visits are materialized synchronously

```gherkin
Feature: Timely recurring occurrence creation
  Scenario: Accepted, auto-accepted, and legacy plans do not wait for the hourly cron
    Given a plan's first eligible occurrence is between 30 and 90 minutes away
    When it is accepted through provider response, auto-accepted at v2 creation, or created through the legacy RPC
    Then an eligible first booking exists before that RPC returns
    And a later hourly generator run creates no duplicate
```

### RP-28 — Unpaid recurring visits expire and release provider windows safely

```gherkin
Feature: Per-visit recurring payment expiry
  Scenario: An unpaid visit remains reserved through its configured grace window
    Given a recurring per-visit obligation has a due time and grace period from validated rules
    And the obligation is unpaid and due_at plus grace is still in the future
    When the expiry job runs
    Then the visit remains pending payment and continues reserving the provider window

  Scenario: An overdue unpaid visit expires through the existing lifecycle
    Given all per-visit obligations for an occurrence are unpaid and due_at plus grace has passed
    When the service-role expiry job runs
    Then the payment links are failed for cancellation and obligations are waived
    And the booking transitions to expired and its provider window is released
    And the customer and provider are notified once
    And the occurrence is not regenerated

  Scenario: A partially paid fixed visit expires without retaining a charge
    Given a fixed occurrence is still pending payment with one paid obligation
    And every remaining obligation is unpaid and due_at plus grace has passed
    When the service-role expiry job runs
    Then only the unpaid obligations are waived
    And the already-paid amount is refunded through the existing refund path
    And the booking transitions to expired and its provider window is released

  Scenario: Paid visits and late time-based or fixed webhooks are not stranded by expiry
    Given a visit was paid before the expiry job or a valid time-based or fixed webhook arrives after expiry
    When the expiry job or payment recorder runs
    Then a paid visit is not expired
    And a late payment is refunded through the existing stale-payment path
    And the expired booking status and released slot remain unchanged
```

### RP-29 — Recurring payment windows are valid and expire before service

```gherkin
Feature: Valid recurring payment windows
  Scenario: The seeded rules expire unpaid holds one day before service
    Given the recurring rules use the new default payment_due_hours_before of 48 and billing_grace_hours of 24
    When a per-visit obligation is created
    Then due_at is 48 hours before the occurrence
    And its expiry deadline is 24 hours before the occurrence

  Scenario: Invalid due/grace pairs are rejected by every rules write path
    Given recurring rules are being changed through admin_set_rules or direct app_config mutation
    When payment_due_hours_before is less than or equal to billing_grace_hours
    Then the write is rejected and the previously validated rules remain unchanged

  Scenario: A valid rules change refreshes pending occurrence deadlines
    Given a recurring occurrence has unpaid obligations
    When the recurring rules are updated with a valid payment_due_hours_before value
    Then each pending due_at is recomputed from scheduled_at using the new value
    And expiry continues to use the matching validated billing_grace_hours

  Scenario: An overdue hold is released before its scheduled service time
    Given a recurring visit is still pending payment
    And its due_at plus billing_grace_hours has passed while its scheduled time is still in the future
    When the expiry job runs
    Then the booking expires and the provider window is available before service
```

### RP-30 — An inactive legacy service does not starve generation

```gherkin
Feature: Legacy recurring service invalidation
  Scenario: A deactivated legacy service is recorded per date while another plan generates
    Given an accepted legacy plan references a provider service that has since been deactivated
    And another accepted plan has a valid occurrence in the same generator batch
    When the hourly generator runs
    Then the legacy date is recorded and notified once as provider-unavailable
    And that legacy plan remains active with its examined progress advanced
    And the valid plan still generates its occurrence in the same batch
    And retrying the date does not duplicate its ledger entry or notification
    And unexpected database errors still propagate
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
9. B1 v2 quotes and creates only `per_visit` plans; positive category or global discounts remain rejected until both v2 archetype charge paths apply them.
10. Service/category invalidation, verification lapse, and pack expiration/exhaustion are recorded and announced per date, do not system-pause a plan when skip/pause is OFF, and do not block valid plans in the same batch.
11. A pending recurring payment occurrence continues reserving its provider window after the generic 30-minute pending-payment cutoff, while a status-only payment transition is not subjected to the insert/window-change guard.
12. Unclassified database errors propagate rather than being swallowed as availability outcomes.
13. Provider response, v2 auto-accept, and legacy schedule creation synchronously materialize near-term occurrences; a later cron run is idempotent.
14. Per-visit `due_at` uses `payment_due_hours_before`; unpaid recurring bookings expire only after `billing_grace_hours`, while paid/late-webhook money-safety paths remain intact.
15. Every insert/update of recurring rules preserves `payment_due_hours_before > billing_grace_hours`; missing payment-window values default to 48/24 hours, and an overdue hold can release before its service time.
16. The exact `service not available` error from an inactive legacy provider service is recorded as per-date unavailability, while unrelated errors still abort generation.

## Automation readiness

Each row names one primary bounded context from the DDD artifact. These are planned assertions for `supabase/tests/recurring_plans.test.mjs`; local tests are not part of this artifact phase.

| Scenario IDs | Primary DDD context | Planned observable test |
|---|---|---|
| RP-01–RP-04 | Recurring Plan Management | Flag-off and child-parent-off rejections; safe quote has no writes; unsupported billing, positive discounts, and invalid/ineligible inputs are rejected. |
| RP-05–RP-06 | Provider Plan Acceptance | Create leaves zero occurrences; provider/manager acceptance generates; decline requires a reason and notifies. |
| RP-07–RP-10 | Occurrence Scheduling | Fixture vectors; one booking per eligible date; repeat generation is idempotent; end/max-occurrence limits hold. |
| RP-11 | Provider Plan Acceptance | Acceptance child flag off selects occurrence-level acceptance. |
| RP-12–RP-14 | Occurrence Change Management | Skip cutoff/idempotency; pause/resume behavior; recorded cancellation changes. |
| RP-15–RP-17 | Provider Availability | Holiday/time-off and overlap create unavailable changes only; pre-existing visits are untouched. |
| RP-18 | Occurrence Change Management | Request, accepted move, decline, cutoff, and occupied-window behavior. |
| RP-19 | Existing Booking Lifecycle | Provider absence uses the existing cancellation/refund path and records the change. |
| RP-20 | Recurring Plan Management | Participant reads, unauthorized customer rejection, and manager-versus-staff response authorization. |
| RP-21 | Legacy Booking Compatibility | New legacy requests obey master/category gates; existing schedules remain readable/cancellable with legacy behavior. |
| RP-22 | Recurring Notifications | Reminder feature gating and duplicate suppression; reminder-off does not disable generation. |
| RP-23 | Recurring Plan Management | Skip/pause, reschedule, and prepaid child-flag rejections; plan cancellation remains available with the master flag off. |
| RP-24 | Occurrence Scheduling | Service/category, verification, and expired/exhausted-pack failures record and notify per date while another plan generates; retry dedupes and the plan remains eligible. |
| RP-25 | Existing Booking Lifecycle | A stale recurring pending row blocks overlapping inserts, but a status-only payment webhook transition succeeds. |
| RP-26 | Occurrence Scheduling | Unclassified database errors propagate instead of being silently dropped. |
| RP-27 | Occurrence Scheduling | Provider-accepted, auto-accepted, and legacy plans materialize a 30–90-minute first visit synchronously; later generation does not duplicate it. |
| RP-28 | Existing Booking Lifecycle | Due/grace rules set due_at; unpaid rows expire and release holds; paid and late-webhook paths remain safe. |
| RP-29 | Existing Booking Lifecycle | The 48/24-hour default, cross-field rejection on admin/direct writes, and pre-service window release are verified. |
| RP-30 | Occurrence Scheduling | An inactive legacy service records/notifies only its date while a valid plan in the same generator batch succeeds; retry dedupes. |

## Trace links

- DDD: [Recurring Plans & Visits — DDD](../../ddd/artifacts/recurring-plans-ddd.md)
- Traceability: owned by T2; planned artifact `../../bdd-ddd-tdd/artifacts/recurring-plans-traceability.md`.
- Governing plan: [Home Services, Recurring & Sports Payments](../../../../../../12-Home-Services-Recurring-Sports-Payments-Implementation-Plan.md), §§1 and 5.
- Related decision: [ADR-0001 — Feature Flag Registry](../../../../../../adr/ADR-0001-feature-flag-registry.md).
- Recurring lifecycle and occurrence-consistency ADR candidate: recorded in the DDD artifact; not yet approved or authored.
