# Managed Geography — DDD

**Status:** Domain boundaries defined; implementation integrated; CI validation pending.

## Domain framing

QuickServe needs one managed geography hierarchy for location quick picks. Administrators maintain it; customer and provider location flows consume only areas whose complete ancestry is active.

### Ubiquitous language

| Term | Meaning |
|---|---|
| Geography hierarchy | State → district → city → area parent-child structure. |
| Managed area | A city-scoped service-area name and coordinate pair used as a quick pick. |
| Active ancestry | The area and its city, district, and state are all active. |
| Places-resolved coordinates | Coordinates returned by resolving a Places result in the admin area-entry flow. |
| `area_picker` | Feature-registry switch that gates managed quick picks; Phase 5 seeds it enabled. |

## Bounded-context map

| Context | Ownership | Boundary / relationship |
|---|---|---|
| **Geography Management** | Owns the four geography tables, parent/name/coordinate invariants, admin upsert, and audit record. | `admin_upsert_geo` is the authorized write boundary; authenticated admins can read inactive rows, but clients have no direct write access. |
| **Location Selection** | Customer and provider app flows consume selectable areas and convert them to `SelectedLocation`. | `listAreas()` returns active areas with city names, filtering inactive ancestry; `fromManagedArea()` maps the result into the location model. |
| **Feature Switch Management** | Phase 0 owns registry state for `area_picker`. | `isAreaPickerEnabled()` reads `get_app_features`; `location.tsx` and `AreaSection` hide quick picks when off or empty. Governed by [ADR-0001](../../../../../../adr/ADR-0001-feature-flag-registry.md). |
| **Places provider (external)** | Supplies search candidates and resolved place details. | Admin geography screen uses `searchPlaces` and `resolvePlace` before submitting area coordinates. |

Geography remains separate from service-city launch gating: `category_cities` and `resolve_service_city` are unchanged.

## Tactical design

| Model element | Consistency boundary and invariant |
|---|---|
| `GeoState`, `GeoDistrict`, `GeoCity`, `GeoArea` | Separate persisted nodes with UUID identity and an immediate-parent foreign key for each non-root node. Sibling names are unique after trimming and case folding. |
| Node name | Trimmed text, 2–80 characters; parent existence is checked by the admin upsert. |
| Area coordinate pair | Required latitude and longitude, each range-checked. The admin UI fills them from a resolved Places result. |
| City coordinate pair | Optional, but both values must be null together or both within valid bounds. The seeded Sangareddy city has null coordinates. |
| Active state | Stored per node. A selectable area requires its own active flag and active flags on all ancestors. Parent deactivation does not rewrite child rows. |
| `admin_upsert_geo` | Transactional command boundary: checks `_is_admin`, validates kind/parent/name/coordinates, mutates one node, and writes the audit record. |
| `listAreas` | Read-side query in `geographyApi.ts`; returns active areas with their city names after filtering the full active ancestry. |
| `area_picker` | Feature-registry entry, enabled by default per the Phase 5 plan; the client hides quick picks when disabled or no rows qualify. |

## Integration and risks

- Public reads are RLS-limited to active rows. A separate authenticated-admin read policy allows the admin tree to include inactive entries; direct client writes remain revoked.
- The admin screen calls `geographyApi` directly for geography reads and the upsert RPC for changes. It does not use shared `adminApi`.
- Places resolution is the source used by the UI, while SQL enforces coordinate presence/ranges. The database does not independently prove that coordinates originated from Places.
- No coordinates are fabricated in migration seeds. Range-valid but unverified manual values remain a governance risk if other privileged write paths are introduced.
- Current migration/test integration is complete; **CI validation is pending**.

## Trace links

- BDD: [Managed Geography — BDD](../../bdd/artifacts/managed-geography-bdd.md)
- Traceability: [Managed Geography — Traceability](../../bdd-ddd-tdd/artifacts/managed-geography-traceability.md)
- Decision: [ADR-0001 — Feature Flag Registry](../../../../../../adr/ADR-0001-feature-flag-registry.md)
- Plan: [PRD v2 implementation plan](../../../../../../11-PRD-v2-Implementation-Plan.md)
