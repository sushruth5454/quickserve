import { formatINR } from '../../../lib/money';
import type { Category, ServicePackage } from '../../../lib/types';

export type TimeBookingMode = 'one-time' | 'repeat' | 'session-pack';

const RECURRING_FREQUENCIES = new Set(['daily', 'alternate_days', 'weekly', 'monthly', 'custom']);

export function hasSupportedRecurringFrequency(frequencies: readonly string[] | null | undefined): boolean {
  return frequencies?.some((frequency) => RECURRING_FREQUENCIES.has(frequency)) ?? false;
}

export function packageRepeatPlanRoute(
  providerServiceId: string,
  packageId: string,
  durationMin: number,
  description: string,
) {
  return {
    pathname: '/recurring/new/[providerServiceId]',
    params: {
      providerServiceId,
      archetype: 'time_based',
      packageId,
      durationMin: String(durationMin),
      description,
      source: 'package-booking',
    },
  } as const;
}

export function getTimeBookingModes(
  recurringBookingsEnabled: boolean,
  category: Pick<Category, 'recurrence_allowed' | 'allowed_frequencies'> | null | undefined,
): TimeBookingMode[] {
  const modes: TimeBookingMode[] = ['one-time'];
  if (
    recurringBookingsEnabled &&
    category?.recurrence_allowed === true &&
    hasSupportedRecurringFrequency(category.allowed_frequencies)
  ) {
    modes.push('repeat');
  }
  modes.push('session-pack');
  return modes;
}

export function packageDisplayPrice(servicePackage: ServicePackage): string {
  switch (servicePackage.price_type) {
    case 'quote':
      return 'Price on request';
    case 'range':
      return `${formatINR(servicePackage.price_min ?? 0)}–${formatINR(servicePackage.price_max ?? 0)}`;
    case 'from':
      return `From ${formatINR(servicePackage.price_min ?? 0)}`;
    default:
      return formatINR(servicePackage.price ?? servicePackage.price_min ?? 0);
  }
}

export function packageTotal(servicePackage: ServicePackage, quantity: number): number {
  return Math.max(0, Math.round((servicePackage.price ?? servicePackage.price_min ?? 0) * quantity));
}

export function packageDuration(servicePackage: ServicePackage, quantity: number): number {
  const duration = servicePackage.duration_min ?? 60;
  return ['session', 'hour', 'day'].includes(servicePackage.unit) ? duration * quantity : duration;
}

export function canPurchaseSessionPack(
  servicePackage: Pick<ServicePackage, 'unit' | 'price_type' | 'price' | 'qty_min' | 'qty_max'>,
): boolean {
  return servicePackage.unit === 'session'
    && servicePackage.price_type === 'fixed'
    && servicePackage.price != null
    && servicePackage.price > 0
    && Number.isInteger(servicePackage.qty_min)
    && Number.isInteger(servicePackage.qty_max)
    && servicePackage.qty_max >= Math.max(2, servicePackage.qty_min);
}

export function fixedBookingDuration(
  servicePackage: Pick<ServicePackage, 'qty_min' | 'qty_max' | 'duration_min'>,
  quantity: number,
): number {
  const min = Number(servicePackage.qty_min);
  const max = Number(servicePackage.qty_max);
  if (
    !Number.isFinite(quantity) ||
    quantity < min ||
    quantity > max ||
    (!Number.isInteger(quantity) && max <= 1)
  ) {
    throw new Error('Quantity is outside the package bounds');
  }
  const duration = servicePackage.duration_min ?? 60;
  return min === 1 && max === 1 ? duration : duration * Math.ceil(quantity);
}

export function timeBookingQuantity(pack: boolean, quantity: number): number {
  return pack ? quantity : 1;
}

export function canPayInstantly(servicePackage: ServicePackage): boolean {
  return servicePackage.price_type === 'fixed' && servicePackage.price != null && servicePackage.price > 0;
}
