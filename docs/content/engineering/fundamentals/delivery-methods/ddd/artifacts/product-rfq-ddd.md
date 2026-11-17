# QuickServe Phase 7b — Product RFQ & Supplier Quotes — DDD

**Status:** Domain boundaries recorded; CI validation pending.

## Ubiquitous language

| Term | Meaning |
|---|---|
| RFQ | A customer's dated request for one or more products from several eligible shops. |
| RFQ item | One requested description, quantity, unit, preferred brand, and optional structured specifications. |
| Recipient shop | A verified shop that sells the RFQ category and whose delivery radius covers the selected location. |
| Supplier quote | One shop's versioned offer for every RFQ item, including availability, item details, prices, GST, delivery, and validity. |
| Missing specification | At least one requested specification key is absent or blank in the supplier's submitted specs. It does not mean that two products are or are not equivalent. |
| Selected quote | The customer's chosen sent quote. Selection closes the RFQ and opens a product enquiry; it is not an order or payment. |

## Bounded contexts and ownership

| Context | Owns | Invariants and boundary |
|---|---|---|
| **Product Catalogue** (Phase 7a) | Product categories, shop categories, verified shops, feature `products` | Supplies the active category and shop verification/category/radius facts. Phase 7b reads these contracts without changing their migration or UI files. |
| **Product RFQ** | `rfqs`, `rfq_items`, `rfq_recipients`; create, route, read, and expiry operations | An RFQ has 1–20 validated items and up to ten nearest eligible verified shops. Customer location is returned only to its owner. Only a customer or a routed shop owner may read the RFQ. |
| **Supplier Quotation** | `supplier_quotes`, `supplier_quote_items`; send and compare operations | A quote version covers every RFQ item exactly once. Quantity is copied from the RFQ; line totals, line-level GST, subtotal, and total are server-computed. One current sent quote per shop/RFQ. |
| **Product Enquiry** (Phase 7a) | `product_enquiries`, messages, participant unread state | Quote selection reuses the established product-enquiry posting contract. The `product_enquiries` flag must be enabled for selection so the new thread is usable. |
| **Marketplace Operations** | Admin RFQ activity aggregate and route | The aggregate RPC is admin-only and reports open requests, current quote counts, and first-response time; it does not expose customer coordinates. |

## Aggregate and consistency decisions

- `rfqs` is the request aggregate root. Its items, recipients, and status changes are committed with creation/expiry.
- A supplier quote is scoped to a single `(rfq_id, shop_id, version)`. Replacing a sent quote withdraws the previous sent version before the new version is inserted.
- Quote item identity is the exact `rfq_item_id`; comparison never matches, substitutes, or labels products as equivalent.
- Requested and offered specifications are displayed separately. `specs_missing` only signals absent/blank requested keys; supplied value differences remain visible without a compatibility judgment.
- Selection serializes on the RFQ and quote rows, rejects competing sent quotes, closes the RFQ, and creates/reuses an open enquiry in the same transaction. No payment API or payment row is involved.
- `product_rfq` defaults off and requires the existing `products` gate. Selection also requires `product_enquiries`, whose Phase 7a RLS and RPC contract owns enquiry visibility.
- RFQ routing uses great-circle distance to apply each shop's configured `delivery_radius_km`; delivery requests additionally require `offers_delivery`. The selected city/area remains descriptive and does not override coordinate/radius eligibility.

## Strategic links and risks

- ADR: No existing ADR identified; candidate decision is **keep product quotation separate from checkout/payment**, with later payment requiring a distinct approved workflow.
- Operational dependency: shared notification routing and app navigation are wired by the parent integration.
- Validation risk: the PGlite test is isolated and written, but was intentionally not executed in this task.

## Trace links

- BDD: [Product RFQ & Supplier Comparison — BDD](../../bdd/artifacts/product-rfq-bdd.md)
- Traceability: [Product RFQ — Traceability](../../bdd-ddd-tdd/artifacts/product-rfq-traceability.md)
- Implementation: [`0050_rfq.sql`](../../../../../../../supabase/migrations/0050_rfq.sql), [`app/src/features/rfq`](../../../../../../../app/src/features/rfq)
