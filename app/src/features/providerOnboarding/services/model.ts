import { formatINR } from '../../../lib/money';
import { parseRupees } from '../../../lib/onboarding/validation';
import type { ServicePackage, TravelFeeMode } from '../../../lib/types';

export function travelPreview(radiusKm: number, mode: TravelFeeMode, flat: string, perKm: string): string {
  const amount = mode === 'flat' ? parseRupees(flat) ?? 0 : Math.round(Math.max(15 - radiusKm, 0) * (parseRupees(perKm) ?? 0));
  return `A customer 15 km away pays ${formatINR(amount)} extra. You approve the request before they can book.`;
}

export function packagePriceLabel(servicePackage: ServicePackage) {
  if (servicePackage.price_type === 'quote') return 'Price on request';
  if (servicePackage.price_type === 'range') {
    return `${formatINR(servicePackage.price_min ?? 0)}–${formatINR(servicePackage.price_max ?? 0)} / ${servicePackage.unit}`;
  }
  if (servicePackage.price_type === 'from') return `From ${formatINR(servicePackage.price_min ?? 0)} / ${servicePackage.unit}`;
  return `${formatINR(servicePackage.price ?? servicePackage.price_min ?? 0)} / ${servicePackage.unit}`;
}
