import type { Proposal } from './types';
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

export function proposalStatus(p: Proposal): { label: string; tone: Tone } {
  if (p.status === 'sent') return { label: 'Waiting for customer', tone: 'info' };
  if (p.status === 'withdrawn') return { label: 'Withdrawn', tone: 'neutral' };
  if (p.status === 'rejected') return { label: 'Declined', tone: 'neutral' };
  if (p.status === 'expired') return { label: 'Expired', tone: 'neutral' };
  const booking = p.bookings?.[0];
  if (!booking) return { label: 'Approved by customer · payment pending', tone: 'warning' };
  if (booking.status === 'pending_payment') {
    const expired = booking.payment_hold_expires_at && new Date(booking.payment_hold_expires_at).getTime() <= Date.now();
    return expired
      ? { label: 'Payment hold expired', tone: 'neutral' }
      : { label: 'Approved · payment pending', tone: 'warning' };
  }
  if (booking.status === 'expired') return { label: 'Payment hold expired', tone: 'neutral' };
  if (booking.status === 'cancelled' || booking.status === 'refunded') return { label: 'Cancelled / refunded', tone: 'neutral' };
  if (booking.status === 'declined') return { label: 'Declined', tone: 'neutral' };
  if (booking.status === 'completed' || booking.status === 'closed') return { label: 'Completed', tone: 'success' };
  return { label: 'Confirmed · advance paid', tone: 'success' };
}
