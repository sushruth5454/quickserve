import type { Frequency, PlanStatus } from '../recurring/types';
import { nextRecurringOccurrence } from '../recurring/customerPresentation';

export interface ActivityUnreadCounts {
  services: number;
  requests: number;
  shop: number;
  sports: number;
}

export type ActivitySegment = 'services' | 'requests' | 'shop' | 'sports';

export interface ActivityFeatureVisibility {
  products: boolean;
  sports: boolean;
  hasSportsBookings?: boolean;
}

export type ActivityPlanSummary = {
  plan: {
    id: string;
    status: PlanStatus;
    provider_acceptance: string;
    frequency?: Frequency;
    weekdays?: number[];
  };
  occurrences: { id: string; scheduled_at: string; status: string }[];
};

export { bookAgainRoute as bookAgainTarget } from './bookAgain';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function parseActivityPlans(value: unknown): ActivityPlanSummary[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || !isRecord(item.plan) || !Array.isArray(item.occurrences)) return [];
    const plan = item.plan;
    if (
      typeof plan.id !== 'string' ||
      !['active', 'paused', 'cancelled', 'completed'].includes(String(plan.status)) ||
      typeof plan.provider_acceptance !== 'string'
    ) return [];
    const occurrences = item.occurrences.filter(
      (row): row is ActivityPlanSummary['occurrences'][number] =>
        isRecord(row) && typeof row.id === 'string' && typeof row.scheduled_at === 'string' && typeof row.status === 'string',
    );
    return [{
      plan: plan as ActivityPlanSummary['plan'],
      occurrences,
    }];
  });
}

export function planFrequencyLabel(plan: ActivityPlanSummary['plan']) {
  const labels: Record<Frequency, string> = {
    daily: 'Every day',
    alternate_days: 'Every other day',
    weekly: 'Weekly',
    monthly: 'Monthly',
    custom: 'Custom dates',
  };
  const frequency = plan.frequency ? labels[plan.frequency] ?? 'Repeat plan' : 'Repeat plan';
  if (plan.frequency !== 'weekly' || !Array.isArray(plan.weekdays)) return frequency;
  const days = plan.weekdays
    .map((day) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][day - 1])
    .filter(Boolean)
    .join(', ');
  return days ? `${frequency} · ${days}` : frequency;
}

export function nextActivityPlanOccurrence(plan: ActivityPlanSummary, now = Date.now()) {
  return nextRecurringOccurrence(plan.occurrences, now);
}

export function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function slotLabel(value: string) {
  return new Date(value).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function parseActivityUnreadCounts(value: unknown): ActivityUnreadCounts {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error('The server returned invalid activity unread counts.');
  }
  const counts = row as Record<keyof ActivityUnreadCounts, unknown>;
  for (const key of ['services', 'requests', 'shop', 'sports'] as const) {
    if (typeof counts[key] !== 'number' || !Number.isSafeInteger(counts[key]) || counts[key] < 0) {
      throw new Error('The server returned invalid activity unread counts.');
    }
  }
  return {
    services: counts.services as number,
    requests: counts.requests as number,
    shop: counts.shop as number,
    sports: counts.sports as number,
  };
}

export function visibleActivitySegments(features: ActivityFeatureVisibility): ActivitySegment[] {
  return [
    'services',
    'requests',
    ...(features.products ? (['shop'] as const) : []),
    ...(features.sports || features.hasSportsBookings ? (['sports'] as const) : []),
  ];
}

export function visibleActivityUnreadCounts(
  counts: ActivityUnreadCounts,
  features: ActivityFeatureVisibility,
): ActivityUnreadCounts {
  return {
    services: counts.services,
    requests: counts.requests,
    shop: features.products ? counts.shop : 0,
    sports: features.sports || features.hasSportsBookings ? counts.sports : 0,
  };
}

export function totalVisibleActivityUnread(
  counts: ActivityUnreadCounts,
  features: ActivityFeatureVisibility,
): number {
  const visible = visibleActivityUnreadCounts(counts, features);
  return visible.services + visible.requests + visible.shop + visible.sports;
}
