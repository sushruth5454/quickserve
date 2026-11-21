import { getSportsBookingActions } from '../../model';

const now = new Date('2026-11-21T00:00:00.000Z');

function dueBooking(status: 'pending_payment' | 'awaiting_payment') {
  return {
    status,
    customer_id: 'customer',
    owner_id: 'owner',
    business_role: 'staff' as const,
    payment_mode: 'online' as const,
    paid_at: null,
    hold_expires_at: status === 'pending_payment' ? '2026-11-21T01:00:00.000Z' : null,
    pay_by: status === 'awaiting_payment' ? '2026-11-21T01:00:00.000Z' : null,
    expires_at: '2026-11-21T01:00:00.000Z',
    starts_at: '2026-11-22T00:00:00.000Z',
  };
}

describe('sports checkout action presentation', () => {
  it('SP-STAFF-NOT-PAYER: a business reader cannot pay a customer booking', () => {
    const actions = getSportsBookingActions({
      booking: dueBooking('pending_payment'),
      viewerId: 'business-reader',
      now,
    });

    expect(JSON.stringify({ canPay: actions.canPay, nextAction: actions.nextAction })).toBe(
      JSON.stringify({ canPay: false, nextAction: 'view_booking' }),
    );
  });

  it('SP-MISSING-DEADLINE: absent or invalid payment deadlines suppress Pay', () => {
    const pending = getSportsBookingActions({
      booking: { ...dueBooking('pending_payment'), hold_expires_at: null },
      viewerId: 'customer',
      now,
    });
    const awaiting = getSportsBookingActions({
      booking: { ...dueBooking('awaiting_payment'), pay_by: 'not-a-date' },
      viewerId: 'customer',
      now,
    });

    expect(JSON.stringify({
      pending: { canPay: pending.canPay, deadline: pending.applicableDeadline },
      awaiting: { canPay: awaiting.canPay, deadline: awaiting.applicableDeadline },
    })).toBe(JSON.stringify({
      pending: { canPay: false, deadline: null },
      awaiting: { canPay: false, deadline: null },
    }));
  });

  it('SP-PAID-AT: a persisted paid_at suppresses another payment even in a due status', () => {
    const actions = getSportsBookingActions({
      booking: { ...dueBooking('pending_payment'), paid_at: '2026-11-20T23:30:00.000Z' },
      viewerId: 'customer',
      now,
    });

    expect(JSON.stringify({ canPay: actions.canPay, nextAction: actions.nextAction })).toBe(
      JSON.stringify({ canPay: false, nextAction: 'view_booking' }),
    );
  });

  it('SP-BROWSER-OPEN-NOT-PAID: browser launch does not imply a captured payment', () => {
    const booking = dueBooking('pending_payment');
    const actions = getSportsBookingActions({ booking, viewerId: 'customer', now });

    expect(JSON.stringify({ paidAt: booking.paid_at, canPay: actions.canPay })).toBe(
      JSON.stringify({ paidAt: null, canPay: true }),
    );
  });
});
