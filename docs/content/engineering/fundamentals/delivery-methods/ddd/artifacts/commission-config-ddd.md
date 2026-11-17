# QuickServe Phase 1 — Commission Configuration — DDD

**Status:** Proposed domain design for PRD v2 Phase 1; not implemented.

## Domain framing

**Problem:** make provider commission policy administratively configurable without changing today's effective economics on rollout, while keeping booking quote previews and payout calculations server-authoritative.

### Ubiquitous language

| Term | Meaning |
|---|---|
| Commission policy | Global founding period, completed-job tiers, repeat discount, and repeat floor stored under `app_config` key `commission`. |
| Commission tier | Minimum completed-job count and commission basis points; the lowest tier has `min_jobs = 0`. |
| Category override | Optional category basis-point rate that replaces the provider tier after the founding period. The current schema field is `categories.commission_bp`; the current resolver does not apply it. |
| Repeat customer | Same provider/customer pair with a prior completed or closed booking within 12 months, excluding the current booking. |
| Booking-aware rate | Rate resolved for the provider, customer, booking category, and evaluation time; it includes the category override and repeat rule. |
| Admin action | An authorized commission or category update. A migration or app release alone must not change effective rates. |

Default policy from the plan: 30 founding days; 1200 bp at 0 jobs, 1000 bp at 50, and 800 bp at 200; repeat discount 400 bp, floored at 500 bp.

## Bounded context map

| Context | Ownership | Boundary / interaction |
|---|---|---|
| **Commission Policy Management** | Owns global policy configuration, validation, administrator authorization, and audit of changes. | Planned `admin_set_commission(p_config)` and `admin_set_category_commission(category_id, bp)` operations. Global policy is stored in `app_config`; the category override remains on the category record. |
| **Booking Commission Calculation & Settlement** | Owns effective-rate resolution and payout application. | Replaces the two `_commission_bp` overloads in the planned `0043_commission_config.sql`; the booking-aware overload applies global tier, category override, then repeat discount/floor. `_create_payout` remains the settlement consumer; BYO remains zero-commission. |
| **Provider Commercial Read Model** | Exposes current terms and booking-specific rate to provider surfaces. | Planned `get_commission_terms()` supplies the general provider rate/free-until information; provider-only `get_booking_commission_rate(booking_id)` supplies the quote's booking-aware rate. |
| **Provider App** | Presents rates and uses them in preview arithmetic; it does not own commission policy. | Dashboard/earnings consume server terms. Quote preview consumes the booking-specific server rate. `money.ts` retains local rate calculation only for explicit demo mode; its monetary arithmetic can still calculate the preview breakdown. |

**Context relationship:** Policy Management is the authorized write side; Booking Commission Calculation is the rate authority; read-model RPCs expose results to the app. The app must not recreate global/category/repeat policy from local constants.

## Tactical design

| Model / operation | Proposed responsibility and invariant |
|---|---|
| `CommissionPolicy` (`app_config.key = 'commission'`) | One policy consistency boundary for founding days, sorted tiers, repeat discount, and floor. Seed defaults idempotently; validate founding days 0–365, tier bp 0–3000, `min_jobs >= 0`, and a zero-job tier, as specified in the plan. |
| Tier and basis-point values | Treat tier entries as policy values, not independently mutable records. Select the greatest eligible `min_jobs`; category and repeat adjustments happen in the order specified by the plan. |
| Category override | Keep `categories.commission_bp` as category-owned configuration exposed through the admin boundary. The planned setter allows null or 0–3000 bp; note the existing schema constraint allows up to 10000 bp, so the RPC must enforce the planned narrower limit. Do not activate a legacy value without an explicit admin action or verified provenance. |
| Repeat eligibility and adjustment | Use the current same-provider/customer completed-or-closed booking rule within the prior 12 months, excluding the current booking; subtract configured discount only for a positive rate and apply the configured floor. |
| `get_commission_terms()` | Authenticated read service for provider screens; `my_*` fields are null when the caller is not a provider. |
| `get_booking_commission_rate(booking_id)` | Provider-only read service for the quote screen; resolve from the booking on the server, including category and repeat data. No production fallback to local rate constants. |
| `_coin_platform_cap` | Must use the same booking-aware 4-argument commission resolver as payout calculation so the coin redemption revenue cap reflects the effective category/repeat rate. |
| Admin mutations | Admin-only, validated, stored, and audited. Invalid or unauthorized changes leave the effective policy unchanged. |

## ADR linkage and open risks

- No commission-specific ADR exists in the current `docs/adr` set. [ADR-0001 — Feature Flag Registry](../../../../../../adr/ADR-0001-feature-flag-registry.md) covers generic feature switches only and does not govern commission.
- **ADR candidate placeholder (not an accepted decision or separate ADR file): Commission Policy Activation and Effective-Time Semantics.** A decision is needed because the current quote preview calculates locally, while `_create_payout` resolves commission at payout creation time. Define whether a later admin change can affect an already-previewed booking, and ensure the new category lookup does not activate previously inert values without an admin action.
- A live read on November 17, 2026 found zero non-null category commission overrides. Keep the migration idempotent and preserve this state; test that no category override becomes active unless an administrator explicitly sets one.
- The plan specifies ranges for founding days, tier rates, and category rates, but not validation bounds/consistency rules for repeat discount and floor; define those before implementing `admin_set_commission`.

## Trace links

- BDD: [Commission Configuration — BDD](../../bdd/artifacts/commission-config-bdd.md)
- Traceability: [Commission Configuration — Traceability](../../bdd-ddd-tdd/artifacts/commission-config-traceability.md)
- Plan: [PRD v2 implementation plan](../../../../../../11-PRD-v2-Implementation-Plan.md)

## Phase status

- **DDD:** ownership and proposed tactical boundaries are defined.
- **Migration, RPCs, app integration, and Phase 1 tests:** planned only; no implementation is claimed.
