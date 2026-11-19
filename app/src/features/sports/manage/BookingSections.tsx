import { router, type Href } from 'expo-router';
import { Pressable } from 'react-native';
import { Button, Card, EmptyState, Header, InlineAlert, Screen, Text } from '../../../components/ui';
import { formatINR } from '../../../lib/money';
import {
  getSportsBookingStatusLabel,
  getSportsPaymentSummary,
} from '../model';
import { slotLabel } from './model';
import type { SportsBookingRow } from './types';

export function renderAssignedBookings(venueName: string, venueBookings: SportsBookingRow[], gap: number) {
  return (
    <Screen header={<Header title="Assigned sports bookings" subtitle={`${venueName} · read-only`} onBack={() => router.back()} />}>
      <Text variant="footnote" color="muted">Staff can view sports bookings. Only the venue owner can edit venue details, prices, hours, or respond to requests.</Text>
      <Button title="All assigned business work" variant="outline" onPress={() => router.push('/merchant-work')} />
      <Card gap={gap}>
        <Text variant="title3">Bookings</Text>
        {venueBookings.length === 0 ? (
          <EmptyState icon="calendar-outline" title="No bookings" message="Bookings for this venue will appear here." compact />
        ) : venueBookings.map((booking) => (
          <Pressable key={booking.id} onPress={() => router.push(`/sports-booking/${booking.id}` as Href)}>
            <Text variant="footnoteStrong">{booking.customer_name || 'Customer'} · {booking.activity_name} / {booking.resource_name}</Text>
            <Text variant="caption" color="muted">{slotLabel(booking.starts_at)} · {booking.status.toUpperCase()}</Text>
          </Pressable>
        ))}
      </Card>
    </Screen>
  );
}

export function renderExistingBookings(bookings: SportsBookingRow[], error: string | null, gap: number) {
  return (
    <>
      <InlineAlert message="Sports & venues are turned off. Existing bookings remain available below." />
      {error ? <InlineAlert message={error} /> : null}
      <Card gap={gap}>
        <Text variant="title3">Existing sports bookings</Text>
        {bookings.length === 0 ? (
          <EmptyState icon="calendar-outline" title="No existing bookings" message="Sports bookings will appear here." compact />
        ) : bookings.map((booking) => (
          <Pressable key={booking.id} onPress={() => router.push(`/sports-booking/${booking.id}` as Href)}>
            <Text variant="footnoteStrong">{booking.customer_name || 'Customer'} · {booking.activity_name} / {booking.resource_name}</Text>
            <Text variant="caption" color="muted">
              {slotLabel(booking.starts_at)} · {getSportsBookingStatusLabel(booking.status)}
            </Text>
            <Text variant="caption" color="muted">
              {formatINR(booking.total_paise ?? booking.price_paise)} · {getSportsPaymentSummary(booking.status, booking.payment_mode, booking.paid_at)}
            </Text>
          </Pressable>
        ))}
      </Card>
    </>
  );
}

export function renderVenueBookingLists(
  myRequests: SportsBookingRow[],
  upcomingBookings: SportsBookingRow[],
  gap: number,
) {
  return (
    <>
      <Card gap={gap}>
        <Text variant="title3">Booking requests</Text>
        {myRequests.length === 0 ? (
          <EmptyState icon="mail-outline" title="No pending requests" message="New customer requests will appear here." compact />
        ) : myRequests.map((booking) => (
          <Pressable key={booking.id} onPress={() => router.push(`/sports-booking/${booking.id}` as Href)}>
            <Text variant="footnoteStrong">{booking.customer_name || 'Customer'} · {booking.activity_name} / {booking.resource_name}</Text>
            <Text variant="caption" color="muted">{slotLabel(booking.starts_at)} · ₹{(booking.price_paise / 100).toFixed(2)} · Respond by opening request</Text>
          </Pressable>
        ))}
      </Card>
      <Card gap={gap}>
        <Text variant="title3">Upcoming bookings</Text>
        {upcomingBookings.length === 0 ? (
          <EmptyState icon="calendar-outline" title="No upcoming bookings" message="Confirmed and payment-due bookings will appear here." compact />
        ) : upcomingBookings.map((booking) => (
          <Pressable key={booking.id} onPress={() => router.push(`/sports-booking/${booking.id}` as Href)}>
            <Text variant="footnoteStrong">{booking.customer_name || 'Customer'} · {booking.activity_name} / {booking.resource_name}</Text>
            <Text variant="caption" color="muted">
              {slotLabel(booking.starts_at)} · {getSportsBookingStatusLabel(booking.status)} · {getSportsPaymentSummary(booking.status, booking.payment_mode, booking.paid_at)}
            </Text>
          </Pressable>
        ))}
      </Card>
    </>
  );
}
