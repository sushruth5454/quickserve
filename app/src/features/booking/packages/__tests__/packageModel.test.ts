import { canProceedAfterSlotPrefill, canPurchaseSessionPack, fixedBookingDuration, getTimeBookingModes, hasSupportedRecurringFrequency, initialPackageAsap, packageRepeatPlanRoute, timeBookingQuantity } from '../packageModel';
import { packageCheckoutTotal } from '../../../../lib/money';
import { buildFixedAddonPayload } from '../../../../lib/fixedBooking';

jest.mock('../../../../lib/supabase', () => ({ supabase: {} }));

type EligibilityCategory = { recurrence_allowed?: boolean; allowed_frequencies?: string[] };

describe('package booking modes', () => {
  const unavailableCases: Array<[string, boolean, EligibilityCategory]> = [
    ['recurring feature is off', false, { recurrence_allowed: true, allowed_frequencies: ['weekly'] }],
    ['category recurrence is off', true, { recurrence_allowed: false, allowed_frequencies: ['weekly'] }],
    ['category has no supported recurrence frequency', true, { recurrence_allowed: true, allowed_frequencies: ['hourly'] }],
    ['category has no allowed frequencies', true, { recurrence_allowed: true, allowed_frequencies: [] }],
    ['category has no recurrence configuration', true, {}],
  ];

  it.each(unavailableCases)('keeps one-time and pack choices when %s', (_reason, recurringEnabled, category) => {
    expect(getTimeBookingModes(recurringEnabled, category)).toEqual(['one-time', 'session-pack']);
  });

  describe('package booking units', () => {
    it('doesNotDefaultToAsapForAnInvalidPrefilledSlot', () => {
      expect(initialPackageAsap('fixed', { mode: null, slotInvalid: true })).toBe(false);
      expect(initialPackageAsap('fixed', { mode: null })).toBe(true);
      expect(initialPackageAsap('fixed', { mode: 'asap' })).toBe(true);
      expect(initialPackageAsap('fixed', { mode: 'schedule' })).toBe(false);
      expect(canProceedAfterSlotPrefill(true, false)).toBe(false);
      expect(canProceedAfterSlotPrefill(true, true)).toBe(true);
      expect(canProceedAfterSlotPrefill(false, false)).toBe(true);
    });

    it('doesNotOfferSessionPacksWithFractionalQuantityBounds', () => {
      const pack = { unit: 'session' as const, price_type: 'fixed' as const, price: 5000, qty_min: 1, qty_max: 5 };

      expect(canPurchaseSessionPack(pack)).toBe(true);
      expect(canPurchaseSessionPack({ ...pack, qty_min: 1.5 })).toBe(false);
      expect(canPurchaseSessionPack({ ...pack, qty_max: 4.5 })).toBe(false);
    });

    it('singleSessionUnit keeps quantity as one unless purchasing a pack', () => {
      expect(timeBookingQuantity(false, 4)).toBe(1);
      expect(timeBookingQuantity(true, 4)).toBe(4);
    });

    it('fixedQuantityDuration follows package bounds and the SQL ceil duration rule', () => {
      expect(fixedBookingDuration({ qty_min: 1, qty_max: 4, duration_min: 60 }, 2)).toBe(120);
      expect(fixedBookingDuration({ qty_min: 1, qty_max: 1, duration_min: 30 }, 1)).toBe(30);
      expect(fixedBookingDuration({ qty_min: 1, qty_max: 4, duration_min: 60 }, 1.2)).toBe(120);
      expect(() => fixedBookingDuration({ qty_min: 1, qty_max: 4, duration_min: 60 }, 5)).toThrow('Quantity is outside the package bounds');
    });
  });

  it('offers repeat plans only when enabled by both feature and category', () => {
    expect(getTimeBookingModes(true, { recurrence_allowed: true, allowed_frequencies: ['weekly'] })).toEqual([
      'one-time',
      'repeat',
      'session-pack',
    ]);
    expect(getTimeBookingModes(true, { recurrence_allowed: true, allowed_frequencies: ['daily'] })).toEqual([
      'one-time',
      'repeat',
      'session-pack',
    ]);
  });

  it('recognizes only frequencies supported by B1', () => {
    expect(hasSupportedRecurringFrequency(['monthly', 'weekly'])).toBe(true);
    expect(hasSupportedRecurringFrequency(['hourly'])).toBe(false);
    expect(hasSupportedRecurringFrequency([])).toBe(false);
  });

  it('routes repeat package selection into the B1 recurring-plan wizard', () => {
    expect(packageRepeatPlanRoute('service-1', 'package-1', 60, '{"room":"kitchen"}')).toEqual({
      pathname: '/recurring/new/[providerServiceId]',
      params: {
        providerServiceId: 'service-1',
        archetype: 'time_based',
        packageId: 'package-1',
        durationMin: '60',
        description: '{"room":"kitchen"}',
        source: 'package-booking',
      },
    });
  });

  it('includes the server platform fee in the fixed-package checkout total', () => {
    expect(packageCheckoutTotal({ price: 99900, price_min: 99900 }, 1, 2900)).toBe(102800);
  });

  it('fixedAddonBaseImmutable keeps the accepted package snapshot out of the add-on draft', () => {
    const acceptedPackage = {
      quote_type: 'package' as const,
      source_package_id: 'package-1',
      package_snapshot: { title: 'Deep clean', quantity: 1, inclusions: ['Kitchen', 'Bath'] },
      quote_items: [{ id: 'base-line', kind: 'package', title: 'Deep clean', qty: 1, unit_price: 12000 }],
    };
    const before = JSON.parse(JSON.stringify(acceptedPackage));
    const addonPayload = buildFixedAddonPayload(acceptedPackage, [
      { title: 'Extra room', qty: 1, unit: 'room', unitPrice: '25.50' },
    ]);

    expect(acceptedPackage).toEqual(before);
    expect(addonPayload).toEqual([{ title: 'Extra room', qty: 1, unit: 'room', unit_price: 2550 }]);
  });
});
