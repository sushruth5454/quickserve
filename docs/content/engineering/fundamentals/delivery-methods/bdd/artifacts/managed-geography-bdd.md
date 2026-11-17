# Managed Geography — BDD

**Status:** Behavior defined; implementation integrated; CI validation pending.

## Discovery

- **Actors:** QuickServe administrator; customer and provider using location selection; automated SQL checks.
- **Goal:** Manage a state → district → city → area hierarchy and expose usable active areas as optional location quick picks.
- **Scope:** Hierarchy validation, Places-backed area coordinates, active filtering, admin authorization/audit, and `area_picker` behavior.
- **Rules:** Each child requires an existing parent; names are trimmed, 2–80 characters, and unique among siblings. Areas require latitude/longitude within geographic bounds. Seed only names; do not fabricate coordinates.
- **Picker rule:** The Phase 5 plan enables `area_picker` by default. When disabled or no active area survives active-ancestor filtering, hide quick picks while preserving search and GPS.
- **Out of scope:** Changes to `category_cities`, `resolve_service_city`, or service-city launch gating.
- **Unresolved questions:** None blocking this behavior.

## Scenarios

### MG-01 — Keep the geography hierarchy valid

```gherkin
Feature: Managed service geography
  Scenario: An administrator adds a child under an existing parent
    Given the administrator is adding a district, city, or area
    And its immediate parent exists
    When the administrator saves a name of 2 to 80 characters
    Then the child is stored under that parent
    And a duplicate sibling name or missing parent is rejected
```

### MG-02 — Use Places coordinates for areas

```gherkin
Feature: Managed service geography
  Scenario: An administrator adds an area from a resolved Places result
    Given an administrator is adding an area to a city
    When the administrator selects a Places result and saves it
    Then the resolved place name and coordinates are stored for the area
    And missing or out-of-range coordinates are rejected
```

### MG-03 — Hide inactive areas and inactive ancestry

```gherkin
Feature: Managed service geography
  Scenario: A quick pick is available only through an active hierarchy
    Given an area, city, district, and state are all active
    When the app loads managed areas
    Then the area is available with its city name
    When any node in that hierarchy is inactive
    Then the area is excluded from quick picks
```

### MG-04 — Restrict changes and record administrator actions

```gherkin
Feature: Managed service geography
  Scenario: Only an administrator can change managed geography
    Given a signed-in user is not an administrator
    When the user attempts the geography upsert or a direct table write
    Then the change is refused
    Given an administrator performs a valid upsert
    Then the change succeeds and an audit record is written
```

### MG-05 — Respect the area-picker switch without disrupting location tools

```gherkin
Feature: Managed service geography
  Scenario: Managed quick picks are optional
    Given area_picker is enabled and at least one area has an active ancestry
    When a customer opens location selection or a provider without a base pin opens area onboarding
    Then matching active managed areas appear as quick picks
    Given area_picker is disabled or no active areas are available
    Then quick-pick chips are hidden
    And location search and GPS remain available
```

### MG-06 — Seed no invented coordinates

```gherkin
Feature: Managed service geography
  Scenario: Initial geography contains names only
    Given the managed-geography migration is applied
    Then Telangana, Sangareddy district, and Sangareddy city may be seeded by name
    And the seeded city has no coordinates
    And no area coordinates are fabricated or seeded
```

## Automation readiness

| Scenario | Observable pass/fail signal | Verification |
|---|---|---|
| MG-01 | Parent foreign keys, sibling-name uniqueness, and name length reject invalid hierarchy rows | `supabase/tests/managed_geography.test.mjs` checks parent FKs; duplicate/name-length assertions remain pending |
| MG-02 | Admin UI resolves Places results; RPC and table constraints reject missing or invalid coordinates | `app/app/admin/geography.tsx`; SQL checks out-of-range coordinates; missing-coordinate assertion remains pending |
| MG-03 | `listAreas()` returns an area only when its row and every ancestor are active; anonymous reads exclude inactive rows | `app/src/lib/geographyApi.ts`; SQL active-filter checks in `managed_geography.test.mjs` |
| MG-04 | Non-admin RPC/direct writes fail; a successful upsert writes to `admin_audit_log` | `0046_managed_geography.sql`; SQL tests cover denial, while an audit assertion remains pending |
| MG-05 | `isAreaPickerEnabled()` gates quick picks in both pickers; search/GPS remain outside that gate | `app/app/location.tsx`; `app/src/features/providerOnboarding/AreaSection.tsx` |
| MG-06 | Migration seed contains names only; city coordinates remain null | `0046_managed_geography.sql` |

The SQL test does not yet directly exercise Places-origin or client-side ancestor filtering; those remain CI/integration validation items.

## Trace links

- DDD: [Managed Geography — DDD](../../ddd/artifacts/managed-geography-ddd.md)
- Traceability: [Managed Geography — Traceability](../../bdd-ddd-tdd/artifacts/managed-geography-traceability.md)
- Feature-switch decision: [ADR-0001 — Feature Flag Registry](../../../../../../adr/ADR-0001-feature-flag-registry.md)
- Plan: [PRD v2 implementation plan](../../../../../../11-PRD-v2-Implementation-Plan.md)

## Phase status

- **BDD:** Scenarios and observable outcomes defined.
- **DDD:** Ownership and invariants are captured in the linked artifact.
- **Implementation:** Integrated, including `area_picker` defaulting to true as specified by Phase 5.
- **CI validation:** Pending.
