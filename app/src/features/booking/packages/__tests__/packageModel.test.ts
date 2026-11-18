import { getTimeBookingModes } from '../packageModel';

type EligibilityCategory = { recurrence_allowed?: boolean; allowed_frequencies?: string[] };

describe('package booking modes', () => {
  const unavailableCases: Array<[string, boolean, EligibilityCategory]> = [
    ['recurring feature is off', false, { recurrence_allowed: true, allowed_frequencies: ['weekly'] }],
    ['category recurrence is off', true, { recurrence_allowed: false, allowed_frequencies: ['weekly'] }],
    ['category does not allow weekly', true, { recurrence_allowed: true, allowed_frequencies: ['monthly'] }],
    ['category has no allowed frequencies', true, { recurrence_allowed: true, allowed_frequencies: [] }],
    ['category has no recurrence configuration', true, {}],
  ];

  it.each(unavailableCases)('keeps one-time and pack choices when %s', (_reason, recurringEnabled, category) => {
    expect(getTimeBookingModes(recurringEnabled, category)).toEqual(['one-time', 'session-pack']);
  });

  it('offers weekly recurrence only when enabled by both feature and category', () => {
    expect(getTimeBookingModes(true, { recurrence_allowed: true, allowed_frequencies: ['weekly'] })).toEqual([
      'one-time',
      'weekly',
      'session-pack',
    ]);
  });
});

describe('legacy weekly schedule creation integration', () => {
  it.todo('after schedule creation, navigates to bookings without client-side materialization; cron generates visits');
});
