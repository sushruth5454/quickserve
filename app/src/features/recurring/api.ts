import { getAppFeatures } from '../../lib/adminApi';
import { isFeatureOn } from '../../lib/featureFlagModel';
import { supabase } from '../../lib/supabase';
import type {
  RecurringPlanInput,
  RecurringPlanQuoteInput,
  RecurringQuote,
} from './types';

type SupabaseResult<T> = { data?: T | null; error: { message: string } | null };
const FEATURE_ERRORS: Record<string, string> = {
  recurring_bookings: 'Recurring bookings are turned off right now.',
  recurring_billing: 'Recurring billing is turned off right now.',
  recurring_prepaid_packages: 'Recurring prepaid packages are turned off right now.',
  recurring_plan_acceptance: 'Recurring plan acceptance is turned off right now.',
  recurring_skip_pause: 'Recurring skip and pause are turned off right now.',
  recurring_reschedule: 'Recurring rescheduling is turned off right now.',
};

async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = (await supabase.rpc(name, args)) as SupabaseResult<T>;
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

async function requireFeatures(...keys: string[]): Promise<void> {
  const features = await getAppFeatures();
  const disabled = keys.find((key) => !isFeatureOn(features, key));
  if (disabled) {
    throw new Error(FEATURE_ERRORS[disabled] ?? 'This recurring capability is turned off right now.');
  }
}

async function requirePlanFeatures(input: Pick<RecurringPlanInput, 'billing_frequency'>): Promise<void> {
  const keys = ['recurring_bookings'];
  if (input.billing_frequency === 'weekly' || input.billing_frequency === 'monthly') {
    keys.push('recurring_billing');
  } else if (input.billing_frequency === 'prepaid_package') {
    keys.push('recurring_prepaid_packages');
  }
  await requireFeatures(...keys);
  if (input.billing_frequency !== 'per_visit') {
    throw new Error('Recurring billing frequency is not available yet.');
  }
}

export async function quoteRecurringPlan(input: RecurringPlanQuoteInput): Promise<RecurringQuote> {
  await requirePlanFeatures(input);
  return rpc<RecurringQuote>('quote_recurring_plan', { p: input });
}

export async function createRecurringPlan(input: RecurringPlanInput): Promise<string> {
  await requirePlanFeatures(input);
  return rpc<string>('create_recurring_plan', { p: input });
}

export async function respondRecurringPlan(
  id: string,
  accept: boolean,
  reason: string,
): Promise<unknown> {
  await requireFeatures('recurring_bookings', 'recurring_plan_acceptance');
  return rpc('respond_recurring_plan', { p_id: id, p_accept: accept, p_reason: reason });
}

export async function pauseRecurringPlan(id: string, until: string | null = null): Promise<unknown> {
  await requireFeatures('recurring_skip_pause');
  return rpc('pause_recurring_plan', { p_id: id, p_until: until });
}

export async function resumeRecurringPlan(id: string): Promise<unknown> {
  await requireFeatures('recurring_skip_pause');
  return rpc('resume_recurring_plan', { p_id: id });
}

export async function skipRecurringVisit(bookingId: string, reason = ''): Promise<unknown> {
  await requireFeatures('recurring_skip_pause');
  return rpc('skip_recurring_visit', { p_booking_id: bookingId, p_reason: reason });
}

export async function cancelRecurringPlan(id: string, reason: string): Promise<unknown> {
  return rpc('cancel_recurring_plan', { p_id: id, p_reason: reason });
}

export async function requestVisitReschedule(
  bookingId: string,
  newAt: string,
  reason: string,
): Promise<unknown> {
  await requireFeatures('recurring_reschedule');
  return rpc('request_visit_reschedule', {
    p_booking_id: bookingId,
    p_new_at: newAt,
    p_reason: reason,
  });
}

export async function respondVisitReschedule(changeId: string, accept: boolean): Promise<unknown> {
  await requireFeatures('recurring_reschedule');
  return rpc('respond_visit_reschedule', { p_change_id: changeId, p_accept: accept });
}

export async function reportProviderAbsence(bookingId: string, reason: string): Promise<unknown> {
  return rpc('report_provider_absence', { p_booking_id: bookingId, p_reason: reason });
}

export async function listMyRecurringPlans(): Promise<unknown> {
  return rpc('list_my_recurring_plans');
}

export async function getRecurringPlan(id: string): Promise<unknown> {
  return rpc('get_recurring_plan', { p_id: id });
}

export async function listProviderRecurringSchedule(
  providerId: string,
  from: string,
  to: string,
): Promise<unknown> {
  return rpc('list_provider_recurring_schedule', {
    p_provider_id: providerId,
    p_from: from,
    p_to: to,
  });
}
