# Feature Switch Registry — Traceability

This artifact maps the Phase 0 scenarios to the implementation and tests. Full CI/E2E validation is still required before marking the phase complete.

| BDD scenario | Owning DDD context / model | Planned test reference | Planned implementation file references | ADR |
|---|---|---|---|---|
| FSR-01 ([BDD](../../bdd/artifacts/feature-switch-registry-bdd.md)) | Feature Switch Management / `feature_flags` row; Feature Gate keeps archetype flags separate | `prd_v2.test.mjs`: migrated values preserved | `0042_feature_registry.sql`; `app/src/lib/adminApi.ts`; `app/src/lib/featureFlags.ts` | [ADR-0001](../../../../../../adr/ADR-0001-feature-flag-registry.md) |
| FSR-02 ([BDD](../../bdd/artifacts/feature-switch-registry-bdd.md)) | Feature Switch Management / registry row; Feature Gate / `isOn` | `prd_v2.test.mjs`: dynamic row list/toggle; Jest `featureFlags.test.ts`: unknown lookup off; E2E `admin-feature-registry` renders/toggles an extra mocked row | `0042_feature_registry.sql`; `app/src/lib/adminApi.ts`; `app/app/admin/features.tsx`; `app/src/lib/featureFlags.ts`; existing feature consumers; `e2e/web-smoke.mjs` | [ADR-0001](../../../../../../adr/ADR-0001-feature-flag-registry.md) |
| FSR-03 ([BDD](../../bdd/artifacts/feature-switch-registry-bdd.md)) | Feature Gate / server-side switch evaluation | `prd_v2.test.mjs`: unknown server key false and unknown admin set rejected | `0042_feature_registry.sql` | [ADR-0001](../../../../../../adr/ADR-0001-feature-flag-registry.md) |
| FSR-04 ([BDD](../../bdd/artifacts/feature-switch-registry-bdd.md)) | Feature Switch Management / administrator operations and restricted table access | `prd_v2.test.mjs`: direct table, list, and update denied for normal user | `0042_feature_registry.sql`; `app/src/lib/adminApi.ts`; `app/app/admin/features.tsx` | [ADR-0001](../../../../../../adr/ADR-0001-feature-flag-registry.md) |
| FSR-05 ([BDD](../../bdd/artifacts/feature-switch-registry-bdd.md)) | Feature Switch Management and Feature Gate / contract verification | `prd_v2.test.mjs` runs from `npm test` pretest; full web workflow includes `admin-feature-registry` | `supabase/tests/prd_v2.test.mjs`; `app/src/lib/__tests__/featureFlags.test.ts`; `e2e/web-smoke.mjs` | [ADR-0001](../../../../../../adr/ADR-0001-feature-flag-registry.md) |

## Phase status

- **BDD:** scenarios defined and trace-linked.
- **DDD:** ownership and boundaries defined.
- **TDD/implementation:** red observed before migration 0042; green behavior is implemented. Full CI/E2E validation remains.
