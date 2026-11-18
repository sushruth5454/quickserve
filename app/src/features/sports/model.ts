import type { SportsBookingStatus, SportsPaymentMode, SportsSlotAvailability } from './api';

export type { SportsSlotAvailability } from './api';

export function getAvailableSportsDurations(
  slots: readonly SportsSlotAvailability[],
  selectedStart: string,
  participants: number,
  maxSlots = 4,
): number[] {
  const startIndex = slots.findIndex((slot) => slot.starts_at === selectedStart);
  if (startIndex < 0) return [];

  const durations: number[] = [];
  let previous: SportsSlotAvailability | undefined;
  for (let offset = 0; offset < maxSlots; offset += 1) {
    const slot = slots[startIndex + offset];
    if (
      !slot
      || slot.state !== 'free'
      || (slot.remaining != null && slot.remaining < participants)
      || (previous && new Date(previous.ends_at).getTime() !== new Date(slot.starts_at).getTime())
    ) {
      break;
    }
    durations.push(offset + 1);
    previous = slot;
  }
  return durations;
}

export function canOfferSportsOnlinePayment(input: {
  sportsEnabled: boolean;
  onlinePaymentsEnabled: boolean;
  venueAllowsOnline: boolean;
  payoutAccountVerified: boolean;
}): boolean {
  return input.sportsEnabled
    && input.onlinePaymentsEnabled
    && input.venueAllowsOnline
    && input.payoutAccountVerified;
}

export function getAvailableSportsPaymentModes(
  venueModes: readonly SportsPaymentMode[] | null | undefined,
  onlinePayment: {
    sportsEnabled: boolean;
    onlinePaymentsEnabled: boolean;
    payoutAccountVerified: boolean;
  },
): SportsPaymentMode[] {
  const configuredModes: readonly SportsPaymentMode[] = venueModes ?? ['pay_at_venue'];
  return configuredModes.filter((mode) => mode === 'pay_at_venue' || canOfferSportsOnlinePayment({
    ...onlinePayment,
    venueAllowsOnline: true,
  }));
}

export function canContinueSportsCheckout(status: SportsBookingStatus | string): boolean {
  return status === 'pending_payment' || status === 'awaiting_payment';
}

export function getSportsBookingActionLabel(bookingMode: 'instant' | 'approval', instantBookingEnabled: boolean): string {
  return bookingMode === 'instant' && instantBookingEnabled ? 'Book' : 'Send request';
}

const SPORTS_STATUS_LABELS: Record<SportsBookingStatus, string> = {
  pending_payment: 'Complete payment',
  requested: 'Waiting for venue',
  awaiting_payment: 'Venue approved — pay now',
  accepted: 'Confirmed',
  declined: 'Declined',
  cancelled: 'Cancelled',
  completed: 'Completed',
  expired: 'Expired',
};

export function getSportsBookingStatusLabel(status: SportsBookingStatus | string): string {
  return SPORTS_STATUS_LABELS[status as SportsBookingStatus] ?? 'Updated';
}

export function getSportsPaymentSummary(
  status: SportsBookingStatus | string,
  paymentMode: 'online' | 'pay_at_venue' | null | undefined,
  paidAt?: string | null,
): string {
  if (paidAt || (paymentMode === 'online' && (status === 'accepted' || status === 'completed'))) return 'Paid online';
  if (status === 'pending_payment' || status === 'awaiting_payment') return 'Online payment due';
  if (paymentMode !== 'online') return 'Pay at venue';
  return 'Online payment';
}

export function isSportsSlotTakenError(message: string): boolean {
  return /(slot|capacity|booking)/i.test(message)
    && /(taken|unavailable|not available|no longer|full|reserved|capacity)/i.test(message);
}
