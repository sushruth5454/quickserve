import type { CreateBookingInput } from '../../../lib/apiTypes';

export type BookingStepKey =
  | 'booking.step.type'
  | 'booking.step.time'
  | 'booking.step.address'
  | 'booking.step.review';

export function getBookingStepKeys(bookingStepsEnabled: unknown, recurringBookingsEnabled: unknown): BookingStepKey[] | null {
  if (bookingStepsEnabled !== true) return null;

  const steps: BookingStepKey[] = [];
  if (recurringBookingsEnabled === true) steps.push('booking.step.type');
  steps.push('booking.step.time', 'booking.step.address', 'booking.step.review');
  return steps;
}

export function buildBookingPayload(input: CreateBookingInput): CreateBookingInput {
  return {
    providerServiceId: input.providerServiceId,
    description: input.description,
    addressLine: input.addressLine,
    city: input.city,
    coords: input.coords,
    scheduledAt: input.scheduledAt,
    photos: input.photos,
    travelRequestId: input.travelRequestId,
  };
}

export interface BookingPricePreview {
  visit_fee: number;
  platform_fee: number;
  package_total: number;
  total: number;
  pay_now: number;
}

export function readPaise(value: unknown): number {
  if (value == null || typeof value === 'boolean') throw new Error('The booking price preview is incomplete');
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('The booking price preview is invalid');
  return amount;
}
