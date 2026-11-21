import {
  canOfferSportsOnlinePayment,
  canContinueSportsCheckout,
  getAvailableSportsDurations,
  getAvailableSportsPaymentModes,
  getSportsCancellationConfirmationMessage,
  getSportsCancellationPolicyLabel,
  getSportsBookingActionLabel,
  getSportsBookingStatusLabel,
  getSportsEstimatedTotal,
  getSportsBookingActions,
  getUpcomingVenueBookings,
  formatSportsDuration,
  getSportsPaymentSummary,
  isSportsTimeRangeValid,
  isSportsTimeValid,
  isSportsDateValid,
  isSportsSlotTakenError,
  slotCellState,
  type SportsSlotAvailability,
} from '../model';

const slots: SportsSlotAvailability[] = [
  { starts_at: '2026-11-19T09:00:00.000Z', ends_at: '2026-11-19T10:00:00.000Z', state: 'free', price_paise: 50000, remaining: 4 },
  { starts_at: '2026-11-19T10:00:00.000Z', ends_at: '2026-11-19T11:00:00.000Z', state: 'free', price_paise: 50000, remaining: 2 },
  { starts_at: '2026-11-19T11:00:00.000Z', ends_at: '2026-11-19T12:00:00.000Z', state: 'taken', price_paise: 50000, remaining: 0 },
  { starts_at: '2026-11-19T13:00:00.000Z', ends_at: '2026-11-19T14:00:00.000Z', state: 'free', price_paise: 50000, remaining: 4 },
];
const [firstSlot, secondSlot, , fourthSlot] = slots;

if (!firstSlot || !secondSlot || !fourthSlot) {
  throw new Error('The sports slot fixture must include its first, second, and fourth slots.');
}

describe('sports customer booking presentation', () => {
  it('SP-CUSTOMER-OWNER-CUTOFF-DIFFERENCE: blocks customer cancellation at start while preserving owner cancellation', () => {
    const now = new Date('2026-11-21T00:00:00.000Z');
    const booking = {
      status: 'accepted',
      customer_id: 'customer',
      owner_id: 'owner',
      payment_mode: 'pay_at_venue' as const,
      paid_at: null,
      hold_expires_at: null,
      pay_by: null,
      expires_at: '2026-11-20T23:00:00.000Z',
      starts_at: now.toISOString(),
    };

    const customer = getSportsBookingActions({ booking, viewerId: 'customer', now });
    const owner = getSportsBookingActions({ booking, viewerId: 'owner', now });
    expect(JSON.stringify({ customer: customer.canCancel, owner: owner.canCancel })).toBe(
      JSON.stringify({ customer: false, owner: true }),
    );
  });

  it('SP-ACTION-DEADLINE-BOUNDARIES: fails closed at, before, or without a valid action deadline', () => {
    const now = new Date('2026-11-21T00:00:00.000Z');
    const base = {
      customer_id: 'customer',
      owner_id: 'owner',
      payment_mode: 'online' as const,
      paid_at: null,
      starts_at: '2026-11-22T00:00:00.000Z',
      expires_at: '2026-11-21T00:00:00.000Z',
      hold_expires_at: '2026-11-21T00:00:00.000Z',
      pay_by: 'not-a-date',
    };

    const request = getSportsBookingActions({
      booking: { ...base, status: 'requested' },
      viewerId: 'owner',
      now,
    });
    const hold = getSportsBookingActions({
      booking: { ...base, status: 'pending_payment' },
      viewerId: 'customer',
      now,
    });
    const payByBoundary = getSportsBookingActions({
      booking: { ...base, status: 'awaiting_payment', pay_by: now.toISOString() },
      viewerId: 'customer',
      now,
    });
    const missingPayBy = getSportsBookingActions({
      booking: { ...base, status: 'awaiting_payment', pay_by: null },
      viewerId: 'customer',
      now,
    });

    expect(JSON.stringify({
      request: { canDecide: request.canDecide, deadline: request.applicableDeadline },
      hold: { canPay: hold.canPay, deadline: hold.applicableDeadline },
      payByBoundary: { canPay: payByBoundary.canPay, deadline: payByBoundary.applicableDeadline },
      missingPayBy: { canPay: missingPayBy.canPay, deadline: missingPayBy.applicableDeadline },
    })).toBe(JSON.stringify({
      request: { canDecide: false, deadline: '2026-11-21T00:00:00.000Z' },
      hold: { canPay: false, deadline: '2026-11-21T00:00:00.000Z' },
      payByBoundary: { canPay: false, deadline: '2026-11-21T00:00:00.000Z' },
      missingPayBy: { canPay: false, deadline: null },
    }));
  });

  it('SP-01: offers only durations whose consecutive slots have enough remaining capacity', () => {
    expect(getAvailableSportsDurations(slots, firstSlot.starts_at, 2)).toEqual([1, 2]);
    expect(getAvailableSportsDurations(slots, firstSlot.starts_at, 3)).toEqual([1]);
  });

  it('SB-03: stops duration choices at taken, blocked, or non-consecutive slots', () => {
    expect(getAvailableSportsDurations(slots, secondSlot.starts_at, 1)).toEqual([1]);
    expect(getAvailableSportsDurations(slots, fourthSlot.starts_at, 1)).toEqual([1]);
  });

  it('SP-05 and SP-15: offers online payment only when parent, child, venue, and payout prerequisites are on', () => {
    const ready = {
      sportsEnabled: true,
      onlinePaymentsEnabled: true,
      venueAllowsOnline: true,
      payoutAccountVerified: true,
    };

    expect(canOfferSportsOnlinePayment(ready)).toBe(true);
    expect(canOfferSportsOnlinePayment({ ...ready, sportsEnabled: false })).toBe(false);
    expect(canOfferSportsOnlinePayment({ ...ready, onlinePaymentsEnabled: false })).toBe(false);
    expect(canOfferSportsOnlinePayment({ ...ready, venueAllowsOnline: false })).toBe(false);
    expect(canOfferSportsOnlinePayment({ ...ready, payoutAccountVerified: false })).toBe(false);
    expect(getAvailableSportsPaymentModes(['online'], {
      sportsEnabled: true,
      onlinePaymentsEnabled: false,
      payoutAccountVerified: false,
    })).toEqual([]);
    expect(getAvailableSportsPaymentModes([], {
      sportsEnabled: true,
      onlinePaymentsEnabled: true,
      payoutAccountVerified: true,
    })).toEqual([]);
  });

  it('SB-08 and SP-07: preserves the pay-at-venue option when online payment is unavailable', () => {
    expect(getAvailableSportsPaymentModes(['online', 'pay_at_venue'], {
      sportsEnabled: true,
      onlinePaymentsEnabled: false,
      payoutAccountVerified: false,
    })).toEqual(['pay_at_venue']);
    expect(getSportsPaymentSummary('accepted', 'pay_at_venue')).toBe('Pay at venue');
  });

  it('SP-01 and SP-07: uses Book only for an enabled instant-booking resource', () => {
    expect(getSportsBookingActionLabel('instant', true)).toBe('Book');
    expect(getSportsBookingActionLabel('approval', true)).toBe('Send request');
    expect(getSportsBookingActionLabel('instant', false)).toBe('Send request');
  });

  it('SP-02: identifies a slot-taken response so the screen can refresh availability', () => {
    expect(isSportsSlotTakenError('slot is no longer available')).toBe(true);
    expect(isSportsSlotTakenError('slot is not available')).toBe(true);
    expect(isSportsSlotTakenError('capacity is full')).toBe(true);
    expect(isSportsSlotTakenError('invalid note')).toBe(false);
  });

  it('SP-02: makes taken and blocked slot cells visible but not selectable', () => {
    const results = (['taken', 'blocked'] as const).map((state) => {
      const cell = slotCellState({ ...firstSlot, state }, []);
      return { state, ...cell };
    });

    expect(JSON.stringify(results)).toBe(JSON.stringify([
      { state: 'taken', visible: true, selected: false, selectable: false, unavailable: true },
      { state: 'blocked', visible: true, selected: false, selectable: false, unavailable: true },
    ]));
  });

  it('SP-02: hides past slots and marks selected free slot cells', () => {
    const pastCell = slotCellState({ ...firstSlot, state: 'past' }, []);
    expect(JSON.stringify(pastCell)).toBe(JSON.stringify({
      visible: false,
      selected: false,
      selectable: false,
      unavailable: false,
    }));
    const selectedCell = slotCellState(firstSlot, [firstSlot.starts_at]);
    expect(JSON.stringify(selectedCell)).toBe(JSON.stringify({
      visible: true,
      selected: true,
      selectable: true,
      unavailable: false,
    }));
  });

  it('SP-06, SP-07, and SP-12: presents payment and terminal booking statuses in customer language', () => {
    expect(getSportsBookingStatusLabel('pending_payment')).toBe('Complete payment');
    expect(getSportsBookingStatusLabel('requested')).toBe('Waiting for venue');
    expect(getSportsBookingStatusLabel('awaiting_payment')).toBe('Venue approved — pay now');
    expect(getSportsBookingStatusLabel('accepted')).toBe('Confirmed');
    expect(getSportsBookingStatusLabel('expired')).toBe('Expired');
  });

  it('SP-15: keeps an existing payment checkout available after new online booking is disabled', () => {
    expect(canContinueSportsCheckout('pending_payment')).toBe(true);
    expect(canContinueSportsCheckout('awaiting_payment')).toBe(true);
    expect(canContinueSportsCheckout('accepted')).toBe(false);
  });

  it('WS4-T07: formats the server refund in the cancellation confirmation', () => {
    expect(getSportsCancellationConfirmationMessage(123456)).toBe('You will get ₹1,234.56 back.');
    expect(getSportsCancellationPolicyLabel({
      full_refund_hours: 24,
      partial_refund_hours: 6,
      partial_refund_bp: 5000,
    })).toBe('Online cancellations: full service refund at least 24h ahead; 50% service refund from 6h to 24h; no service refund under 6h.');
  });

  it('WS4-T08: lists only future active venue bookings in start-time order', () => {
    const now = new Date('2026-11-19T10:00:00.000Z');
    const rows = [
      { id: 'later', starts_at: '2026-11-20T12:00:00.000Z', status: 'accepted' },
      { id: 'past', starts_at: '2026-11-19T09:00:00.000Z', status: 'accepted' },
      { id: 'earlier', starts_at: '2026-11-19T11:00:00.000Z', status: 'pending_payment' },
      { id: 'declined', starts_at: '2026-11-19T12:00:00.000Z', status: 'declined' },
      { id: 'awaiting', starts_at: '2026-11-19T12:00:00.000Z', status: 'awaiting_payment' },
    ];

    expect(getUpcomingVenueBookings(rows, now).map((row) => row.id)).toEqual(['earlier', 'awaiting', 'later']);
  });

  it('WS4-T19: labels durations and totals selected slots using integer paise', () => {
    expect(formatSportsDuration(1, 30)).toBe('30 min');
    expect(formatSportsDuration(2, 60)).toBe('2 hr');
    expect(formatSportsDuration(3, 90)).toBe('4.5 hr');
    expect(getSportsEstimatedTotal(slots, firstSlot.starts_at, 2)).toBe(100000);
    expect(getSportsEstimatedTotal(slots, firstSlot.starts_at, 3)).toBeNull();
  });

  it('WS4-T19: validates 24-hour time ranges numerically', () => {
    expect(isSportsTimeValid('09:00')).toBe(true);
    expect(isSportsTimeValid('9:00')).toBe(false);
    expect(isSportsTimeValid('24:00')).toBe(false);
    expect(isSportsTimeRangeValid('09:00', '10:00')).toBe(true);
    expect(isSportsTimeRangeValid('10:00', '09:00')).toBe(false);
    expect(isSportsDateValid('2026-12-15')).toBe(true);
    expect(isSportsDateValid('2026-02-31')).toBe(false);
  });
});
