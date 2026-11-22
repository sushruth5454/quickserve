import {
  canShowProviderCalendar,
  canManageRecurringPlanContext,
  canRequestRecurringReschedule,
  canUsePlanAcceptance,
  canUseRecurringReschedule,
  findTimeOffVisits,
  firstRecurringDates,
  formatRecurrence,
  pendingProviderPlans,
  partitionProviderOccurrences,
  providerVisitSections,
  providerCalendarVisitRoute,
  providerCalendarRange,
  providerDateTimeIso,
  recurringPlanEarningsLabel,
} from '../providerPresentation';
import type { ProviderSchedule } from '../../../lib/onboarding';
import type { RecurringPlanPayload } from '../providerTypes';

const makePlan = (overrides: Partial<RecurringPlanPayload['plan']> = {}): RecurringPlanPayload => ({
  plan: {
    id: 'plan-1',
    customer_id: 'customer-1',
    provider_id: 'provider-1',
    provider_service_id: 'service-1',
    service_package_id: null,
    plan_version: 'v2',
    frequency: 'weekly',
    interval_count: 1,
    weekdays: [1, 3],
    month_day: null,
    custom_dates: [],
    start_time: '10:00',
    timezone: 'Asia/Kolkata',
    session_duration_min: 60,
    payment_mode: 'per_session',
    billing_frequency: 'per_visit',
    archetype: 'time_based',
    package_qty: null,
    per_visit_paise: null,
    net_estimate_paise: null,
    provider_acceptance: 'pending',
    acceptance_mode: 'plan',
    decided_at: null,
    decline_reason: null,
    paused_at: null,
    pause_until: null,
    address_line: '',
    city: '',
    lat: null,
    lng: null,
    description: '',
    starts_on: '2026-11-23',
    ends_on: null,
    generated_through: null,
    max_occurrences: null,
    occurrences_created: 0,
    status: 'active',
    created_at: '2026-11-18T00:00:00.000Z',
    updated_at: '2026-11-18T00:00:00.000Z',
    cancelled_at: null,
    ...overrides,
  },
  occurrences: [],
  changes: [],
});

test('calendar is hidden unless both effective runtime features are on', () => {
  expect(canShowProviderCalendar({ merchant_calendar: true, recurring_bookings: true })).toBe(true);
  expect(canShowProviderCalendar({ merchant_calendar: true, recurring_bookings: false })).toBe(false);
  expect(canShowProviderCalendar({ merchant_calendar: false, recurring_bookings: true })).toBe(false);
});

test('recurring child actions fail closed when their parent is off', () => {
  expect(canUsePlanAcceptance({ recurring_bookings: false, recurring_plan_acceptance: true })).toBe(false);
  expect(canUseRecurringReschedule({ recurring_bookings: false, recurring_reschedule: true })).toBe(false);
  expect(canUseRecurringReschedule({ recurring_bookings: true, recurring_reschedule: false })).toBe(false);
});

test('calendar ranges use provider-local day keys and Monday-based weeks', () => {
  expect(providerCalendarRange('2026-11-18', 'week', 0)).toEqual({
    from: '2026-11-16',
    to: '2026-11-22',
  });
  expect(providerCalendarRange('2026-11-18', 'day', 1)).toEqual({
    from: '2026-11-19',
    to: '2026-11-19',
  });
});

test('pending requests are scoped to the selected provider and active pending plans', () => {
  const pending = makePlan();
  const otherProvider = makePlan({ id: 'plan-2', provider_id: 'provider-2' });
  const accepted = makePlan({ id: 'plan-3', provider_acceptance: 'accepted' });

  expect(pendingProviderPlans([pending, otherProvider, accepted], 'provider-1')).toEqual([pending]);
});

test('provider management requires the plan provider, matching route hint, and owner or manager role', () => {
  expect(canManageRecurringPlanContext('provider-1', undefined, 'provider-1', 'owner')).toBe(true);
  expect(canManageRecurringPlanContext('provider-1', 'provider-1', 'provider-1', 'manager')).toBe(true);
  expect(canManageRecurringPlanContext('provider-1', 'provider-2', 'provider-2', 'manager')).toBe(false);
  expect(canManageRecurringPlanContext('provider-1', 'provider-1', 'provider-2', 'manager')).toBe(false);
  expect(canManageRecurringPlanContext('provider-1', 'provider-1', 'provider-1', 'staff')).toBe(false);
});

test('new reschedule requests use the server-projected cutoff and capability', () => {
  const occurrence = {
    can_request_reschedule: true,
    reschedule_cutoff_at: '2026-11-23T00:00:00.000Z',
  };
  expect(canRequestRecurringReschedule(occurrence, Date.parse('2026-11-22T00:00:00.000Z'))).toBe(true);
  expect(canRequestRecurringReschedule(occurrence, Date.parse('2026-11-23T00:00:00.000Z'))).toBe(false);
  expect(canRequestRecurringReschedule({ ...occurrence, can_request_reschedule: false }, Date.parse('2026-11-22T00:00:00.000Z'))).toBe(false);
});

test('occurrence partition is exhaustive and keeps every id exactly once by time and booking status', () => {
  const visits = [
    { id: 'future-open', scheduled_at: '2026-11-23T00:00:00.000Z', status: 'accepted' },
    { id: 'past-open', scheduled_at: '2026-11-21T00:00:00.000Z', status: 'requested' },
    { id: 'future-resolving', scheduled_at: '2026-11-24T00:00:00.000Z', status: 'in_progress' },
    { id: 'past-completed', scheduled_at: '2026-11-20T00:00:00.000Z', status: 'completed' },
    { id: 'future-expired', scheduled_at: '2026-11-25T00:00:00.000Z', status: 'expired' },
    { id: 'bad-time', scheduled_at: 'not-a-date', status: 'pending_payment' },
  ];
  const partition = partitionProviderOccurrences(visits, Date.parse('2026-11-22T00:00:00.000Z'));
  const flattened = [
    ...Object.values(partition.past).flat(),
    ...Object.values(partition.future).flat(),
    ...partition.invalidTime,
  ];

  expect(flattened.map((visit) => visit.id).sort()).toEqual(visits.map((visit) => visit.id).sort());
  expect(new Set(flattened.map((visit) => visit.id)).size).toBe(visits.length);
  expect(partition.future.terminal.map((visit) => visit.id)).toEqual(['future-expired']);
  expect(partition.past.actionable.map((visit) => visit.id)).toEqual(['past-open']);
  const sections = providerVisitSections(visits, Date.parse('2026-11-22T00:00:00.000Z'));
  const shown = [...sections.upcoming, ...sections.completed, ...sections.otherHistory];
  expect(shown.map((visit) => visit.id).sort()).toEqual(visits.map((visit) => visit.id).sort());
  expect(new Set(shown.map((visit) => visit.id)).size).toBe(visits.length);
});

test('weekly plan copy and first dates follow the shared recurrence rule', () => {
  const { plan } = makePlan();

  expect(formatRecurrence(plan)).toBe('Every week on Monday and Wednesday');
  expect(firstRecurringDates(plan)).toEqual(['2026-11-23', '2026-11-25', '2026-11-30']);
});

test('pending plan earnings show per-visit price and estimated provider net', () => {
  const { plan } = makePlan({ per_visit_paise: 60000, net_estimate_paise: 54336 });

  expect(recurringPlanEarningsLabel(plan)).toBe('₹600 per visit · you receive ≈₹543.36');
});

test('reschedule picker builds an ISO timestamp in the provider timezone', () => {
  expect(providerDateTimeIso('2026-11-25', 10, 'Asia/Kolkata')).toBe('2026-11-25T04:30:00.000Z');
  expect(providerDateTimeIso('2026-02-30', 10, 'Asia/Kolkata')).toBeNull();
});

test('calendar visit routing opens the actionable booking screen', () => {
  expect(providerCalendarVisitRoute('visit-1')).toEqual({
    pathname: '/booking/[id]',
    params: { id: 'visit-1' },
  });
});

test('holiday conflicts include only future open visits overlapping provider time off', () => {
  const plan = makePlan({
    provider_acceptance: 'accepted',
    starts_on: '2026-11-20',
  });
  plan.occurrences = [
    {
      id: 'visit-1',
      scheduled_at: '2026-11-20T04:30:00.000Z',
      service_window: '["2026-11-20 10:00:00+05:30","2026-11-20 11:00:00+05:30")',
      status: 'accepted',
      total_amount: 25000,
      archetype: 'time_based',
      service_package_id: null,
    },
    {
      id: 'visit-2',
      scheduled_at: '2026-11-21T04:30:00.000Z',
      service_window: '["2026-11-21 10:00:00+05:30","2026-11-21 11:00:00+05:30")',
      status: 'completed',
      total_amount: 25000,
      archetype: 'time_based',
      service_package_id: null,
    },
    {
      id: 'visit-3',
      scheduled_at: '2026-11-22T04:30:00.000Z',
      service_window: '["2026-11-22 10:00:00+05:30","2026-11-22 11:00:00+05:30")',
      status: 'accepted',
      total_amount: 25000,
      archetype: 'time_based',
      service_package_id: null,
    },
  ];
  const schedule: ProviderSchedule = {
    timezone: 'Asia/Kolkata',
    paused: false,
    max_jobs_per_day: null,
    slots: [],
    time_off: [{ from: '2026-11-20T04:45:00.000Z', to: '2026-11-20T05:30:00.000Z' }],
    full_days: [],
  };

  expect(findTimeOffVisits([plan], schedule, Date.parse('2026-11-18T00:00:00.000Z')).map(({ occurrence }) => occurrence.id))
    .toEqual(['visit-1']);
});
