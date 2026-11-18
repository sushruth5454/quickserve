import { isFeatureOn } from '../../lib/featureFlagModel';
import type { ProviderSchedule } from '../../lib/onboarding';
import { calculateRecurringDates } from './dates';
import type { RecurringPlanPayload } from './providerTypes';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const OPEN_VISIT_STATUSES = new Set(['pending_payment', 'requested', 'accepted', 'confirmed']);
const DAY_MS = 24 * 60 * 60 * 1000;

export function canShowProviderCalendar(features: Record<string, unknown>): boolean {
  return isFeatureOn(features, 'merchant_calendar') && isFeatureOn(features, 'recurring_bookings');
}

export function canUsePlanAcceptance(features: Record<string, unknown>): boolean {
  return isFeatureOn(features, 'recurring_plan_acceptance');
}

export function canUseRecurringReschedule(features: Record<string, unknown>): boolean {
  return isFeatureOn(features, 'recurring_reschedule');
}

export function pendingProviderPlans(
  plans: RecurringPlanPayload[],
  providerId: string,
): RecurringPlanPayload[] {
  return plans.filter(({ plan }) =>
    plan.provider_id === providerId &&
    plan.status === 'active' &&
    plan.acceptance_mode === 'plan' &&
    plan.provider_acceptance === 'pending',
  );
}

function ordinal(day: number): string {
  const suffix = day % 100 >= 11 && day % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th';
  return `${day}${suffix}`;
}

export function formatRecurrence(plan: RecurringPlanPayload['plan']): string {
  const interval = Math.max(1, plan.interval_count);
  switch (plan.frequency) {
    case 'daily':
      return interval === 1 ? 'Every day' : `Every ${interval} days`;
    case 'alternate_days':
      return 'Every other day';
    case 'weekly': {
      const days = plan.weekdays
        .slice()
        .sort((a, b) => a - b)
        .map((day) => WEEKDAYS[day - 1])
        .filter((day): day is string => !!day);
      const cadence = interval === 1 ? 'Every week' : `Every ${interval} weeks`;
      return days.length ? `${cadence} on ${days.join(', ').replace(/, ([^,]+)$/, ' and $1')}` : cadence;
    }
    case 'monthly':
      return `Every ${interval === 1 ? 'month' : `${interval} months`} on the ${ordinal(plan.month_day ?? 1)}`;
    case 'custom':
      return plan.custom_dates.length
        ? `On ${plan.custom_dates.slice(0, 3).join(', ')}${plan.custom_dates.length > 3 ? ` and ${plan.custom_dates.length - 3} more dates` : ''}`
        : 'Custom dates';
  }
}

function addDays(dateKey: string, days: number): string {
  return new Date(Date.parse(`${dateKey}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function firstRecurringDates(plan: RecurringPlanPayload['plan']): string[] {
  const through = plan.ends_on ?? addDays(plan.starts_on, 365);
  try {
    return calculateRecurringDates(
      {
        frequency: plan.frequency,
        interval_count: plan.interval_count,
        weekdays: plan.weekdays,
        month_day: plan.month_day,
        custom_dates: plan.custom_dates,
        start_date: plan.starts_on,
        end_date: plan.ends_on,
      },
      { from: plan.starts_on, through, maxPlanDays: 365 },
    ).slice(0, 3);
  } catch {
    return [];
  }
}

export function providerDateKey(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function shiftDateKey(dateKey: string, days: number): string {
  return addDays(dateKey, days);
}

export function providerCalendarRange(
  today: string,
  mode: 'day' | 'week',
  offset: number,
): { from: string; to: string } {
  if (mode === 'day') {
    const date = shiftDateKey(today, offset);
    return { from: date, to: date };
  }
  const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const start = shiftDateKey(today, mondayOffset + offset * 7);
  return { from: start, to: shiftDateKey(start, 6) };
}

function rangeBounds(value: string | null): { start: number; end: number } | null {
  if (!value) return null;
  const comma = value.indexOf(',');
  if (comma < 0) return null;
  const strip = (part: string) => part.trim().replace(/^[[(]\s*/, '').replace(/^"/, '').replace(/["')\]]+$/, '');
  const parse = (part: string) => Date.parse(strip(part).replace(' ', 'T'));
  const start = parse(value.slice(0, comma));
  const end = parse(value.slice(comma + 1));
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null;
}

export function findTimeOffVisits(
  plans: RecurringPlanPayload[],
  schedule: ProviderSchedule | null,
  now = Date.now(),
): Array<{ plan: RecurringPlanPayload['plan']; occurrence: RecurringPlanPayload['occurrences'][number] }> {
  if (!schedule) return [];
  const timeOff = schedule.time_off
    .map((period) => ({ start: Date.parse(period.from), end: Date.parse(period.to) }))
    .filter((period) => Number.isFinite(period.start) && Number.isFinite(period.end) && period.end > period.start);
  if (!schedule.paused && timeOff.length === 0) return [];

  return plans.flatMap(({ plan, occurrences }) => occurrences
    .filter((occurrence) => {
      const start = Date.parse(occurrence.scheduled_at);
      if (!Number.isFinite(start) || start <= now || !OPEN_VISIT_STATUSES.has(occurrence.status)) return false;
      if (schedule.paused) return true;

      const bounds = rangeBounds(occurrence.service_window);
      const end = bounds?.end ?? start + Math.max(1, plan.session_duration_min ?? 60) * 60_000;
      const windowStart = bounds?.start ?? start;
      return timeOff.some((period) => windowStart < period.end && period.start < end);
    })
    .map((occurrence) => ({ plan, occurrence })));
}
