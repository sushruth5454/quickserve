# QuickServe Phase 10 — Merchant Staff — BDD

**Status:** Behavior implemented; shared CI registration and validation pending. Local validation is prohibited by workspace policy.

## Scope and actors

An owner may add an already-registered QuickServe user by exact user ID and assign `manager` or `staff`. The feature is guarded by the server-side `merchant_staff` flag, which defaults off. No phone, email, one-time code, or bearer-link invitation flow is introduced.

## Scenarios

### SC-01 — Feature switch fails closed

```gherkin
Feature: Merchant staff feature switch
  Scenario: Staff access is disabled until an administrator enables the flag
    Given the merchant_staff feature flag is disabled
    When a business owner tries to add a member
    Then the server rejects the change
    And existing owners retain their direct owner access
    And a manager or staff member has no delegated business access
```

### SC-02 — Owners manage existing-user access

```gherkin
Feature: Existing-user staff access
  Scenario: An owner adds an existing account
    Given merchant_staff is enabled
    And the caller is the owner of the business
    And the selected QuickServe user ID belongs to an existing profile
    When the owner adds the user as staff or manager
    Then access is scoped to that owner ID
    And the role is active immediately
    And no email, phone message, invite token, or invite link is created
    And managers and staff cannot add, change, or remove members
```

### SC-03 — Cross-business access is isolated

```gherkin
Feature: Business membership boundaries
  Scenario: A member can see work only for their own business
    Given a staff member belongs to Business A
    And the same member also belongs to Business B
    And Business A and Business B both have jobs, shop enquiries, RFQs, and sports bookings
    When the staff member selects Business B and reads its supported work lists or chat
    Then only Business B rows are visible
    And Business A rows are not visible through RPCs or row-level security
```

### SC-04 — Role capabilities are enforced by the server

```gherkin
Feature: Merchant role capabilities
  Scenario: Staff view work and chat but cannot quote or administer the business
    Given a staff member belongs to a business
    When they view assigned jobs, shop enquiries, routed RFQs, or booking/request chat
    Then those business-scoped reads and chat actions are allowed
    But sending a quote or proposal is rejected
    And managing staff, changing payouts, product or venue prices, and verification is rejected

  Scenario: Managers can send quotes and proposals
    Given a manager belongs to a business
    When they send an assigned provider quote, provider proposal, or routed shop RFQ quote
    Then the server attributes the quote or proposal to the business owner
    And the manager's user ID remains the actor for job-chat messages
    But the manager cannot manage staff, payouts, catalogue prices, or verification
```

## Automation readiness

| Scenario | Evidence | Validation state |
|---|---|---|
| SC-01/02 | `0052_merchant_staff.sql`, `merchant-staff.tsx`, `merchant_staff.test.mjs` | Added; pending CI |
| SC-03 | Explicit provider-business selection, `business_members` RLS, provider/shop/sports read RPCs, and participant helpers | Added; pending CI |
| SC-04 | `_acts_for` role thresholds, manager quote/proposal RPCs, unchanged owner-only price/payout/verification RPCs | Added; pending CI |

## Trace links

- DDD: [Merchant Staff — DDD](../../ddd/artifacts/merchant-staff-ddd.md)
- Traceability: [Merchant Staff — Traceability](../../bdd-ddd-tdd/artifacts/merchant-staff-traceability.md)
- Plan: [PRD v2 implementation plan](../../../../../../11-PRD-v2-Implementation-Plan.md), Phase 10
- Migration: [`0052_merchant_staff.sql`](../../../../../../../supabase/migrations/0052_merchant_staff.sql)
- Isolated SQL test: [`merchant_staff.test.mjs`](../../../../../../../supabase/tests/merchant_staff.test.mjs)

Shared test and deployment registration is parent-owned and will be validated with the Phase 10 migration commit.
