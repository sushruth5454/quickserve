/** Pure provider-side derivations (commission tier progress, acceptance/completion rates). Rules from money.ts. */
import { commissionRateBp, FREE_PERIOD_DAYS, RATE_BP, TIER_1_JOBS, TIER_2_JOBS } from './money';
import type { BookingStatus } from './types';

export interface TierProgress {
  rateBp: number;
  /** End of the 0% period, when the provider is still in it. */
  freeUntil: Date | null;
  nextRateBp: number | null;
  /** Completed in-app jobs still needed for the next tier. */
  jobsToNext: number | null;
  /** 0..1 towards the next tier (1 at the lowest tier). */
  progress: number;
}

export function tierProgress(p: { jobsCompleted: number; createdAt: Date; at: Date }): TierProgress {
  const rateBp = commissionRateBp({ jobsCompleted: p.jobsCompleted, providerCreatedAt: p.createdAt, at: p.at });
  const freeUntil = rateBp === RATE_BP.free ? new Date(p.createdAt.getTime() + FREE_PERIOD_DAYS * 86400000) : null;
  const jobs = p.jobsCompleted;
  if (jobs >= TIER_2_JOBS) return { rateBp, freeUntil, nextRateBp: null, jobsToNext: null, progress: 1 };
  if (jobs >= TIER_1_JOBS) {
    return { rateBp, freeUntil, nextRateBp: RATE_BP.tier2, jobsToNext: TIER_2_JOBS - jobs, progress: (jobs - TIER_1_JOBS) / (TIER_2_JOBS - TIER_1_JOBS) };
  }
  return { rateBp, freeUntil, nextRateBp: RATE_BP.tier1, jobsToNext: TIER_1_JOBS - jobs, progress: jobs / TIER_1_JOBS };
}

const NOT_ACCEPTED: BookingStatus[] = ['declined', 'expired'];
const UNDECIDED: BookingStatus[] = ['requested', 'cancelled'];

/**
 * acceptance = accepted / (accepted + declined + expired). Still-open requests and customer cancellations are excluded
 * (a cancelled booking may never have reached the provider).
 * completion = completed / (completed + disputed + refunded) — accepted jobs that ended, excluding the customer's own
 * choices (cancel, decline the quote). Null when there is nothing to measure.
 */
export function providerStats(statuses: BookingStatus[]): { acceptance: number | null; completion: number | null } {
  const decided = statuses.filter((s) => !UNDECIDED.includes(s));
  const accepted = decided.filter((s) => !NOT_ACCEPTED.includes(s)).length;
  const done = statuses.filter((s) => s === 'completed' || s === 'closed').length;
  const failed = statuses.filter((s) => s === 'disputed' || s === 'refunded').length;
  return {
    acceptance: decided.length ? accepted / decided.length : null,
    completion: done + failed ? done / (done + failed) : null,
  };
}

export const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);
