# QuickServe Phase 7b — Product RFQs & Supplier Comparison — BDD

**Status:** Behavior specified; isolated SQL validation pending.

## Actors and assumptions

Customers request product quotations from verified shops. Shop owners can quote only RFQs routed to their shop. RFQs reuse the 7a product-category, verified-shop, and product-enquiry contracts. RFQ operations require `products` and `product_rfq`; choosing a supplier also requires `product_enquiries` so the resulting thread is usable. Selection is not a purchase and never initiates payment.

## Scenarios

### RFQ-01 — Feature gates fail closed

```gherkin
Feature: Product quotation requests
  Scenario: Product RFQ is disabled by default
    Given the product_rfq feature flag is disabled
    When a customer creates an RFQ or a supplier lists or submits a quote
    Then the server refuses the operation
    And the customer and supplier RFQ screens explain that the feature is unavailable
```

### RFQ-02 — Requests route to at most ten eligible shops

```gherkin
Feature: RFQ routing
  Scenario: Route by category, verification, delivery eligibility, and radius
    Given a customer submits 1 to 20 items for an active product category and a map location
    When the server creates the RFQ
    Then only verified shops selling that category and within their configured radius are recipients
    And delivery-only requests exclude shops that do not offer delivery
    And no more than ten nearest eligible shops receive the RFQ
    And each recipient owner receives an RFQ notification
```

### RFQ-03 — RFQs and quotes are participant-only

```gherkin
Feature: RFQ privacy
  Scenario: Non-participants cannot inspect or answer an RFQ
    Given an RFQ belongs to one customer and is routed to selected shops
    When a different customer reads it or an unrouted shop submits a quote
    Then the customer receives no RFQ details
    And the unrouted shop is refused
```

### RFQ-04 — Server owns quote quantities and totals

```gherkin
Feature: Supplier quotation totals
  Scenario: Quote lines use requested quantities and server-calculated GST
    Given a routed shop quotes every RFQ item
    When it submits prices, GST rates, availability, delivery charge, and notes
    Then each stored quote quantity equals the customer's RFQ quantity
    And line totals, per-line GST, subtotal, and total are calculated by the server
    And any client-supplied quantity or total fields are ignored
    And quote validity cannot exceed RFQ expiry
    And a replacement sent quote withdraws that shop's prior sent version
```

### RFQ-05 — Comparison reports differences without equivalence

```gherkin
Feature: Supplier quote comparison
  Scenario: Show requested and offered item details with explicit markers
    Given the customer has received supplier quotes
    When the customer compares them
    Then the response includes price, delivery, validity, and unavailable-item counts
    And brand_differs is true when the offered brand differs case-insensitively from a requested brand
    And specs_missing identifies requested spec keys absent from the offer
    And requested and offered values remain visible without an item-equivalence conclusion
```

### RFQ-06 — Selection starts a conversation, not payment

```gherkin
Feature: Supplier selection
  Scenario: Select one available quote
    Given the RFQ is open and product enquiries are enabled
    When its customer selects a valid sent quote
    Then that quote is selected, other sent quotes are rejected, and the RFQ is closed
    And a product-enquiry thread opens with the selected shop for next steps
    And no payment is created or collected
```

### RFQ-07 — Expiry closes stale requests and offers

```gherkin
Feature: RFQ expiry
  Scenario: Expire overdue RFQs and outstanding quotes
    Given an open RFQ or sent quote has reached its expiry
    When the scheduled expiry job runs
    Then overdue RFQs are marked expired
    And their outstanding sent quotes are marked expired
```

### RFQ-08 — Admins can inspect aggregate activity

```gherkin
Feature: RFQ operations reporting
  Scenario: Admin views marketplace quotation activity
    Given an administrator opens the RFQ dashboard
    When the server returns aggregate RFQ activity
    Then the dashboard shows open RFQs, quote counts per request, and average first response time
    And non-administrators cannot read the dashboard
```

## Automation readiness

| Scenario | Isolated test evidence | Validation |
|---|---|---|
| RFQ-01 | `rfq.test.mjs`: disabled-by-default assertion and refused-create assertion | Not run by request |
| RFQ-02 | `rfq.test.mjs`: 10-recipient cap, eligibility filters, recipient notifications | Not run by request |
| RFQ-03 | `rfq.test.mjs`: customer RLS, private details, and non-recipient quote refusal | Not run by request |
| RFQ-04 | `rfq.test.mjs`: forged totals ignored, RFQ quantities copied, per-line GST, validity cap, replacement version | Not run by request |
| RFQ-05 | `rfq.test.mjs`: brand/spec markers and absence of an equivalence marker | Not run by request |
| RFQ-06 | `rfq.test.mjs`: quote/RFQ state, enquiry creation, and zero payment rows | Not run by request |
| RFQ-07 | `rfq.test.mjs`: independent quote expiry and expired RFQ state | Not run by request |
| RFQ-08 | `rfq.test.mjs`: non-admin denial and admin metrics response | Not run by request |

## Trace links

- DDD: [Product RFQ & Supplier Quotes — DDD](../../ddd/artifacts/product-rfq-ddd.md)
- Traceability: [Product RFQ — Traceability](../../bdd-ddd-tdd/artifacts/product-rfq-traceability.md)
- Phase plan: [PRD v2 implementation plan](../../../../../../11-PRD-v2-Implementation-Plan.md), Phase 7b

**CI validation pending.** The isolated SQL test was authored but not executed. Shared migration/test registration, notification deep-link routing, and navigation wiring remain parent integration steps.
