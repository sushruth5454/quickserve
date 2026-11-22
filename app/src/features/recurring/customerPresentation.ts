import { formatINR } from '../../lib/money';
import { calculateRecurringDates } from './dates';
import type {
  BillingFrequency,
  PlanStatus,
  RecurringPlanCapabilities,
  RecurringPlanInput,
  RecurringQuote,
} from './types';

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
    acceptanceMode: quote.acceptance_mode === 'plan' || quote.acceptance_mode === 'occurrence'
      ? quote.acceptance_mode
      : null,
    paymentDueHoursBefore: Number.isSafeInteger(quote.payment_window?.due_hours_before) && quote.payment_window!.due_hours_before >= 0
      ? quote.payment_window!.due_hours_before
      : null,
    billingGraceHours: Number.isSafeInteger(quote.payment_window?.grace_hours) && quote.payment_window!.grace_hours >= 0
      ? quote.payment_window!.grace_hours
      : null,
    paymentReleaseCutoffMinutesBeforeVisit:
      Number.isSafeInteger(quote.payment_window?.release_cutoff_minutes_before_visit) &&
      quote.payment_window!.release_cutoff_minutes_before_visit >= 0
        ? quote.payment_window!.release_cutoff_minutes_before_visit
        : null,
  };
}

export function visitPaymentLabel(visit: {
  status: string;
  remaining_due_paise?: number | null;
  payment_due_at?: string | null;
  payment_expires_at?: string | null;
  can_pay?: boolean;
}, timezone = 'Asia/Kolkata'): string | null {
  if (
    visit.can_pay !== true ||
    typeof visit.remaining_due_paise !== 'number' ||
    !Number.isFinite(visit.remaining_due_paise) ||
    visit.remaining_due_paise <= 0 ||
    !visit.payment_due_at
  ) {
    return null;
  }
  const paymentDueAt = Date.parse(visit.payment_due_at);
  if (!Number.isFinite(paymentDueAt)) return null;
  try {
    const format = (instant: Date) => `${instant.toLocaleDateString('en-IN', {
      timeZone: timezone,
      day: 'numeric',
      month: 'short',
    })}, ${instant.toLocaleTimeString('en-IN', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
    })}`;
    const due = format(new Date(paymentDueAt));
    const paymentExpiresAt = visit.payment_expires_at ? Date.parse(visit.payment_expires_at) : Number.NaN;
    const expires = Number.isFinite(paymentExpiresAt)
      ? ` · visit released ${format(new Date(paymentExpiresAt))}`
      : '';
    return `Pay ${formatINR(visit.remaining_due_paise)} by ${due}${expires}`;
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
  skipOccurrenceId: string | null;
  pause: boolean;
  resume: boolean;
  reschedule: boolean;
  cancel: boolean;
};
type LegacyRecurringPlanActionVisibility = Omit<RecurringPlanActionVisibility, 'skipOccurrenceId'>;

export type RecurringOccurrenceLike = {
  id: string;
  scheduled_at: string;
  status: string;
};

type OccurrenceStatusGroup<T> = {
  actionable: T[];
  resolving: T[];
  completed: T[];
  terminal: T[];
  other: T[];
};

export type RecurringOccurrencePartition<T> = {
  past: OccurrenceStatusGroup<T>;
  future: OccurrenceStatusGroup<T>;
  invalidTime: T[];
};

const ACTIONABLE_OCCURRENCE_STATUSES = new Set([
  'pending_payment',
  'requested',
  'accepted',
  'confirmed',
]);
const SKIP_OCCURRENCE_STATUSES = new Set(['pending_payment', 'requested', 'accepted']);
const RESOLVING_OCCURRENCE_STATUSES = new Set([
  'en_route',
  'inspecting',
  'quote_sent',
  'awaiting_payment',
  'in_progress',
  'delivery_pending',
  'completion_requested',
  'disputed',
]);
const COMPLETED_OCCURRENCE_STATUSES = new Set(['completed', 'closed']);
const TERMINAL_OCCURRENCE_STATUSES = new Set([
  'cancelled',
  'declined',
  'expired',
  'refunded',
  'closed_no_work',
]);

function emptyOccurrenceGroup<T>(): OccurrenceStatusGroup<T> {
  return { actionable: [], resolving: [], completed: [], terminal: [], other: [] };
}

export function partitionRecurringOccurrences<T extends RecurringOccurrenceLike>(
  occurrences: readonly T[],
  now = Date.now(),
): RecurringOccurrencePartition<T> {
  const partition: RecurringOccurrencePartition<T> = {
    past: emptyOccurrenceGroup<T>(),
    future: emptyOccurrenceGroup<T>(),
    invalidTime: [],
  };
  for (const occurrence of occurrences) {
    const scheduledAt = Date.parse(occurrence.scheduled_at);
    if (!Number.isFinite(scheduledAt)) {
      partition.invalidTime.push(occurrence);
      continue;
    }
    const byTime = scheduledAt < now ? partition.past : partition.future;
    const byStatus = ACTIONABLE_OCCURRENCE_STATUSES.has(occurrence.status)
      ? byTime.actionable
      : RESOLVING_OCCURRENCE_STATUSES.has(occurrence.status)
        ? byTime.resolving
        : COMPLETED_OCCURRENCE_STATUSES.has(occurrence.status)
          ? byTime.completed
          : TERMINAL_OCCURRENCE_STATUSES.has(occurrence.status)
            ? byTime.terminal
            : byTime.other;
    byStatus.push(occurrence);
  }
  for (const group of [partition.past, partition.future]) {
    for (const statusGroup of Object.values(group)) {
      statusGroup.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at) || a.id.localeCompare(b.id));
    }
  }
  partition.invalidTime.sort((a, b) => a.id.localeCompare(b.id));
  return partition;
}

export function nextRecurringOccurrence<T extends RecurringOccurrenceLike>(
  occurrences: readonly T[],
  now = Date.now(),
): T | null {
  const partition = partitionRecurringOccurrences(occurrences, now);
  return [...partition.future.actionable, ...partition.future.resolving]
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at) || a.id.localeCompare(b.id))[0] ?? null;
}

export type RecurringRescheduleIdentity = {
  id: string;
  booking_id?: string | null;
  occurrence_date?: string | null;
  original_at?: string | null;
  kind: string;
  new_at?: string | null;
  actor_id?: string | null;
};

export type RescheduleActorRole = 'customer' | 'provider_manager' | 'other';

export function resolvePendingRescheduleChanges<T extends RecurringRescheduleIdentity>(
  changes: readonly T[],
  customerId: string,
  actorId: string | null,
  actorRole: RescheduleActorRole,
): Array<{ change: T; requester: 'customer' | 'provider' | 'unknown'; canRespond: boolean }> {
  return changes
    .filter((change) => {
      if (
        change.kind !== 'reschedule_requested' ||
        !change.booking_id ||
        !change.occurrence_date ||
        !change.original_at ||
        !change.new_at
      ) return false;
      return !changes.some((outcome) =>
        (outcome.kind === 'rescheduled' || outcome.kind === 'reschedule_declined') &&
        outcome.booking_id === change.booking_id &&
        outcome.occurrence_date === change.occurrence_date &&
        outcome.original_at === change.original_at &&
        outcome.new_at === change.new_at,
      );
    })
    .map((change) => {
      const requester = change.actor_id === customerId
        ? 'customer'
        : change.actor_id
          ? 'provider'
          : 'unknown';
      const canRespond = !!actorId &&
        change.actor_id !== actorId &&
        ((actorRole === 'customer' && actorId === customerId && requester === 'provider') ||
          (actorRole === 'provider_manager' && actorId !== customerId && requester === 'customer'));
      return { change, requester, canRespond };
    });
}

export type RecurringPlanActionInput = {
  plan: {
    customer_id: string;
    status: PlanStatus;
    provider_acceptance: string;
    acceptance_mode?: string;
    capabilities?: Partial<RecurringPlanCapabilities>;
  };
  actorId: string | null;
  skipPauseEnabled: boolean;
  rescheduleEnabled: boolean;
  occurrences: readonly (RecurringOccurrenceLike & {
    can_skip?: boolean;
    skip_cutoff_at?: string | null;
  })[];
  changes: readonly RecurringRescheduleIdentity[];
  now?: number;
};

export function getRecurringPlanActions(input: RecurringPlanActionInput): RecurringPlanActionVisibility;
export function getRecurringPlanActions(
  status: PlanStatus,
  skipPauseEnabled: boolean,
  rescheduleEnabled: boolean,
): LegacyRecurringPlanActionVisibility;
/** Status-only compatibility is retained for existing summaries; action screens use the actor-aware input. */
export function getRecurringPlanActions(
  input: RecurringPlanActionInput | PlanStatus,
  skipPauseEnabled = false,
  rescheduleEnabled = false,
): RecurringPlanActionVisibility | LegacyRecurringPlanActionVisibility {
  if (typeof input === 'string') {
    return {
      skip: input === 'active' && skipPauseEnabled,
      pause: input === 'active' && skipPauseEnabled,
      resume: input === 'paused' && skipPauseEnabled,
      reschedule: input === 'active' && rescheduleEnabled,
      cancel: input === 'active' || input === 'paused',
    };
  }
  const { plan, actorId } = input;
  skipPauseEnabled = input.skipPauseEnabled;
  rescheduleEnabled = input.rescheduleEnabled;
  const now = input.now ?? Date.now();
  const isCustomer = !!actorId && actorId === plan.customer_id;
  const capabilities = plan.capabilities ?? {};
  const pendingPlan = plan.acceptance_mode === 'plan' && plan.provider_acceptance === 'pending';
  const partition = partitionRecurringOccurrences(input.occurrences, now);
  const skipOccurrenceId = isCustomer && skipPauseEnabled
    ? partition.future.actionable.find((visit) => {
        if (!SKIP_OCCURRENCE_STATUSES.has(visit.status) || visit.can_skip !== true || !visit.skip_cutoff_at) {
          return false;
        }
        const cutoff = Date.parse(visit.skip_cutoff_at);
        return Number.isFinite(cutoff) && cutoff > now;
      })?.id ?? null
    : null;
  const canRespondToReschedule = resolvePendingRescheduleChanges(
    input.changes,
    plan.customer_id,
    actorId,
    'customer',
  ).some((request) => request.canRespond);
  return {
    skip: skipOccurrenceId !== null,
    skipOccurrenceId,
    pause: isCustomer && !pendingPlan && plan.status === 'active' &&
      capabilities.can_pause === true && skipPauseEnabled,
    resume: isCustomer && plan.status === 'paused' &&
      capabilities.can_resume === true && skipPauseEnabled,
    reschedule: isCustomer && capabilities.can_reschedule === true &&
      rescheduleEnabled && canRespondToReschedule,
    cancel: isCustomer && capabilities.can_cancel === true,
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
