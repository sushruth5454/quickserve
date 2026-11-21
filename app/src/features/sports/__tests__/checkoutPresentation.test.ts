import { getSportsBookingActions } from '../model';

const now = new Date('2026-11-21T00:00:00.000Z');

function booking(status: string) {
  return {
    status,
    customer_id: 'customer',
    owner_id: 'owner',
    payment_mode: 'online' as const,
    paid_at: '2026-11-20T23:30:00.000Z',
    hold_expires_at: '2026-11-20T23:45:00.000Z',
    pay_by: '2026-11-20T23:45:00.000Z',
    expires_at: '2026-11-20T23:45:00.000Z',
    starts_at: '2026-11-22T00:00:00.000Z',
  };
}

describe('sports checkout presentation', () => {
  it('SP-PAID-OLD-DEADLINE: accepted and completed bookings use the same booking without an old payment deadline', () => {
    const accepted = getSportsBookingActions({ booking: booking('accepted'), viewerId: 'customer', now });
    const completed = getSportsBookingActions({ booking: booking('completed'), viewerId: 'customer', now });

    expect(JSON.stringify({
      accepted: {
        canPay: accepted.canPay,
        deadline: accepted.applicableDeadline,
        nextAction: accepted.nextAction,
      },
      completed: {
        canPay: completed.canPay,
        deadline: completed.applicableDeadline,
        nextAction: completed.nextAction,
      },
    })).toBe(JSON.stringify({
      accepted: { canPay: false, deadline: null, nextAction: 'view_booking' },
      completed: { canPay: false, deadline: null, nextAction: 'view_booking' },
    }));
  });

  it('SP-REQUEST-CHECKOUT: requested bookings link to the same request without a payment countdown', () => {
    const actions = getSportsBookingActions({
      booking: { ...booking('requested'), paid_at: null },
      viewerId: 'customer',
      now,
    });

    expect(JSON.stringify({
      canPay: actions.canPay,
      deadlineKind: actions.deadlineKind,
      nextAction: actions.nextAction,
    })).toBe(JSON.stringify({
      canPay: false,
      deadlineKind: 'request',
      nextAction: 'view_request',
    }));
  });
});
