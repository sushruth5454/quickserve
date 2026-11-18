# QuickServe Phase 8 — AI Product Assistance — Traceability

**Status:** Product-search/metering implementation in progress; quote-photo extraction blocked by the image privacy gate; CI validation pending.

| BDD scenario | DDD owner / invariant | Test evidence | Implementation |
|---|---|---|---|
| AI-PROD-01 | AI Product Assistance; server rejects while flag is off | `supabase/tests/ai_usage.test.mjs` | `0051_ai_usage_v3.sql`, `supabase/functions/ai-assistant/index.ts` |
| AI-PROD-02 | Product Catalogue owns product facts; AI emits filters only | `product_search_test.ts`; app Jest tests | `supabase/functions/ai-assistant/product_search.ts`, `app/src/features/ai/productSearch.ts`, `app/app/products.tsx` |
| AI-PROD-03 | AI filter validation cannot create catalogue facts | `product_search_test.ts` | `product_search.ts`, `index.ts` |
| AI-PROD-04 | AI Metering owns daily/global cost admission and completion | `supabase/tests/ai_usage.test.mjs` | `0051_ai_usage_v3.sql`, `index.ts` |
| AI-PROD-05 | AI Operations returns aggregate metrics to admins only | `ai_usage.test.mjs` | `0051_ai_usage_v3.sql`, `app/app/admin/ai.tsx` |
| AI-QTE-01 | AI Image Input; no unredacted quote photo reaches a model | `request_mode_test.ts`, `image_privacy_test.ts` | `request_mode.ts`, `image.ts`, `index.ts`; extraction/persistence remain blocked |

## Shared integration

- Register migration `0051_ai_usage_v3.sql` and `ai_usage.test.mjs` in backend CI/full-chain tests.
- Run the existing Deno test/type-check gate and EAS app typecheck/Jest.
- Update this artifact with exact CI run IDs after validation.

## Residual risk

Visible-text redaction for arbitrary quotation images is not available in the repository. The server refuses all image payloads until a verified redaction implementation exists, so Phase 8 quote extraction is not complete and must remain disabled.

## References

- [AI Product Assistance — BDD](../../bdd/artifacts/ai-product-assistance-bdd.md)
- [AI Product Assistance — DDD](../../ddd/artifacts/ai-product-assistance-ddd.md)
- [Phase plan](../../../../../../11-PRD-v2-Implementation-Plan.md)
