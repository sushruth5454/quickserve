# QuickServe Phase 7a — Shops, Catalogue, Search & Enquiries — BDD

**Status:** Behavior specified; CI validation pending.

## Scope and actors

Customers discover verified shops and ask product questions. Shop owners maintain one shop and its catalogue. Administrators review shops and enable product categories. Bulk RFQ, checkout, and payment are out of scope.

## Scenarios

### SC-01 — Feature gates fail closed

```gherkin
Feature: Shops and catalogue feature gates
  Scenario: Product operations are disabled by default
    Given the products and product_enquiries flags have not been enabled
    When a customer or owner calls a product or enquiry operation
    Then the server refuses the operation
    And product images cannot be uploaded through the product-images bucket
```

### SC-02 — Owners maintain shops; administrators verify them

```gherkin
Feature: Shop ownership and verification
  Scenario: Only the owner edits a shop and only an administrator verifies it
    Given a signed-in owner has a shop
    When the owner saves details and submits a complete shop for review
    Then the shop is submitted but is not searchable until an administrator verifies it
    And another user cannot edit that shop
    And only an administrator can verify, reject, or suspend it
```

### SC-03 — Search returns eligible products in server-computed order

```gherkin
Feature: Product discovery
  Scenario: Search applies category, price, stock, and distance filters
    Given active products belong to verified shops
    When a customer searches with a query, category, location, radius, maximum price, or stock filter
    Then unverified shops and inactive products are excluded
    And matching filters are applied by the server
    And results are ordered by server-computed distance when a location is supplied
```

### SC-04 — Catalogue prices are explicitly indicative

```gherkin
Feature: Indicative catalogue pricing
  Scenario: A customer sees the price disclaimer wherever a product price is shown
    Given a product has an indicative price or no price
    When the customer views a product result or detail
    Then any displayed price is labeled "Indicative price — confirm with shop."
    And no checkout or payment is offered
```

### SC-05 — Catalogue limits and data are server-validated

```gherkin
Feature: Product catalogue limits
  Scenario: An owner cannot exceed catalogue or image limits
    Given an owner manages a shop
    When the owner saves a product or its images
    Then the server rejects a 501st product or a seventh image
    And image uploads are limited to 5 MiB and JPEG, PNG, or WebP
    And the server validates ownership, price, unit, category, and category-specific specifications
```

### SC-06 — Enquiry messages preserve participant and unread state

```gherkin
Feature: Product enquiries
  Scenario: A customer and the shop owner exchange messages
    Given product_enquiries and products are enabled
    And a customer starts an enquiry with a verified shop about an active product
    When either authorized participant sends a message
    Then the server determines whether the sender is the customer or shop
    And the other participant receives a product enquiry notification and unread count
    When a participant opens the conversation
    Then only that participant's unread count is cleared
    And a closed conversation cannot receive a message until reopened
```

## Automation readiness

| Scenario | Implementation evidence | Isolated assertion | Validation state |
|---|---|---|---|
| SC-01 | [`0049_shops_catalogue.sql`](../../../../../../../supabase/migrations/0049_shops_catalogue.sql): feature seeds and RPC/bucket guards | [`shops_catalogue.test.mjs`](../../../../../../../supabase/tests/shops_catalogue.test.mjs): default flags and disabled search/enquiry assertions | Present; CI pending |
| SC-02 | `save_shop`, `submit_shop`, `admin_set_shop_status`; customer and merchant shop routes | Test creates verified and pending shops, checks search visibility, and rejects product save without an owner shop | Present; CI pending; explicit non-admin status-transition assertion remains desirable |
| SC-03 | `search_products` and `search_shops`; [`products.tsx`](../../../../../../../app/app/products.tsx) | Test checks verified-shop visibility, distance order, text match, price, and stock filters | Present; CI pending |
| SC-04 | [`components.tsx`](../../../../../../../app/src/features/shops/components.tsx) and customer product routes | No automated UI assertion for the exact label; SQL test covers the maximum-price filter | UI assertion pending; CI pending |
| SC-05 | `save_product`, product trigger, private bucket configuration, and merchant editor | Test checks invalid specs, seventh image, and 501st product | Present; bucket MIME/byte-limit assertion pending; CI pending |
| SC-06 | Enquiry RPCs, notification writes, and [`enquiry/[id].tsx`](../../../../../../../app/app/enquiry/%5Bid%5D.tsx) | Test checks participant isolation, notification kinds, unread transitions, sender side, closed-thread rejection, and disabled flag | Present; CI pending |

## Trace links

- DDD: [Shops & Catalogue — DDD](../../ddd/artifacts/shops-catalogue-ddd.md)
- Traceability: [Shops & Catalogue — Traceability](../../bdd-ddd-tdd/artifacts/shops-catalogue-traceability.md)
- Plan: [PRD v2 implementation plan](../../../../../../11-PRD-v2-Implementation-Plan.md)

**CI validation pending.** The isolated SQL test was added but not run; shared migration/test registration, notification routing, and navigation integration remain follow-up work.
