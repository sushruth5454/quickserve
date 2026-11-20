export function sportsVenueBookingReturnTo(venueId: string): string {
  return `/venue/${encodeURIComponent(venueId)}`;
}
