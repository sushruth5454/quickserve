import {
  getRecurringEndDateOptions,
  recurringFourWeekEstimate,
  visitPaymentLabel,
} from '../customerPresentation';

describe('customer recurring presentation', () => {
  it('shows a pending visit payment amount and the 24-hour release deadline', () => {
    expect(visitPaymentLabel({
      status: 'pending_payment',
      scheduled_at: '2026-11-25T04:30:00.000Z',
      total_amount: 62900,
    })).toBe('Pay ₹629 by 24 Nov, 10:00 am');
  });

  it('estimates four-week visits using the quoted per-visit amount', () => {
    expect(recurringFourWeekEstimate({
      firstDates: ['2026-12-01'],
      visitsInFirstCycle: 1,
      perVisitPaise: 60000,
      discountPaise: 0,
      platformFeePaise: 2900,
    }, {
      frequency: 'weekly',
      interval_count: 1,
      weekdays: [2],
      month_day: null,
      custom_dates: [],
      start_date: '2026-12-01',
      end_date: null,
      max_occurrences: null,
    })).toEqual({
      visits: 4,
      totalPaise: 251600,
      label: '≈4 visits / 4 weeks ≈ ₹2,516',
    });
  });

  it('offers calendar dates for plan end dates without accepting free-form input', () => {
    expect(getRecurringEndDateOptions('2026-11-28', 0)).toEqual({
      monthLabel: 'November 2026',
      dates: ['2026-11-28', '2026-11-29', '2026-11-30'],
    });
    expect(getRecurringEndDateOptions('2026-11-28', 1).dates[0]).toBe('2026-12-01');
  });
});
