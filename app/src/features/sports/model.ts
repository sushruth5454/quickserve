export type SportsBookingMode = 'instant' | 'approval';
export type SportsPaymentMode = 'online' | 'pay_at_venue';

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
