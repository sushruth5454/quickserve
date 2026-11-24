jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), canGoBack: () => false, replace: jest.fn() },
}));

import { getSportsBookingActions, getSportsEstimatedTotal } from '../model';
import { getCustomerSportsBooking } from '../api';
import { getSportsOnlineCheckoutDisclosure } from '../SportsVenueBookingScreen';
import { supabase } from '../../../lib/supabase';

jest.mock('../../../lib/supabase', () => ({
  supabase: { rpc: jest.fn() },
}));

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
  it('SP-SUBTOTAL-NONZERO-FEE: selection keeps the slot subtotal separate from the server-returned online fee and total', async () => {
    const startsAt = '2026-11-25T10:00:00.000Z';
    const subtotal = getSportsEstimatedTotal([{
      starts_at: startsAt,
      ends_at: '2026-11-25T11:00:00.000Z',
      state: 'free',
      price_paise: 100000,
    }], startsAt, 1);
    (supabase.rpc as jest.Mock).mockResolvedValueOnce({
      data: { participants: 3, price_paise: 100000, customer_fee_paise: 500, total_paise: 100500 },
      error: null,
    });

    const checkout = await getCustomerSportsBooking('booking');
    expect(JSON.stringify({
      subtotal,
      checkout: checkout && {
        participants: checkout.participants,
        price_paise: checkout.price_paise,
        customer_fee_paise: checkout.customer_fee_paise,
        total_paise: checkout.total_paise,
      },
      disclosure: getSportsOnlineCheckoutDisclosure('online'),
    })).toBe(JSON.stringify({
      subtotal: 100000,
      checkout: { participants: 3, price_paise: 100000, customer_fee_paise: 500, total_paise: 100500 },
      disclosure: 'Any customer fee and the exact total will appear in secure checkout.',
    }));
  });

  it('SP-VENUE-NO-ONLINE-FEE: venue payment keeps the server fee at zero and shows no online-fee disclosure', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValueOnce({
      data: { participants: 3, price_paise: 100000, customer_fee_paise: 0, total_paise: 100000 },
      error: null,
    });

    const checkout = await getCustomerSportsBooking('venue-booking');
    expect(JSON.stringify({
      checkout: checkout && {
        participants: checkout.participants,
        price_paise: checkout.price_paise,
        customer_fee_paise: checkout.customer_fee_paise,
        total_paise: checkout.total_paise,
      },
      disclosure: getSportsOnlineCheckoutDisclosure('pay_at_venue'),
    })).toBe(JSON.stringify({
      checkout: { participants: 3, price_paise: 100000, customer_fee_paise: 0, total_paise: 100000 },
      disclosure: null,
    }));
  });

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
