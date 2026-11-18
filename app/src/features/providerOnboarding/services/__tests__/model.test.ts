import { packagePriceLabel, travelPreview } from '../model';
import type { ServicePackage } from '../../../../lib/types';

const servicePackage = (overrides: Partial<ServicePackage>) =>
  ({
    price_type: 'fixed',
    price: 2500,
    price_min: null,
    price_max: null,
    unit: 'job',
    ...overrides,
  }) as unknown as ServicePackage;

const expectJsonEqual = (actual: unknown, expected: unknown) => {
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
};

describe('provider onboarding service display helpers', () => {
  it('previews a flat travel fee in rupees', () => {
    expectJsonEqual(travelPreview(5, 'flat', '12.50', '9'),
      'A customer 15 km away pays ₹12.50 extra. You approve the request before they can book.',
    );
  });

  it('previews the per-kilometre fee only beyond the normal service radius', () => {
    expectJsonEqual(travelPreview(5, 'per_km', '12.50', '9'),
      'A customer 15 km away pays ₹90 extra. You approve the request before they can book.',
    );
    expectJsonEqual(travelPreview(20, 'per_km', '12.50', '9'),
      'A customer 15 km away pays ₹0 extra. You approve the request before they can book.',
    );
  });

  it('formats quote, range, starting and fixed package prices', () => {
    expectJsonEqual([
      packagePriceLabel(servicePackage({ price_type: 'quote' })),
      packagePriceLabel(servicePackage({ price_type: 'range', price_min: 2500, price_max: 5000 })),
      packagePriceLabel(servicePackage({ price_type: 'from', price_min: 2500 })),
      packagePriceLabel(servicePackage({ price_type: 'fixed', price: 2500 })),
    ], ['Price on request', '₹25–₹50 / job', 'From ₹25 / job', '₹25 / job']);
  });

  it('uses the minimum price when a fixed package has no direct price', () => {
    expectJsonEqual(packagePriceLabel(servicePackage({ price_type: 'fixed', price: null, price_min: 2500 })), '₹25 / job');
  });
});
