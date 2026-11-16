import { proposalStatus } from '../proposalStatus';
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
});
