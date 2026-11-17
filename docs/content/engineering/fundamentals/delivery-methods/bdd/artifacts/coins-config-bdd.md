# QuickServe Phase 2 — Coins Configuration — BDD

**Status:** Owner-approved behavior; implementation artifacts are present; CI validation pending.
**Policy approval:** Owner instruction dated November 17, 2026.

## Discovery

- **Actors:** customer, administrator, booking/payment services.
- **Goal:** configure Seva Coins earning, redemption, expiry, and feature availability without changing the paise value of existing wallets.
- **Scope:** `0047_coins_config.sql`, server-side coin RPCs, coin helpers and customer/admin screens, and isolated SQL/unit-test coverage.
- **Out of scope:** converting historical ledger values, cash withdrawal, or transfers between users.
- **Invariant:** ledger and wallet balances remain integer paise. At 10 paise per coin, 5,000 paise continues to equal ₹50 and displays as 500 coins.

## Approved rules

| Rule | Default |
|---|---:|
| Coin denomination | 10 paise |
| Earn rate | 100 bp (1%) |
| Per-booking earn cap | 2,000 paise (₹20) |
| First completed booking bonus | 1,000 paise (₹10) |
| Monthly earn cap | 100,000 paise (₹1,000) |
| Redemption cap | 1,000 bp (10%), also bounded by balance and platform revenue |
| Expiry | 6 months |
| Pilot issuance budget | 1,000,000 paise (₹10,000) |
| `coins_earning`, `coins_redemption` | Enabled |

Earning is rounded down to whole configured coins, capped per booking, then includes the first-booking bonus before monthly and lifetime-budget caps.

## Scenarios

### COIN-01 — Preserve wallet value while changing display denomination

```gherkin
Feature: Seva Coins configuration
  Scenario: Existing paise balances retain their value
    Given a customer has 5000 paise in the coin wallet before migration
    When migration 0047 is applied
    Then the stored wallet balance remains 5000 paise
    And the customer sees 500 coins with a value of ₹50
```

### COIN-02 — Apply configured earning, per-booking cap, and first-booking bonus

```gherkin
Feature: Seva Coins configuration
  Scenario: A first completed booking earns capped coins and a bonus
    Given the customer has no prior coin earn or bonus
    And the booking has ₹2150 eligible service value
    When the booking closes
    Then the 1% base earning is capped at ₹20
    And the customer receives a ₹10 first-booking bonus
    And the ledger records 3000 paise total credit
```

### COIN-03 — Enforce monthly cap and pilot budget

```gherkin
Feature: Seva Coins configuration
  Scenario: Earn is limited by the remaining monthly and pilot budgets
    Given the customer or program has reached its configured earning limit
    When another eligible booking closes
    Then no amount above either remaining limit is credited
    And an exhausted pilot budget creates no earn or bonus ledger entry
```

### COIN-04 — Enforce redemption caps and denomination rounding

```gherkin
Feature: Seva Coins configuration
  Scenario: Redemption uses the lowest server-calculated cap
    Given a customer has coins and an open booking quote
    When the redemption preview and approval are calculated
    Then redemption is bounded by the wallet balance, configured service-value cap, and platform revenue
    And the applied amount is rounded down to whole configured coins
```

### COIN-05 — Honor earning and redemption feature switches

```gherkin
Feature: Seva Coins configuration
  Scenario: Disabled earning and redemption are enforced by the server
    Given an administrator has disabled earning or redemption
    When a booking closes or a customer requests redemption
    Then disabled earning creates no credit
    And disabled redemption previews as zero and cannot be applied
```

### COIN-06 — Apply expiry and protect administration

```gherkin
Feature: Seva Coins configuration
  Scenario: Configured expiry and admin-only policy changes
    Given an administrator configures a valid expiry and coin policy
    When a new credit is issued or an unauthorized user changes policy
    Then the credit expires after the configured number of months
    And policy changes are validated, admin-only, and audited
    And administrators can inspect issuance, redemption, expiry, liability, and budget
```

## Automation readiness

| Scenario | Evidence authored | Observable result |
|---|---|---|
| COIN-01 | `supabase/tests/coins_config.test.mjs` | Existing 5,000-paise balance remains unchanged and is displayed as 500 coins |
| COIN-02 | `supabase/tests/coins_config.test.mjs`; `app/src/lib/__tests__/coins.test.ts` | 2,000-paise capped earn plus 1,000-paise first-booking bonus |
| COIN-03 | Both coin tests | Monthly helper cap and exhausted SQL budget produce no over-credit |
| COIN-04 | SQL and unit coin tests | Preview/approval use the configured caps and coin unit |
| COIN-05 | SQL coin test | Disabled earning yields no credit; disabled redemption previews zero and is rejected |
| COIN-06 | SQL coin test | Expiry, admin authorization/config validation, and summary fields are exercised |

## Trace links and open items

- DDD: [Coins Configuration — DDD](../../ddd/artifacts/coins-config-ddd.md)
- Scenario-to-test mapping: [Coins Configuration — Traceability](../../bdd-ddd-tdd/artifacts/coins-config-traceability.md)
- Approved rules: `docs/11-PRD-v2-Implementation-Plan.md`, Phase 2.
- Implementation: `supabase/migrations/0047_coins_config.sql`, `supabase/tests/coins_config.test.mjs`, `app/src/lib/coins.ts`, `app/src/lib/coinsConfigApi.ts`, `app/app/coins.tsx`, and `app/app/admin/coins.tsx`.
- **CI gate pending:** the SQL and app tests have not yet passed in GitHub Actions; shared runner registration is in progress.
