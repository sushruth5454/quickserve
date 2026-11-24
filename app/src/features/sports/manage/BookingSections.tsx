import { router, type Href } from 'expo-router';
import { View } from 'react-native';
import { Button, EmptyState, InlineAlert, Text } from '../../../components/ui';
import { SportsBookingCard } from '../SportsBookingCard';
import type { SportsBookingRow } from './types';

export function renderAssignedBookings(venueName: string, venueBookings: SportsBookingRow[], gap: number) {
  return (
    <View style={{ gap }}>
      <Text variant="title3">Assigned sports bookings · {venueName}</Text>
      <Text variant="footnote" color="muted">Staff can view sports bookings. Only the venue owner can edit venue details, prices, hours, or respond to requests.</Text>
      <Button title="All assigned business work" variant="outline" onPress={() => router.push('/merchant-work')} />
      <Text variant="title3">Bookings</Text>
      {venueBookings.length === 0 ? (
        <EmptyState icon="calendar-outline" title="No bookings" message="Bookings for this venue will appear here." compact />
      ) : venueBookings.map((booking) => (
        <SportsBookingCard
          key={booking.id}
          booking={booking}
          showCustomer
          onPress={() => router.push(`/sports-booking/${booking.id}` as Href)}
        />
      ))}
    </View>
  );
}

export function renderExistingBookings(bookings: SportsBookingRow[], error: string | null, gap: number) {
  return (
    <>
      <InlineAlert message="Sports & venues are turned off. Existing bookings remain available below." />
      {error ? <InlineAlert message={error} /> : null}
      <View style={{ gap }}>
        <Text variant="title3">Existing sports bookings</Text>
        {bookings.length === 0 ? (
          <EmptyState icon="calendar-outline" title="No existing bookings" message="Sports bookings will appear here." compact />
        ) : bookings.map((booking) => (
          <SportsBookingCard
            key={booking.id}
            booking={booking}
            onPress={() => router.push(`/sports-booking/${booking.id}` as Href)}
          />
        ))}
      </View>
    </>
  );
}

export function renderVenueBookingLists(
  myRequests: SportsBookingRow[],
  upcomingBookings: SportsBookingRow[],
  gap: number,
) {
  return (
    <View style={{ gap }}>
      <Text variant="title3">Booking requests</Text>
      {myRequests.length === 0 ? (
        <EmptyState icon="mail-outline" title="No pending requests" message="New customer requests will appear here." compact />
      ) : myRequests.map((booking) => (
        <SportsBookingCard
          key={booking.id}
          booking={booking}
          showCustomer
          onPress={() => router.push(`/sports-booking/${booking.id}` as Href)}
        />
      ))}
      <Text variant="title3">Upcoming bookings</Text>
      {upcomingBookings.length === 0 ? (
        <EmptyState icon="calendar-outline" title="No upcoming bookings" message="Confirmed and payment-due bookings will appear here." compact />
      ) : upcomingBookings.map((booking) => (
        <SportsBookingCard
          key={booking.id}
          booking={booking}
          showCustomer
          onPress={() => router.push(`/sports-booking/${booking.id}` as Href)}
        />
      ))}
    </View>
  );
}
