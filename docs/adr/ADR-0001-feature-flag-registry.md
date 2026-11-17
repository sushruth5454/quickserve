# ADR-0001: Feature Flag Registry

**Status:** Accepted; Phase 0 implementation in progress  
**Date:** 2026-11-17

## Context

The implementation plan describes the current generic switches as `app_config.features` JSONB with a hardcoded whitelist of three keys. Under that approach, adding a switch requires changing the code-backed list. Phase 0 requires adding a new admin switch with one registry-row insert and no admin-screen code edit.

The existing switches are `ai_assistant`, `urgent_requests`, and `fixed_asap`. Their current values must be preserved. Archetype flags are separately stored in `app_config.archetype_flags` and use existing `archetype:` handling; they are not generic feature switches.

## Decision

Use rows in `feature_flags` as the source of truth for generic feature switches. A switch is identified by its key and carries its enabled state and admin-list metadata. The admin UI lists registry rows dynamically; administrator changes use `admin_set_feature`, and the list uses `admin_list_features`.

Server evaluation uses `_feature_enabled`; a key with no registry row evaluates to `false`. `get_app_features` returns generic switch values while keeping archetype flags separate. Preserve the current values of the three migrated generic switches. New later-phase switch rows start disabled, as stated in the implementation plan.

Keep `archetype_flags` in its existing representation and retain the existing archetype-specific branch in `admin_set_feature`.

## Consequences

### Positive

- A new generic switch can be registered by inserting a row, without a corresponding hardcoded admin-screen entry.
- Unknown generic keys fail closed.
- The registry provides the label, description, group, and ordering data used by the admin list.
- Existing generic switch values and archetype flag representation remain distinct.

### Negative and constraints

- The Phase 0 migration must preserve the three existing switch values and establish restricted direct table access.
- Admin listing and changes depend on administrator-only operations.
- Generic switches and archetype flags remain separate models, so consumers must preserve that distinction.
- The `isOn` app helper only gates app entry points; server-side `_feature_enabled` checks remain necessary.

## Alternatives considered

- **Keep the fixed JSONB whitelist:** rejected because each additional switch would continue to require a code-backed whitelist change rather than one registry row.
- **Move archetype flags into the generic registry:** rejected for Phase 0; the plan explicitly retains their separate `app_config.archetype_flags` representation and handling.

## Traceability

- BDD: [Feature Switch Registry — BDD](../content/engineering/fundamentals/delivery-methods/bdd/artifacts/feature-switch-registry-bdd.md)
- DDD: [Feature Switch Registry — DDD](../content/engineering/fundamentals/delivery-methods/ddd/artifacts/feature-switch-registry-ddd.md)
- Traceability: [Feature Switch Registry — Traceability](../content/engineering/fundamentals/delivery-methods/bdd-ddd-tdd/artifacts/feature-switch-registry-traceability.md)
