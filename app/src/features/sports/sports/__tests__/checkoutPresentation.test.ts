import { getSportsBookingActions, getSportsEstimatedTotal } from '../../model';
import { getCustomerSportsBooking } from '../../api';
import { getSportsOnlineCheckoutDisclosure } from '../../SportsVenueBookingScreen';
import { supabase } from '../../../../lib/supabase';

jest.mock('../../../../lib/supabase', () => ({
  supabase: { rpc: jest.fn() },
}));

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
  it('SP-SUBTOTAL-NONZERO-FEE: the estimate stays at 100000 while checkout preserves the server total of 100500', async () => {
    const startsAt = '2026-11-25T10:00:00.000Z';
    const subtotal = getSportsEstimatedTotal([{
      starts_at: startsAt,
      ends_at: '2026-11-25T11:00:00.000Z',
      state: 'free',
      price_paise: 100000,
    }], startsAt, 1);
    (supabase.rpc as jest.Mock).mockResolvedValueOnce({
      data: { price_paise: 100000, customer_fee_paise: 500, total_paise: 100500 },
      error: null,
    });

    const checkout = await getCustomerSportsBooking('booking');
    expect(JSON.stringify({
      subtotal,
      checkout: checkout && {
        price_paise: checkout.price_paise,
        customer_fee_paise: checkout.customer_fee_paise,
        total_paise: checkout.total_paise,
      },
      disclosure: getSportsOnlineCheckoutDisclosure('online'),
    })).toBe(JSON.stringify({
      subtotal: 100000,
      checkout: { price_paise: 100000, customer_fee_paise: 500, total_paise: 100500 },
      disclosure: 'Any customer fee and the exact total will appear in secure checkout.',
    }));
  });

  it('SP-VENUE-NO-ONLINE-FEE: venue checkout preserves a zero server fee without online-fee disclosure', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValueOnce({
      data: { price_paise: 100000, customer_fee_paise: 0, total_paise: 100000 },
      error: null,
    });

    const checkout = await getCustomerSportsBooking('venue-booking');
    expect(JSON.stringify({
      checkout: checkout && {
        price_paise: checkout.price_paise,
        customer_fee_paise: checkout.customer_fee_paise,
        total_paise: checkout.total_paise,
      },
      disclosure: getSportsOnlineCheckoutDisclosure('pay_at_venue'),
    })).toBe(JSON.stringify({
      checkout: { price_paise: 100000, customer_fee_paise: 0, total_paise: 100000 },
      disclosure: null,
    }));
  });

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
