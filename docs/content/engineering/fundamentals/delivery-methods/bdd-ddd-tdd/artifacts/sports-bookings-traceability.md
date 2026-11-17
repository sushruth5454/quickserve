# Sports Venue Discovery & Booking Requests — Traceability

This map links the Phase 6 scenarios to their domain owner, source assertions, implementation, and governing decision. `supabase/tests/sports.test.mjs` contains isolated SQL assertions; they were not executed locally, and CI validation is pending.

| BDD scenario | DDD context / model | Isolated test evidence | Implementation references | Decision |
|---|---|---|---|---|
| [SB-01](../../bdd/artifacts/sports-bookings-bdd.md) Flag-off refusal | Feature Governance / `sports` feature gate | `sports.test.mjs`: “all customer, owner, admin and expiry RPCs are refused while the flag is off”; direct-RLS read assertion | `0048_sports.sql`: flag seed, gated RPCs and RLS; sports routes show the disabled state | PRD v2 §1 D3, §6 |
| [SB-02](../../bdd/artifacts/sports-bookings-bdd.md) Verified venue search | Sports Venue Management / venue verification; Availability & Requests / discovery | `sports.test.mjs`: unverified search returns zero; verified search returns the venue and minimum price | `0048_sports.sql`: `admin_set_venue_status`, `search_sports_venues`; `app/app/sports/[activity].tsx`; `app/app/venue/[id].tsx` | PRD v2 §6 |
| [SB-03](../../bdd/artifacts/sports-bookings-bdd.md) Blocked slot | Sports Venue Management / `sports_blocks`; Availability & Requests / reservation policy | `sports.test.mjs`: “blocked slot cannot be requested” | `0048_sports.sql`: `add_sports_block`, `get_sports_slots`, `request_sports_slot`; `app/app/sports/manage.tsx`; `app/app/venue/[id].tsx` | PRD v2 §6 |
| [SB-04](../../bdd/artifacts/sports-bookings-bdd.md) Same-slot concurrency | Availability & Requests / resource reservation policy | `sports.test.mjs`: “two customers racing for one slot produce exactly one booking”. This covers identical overlapping windows; partial-window overlap has no separate assertion. | `0048_sports.sql`: resource advisory lock and overlap checks in `request_sports_slot`; `app/app/venue/[id].tsx` | PRD v2 §6 |
| [SB-05](../../bdd/artifacts/sports-bookings-bdd.md) Server price snapshot | Availability & Requests / `SportsBooking` price snapshot | `sports.test.mjs`: “booking price is calculated from the server-side price rule” | `0048_sports.sql`: `sports_price_rules`, per-slot price calculation, `sports_bookings.price_paise`; `app/app/sports/manage.tsx` | PRD v2 §6 |
| [SB-06](../../bdd/artifacts/sports-bookings-bdd.md) Owner decision and notification | Availability & Requests / `SportsBooking`; Notifications | `sports.test.mjs`: “owner acceptance changes status and notifies the customer”. Decline/reason behavior is implemented but not directly asserted. | `0048_sports.sql`: `decide_sports_booking` and notification kinds; `app/app/sports-booking/[id].tsx`; `app/app/sports/manage.tsx` | PRD v2 §6 |
| [SB-07](../../bdd/artifacts/sports-bookings-bdd.md) Expiry releases slot | Availability & Requests / expiry policy | `sports.test.mjs`: “expired request releases its slot” | `0048_sports.sql`: `expire_sports_requests` and five-minute cron schedule | PRD v2 §6 |
| [SB-08](../../bdd/artifacts/sports-bookings-bdd.md) Pay at venue | Availability & Requests / unpaid booking request | No direct SQL assertion for absence of online payment; app copy and dedicated sports tables/RPCs evidence the boundary. | `0048_sports.sql`: dedicated sports booking tables/RPCs; `app/app/venue/[id].tsx`, `app/app/sports/bookings.tsx`, `app/app/sports-booking/[id].tsx` | PRD v2 §1 D6, §6 |

## Implementation inventory

- **Migration:** `supabase/migrations/0048_sports.sql`
- **Isolated tests:** `supabase/tests/sports.test.mjs`
- **Customer routes:** `app/app/sports/index.tsx`, `app/app/sports/[activity].tsx`, `app/app/venue/[id].tsx`, `app/app/sports/bookings.tsx`, `app/app/sports-booking/[id].tsx`
- **Owner route:** `app/app/sports/manage.tsx`
- **Admin route:** `app/app/admin/sports.tsx`

## Integration and validation status

- Parent integration remains: register migration 0048 and the isolated test; add notification safe routes and navigation links; preserve sports notification kinds when merging later migrations.
- **CI validation: pending.** Local tests/builds and live-database writes were not performed.
