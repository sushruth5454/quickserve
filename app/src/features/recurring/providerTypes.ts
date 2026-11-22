import type { RecurringOccurrenceProjection, RecurringPlanCapabilities } from './types';

export type ProviderFrequency = 'daily' | 'alternate_days' | 'weekly' | 'monthly' | 'custom';
export type ProviderBillingFrequency = 'per_visit' | 'weekly' | 'monthly' | 'prepaid_package';
export type ProviderPlanStatus = 'active' | 'paused' | 'cancelled' | 'completed';

export interface RecurringPlanRecord {
  id: string;
  customer_id: string;
  provider_id: string;
  provider_service_id: string;
  service_package_id: string | null;
  plan_version: string;
  frequency: ProviderFrequency;
  interval_count: number;
  weekdays: number[];
  month_day: number | null;
  custom_dates: string[];
  start_time: string;
  timezone: string;
  session_duration_min: number | null;
  payment_mode: string;
  billing_frequency: ProviderBillingFrequency;
  archetype: 'time_based' | 'fixed';
  package_qty: number | null;
  per_visit_paise: number | null;
  net_estimate_paise: number | null;
  provider_acceptance: 'pending' | 'accepted' | 'declined';
  acceptance_mode: 'plan' | 'occurrence';
  decided_at: string | null;
  decline_reason: string | null;
  paused_at: string | null;
  pause_until: string | null;
  address_line: string;
  city: string;
  lat: number | null;
  lng: number | null;
  description: string;
  starts_on: string;
  ends_on: string | null;
  generated_through: string | null;
  max_occurrences: number | null;
  occurrences_created: number;
  status: ProviderPlanStatus;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  capabilities?: Partial<RecurringPlanCapabilities>;
}

export interface RecurringOccurrence extends RecurringOccurrenceProjection {
  id: string;
  scheduled_at: string;
  service_window: string | null;
  status: string;
  total_amount: number | null;
  archetype: string;
  service_package_id: string | null;
}

export interface RecurringOccurrenceChange {
  id: string;
  booking_id: string | null;
  occurrence_date: string;
  original_at: string;
  kind: string;
  new_at: string | null;
  actor_id: string | null;
  reason: string | null;
  created_at: string;
}

export interface RecurringPlanPayload {
  plan: RecurringPlanRecord;
  occurrences: RecurringOccurrence[];
  changes: RecurringOccurrenceChange[];
}

export interface ProviderRecurringScheduleItem {
  id: string;
  recurring_schedule_id: string;
  scheduled_at: string;
  service_window: string | null;
  status: string;
  total_amount: number | null;
  customer_id: string;
  provider_service_id: string;
  service_package_id: string | null;
  service_name: string;
  archetype: string;
  frequency: ProviderFrequency;
}
