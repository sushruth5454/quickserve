import type { ServicePackage } from './types';

/**
 * Money math for QuickServe. All amounts are integer paise.
 * Mirrors docs/03-Pricing-Payments-Commission.md and the SQL in supabase/migrations/0001_init.sql
 * (_commission_bp, _required_total, _create_payout).
 */

export const PLATFORM_FEE_PAISE = 2900;
export const GST_ON_COMMISSION_PERCENT = 18;
export const FREE_PERIOD_DAYS = 30;
export const TIER_1_JOBS = 50;
export const TIER_2_JOBS = 200;
export const RATE_BP = { free: 0, base: 1200, tier1: 1000, tier2: 800 } as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export type LineKind =
  | 'labour'
  | 'part'
  | 'other'
  | 'material'
  | 'package'
  | 'per_unit'
  | 'travel'
  | 'rental'
  | 'discount'
  | 'addon';

export interface LineInput {
  kind: LineKind;
  qty: number;
  unitPrice: number;
}

export interface Subtotals {
  labour: number;
  parts: number;
  other: number;
  total: number;
}

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export function paiseToRupees(paise: number): number {
  return paise / 100;
}

function groupIndian(n: string): string {
  if (n.length <= 3) return n;
  const last3 = n.slice(-3);
  const rest = n.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
}

/** 193760 -> "₹1,937.60"; 198000 -> "₹1,980"; 12345600 -> "₹1,23,456". */
export function formatINR(paise: number, opts: { alwaysShowPaise?: boolean } = {}): string {
  const negative = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / 100);
  const fraction = abs % 100;
  const showFraction = opts.alwaysShowPaise || fraction !== 0;
  const body = groupIndian(String(rupees)) + (showFraction ? `.${String(fraction).padStart(2, '0')}` : '');
  return `${negative ? '-' : ''}₹${body}`;
}

/**
 * Commission in basis points: 0 during the provider's first 30 days,
 * then 12%, 10% from 50 completed in-app jobs, 8% from 200.
 */
export function commissionRateBp(params: { jobsCompleted: number; providerCreatedAt: Date; at: Date }): number {
  const { jobsCompleted, providerCreatedAt, at } = params;
  if (at.getTime() < providerCreatedAt.getTime() + FREE_PERIOD_DAYS * DAY_MS) return RATE_BP.free;
  if (jobsCompleted >= TIER_2_JOBS) return RATE_BP.tier2;
  if (jobsCompleted >= TIER_1_JOBS) return RATE_BP.tier1;
  return RATE_BP.base;
}

export function lineTotal(qty: number, unitPrice: number): number {
  return Math.round(qty * unitPrice);
}

export function packageCheckoutTotal(
  pkg: Pick<ServicePackage, 'price' | 'price_min'>,
  quantity: number,
  platformFeePaise: number,
): number {
  const unitPricePaise = pkg.price ?? pkg.price_min ?? 0;
  return Math.max(0, Math.round(unitPricePaise * quantity)) + platformFeePaise;
}

export function quoteSubtotals(items: LineInput[]): Subtotals {
  const s = { labour: 0, parts: 0, other: 0 };
  for (const item of items) {
    const t = lineTotal(item.qty, item.unitPrice);
    if (item.kind === 'labour' || item.kind === 'package' || item.kind === 'per_unit' || item.kind === 'addon' || item.kind === 'travel') s.labour += t;
    else if (item.kind === 'part') s.parts += t;
    else s.other += t;
  }
  return { ...s, total: s.labour + s.parts + s.other };
}

/** What the customer owes in total for a quote: visit fee is credited (not extra); platform fee charged once. */
export function requiredTotal(quoteTotal: number, visitFee: number, platformFee: number): number {
  return Math.max(quoteTotal, visitFee) + platformFee;
}

/** Amount to collect now (initial balance or change-order increment). Never negative. */
export function amountDue(params: {
  quoteTotal: number;
  visitFee: number;
  platformFee: number;
  alreadyPaid: number;
}): number {
  return Math.max(0, requiredTotal(params.quoteTotal, params.visitFee, params.platformFee) - params.alreadyPaid);
}

/** Customer due now in integer paise, including an optional coin-redemption preview. */
export function customerDueNow(totalPaise: number, paidPaise: number, coinPreviewPaise = 0): number {
  return Math.max(0, totalPaise - paidPaise - coinPreviewPaise);
}

export function commissionFor(commissionable: number, rateBp: number): number {
  return Math.round((commissionable * rateBp) / 10000);
}

export function gstOnCommission(commission: number): number {
  return Math.round((commission * GST_ON_COMMISSION_PERCENT) / 100);
}

export interface PayoutBreakdown {
  gross: number;
  commission: number;
  gst: number;
  payout: number;
}

/** Commission is charged on labour only (parts/other are pass-through). */
export function providerPayout(params: { gross: number; commissionable: number; rateBp: number }): PayoutBreakdown {
  const commission = commissionFor(params.commissionable, params.rateBp);
  const gst = gstOnCommission(commission);
  return { gross: params.gross, commission, gst, payout: Math.max(params.gross - commission - gst, 0) };
}

export interface JobSettlement {
  subtotals: Subtotals;
  customerTotal: number;
  balanceAfterVisitFee: number;
  commission: number;
  gst: number;
  providerPayout: number;
  platformRevenue: number;
}

export function settleQuotedJob(params: {
  items: LineInput[];
  visitFee: number;
  platformFee: number;
  rateBp: number;
  travelFee?: number;
}): JobSettlement {
  const base = quoteSubtotals(params.items);
  const travelFee = Math.max(0, params.travelFee ?? 0);
  const subtotals = {
    ...base,
    other: base.other + travelFee,
    total: base.total + travelFee,
  };
  const customerTotal = requiredTotal(subtotals.total, params.visitFee, params.platformFee);
  const p = providerPayout({
    gross: Math.max(subtotals.total, params.visitFee),
    commissionable: subtotals.labour + travelFee,
    rateBp: params.rateBp,
  });
  return {
    subtotals,
    customerTotal,
    balanceAfterVisitFee: customerTotal - params.visitFee,
    commission: p.commission,
    gst: p.gst,
    providerPayout: p.payout,
    platformRevenue: p.commission + params.platformFee,
  };
}

/** Quote rejected after inspection, or chargeable cancellation after the provider is en route. */
export function settleVisitOnly(params: { visitFee: number; rateBp: number }): PayoutBreakdown {
  return providerPayout({ gross: params.visitFee, commissionable: params.visitFee, rateBp: params.rateBp });
}
