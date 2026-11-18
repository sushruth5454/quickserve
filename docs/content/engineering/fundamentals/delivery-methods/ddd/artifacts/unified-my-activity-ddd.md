# QuickServe Phase 9 — Unified My Activity — DDD

**Status:** Implemented as a read-only projection with additive participant-scoped contracts; isolated tests authored but not run.

## Ubiquitous language

| Term | Meaning |
|---|---|
| Activity segment | A customer-facing grouping of a context's records: Services, Requests, Shop, or Sports. It is presentation, not a new domain aggregate. |
| Activity item | A read-only projection of one context-owned record, retaining its original identity, status, and safe detail route. |
| Unread activity | A context's authoritative count of unread items for the signed-in participant. Counts from different contexts are summed only after feature visibility is resolved. |
| Feature-gated segment | A segment or resource type available only when its owning feature flag is enabled. |

## Bounded contexts and ownership

| Context | Owns | Activity projection boundary |
|---|---|---|
| **Service Booking** | Customer bookings, booking statuses, booking chat read state | Services reuses the existing bookings list and booking-detail route. Unread total is chat unread from `get_unread_counts()` plus unread non-chat notifications tied to customer-owned bookings. `chat_message` notification rows are excluded to avoid double-counting. |
| **Proposal Request** | Customer `service_requests`, proposals, request messages and their notifications | Requests reads only the signed-in customer's requests. Unread count uses `proposal_received` and `request_message` notifications whose `data.request_id` belongs to that customer. Request status remains `open`, `closed`, `booked`, `expired`, or `cancelled`; proposal/message state is not a booking status. |
| **Shop Enquiry** | Product enquiries, `open`/`closed` status, participant unread counts | Shop projects customer enquiries only when `products` and `product_enquiries` are enabled; `customer_unread` remains context-owned. The existing detail flow clears it through `mark_enquiry_read`. |
| **Product RFQ / Supplier Quotation** | Customer RFQs, RFQ status, supplier quote status and comparison | `list_my_customer_rfqs()` is gated by `products` + `product_rfq` and filters by `rfqs.customer_id`. Shop unread adds `rfq_quote_received` notifications whose `data.rfq_id` belongs to that customer. |
| **Sports Booking** | Sports bookings and statuses | `list_my_customer_sports_bookings()` is gated by `sports` and filters strictly by `sports_bookings.customer_id`; it never includes venue-owner rows. Sports unread uses accepted/declined notifications keyed by `data.sports_booking_id`. |
| **Feature Configuration** | `products`, `product_enquiries`, `product_rfq`, and `sports` flags | Determines segment/resource visibility and whether the corresponding list API may be called. |
| **Customer Activity** | No domain records or lifecycle | The screen is a read-only composition boundary. It must not persist a combined status, transfer ownership, or redefine unread state. |

## Context map

```text
Authenticated customer
        |
        +--> Feature Configuration -- visibility gates --> Customer Activity projection
        |
        +--> Service Booking ------------------------------> Services
        +--> Proposal Request ----------------------------> Requests
        +--> Shop Enquiry + Product RFQ ------------------> Shop
        +--> Sports Booking ------------------------------> Sports
```

Each context is upstream of the activity projection for its records and status. Customer Activity is a downstream consumer; it does not become an owner of a shared status or persistence model.

## Aggregate and consistency decisions

- Keep each list and status model context-owned. If the screen uses a discriminated projection, preserve each source status type rather than mapping to a synthetic lifecycle.
- Read-only aggregation is eventual and refreshable; do not make a cross-context write or transaction part of this screen.
- Resolve visibility before loading data. The `products` flag gates Shop; `product_enquiries` and `product_rfq` gate their respective Shop resource types; `sports` gates Sports.
- Apply participant scope at the API/RLS boundary. In particular, filter sports records to the customer side even though the current `get_my_sports_bookings()` RPC returns customer and venue-owner activity.
- Derive navigation only from the resource type and its known route. Do not use notification payload URLs or user-controlled content as arbitrary navigation targets.
- Do not infer a segment's unread total from a global notification scalar or from another context's read state.
- Clear only notifications associated with an opened, customer-owned resource through `mark_my_activity_notification_read()`. Booking chat remains unread until its chat read contract clears it; product enquiry unread remains owned by `mark_enquiry_read()`.

## Implemented contracts

| Contract | Exposed data and ownership |
|---|---|---|
| `get_unread_counts()` | Per-booking customer chat unread; composed with non-chat notification rows tied to customer bookings. `chat_message` notification rows are excluded. |
| `listMyServiceRequests()` + `proposal_received` / `request_message` notifications | Customer-filtered request records; unread notifications are scoped by `user_id` and `data.request_id` joined to the customer's request. |
| `listMyProductEnquiries()` | Customer enquiries, native `open`/`closed`, `customer_unread`, and last message time. Existing `mark_enquiry_read` clears enquiry unread. |
| `list_my_customer_rfqs()` | Customer RFQ summaries and native RFQ status; gated by `products` + `product_rfq`, filtered by `customer_id`. |
| `list_my_customer_sports_bookings()` | Customer-only sports rows and native status; gated by `sports`, filtered strictly by `sports_bookings.customer_id`. |
| `get_my_activity_unread_counts()` | Services, Requests, Shop, and Sports unread totals from existing chat, notification, enquiry, and resource tables; applies participant and feature gates. |
| `mark_my_activity_notification_read(type, id)` | Read clearing for booking, request, RFQ, and sports notifications. Enforces resource ownership and RFQ/Sports feature gates; leaves chat and enquiry read state with their existing APIs. |

## Tactical design checklist

- [x] Keep `BookingStatus`, `ServiceRequestStatus`, enquiry status, `RfqStatus`, `SupplierQuoteStatus`, and sports status independent.
- [x] Add customer RFQ list and unread data in the owning Product RFQ contract.
- [x] Add participant-scoped unread counts for Requests and Sports from existing notification rows.
- [x] Expose visible-segment unread totals with feature gates and booking chat-notification de-duplication.
- [x] Filter Sports activity to customer-owned rows.
- [x] Add isolated SQL/Jest tests for ownership, gates, unread totals, and visibility.

## Strategic links and risks

- ADR candidate, if the composition boundary needs durable governance: **Customer Activity is a downstream read model; source contexts retain status, privacy, feature-gate, and unread ownership.**
- Shared CI/test registration and shared traceability remain parent-owned; isolated tests were authored but not executed by request.

## Trace links

- BDD: [Unified My Activity — BDD](../../bdd/artifacts/unified-my-activity-bdd.md)
- Traceability: [Unified My Activity — Traceability](../../bdd-ddd-tdd/artifacts/unified-my-activity-traceability.md)
- Phase plan: [PRD v2 implementation plan](../../../../../../11-PRD-v2-Implementation-Plan.md), Phase 9

## Implementation sources reviewed

- `app/app/(customer)/bookings.tsx`
- `app/src/lib/unread.ts`, `app/src/lib/unreadContext.tsx`, `app/src/lib/apiTypes.ts`
- `app/src/lib/supabaseApi.ts`, `app/src/features/shops/api.ts`, `app/src/features/rfq/api.ts`
- `app/src/features/sports/api.ts`, `app/src/features/activity`
- `app/app/sports/bookings.tsx`, `app/src/features/rfq/components.tsx`
- `supabase/migrations/0007_chat_unread_notifications.sql`
- `supabase/migrations/0023_proposal_milestone_booking.sql`
- `supabase/migrations/0032_notification_centre.sql`
- `supabase/migrations/0048_sports.sql`
- `supabase/migrations/0049_shops_catalogue.sql`
- `supabase/migrations/0050_rfq.sql`
- `supabase/migrations/0053_activity_contracts.sql`
