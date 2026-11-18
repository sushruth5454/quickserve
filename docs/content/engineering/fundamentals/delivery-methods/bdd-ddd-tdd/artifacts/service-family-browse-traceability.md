# QuickServe Service-Family Browse — Traceability

**Status:** Implementation in progress; CI validation pending.

| BDD scenario | DDD owner / invariant | TDD test | Implementation |
|---|---|---|---|
| SF-01 | Customer Discovery; families only project existing verticals and appear before services | Model test and home drill-down E2E | `app/src/features/catalogue/model.ts`, `app/app/(customer)/index.tsx` |
| SF-02 | Customer Discovery; search is intersected with selected family | Home-screen E2E family/category path | `app/app/(customer)/index.tsx`, `app/src/features/catalogue/CatalogueSections.tsx` |
| SF-03 | Sports and Product Catalogue retain feature-gated ownership | Home-screen E2E visibility/routing assertions | `app/app/(customer)/index.tsx` |
| SF-04 | Service Catalogue owns category routing and archetype behavior | Home-screen E2E category route assertion | `app/src/features/catalogue/CatalogueSections.tsx` |
| SF-05 | Customer Discovery does not promise a universal payment model | UI copy review | `app/app/(customer)/index.tsx` |

## References

- [Service-Family Browsing — BDD](../../bdd/artifacts/service-family-browse-bdd.md)
- [Service-Family Discovery — DDD](../../ddd/artifacts/service-family-browse-ddd.md)
- [PRD v2 implementation plan](../../../../../../11-PRD-v2-Implementation-Plan.md)

**CI validation pending.** Update this artifact with exact CI run links after the UI changes are validated.
