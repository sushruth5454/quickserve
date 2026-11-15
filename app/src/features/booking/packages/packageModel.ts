import { formatINR } from '../../../lib/money';
import type { ServicePackage } from '../../../lib/types';

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

export function canPayInstantly(servicePackage: ServicePackage): boolean {
  return servicePackage.price_type === 'fixed' && servicePackage.price != null && servicePackage.price > 0;
}
