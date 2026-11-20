import { sportsVenueBookingReturnTo } from '../bookingPresentation';

describe('sportsVenueBookingReturnTo', () => {
  it('returns to the current venue on the internal venue route', () => {
    expect(sportsVenueBookingReturnTo('venue-123')).toBe('/venue/venue-123');
  });

  it('encodes path separators in a venue id', () => {
    expect(sportsVenueBookingReturnTo('venue/123')).toBe('/venue/venue%2F123');
  });
});
