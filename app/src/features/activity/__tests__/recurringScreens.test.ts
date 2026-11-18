import {
  getBookingModeOptions,
  getFixedBookingModeOptions,
  getRecurringPlanActions,
  getRecurringQuoteSummary,
  shouldShowRepeatPlansFilter,
  visibleBillingFrequencies,
} from '../../recurring/customerPresentation';

describe('customer recurring screens', () => {
  it('RP-01/RP-04 keeps repeat hidden when the feature, category, or archetype is ineligible', () => {
    expect(getBookingModeOptions(false, true, 'time_based')).toEqual(['one-time']);
    expect(getBookingModeOptions(true, false, 'time_based')).toEqual(['one-time']);
    expect(getBookingModeOptions(true, true, 'inspect_quote')).toEqual(['one-time']);
    expect(getBookingModeOptions(true, true, 'proposal')).toEqual(['one-time']);
  });

  it('RP-01 offers repeat only for an enabled, eligible category and recurring archetype', () => {
    expect(getBookingModeOptions(true, true, 'fixed')).toEqual(['one-time', 'repeat']);
  });

  it('RP-01 exposes fixed-package repeat only for an enabled recurring category', () => {
    expect(getFixedBookingModeOptions(false, true)).toEqual(['one-time']);
    expect(getFixedBookingModeOptions(true, false)).toEqual(['one-time']);
    expect(getFixedBookingModeOptions(true, true)).toEqual(['one-time', 'repeat']);
  });

  it('RP-23 exposes only B1 per-visit billing before D1 is integrated', () => {
    expect(visibleBillingFrequencies(['per_visit', 'weekly', 'monthly', 'prepaid_package'])).toEqual([
      'per_visit',
    ]);
    expect(visibleBillingFrequencies(['weekly', 'monthly', 'prepaid_package'])).toEqual([]);
  });

  it('RP-03 displays the server quote values and only the next five server dates', () => {
    const dates = ['2026-12-01', '2026-12-03', '2026-12-05', '2026-12-07', '2026-12-09', '2026-12-11'];
    expect(getRecurringQuoteSummary({
      per_visit_paise: 12500,
      visits_in_first_cycle: 1,
      visits_total: 12,
      discount_bp: 0,
      discount_paise: 0,
      platform_fee_paise: 2900,
      gst_paise: 0,
      total_paise_per_cycle: 15400,
      billing_frequency: 'per_visit',
      first_dates: dates,
    })).toEqual({
      perVisitPaise: 12500,
      visitsInFirstCycle: 1,
      visitsTotal: 12,
      discountPaise: 0,
      platformFeePaise: 2900,
      gstPaise: 0,
      totalPaisePerCycle: 15400,
      billingFrequency: 'per_visit',
      firstDates: dates.slice(0, 5),
    });
  });

  it('RP-14/RP-23 preserves existing-plan cancellation when the master switch is off', () => {
    expect(getRecurringPlanActions('active', false, false)).toEqual({
      skip: false,
      pause: false,
      resume: false,
      reschedule: false,
      cancel: true,
    });
  });

  it('RP-12/RP-14/RP-18 exposes enabled actions only in the matching plan state', () => {
    expect(getRecurringPlanActions('active', true, true)).toEqual({
      skip: true,
      pause: true,
      resume: false,
      reschedule: true,
      cancel: true,
    });
    expect(getRecurringPlanActions('paused', true, true)).toEqual({
      skip: false,
      pause: false,
      resume: true,
      reschedule: false,
      cancel: true,
    });
  });

  it('RP-01 hides the plans filter when off but keeps it available to read existing plans', () => {
    expect(shouldShowRepeatPlansFilter(false, 0)).toBe(false);
    expect(shouldShowRepeatPlansFilter(false, 1)).toBe(true);
    expect(shouldShowRepeatPlansFilter(true, 0)).toBe(true);
    expect(shouldShowRepeatPlansFilter(false, 0, true)).toBe(true);
  });
});
