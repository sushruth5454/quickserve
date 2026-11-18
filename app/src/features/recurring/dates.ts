import type { RecurringPlanInput } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DATE_EPOCH = Date.parse('9999-12-31T00:00:00.000Z');

export type RecurrenceDateInput = Pick<
  RecurringPlanInput,
  'frequency' | 'interval_count' | 'weekdays' | 'month_day' | 'custom_dates' | 'start_date' | 'end_date'
>;

export interface RecurrenceDateRange {
  from: string;
  through: string;
  maxPlanDays: number;
}

function parseDate(value: string, field: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1) {
    throw new RangeError(`${field} must be a valid YYYY-MM-DD date`);
  }

  const epoch = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString().slice(0, 10) !== value) {
    throw new RangeError(`${field} must be a valid YYYY-MM-DD date`);
  }

  return epoch;
}

function isoWeekday(epoch: number): number {
  const weekday = new Date(epoch).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function assertRuleIsValid(input: RecurrenceDateInput, startEpoch: number): void {
  if (!Number.isInteger(input.interval_count) || input.interval_count < 1 || input.interval_count > 12) {
    throw new RangeError('interval_count must be an integer from 1 through 12');
  }

  if (input.frequency === 'weekly') {
    if (input.weekdays.length < 1 || input.weekdays.length > 7 || input.weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) {
      throw new RangeError('weekly recurrence requires ISO weekdays from 1 through 7');
    }
  }

  if (input.frequency === 'monthly' && (!Number.isInteger(input.month_day) || input.month_day! < 1 || input.month_day! > 28)) {
    throw new RangeError('monthly recurrence requires a month day from 1 through 28');
  }

  if (input.frequency === 'custom') {
    if (input.custom_dates.length < 1 || input.custom_dates.length > 120) {
      throw new RangeError('custom recurrence requires between 1 and 120 dates');
    }
    for (const [index, date] of input.custom_dates.entries()) {
      if (parseDate(date, `custom_dates[${index}]`) < startEpoch) {
        throw new RangeError('custom recurrence dates must be on or after start_date');
      }
    }
  }
}

function matchesRule(epoch: number, input: RecurrenceDateInput, startEpoch: number): boolean {
  switch (input.frequency) {
    case 'daily':
      return true;
    case 'alternate_days':
      return ((epoch - startEpoch) / DAY_MS) % 2 === 0;
    case 'weekly': {
      const startWeekEpoch = startEpoch - (isoWeekday(startEpoch) - 1) * DAY_MS;
      const weeksSinceStart = Math.floor((epoch - startWeekEpoch) / (7 * DAY_MS));
      return input.weekdays.includes(isoWeekday(epoch)) && weeksSinceStart % input.interval_count === 0;
    }
    case 'monthly': {
      const start = new Date(startEpoch);
      const candidate = new Date(epoch);
      const monthsSinceStart = (candidate.getUTCFullYear() - start.getUTCFullYear()) * 12
        + candidate.getUTCMonth() - start.getUTCMonth();
      return candidate.getUTCDate() === input.month_day
        && monthsSinceStart >= 0
        && monthsSinceStart % input.interval_count === 0;
    }
    case 'custom':
      return input.custom_dates.includes(new Date(epoch).toISOString().slice(0, 10));
  }
  return false;
}

export function calculateRecurringDates(
  input: RecurrenceDateInput,
  range: RecurrenceDateRange,
): string[] {
  const startEpoch = parseDate(input.start_date, 'start_date');
  const fromEpoch = parseDate(range.from, 'from');
  const throughEpoch = parseDate(range.through, 'through');
  if (!Number.isSafeInteger(range.maxPlanDays) || range.maxPlanDays < 0) {
    throw new RangeError('maxPlanDays must be a non-negative integer');
  }

  const endEpoch = input.end_date === null ? MAX_DATE_EPOCH : parseDate(input.end_date, 'end_date');
  if (endEpoch < startEpoch) {
    throw new RangeError('end_date must be on or after start_date');
  }
  assertRuleIsValid(input, startEpoch);

  const planEndEpoch = Math.min(endEpoch, startEpoch + range.maxPlanDays * DAY_MS, MAX_DATE_EPOCH);
  const firstEpoch = Math.max(startEpoch, fromEpoch);
  const lastEpoch = Math.min(throughEpoch, planEndEpoch);
  if (firstEpoch > lastEpoch) return [];

  const dates: string[] = [];
  for (let epoch = firstEpoch; epoch <= lastEpoch; epoch += DAY_MS) {
    if (matchesRule(epoch, input, startEpoch)) {
      dates.push(new Date(epoch).toISOString().slice(0, 10));
    }
  }
  return dates;
}
