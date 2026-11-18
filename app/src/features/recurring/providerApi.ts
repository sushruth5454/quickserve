import { getAppFeatures } from '../../lib/adminApi';
import { isFeatureOn } from '../../lib/featureFlagModel';
import { supabase } from '../../lib/supabase';
import type { ProviderRecurringScheduleItem, RecurringPlanPayload } from './providerTypes';

type SupabaseResult<T> = { data?: T | null; error: { message: string } | null };
const FEATURE_ERRORS: Record<string, string> = {
  merchant_calendar: 'Merchant calendar is turned off right now.',
  recurring_bookings: 'Recurring bookings are turned off right now.',
  recurring_plan_acceptance: 'Recurring plan acceptance is turned off right now.',
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
  if (disabled) throw new Error(FEATURE_ERRORS[disabled] ?? 'This provider capability is turned off right now.');
}

export async function listProviderRecurringPlans(): Promise<RecurringPlanPayload[]> {
  return rpc<RecurringPlanPayload[]>('list_my_recurring_plans');
}

export async function getProviderRecurringPlan(id: string): Promise<RecurringPlanPayload> {
  return rpc<RecurringPlanPayload>('get_recurring_plan', { p_id: id });
}

export async function respondRecurringPlan(
  id: string,
  accept: boolean,
  reason: string,
): Promise<unknown> {
  await requireFeatures('recurring_bookings', 'recurring_plan_acceptance');
  return rpc('respond_recurring_plan', { p_id: id, p_accept: accept, p_reason: reason });
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

export async function listProviderRecurringSchedule(
  providerId: string,
  from: string,
  to: string,
): Promise<ProviderRecurringScheduleItem[]> {
  await requireFeatures('merchant_calendar', 'recurring_bookings');
  return rpc<ProviderRecurringScheduleItem[]>('list_provider_recurring_schedule', {
    p_provider_id: providerId,
    p_from: from,
    p_to: to,
  });
}
