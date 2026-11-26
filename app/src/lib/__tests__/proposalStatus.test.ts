import { deliverableLabel, dueRuleLabel, proposalStatus } from '../proposalStatus';
import type { Proposal, ProposalViewState } from '../types';

const proposal = (status: Proposal['status']): Pick<Proposal, 'status' | 'valid_until'> => ({
  status,
  valid_until: '2099-01-15T10:00:00.000Z',
});
const view = (overrides: Partial<ProposalViewState> = {}): ProposalViewState => ({
  proposal_id: 'proposal',
  viewer_role: 'customer',
  request_status: 'open',
  request_expires_at: '2099-01-15T10:00:00.000Z',
  current_booking_id: null,
  current_booking_status: null,
  current_booking_created_at: null,
  payment_hold_expires_at: null,
  delivery_status: null,
  can_accept: true,
  can_withdraw: false,
  can_send_new: false,
  can_message: true,
  ...overrides,
});

describe('proposalStatus', () => {
  it('keeps a proposal waiting until the customer accepts it', () => {
    expect(proposalStatus(proposal('sent'), view())).toMatchObject({ label: 'Waiting for customer' });
  });

  it('does not call a selected proposal confirmed before advance payment', () => {
    expect(proposalStatus(proposal('accepted'), view({
      current_booking_id: 'booking',
      current_booking_status: 'pending_payment',
      payment_hold_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    }))).toMatchObject({ label: 'Approved · payment pending' });
  });

  it('confirms the proposal only when the booking has advanced past payment', () => {
    expect(proposalStatus(proposal('accepted'), view({
      current_booking_id: 'booking',
      current_booking_status: 'confirmed',
    }))).toMatchObject({ label: 'Confirmed · advance paid' });
  });

  it('shows an expired payment hold clearly', () => {
    expect(proposalStatus(proposal('accepted'), view({
      current_booking_id: 'booking',
      current_booking_status: 'pending_payment',
      payment_hold_expires_at: new Date(Date.now() - 60_000).toISOString(),
    }))).toMatchObject({ label: 'Payment hold expired' });
  });

  it('does not map disputed or delivery work to confirmed', () => {
    expect(proposalStatus(proposal('accepted'), view({
      current_booking_id: 'disputed',
      current_booking_status: 'disputed',
    }))).toMatchObject({ label: 'Disputed', tone: 'warning' });
    expect(proposalStatus(proposal('accepted'), view({
      current_booking_id: 'delivery',
      current_booking_status: 'delivery_pending',
      delivery_status: 'pending',
    }))).toMatchObject({ label: 'Delivery pending', tone: 'info' });
  });

  it('distinguishes cancelled bookings from completed work', () => {
    expect(proposalStatus(proposal('accepted'), view({
      current_booking_id: 'cancelled',
      current_booking_status: 'cancelled',
    }))).toMatchObject({ label: 'Cancelled / refunded', tone: 'neutral' });
    expect(proposalStatus(proposal('accepted'), view({
      current_booking_id: 'completed',
      current_booking_status: 'completed',
    }))).toMatchObject({ label: 'Completed', tone: 'success' });
  });

  it('uses the request state instead of exposing an invalid Accept state', () => {
    expect(proposalStatus(proposal('sent'), view({
      request_status: 'booked',
      can_accept: false,
    }))).toMatchObject({ label: 'Request booked', tone: 'neutral' });
  });

  it('uses proposal expiry when an old sent row has not yet been reconciled', () => {
    expect(proposalStatus(
      { ...proposal('sent'), valid_until: '2026-01-01T10:00:00.000Z' },
      view(),
    )).toMatchObject({ label: 'Expired', tone: 'neutral' });
  });

  it('does not infer status from a missing booking response', () => {
    expect(proposalStatus(proposal('accepted'), view())).toMatchObject({
      label: 'Booking status unavailable',
      tone: 'neutral',
    });
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
