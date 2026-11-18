# QuickServe Addendum Foundations — Traceability

**Status:** W0 BDD/DDD source prepared; TDD and implementation pending.

| BDD scenario | DDD context / invariant | TDD evidence | Planned implementation | ADR |
|---|---|---|---|---|
| W0-SC-01 | Feature configuration: every capability has a runtime registry row and safe default | `addendum_foundations.test.mjs` (planned) | `0054_addendum_foundations.sql`, `admin/features.tsx` | Existing registry pattern; no new ADR planned |
| W0-SC-02 | Feature configuration: child effective state requires parent state | `addendum_foundations.test.mjs`, `featureFlags.test.ts` (planned) | `0054_addendum_foundations.sql`, `featureFlags.ts`, `featureFlagModel.ts` | Existing feature registry pattern |
| W0-SC-03 | Admin policy configuration: allowlisted, validated and audited runtime rules | `addendum_foundations.test.mjs` (planned) | `0054_addendum_foundations.sql`, `adminRulesApi.ts` | No new ADR planned |
| W0-SC-04 | Money safety: feature-off does not disable processing existing financial obligations | `addendum_foundations.test.mjs` (planned) | Subsequent payment/refund/expiry RPCs consume the shared flag contract | Existing payment/refund architecture |
| W0-SC-05 | Availability: one serialized provider-window guard is reused by future create/reschedule paths | `addendum_foundations.test.mjs` (planned) | `0054_addendum_foundations.sql` | Existing advisory-lock overlap pattern |

## Validation evidence

- CI run IDs: pending.
- Migration registration in `supabase/tests/package.json`, `supabase/tests/review_fixes.test.mjs`, and `.github/workflows/deploy-backend.yml`: pending.
- Note: only record green CI evidence after the exact run completes successfully.
