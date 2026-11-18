# QuickServe Home Services Catalogue — BDD

**Status:** A1 behavior specified; migration, SQL tests, and CI validation pending.

## Discovery

### Actors and goals

- **Customer:** discover active home-service categories available in the customer’s city, with category grouping and recurrence options when the catalogue capability is enabled.
- **Administrator:** create, edit, order, activate, and disable catalogue categories without an app update, while preserving category identity and validating booking policy.
- **Catalogue read client:** consume the existing category read contract, including group and recurrence metadata, without becoming a source of category policy.

### Scope and assumptions

- A1 owns migration `0056_home_services_catalogue.sql` and `supabase/tests/home_services_catalogue.test.mjs`; admin and customer UI work is owned by A2/A3.
- Existing category slugs and IDs are preserved. Existing service slugs are re-parented, not duplicated. For the existing `house-cleaning` slug, the customer-facing label is “Home cleaning”; the slug is not changed.
- New catalogue rows are inactive and have no city-availability rows until an administrator enables them for a city.
- `home_services_catalogue_v2` gates customer exposure of the new catalogue; with the flag off, the existing catalogue remains available and newly seeded categories are not exposed. `admin_category_editor` gates category-management RPCs.
- Category recurrence frequencies must be drawn from the global `recurring_rules.frequencies` allowlist. A null category discount means “use the global rule default.”
- No unresolved business question blocks implementation. The exact existing customer catalogue read RPC must be located during implementation rather than inferred from a client call site.

### Out of scope

- Admin screens, category icons, customer grouping UI, and public TypeScript category types (A2/A3).
- Recurring-plan creation, recurrence scheduling, quotes, bookings, payments, and category-city administration workflows beyond their existing contracts.

## Scenarios

### HSC-01 — Existing services retain their identity when grouped

```gherkin
Feature: Home-service category hierarchy
  Scenario: Existing service categories are re-parented without duplication or slug changes
    Given the catalogue contains the existing home-service slugs listed in the implementation plan
    When the catalogue migration assigns those services to their parent groups
    Then each existing category keeps its ID and slug
    And each category is linked to its intended group
    And no duplicate category is created
    And the existing house-cleaning service is presented to customers as "Home cleaning"
```

### HSC-02 — New services are seeded as unavailable until configured

```gherkin
Feature: Home-service catalogue seeding
  Scenario: New service categories start inactive and without city availability
    Given the catalogue migration has been applied
    When an administrator reviews the newly seeded groups and child categories
    Then each new group has no parent, no archetype, and is inactive
    And each new child has the parent, archetype, recurrence options, and default unit specified by the plan
    And every new group and child is inactive
    And no new child is available in a city until an administrator configures that city
```

### HSC-03 — Customer visibility respects the catalogue switch and availability

```gherkin
Feature: Customer home-service discovery
  Scenario: Enabled catalogue returns category hierarchy and recurrence metadata
    Given home_services_catalogue_v2 is enabled
    And a category is active and available in the customer's city
    When the customer catalogue is read
    Then the category includes its parent_id, recurrence_allowed, and allowed_frequencies
    And only active categories available in that city are offered

  Scenario: Disabled catalogue does not expose newly seeded categories
    Given home_services_catalogue_v2 is disabled
    When the customer catalogue is read
    Then the existing catalogue remains available
    And newly seeded home-service categories are not exposed
```

### HSC-04 — An administrator manages categories through the guarded catalogue boundary

```gherkin
Feature: Admin category management
  Scenario: An authorized admin creates, edits, reorders, or disables a category
    Given the caller is an admin
    And admin_category_editor is enabled
    When the admin makes a valid category change
    Then the category data or sibling order is updated
    And reordered categories remain within one parent and receive the requested order
    And config_version increases for each category change
    And the change is recorded in the admin audit log

  Scenario: A non-admin cannot manage categories
    Given the caller is not an admin
    When the caller attempts a category-management operation
    Then the server refuses the operation
    And the catalogue remains unchanged

  Scenario: Category management is refused when its feature switch is off
    Given admin_category_editor is disabled
    When an admin attempts a category-management operation
    Then the server refuses the operation
    And the catalogue remains unchanged
```

### HSC-05 — Invalid hierarchy and category policy are rejected

```gherkin
Feature: Category policy validation
  Scenario: Category writes reject invalid parents, cycles, and excess depth
    Given a category has an invalid parent, would create a cycle, or would exceed two levels
    When an admin attempts to save the category
    Then the server rejects the change
    And the existing hierarchy and ordering remain unchanged

  Scenario: Category writes reject invalid field values
    Given a category payload has an invalid create-only slug, unknown cancellation policy, non-object intake schema, or discount outside 0–5000 basis points
    When an admin attempts to save the category
    Then the server rejects the change
    And the stored category remains unchanged

  Scenario: Category writes reject recurrence options outside the global rules
    Given recurring_rules defines the allowed frequency set
    When an admin submits an allowed_frequencies value outside that set
    Then the server rejects the change
    And the stored category policy remains unchanged
```

### HSC-06 — Restricted services cannot be activated without verification requirements

```gherkin
Feature: Restricted home-service activation
  Scenario: Sensitive service categories require verification documents before activation
    Given a category is marked restricted
    And its required verification documents are empty
    When an admin attempts to activate the category
    Then the server refuses activation
    And the category remains inactive
```

### HSC-07 — Existing and expanded package units remain valid

```gherkin
Feature: Service package measurement units
  Scenario: Package units support the existing values and the home-service additions
    Given a service package uses an existing supported unit or one of visit, kg, or piece
    When the package is saved
    Then the unit is accepted
    And unsupported units are rejected
```

## Automation readiness

| Scenario | Observable pass/fail signal | Test level and planned evidence |
|---|---|---|
| HSC-01 | Existing IDs/slugs remain unique and point to the intended parent | SQL integration: `supabase/tests/home_services_catalogue.test.mjs` |
| HSC-02 | Seeded groups/children have specified metadata, inactive state, and no new city rows | SQL integration: `supabase/tests/home_services_catalogue.test.mjs` |
| HSC-03 | Customer read contract returns required fields and honors the feature/active/city rules | SQL integration: `supabase/tests/home_services_catalogue.test.mjs`; exact existing read RPC to be identified during implementation |
| HSC-04 | Admin operations succeed; non-admin/flag-off calls fail; config version and audit record change | SQL integration: `supabase/tests/home_services_catalogue.test.mjs` |
| HSC-05 | Invalid hierarchy, create-only slug, cancellation policy, intake schema, discount, and out-of-rule frequencies fail without partial changes | SQL integration: `supabase/tests/home_services_catalogue.test.mjs` |
| HSC-06 | Restricted category activation without required documents fails | SQL integration: `supabase/tests/home_services_catalogue.test.mjs` |
| HSC-07 | Existing package units and `visit`, `kg`, `piece` are accepted; unsupported unit fails | SQL integration: `supabase/tests/home_services_catalogue.test.mjs` |

These are planned checks, not claims of tests already run. A2/A3 UI behavior and family mapping are downstream automation.

## Trace links

- DDD: [Home Services Catalogue — DDD](../../ddd/artifacts/home-services-catalogue-ddd.md)
- Implementation plan: [Home Services, Recurring & Sports Payments](../../../../../../12-Home-Services-Recurring-Sports-Payments-Implementation-Plan.md), §§0, 1, 2, 4.2, 4.4
- Migration: `supabase/migrations/0056_home_services_catalogue.sql`
- SQL test: `supabase/tests/home_services_catalogue.test.mjs`
- ADR: Not required for this change; the existing catalogue remains authoritative and no bounded-context ownership or consistency model is transferred.
