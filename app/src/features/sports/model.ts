import type { SportsBookingStatus, SportsPaymentMode, SportsSlotAvailability } from './api';

export type { SportsPaymentMode, SportsSlotAvailability } from './api';
export type SportsBookingMode = 'instant' | 'approval';

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

interface SportsVenueSettingsVisibilityInput {
  isVenueOwner: boolean;
  instantBookingEnabled: boolean;
  capacitySlotsEnabled: boolean;
  onlinePaymentsEnabled: boolean;
  payoutAccountReady: boolean;
}

export function getSportsVenueSettingsVisibility({
  isVenueOwner,
  instantBookingEnabled,
  capacitySlotsEnabled,
  onlinePaymentsEnabled,
  payoutAccountReady,
}: SportsVenueSettingsVisibilityInput) {
  const showOnlinePaymentOption = isVenueOwner && onlinePaymentsEnabled;
  return {
    canEdit: isVenueOwner,
    canEditBookingMode: isVenueOwner && instantBookingEnabled,
    canEditCapacity: isVenueOwner && capacitySlotsEnabled,
    showPaymentModes: isVenueOwner,
    showOnlinePaymentOption,
    canSelectOnlinePayment: showOnlinePaymentOption && payoutAccountReady,
    showPayoutStatus: showOnlinePaymentOption,
    showPayoutSetup: showOnlinePaymentOption && !payoutAccountReady,
    payAtVenueAvailable: isVenueOwner,
  };
}

export function resolveSportsVenuePaymentModes(
  configuredModes: readonly SportsPaymentMode[] | null | undefined,
): SportsPaymentMode[] {
  const savedModes = (configuredModes ?? []).filter((mode) => mode === 'pay_at_venue' || mode === 'online');
  return savedModes.length > 0 ? savedModes : ['pay_at_venue'];
}

export function resolveSportsVenuePaymentModesForSave(
  configuredModes: readonly SportsPaymentMode[] | null | undefined,
  selectedModes: readonly SportsPaymentMode[],
  canSelectOnlinePayment: boolean,
): SportsPaymentMode[] {
  const modesToSave = canSelectOnlinePayment
    ? [...selectedModes]
    : [
        ...((configuredModes ?? []).includes('online') ? ['online' as const] : []),
        ...(selectedModes.includes('pay_at_venue') ? ['pay_at_venue' as const] : []),
      ];
  return modesToSave.length > 0 ? modesToSave : ['pay_at_venue'];
}

export function isSportsCapacityValid(value: string | number): boolean {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100;
}

export function resolveSportsResourceSettings(
  bookingMode: SportsBookingMode,
  capacity: string | number,
  instantBookingEnabled: boolean,
  capacitySlotsEnabled: boolean,
  storedSettings?: { bookingMode?: SportsBookingMode; capacity?: number },
): { bookingMode: SportsBookingMode; capacity: number } {
  return {
    bookingMode: instantBookingEnabled ? bookingMode : (storedSettings?.bookingMode ?? 'approval'),
    capacity: capacitySlotsEnabled ? Number(capacity) : (storedSettings?.capacity ?? 1),
  };
}

export function getSportsHomePaymentNotice(onlinePaymentsEnabled: boolean): string {
  return onlinePaymentsEnabled
    ? 'Pay at the venue or online where available.'
    : 'Pay at the venue. QuickServe does not collect sports booking payments.';
}
