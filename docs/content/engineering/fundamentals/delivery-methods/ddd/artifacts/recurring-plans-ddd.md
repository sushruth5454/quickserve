# Recurring Plans & Visits — DDD

**Status:** Domain ownership and boundaries recorded for B1; runtime changes are committed on the B1 lane and CI validation is pending.

## Domain framing

The recurring capability lets a customer request a repeat service plan, lets an authorized provider manager decide whether to accept it, and creates ordinary, individually governed service bookings for eligible dates. The plan is the source of recurrence intent; each visit remains a booking with its own status and existing booking lifecycle. A change ledger records skip, unavailability, reschedule, absence, and cancellation outcomes without inventing booking statuses.

The implementation plan is the current business contract. B1 owns the recurring-plan migration and SQL tests. W0 owns shared feature/rule configuration, C1 owns the TypeScript date/type contract, G owns provider-facing calendar UX, and D1 owns future recurring billing cycles.

## Ubiquitous language

| Term | Meaning |
|---|---|
| **Recurring plan** | A customer's accepted or pending request for a service to be delivered on dates generated from one recurrence rule. Persisted in the existing `recurring_schedules` model. |
| **Occurrence / visit** | One scheduled service date produced by a plan. It is an individual existing `bookings` row and retains the existing booking status lifecycle. |
| **Recurrence rule** | The plan's frequency, interval, weekdays, month day, or explicit custom dates, clipped by its start/end and configured limits. |
| **Generation horizon** | The configured future date window in which the generator creates eligible occurrences. |
| **Generated-through date** | The plan's progress marker for the date range already examined by the generator. |
| **Activation materialization** | The synchronous materialization of eligible occurrences when a plan first becomes accepted, separate from later hourly horizon extension. |
| **Occurrence change** | An append-only record describing a meaningful change or decision for one plan date; it is not a booking status. |
| **Provider-unavailable date** | A planned date on which holiday mode, provider time off, or a booking/working-hours constraint prevents a new visit. The date is recorded and is not billed as a deliverable visit. |
| **Plan acceptance** | Provider approval of the recurring commitment. When plan-level acceptance is disabled, individual visits keep the existing provider-acceptance behavior. |
| **Skip cutoff** | The configured point after which a customer cannot skip a visit under the plan policy. |
| **Money-safety path** | A payment, refund, expiry, or cancellation path needed to resolve already-existing work; it remains safe when new recurring work is disabled. |
| **Per-date domain unavailability** | A recognized verification, category/service, pack-state, or legacy-input failure for one planned date. For legacy plans, exact `service not available` and `address is required` errors are expected. They are recorded as `provider_unavailable`, announced once, and do not system-pause the plan or stop the generation batch. |
| **Minimum materialization lead** | A new plan's first occurrence must be at least 60 minutes away at quote/legacy request and when the materializer creates it. A delayed older plan inside that window records the date unavailable rather than creating a too-late booking. |
| **Per-visit payment grace window** | A recurring per-visit obligation is due at the later of occurrence start minus configured lead hours or the current time, and remains payable through the configured grace period. The validated lead must exceed grace; the default is 48/24 hours. Expiry is capped at 30 minutes before service. |

## Bounded contexts and ownership

| Primary bounded context | Owns | Boundary and integration |
|---|---|---|
| **Recurring Plan Management** | Plan inputs, eligibility, quote projection, plan lifecycle, customer/provider authorization, and legacy recurring-schedule compatibility. B1 owns the `recurring_schedules` additions and plan RPCs. | Uses W0's feature-flag and `app_config.recurring_rules` policies, A1's category recurrence eligibility, existing archetype configuration, and the existing server-side service-price/fee rules. It does not own admin rule editing or app UI. |
| **Occurrence Scheduling** | Recurrence-date projection, generator progress, horizon handling, per-plan serialization, idempotent creation of eligible visits, activation materialization, and per-date error isolation. B1 owns `_recurrence_dates`, the generator wrapper, the guarded recurring cron, and provider-unavailable occurrence records. | Provider response, v2 auto-accept, and legacy schedule creation invoke the existing materializer synchronously before returning; the hourly service-role generator extends the horizon later. These security-definer callers may invoke the service-role-restricted materializer internally without exposing it to clients. New plans require a 60-minute lead; delayed occurrences inside that threshold are recorded unavailable. Recognized verification/service/category/pack-state errors, including exact legacy `service not available` and `address is required`, mark only that date unavailable, advance the examined horizon, and notify once. Unclassified errors propagate. |
| **Occurrence Change Management** | Skip, pause/resume, cancellation, reschedule request/response, and provider-absence decisions and their change records. B1 owns `recurring_occurrence_changes` and these recurring-specific operations. | Delegates booking status transitions, cancellation policy, refund behavior, and provider-window validation to the existing booking lifecycle and W0's shared availability guard. |
| **Existing Booking Lifecycle** | Individual booking status, payment/refund/cancellation/expiry policies, provider acceptance when per-occurrence mode is selected, booking overlap enforcement, and fixed/time-based booking creation. | Existing booking tables, status transitions, creators and cancellation paths remain authoritative. Recurring pending-payment occurrences keep reserving their provider window beyond the generic 30-minute pending-payment cutoff under the same advisory-lock discipline. The reservation guard runs on inserts and provider/window changes, not status-only payment transitions, so a valid webhook is not rolled back. The recurring expiry job processes each booking in its own rollback scope; failures are recorded in a sanitized service-role-only operational table, leave that booking and its reservation unchanged, and do not stop other expirations. |
| **Provider Availability** | Provider hours, pause/holiday state, provider time off, and exclusive booking-window availability. | Existing provider availability data plus W0's shared `_assert_provider_window_free` boundary and B1's recurring-pending guard, which uses the same provider advisory-lock key. New generation records an unavailable date rather than creating an invalid booking. |
| **Feature Governance** | Generic feature-flag registry, parent/child effective state, archetype flags, and validated admin-managed recurrence rules. W0/admin configuration owners maintain these policies. | B1 consumes the registered `recurring_bookings` master and child flags; unknown or disabled parent/child state fails closed. W0 validates individual rule fields; B1 adds only a forward migration guard for the recurring due/grace cross-field invariant and does not edit shared feature-registry or admin-rule migrations. |
| **Recurring Notifications** | Delivery, deduplication, notification kinds, and route interpretation. The existing notification subsystem owns delivery. | B1 emits the plan/visit event using the W0-registered notification kinds and existing notification queue; it does not create a separate notification channel. |
| **Recurring Billing** | Periodic charge cycles, due dates, retries, and cycle payment/refund accounting. D1 owns this future context. | B1 v2 accepts only `per_visit` billing and rejects weekly, monthly, and prepaid `billing_frequency` values even if their flags are manually enabled, until D1 is integrated. B1 floors `due_at` at creation time, refreshes it after schedule/rule changes, and expires unpaid occurrences at the earlier of the validated grace deadline or 30 minutes before service. D1 still owns cycle billing. The legacy `create_recurring_schedule` payment-mode contract remains unchanged. B1 also rejects positive recurring discounts until both v2 archetype charge paths apply the quoted discount. |

## Tactical design

| Model / service | Classification | Consistency responsibility |
|---|---|---|
| **RecurringPlan** | Aggregate rooted in `recurring_schedules` | Owns recurrence definition, provider acceptance, plan state, generation progress, and limits. Valid values are constrained by eligible categories, allowed frequencies, and admin rules. A pending plan has no generated visits. |
| **PlanVersion** | RecurringPlan discriminator | New v2 plans are marked separately from migrated legacy schedules so v2 category eligibility can be revalidated without retroactively changing the legacy schedule contract. |
| **RecurrenceRule** | Value object within RecurringPlan | Describes one of daily, alternate-day, weekly, monthly, or custom-date recurrence. Calendar calculation has one SQL source of truth in B1 and a separately tested TS counterpart in C1 using the same fixture vectors. |
| **Occurrence / Booking** | Existing booking aggregate; not a child status model of the plan | Each generated visit has its own existing status, payment, cancellation, and acceptance lifecycle. `acceptance_mode='plan'` means acceptance of the plan is sufficient; occurrence mode preserves existing per-visit acceptance. |
| **OccurrenceChange** | Append-only entity in `recurring_occurrence_changes` | Records plan/date, optional booking, original and new time, change kind, actor, reason, and timestamp. A unique plan/date/kind rule for skipped and provider-unavailable changes makes these generator outcomes idempotent. Direct client writes are not part of the model. |
| **Quote service** | Domain/application service | Validates the requested plan and obtains prices, fees, and tax from server-owned rules. The first occurrence must be at least 60 minutes ahead, and computed fixed-package duration must be 15–480 minutes. Quote calculation has no persistence side effects. Until both v2 charge paths apply recurring discounts, any positive category or global discount rejects the quote. |
| **Occurrence generator** | Application/domain service | The same idempotent materializer is called synchronously on acceptance and by the hourly extension job. It locks and processes eligible dates, creates one booking per available date, records blocked dates, advances progress, and stops at end/max-occurrence limits. A repeated run cannot duplicate a booking or recreate a skipped/unavailable date. Recognized verification/service/category/pack and legacy address errors become deduplicated provider-unavailable dates; unexpected errors propagate. |
| **Unpaid occurrence expiry** | Service-role lifecycle job | Locks one recurring pending-payment booking and its obligations, rechecks grace/buffer deadlines, fails open payment links, waives overdue unpaid rows, queues refunds for any already-paid part of an otherwise-pending occurrence, sets existing system `expired` status, records a cancelled change, and notifies both participants with collapse keys. Each booking runs in its own exception scope; failures roll back that booking's work and write a sanitized failure record, while other bookings continue. Fully paid visits remain untouched; stale paid webhooks use the existing refund path. |
| **Availability guard** | Existing shared domain service | Checks provider hours, pause/time off, job limits and overlapping bookings. Rescheduling must re-check inside the serialized provider-window boundary. |
| **Notification queue** | Existing integration service | Emits plan/visit notifications using registered kinds; reminder deduplication is keyed to the occurrence and an existing notification check/collapse key. |

## Invariants and policy boundaries

1. Only `time_based` and `fixed` service archetypes can recur; `inspect_quote` and `proposal` remain one-time.
2. Recurrence configuration is bounded by the implementation plan: interval 1–12, monthly day 1–28, custom list at most 120 dates on/after the start, and maximum occurrence count 1–400 when supplied.
3. Weekly recurrence requires weekdays; daily, alternate-day, monthly, and custom recurrence do not use weekdays. Monthly requires a month day; custom requires explicit dates.
4. Recurrence dates are clipped to the start, end, and configured maximum plan length and use the plan's local calendar date, start time, and timezone.
5. A plan must be accepted before plan-level occurrence generation. Pending and declined plans do not produce visits.
6. A plan-level accepted visit does not require another provider acceptance; occurrence acceptance mode preserves today's per-booking acceptance.
7. Each occurrence remains a regular booking with the existing statuses. Skips, provider-unavailable dates, reschedules, absence, and plan cancellation are represented in the change ledger, not as invented statuses.
8. Generation is repeatable: an existing plan/date booking is not duplicated; skipped or provider-unavailable dates are not regenerated; provider unavailability affects only that date.
9. A newly enabled provider holiday or time-off interval does not silently cancel already-created future visits. A provider explicitly reports an affected visit absent through the existing cancellation/refund path.
10. Feature switches block new capability use and generation as specified, but do not disable reading existing plans or money-safety operations required for existing work.
11. The legacy `create_recurring_schedule` RPC and existing recurring schedule rows keep their weekly behavior and existing status/transition semantics.
12. Recurring billing cycles and collection are outside B1 and remain owned by D1.
13. Cancelling an existing plan remains available when recurring bookings are disabled; the cancellation policy and required change records still apply.
14. Until D1 is integrated, B1 v2 only quotes/creates `per_visit`; the legacy `create_recurring_schedule` payment-mode contract remains unchanged. A positive recurring discount is not quoteable/creatable until its amount is reflected in both v2 archetype charge paths.
15. Legacy `create_recurring_schedule` requests are master/category/weekly-eligibility gated, while existing legacy plans remain readable/cancellable and keep accepted-provider and per-occurrence semantics.
16. A pending recurring occurrence remains an exclusive provider-window reservation after 30 minutes; the shared provider advisory lock serializes the check for inserts and rescheduling updates.
17. Recognized verification/service/category/pack errors are recorded and announced per occurrence; they advance the examined horizon without pausing the plan, even when `recurring_skip_pause` is OFF. Unclassified errors propagate.
18. Provider acceptance, v2 auto-accept, and legacy schedule creation materialize a first occurrence only when it is at least 60 minutes away; the later cron run cannot duplicate it. A delayed materializer records a date unavailable once it is inside 60 minutes.
19. Per-visit payment obligations use `greatest(scheduled_at - payment_due_hours_before, now())`; rescheduling or a valid rule update refreshes unpaid due times. Expiry is the earlier of `due_at + billing_grace_hours` and `scheduled_at - 30 minutes`. Paid portions of a partially paid occurrence are refunded through the existing refund path.
20. Expiry uses the existing `pending_payment -> expired` system transition, preserves fully paid visits, refunds any paid portion of a partially paid occurrence, and preserves time-based/fixed late-webhook refunds; it releases the provider window and records the cancelled date so generation cannot recreate it.
21. Every recurring-rules insert/update requires `payment_due_hours_before > billing_grace_hours`, including admin RPC and direct `app_config` writes. The default 48/24 pair expires ordinary holds 24 hours before service; the current-time due floor and 30-minute release cap govern near-term visits. A valid rule update refreshes pending `due_at` values atomically, and expiry reads the same locked configuration row.
22. A legacy plan whose provider service becomes inactive records and announces only the affected date from the exact expected `service not available` error; the valid plans in that generation batch still proceed and other errors propagate.
23. A fixed recurring package occurrence must have a computed duration from 15 through 480 minutes; a multi-unit quantity outside that limit is rejected before plan creation.
24. Legacy plan rows with an empty address are isolated as per-date `address is required` failures, while new legacy RPC requests are validated before inserting a plan.
25. An expiry failure rolls back only the failing booking, stores SQLSTATE and a static sanitized message in `recurring_expiry_failures`, keeps its unpaid status and provider reservation, and permits other bookings to expire and later retries to succeed.
26. Provider-fault cancellation is honored only when the actor is the booking's provider. Customer skip and pause always use customer cancellation semantics.

## Integration contracts and TDD seams

- **W0:** supplies `_recurring_feature`, registered recurring flags, `recurring_rules`, notification kinds, cron/availability helpers, and shared feature-gate semantics.
- **A1:** supplies category-level `recurrence_allowed` and `allowed_frequencies`.
- **Existing booking functions:** remain authoritative for booking creation, status transition, cancellation, refund, and payment behavior. B1 must inspect and use the latest definitions rather than duplicate their rules.
- **C1:** owns `app/src/features/recurring/types.ts` and `dates.ts`; SQL and TS date implementations share the plan's fixture vectors.
- **G:** owns provider calendar and plan-management UI; consumes B1's provider/list RPCs.
- **D1:** owns billing-cycle persistence and payment execution; B1 must not claim those behaviors.
- **SQL test seam:** `supabase/tests/recurring_plans.test.mjs` loads the real migration chain and appends B1's migration. Tests cover recurrence vectors, authorization, idempotency, ledger behavior, availability, legacy compatibility, feature gates, fixed duration and quote/charge boundaries, 60–90-minute lead and due-at flooring, per-date verification/pack/service/address errors, expiry rollback isolation and sanitized failure logging, actor-safe customer skips, deduplicated notifications, and paid/webhook safety.

## ADR linkage

- **Existing decision record:** No recurring-plan-specific ADR is currently in the repository. The recurring decisions here are grounded in the implementation plan; no ADR is cited as their approval.
- **Governing business/technical contract:** [Home Services, Recurring & Sports Payments](../../../../../../12-Home-Services-Recurring-Sports-Payments-Implementation-Plan.md), decisions R1–R4 and §5.
- **Proposed ADR candidate — not approved or authored:** Recurring plan and occurrence consistency. It could record the existing-plan reuse decision, separate booking-per-occurrence boundary, append-only change ledger, and idempotent generation contract if the owner requests a durable ADR. No file path or ADR identifier is assigned.
- **No ownership transfer is proposed:** recurring plans coordinate existing booking, availability, feature-governance, notification, and future billing contexts; those contexts retain their existing owners.

## Trace links

- BDD: [Recurring Plans & Visits — BDD](../../bdd/artifacts/recurring-plans-bdd.md)
- Traceability: owned by T2; not yet authored.
- Governing plan: [Home Services, Recurring & Sports Payments](../../../../../../12-Home-Services-Recurring-Sports-Payments-Implementation-Plan.md), §5.
