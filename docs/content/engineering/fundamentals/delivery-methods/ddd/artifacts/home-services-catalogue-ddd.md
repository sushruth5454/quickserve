# QuickServe Home Services Catalogue — DDD

**Status:** A1 domain boundaries and invariants specified; migration and CI validation pending.

## Domain framing

The Service Catalogue owns home-service category identity and booking-policy metadata. A1 extends that existing model with a shallow parent/child hierarchy and per-category recurrence policy. Customer Discovery consumes the catalogue as a read model; it does not own category records or booking policy. Admin category operations are privileged application services within the Service Catalogue boundary, not a second catalogue.

## Ubiquitous language

| Term | Meaning |
|---|---|
| Category | An identity-bearing service-catalogue record. Existing IDs and slugs remain stable when a category is placed under a group. |
| Group category | A top-level catalogue row with no parent and no booking archetype, used to organize child categories. |
| Child category | A service row whose `parent_id` identifies its group; the hierarchy is limited to two levels. |
| Active category | A category enabled by an administrator. Customer availability also requires the category to be available in the customer's city. |
| Restricted category | A category requiring verification documents; it cannot be activated without required documents. |
| Recurrence policy | Category-level permission and frequency choices, constrained by global `recurring_rules`; an optional category discount overrides the global default. |
| Catalogue feature switch | `home_services_catalogue_v2`, which controls exposure of the expanded customer catalogue. |
| Category-editor switch | `admin_category_editor`, which controls category-management operations. |
| Package unit | A constrained measurement for a service package; existing units remain supported alongside `visit`, `kg`, and `piece`. |

## Bounded contexts and ownership

| Context | Owns | Invariants and boundary |
|---|---|---|
| **Service Catalogue** | `categories`, `service_packages.unit`, parent links, category recurrence metadata, admin category RPCs | Source of truth for category identity, hierarchy, booking archetype, allowed frequencies, discount override, and verification requirements. Writes validate hierarchy and policy before persistence. |
| **Customer Discovery** | Customer-facing category read/projection and grouped browsing | Read-only consumer of catalogue data. It receives parent and recurrence metadata, and shows categories only under the existing active + city-available rules. It does not create or alter catalogue policy. |
| **Recurring Rules Configuration** | Global `app_config.recurring_rules` and its admin validation (W0) | Owns the global frequency allowlist and default discount. Service Catalogue may restrict a category to a subset, but does not redefine the global rules. |

There is no ownership transfer between contexts. The exact name and full output contract of the existing customer catalogue read RPC must be confirmed from its latest definition during implementation; this design does not invent a replacement RPC.

## Tactical design

### Category model and consistency boundaries

- **Category entity:** one existing category row, retaining its identity across re-parenting. Group rows are categories too; no separate group table is introduced.
- **Hierarchy invariant:** a child points to a group or has no parent; groups have no parent and no archetype. Cycles and depth greater than two are invalid.
- **Category-policy value object:** `recurrence_allowed`, `allowed_frequencies`, and nullable `recurring_discount_bp`. Frequencies must be a subset of `recurring_rules.frequencies`; a null discount delegates to the global default; a supplied discount is limited to 0–5000 basis points.
- **Restricted-verification value:** `restricted` and `requires_docs` jointly govern activation. A restricted category with no required documents remains inactive.
- **Category ordering:** `admin_reorder_categories` is the transaction boundary for assigning order among one parent's categories. A submitted reorder must not move categories across parents.
- **Package unit value:** preserves the existing allowed list and adds `visit`, `kg`, and `piece`.
- **Intake schema value:** a JSON object containing safe service-intake fields only; it must not collect phone numbers or addresses.

### Application services and persistence

- Migration `0056_home_services_catalogue.sql` adds the category recurrence columns, extends the package-unit constraint, seeds groups and children, and updates existing service rows by slug without duplicating them.
- `admin_upsert_category(p jsonb) returns uuid` creates or edits categories. It is admin-only, audited, validates the create-only slug rule and policy/hierarchy constraints, and increments `config_version` on each change.
- `admin_reorder_categories(p_ids uuid[])` changes sibling order and is admin-only and audited.
- Existing `admin_set_category_active` remains the activation boundary and additionally refuses activation of a restricted category with no required documents.
- The existing admin category-list RPC is extended with the new fields while preserving prior outputs.
- The existing customer catalogue read contract is extended with `parent_id`, `recurrence_allowed`, and `allowed_frequencies`. When `home_services_catalogue_v2` is off, newly seeded categories are not exposed; existing catalogue behavior remains available.
- Category activation and city availability remain distinct configuration steps. Seeding does not make a category customer-visible.

### Feature-gate boundary

- `admin_category_editor` gates create/edit/reorder category RPCs; the server enforces the gate and admin authorization.
- `home_services_catalogue_v2` gates exposure of the expanded customer catalogue; the server-side read contract preserves the legacy catalogue when the flag is off.
- Category editing never grants customer visibility by itself. A category must also be active and available in the customer's city.

## Scenario-to-domain mapping

| BDD scenario | Owning context | Model/invariant | Planned implementation/test |
|---|---|---|---|
| [HSC-01](../../bdd/artifacts/home-services-catalogue-bdd.md#hsc-01--existing-services-retain-their-identity-when-grouped) | Service Catalogue | Stable Category identity; parent relationship | `0056_home_services_catalogue.sql`; `home_services_catalogue.test.mjs` |
| [HSC-02](../../bdd/artifacts/home-services-catalogue-bdd.md#hsc-02--new-services-are-seeded-as-unavailable-until-configured) | Service Catalogue | Group/child hierarchy; inactive seed state | `0056_home_services_catalogue.sql`; `home_services_catalogue.test.mjs` |
| [HSC-03](../../bdd/artifacts/home-services-catalogue-bdd.md#hsc-03--customer-visibility-respects-the-catalogue-switch-and-availability) | Service Catalogue | Read contract, feature gate, active + city availability; Customer Discovery consumes the result | Existing catalogue read RPC; `home_services_catalogue.test.mjs` |
| [HSC-04](../../bdd/artifacts/home-services-catalogue-bdd.md#hsc-04--an-administrator-manages-categories-through-the-guarded-catalogue-boundary) | Service Catalogue | Admin application services; audit/versioning | Admin RPCs in `0056_home_services_catalogue.sql`; `home_services_catalogue.test.mjs` |
| [HSC-05](../../bdd/artifacts/home-services-catalogue-bdd.md#hsc-05--invalid-hierarchy-and-category-policy-are-rejected) | Service Catalogue | Hierarchy and category-policy invariants; Recurring Rules Configuration supplies the frequency allowlist | `admin_upsert_category`; `home_services_catalogue.test.mjs` |
| [HSC-06](../../bdd/artifacts/home-services-catalogue-bdd.md#hsc-06--restricted-services-cannot-be-activated-without-verification-requirements) | Service Catalogue | Restricted-verification activation invariant | `admin_set_category_active`; `home_services_catalogue.test.mjs` |
| [HSC-07](../../bdd/artifacts/home-services-catalogue-bdd.md#hsc-07--existing-and-expanded-package-units-remain-valid) | Service Catalogue | Package unit value | `service_packages` constraint in `0056_home_services_catalogue.sql`; `home_services_catalogue.test.mjs` |

## Strategic links and risks

- **Decision:** retain the current `categories` and `service_packages` sources of truth; represent groups with top-level category rows and children with `parent_id`. This preserves existing identities and keeps the catalogue as the policy owner.
- **ADR:** no new ADR is required because the change extends the existing model without transferring ownership or changing the consistency model.
- **Implementation check:** locate and read the latest customer category read RPC definition before changing its projection. Do not infer the RPC name from a client call site.
- **Seed-label assumption:** `house-cleaning` keeps its slug and category identity; “Home cleaning” is its customer-facing label. The seed conflict behavior only reparents existing slugs, so implementation must not rename that slug or create a `home-cleaning` duplicate.
- **Activation risk:** the seeded categories intentionally remain unavailable until the admin separately activates them and configures city availability; do not treat seed presence as customer availability.

## Trace links

- BDD: [Home Services Catalogue — BDD](../../bdd/artifacts/home-services-catalogue-bdd.md)
- Implementation plan: [Home Services, Recurring & Sports Payments](../../../../../../12-Home-Services-Recurring-Sports-Payments-Implementation-Plan.md), §§0, 1, 2, 4.2, 4.4
- Migration: `supabase/migrations/0056_home_services_catalogue.sql`
- SQL test: `supabase/tests/home_services_catalogue.test.mjs`
