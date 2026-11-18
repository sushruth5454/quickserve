# QuickServe Service-Family Discovery — DDD

**Status:** Domain boundaries recorded; implementation in progress.

## Ubiquitous language

| Term | Meaning |
|---|---|
| Category vertical | Existing database grouping for related service categories, identified by `categories.vertical`. |
| Service family | Customer-facing browse grouping projected from one or more category verticals. It is not a new domain entity. |
| Marketplace entry point | A feature-gated route into an independently owned context, such as Sports or Product Catalogue. |

## Bounded contexts and ownership

| Context | Owns | Invariant |
|---|---|---|
| **Customer Discovery** | Home-screen family selector, search selection, and category projection | Families only group existing verticals; category IDs, archetypes, prices, and booking rules remain unchanged. |
| **Service Catalogue** | `categories.vertical`, category data, and existing category routes | The catalogue remains the source of truth for category membership and each category keeps its existing booking flow. |
| **Sports** | Sports venue discovery and booking requests | The home screen links to the existing sports route; it does not convert a venue request into a service booking. |
| **Product Catalogue** | Shop and product discovery | The home screen links to the existing shop route; it does not imply checkout or payment. |

## Decisions and invariants

- Service families are a presentation projection over existing vertical slugs, not a database taxonomy migration.
- Known verticals map to stable family labels; unknown verticals remain visible under “More services” rather than disappearing.
- The default home view shows service-family choices, not individual service categories. Selecting a family shows its service categories; the back action returns to family choices and clears the prior query.
- Search on the default home view returns matching service categories across families; search inside a family is limited to that family. Search never changes the server catalogue.
- Sports and Shop Local are shown only when their existing app feature flags are enabled and continue to use their separate routes.
- Family selection itself is read-only and cannot create bookings, quotes, or payments.
- General home-screen trust copy must not imply identical payment semantics across service, sports, and product workflows.

## Strategic links and risks

- No existing ADR identified; this is a UI projection that preserves bounded-context ownership and existing backend contracts.
- Risk: a newly introduced category vertical needs a family mapping or must appear under the generic “More services” family.

## Trace links

- BDD: [Service-Family Browsing — BDD](../../bdd/artifacts/service-family-browse-bdd.md)
- Traceability: [Service-Family Browse — Traceability](../../bdd-ddd-tdd/artifacts/service-family-browse-traceability.md)
