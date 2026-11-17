# Sports Venue Discovery & Booking Requests — DDD

## Domain framing

The sports capability lets customers request a time at a verified venue, lets its owner decide, and leaves payment to the venue. The implementation plan identifies customers, venue owners, and administrators as actors; it does not assign a separate owning team.

### Ubiquitous language

| Term | Meaning |
|---|---|
| Activity | A discoverable sports category such as badminton or swimming. |
| Venue | An owner-managed location with an address, service area, coordinates, amenities, and verification status. |
| Resource | A bookable court, turf, or other activity-specific unit at a venue. |
| Opening hours | The venue's local-day operating interval; slot generation uses India Standard Time. |
| Price rule | A resource's weekday/time-window price, stored as integer paise per slot. |
| Block | An owner-declared unavailable interval for a resource. |
| Booking request | A customer's pay-at-venue request for a resource time; it is not a paid booking. |
| Price snapshot | The server-calculated total stored on the request so later rule edits do not rewrite that request's amount. |

## Bounded context map

| Context | Responsibility | Boundary / integration |
|---|---|---|
| **Sports Venue Management** | Owners create venues and configure resources, hours, prices, and blocks; administrators verify/suspend venues and activate activities. | `sports_venues`, `sports_activities`, `sports_resources`, `sports_hours`, `sports_price_rules`, and `sports_blocks`; owner/admin RPCs in migration 0048. |
| **Sports Availability & Requests** | Customers search and inspect slots, request a slot, and view the request; owners decide requests. | `sports_bookings`; `search_sports_venues`, `get_sports_slots`, `request_sports_slot`, `decide_sports_booking`, and related read/cancel RPCs. |
| **Feature Governance** | Existing feature registry governs whether sports reads and mutations are available. | The `sports` row in `feature_flags`, `_feature_enabled`, and RLS policies using `get_app_features`. |
| **Notifications** | Existing notification infrastructure carries request and owner-decision notices. | Three sports notification kinds; routing allowlist and navigation registration remain parent integration work. |
| **Location selection** | Existing app location context supplies the customer's search coordinates. | Consumed by the sports activity route; Phase 5 geography files are not changed. |

## Tactical model and invariants

These are DDD interpretations of the relational schema and RPC boundaries, not new class declarations.

| Model / service | Consistency responsibility |
|---|---|
| **SportsVenue aggregate (conceptual)** | `sports_venues` is the root; owner RPCs manage its resources and related schedule data. Only verified venues and active resources are discoverable. Admin review owns the verified/rejected/suspended decision. |
| **SportsBooking aggregate** | One `sports_bookings` row records customer, venue/resource, time interval, status, paise price snapshot, expiry, and decision. The owner or customer can read only as a participant. |
| **Resource reservation policy** | `request_sports_slot` locks by resource, checks overlapping requested/accepted intervals and blocks, validates local opening hours, and calculates every slot's price on the server before inserting. |
| **Expiry policy** | `expire_sports_requests` transitions overdue requests to expired and ended accepted bookings to completed. The scheduled job is guarded while the sports flag is off. |
| **Feature policy** | The sports flag defaults OFF. Sports RPCs and RLS-gated reads reject access while it is off; direct client writes are not granted. |
| **Payment boundary** | No online payment or existing service-booking/payment state machine is used. The request's amount is a server-calculated quote/snapshot for payment directly to the venue after acceptance. |

### Key consistency rules

1. A customer cannot request their own venue's resource.
2. Requests must be future-dated, within 30 days, aligned to the resource slot schedule, inside opening hours, and covered by price rules.
3. An overlapping active request or accepted booking, or an overlapping block, prevents a second request.
4. Resource-level advisory locking serializes competing requests; the database check remains authoritative.
5. A pending request must be decided before expiry; a declined request requires a reason.
6. Only a verified venue with active activity/resource data appears in customer discovery.

## Integration boundaries and ADR

- Sports uses dedicated tables rather than the shared `bookings` table, preserving the existing booking state machine.
- Notification routing and app navigation are integration points owned by the parent task; this feature provides the notification data route and new route files.
- The Phase 6 plan's locked decision D6 specifies separate sports tables, pay-at-venue requests, and no online sports payment. No separate ADR is identified in the Phase 6 source; no new architecture decision is claimed here.

## Trace links and status

- BDD: [Sports Bookings — BDD](../../bdd/artifacts/sports-bookings-bdd.md)
- Traceability: [Sports Bookings — Traceability](../../bdd-ddd-tdd/artifacts/sports-bookings-traceability.md)
- Governing decision: [PRD v2 implementation plan, decision D6 and Phase 6](../../../../../../11-PRD-v2-Implementation-Plan.md)
- **DDD:** contexts, ownership, and invariants are mapped to migration 0048 and new app routes.
- **CI validation:** pending; tests/builds were not run locally as requested.
