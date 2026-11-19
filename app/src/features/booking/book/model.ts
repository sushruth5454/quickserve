export interface BookingPricePreview {
  visit_fee: number;
  platform_fee: number;
  package_total: number;
  total: number;
  pay_now: number;
}

export function readPaise(value: unknown): number {
  if (value == null || typeof value === 'boolean') throw new Error('The booking price preview is incomplete');
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('The booking price preview is invalid');
  return amount;
}
