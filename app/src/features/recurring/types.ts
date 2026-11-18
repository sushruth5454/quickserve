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

export type RecurringPlanQuoteInput = Omit<RecurringPlanInput, 'address_id' | 'description'>;

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
