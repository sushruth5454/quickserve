import { buildBookingPayload, getBookingStepKeys, readPaise } from '../model';
import { isServiceBookingEnabled, resolveServiceBookingEntry } from '../../../../lib/assistant/prefill';
import type { DraftCard } from '../../../../lib/assistant/types';

const serviceFor = (archetype: string) => ({
  id: 'service-1',
  provider_id: 'provider-1',
  category_id: 'category-1',
  categories: { name: 'Service', slug: 'service', archetype },
  providers: { profiles: { full_name: 'Provider One' } },
});

const assistantDraft: DraftCard = {
  type: 'draft',
  category_slug: 'service',
  category_name: 'Service',
  provider: { provider_id: 'provider-1', provider_service_id: 'service-1', name: 'Provider One', visit_fee: 500, rating_avg: 4.8, rating_count: 12 },
  brief: null,
  description: 'Repair the leaking kitchen tap',
  description_en: 'Repair the leaking kitchen tap',
  description_original: 'Fix the kitchen tap',
  problem_chips: ['Leaking tap'],
  slot: { type: 'window', date: '2027-01-15', start_hour: 10, starts_at: '2027-01-15T04:30:00.000Z', label: 'Saturday, 10–12' },
  address: { address_id: 'address-1', label: 'Home', area: 'Central', city: 'Hyderabad', needs_full_address: false },
};

describe('service booking entry resolver', () => {
  it('familyAwareEntry selects each loaded category family', () => {
    expect([
      resolveServiceBookingEntry(serviceFor('inspect_quote'), null).kind,
      resolveServiceBookingEntry(serviceFor('fixed'), null).kind,
      resolveServiceBookingEntry(serviceFor('time_based'), null).kind,
      resolveServiceBookingEntry(serviceFor('proposal'), null).kind,
    ]).toEqual(['inspect', 'fixed-package', 'time-package', 'proposal-request']);
  });

  it('assistantPrefillPreserved keeps the draft brief, slot, and saved address', () => {
    const entry = resolveServiceBookingEntry(serviceFor('inspect_quote'), assistantDraft);

    expect(entry).toMatchObject({
      kind: 'inspect',
      params: {
        providerServiceId: 'service-1',
        from: 'assistant',
        description: 'Leaking tap\nRepair the leaking kitchen tap',
        slot: '2027-01-15@10',
        addressId: 'address-1',
      },
    });
  });

  it('forgedHintIgnored uses the loaded category instead of route or draft hints', () => {
    const forgedService = { ...serviceFor('fixed'), archetype: 'inspect_quote' };
    const forgedDraft = { ...assistantDraft, archetype: 'inspect_quote', routeArchetype: 'inspect_quote' };

    expect(resolveServiceBookingEntry(forgedService, forgedDraft).kind).toBe('fixed-package');
  });

  it('effectiveFamilySwitch blocks new entry when the loaded family is off', () => {
    const fixedEntry = resolveServiceBookingEntry(serviceFor('fixed'), null);

    expect(isServiceBookingEnabled(fixedEntry, { fixed: false, inspect_quote: true })).toBe(false);
    expect(isServiceBookingEnabled(fixedEntry, { fixed: true })).toBe(true);
  });
});

describe('booking step layout model', () => {
  it.each([false, undefined, null, 'true', 1])('keeps the existing layout for an off or unknown booking_steps value %p', (value) => {
    expect(getBookingStepKeys(value, true)).toBeNull();
  });

  it('omits the booking type step when recurring bookings are off', () => {
    expect(getBookingStepKeys(true, false)).toEqual([
      'booking.step.time',
      'booking.step.address',
      'booking.step.review',
    ]);
  });

  it('includes booking type when both booking features are on', () => {
    expect(getBookingStepKeys(true, true)).toEqual([
      'booking.step.type',
      'booking.step.time',
      'booking.step.address',
      'booking.step.review',
    ]);
  });
});

describe('booking request model', () => {
  it('preserves the create-booking payload for the enabled step layout', () => {
    const scheduledAt = new Date('2026-12-01T10:00:00.000Z');
    const input = {
      providerServiceId: 'service-1',
      description: 'Repair the kitchen tap',
      addressLine: '12 Main Street',
      city: 'Hyderabad',
      coords: { lat: 17.385, lng: 78.4867 },
      scheduledAt,
      photos: ['jobs/photo-1.jpg'],
      travelRequestId: 'travel-1',
    };

    expect(buildBookingPayload(input)).toEqual(input);
  });
});

describe('booking price preview model', () => {
  it.each([[0, 0], ['2900', 2900], [102800, 102800]])('reads valid paise value %p', (value, expected) => {
    expect(readPaise(value)).toBe(expected);
  });

  it.each([null, undefined, true, false])('rejects incomplete price value %p', (value) => {
    expect(() => readPaise(value)).toThrow('The booking price preview is incomplete');
  });

  it.each(['not a number', -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid price value %p',
    (value) => {
      expect(() => readPaise(value)).toThrow('The booking price preview is invalid');
    },
  );
});
