import {
  ACTIVE_PRIORITY,
  getNextStep,
  isActiveProviderJob,
  type ProviderJob,
  type ProviderJobNextStep,
} from '../../lib/types';
import type { GoLive } from '../../lib/onboarding';
import { reasonCopy } from '../../lib/onboarding/copy';

export const firstName = (name: string) => (name || 'Customer').split(' ')[0] ?? name;

export function selectDashboardWork(jobs: ProviderJob[] | null | undefined): {
  incoming: ProviderJob[];
  next: ProviderJob | undefined;
  rest: ProviderJob[];
} {
  const seen = new Set<string>();
  const uniqueJobs = (jobs ?? []).filter((job) => {
    if (seen.has(job.booking_id)) return false;
    seen.add(job.booking_id);
    return true;
  });
  const incoming = uniqueJobs.filter((job) => job.status === 'requested');
  const active = uniqueJobs
    .filter(isActiveProviderJob)
    .sort(
      (a, b) =>
        ACTIVE_PRIORITY.indexOf(a.status) - ACTIVE_PRIORITY.indexOf(b.status) ||
        (a.scheduled_at ?? a.created_at).localeCompare(b.scheduled_at ?? b.created_at),
    );
  const [next, ...rest] = active;
  return { incoming, next, rest };
}

export function getDashboardNextStep(
  job: Pick<ProviderJob, 'status' | 'archetype'>,
): ProviderJobNextStep | undefined {
  if (job.status === 'confirmed') {
    return { label: 'View confirmed booking', icon: 'eye-outline', primary: true };
  }
  if (job.status === 'delivery_pending') {
    return { label: 'Manage delivery', icon: 'eye-outline', primary: true };
  }
  return getNextStep(job);
}

export function shouldShowStaffManagementShortcut(
  role: 'owner' | 'manager' | 'staff' | null,
  merchantStaffEnabled: boolean,
): boolean {
  return role === 'owner' && merchantStaffEnabled;
}

export function getPayoutSetupLabel(goLive: GoLive | null, readFailed: boolean): string {
  if (readFailed || !goLive) return 'Unknown';
  const reason = goLive.reasons.find((item) => item.code.startsWith('payout_'));
  if (!reason) return 'No payout issue reported';
  return reasonCopy(reason).title;
}
