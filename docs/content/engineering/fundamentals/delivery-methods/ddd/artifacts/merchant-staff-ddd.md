# QuickServe Phase 10 — Merchant Staff — DDD

**Status:** Domain boundaries recorded; CI validation pending.

## Domain framing

Merchant staff membership is scoped to a business owner's existing QuickServe profile ID. It delegates access to provider jobs, shop conversations/RFQs, and sports venue bookings without changing the owner ID stored on those resources. `merchant_staff` gates every delegated access path and defaults to disabled.

## Ubiquitous language

| Term | Meaning |
|---|---|
| Business owner | The provider, shop, or sports venue owner identified by the `owner_id` / `provider_id` profile UUID. |
| Business member | An existing profile linked to one owner by an active `business_members` row. |
| Staff | A member who can view business jobs, enquiries, routed RFQs, and chat; cannot send quotes or administer the business. |
| Manager | A member who receives staff read/chat capabilities and can send provider and supplier quotes or provider proposals. |
| Owner action | Managing members or changing payout, price/catalogue, or verification data. Existing owner checks remain server-enforced. |
| Existing-user-ID flow | The owner supplies a registered profile UUID. No contact-address delivery, token, or external invitation channel is part of this phase. |

## Bounded contexts and invariants

| Context | Owns | Invariants and boundary |
|---|---|---|
| **Staff access** | `business_members`; `_business_role`, `_acts_for`, member management RPCs | The feature flag must be on for delegated access and changes. Only owner-level access manages members. Member IDs must already exist in `profiles`; manager/staff roles are the only roles assignable through the app RPC. |
| **Provider work** | Provider business context, job listing, booking address access, booking chat, provider quote/proposal submission | The member explicitly selects a provider business when they belong to more than one; every job and proposal query is scoped to that provider ID. Managers can quote/propose; staff are read/chat only. Payout, service price, verification, and other job-state mutation RPCs retain their original owner checks. |
| **Shop conversations and RFQs** | Enquiry participant helper/list/message/read RPCs; supplier RFQ list/detail/quote RPCs | Membership is checked against the exact shop owner ID and routed RFQ recipient. Managers may send quotes; staff may read RFQs and chat. Product and shop settings/prices remain owner-only. |
| **Sports work** | Business-scoped venue and sports booking read RPCs and RLS | A member sees venues/bookings only where `_acts_for(venue.owner_id, 'staff')` succeeds. Venue edits, prices, verification, and booking decisions remain owner-only. |

## Cross-cutting policies

- Owners continue to act directly when `auth.uid() = owner_id`, even when `merchant_staff` is off.
- Deactivating a membership blocks subsequent delegated checks without deleting its audit row.
- `business_members` has read-only client access; add/remove operations go through owner-checked RPCs.
- Shop/RFQ/booking/request chat derives the sender from `auth.uid()` and the business side from the persisted owner relationship.
- The provider proposal RPC requires exactly one managed provider recipient for a request; it refuses an ambiguous multi-business route rather than selecting one implicitly.
- The app does not discover users by phone or email and does not send an invitation token or link.

## Trace links

- BDD: [Merchant Staff — BDD](../../bdd/artifacts/merchant-staff-bdd.md)
- Traceability: [Merchant Staff — Traceability](../../bdd-ddd-tdd/artifacts/merchant-staff-traceability.md)
- Plan: [PRD v2 implementation plan](../../../../../../11-PRD-v2-Implementation-Plan.md), Phase 10
- Implementation: [`0052_merchant_staff.sql`](../../../../../../../supabase/migrations/0052_merchant_staff.sql)
- Test: [`merchant_staff.test.mjs`](../../../../../../../supabase/tests/merchant_staff.test.mjs)

**CI validation pending.** Local tests, builds, package installation, and live database operations were not run.
