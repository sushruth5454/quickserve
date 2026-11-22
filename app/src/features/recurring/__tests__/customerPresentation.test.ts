import {
  getRecurringPlanActions,
  getRecurringEndDateOptions,
  getRecurringQuoteSummary,
  partitionRecurringOccurrences,
  recurringFourWeekEstimate,
  resolvePendingRescheduleChanges,
  visitPaymentLabel,
} from '../customerPresentation';

describe('customer recurring presentation', () => {
  it('uses the server-projected due and expiry instants for a visit payment label', () => {
    expect(visitPaymentLabel({
      status: 'pending_payment',
      remaining_due_paise: 62900,
      payment_due_at: '2026-11-24T04:30:00.000Z',
      payment_expires_at: '2026-11-25T04:00:00.000Z',
      can_pay: true,
    })).toBe('Pay ₹629 by 24 Nov, 10:00 am · visit released 25 Nov, 9:30 am');
    expect(visitPaymentLabel({
      status: 'pending_payment',
      remaining_due_paise: 62900,
      payment_due_at: '2026-11-24T04:30:00.000Z',
      can_pay: false,
    })).toBeNull();
  });

  it('exposes only the server acceptance mode and payment-window summary', () => {
    expect(getRecurringQuoteSummary({
      per_visit_paise: 60000,
      visits_in_first_cycle: 1,
      visits_total: 4,
      discount_bp: 0,
      discount_paise: 0,
      platform_fee_paise: 2900,
      gst_paise: 0,
      total_paise_per_cycle: 62900,
      billing_frequency: 'per_visit',
      first_dates: ['2026-12-01'],
      acceptance_mode: 'occurrence',
      payment_window: {
        due_hours_before: 36,
        grace_hours: 8,
        release_cutoff_minutes_before_visit: 30,
      },
    })).toMatchObject({
      acceptanceMode: 'occurrence',
      paymentDueHoursBefore: 36,
      billingGraceHours: 8,
      paymentReleaseCutoffMinutesBeforeVisit: 30,
    });
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

  it('partitions visits by timestamp and actual status without dropping future-ended or past-open rows', () => {
    const partition = partitionRecurringOccurrences([
      { id: 'expired', scheduled_at: '2026-11-23T00:00:00.000Z', status: 'expired' },
      { id: 'past-open', scheduled_at: '2026-11-21T00:00:00.000Z', status: 'accepted' },
      { id: 'future-resolving', scheduled_at: '2026-11-24T00:00:00.000Z', status: 'in_progress' },
      { id: 'no-time', scheduled_at: 'invalid', status: 'requested' },
    ], Date.parse('2026-11-22T00:00:00.000Z'));

    expect(partition.future.terminal.map(({ id }) => id)).toEqual(['expired']);
    expect(partition.past.actionable.map(({ id }) => id)).toEqual(['past-open']);
    expect(partition.future.resolving.map(({ id }) => id)).toEqual(['future-resolving']);
    expect(partition.invalidTime.map(({ id }) => id)).toEqual(['no-time']);
  });

  it('does not let a requester respond to its own exact pending reschedule', () => {
    const change = {
      id: 'change-1',
      booking_id: 'visit-1',
      occurrence_date: '2026-11-24',
      original_at: '2026-11-24T04:30:00.000Z',
      kind: 'reschedule_requested',
      new_at: '2026-11-24T05:30:00.000Z',
      actor_id: 'customer-1',
    };

    expect(resolvePendingRescheduleChanges([change], 'customer-1', 'customer-1', 'customer'))
      .toEqual([{ change, requester: 'customer', canRespond: false }]);
    expect(resolvePendingRescheduleChanges([
      change,
      { ...change, id: 'outcome-1', kind: 'rescheduled' },
    ], 'customer-1', 'customer-1', 'customer')).toEqual([]);
  });

  it('uses owner, capability, acceptance, and the server skip cutoff for plan actions', () => {
    const actions = getRecurringPlanActions({
      plan: {
        customer_id: 'customer-1',
        status: 'active',
        provider_acceptance: 'accepted',
        acceptance_mode: 'occurrence',
        capabilities: {
          can_cancel: true,
          can_pause: true,
          can_resume: true,
          can_reschedule: true,
        },
      },
      actorId: 'customer-1',
      skipPauseEnabled: true,
      rescheduleEnabled: true,
      now: Date.parse('2026-11-22T00:00:00.000Z'),
      occurrences: [
        { id: 'expired', scheduled_at: '2026-11-23T00:00:00.000Z', status: 'expired', can_skip: true, skip_cutoff_at: '2026-11-22T23:00:00.000Z' },
        { id: 'past-cutoff', scheduled_at: '2026-11-23T00:00:00.000Z', status: 'accepted', can_skip: true, skip_cutoff_at: '2026-11-21T23:00:00.000Z' },
        { id: 'eligible', scheduled_at: '2026-11-24T00:00:00.000Z', status: 'requested', can_skip: true, skip_cutoff_at: '2026-11-23T12:00:00.000Z' },
      ],
      changes: [],
    });

    expect(actions).toMatchObject({
      skip: true,
      skipOccurrenceId: 'eligible',
      pause: true,
      resume: false,
      reschedule: false,
      cancel: true,
    });
  });

  it('hides Pause for a pending plan and denies controls to a non-customer actor', () => {
    const input = {
      plan: {
        customer_id: 'customer-1',
        status: 'active' as const,
        provider_acceptance: 'pending',
        acceptance_mode: 'plan',
        capabilities: { can_cancel: true, can_pause: true, can_resume: true, can_reschedule: true },
      },
      skipPauseEnabled: true,
      rescheduleEnabled: true,
      occurrences: [],
      changes: [],
    };

    expect(getRecurringPlanActions({ ...input, actorId: 'customer-1' }).pause).toBe(false);
    expect(getRecurringPlanActions({ ...input, actorId: 'other-user' })).toMatchObject({
      skip: false,
      pause: false,
      resume: false,
      reschedule: false,
      cancel: false,
    });
  });

  it('lets only the counterparty resolve pending reschedules, including paused and completed plans', () => {
    const request = {
      id: 'change-1',
      booking_id: 'visit-1',
      occurrence_date: '2026-11-24',
      original_at: '2026-11-24T04:30:00.000Z',
      kind: 'reschedule_requested',
      new_at: '2026-11-24T05:30:00.000Z',
      actor_id: 'provider-1',
    };
    const base = {
      plan: {
        customer_id: 'customer-1',
        status: 'paused' as const,
        provider_acceptance: 'accepted',
        acceptance_mode: 'plan',
        capabilities: { can_cancel: true, can_pause: false, can_resume: true, can_reschedule: true },
      },
      actorId: 'customer-1',
      skipPauseEnabled: true,
      rescheduleEnabled: true,
      occurrences: [],
      now: Date.parse('2026-11-22T00:00:00.000Z'),
    };

    expect(getRecurringPlanActions({ ...base, changes: [request] }).reschedule).toBe(true);
    expect(getRecurringPlanActions({
      ...base,
      plan: { ...base.plan, status: 'completed' },
      changes: [request],
    })).toMatchObject({ reschedule: true, cancel: true });
    expect(getRecurringPlanActions({
      ...base,
      changes: [{ ...request, actor_id: 'customer-1' }],
    }).reschedule).toBe(false);
  });
});
