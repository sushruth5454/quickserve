# Sports Online Payments & Settlement — DDD

## Domain framing

Sports online payments extend dedicated sports bookings with payment collection, capacity holds, cancellation refunds, and venue-owner settlement. They reuse the platform's shared payments, refunds, payouts, and transfer records; they do not create a second payment system or move sports bookings into the home-services `bookings` state machine.

The plan identifies customers, venue owners, administrators, the payment gateway, and scheduled workers as actors. E1 owns the sports payment migration and SQL tests. E2 owns shared payment edge-function routing and payout-account enrollment/release changes. The integrator owns migration-chain and notification registrations.

## Ubiquitous language

| Term | Meaning |
|---|---|
| Sports venue | A sports location managed by an owner and subject to venue verification. |
| Resource | A bookable court, turf, class, pool, or other capacity-bearing unit at a venue. |
| Booking mode | `instant` accepts an eligible booking immediately; `approval` requires an owner decision. |
| Payment mode | `online` collects through the shared payment system; `pay_at_venue` preserves the existing direct-payment flow. |
| Capacity | Maximum concurrent participants for a resource; occupancy is the sum of participants in overlapping live bookings. |
| Payment hold | A time-bounded reservation for an instant online booking in `pending_payment`. |
| Pay-by deadline | The time by which a customer must pay an approved online booking in `awaiting_payment`. |
| Booking total | Server-computed price plus customer fee, in integer paise. |
| Commission snapshot | The booking-time sports commission rate in basis points used later for settlement. |
| Late payment | A gateway-confirmed payment for a booking that has expired or been cancelled; it remains recorded as paid and receives a full queued refund. |
| Sports payout | The shared payout record for one completed online sports booking, payable to the venue owner. |

## Bounded context map

| Context | Responsibility and owner | Boundary / integration |
|---|---|---|
| **Sports Venue Management** | Venue owners manage resources and payment modes; admins verify venues. Existing sports domain. | `sports_venues`, `sports_resources`, venue payment modes and cancellation rules. A venue's online eligibility also requires the owner's verified payout account. |
| **Sports Booking & Capacity** | E1 owns booking eligibility, status transitions, idempotency, and capacity reservation. | `sports_bookings`; `book_sports_slot`, updated `get_sports_slots`, and extended `decide_sports_booking`, `cancel_sports_booking`, and `expire_sports_requests`. Existing `request_sports_slot` remains compatible. |
| **Shared Payments & Refunds** | Platform payment domain owns gateway attempts, paid/failed state, refund queueing, and refund processing. E1 adds the sports parent relationship and booking RPCs; E2 owns edge routing. | Shared `payments` and `refunds`; `prepare_sports_payment`, `record_sports_payment_paid`, and the existing payment/refund processing contract. |
| **Payout & Settlement** | Platform payout domain owns release and transfer execution; E1 creates a sports payout when an online booking completes; E2 updates shared release behavior. | Shared `payouts` and `payout_transfers`, linked to the sports payment and addressed to the venue owner through `payee_id`. |
| **Feature Governance** | W0 owns effective parent/child switch semantics. E1 enforces the switch for new online booking/payment work without gating money-safety operations for existing work. | `sports_online_payments` requires parent `sports`; pay-at-venue compatibility and existing payment, refund, cancellation, expiry, and settlement paths remain safe. |
| **Notifications** | Existing notification infrastructure carries booking, payment, expiry, cancellation, and refund outcomes. | W0/integrator registers the kinds; E1 emits `sports_booking_confirmed`, `sports_payment_due`, `sports_payment_failed`, `sports_booking_expired`, `sports_booking_cancelled`, and `sports_refund_issued` as applicable. |

### Context map summary

Sports Booking & Capacity is authoritative for reserving a resource and its booking status. It calls into the shared payment/refund model rather than owning gateway state. The shared payout model receives a sports-specific payout at completion and retains responsibility for later release. The payment gateway is external and reaches the domain through E2's existing edge-function boundary. UI and venue-account setup remain outside E1.

## Tactical design and invariants

| Model / service | Consistency responsibility |
|---|---|
| **SportsBooking aggregate** | One `sports_bookings` row owns customer, resource, interval, participants, payment mode, status, hold/pay-by deadline, fee/total, paid time, refund amount, and idempotency key. A booking has at most one active created payment attempt and one sports payout. |
| **Resource capacity reservation policy** | All create/availability checks serialize on the resource advisory lock. Occupancy sums participants for overlapping accepted bookings and for unexpired requested, awaiting-payment, and pending-payment bookings. A reservation is admitted only if used plus requested participants does not exceed configured capacity. |
| **PaymentAttempt** | A row in shared `payments` has exactly one parent, including `sports_booking_id`. Its server amount equals the booking total. Gateway payment IDs are deduplicated. A valid late payment remains paid and is fully refunded rather than erased or accepted. |
| **Cancellation/refund policy** | Venue cancellation refunds the full customer payment including fee. Customer cancellation follows venue rules or `sports_rules`; the customer fee is non-refundable, and the partial refund rate is capped at 5000 basis points. The resulting refund amount is stored and queued through shared refund machinery. |
| **Sports payout policy** | A private `_create_sports_payout(p_sports_booking_id uuid)` creates at most one shared payout. Gross is price less recorded refunds; commission uses the booking-time basis-point snapshot; GST is 18% of commission; payee is `sports_venues.owner_id`; release time follows configured `release_after_hours`; transfers are allocated against the sports payment. |
| **Sports read projections** | Public/customer and business RPCs return current venue payment modes, online-payment eligibility, resource booking mode/capacity, and booking-time payment facts. The management venue result exposes top-level `payout_account_ready` to its owner from activated-account state alone; it is independent of venue payment modes and feature switches. Staff retain their nested `venue.business_role` and do not receive the top-level readiness field. No projection exposes payout-account identifiers, status, or bank details. |
| **Feature policy** | New online sports bookings require both the `sports` parent and `sports_online_payments`, venue online mode, and an activated owner payout account. `sports_online_payments` defaults OFF. Feature-off does not disable processing of existing payments/refunds, expiry, customer cancellation, or payout settlement. |
| **Legacy compatibility policy** | `request_sports_slot` and existing pay-at-venue status behavior remain available; the feature does not add a parallel sports or home-services booking state machine. |

### State and consistency rules

1. Instant online booking reserves capacity as `pending_payment` until its hold expires or payment succeeds.
2. Approval-mode online booking remains `requested` until owner acceptance; acceptance moves it to `awaiting_payment`, with the pay-by deadline bounded by both configured approval time and 30 minutes before start.
3. Pay-at-venue instant booking is `accepted` immediately; approval-mode pay-at-venue retains the existing request/accept flow.
4. The server computes price, customer fee, total, commission snapshot, and refund amounts from managed rules; all stored money uses paise and rates use basis points.
5. A paid booking is accepted only when its payment amount matches the server amount and its payment window is still valid. A late payment is recorded as paid and fully refunded.
6. Expiry retires created attempts and releases capacity. An expired or cancelled booking cannot be revived by payment.
7. Payout creation is idempotent and only follows completion of an online-paid booking.
8. For checkout, `total_paise` is authoritative; `hold_expires_at` is the deadline while `pending_payment`, and `pay_by` is the deadline while `awaiting_payment`. The legacy request `expires_at` is not an online-payment deadline.
9. `online_payment_ready` is true only when the effective `sports_online_payments` child (including its `sports` parent), venue `payment_modes`, and activated owner payout-account prerequisites all allow a new online booking.

## Application and persistence contracts

| Contract | Signature / ownership |
|---|---|
| `book_sports_slot` | `book_sports_slot(p_resource_id uuid, p_starts_at timestamptz, p_slots int, p_participants int, p_payment_mode text, p_note text, p_idempotency_key text) returns jsonb` — E1. |
| `prepare_sports_payment` | `prepare_sports_payment(p_booking_id uuid, p_user_id uuid) returns table(payment_id uuid, amount int, purpose text, url text)` — E1; caller must own a live payable booking. |
| `record_sports_payment_paid` | `record_sports_payment_paid(p_order_id text, p_payment_id text, p_amount int)` — E1; return type is not specified in the plan. |
| `_create_sports_payout` | `_create_sports_payout(p_sports_booking_id uuid)` — private E1 helper; return type is not specified in the plan. |
| Customer reads | `get_sports_venue(p_id uuid)`, `get_my_sports_bookings()`, and `get_sports_booking(p_id uuid)` — E1. Venue/resource projections include `payment_modes`, `online_payment_ready`, `booking_mode`, and `capacity`; booking projections include `total_paise`, `customer_fee_paise`, `payment_mode`, `refund_paise`, `participants`, `hold_expires_at`, `pay_by`, and `paid_at`. |
| Business reads | `get_my_business_sports_venues()`, `get_my_business_sports_bookings()`, and `get_business_sports_booking(p_id uuid)` — E1. Owners and active staff are authorized through `_acts_for(owner_id, 'staff')`; customers retain access only to their own bookings. Business results preserve nested `venue.business_role` and the same safe payment/capacity fields. Only an owner receives top-level `payout_account_ready` alongside `venue` and `online_payment_ready`; it reflects activated-account state without payout details. `online_payment_ready` separately reflects online feature/mode/account eligibility. The participant RLS policy separately requires the `sports` parent flag and customer or assigned-business access. |
| Legacy RPCs | `request_sports_slot` remains behavior-compatible; `get_sports_slots` adds remaining capacity; existing decision, cancel, and expiry RPCs are extended for online flows. |

### File and integration ownership

- E1: `supabase/migrations/0058_sports_payments.sql`, `supabase/tests/sports_payments.test.mjs`.
- E2: shared `create-payment`, `verify-payment`, and `razorpay-webhook` routing; venue-owner payout-account enrollment; payout release changes and Deno routing tests.
- Integrator: migration CI/list registration and shared notification route/kind registration.
- UI F/G: customer/venue screens and typed API integration.

## Strategic decisions and ADR linkage

- The governing plan records R5–R7 and R9–R10 in [§1 decisions](../../../../../../12-Home-Services-Recurring-Sports-Payments-Implementation-Plan.md#1-decisions-made-for-this-plan-owner-may-override--recorded-per-autopilot-instruction): reuse shared payment/refund/payout records while keeping sports bookings dedicated; preserve `accepted`; use resource locks and capacity counts; gate new features; and keep business rules admin-configurable.
- The existing [Sports Bookings DDD](sports-bookings-ddd.md) describes the Phase 6 boundary and its prior pay-at-venue-only decision. This feature supersedes only that payment-mode constraint; it does not replace the sports booking context.
- **ADR candidate (not created in this task):** record the cross-context choice to reuse shared payment/refund/payout aggregates while retaining a separate sports booking aggregate, especially if later work changes ownership or release semantics. No standalone ADR is identified by the plan.

## Trace links and status

- BDD: [Sports Online Payments & Settlement — BDD](../../bdd/artifacts/sports-payments-bdd.md)
- Existing sports behavior: [Sports Venue Discovery & Booking Requests — BDD](../../bdd/artifacts/sports-bookings-bdd.md)
- Foundation rules: [Addendum Foundations — DDD](home-services-recurring-sports-foundations-ddd.md)
- Governing implementation contract: [Plan §6](../../../../../../12-Home-Services-Recurring-Sports-Payments-Implementation-Plan.md#6-lane-e--sports-online-payments-backend-migration-0058_sports_payments-sql)
- Traceability matrix: deferred to T2.
- **DDD:** contexts and consistency boundaries defined for E1 and its E2/integrator interfaces.
- **Implementation and CI validation:** pending the artifact merge gate.
