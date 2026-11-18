jest.mock('../../../lib/adminApi', () => ({
  getAppFeatures: jest.fn(),
}));

jest.mock('../../../lib/supabase', () => ({
  supabase: { rpc: jest.fn() },
}));

import { getAppFeatures } from '../../../lib/adminApi';
import { supabase } from '../../../lib/supabase';
import { cancelRecurringPlan, createRecurringPlan, getRecurringPlan, quoteRecurringPlan } from '../api';
import type { RecurringPlanInput, RecurringPlanQuoteInput, RecurringQuote } from '../types';

const getFeaturesMock = getAppFeatures as jest.Mock;
const rpcMock = supabase.rpc as jest.Mock;

const features = {
  recurring_bookings: true,
  recurring_billing: true,
  recurring_prepaid_packages: true,
  recurring_plan_acceptance: true,
  recurring_skip_pause: true,
  recurring_reschedule: true,
};

const planInput: RecurringPlanInput = {
  provider_service_id: 'service-1',
  package_id: null,
  archetype: 'time_based',
  frequency: 'weekly',
  interval_count: 1,
  weekdays: [1, 2, 3, 4, 5, 6],
  month_day: null,
  custom_dates: [],
  start_date: '2026-12-07',
  end_date: null,
  max_occurrences: null,
  start_time: '08:00',
  duration_min: 60,
  package_qty: null,
  billing_frequency: 'per_visit',
  address_id: 'address-1',
  description: 'Weekly cleaning',
};

const quoteInput: RecurringPlanQuoteInput = {
  provider_service_id: planInput.provider_service_id,
  package_id: planInput.package_id,
  archetype: planInput.archetype,
  frequency: planInput.frequency,
  interval_count: planInput.interval_count,
  weekdays: planInput.weekdays,
  month_day: planInput.month_day,
  custom_dates: planInput.custom_dates,
  start_date: planInput.start_date,
  end_date: planInput.end_date,
  max_occurrences: planInput.max_occurrences,
  start_time: planInput.start_time,
  duration_min: planInput.duration_min,
  package_qty: planInput.package_qty,
  billing_frequency: planInput.billing_frequency,
  address_id: planInput.address_id,
};

const quote: RecurringQuote = {
  per_visit_paise: 25000,
  visits_in_first_cycle: 4,
  visits_total: null,
  discount_bp: 0,
  discount_paise: 0,
  platform_fee_paise: 0,
  gst_paise: 0,
  total_paise_per_cycle: 100000,
  billing_frequency: 'per_visit',
  first_dates: ['2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10'],
};

beforeEach(() => {
  jest.resetAllMocks();
  getFeaturesMock.mockResolvedValue(features);
});

test('quotes with the documented RPC and the §5.4 quote input keys', async () => {
  rpcMock.mockResolvedValue({ data: quote, error: null });

  await expect(quoteRecurringPlan(quoteInput)).resolves.toEqual(quote);
  expect(rpcMock).toHaveBeenCalledWith('quote_recurring_plan', { p: quoteInput });
});

test('creates a plan with the documented RPC and complete plan input', async () => {
  rpcMock.mockResolvedValue({ data: 'plan-1', error: null });

  await expect(createRecurringPlan(planInput)).resolves.toBe('plan-1');
  expect(rpcMock).toHaveBeenCalledWith('create_recurring_plan', { p: planInput });
});

test('fails closed without calling an RPC when recurring bookings are unavailable', async () => {
  getFeaturesMock.mockResolvedValue({
    recurring_bookings: false,
    recurring_billing: true,
  });

  await expect(quoteRecurringPlan(quoteInput)).rejects.toThrow('Recurring bookings are turned off');
  expect(rpcMock).not.toHaveBeenCalled();
});

test('allows per-visit plans when recurring billing is turned off', async () => {
  getFeaturesMock.mockResolvedValue({ recurring_bookings: true, recurring_billing: false });
  rpcMock.mockResolvedValue({ data: quote, error: null });

  await expect(quoteRecurringPlan(quoteInput)).resolves.toEqual(quote);
  expect(rpcMock).toHaveBeenCalledWith('quote_recurring_plan', { p: quoteInput });
});

test('fails closed for cycle billing when its child feature is off', async () => {
  getFeaturesMock.mockResolvedValue({ recurring_bookings: true, recurring_billing: false });

  await expect(quoteRecurringPlan({ ...quoteInput, billing_frequency: 'weekly' })).rejects.toThrow('Recurring billing is turned off');
  expect(rpcMock).not.toHaveBeenCalled();
});

test('fails closed for prepaid plans when their child feature is off', async () => {
  getFeaturesMock.mockResolvedValue({ recurring_bookings: true, recurring_prepaid_packages: false });

  await expect(quoteRecurringPlan({ ...quoteInput, billing_frequency: 'prepaid_package' }))
    .rejects.toThrow('Recurring prepaid packages are turned off');
  expect(rpcMock).not.toHaveBeenCalled();
});

test('does not send cycle or prepaid billing to B1 until the billing engine is integrated', async () => {
  getFeaturesMock.mockResolvedValue(features);

  await expect(quoteRecurringPlan({ ...quoteInput, billing_frequency: 'weekly' }))
    .rejects.toThrow('Recurring billing frequency is not available yet');
  await expect(createRecurringPlan({ ...planInput, billing_frequency: 'prepaid_package' }))
    .rejects.toThrow('Recurring billing frequency is not available yet');
  expect(rpcMock).not.toHaveBeenCalled();
});

test('keeps existing-plan reads and cancellation available when new plans are disabled', async () => {
  getFeaturesMock.mockResolvedValue({});
  rpcMock.mockResolvedValue({ data: null, error: null });

  await getRecurringPlan('plan-1');
  await cancelRecurringPlan('plan-1', 'No longer needed');

  expect(rpcMock).toHaveBeenNthCalledWith(1, 'get_recurring_plan', { p_id: 'plan-1' });
  expect(rpcMock).toHaveBeenNthCalledWith(2, 'cancel_recurring_plan', {
    p_id: 'plan-1',
    p_reason: 'No longer needed',
  });
});

test('does not call an RPC when the feature registry cannot be read', async () => {
  getFeaturesMock.mockRejectedValue(new Error('offline'));

  await expect(createRecurringPlan(planInput)).rejects.toThrow('offline');
  expect(rpcMock).not.toHaveBeenCalled();
});
