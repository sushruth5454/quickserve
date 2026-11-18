# QuickServe Phase 9 — Unified My Activity — Traceability

**Status:** Implementation in progress; shared CI registration and validation pending.

| BDD scenario | DDD owner / invariant | Test evidence | Implementation |
|---|---|---|---|
| ACT-01, ACT-02 | Feature Configuration owns segment/resource visibility | `activityModel.test.ts`, `activity_contracts.test.mjs` | `UnifiedActivityScreen.tsx`, `ActivityUnreadProvider.tsx`, migration `0053_activity_contracts.sql` |
| ACT-03 | Source contexts retain independent statuses | `activityModel.test.ts` | `UnifiedActivityScreen.tsx` |
| ACT-04 | Activity uses resource-specific in-app routes | `e2e/web-smoke.mjs` segment navigation | `UnifiedActivityScreen.tsx` |
| ACT-05 | Each context owns unread state; visible segments are summed once | `activityModel.test.ts`, `activity_contracts.test.mjs` | `ActivityUnreadProvider.tsx`, `api.ts`, `0053_activity_contracts.sql` |
| ACT-06 | Customer participant scope is enforced at API/RLS boundaries | `activity_contracts.test.mjs` | `0053_activity_contracts.sql`, existing context APIs |
| ACT-07 | Each segment has independent loading/error/empty states | E2E segment navigation; component coverage pending | `UnifiedActivityScreen.tsx` |

## Shared integration

- Register migration `0053_activity_contracts.sql` and `activity_contracts.test.mjs` in backend CI/full-chain tests.
- Run EAS typecheck/Jest and E2E after the Phase 9 changes are committed.
- Update this artifact with exact CI run IDs after validation.

## References

- [Unified My Activity — BDD](../../bdd/artifacts/unified-my-activity-bdd.md)
- [Unified My Activity — DDD](../../ddd/artifacts/unified-my-activity-ddd.md)
- [Phase plan](../../../../../../11-PRD-v2-Implementation-Plan.md)
