/** Seva Coins rules. Ledger and payment amounts are integer paise; one coin is ₹1. */
export const COIN_VALUE_PAISE = 100;
export const COIN_EARN_BP = 200;
export const COIN_REDEEM_BP = 1000;
export const COIN_MONTHLY_EARN_CAP_PAISE = 100000;
export const COIN_EXPIRY_MONTHS = 6;

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
  service_cap_paise: number;
  platform_cap_paise: number;
  maximum_paise: number;
  applied_paise: number;
}

export function coinPaiseToCoins(paise: number): number {
  return Math.floor(Math.max(0, Math.round(paise)) / COIN_VALUE_PAISE);
}

export function coinRedemptionLimit(params: {
  balancePaise: number;
  serviceValuePaise: number;
  platformRevenuePaise: number;
}): number {
  const serviceCap = Math.floor(params.serviceValuePaise * COIN_REDEEM_BP / 10000);
  const raw = Math.max(0, Math.min(params.balancePaise, serviceCap, params.platformRevenuePaise));
  return Math.floor(raw / COIN_VALUE_PAISE) * COIN_VALUE_PAISE;
}

export function earnedCoinPaise(params: {
  serviceValuePaise: number;
  coinDiscountPaise?: number;
  refundPaise?: number;
  earnedThisMonthPaise?: number;
}): number {
  const eligible = Math.max(
    0,
    params.serviceValuePaise - (params.coinDiscountPaise ?? 0) - (params.refundPaise ?? 0),
  );
  const earned = Math.floor((eligible * COIN_EARN_BP) / 10000 / COIN_VALUE_PAISE) * COIN_VALUE_PAISE;
  const remainingCap = Math.max(0, COIN_MONTHLY_EARN_CAP_PAISE - (params.earnedThisMonthPaise ?? 0));
  return Math.min(earned, remainingCap);
}
