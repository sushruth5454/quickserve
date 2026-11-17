# QuickServe Phase 1 — Commission Configuration — Traceability

**Status:** Proposed trace map. Phase 1 implementation and tests are not present in this checkout.

| BDD scenario | Owning DDD context / model | Planned implementation trace | Planned SQL / app verification | Existing coverage (baseline only) |
|---|---|---|---|---|
| [CC-01](../../bdd/artifacts/commission-config-bdd.md) | Commission Policy Management / `CommissionPolicy`, tier values | Future `supabase/migrations/0043_commission_config.sql`: seed 30 days, 1200/1000/800 bp at 0/50/200 jobs, repeat 400 bp/floor 500 bp; configurable `_commission_bp(provider, at)` | Add seed, day-10, 0/50/200-job, repeat 1200→800 and floor 500 assertions to `supabase/tests/prd_v2.test.mjs` | [`money.test.ts`](<../../../../../../../app/src/lib/__tests__/money.test.ts>) verifies the current local schedule, not persisted config |
| [CC-02](../../bdd/artifacts/commission-config-bdd.md) | Commission Policy Management + Booking Commission Calculation / migration invariant | `0043_commission_config.sql` must preserve effective rates and must not silently activate an unapproved `categories.commission_bp` value | Add a no-rate-change/pre-post migration SQL assertion; live query on 2026-11-17 found zero non-null category override values | No existing category-rate test found; no live overrides existed at query time |
| [CC-03](../../bdd/artifacts/commission-config-bdd.md) | Commission Policy Management / global policy; Provider Commercial Read Model | `admin_set_commission(p_config)` and `get_commission_terms()`; update dashboard and earnings screens to consume returned terms | SQL assertions for admin update, audit, and returned provider terms; update app tests for configurable tiers/founding days | [`providerInsights.test.ts`](<../../../../../../../app/src/lib/__tests__/providerInsights.test.ts>) covers current local tier progress only; [`dashboard.tsx`](<../../../../../../../app/app/(provider)/dashboard.tsx>) and [`earnings.tsx`](<../../../../../../../app/app/(provider)/earnings.tsx>) currently use local rules |
| [CC-04](../../bdd/artifacts/commission-config-bdd.md) | Commission Policy Management / Category Override; Booking Commission Calculation / booking-aware rate | `admin_set_category_commission(category_id, bp)` and the four-argument `_commission_bp`; apply category override after founding check and before repeat adjustment; update `_coin_platform_cap` to use the same booking-aware rate | Add SQL cases for pre-founding, override, repeat composition, coin cap parity, and floor to `prd_v2.test.mjs` | [`leakage_programme.test.mjs`](<../../../../../../../supabase/tests/leakage_programme.test.mjs>) tests current repeat discount/floor, but not category overrides |
| [CC-05](../../bdd/artifacts/commission-config-bdd.md) | Provider Commercial Read Model / booking-specific rate; Provider App / preview | New provider-only `get_booking_commission_rate(p_booking_id)`; update [`quote/[bookingId].tsx`](<../../../../../../../app/app/quote/[bookingId].tsx>) to use it outside demo mode | SQL RPC authorization and category/repeat result assertions; add an app/API test proving production preview uses the RPC result | [`money.test.ts`](<../../../../../../../app/src/lib/__tests__/money.test.ts>) covers settlement arithmetic only; no focused quote rate-source test found |
| [CC-06](../../bdd/artifacts/commission-config-bdd.md) | Commission Policy Management / admin authorization and validation | `admin_set_commission` and `admin_set_category_commission`; preserve current config on rejected requests | SQL assertions for non-admin refusal and invalid founding/tier/category inputs | No current commission-admin operation or corresponding test |
| [CC-07](../../bdd/artifacts/commission-config-bdd.md) | Booking Commission Calculation & Settlement / BYO exception | Preserve the `booking_origin = 'byo'` zero-rate path in `_create_payout` | Keep the BYO payout SQL assertion green | `leakage_programme.test.mjs` already asserts zero BYO commission and commission GST |

## Source evidence

- Plan: [PRD v2 implementation plan](../../../../../../11-PRD-v2-Implementation-Plan.md), Phase 1.
- Current behavior: [`0016_leakage_programme.sql`](<../../../../../../../supabase/migrations/0016_leakage_programme.sql>) defines the 30-day/12%/10%/8% schedule and repeat rule; its current booking-aware resolver does not read category commission.
- Category field: [`0018_archetype_core.sql`](<../../../../../../../supabase/migrations/0018_archetype_core.sql>) adds nullable `categories.commission_bp` with a current schema check of 0–10000 bp.
- App sources: [`money.ts`](<../../../../../../../app/src/lib/money.ts>), [`providerInsights.ts`](<../../../../../../../app/src/lib/providerInsights.ts>), [`dashboard.tsx`](<../../../../../../../app/app/(provider)/dashboard.tsx>), [`earnings.tsx`](<../../../../../../../app/app/(provider)/earnings.tsx>), [`quote/[bookingId].tsx`](<../../../../../../../app/app/quote/[bookingId].tsx>).
- SQL harness: `supabase/tests/prd_v2.test.mjs` exists but currently has no commission-config assertions. Add Phase 1 assertions there and include `0043_commission_config.sql` in the migration parser/test chain.
- App baseline: [`money.test.ts`](<../../../../../../../app/src/lib/__tests__/money.test.ts>) and [`providerInsights.test.ts`](<../../../../../../../app/src/lib/__tests__/providerInsights.test.ts>) exist and assert current hardcoded behavior; they are not evidence that Phase 1 is implemented.

## ADR

No matching commission ADR was found. ADR-0001 is limited to the feature-flag registry. The DDD artifact carries an ADR candidate placeholder for category activation and effective-time semantics; no separate ADR file was created.

## Phase status

- **BDD/DDD/traceability:** proposed artifacts created.
- **Migration `0043_commission_config.sql`, commission RPCs, admin UI, and Phase 1 tests:** not implemented or validated here.
