# Creator Revisions — DDD

## Domain framing

The customer needs a bounded way to request changes to a submitted creator deliverable. The existing proposal booking remains the consistency boundary; revisions extend its delivery lifecycle rather than creating a separate booking or payment flow.

### Ubiquitous language

| Term | Meaning |
|---|---|
| Proposal booking | A booking whose agreed work is represented by a creator proposal. |
| Revision allowance | Maximum revisions available for the booking; defaults to two. |
| Revision used | One accepted customer request for changes. |
| Revision note | The customer's trimmed explanation, 5–1000 characters. |
| Pending revision | Booking is `delivery_pending` and delivery is `revision_requested`. |
| Resubmission | Provider submits revised links through the existing delivery operation. |

## Bounded contexts and ownership

| Context | Owns | Boundary |
|---|---|---|
| **Proposal Booking Fulfillment** | Booking status, delivery status, revision allowance/count, review timing, and transition event | `request_revision` and the existing `submit_delivery` RPC |
| **Feature Gate** | Whether new customer revision requests are permitted | `creator_revisions` registry row, checked server-side; app visibility is advisory |
| **Notification Outbox** | Provider-facing notification delivery | Existing notification queue with kind `revision_requested` |

**Context relationship:** Proposal Booking Fulfillment is authoritative for eligibility and state. It reads the Feature Gate and emits a notification through the outbox. The booking screen calls the isolated API helper and renders booking/event data; it does not own the policy.

## Aggregate and invariants

- **Aggregate root:** `Booking`. `status`, `delivery_status`, `revisions_allowed`, `revisions_used`, and `completion_requested_at` change together in the request transaction.
- A request is accepted only when the feature is on, the caller is the booking customer, the booking is a proposal in `completion_requested` with submitted delivery, the allowance remains, and the note is valid.
- An accepted request increments the count once, records the trimmed note in the booking transition event, clears the completion timer, moves the booking to `delivery_pending`, and queues a provider notification.
- The default allowance is two. A safely parsed integer marker in `delivery_snapshot` may set 0–10 without rewriting that payload.
- Provider resubmission accepts `pending` or `revision_requested`, restores `submitted` and `completion_requested`, and starts a fresh review timestamp. Existing payment scheduling and customer acceptance rules remain in their current flow.
- A pending revision is outside the completion worker's `completion_requested` set; the cleared timestamp also prevents reuse of the prior review window.

## Tactical design

| Element | Responsibility |
|---|---|
| `request_revision` | Locks and validates the booking, applies the count/status/timer changes, writes the transition note, and queues the provider notification atomically. |
| `submit_delivery` | Existing provider operation; permits resubmission only for `pending` or `revision_requested` delivery. |
| Booking event note | Carries the revision note for the provider-facing booking view; no separate revision table is introduced. |
| `creatorRevisions.ts` | Isolated app boundary for feature lookup and `request_revision` RPC invocation. |
| Booking detail UI | Shows the customer action only when applicable and shows the pending note/count to the provider. |
| SQL test fixture | Verifies the transactional state and its refusal paths independently from shared test registration. |

## ADR and risks

- **ADR:** no new ADR is identified; the change preserves the Booking fulfillment, feature-gate, and notification ownership boundaries.
- The optional allowance marker is recognized only when it is a valid integer from 0 through 10; otherwise the default remains two.
- The isolated SQL assertions have not yet been run; **CI validation is pending**.

## Trace links

- BDD: [Creator Revisions — BDD](../../bdd/artifacts/creator-revisions-bdd.md)
- Traceability: [Creator Revisions — Traceability](../../bdd-ddd-tdd/artifacts/creator-revisions-traceability.md)
