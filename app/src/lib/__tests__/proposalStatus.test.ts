import { deliverableLabel, dueRuleLabel, proposalStatus } from '../proposalStatus';
import type { Booking, Proposal } from '../types';

const proposal = (status: Proposal['status'], booking?: { status: Booking['status']; payment_hold_expires_at: string | null }) =>
  ({ status, bookings: booking ? [{ id: 'booking', ...booking }] : undefined } as Proposal);

describe('proposalStatus', () => {
  it('keeps a proposal waiting until the customer accepts it', () => {
    expect(proposalStatus(proposal('sent'))).toMatchObject({ label: 'Waiting for customer' });
  });

  it('does not call a selected proposal confirmed before advance payment', () => {
    expect(proposalStatus(proposal('accepted', {
      status: 'pending_payment',
      payment_hold_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    }))).toMatchObject({ label: 'Approved · payment pending' });
  });

  it('confirms the proposal only when the booking has advanced past payment', () => {
    expect(proposalStatus(proposal('accepted', {
      status: 'confirmed',
      payment_hold_expires_at: null,
    }))).toMatchObject({ label: 'Confirmed · advance paid' });
  });

  it('shows an expired payment hold clearly', () => {
    expect(proposalStatus(proposal('accepted', {
      status: 'pending_payment',
      payment_hold_expires_at: new Date(Date.now() - 60_000).toISOString(),
    }))).toMatchObject({ label: 'Payment hold expired' });
  });

  it('maps supported payment due rules to customer language', () => {
    expect(dueRuleLabel('at_booking')).toBe('At booking');
    expect(dueRuleLabel('on_delivery')).toBe('When work is delivered');
    expect(dueRuleLabel('on_completion')).toBe('When the job is complete');
    expect(dueRuleLabel('days_before_start:7')).toBe('7 days before');
    expect(dueRuleLabel('days_before_start:1')).toBe('1 day before');
  });

  it('maps deliverable types without exposing raw snake-case keys', () => {
    expect(deliverableLabel('final_delivery')).toBe('Final delivery');
    expect(deliverableLabel('usage_rights')).toBe('Usage rights');
  });
});
