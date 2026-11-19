/** Pure provider-side derivations (commission tier progress, acceptance/completion rates). */
import type { CommissionTerms } from './apiTypes';
import type { BookingStatus, PayoutStatus, ProviderStatementRow } from './types';

export interface ProviderStatementTotals {
  gross: number;
  commission: number;
  gstOnCommission: number;
  reversedAmount: number;
  net: number;
  pending: number;
  frozen: number;
  failed: number;
  transferred: number;
  reversed: number;
  partiallyReversed: number;
  demo: number;
}

export function summarizeProviderStatement(rows: ProviderStatementRow[]): ProviderStatementTotals {
  return rows.reduce<ProviderStatementTotals>((totals, row) => {
    if (row.status === 'demo') {
      totals.demo += row.net;
      return totals;
    }
    totals.gross += row.gross;
    totals.commission += row.commission;
    totals.gstOnCommission += row.gst_on_commission;
    totals.reversedAmount += row.reversed_amount;
    totals.net += row.net;
    if (row.status === 'pending') totals.pending += row.net;
    else if (row.status === 'frozen') totals.frozen += row.net;
    else if (row.status === 'failed') totals.failed += row.net;
    else if (row.status === 'transferred') totals.transferred += row.net;
    else if (row.status === 'reversed') totals.reversed += row.net;
    else if (row.status === 'partially_reversed') totals.partiallyReversed += row.net;
    return totals;
  }, {
    gross: 0,
    commission: 0,
    gstOnCommission: 0,
    reversedAmount: 0,
    net: 0,
    pending: 0,
    frozen: 0,
    failed: 0,
    transferred: 0,
    reversed: 0,
    partiallyReversed: 0,
    demo: 0,
  });
}

export interface PayoutStatusCopy {
  label: string;
  detail: string;
  tone: 'warning' | 'danger' | 'success' | 'neutral';
}

export function payoutStatusCopy(status: PayoutStatus): PayoutStatusCopy {
  switch (status) {
    case 'pending':
      return { label: 'Pending', detail: 'This payout is not marked as transferred yet; its transfer may still be processing.', tone: 'warning' };
    case 'frozen':
      return { label: 'On hold · dispute', detail: 'This payout is on hold while the dispute is reviewed.', tone: 'danger' };
    case 'failed':
      return { label: 'Payment problem', detail: 'A payout transfer failed; the full payout is not confirmed as paid.', tone: 'danger' };
    case 'transferred':
      return { label: 'Paid', detail: 'The payout was transferred.', tone: 'success' };
    case 'reversed':
      return { label: 'Reversed', detail: 'This payout was reversed.', tone: 'neutral' };
    case 'partially_reversed':
      return { label: 'Partly reversed', detail: 'Part of this payout was reversed; see the adjustment amount.', tone: 'neutral' };
    case 'demo':
      return { label: 'Demo only', detail: 'This simulated payout will not be transferred to a bank.', tone: 'neutral' };
  }
}

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
