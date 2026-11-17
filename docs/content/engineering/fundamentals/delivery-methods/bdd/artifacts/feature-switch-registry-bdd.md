# Feature Switch Registry — BDD

## Discovery

- **Actors:** administrator; application user; automated SQL behavior tests.
- **Goal:** let administrators manage generic feature switches from database rows while preserving existing switch behavior and fail-closed server enforcement.
- **Scope:** Phase 0 registry migration, admin listing/toggling, app feature lookup, and automated verification.
- **Out of scope:** later-phase feature behavior, new admin capabilities, and changes to archetype feature management.
- **Assumptions from the implementation plan:** the three existing generic switches are `ai_assistant`, `urgent_requests`, and `fixed_asap`; their current values are preserved. A later-phase switch is inserted with `enabled = false`. Archetype flags remain separate.
- **Unresolved questions:** none required to define the Phase 0 behavior.

## Scenarios

### FSR-01 — Preserve existing switch values

```gherkin
Feature: Feature switch registry
  Scenario: Existing generic switches retain their current values
    Given the current values for "ai_assistant", "urgent_requests", and "fixed_asap" are stored in app_config.features
    When the Phase 0 registry migration seeds those switches
    Then each feature_flags row has the corresponding current enabled value
    And get_app_features returns the generic switches and exposes archetype flags separately
```

### FSR-02 — List and dynamically toggle a new registry row

```gherkin
Feature: Feature switch registry
  Scenario: An administrator manages a newly inserted switch without an admin-screen code change
    Given a new feature_flags row exists with enabled set to false
    When an administrator opens the admin UI
    Then the row is listed by admin_list_features and shown as a switch
    When the administrator enables that switch
    Then admin_set_feature updates the row
    And get_app_features reports the switch as enabled
    And the app isOn helper reports the switch as on
```

### FSR-03 — Unknown switches fail closed

```gherkin
Feature: Feature switch registry
  Scenario: An unknown switch cannot enable a feature
    Given no feature_flags row exists for a requested key
    When the server checks the key with _feature_enabled
    Then the result is false
    When an administrator tries to set that unknown key
    Then the operation fails with "unknown feature"
```

### FSR-04 — Non-administrators cannot manage registry switches

```gherkin
Feature: Feature switch registry
  Scenario: A non-administrator is denied registry management
    Given the current user is not an administrator
    When the user calls admin_list_features or attempts to change a switch with admin_set_feature
    Then the management operation is refused
    And the user cannot read or change feature_flags directly
```

### FSR-05 — Automated checks make registry outcomes observable

```gherkin
Feature: Feature switch registry
  Scenario: Registry contract regressions are reported by automated tests
    Given the planned SQL behavior tests cover migrated values, unknown keys, and administrator-only operations
    When the planned feature-registry checks run
    Then a failed contract assertion is reported as a test failure
    And passing assertions provide automated pass/fail evidence for those behaviors
```

## Automation readiness

| Scenario | Observable pass/fail signal | Planned test level and reference | Preconditions |
|---|---|---|---|
| FSR-01 | Seeded `enabled` values match the three current values; archetype flags remain separate in `get_app_features` | `supabase/tests/prd_v2.test.mjs`: "existing app feature values are preserved during migration" | Existing values for the three generic switches and archetype flags |
| FSR-02 | New row can be listed/toggled without a code whitelist; result is reflected by `get_app_features` | `supabase/tests/prd_v2.test.mjs`: dynamic row list/toggle; Jest `featureFlags.test.ts`: unknown app lookup off; E2E `admin-feature-registry` renders/toggles an extra mocked row | Administrator; newly inserted row |
| FSR-03 | `_feature_enabled` returns false; setting an unknown key fails with `unknown feature` | `supabase/tests/prd_v2.test.mjs`: unknown server key false and unknown admin set rejected | Key absent from `feature_flags` |
| FSR-04 | Non-admin listing/change attempts and direct table access are refused | `supabase/tests/prd_v2.test.mjs`: registry table read, list, and update denied | Authenticated non-admin |
| FSR-05 | Contract assertions produce automated pass/fail results | `supabase/tests/prd_v2.test.mjs` runs in `npm test`'s pretest hook; `e2e/web-smoke.mjs` step `admin-feature-registry` | Migration chain through 0042 |

## Trace links

- DDD: [Feature Switch Registry — DDD](../../ddd/artifacts/feature-switch-registry-ddd.md)
- Traceability: [Feature Switch Registry — Traceability](../../bdd-ddd-tdd/artifacts/feature-switch-registry-traceability.md)
- Decision: [ADR-0001 — Feature Flag Registry](../../../../../../adr/ADR-0001-feature-flag-registry.md)

## Phase status

- **BDD:** defined; scenarios are covered by SQL assertions and the unknown-key app helper test.
- **DDD:** ownership is captured in the linked artifact.
- **TDD/implementation:** migration 0042, app changes, and focused tests are implemented; CI/E2E validation remains.
