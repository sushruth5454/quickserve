import type {
  CustomerSportsBookingDetail,
  SportsBookingStatus,
  SportsPaymentMode,
  SportsSlotAvailability,
} from './api';
import { formatINR } from '../../lib/money';

export type { SportsPaymentMode, SportsSlotAvailability } from './api';
export type SportsBookingMode = 'instant' | 'approval';

export interface SportsSlotCellState {
  visible: boolean;
  selected: boolean;
  selectable: boolean;
  unavailable: boolean;
}

export function slotCellState(
  slot: Pick<SportsSlotAvailability, 'starts_at' | 'state'>,
  selectedIds: readonly string[],
): SportsSlotCellState {
  if (slot.state === 'past') {
    return { visible: false, selected: false, selectable: false, unavailable: false };
  }
  if (slot.state !== 'free') {
    return { visible: true, selected: false, selectable: false, unavailable: true };
  }
  return {
    visible: true,
    selected: selectedIds.includes(slot.starts_at),
    selectable: true,
    unavailable: false,
  };
}

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

export type SportsBookingDeadlineKind = 'request' | 'hold' | 'payment' | null;
export type SportsBookingNextAction = 'pay' | 'view_request' | 'view_booking';

export interface SportsBookingActions {
  canPay: boolean;
  canDecide: boolean;
  canCancel: boolean;
  applicableDeadline: string | null;
  deadlineKind: SportsBookingDeadlineKind;
  nextAction: SportsBookingNextAction;
}

export function getSportsBookingActions(input: {
  booking: Pick<
    CustomerSportsBookingDetail,
    | 'status'
    | 'customer_id'
    | 'owner_id'
    | 'payment_mode'
    | 'paid_at'
    | 'hold_expires_at'
    | 'pay_by'
    | 'expires_at'
    | 'starts_at'
  > | null;
  viewerId: string | null | undefined;
  now: Date;
}): SportsBookingActions {
  const { booking, viewerId, now } = input;
  if (!booking) {
    return {
      canPay: false,
      canDecide: false,
      canCancel: false,
      applicableDeadline: null,
      deadlineKind: null,
      nextAction: 'view_booking',
    };
  }

  const nowMs = now.getTime();
  const finiteDate = (value: string | null | undefined): number | null => {
    if (typeof value !== 'string' || value.trim() === '') return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const isCustomer = !!viewerId && booking.customer_id === viewerId;
  const isOwner = !!viewerId && booking.owner_id === viewerId;
  const isActive = ['requested', 'pending_payment', 'awaiting_payment', 'accepted'].includes(booking.status);

  let deadlineValue: string | null | undefined = null;
  let deadlineKind: SportsBookingDeadlineKind = null;
  if (booking.status === 'requested') {
    deadlineValue = booking.expires_at;
    deadlineKind = 'request';
  } else if (booking.status === 'pending_payment') {
    deadlineValue = booking.hold_expires_at;
    deadlineKind = 'hold';
  } else if (booking.status === 'awaiting_payment') {
    deadlineValue = booking.pay_by;
    deadlineKind = 'payment';
  }

  const deadlineMs = finiteDate(deadlineValue);
  const applicableDeadline = deadlineMs == null ? null : deadlineValue ?? null;
  const liveDeadline = Number.isFinite(nowMs) && deadlineMs != null && deadlineMs > nowMs;
  const startsAtMs = finiteDate(booking.starts_at);
  const canPay = isCustomer
    && booking.payment_mode === 'online'
    && booking.paid_at == null
    && canContinueSportsCheckout(booking.status)
    && liveDeadline;
  const canDecide = isOwner && booking.status === 'requested' && liveDeadline;
  const canCancel = isActive && (
    isOwner
    || (isCustomer && Number.isFinite(nowMs) && startsAtMs != null && startsAtMs > nowMs)
  );

  return {
    canPay,
    canDecide,
    canCancel,
    applicableDeadline,
    deadlineKind,
    nextAction: canPay ? 'pay' : booking.status === 'requested' ? 'view_request' : 'view_booking',
  };
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

export function getSportsBookingDeadline(booking: {
  status: string;
  expires_at?: string | null;
  hold_expires_at?: string | null;
  pay_by?: string | null;
}): { kind: Exclude<SportsBookingDeadlineKind, null>; label: string; value: string } | null {
  let value: string | null | undefined;
  let kind: Exclude<SportsBookingDeadlineKind, null>;
  let label: string;

  if (booking.status === 'requested') {
    value = booking.expires_at;
    kind = 'request';
    label = 'Venue response due by';
  } else if (booking.status === 'pending_payment') {
    value = booking.hold_expires_at;
    kind = 'hold';
    label = 'Payment due by';
  } else if (booking.status === 'awaiting_payment') {
    value = booking.pay_by;
    kind = 'payment';
    label = 'Payment due by';
  } else {
    return null;
  }

  if (typeof value !== 'string' || value.trim() === '' || !Number.isFinite(Date.parse(value))) return null;
  return { kind, label, value };
}

export function getSportsPaymentSummary(
  status: SportsBookingStatus | string,
  paymentMode: 'online' | 'pay_at_venue' | null | undefined,
  paidAt?: string | null,
): string {
  if (paymentMode === 'pay_at_venue') return 'Pay at venue';
  if (status === 'pending_payment' || status === 'awaiting_payment') return 'Online payment due';
  if (paymentMode === 'online' && (paidAt || status === 'accepted' || status === 'completed')) return 'Paid online';
  if (paymentMode !== 'online') return 'Payment details unavailable';
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

export function getSportsCancellationConfirmationMessage(refundPaise: number): string {
  return `You will get ${formatINR(refundPaise)} back.`;
}

export function getSportsCancellationPolicyLabel(policy: {
  full_refund_hours: number | null;
  partial_refund_hours: number | null;
  partial_refund_bp: number | null;
} | null | undefined): string | null {
  if (!policy
    || policy.full_refund_hours == null
    || policy.partial_refund_hours == null
    || policy.partial_refund_bp == null
    || !Number.isInteger(policy.full_refund_hours)
    || !Number.isInteger(policy.partial_refund_hours)
    || !Number.isInteger(policy.partial_refund_bp)
    || policy.full_refund_hours < policy.partial_refund_hours
    || policy.partial_refund_bp < 0
    || policy.partial_refund_bp > 10000) return null;
  const whole = Math.floor(policy.partial_refund_bp / 100);
  const fraction = policy.partial_refund_bp % 100;
  const percent = `${whole}${fraction ? `.${String(fraction).padStart(2, '0')}` : ''}%`;
  return `Online cancellations: full service refund at least ${policy.full_refund_hours}h ahead; ${percent} service refund from ${policy.partial_refund_hours}h to ${policy.full_refund_hours}h; no service refund under ${policy.partial_refund_hours}h.`;
}

export function getUpcomingVenueBookings<T extends { status: string; starts_at: string }>(
  rows: readonly T[],
  now: Date,
): T[] {
  const activeStatuses = new Set(['accepted', 'pending_payment', 'awaiting_payment']);
  const nowMs = now.getTime();
  return rows
    .filter((row) => {
      const startsAtMs = Date.parse(row.starts_at);
      return activeStatuses.has(row.status) && Number.isFinite(startsAtMs) && startsAtMs >= nowMs;
    })
    .slice()
    .sort((left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at));
}

export function formatSportsDuration(slotCount: number, slotMinutes: number): string {
  if (!Number.isInteger(slotCount) || slotCount < 1 || !Number.isInteger(slotMinutes) || slotMinutes < 1) return '';
  const minutes = slotCount * slotMinutes;
  return minutes < 60 ? `${minutes} min` : `${minutes / 60} hr`;
}

export function getSportsEstimatedTotal(
  slots: readonly SportsSlotAvailability[],
  selectedStart: string | null,
  duration: number,
): number | null {
  if (!selectedStart || !Number.isInteger(duration) || duration < 1) return null;
  const startIndex = slots.findIndex((slot) => slot.starts_at === selectedStart);
  if (startIndex < 0) return null;
  const selectedSlots = slots.slice(startIndex, startIndex + duration);
  if (selectedSlots.length !== duration) return null;

  let total = 0;
  for (let index = 0; index < selectedSlots.length; index += 1) {
    const slot = selectedSlots[index];
    if (!slot || slot.state !== 'free'
      || slot.price_paise == null || !Number.isInteger(slot.price_paise) || slot.price_paise < 0) return null;
    if (index > 0) {
      const previous = selectedSlots[index - 1];
      if (!previous || Date.parse(previous.ends_at) !== Date.parse(slot.starts_at)) return null;
    }
    total += slot.price_paise;
  }
  return total;
}

export function isSportsTimeValid(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function sportsTimeMinutes(value: string): number | null {
  if (!isSportsTimeValid(value)) return null;
  const [hours, minutes] = value.split(':').map(Number);
  return hours === undefined || minutes === undefined ? null : hours * 60 + minutes;
}

export function isSportsTimeRangeValid(starts: string, ends: string): boolean {
  const startMinutes = sportsTimeMinutes(starts);
  const endMinutes = sportsTimeMinutes(ends);
  return startMinutes !== null && endMinutes !== null && startMinutes < endMinutes;
}

export function isSportsDateValid(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}
