# Managed Geography — Traceability

This artifact maps Phase 5 behavior to its domain owner, implementation, and isolated SQL evidence. **CI validation is pending.**

| BDD scenario | Owning DDD context / model | Implementation | Test evidence / status |
|---|---|---|---|
| [MG-01](../../bdd/artifacts/managed-geography-bdd.md) — hierarchy validation | Geography Management / `GeoState`, `GeoDistrict`, `GeoCity`, `GeoArea` | `supabase/migrations/0046_managed_geography.sql`; `app/src/lib/geographyApi.ts`; `app/app/admin/geography.tsx` | `supabase/tests/managed_geography.test.mjs`: valid hierarchy and orphan-parent FK rejection; duplicate-name/name-length assertions pending |
| [MG-02](../../bdd/artifacts/managed-geography-bdd.md) — Places coordinates | Geography Management / area coordinate pair; Places provider | `app/app/admin/geography.tsx` (`searchPlaces`, `resolvePlace`); `supabase/migrations/0046_managed_geography.sql` | SQL test checks out-of-range area coordinates; missing-coordinate assertion and Places-origin UI flow await CI/integration validation |
| [MG-03](../../bdd/artifacts/managed-geography-bdd.md) — active ancestry | Location Selection / `listAreas()` and `ManagedArea` | `app/src/lib/geographyApi.ts`; `app/src/lib/locationModel.ts`; `app/app/location.tsx`; `app/src/features/providerOnboarding/AreaSection.tsx` | `managed_geography.test.mjs` verifies active-only table reads; client-side ancestor filtering awaits CI/integration validation |
| [MG-04](../../bdd/artifacts/managed-geography-bdd.md) — authorization and audit | Geography Management / admin command | `supabase/migrations/0046_managed_geography.sql`; `app/src/lib/geographyApi.ts`; `app/app/admin/geography.tsx` | `managed_geography.test.mjs` verifies non-admin RPC denial and direct-write denial; migration writes `admin_audit_log` but an audit assertion is pending |
| [MG-05](../../bdd/artifacts/managed-geography-bdd.md) — feature-gated picker | Feature Switch Management → Location Selection | `supabase/migrations/0046_managed_geography.sql`; `app/src/lib/geographyApi.ts`; `app/app/location.tsx`; `app/src/features/providerOnboarding/AreaSection.tsx` | SQL test verifies `area_picker` defaults true; picker off/empty behavior and preserved search/GPS await CI/integration validation |
| [MG-06](../../bdd/artifacts/managed-geography-bdd.md) — no fabricated coordinates | Geography Management / seed policy | `supabase/migrations/0046_managed_geography.sql` | Migration seeds names only and leaves seeded city coordinates null; no dedicated seed assertion in `managed_geography.test.mjs` |

## Integration notes

- The parent integrated both picker reads through `isAreaPickerEnabled()` and `listAreas()`, removed `POPULAR_AREAS`, and set the migration's `area_picker` default to `true`, matching Phase 5.
- `locationModel.ts` converts a managed area with `fromManagedArea`; the location picker and provider onboarding keep their existing search/GPS paths independent of the quick-pick switch.
- `category_cities` and `resolve_service_city` remain outside this change.
- No local tests were run. **CI validation remains pending.**

## Links

- BDD: [Managed Geography — BDD](../../bdd/artifacts/managed-geography-bdd.md)
- DDD: [Managed Geography — DDD](../../ddd/artifacts/managed-geography-ddd.md)
- Plan: [PRD v2 implementation plan](../../../../../../11-PRD-v2-Implementation-Plan.md)
