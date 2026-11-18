import type { BillingFrequency, PlanStatus, RecurringQuote } from './types';

export type BookingModeOption = 'one-time' | 'repeat';
export type FixedBookingModeOption = 'one-time' | 'repeat';

export function getBookingModeOptions(
  recurringEnabled: boolean,
  recurrenceAllowed: boolean,
  archetype: string | null | undefined,
): BookingModeOption[] {
  return recurringEnabled && recurrenceAllowed && (archetype === 'time_based' || archetype === 'fixed')
    ? ['one-time', 'repeat']
    : ['one-time'];
}

export function getFixedBookingModeOptions(
  recurringEnabled: boolean,
  recurrenceAllowed: boolean,
): FixedBookingModeOption[] {
  return recurringEnabled && recurrenceAllowed ? ['one-time', 'repeat'] : ['one-time'];
}

export function visibleBillingFrequencies(configured: readonly BillingFrequency[]): BillingFrequency[] {
  return configured.includes('per_visit') ? ['per_visit'] : [];
}

export function getRecurringQuoteSummary(quote: RecurringQuote) {
  return {
    perVisitPaise: quote.per_visit_paise,
    visitsInFirstCycle: quote.visits_in_first_cycle,
    visitsTotal: quote.visits_total,
    discountPaise: quote.discount_paise,
    platformFeePaise: quote.platform_fee_paise,
    gstPaise: quote.gst_paise,
    totalPaisePerCycle: quote.total_paise_per_cycle,
    billingFrequency: quote.billing_frequency,
    firstDates: quote.first_dates.slice(0, 5),
  };
}

export type RecurringPlanActionVisibility = {
  skip: boolean;
  pause: boolean;
  resume: boolean;
  reschedule: boolean;
  cancel: boolean;
};

export function getRecurringPlanActions(
  status: PlanStatus,
  skipPauseEnabled: boolean,
  rescheduleEnabled: boolean,
): RecurringPlanActionVisibility {
  return {
    skip: status === 'active' && skipPauseEnabled,
    pause: status === 'active' && skipPauseEnabled,
    resume: status === 'paused' && skipPauseEnabled,
    reschedule: status === 'active' && rescheduleEnabled,
    cancel: status === 'active' || status === 'paused',
  };
}

export function shouldShowRepeatPlansFilter(
  recurringEnabled: boolean,
  existingPlanCount: number,
  planLookupPendingOrFailed = false,
): boolean {
  // Keep the plan filter visible while lookup is pending or failed.
  return recurringEnabled || existingPlanCount > 0 || planLookupPendingOrFailed;
}
