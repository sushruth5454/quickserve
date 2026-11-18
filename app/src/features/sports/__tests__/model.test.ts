import {
  canOfferSportsOnlinePayment,
  canContinueSportsCheckout,
  getAvailableSportsDurations,
  getAvailableSportsPaymentModes,
  getSportsBookingActionLabel,
  getSportsBookingStatusLabel,
  getSportsPaymentSummary,
  isSportsSlotTakenError,
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
});
