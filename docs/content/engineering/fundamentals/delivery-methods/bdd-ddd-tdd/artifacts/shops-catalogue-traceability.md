# QuickServe Phase 7a — Shops & Catalogue — Traceability

**Status:** Implementation trace recorded; **CI validation pending**. The isolated test file exists but has not been executed.

| BDD scenario | DDD context / invariant | Migration and app trace | Isolated test evidence | CI state |
|---|---|---|---|---|
| [SC-01](../../bdd/artifacts/shops-catalogue-bdd.md) Feature gates | Shop Verification / Catalogue / Enquiry Conversation; flags fail closed | `0049_shops_catalogue.sql:1-7,143-153,273,302,620,763,975`; feature-aware UI in `app/src/features/shops/components.tsx` | `supabase/tests/shops_catalogue.test.mjs:127-134,232-237` | Pending |
| [SC-02](../../bdd/artifacts/shops-catalogue-bdd.md) Owner and admin authorization | Shop Verification; owner edits own shop, admin controls status | `0049_shops_catalogue.sql:282-417,421-479`; `app/app/merchant-shop.tsx:186-205`; `app/app/admin/shops.tsx:56-60,111-115` | Test fixtures create owner/admin shops and check pending-shop invisibility: `shops_catalogue.test.mjs:137-160` | Pending; add explicit unauthorized admin-status assertion |
| [SC-03](../../bdd/artifacts/shops-catalogue-bdd.md) Verified search and filters | Product Discovery; verified + active + category membership; server-side distance ordering | `0049_shops_catalogue.sql:744-848`; `app/app/shop/index.tsx:18-38,90-107`; `app/app/products.tsx:30-62,80-99` | `shops_catalogue.test.mjs:159-168` checks verification, distance, text, price, and stock filters | Pending |
| [SC-04](../../bdd/artifacts/shops-catalogue-bdd.md) Indicative pricing | Catalogue; indicative value is not a transactional price | `app/src/features/shops/components.tsx:21-26`; `app/app/product/[id].tsx:68-76`; `app/app/merchant-shop.tsx:387-393` | No automated UI assertion for the exact disclaimer; `shops_catalogue.test.mjs:167-168` tests the search price filter only | Pending UI assertion |
| [SC-05](../../bdd/artifacts/shops-catalogue-bdd.md) Product/spec/image limits | Catalogue; owner, category schema, price, image and per-shop limits are server-validated | `0049_shops_catalogue.sql:228-268,600-700`; `app/app/merchant-shop.tsx:238-245,251-304,369-403`; upload/save wrapper `app/src/features/shops/api.ts:222-289` | `shops_catalogue.test.mjs:170-185,221-230` checks owner shop, specs, six-image and 500-product limits | Pending; add bucket MIME/size assertion |
| [SC-06](../../bdd/artifacts/shops-catalogue-bdd.md) Enquiry messaging/read state | Enquiry Conversation; participant identity and unread state are server-owned | `0049_shops_catalogue.sql:918-1143`; `app/app/product/[id].tsx:41-44,68-81`; `app/app/enquiry/[id].tsx:28-66,82-102`; merchant inbox `app/app/merchant-enquiries.tsx` | `shops_catalogue.test.mjs:187-219,232-237` checks participant isolation, notification kinds, unread transitions, closed send, and feature gate | Pending |

## Shared integration and validation

1. Register migration `0049_shops_catalogue.sql` and `shops_catalogue.test.mjs` in the shared migration/test runners without editing migrations `0043`–`0048` or the excluded PRD test files.
2. Register `/enquiry/:id` for `product_enquiry` and `product_enquiry_reply` notification taps and integrate enquiry unread counts with shared app surfaces.
3. Add navigation links for customer Shop local, merchant My shop/enquiries, and admin shop management.
4. Run CI against the complete migration chain through `0049`, execute the isolated SQL test, and add/execute UI assertions for the price label and bucket MIME/byte limits.

No local tests, builds, live DB operations, commits, or pushes were performed for this follow-up.

## References

- [BDD scenarios](../../bdd/artifacts/shops-catalogue-bdd.md)
- [DDD boundaries](../../ddd/artifacts/shops-catalogue-ddd.md)
- [Phase 7a implementation plan](../../../../../../11-PRD-v2-Implementation-Plan.md)
