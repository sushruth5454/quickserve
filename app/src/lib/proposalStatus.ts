import type { Proposal, ProposalViewState } from './types';
import type { Tone } from '../components/ui';

const DUE_RULE_LABELS: Record<string, string> = {
  at_booking: 'At booking',
  on_delivery: 'When work is delivered',
  on_completion: 'When the job is complete',
  'days_before_start:7': '7 days before',
  'days_before_start:1': '1 day before',
};

export function dueRuleLabel(rule: string): string {
  return DUE_RULE_LABELS[rule] ?? rule.replaceAll('_', ' ');
}

export function deliverableLabel(type: string): string {
  const words = type.replaceAll('_', ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Delivery';
}

export function proposalStatus(p: Pick<Proposal, 'status' | 'valid_until'>, state: ProposalViewState | null): { label: string; tone: Tone } {
  if (!state) return { label: 'Status unavailable', tone: 'neutral' };
  if (p.status === 'sent') {
    if (new Date(p.valid_until).getTime() <= Date.now()) return { label: 'Expired', tone: 'neutral' };
    if (state.request_status === 'booked') return { label: 'Request booked', tone: 'neutral' };
    if (state.request_status === 'expired') return { label: 'Request expired', tone: 'neutral' };
    if (state.request_status === 'cancelled') return { label: 'Request cancelled', tone: 'neutral' };
    if (state.request_status === 'closed') return { label: 'Request closed', tone: 'neutral' };
    return { label: 'Waiting for customer', tone: 'info' };
  }
  if (p.status === 'withdrawn') return { label: 'Withdrawn', tone: 'neutral' };
  if (p.status === 'rejected') return { label: 'Declined', tone: 'neutral' };
  if (p.status === 'expired') return { label: 'Expired', tone: 'neutral' };
  if (!state.current_booking_id || !state.current_booking_status) {
    return { label: 'Booking status unavailable', tone: 'neutral' };
  }
  if (state.current_booking_status === 'pending_payment') {
    const expired = state.payment_hold_expires_at && new Date(state.payment_hold_expires_at).getTime() <= Date.now();
    return expired
      ? { label: 'Payment hold expired', tone: 'neutral' }
      : { label: 'Approved · payment pending', tone: 'warning' };
  }
  if (state.current_booking_status === 'expired') return { label: 'Payment hold expired', tone: 'neutral' };
  if (state.current_booking_status === 'cancelled' || state.current_booking_status === 'refunded') {
    return { label: 'Cancelled / refunded', tone: 'neutral' };
  }
  if (state.current_booking_status === 'declined') return { label: 'Declined', tone: 'neutral' };
  if (state.current_booking_status === 'disputed') return { label: 'Disputed', tone: 'warning' };
  if (state.current_booking_status === 'delivery_pending') return { label: 'Delivery pending', tone: 'info' };
  if (state.current_booking_status === 'completion_requested') return { label: 'Completion requested', tone: 'info' };
  if (state.current_booking_status === 'in_progress') return { label: 'Work in progress', tone: 'info' };
  if (state.current_booking_status === 'en_route') return { label: 'Provider en route', tone: 'info' };
  if (state.current_booking_status === 'inspecting') return { label: 'Inspection in progress', tone: 'info' };
  if (state.current_booking_status === 'quote_sent') return { label: 'Quote awaiting review', tone: 'info' };
  if (state.current_booking_status === 'awaiting_payment') return { label: 'Payment pending', tone: 'warning' };
  if (state.current_booking_status === 'requested') return { label: 'Booking requested', tone: 'info' };
  if (state.current_booking_status === 'closed_no_work') return { label: 'Closed without completion', tone: 'neutral' };
  if (state.current_booking_status === 'completed' || state.current_booking_status === 'closed') {
    return { label: 'Completed', tone: 'success' };
  }
  return { label: 'Confirmed · advance paid', tone: 'success' };
}
