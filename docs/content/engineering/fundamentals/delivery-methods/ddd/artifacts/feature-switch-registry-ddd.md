# Feature Switch Registry — DDD

## Domain framing

**Problem:** Phase 0 replaces a fixed generic-switch whitelist with registry rows so a new admin switch can be added with one row and no admin-screen code change. This models switch management only; it does not define later feature policies.

### Ubiquitous language

| Term | Meaning in Phase 0 |
|---|---|
| Feature switch | A keyed, enabled/disabled control for a generic application capability. |
| Feature registry | The `feature_flags` rows that define generic switches and their admin-list metadata. |
| Switch key | The primary key used by `_feature_enabled`, `admin_set_feature`, and the app `isOn` helper. |
| Archetype flag | A separate flag stored in `app_config.archetype_flags`; it is not a generic registry row. |
| Fail closed | A key with no registry row evaluates as disabled. |

## Bounded context map

| Context | Ownership and responsibility | Exposed boundary |
|---|---|---|
| **Feature Switch Management** | Owns generic registry rows, their enabled state and admin-list metadata; administrator operations are restricted. | `admin_list_features` lists rows; `admin_set_feature` changes a generic row and records the planned audit log. |
| **Feature Gate** | Consumes switch state to control server behavior and app entry points. | Server checks use `_feature_enabled`; `get_app_features` returns generic switch values and archetype flags separately; the app uses the `isOn` helper. |

**Context relationship:** Feature Switch Management is the source of generic switch state. Feature Gate consumes that state through the named SQL functions and app-facing feature result. The admin UI uses the planned list/set operations rather than maintaining a separate hardcoded switch list.

## Tactical ownership

| Model element | Proposed responsibility and boundary |
|---|---|
| `feature_flags` row | Registry entity and per-key consistency boundary. The primary key is the switch key; `enabled`, label, description, group, ordering, and update metadata belong to that row. |
| Feature key | Identity value for a generic switch. The migration constrains its format; an absent key has no enabled entity and therefore evaluates false. |
| Registry operations | `_feature_enabled` evaluates one key; `get_app_features` composes the generic switch result with the separate archetype result; `admin_list_features` and `admin_set_feature` are administrator operations. |
| `archetype_flags` | Remains owned by its existing `app_config` representation. It is returned separately and retains the existing `archetype:` handling; it is not migrated into `feature_flags`. |

## Integration boundaries

- The planned migration creates `feature_flags`, enables row-level security, and revokes direct `anon` and `authenticated` table access.
- The admin UI lists database rows and renders a switch per row; adding a registry row does not require adding a corresponding hardcoded admin-screen entry.
- Server-side checks remain authoritative. The app `isOn` helper controls app entry points but does not replace `_feature_enabled`.
- The existing three generic switches retain their current values during migration. Later-phase rows start disabled as directed by the plan.

## Open risks

- SQL tests for migration preservation, fail-closed lookup, dynamic toggles, direct-table denial, and admin authorization are implemented in `supabase/tests/prd_v2.test.mjs`.
- This artifact does not decide new authorization policy or feature-specific behavior beyond the Phase 0 plan.

## Trace links

- BDD: [Feature Switch Registry — BDD](../../bdd/artifacts/feature-switch-registry-bdd.md)
- Traceability: [Feature Switch Registry — Traceability](../../bdd-ddd-tdd/artifacts/feature-switch-registry-traceability.md)
- Decision: [ADR-0001 — Feature Flag Registry](../../../../../../adr/ADR-0001-feature-flag-registry.md)

## Phase status

- **DDD:** generic feature registry and consuming feature gate ownership are defined.
- **Implementation:** migration 0042 and app/admin integrations are implemented; full CI/E2E validation remains.
