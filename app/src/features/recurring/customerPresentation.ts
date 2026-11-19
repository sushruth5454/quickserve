import { formatINR } from '../../lib/money';
import { calculateRecurringDates } from './dates';
import type { BillingFrequency, PlanStatus, RecurringPlanInput, RecurringQuote } from './types';

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

export function visitPaymentLabel(visit: {
  status: string;
  scheduled_at: string;
  total_amount?: number | null;
}, timezone = 'Asia/Kolkata'): string | null {
  if (
    visit.status !== 'pending_payment' ||
    typeof visit.total_amount !== 'number' ||
    !Number.isFinite(visit.total_amount)
  ) {
    return null;
  }
  const scheduledAt = Date.parse(visit.scheduled_at);
  if (!Number.isFinite(scheduledAt)) return null;
  const deadline = new Date(scheduledAt - 24 * 60 * 60 * 1000);
  try {
    const deadlineDate = deadline.toLocaleDateString('en-IN', {
      timeZone: timezone,
      day: 'numeric',
      month: 'short',
    });
    const deadlineTime = deadline.toLocaleTimeString('en-IN', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
    });
    return `Pay ${formatINR(visit.total_amount)} by ${deadlineDate}, ${deadlineTime}`;
  } catch {
    return null;
  }
}

export function recurringFourWeekEstimate(
  quote: {
    firstDates: string[];
    visitsInFirstCycle: number;
    perVisitPaise: number;
    discountPaise: number;
    platformFeePaise: number;
  },
  schedule: Pick<
    RecurringPlanInput,
    'frequency' | 'interval_count' | 'weekdays' | 'month_day' | 'custom_dates' | 'start_date' | 'end_date' | 'max_occurrences'
  >,
): { visits: number; totalPaise: number; label: string } | null {
  if (
    quote.firstDates.length === 0 ||
    !Number.isInteger(quote.visitsInFirstCycle) ||
    quote.visitsInFirstCycle < 1 ||
    !Number.isFinite(quote.perVisitPaise) ||
    !Number.isFinite(quote.discountPaise) ||
    !Number.isFinite(quote.platformFeePaise)
  ) {
    return null;
  }
  const firstDate = quote.firstDates[0]!;
  const firstEpoch = Date.parse(`${firstDate}T00:00:00.000Z`);
  const startEpoch = Date.parse(`${schedule.start_date}T00:00:00.000Z`);
  if (!Number.isFinite(firstEpoch) || !Number.isFinite(startEpoch)) return null;
  const through = new Date(firstEpoch + 27 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let dates: string[];
  try {
    dates = calculateRecurringDates(
      schedule,
      {
        from: firstDate,
        through,
        maxPlanDays: Math.max(0, Math.ceil((Date.parse(`${through}T00:00:00.000Z`) - startEpoch) / (24 * 60 * 60 * 1000))),
      },
    );
  } catch {
    return null;
  }
  const visits = Math.min(dates.length, schedule.max_occurrences ?? dates.length);
  if (visits < 1) return null;
  const perVisitTotal = quote.perVisitPaise
    - quote.discountPaise / quote.visitsInFirstCycle
    + quote.platformFeePaise / quote.visitsInFirstCycle;
  const totalPaise = Math.max(0, Math.round(perVisitTotal * visits));
  return {
    visits,
    totalPaise,
    label: `≈${visits} visits / 4 weeks ≈ ${formatINR(totalPaise)}`,
  };
}

export function getRecurringEndDateOptions(
  startDate: string,
  monthOffset = 0,
): { monthLabel: string; dates: string[] } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !Number.isInteger(monthOffset) || monthOffset < 0) {
    return { monthLabel: '', dates: [] };
  }
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  if (!Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== startDate) {
    return { monthLabel: '', dates: [] };
  }
  const parts = startDate.split('-').map(Number);
  const monthStart = new Date(Date.UTC(parts[0]!, parts[1]! - 1 + monthOffset, 1));
  const year = monthStart.getUTCFullYear();
  const month = monthStart.getUTCMonth();
  const monthLabel = monthStart.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  });
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const dates = Array.from({ length: daysInMonth }, (_, index) =>
    new Date(Date.UTC(year, month, index + 1)).toISOString().slice(0, 10),
  ).filter((date) => Date.parse(`${date}T00:00:00.000Z`) >= start);
  return { monthLabel, dates };
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
