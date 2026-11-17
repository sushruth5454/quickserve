# QuickServe Phase 7a — Shops & Catalogue — DDD

**Status:** Domain boundaries and invariants recorded; CI validation pending.

## Domain framing

Phase 7a adds a verified local-shop catalogue and customer-to-shop enquiries. It does not extend bookings, service requests, sports, payments, or RFQ. `products` gates shop/catalogue/search operations; `product_enquiries` additionally gates conversations.

## Ubiquitous language

| Term | Meaning |
|---|---|
| Shop owner | Authenticated user whose `profiles.id` owns the shop row. One shop per owner in this phase. |
| Shop verification | Admin-controlled status transition; only `verified` shops are discoverable. |
| Product category | Admin-controlled catalogue taxonomy and attribute schema; a shop selects the categories it sells. |
| Indicative price | Optional paise amount for display only; it is not a quote, commitment, or checkout price. |
| Product enquiry | A customer/shop-owner conversation tied to a shop and optionally a product. |
| Shop/customer unread | Messages awaiting the corresponding participant; reading clears only that participant's counter. |

## Bounded contexts and ownership

| Context | Owns | Invariants and boundary |
|---|---|---|
| **Shop Verification** | `shops`, `shop_categories`; `save_shop`, `submit_shop`, admin status RPCs | The owner edits only their shop. Submission requires an address, map coordinates, and a category. Only an admin changes review status. Search exposes only verified shops. |
| **Catalogue** | `product_categories`, `products`, `product_images`; `save_product`, `delete_product`, `list_my_products` | Product category/specification, unit, price, image ownership, six-image cap, and 500-product cap are server-validated. Search text is maintained by a trigger for SQL-test compatibility. A deleted listing is deactivated; it does not become a purchase or booking. |
| **Product Discovery** | `search_products`, `search_shops`, `get_shop`, `get_product` | Reads only active products in active categories at verified shops. Query/category/price/stock/radius filters and distance ordering are server-side. The client cannot make an unverified shop searchable. |
| **Enquiry Conversation** | `product_enquiries`, `product_enquiry_messages`; start/send/read/status RPCs | The server derives customer/shop side from `auth.uid()` and shop ownership. Only participants read or message. Sending increments the recipient unread count and queues the corresponding notification; marking read clears only the caller's counter. Closed threads reject sends. |
| **Admin operations** | Shop review, category activation, catalogue summary | Admin-only RPCs manage review/category state and audit changes. Admin operations do not grant customer or owner privileges. |

## Cross-cutting policies

- Feature checks are enforced in database RPCs and RLS helpers, not only in app screens. Enquiries require both feature flags.
- Product images use a private `product-images` bucket, a shop-ID path prefix, 5 MiB size cap, and JPEG/PNG/WebP allowlist.
- Prices are displayed with **“Indicative price — confirm with shop.”** No payment or RFQ aggregate is introduced.
- Tables and RPCs are self-contained and have no sports-table dependency. Notification deep-link registration and app navigation are shared integration points, not owned by this context.

## Trace links

- BDD: [Shops, Catalogue, Search & Enquiries — BDD](../../bdd/artifacts/shops-catalogue-bdd.md)
- Traceability: [Shops & Catalogue — Traceability](../../bdd-ddd-tdd/artifacts/shops-catalogue-traceability.md)
- Plan: [PRD v2 implementation plan](../../../../../../11-PRD-v2-Implementation-Plan.md), Phase 7a
- Implementation: [`0049_shops_catalogue.sql`](../../../../../../../supabase/migrations/0049_shops_catalogue.sql), [`app/src/features/shops`](../../../../../../../app/src/features/shops)

**CI validation pending.** No local tests, builds, or live database operations were run for this delivery.
