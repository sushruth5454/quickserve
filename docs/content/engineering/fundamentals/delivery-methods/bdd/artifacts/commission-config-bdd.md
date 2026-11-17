# QuickServe Phase 1 — Commission Configuration — BDD

**Status:** Proposed for PRD v2 Phase 1; not implemented.

## Discovery

- **Actors:** administrator, provider, booking commission resolver, and provider app.
- **Goal:** let an administrator configure commission terms while preserving today's effective rates until an administrator changes them.
- **Scope:** default commission configuration, global and category rules, provider terms, and the booking-specific quote preview.
- **Out of scope:** choosing new launch rates, changing unrelated booking/payment rules, or treating a client-side calculation as authoritative.
- **Rules:** default founding period is 30 days; after it, rates are 12%, 10% at 50 completed jobs, and 8% at 200; repeat discount is 4 percentage points with a 5% floor. A category override replaces the tier only after the founding period, then the repeat rule applies.
- **Current-source note:** `0018` has a nullable `categories.commission_bp` field, but the current `0016` resolver does not read it. A live read on November 17, 2026 found zero categories with a non-null override. Phase 1 must not make any previously inert category value effective merely because the resolver changes; keep it inactive until an administrator action.

## Scenarios

### CC-01 — Seed the current economics

```gherkin
Feature: Commission configuration
  Scenario: The initial config preserves the current commission schedule
    Given no administrator has changed commission settings
    When the Phase 1 migration seeds the commission config
    Then the founding period is 30 days
    And the tiers are 1200 bp from 0 jobs, 1000 bp from 50 jobs, and 800 bp from 200 jobs
    And the repeat discount is 400 bp with a 500 bp floor
    And a provider in the first 30 days pays 0 bp
```

### CC-02 — Migration does not change effective rates by itself

```gherkin
Feature: Commission configuration
  Scenario: Config rollout does not silently activate a category rate
    Given category commission values were not explicitly activated by an administrator
    When the Phase 1 migration is applied without an admin rate change
    Then providers continue to receive the current effective global rates
    And no category value changes an effective rate solely because the new resolver can read it
```

### CC-03 — Administrator changes global terms

```gherkin
Feature: Commission configuration
  Scenario: A valid admin change is reflected in provider terms
    Given an administrator changes the founding period to 90 days
    When the provider terms are read
    Then a provider created 60 days ago has a 0 bp rate and a free-until date 90 days after creation
    And the change is effective without an app release
```

### CC-04 — Category override and repeat rule compose in order

```gherkin
Feature: Commission configuration
  Scenario: An admin-set category override is applied before the repeat discount
    Given an administrator sets a category override to 2000 bp
    And the provider is past the founding period
    And the booking qualifies for the repeat-customer rule
    When the booking-specific rate is resolved
    Then the category rate is reduced by 400 bp to 1600 bp
    And an override of 500 bp cannot reduce the effective rate below the 500 bp floor
```

### CC-05 — Quote preview uses the booking-aware server rate

```gherkin
Feature: Commission configuration
  Scenario: A provider quote uses the server-resolved rate for that booking
    Given a provider is quoting a booking with a category and customer history
    When the quote preview calculates commission
    Then it uses the server result for that booking, including category override and repeat eligibility
    And the local rate calculation is used only in explicit demo mode
```

```gherkin
Feature: Commission configuration
  Scenario: Production preview does not substitute a local estimate when rate lookup fails
    Given the booking-aware rate lookup fails outside demo mode
    When the provider opens the quote preview
    Then the preview does not present a locally calculated rate as authoritative
```

### CC-06 — Only authorized, valid changes are accepted

```gherkin
Feature: Commission configuration
  Scenario: Invalid or unauthorized commission changes are rejected
    Given a normal user or an administrator submits invalid commission settings
    When the commission management operation runs
    Then the normal user is refused
    And invalid founding days, tier values, tier floors, or category basis points are rejected
    And the stored commission terms remain unchanged
```

### CC-07 — Bring-your-own-client bookings remain commission-free

```gherkin
Feature: Commission configuration
  Scenario: Commission configuration does not add provider commission to BYO bookings
    Given a booking has the bring-your-own-client origin
    When its payout is created
    Then provider commission and GST on commission remain zero
```

## Automation readiness

| Scenario | Observable outcome | Planned verification | Existing coverage (baseline only) |
|---|---|---|---|
| CC-01 | Seeded config and rate boundaries match the current schedule | Add config/rate assertions to [`supabase/tests/prd_v2.test.mjs`](<../../../../../../../supabase/tests/prd_v2.test.mjs>) | [`money.test.ts`](<../../../../../../../app/src/lib/__tests__/money.test.ts>) tests current local rates; it does not verify migration config |
| CC-02 | Migration alone does not change effective rates or activate an unapproved category value | Add a pre/post seed assertion to `prd_v2.test.mjs`; inspect persisted category values before enabling them | No existing category-commission behavior test found; live database values were not inspected |
| CC-03 | Admin update is authorized, stored, audited, and returned by `get_commission_terms()` | SQL assertions in `prd_v2.test.mjs`; update the provider-terms app tests | [`providerInsights.test.ts`](<../../../../../../../app/src/lib/__tests__/providerInsights.test.ts>) covers current hardcoded tier progress only |
| CC-04 | Category override and repeat discount produce the specified rate | SQL assertions in `prd_v2.test.mjs` for founding, override, repeat, and floor cases | [`leakage_programme.test.mjs`](<../../../../../../../supabase/tests/leakage_programme.test.mjs>) covers current repeat discount/floor, not category overrides |
| CC-05 | Quote preview displays the result of the booking-specific server lookup | SQL RPC authorization/rate assertions plus a quote/API test; no focused quote-rate app test was found | [`money.test.ts`](<../../../../../../../app/src/lib/__tests__/money.test.ts>) tests settlement math, not the quote screen's rate source |
| CC-06 | Invalid values and non-admin calls fail without changing config | SQL assertions in `prd_v2.test.mjs` | No current commission-admin test; admin operations are proposed |
| CC-07 | BYO payout remains at zero commission | Keep the existing payout assertion green | `leakage_programme.test.mjs` already asserts zero BYO commission and GST |

## Evidence and trace links

- [PRD v2 implementation plan](../../../../../../11-PRD-v2-Implementation-Plan.md)
- Current source: [`0016_leakage_programme.sql`](<../../../../../../../supabase/migrations/0016_leakage_programme.sql>), [`0018_archetype_core.sql`](<../../../../../../../supabase/migrations/0018_archetype_core.sql>), [`money.ts`](<../../../../../../../app/src/lib/money.ts>), [`providerInsights.ts`](<../../../../../../../app/src/lib/providerInsights.ts>), [`dashboard.tsx`](<../../../../../../../app/app/(provider)/dashboard.tsx>), [`earnings.tsx`](<../../../../../../../app/app/(provider)/earnings.tsx>), and [`quote/[bookingId].tsx`](<../../../../../../../app/app/quote/[bookingId].tsx>)
- DDD: [Commission Configuration — DDD](../../ddd/artifacts/commission-config-ddd.md)
- Traceability: [Commission Configuration — Traceability](../../bdd-ddd-tdd/artifacts/commission-config-traceability.md)

## Phase status

- **BDD:** target behavior defined for the proposed phase.
- **Implementation and Phase 1 tests:** not present in this checkout; `0043_commission_config.sql` is planned, not implemented.
