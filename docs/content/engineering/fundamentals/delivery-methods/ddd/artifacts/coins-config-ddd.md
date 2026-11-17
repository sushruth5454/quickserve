# QuickServe Phase 2 — Coins Configuration — DDD

**Status:** Domain mapping for owner-approved Phase 2 policy; CI validation pending.

## Domain framing

**Problem:** administer a configured customer reward wallet while keeping monetary accounting in paise and enforcing all earning/redemption decisions on the server.

### Ubiquitous language

| Term | Meaning |
|---|---|
| Coin | Display unit backed by a configured paise denomination; default 10 paise |
| Wallet balance | Available paise derived from the customer's unexpired, unspent ledger lots |
| Coin lot | Positive ledger credit with an expiry date; debits consume lots oldest-first |
| Earning policy | Rate, per-booking cap, first-booking bonus, monthly cap, lifetime budget, and expiry |
| Redemption policy | Maximum discount, bounded by wallet balance, service-value cap, and platform revenue |
| Coin feature flag | Server-side switch independently enabling earning or redemption |
| Paise invariant | Existing ledger deltas and balances are not rescaled when display denomination changes |

## Bounded contexts and ownership

| Context | Owns | Boundary |
|---|---|---|
| **Coin Wallet & Rewards** | `coin_ledger`, coin lots, balances, expiry, earning, clawback | Server RPCs write ledger entries; balances are derived from paise lots. |
| **Coin Policy Administration** | `app_config` key `coins`, `coins_earning`/`coins_redemption` flags, validation, audit, admin summary | Admin RPCs authorize, validate, and persist policy; ordinary clients cannot change monetary policy. |
| **Booking & Payments** | Booking quote, payment allocation, platform-revenue calculation | Calls coin preview/approval; redemption remains inside booking/payment rules and cannot exceed platform revenue. |
| **QuickServe App** | Customer balance/history presentation and admin controls | `coins.ts` helpers format/preview; production monetary decisions are server-owned. |

Context flow:

```text
Admin UI ──admin RPCs──> Coin Policy Administration ──> app_config + feature_flags
                                  │
                                  v
Booking & Payments <──preview/apply── Coin Wallet & Rewards ──> paise ledger
       │                                      │
       └──────── server results ──────────────┴──> Customer/Admin UI
```

## Tactical design

| Model / service | Responsibility and invariant |
|---|---|
| `CoinPolicy` (`app_config.key = 'coins'`) | Stores approved defaults: denomination 10 paise, 100 bp earning, ₹20 per-booking cap, ₹10 first-booking bonus, ₹1,000 monthly cap, 1,000 bp redemption cap, six-month expiry, and ₹10,000 budget. |
| `CoinWallet` / `coin_accounts` | Lock boundary for a user's balance and clawback debt; paise remains the accounting unit. |
| `CoinLedgerEntry` / `coin_ledger` | Append-only economic evidence in integer paise. Existing rows are not converted; new denomination values are permitted. |
| `CoinAmount` | Integer paise value object; conversion to coins floors by the configured denomination. |
| `CoinRate` | Basis points; earning and redemption rates are validated to 0–10,000 bp. |
| `_credit_booking_coins` | Computes eligible value, denomination rounding, per-booking cap, first-booking bonus, monthly cap, and remaining issuance budget; checks `coins_earning`. |
| `_apply_quote_coins` / `get_coin_redemption_preview` | Enforces configured redemption cap, platform revenue, whole-coin rounding, and `coins_redemption`; disabled preview returns zero and attempted redemption is refused. |
| `expire_coins` | Balances expired lots; new credits and restoration credits use configured expiry months. |
| `admin_set_coins_config`, `admin_coin_summary` | Admin-only validated/audited policy update and liability/issuance reporting. |

## Decisions, ADRs, and readiness

- **Owner-approved policy:** the defaults above were approved on November 17, 2026 and are recorded in migration 0047.
- **Money invariant:** a 5,000-paise wallet stays 5,000 paise (₹50), now displayed as 500 coins; no balance migration or live database write is part of this artifact.
- **Consistency boundary:** quote redemption and ledger mutation are server-side; app-side helpers are presentation/demo support only.
- **ADR:** no coin-specific ADR is present. `ADR-0001-feature-flag-registry.md` covers generic feature switches, not coin economics. No new architectural boundary is introduced; a dedicated ADR is a candidate only if future work changes policy ownership, effective-time semantics, or ledger consistency.
- **TDD/CI:** `supabase/tests/coins_config.test.mjs` and `app/src/lib/__tests__/coins.test.ts` map to the domain rules. Shared runner registration is prepared; GitHub Actions validation remains pending.

## Trace links

- BDD: [Coins Configuration — BDD](../../bdd/artifacts/coins-config-bdd.md)
- Scenario mapping: [Coins Configuration — Traceability](../../bdd-ddd-tdd/artifacts/coins-config-traceability.md)
- Plan: `docs/11-PRD-v2-Implementation-Plan.md`, Phase 2.
