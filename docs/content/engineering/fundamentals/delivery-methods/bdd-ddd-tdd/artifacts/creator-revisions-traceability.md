# Creator Revisions — Traceability

This matrix links the Phase 3 behavior to its domain owner, implementation, and isolated SQL evidence. The test file follows the migration chain through 0042 and applies 0044 directly.

| BDD scenario | DDD owner | Test evidence | Implementation references | ADR |
|---|---|---|---|---|
| [CR-01](../../bdd/artifacts/creator-revisions-bdd.md#cr-01--feature-switch-is-off) — flag off | Feature Gate; Proposal Booking Fulfillment | `creator_revisions.test.mjs`: disabled-switch refusal | `0044_creator_revisions.sql`; `app/app/booking/[id].tsx`; `app/src/lib/creatorRevisions.ts` | None; existing boundaries retained |
| [CR-02](../../bdd/artifacts/creator-revisions-bdd.md#cr-02--customer-requests-a-valid-revision) — valid customer request | Booking aggregate and Notification Outbox | SQL assertions for increment/state/timer, event note, and provider notification | `0044_creator_revisions.sql`; `app/app/booking/[id].tsx`; `app/src/lib/creatorRevisions.ts` | None |
| [CR-03](../../bdd/artifacts/creator-revisions-bdd.md#cr-03--reject-unauthorized-ineligible-or-invalid-requests) — authorization and note validation | Booking aggregate; `RevisionNote` rule | SQL assertions for provider refusal and a too-short note; valid trimmed note asserted in CR-02 | `0044_creator_revisions.sql`; `app/app/booking/[id].tsx`; `app/src/lib/creatorRevisions.ts` | None |
| [CR-04](../../bdd/artifacts/creator-revisions-bdd.md#cr-04--enforce-the-revision-allowance) — default limit and optional allowance | Booking aggregate | SQL assertions allow two and refuse the third; valid marker sets one and preserves the snapshot | `0044_creator_revisions.sql`; `supabase/tests/creator_revisions.test.mjs` | None |
| [CR-05](../../bdd/artifacts/creator-revisions-bdd.md#cr-05--provider-resubmits-revised-work) — provider resubmission | Proposal Booking Fulfillment | SQL resubmission assertion checks delivery/status/timestamp | `0044_creator_revisions.sql`; `app/app/booking/[id].tsx`; `app/src/lib/creatorRevisions.ts`; `supabase/tests/creator_revisions.test.mjs` | None |
| [CR-06](../../bdd/artifacts/creator-revisions-bdd.md#cr-06--pending-revisions-are-not-auto-completed) — auto-confirm protection | Booking aggregate; completion worker | SQL assertion checks worker count, pending status, and null timer | `0044_creator_revisions.sql`; `supabase/tests/creator_revisions.test.mjs` | None |

## File-level map

- **Database contract and enforcement:** `supabase/migrations/0044_creator_revisions.sql`
- **Customer/provider presentation and feature gating:** `app/app/booking/[id].tsx`
- **App RPC boundary:** `app/src/lib/creatorRevisions.ts`
- **Isolated SQL behavior evidence:** `supabase/tests/creator_revisions.test.mjs`

## Phase status

- **BDD:** scenarios CR-01 through CR-06 are defined and linked.
- **DDD:** each scenario has an owning context/model.
- **TDD/implementation:** implementation and SQL assertions are mapped. The SQL test has not been run locally; **CI validation is pending**, so the delivery-chain quality gate is not yet complete.
- **ADR:** no ownership or aggregate-boundary change requiring a new ADR was identified.
