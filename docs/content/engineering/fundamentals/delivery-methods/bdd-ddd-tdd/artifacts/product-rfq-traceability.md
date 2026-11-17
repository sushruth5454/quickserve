# QuickServe Phase 7b — Product RFQ — Traceability

**Status:** Implementation trace recorded; **CI validation pending**. No tests, builds, or live database operations were run.

| BDD scenario | DDD owner / invariant | Implementation | Isolated SQL evidence |
|---|---|---|---|
| [RFQ-01](../../bdd/artifacts/product-rfq-bdd.md) Feature gates | Product RFQ; `product_rfq` defaults off and `products` is required | `0050_rfq.sql`: flag seed, `_product_rfq_enabled`; `app/src/features/rfq/components.tsx` | `rfq.test.mjs`: default-off and refused-create assertions |
| [RFQ-02](../../bdd/artifacts/product-rfq-bdd.md) Routing | Product Catalogue → Product RFQ; verified category sellers within their own radius; maximum ten | `0050_rfq.sql`: `create_rfq`, `_rfq_distance_km`, recipient and notification inserts | `rfq.test.mjs`: routing cap, unverified/category/radius filters, notifications |
| [RFQ-03](../../bdd/artifacts/product-rfq-bdd.md) Participant privacy | Product RFQ; customer or routed shop owner only | `0050_rfq.sql`: participant RLS policies, `get_rfq`, `get_supplier_rfq`, quote authorization | `rfq.test.mjs`: customer isolation and non-recipient refusal |
| [RFQ-04](../../bdd/artifacts/product-rfq-bdd.md) Server-owned totals | Supplier Quotation; RFQ quantity is authoritative; one complete quote version | `0050_rfq.sql`: `send_supplier_quote` and quote-item constraints | `rfq.test.mjs`: spoofed totals ignored, RFQ quantity copied, per-line GST, quote validity cap, withdrawn prior version |
| [RFQ-05](../../bdd/artifacts/product-rfq-bdd.md) Comparison markers | Supplier Quotation; no product-equivalence inference | `0050_rfq.sql`: `compare_rfq_quotes` returns raw requested/offered values and `brand_differs`, `specs_missing` | `rfq.test.mjs`: brand/spec markers and no equivalence field |
| [RFQ-06](../../bdd/artifacts/product-rfq-bdd.md) Selection/enquiry | Product RFQ → Product Enquiry; no payment | `0050_rfq.sql`: `select_supplier_quote`; `app/app/rfq/[id].tsx` routes to the existing enquiry screen | `rfq.test.mjs`: selected/rejected/closed state, enquiry message, no payment row |
| [RFQ-07](../../bdd/artifacts/product-rfq-bdd.md) Expiry | Product RFQ; scheduled service expiry | `0050_rfq.sql`: `expire_rfqs` and guarded `pg_cron` registration | `rfq.test.mjs`: RFQ and outstanding quote expiry |
| [RFQ-08](../../bdd/artifacts/product-rfq-bdd.md) Admin metrics | Marketplace Operations; admin-only aggregate | `0050_rfq.sql`: `admin_rfq_dashboard`; `app/app/admin/rfqs.tsx` | Admin authorization test pending |
| Customer create/detail | Product RFQ / Supplier Quotation | `app/app/rfq/new.tsx`, `app/app/rfq/[id].tsx`, `app/src/features/rfq/api.ts` | SQL behavior covered; UI tests pending |
| Supplier inbox/composer | Supplier Quotation; routed verified shop only | `app/app/merchant-rfqs.tsx`, `app/app/rfq/merchant/[id].tsx` | RPC authorization and pricing covered; UI tests pending |

## Shared integration remaining

1. Register `supabase/migrations/0050_rfq.sql` and `supabase/tests/rfq.test.mjs` in the shared migration/test runners.
2. Register the `rfq_received` and `rfq_quote_received` notification routes, including `/merchant-rfqs` and `/rfq/:id`.
3. Wire customer, merchant, and admin navigation to the new routes.
4. Enable `products` and `product_rfq` for an RFQ rollout; also enable `product_enquiries` so selected quotes can open a usable thread.
5. Run the isolated and full migration-chain CI tests after parent integration; add an admin authorization assertion if the dashboard is included in release criteria.

## References

- [BDD scenarios](../../bdd/artifacts/product-rfq-bdd.md)
- [DDD boundaries](../../ddd/artifacts/product-rfq-ddd.md)
- [Phase 7b plan](../../../../../../11-PRD-v2-Implementation-Plan.md)
