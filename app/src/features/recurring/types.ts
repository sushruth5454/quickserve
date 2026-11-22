export type Frequency = 'daily' | 'alternate_days' | 'weekly' | 'monthly' | 'custom';

export type BillingFrequency = 'per_visit' | 'weekly' | 'monthly' | 'prepaid_package';

export interface RecurringPlanInput {
  provider_service_id: string;
  package_id: string | null;
  archetype: 'time_based' | 'fixed';
  frequency: Frequency;
  interval_count: number;
  weekdays: number[];
  month_day: number | null;
  custom_dates: string[];
  start_date: string;
  end_date: string | null;
  max_occurrences: number | null;
  start_time: string;
  duration_min: number | null;
  package_qty: number | null;
  billing_frequency: BillingFrequency;
  address_id: string;
  description: string;
}

export type RecurringPlanQuoteInput = Omit<RecurringPlanInput, 'description'>;

export interface RecurringPaymentWindowSummary {
  due_hours_before: number;
  grace_hours: number;
  release_cutoff_minutes_before_visit: number;
}

export interface RecurringQuote {
  per_visit_paise: number;
  visits_in_first_cycle: number;
  visits_total: number | null;
  discount_bp: number;
  discount_paise: number;
  platform_fee_paise: number;
  gst_paise: number;
  total_paise_per_cycle: number;
  billing_frequency: BillingFrequency;
  first_dates: string[];
  acceptance_mode?: 'plan' | 'occurrence';
  payment_window?: RecurringPaymentWindowSummary;
}

export interface RecurringPlanCapabilities {
  can_cancel: boolean;
  can_pause: boolean;
  can_resume: boolean;
  can_reschedule: boolean;
}

export interface RecurringOccurrenceProjection {
  remaining_due_paise?: number | null;
  payment_due_at?: string | null;
  payment_expires_at?: string | null;
  can_pay?: boolean;
  can_skip?: boolean;
  skip_cutoff_at?: string | null;
  can_request_reschedule?: boolean;
  reschedule_cutoff_at?: string | null;
}

export type PlanStatus = 'active' | 'paused' | 'cancelled' | 'completed';

export type ChangeKind =
  | 'skipped'
  | 'provider_unavailable'
  | 'reschedule_requested'
  | 'rescheduled'
  | 'reschedule_declined'
  | 'provider_absent'
  | 'cancelled';
