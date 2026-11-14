import type { Tone } from './ui';
import { Badge } from './ui';
import type { BookingStatus } from '../lib/types';

export const statusLabel: Record<BookingStatus, string> = {
  pending_payment: 'Awaiting visit-fee payment',
  requested: 'Waiting for provider',
  accepted: 'Accepted',
  en_route: 'Provider on the way',
  inspecting: 'Inspecting',
  quote_sent: 'Quote sent',
  awaiting_payment: 'Payment due',
  in_progress: 'In progress',
  completion_requested: 'Completion requested',
  completed: 'Completed',
  closed: 'Closed',
  closed_no_work: 'Closed · no work',
  declined: 'Declined by provider',
  expired: 'Expired',
  cancelled: 'Cancelled',
  disputed: 'Under dispute',
  refunded: 'Refunded',
};

/** Short label for pills. */
export const statusShort: Record<BookingStatus, string> = {
  pending_payment: 'Payment pending',
  requested: 'Requested',
  accepted: 'Accepted',
  en_route: 'On the way',
  inspecting: 'Inspecting',
  quote_sent: 'Quote sent',
  awaiting_payment: 'Payment due',
  in_progress: 'In progress',
  completion_requested: 'Confirm completion',
  completed: 'Completed',
  closed: 'Completed',
  closed_no_work: 'No work done',
  declined: 'Declined',
  expired: 'Expired',
  cancelled: 'Cancelled',
  disputed: 'Disputed',
  refunded: 'Refunded',
};

/**
 * warning = the customer needs to act · primary = in progress · success = done ·
 * neutral = ended without work · danger = disputed/declined.
 */
export const statusTone: Record<BookingStatus, Tone> = {
  pending_payment: 'warning',
  requested: 'primary',
  accepted: 'primary',
  en_route: 'primary',
  inspecting: 'primary',
  quote_sent: 'warning',
  awaiting_payment: 'warning',
  in_progress: 'primary',
  completion_requested: 'warning',
  completed: 'success',
  closed: 'success',
  closed_no_work: 'neutral',
  declined: 'danger',
  expired: 'neutral',
  cancelled: 'neutral',
  disputed: 'danger',
  refunded: 'neutral',
};

/** One-line "what happens next" copy for booking cards. */
export const nextStepCopy: Partial<Record<BookingStatus, string>> = {
  pending_payment: 'Pay the visit fee to send your request',
  requested: 'Waiting for the pro to accept · usually ~15 min',
  accepted: 'Pro confirmed · share the start code on arrival',
  en_route: 'Pro is on the way · keep your start code ready',
  inspecting: 'Pro is inspecting the problem',
  quote_sent: 'Review and approve the quote',
  awaiting_payment: 'Pay the balance to start work',
  in_progress: 'Work in progress · payment held safely',
  completion_requested: 'Check the work and share the completion code',
  disputed: 'Support is reviewing your report',
};

export const terminalStatuses: BookingStatus[] = ['closed', 'closed_no_work', 'declined', 'expired', 'cancelled', 'refunded'];

export const activeStatuses: BookingStatus[] = [
  'pending_payment',
  'requested',
  'accepted',
  'en_route',
  'inspecting',
  'quote_sent',
  'awaiting_payment',
  'in_progress',
  'completion_requested',
  'disputed',
];

export function StatusPill({ status, short = true }: { status: BookingStatus; short?: boolean }) {
  return <Badge label={short ? statusShort[status] : statusLabel[status]} tone={statusTone[status]} dot size="sm" />;
}
