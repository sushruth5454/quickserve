# QuickServe Phase 8 — AI Product Assistance — BDD

**Status:** Product search and usage metering specified; quote-photo extraction blocked by the image privacy gate.

**Validation:** SQL, Deno, and Jest tests are authored but were not run; repository policy is GitHub Actions only.

## Actors and assumptions

- Customers search the live product catalogue using a natural-language request.
- Administrators inspect aggregate AI call, estimated-cost, and error-rate metrics.
- The AI feature flags default off and are enforced by the server.
- Gemini receives only the redacted product-search text and catalogue category names. Coordinates are used only by the database search.
- Product names, prices, availability, and shops come only from `search_products`.
- Existing non-photo chat/voice calls retain their current quotas; each Gemini model call is recorded separately, including failed primary and fallback attempts.
- Chat cost is reported separately by feature and remains included in the existing global monthly AI budget.
- No customer photo is sent to any model until image pixels can be robustly redacted in-repo; this also blocks existing diagnostic-photo requests.

## Scenarios

### AI-PROD-01 — Product search is disabled by default

```gherkin
Feature: AI product search
  Scenario: Disabled feature refuses model use
    Given ai_product_search is disabled
    When a customer submits a natural-language product query
    Then the server refuses before calling Gemini
    And no product search usage is recorded
```

### AI-PROD-02 — Intent becomes editable filters and database-owned results

```gherkin
Feature: Natural-language product search
  Scenario: Search with validated intent filters
    Given products and ai_product_search are enabled
    And the customer has entered a product need
    When the server removes detectable contact and address details and asks Gemini for JSON filters
    Then unknown category slugs become null
    And the server calls search_products with the validated filters and selected location
    And every returned product, price, stock state, and shop comes from database rows
    And the customer can edit the filters and search again
```

### AI-PROD-03 — Invalid model filters fail safely

```gherkin
Feature: AI filter validation
  Scenario: Malformed filters cannot become catalogue facts
    Given Gemini returns invalid JSON or a filter with an invalid type or range
    When the server validates the response
    Then the request fails without returning model-generated product data
    And the failed attempt is logged with token, cost, latency, model, and success metadata
```

### AI-PROD-04 — Usage caps and monthly budget are server-enforced

```gherkin
Feature: AI product search metering
  Scenario: Daily and monthly limits reject further calls
    Given a customer has reached the configured daily limit or the global monthly budget is reserved
    When the customer requests another AI product search
    Then the server refuses before calling Gemini
    And the response identifies the daily limit or monthly budget
```

### AI-PROD-05 — Administrators see aggregate usage only

```gherkin
Feature: AI operations dashboard
  Scenario: Admin reviews AI feature activity
    Given an administrator opens AI usage
    When the server returns aggregate feature metrics
    Then calls today, monthly estimated cost versus budget, and error rate are shown
    And non-administrators are refused
```

### AI-CHAT-01 — Existing chat calls are metered without changing quotas

```gherkin
Feature: Existing AI chat metering
  Scenario: Record primary, fallback, successful, and failed model calls
    Given a non-photo chat request passes the existing message and voice quotas
    When the assistant invokes one or more Gemini models
    Then each model API call is recorded with its model, latency, outcome, and available token/cost data
    And failed calls with unavailable token metadata are not logged as zero-cost
    And all records share the chat request ID
    And the existing chat and voice quotas remain unchanged
```

### AI-CHAT-02 — Chat cost remains included in the global budget

```gherkin
Feature: AI usage reporting
  Scenario: Admin reviews chat without changing product budget semantics
    Given an administrator opens AI usage
    When chat and product-assistance usage are aggregated
    Then chat requests, model calls, tokens, cost, and errors are reported separately
    And chat cost remains included in the global monthly AI budget
```

### AI-QTE-01 — Quote photos remain blocked until visual redaction exists

```gherkin
Feature: Quote photo privacy
  Scenario: Unredacted quotation images are never sent to Gemini
    Given quote-photo extraction has no verified pixel-level phone and address redactor
    When a client requests quote_extract with an image
    Then the server refuses the mode before decoding or forwarding the image
    And no image is transmitted to Gemini
```

### AI-PRIV-01 — Image payloads are refused before decoding or transmission

```gherkin
Feature: AI image privacy
  Scenario: Unredacted customer photos never reach Gemini
    Given the in-repo image path can strip metadata but cannot redact visible text
    When a customer submits an image to any AI mode
    Then the server refuses before decoding or storing the image
    And the image is not transmitted to Gemini
```

## Automation readiness

| Scenario | Intended evidence | Validation |
|---|---|---|
| AI-PROD-01 | `ai_usage.test.mjs`: disabled flag returns a rejection | `cd supabase/tests; npm test` after parent registration |
| AI-PROD-02 | `product_search_test.ts`: PII/address removal, filter validation; Edge RPC uses `search_products` | `deno test supabase/functions/ai-assistant` |
| AI-PROD-03 | `product_search_test.ts`: unknown categories, invalid price and boolean | `deno test supabase/functions/ai-assistant` |
| AI-PROD-04 | `ai_usage.test.mjs`: daily limit, budget reservation, completion accounting | `cd supabase/tests; npm test` after parent registration |
| AI-PROD-05 | `ai_usage.test.mjs`: admin aggregation and non-admin refusal | `cd supabase/tests; npm test` after parent registration |
| AI-CHAT-01 | `chat_usage_test.ts`: failed primary plus successful fallback records | `deno test supabase/functions/ai-assistant` |
| AI-CHAT-02 | `ai_usage.test.mjs`: chat metrics and product-budget isolation | `cd supabase/tests; node ai_usage.test.mjs` after parent registration |
| AI-QTE-01 | Edge handler rejects `quote_extract`; no image-processing path is invoked | `deno test supabase/functions/ai-assistant` |
| AI-PRIV-01 | Edge handler blocks all image payloads until pixel redaction is implemented | `deno test supabase/functions/ai-assistant` |

## Trace links

- DDD: [AI Product Assistance — DDD](../../ddd/artifacts/ai-product-assistance-ddd.md)
- Traceability: [AI Product Assistance — Traceability](../../bdd-ddd-tdd/artifacts/ai-product-assistance-traceability.md)
- Phase plan: [PRD v2 implementation plan](../../../../../../11-PRD-v2-Implementation-Plan.md), Phase 8
