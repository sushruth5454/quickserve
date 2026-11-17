# QuickServe Phase 2 — Coins Configuration — Traceability

**Status:** Implementation trace documented; CI validation pending.

| BDD scenario | DDD context / model | TDD evidence authored (not yet run) | Implementation trace | ADR |
|---|---|---|---|---|
| [COIN-01](../../bdd/artifacts/coins-config-bdd.md) | Coin Wallet & Rewards / paise invariant and wallet balance | `coins_config.test.mjs`: pre-migration 5,000-paise balance; denomination display assertion | `supabase/migrations/0047_coins_config.sql`; `app/src/lib/coins.ts`; `app/app/coins.tsx` | No coin ADR; owner-approved policy in Phase 2 plan |
| [COIN-02](../../bdd/artifacts/coins-config-bdd.md) | Coin Wallet & Rewards / `CoinPolicy`, `CoinLedgerEntry` | `coins_config.test.mjs`: capped earning and separate bonus; `coins.test.ts`: config helper rules | `0047_coins_config.sql` (`_credit_booking_coins`); `app/src/lib/coins.ts`; `app/src/lib/__tests__/coins.test.ts` | None |
| [COIN-03](../../bdd/artifacts/coins-config-bdd.md) | Coin Policy Administration + Coin Wallet & Rewards / monthly and issuance limits | `coins_config.test.mjs`: exhausted budget; `coins.test.ts`: monthly cap helper | `0047_coins_config.sql` (`_credit_booking_coins`, `admin_coin_summary`) | None |
| [COIN-04](../../bdd/artifacts/coins-config-bdd.md) | Booking & Payments + Coin Wallet & Rewards / redemption transaction | `coins_config.test.mjs`: cap preview, applied amount, disabled preview/refusal; `coins.test.ts`: denomination rounding | `0047_coins_config.sql` (`get_coin_redemption_preview`, `_apply_quote_coins`); `app/src/lib/coinsConfigApi.ts`; booking RPC integration | None |
| [COIN-05](../../bdd/artifacts/coins-config-bdd.md) | Coin Policy Administration / feature flags | `coins_config.test.mjs`: earning disabled and redemption disabled | `0047_coins_config.sql`; `app/src/lib/coinsConfigApi.ts`; `app/app/coins.tsx`; `app/app/admin/coins.tsx` | ADR-0001 applies only to generic feature-flag registry |
| [COIN-06](../../bdd/artifacts/coins-config-bdd.md) | Coin Policy Administration + Coin Wallet & Rewards / expiry, audit, liability | `coins_config.test.mjs`: config authorization/validation, expiry, admin summary | `0047_coins_config.sql` (`admin_set_coins_config`, `expire_coins`, `admin_coin_summary`); `app/app/admin/coins.tsx` | No coin-specific ADR |

## Evidence and gate status

- Approved defaults: 10 paise/coin; 100 bp earn; 2,000-paise per-booking cap; 1,000-paise first-booking bonus; 100,000-paise monthly cap; 1,000 bp redemption; six-month expiry; 1,000,000-paise budget; both flags enabled.
- Paise invariant: migration 0047 does not rewrite existing ledger or wallet amounts.
- Test references are authored coverage only. No local tests were run; GitHub Actions registration and CI validation remain pending.
- **Integration status:** shared SQL-test registration, booking-preview denomination display, account navigation, and admin navigation are integrated in the worktree. GitHub Actions validation remains pending; no live database write is included.

## Related artifacts

- BDD: [Coins Configuration — BDD](../../bdd/artifacts/coins-config-bdd.md)
- DDD: [Coins Configuration — DDD](../../ddd/artifacts/coins-config-ddd.md)
- Plan: `docs/11-PRD-v2-Implementation-Plan.md`, Phase 2.
