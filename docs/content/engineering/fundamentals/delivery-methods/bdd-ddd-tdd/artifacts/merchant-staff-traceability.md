# QuickServe Phase 10 — Merchant Staff — Traceability

**Status:** Implementation in progress; shared CI registration and validation pending.

| BDD scenario | DDD owner / invariant | Test evidence | Implementation |
|---|---|---|---|
| SC-01 | Business Membership; owner access remains direct while delegated access is flag-gated | `merchant_staff.test.mjs` | `0052_merchant_staff.sql` |
| SC-02 | Business Membership; only owners add/remove existing users | `merchant_staff.test.mjs` | `0052_merchant_staff.sql`, `app/app/merchant-staff.tsx` |
| SC-03 | Business Work; a selected business is scoped to its owner/provider ID for every read/chat | `merchant_staff.test.mjs` | `0052_merchant_staff.sql`, `app/app/merchant-work.tsx`, `app/app/(provider)/dashboard.tsx` |
| SC-04 | Business Work; staff read/chat, managers quote/propose, owner controls remain owner-only | `merchant_staff.test.mjs` | `0052_merchant_staff.sql`, `app/src/features/merchantStaff/**` |

## Shared integration

- Register migration `0052_merchant_staff.sql` and `merchant_staff.test.mjs` in backend CI/full-chain tests.
- Run backend Deno/SQL tests and app EAS typecheck/Jest after Phase 10 changes are committed.
- Update this artifact with exact CI run IDs after validation.

## Decisions and residual risks

- Staff are added by an existing QuickServe user ID; no phone/email lookup, invite token, or outbound message is implemented.
- Verify staff receive only fields needed for their assigned work; owner payout, price, verification, and staff-management controls remain restricted.

## References

- [Merchant Staff — BDD](../../bdd/artifacts/merchant-staff-bdd.md)
- [Merchant Staff — DDD](../../ddd/artifacts/merchant-staff-ddd.md)
- [Phase plan](../../../../../../11-PRD-v2-Implementation-Plan.md)
