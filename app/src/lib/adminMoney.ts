import type { AdminBookingDetail } from './adminApi';

function sumSafePaise(amounts: number[]): number | null {
  let total = 0;
  for (const amount of amounts) {
    if (!Number.isSafeInteger(amount) || amount < 0) return null;
    total += amount;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

export function partialRefundLimitPaise(detail: AdminBookingDetail): number {
  const cashPayments = detail.payments.filter((payment) =>
    payment.status === 'paid' && payment.funding_source !== 'coins' && Boolean(payment.gateway_id));
  const cashPaymentIds = new Set(cashPayments.map((payment) => payment.id));
  const paidCashPaise = sumSafePaise(cashPayments.map((payment) => payment.amount));
  const priorRefundPaise = sumSafePaise(detail.refunds
    .filter((refund) => refund.status !== 'failed' && cashPaymentIds.has(refund.payment_id))
    .map((refund) => refund.amount));

  if (paidCashPaise == null || priorRefundPaise == null) return 0;
  const cashLimitPaise = Math.max(paidCashPaise - priorRefundPaise, 0);
  const payout = detail.payouts[0];
  if (!payout) return cashLimitPaise;
  if (!Number.isSafeInteger(payout.amount) || payout.amount < 0) return 0;
  return Math.min(cashLimitPaise, payout.amount);
}

export function parsePartialRefundRupees(value: string, paidPaise: number): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed) || !Number.isSafeInteger(paidPaise) || paidPaise < 0) return null;
  const rupees = Number(trimmed);
  if (!Number.isSafeInteger(rupees) || rupees <= 0) return null;
  const paise = rupees * 100;
  return Number.isSafeInteger(paise) && paise <= paidPaise ? paise : null;
}
