import { router, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Button, EmptyState, InlineAlert, Text } from '../../../components/ui';
import { SportsBookingCard } from '../SportsBookingCard';
import type { SportsVenueBookingSections } from '../model';
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
  bookings: SportsVenueBookingSections<SportsBookingRow>,
  gap: number,
) {
  return (
    <View style={{ gap }}>
      <Text variant="title3">Booking requests</Text>
      {bookings.requests.length === 0 ? (
        <EmptyState icon="mail-outline" title="No pending requests" message="New customer requests will appear here." compact />
      ) : bookings.requests.map((booking) => (
        <SportsBookingCard
          key={booking.id}
          booking={booking}
          showCustomer
          onPress={() => router.push(`/sports-booking/${booking.id}` as Href)}
        />
      ))}
      <Text variant="title3">Current bookings</Text>
      {bookings.current.length === 0 ? (
        <EmptyState icon="calendar-outline" title="No current bookings" message="Bookings in progress will appear here." compact />
      ) : bookings.current.map((booking) => (
        <SportsBookingCard
          key={booking.id}
          booking={booking}
          showCustomer
          onPress={() => router.push(`/sports-booking/${booking.id}` as Href)}
        />
      ))}
      <Text variant="title3">Upcoming bookings</Text>
      {bookings.upcoming.some((booking) => booking.status === 'pending_payment' || booking.status === 'awaiting_payment') ? (
        <Text variant="caption" color="muted">Payment-due bookings are held, not confirmed.</Text>
      ) : null}
      {bookings.upcoming.length === 0 ? (
        <EmptyState icon="calendar-outline" title="No upcoming bookings" message="Accepted and payment-due bookings will appear here." compact />
      ) : bookings.upcoming.map((booking) => (
        <SportsBookingCard
          key={booking.id}
          booking={booking}
          showCustomer
          onPress={() => router.push(`/sports-booking/${booking.id}` as Href)}
        />
      ))}
      <Text variant="title3">Booking history</Text>
      {bookings.history.length === 0 ? (
        <EmptyState icon="time-outline" title="No booking history" message="Past and terminal bookings will appear here." compact />
      ) : bookings.history.map((booking) => (
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

export function renderOwnerManagementSections(
  selectorStatus: ReactNode,
  bookingSections: ReactNode,
  editorSections: ReactNode,
  familyPresentationEnabled: boolean,
) {
  return familyPresentationEnabled
    ? <>{selectorStatus}{bookingSections}{editorSections}</>
    : <>{selectorStatus}{editorSections}{bookingSections}</>;
}
