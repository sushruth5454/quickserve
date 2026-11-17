/** Pure provider-side derivations (commission tier progress, acceptance/completion rates). */
import type { CommissionTerms } from './apiTypes';
import type { BookingStatus } from './types';

export interface TierProgress {
  rateBp: number | null;
  /** Server-provided end of the 0% period, when the provider is still in it. */
  freeUntil: Date | null;
  currentTierMinJobs: number | null;
  nextRateBp: number | null;
  /** Completed in-app jobs still needed for the next tier. */
  jobsToNext: number | null;
  /** 0..1 towards the next tier (1 at the lowest tier). */
  progress: number;
}

export function tierProgress(p: { jobsCompleted: number; terms: CommissionTerms; at: Date }): TierProgress {
  const tiers = [...p.terms.tiers].sort((a, b) => a.min_jobs - b.min_jobs);
  const current = [...tiers].reverse().find((tier) => p.jobsCompleted >= tier.min_jobs) ?? null;
  const next = tiers.find((tier) => tier.min_jobs > p.jobsCompleted) ?? null;
  const parsedFreeUntil = p.terms.my_free_until ? new Date(p.terms.my_free_until) : null;
  const freeUntil = parsedFreeUntil && Number.isFinite(parsedFreeUntil.getTime()) && parsedFreeUntil > p.at ? parsedFreeUntil : null;

  if (!tiers.length) {
    return { rateBp: p.terms.my_bp, freeUntil, currentTierMinJobs: null, nextRateBp: null, jobsToNext: null, progress: 0 };
  }
  if (freeUntil) {
    return {
      rateBp: p.terms.my_bp,
      freeUntil,
      currentTierMinJobs: current?.min_jobs ?? null,
      nextRateBp: current?.bp ?? null,
      jobsToNext: null,
      progress: 0,
    };
  }
  if (!next || !current) {
    return {
      rateBp: p.terms.my_bp,
      freeUntil: null,
      currentTierMinJobs: current?.min_jobs ?? null,
      nextRateBp: null,
      jobsToNext: null,
      progress: 1,
    };
  }
  const span = next.min_jobs - current.min_jobs;
  return {
    rateBp: p.terms.my_bp,
    freeUntil: null,
    currentTierMinJobs: current.min_jobs,
    nextRateBp: next.bp,
    jobsToNext: next.min_jobs - p.jobsCompleted,
    progress: span > 0 ? Math.max(0, Math.min(1, (p.jobsCompleted - current.min_jobs) / span)) : 0,
  };
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
