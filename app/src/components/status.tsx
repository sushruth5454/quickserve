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
  closed_no_work: 'Closed — quote rejected',
  declined: 'Declined by provider',
  expired: 'Expired (not accepted in time)',
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

export const statusTone: Record<BookingStatus, Tone> = {
  pending_payment: 'warning',
  requested: 'warning',
  accepted: 'primary',
  en_route: 'primary',
  inspecting: 'primary',
  quote_sent: 'warning',
  awaiting_payment: 'warning',
  in_progress: 'info',
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
