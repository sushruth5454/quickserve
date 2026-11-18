import { getTimeBookingModes, hasSupportedRecurringFrequency, packageRepeatPlanRoute } from '../packageModel';

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
});
