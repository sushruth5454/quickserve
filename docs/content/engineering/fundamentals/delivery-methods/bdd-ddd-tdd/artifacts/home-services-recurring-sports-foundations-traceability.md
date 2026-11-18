# QuickServe Addendum Foundations — Traceability

**Status:** W0 BDD/DDD source and focused SQL/Jest tests authored; CI validation pending.

| BDD scenario | DDD context / invariant | TDD evidence | Planned implementation | ADR |
|---|---|---|---|---|
| W0-SC-01 | Feature configuration: every capability has a runtime registry row and safe default | `supabase/tests/addendum_foundations.test.mjs` | `supabase/migrations/0054_addendum_foundations.sql`, `app/app/admin/features.tsx` | Existing registry pattern; no new ADR planned |
| W0-SC-02 | Feature configuration: child effective state requires parent state | `supabase/tests/addendum_foundations.test.mjs`, `app/src/lib/__tests__/featureFlags.test.ts` | `0054_addendum_foundations.sql`, `app/src/lib/featureFlags.ts`, `featureFlagModel.ts` | Existing feature registry pattern |
| W0-SC-03 | Admin policy configuration: allowlisted, validated and audited runtime rules | `supabase/tests/addendum_foundations.test.mjs` | `0054_addendum_foundations.sql`, planned `adminRulesApi.ts` | No new ADR planned |
| W0-SC-04 | Money safety: feature-off does not disable processing existing financial obligations | Existing payment/refund tests; W0 adds no gate to these functions | Later payment/refund/expiry RPCs consume the shared flag contract | Existing payment/refund architecture |
| W0-SC-05 | Availability: one serialized provider-window guard is reused by future create/reschedule paths | `supabase/tests/addendum_foundations.test.mjs` | `0054_addendum_foundations.sql` | Existing advisory-lock overlap pattern |

## Validation evidence

- CI run IDs: pending.
- Migration registration in `supabase/tests/package.json`, `supabase/tests/review_fixes.test.mjs`, and `.github/workflows/deploy-backend.yml`: authored, pending green CI.
- Note: only record green CI evidence after the exact run completes successfully.
