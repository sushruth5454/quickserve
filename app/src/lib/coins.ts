/** Wallet amounts stay in paise; the denomination only controls display and rounding. */
export interface CoinsConfig {
  coin_paise: number;
  earn_rate_bp: number;
  per_txn_cap_paise: number | null;
  first_txn_bonus_paise: number;
  monthly_cap_paise: number;
  redeem_cap_bp: number;
  expiry_months: number;
  pilot_budget_paise: number | null;
  coins_earning_enabled?: boolean;
  coins_redemption_enabled?: boolean;
}

// Owner-approved PRD v2 Phase 2 defaults; the server remains authoritative.
export const DEFAULT_COINS_CONFIG: CoinsConfig = {
  coin_paise: 10,
  earn_rate_bp: 100,
  per_txn_cap_paise: 2000,
  first_txn_bonus_paise: 1000,
  monthly_cap_paise: 100000,
  redeem_cap_bp: 1000,
  expiry_months: 6,
  pilot_budget_paise: 1000000,
};

export const COIN_PAISE = 10;
export const COIN_VALUE_PAISE = COIN_PAISE;
export const COIN_EARN_BP = DEFAULT_COINS_CONFIG.earn_rate_bp;
export const COIN_REDEEM_BP = DEFAULT_COINS_CONFIG.redeem_cap_bp;
export const COIN_MONTHLY_EARN_CAP_PAISE = DEFAULT_COINS_CONFIG.monthly_cap_paise;
export const COIN_EXPIRY_MONTHS = DEFAULT_COINS_CONFIG.expiry_months;

export interface CoinLedgerEntry {
  id: string;
  user_id: string;
  delta: number;
  kind: 'earn' | 'bonus' | 'redeem' | 'expire' | 'clawback' | 'admin';
  booking_id: string | null;
  source_ledger_id: string | null;
  expires_at: string | null;
  ref: string;
  reason: string | null;
  created_by: string | null;
  created_at: string;
}

export interface CoinRedemptionPreview {
  balance_paise: number;
  coin_paise: number;
  service_cap_paise: number;
  platform_cap_paise: number;
  maximum_paise: number;
  applied_paise: number;
  can_redeem?: boolean;
}

/** Adapts older demo previews while using the server's explicit eligibility when present. */
export function coinRedemptionPreviewState(preview: CoinRedemptionPreview): {
  canRedeem: boolean;
  appliedPaise: number;
} {
  const canRedeem = preview.can_redeem
    ?? (preview.applied_paise === 0 && preview.maximum_paise > 0);
  const appliedPaise = preview.can_redeem === undefined
    ? Math.floor(Math.max(0, preview.applied_paise) / Math.max(1, preview.coin_paise)) * Math.max(1, preview.coin_paise)
    : preview.maximum_paise;
  return { canRedeem, appliedPaise };
}

export function coinPaiseToCoins(paise: number, config: Pick<CoinsConfig, 'coin_paise'> = DEFAULT_COINS_CONFIG): number {
  return Math.floor(Math.max(0, Math.round(paise)) / Math.max(1, config.coin_paise));
}

export function coinRedemptionLimit(params: {
  balancePaise: number;
  serviceValuePaise: number;
  platformRevenuePaise: number;
}, config: Pick<CoinsConfig, 'coin_paise' | 'redeem_cap_bp'> = DEFAULT_COINS_CONFIG): number {
  const serviceCap = Math.floor(params.serviceValuePaise * config.redeem_cap_bp / 10000);
  const raw = Math.max(0, Math.min(params.balancePaise, serviceCap, params.platformRevenuePaise));
  return Math.floor(raw / Math.max(1, config.coin_paise)) * Math.max(1, config.coin_paise);
}

export function earnedCoinPaise(params: {
  serviceValuePaise: number;
  coinDiscountPaise?: number;
  refundPaise?: number;
  earnedThisMonthPaise?: number;
  issuedTotalPaise?: number;
  isFirstBooking?: boolean;
}, config: CoinsConfig = DEFAULT_COINS_CONFIG): number {
  const eligible = Math.max(
    0,
    params.serviceValuePaise - (params.coinDiscountPaise ?? 0) - (params.refundPaise ?? 0),
  );
  const unit = Math.max(1, config.coin_paise);
  let base = Math.floor((eligible * config.earn_rate_bp) / 10000 / unit) * unit;
  if (config.per_txn_cap_paise != null) {
    base = Math.min(base, Math.floor(config.per_txn_cap_paise / unit) * unit);
  }
  const bonus = params.isFirstBooking
    ? Math.floor(config.first_txn_bonus_paise / unit) * unit
    : 0;
  let earned = Math.floor(
    Math.min(base + bonus, Math.max(0, config.monthly_cap_paise - (params.earnedThisMonthPaise ?? 0))) / unit,
  ) * unit;
  if (config.pilot_budget_paise != null) {
    earned = Math.floor(
      Math.min(earned, Math.max(0, config.pilot_budget_paise - (params.issuedTotalPaise ?? 0))) / unit,
    ) * unit;
  }
  return earned;
}
