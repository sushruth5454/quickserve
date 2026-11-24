import type { RfqStatus, SupplierQuoteStatus } from './api';

export type RfqViewBlockReason =
  | 'closed'
  | 'rfq_expired'
  | 'deadline_unavailable'
  | 'server_blocked'
  | null;

export interface RfqViewState {
  rawStatus: RfqStatus;
  rfqLabel: string;
  quoteLabel: string;
  canReply: boolean;
  blockReason: RfqViewBlockReason;
}

function quoteOutcomeLabel(status: SupplierQuoteStatus | null): string {
  switch (status) {
    case 'sent': return 'Quote sent';
    case 'selected': return 'Selected';
    case 'rejected': return 'Not selected (rejected)';
    case 'expired': return 'Quote expired';
    case 'withdrawn': return 'Withdrawn';
    default: return 'No quote sent';
  }
}

export function rfqViewState(input: {
  status: RfqStatus;
  expiresAt: string;
  quoteStatus: SupplierQuoteStatus | null;
  myOutcome: SupplierQuoteStatus | null;
  canSendQuote: boolean;
  nowMs: number;
}): RfqViewState {
  const expiryMs = Date.parse(input.expiresAt);
  const deadlineAvailable = Number.isFinite(expiryMs);
  const deadlinePassed = deadlineAvailable && expiryMs <= input.nowMs;
  const rfqLabel = input.status === 'open'
    ? deadlinePassed
      ? 'Open · deadline passed'
      : deadlineAvailable
        ? 'Open'
        : 'Open · deadline unavailable'
    : input.status.charAt(0).toUpperCase() + input.status.slice(1);

  const blockReason: RfqViewBlockReason = input.status !== 'open'
    ? 'closed'
    : !deadlineAvailable
      ? 'deadline_unavailable'
      : deadlinePassed
        ? 'rfq_expired'
        : !input.canSendQuote
          ? 'server_blocked'
          : null;

  return {
    rawStatus: input.status,
    rfqLabel,
    quoteLabel: quoteOutcomeLabel(input.myOutcome ?? input.quoteStatus),
    canReply: blockReason === null,
    blockReason,
  };
}

export function nearestFutureRfqDeadlineMs(
  deadlines: readonly (string | null | undefined)[],
  nowMs: number,
): number | null {
  let nearest: number | null = null;
  for (const deadline of deadlines) {
    if (!deadline) continue;
    const deadlineMs = Date.parse(deadline);
    if (Number.isFinite(deadlineMs) && deadlineMs > nowMs && (nearest === null || deadlineMs < nearest)) {
      nearest = deadlineMs;
    }
  }
  return nearest;
}
