import { buildBookingPayload, getBookingStepKeys, readPaise } from '../model';

describe('booking step layout model', () => {
  it.each([false, undefined, null, 'true', 1])('keeps the existing layout for an off or unknown booking_steps value %p', (value) => {
    expect(getBookingStepKeys(value, true)).toBeNull();
  });

  it('omits the booking type step when recurring bookings are off', () => {
    expect(getBookingStepKeys(true, false)).toEqual([
      'booking.step.time',
      'booking.step.address',
      'booking.step.review',
    ]);
  });

  it('includes booking type when both booking features are on', () => {
    expect(getBookingStepKeys(true, true)).toEqual([
      'booking.step.type',
      'booking.step.time',
      'booking.step.address',
      'booking.step.review',
    ]);
  });
});

describe('booking request model', () => {
  it('preserves the create-booking payload for the enabled step layout', () => {
    const scheduledAt = new Date('2026-12-01T10:00:00.000Z');
    const input = {
      providerServiceId: 'service-1',
      description: 'Repair the kitchen tap',
      addressLine: '12 Main Street',
      city: 'Hyderabad',
      coords: { lat: 17.385, lng: 78.4867 },
      scheduledAt,
      photos: ['jobs/photo-1.jpg'],
      travelRequestId: 'travel-1',
    };

    expect(buildBookingPayload(input)).toEqual(input);
  });
});

describe('booking price preview model', () => {
  it.each([[0, 0], ['2900', 2900], [102800, 102800]])('reads valid paise value %p', (value, expected) => {
    expect(readPaise(value)).toBe(expected);
  });

  it.each([null, undefined, true, false])('rejects incomplete price value %p', (value) => {
    expect(() => readPaise(value)).toThrow('The booking price preview is incomplete');
  });

  it.each(['not a number', -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid price value %p',
    (value) => {
      expect(() => readPaise(value)).toThrow('The booking price preview is invalid');
    },
  );
});
