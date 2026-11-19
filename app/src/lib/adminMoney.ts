export function parsePartialRefundRupees(value: string, paidPaise: number): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed) || !Number.isSafeInteger(paidPaise) || paidPaise < 0) return null;
  const rupees = Number(trimmed);
  if (!Number.isSafeInteger(rupees) || rupees <= 0) return null;
  const paise = rupees * 100;
  return Number.isSafeInteger(paise) && paise <= paidPaise ? paise : null;
}
