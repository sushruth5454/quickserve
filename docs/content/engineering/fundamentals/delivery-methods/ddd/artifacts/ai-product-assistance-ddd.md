# QuickServe Phase 8 — AI Product Assistance — DDD

**Status:** Product-search assistance and metering implemented in the Phase 8 scope. Quote-photo extraction is deferred at the privacy boundary. Tests were not run per repository policy.

## Ubiquitous language

| Term | Meaning |
|---|---|
| Product intent | The customer's sanitized natural-language product need sent to Gemini for filter extraction. |
| Search filters | Validated category slug, text query, brand, maximum price in paise, and stock-only preference. |
| Catalogue result | A product row returned by the existing `search_products` database function. Gemini never owns or authors result facts. |
| Usage reservation | A server-created `ai_usage` row reserving a conservative maximum model cost before Gemini is called. |
| Estimated model cost | Token-derived USD cost in integer micro-USD using the configured model's supported rate schedule. Unknown model rates fail closed. |
| Quote-photo privacy gate | The rule that no quotation image may reach a model until phone numbers and addresses can be removed from image pixels. |

## Bounded contexts and ownership

| Context | Owns | Invariants and boundary |
|---|---|---|
| **AI Product Assistance** | `ai-assistant` product-search mode; prompt; privacy text scrub; filter validation | Converts sanitized intent to filters only. It cannot create product names, prices, stock state, or shop facts. |
| **Product Catalogue** | Product/category/verified-shop data and `search_products` | Receives validated filters and selected coordinates, applies existing catalogue rules, and owns every returned row. No catalogue mutation occurs. |
| **AI Metering** | `ai_usage`, `ai_limits`, begin/finish product-assistance RPCs, chat model-call records, admin aggregate RPC | Reserves product-assistance daily quota and monthly budget before search model work. Existing chat writes per-model-call token/cost/latency/outcome rows through the service role after the chat completes; logging failure does not alter the chat result. |
| **AI Image Input** | Deferred | The current image helper removes metadata, not visible phone/address pixels. The server refuses all customer images before decoding, storing, or forwarding them; this also pauses existing diagnostic-photo input. |
| **Quote Extraction** | Deferred | No quote-image route is implemented. The server rejects `quote_extract` unconditionally until a robust pixel-redaction path and the external-quote persistence contract exist. |

## Aggregate and consistency decisions

- `ai_usage` is the metering event ledger. `begin_ai_usage` serializes reservations on the `ai_limits` row, checks the user/day limit and global month budget, and inserts the reservation before external model work.
- `finish_ai_usage` updates only the service-created reservation. Unknown model prices or missing rate configuration prevent an AI product-search call.
- Chat usage records use one row per Gemini generate call, grouped by the request ID. Chat keeps the existing message/voice quotas; its known token cost remains part of the existing global monthly AI budget total.
- The product-search endpoint passes only sanitized text and allowed category names to Gemini. Coordinates remain in server/database arguments and are not included in model context.
- The endpoint validates model filters, converts unknown category slugs to `null`, and calls `search_products` with the validated filters. The result response contains the database rows, not generated product content.
- Both `ai_product_search` and `ai_quote_extract` are seeded disabled. `quote_extract` is rejected unconditionally while pixel-level redaction is unavailable, including if an administrator enables its flag.
- All AI image payloads are refused before decoding or storage because the available image helper strips metadata only; it does not redact visible phone numbers or addresses.
- AI product search has no RPC or write path for pricing, payment, verification, coins, product stock, or availability.

## Tactical design checklist

- [x] Feature flags are registered server-side with disabled defaults.
- [x] Usage admission and completion are service-role-only RPCs.
- [x] Admin metrics are aggregate-only and require the existing admin predicate.
- [x] Existing chat model calls, including failed primary/fallback calls, are logged best-effort via service-role writes without gating or changing quotas.
- [x] Product filters are parsed and range-checked before `search_products`.
- [x] Product search is unavailable in demo mode and does not consult demo fixtures.
- [ ] Quote image redaction must operate on visible pixels and have tests proving that phone/address regions are not transmitted. Metadata removal alone does not satisfy this invariant.
- [ ] Parent must register migration 0051 and the distinct SQL test in shared CI/test chains.

## Strategic links and risks

- No ownership or consistency boundary changed; no new ADR is proposed.
- Model-token price schedules must be reviewed when the provider changes model pricing. Unsupported model IDs fail closed instead of silently reporting zero cost.
- The quote-extraction write/read schema and compare integration remain an unresolved separate dependency.

## Trace links

- BDD: [AI Product Assistance — BDD](../../bdd/artifacts/ai-product-assistance-bdd.md)
- Traceability: [AI Product Assistance — Traceability](../../bdd-ddd-tdd/artifacts/ai-product-assistance-traceability.md)
- Phase plan: [PRD v2 implementation plan](../../../../../../11-PRD-v2-Implementation-Plan.md), Phase 8
