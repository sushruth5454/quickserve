import { router, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Card, EmptyState, ErrorState, Header, InlineAlert, Screen, Skeleton, Text } from '../../components/ui';
import { listMyCustomerSportsBookings, type CustomerSportsBooking } from '../sports/api';
import { getSportsBookingStatusLabel, getSportsPaymentSummary } from '../sports/model';
import { useSportsReadRefresh } from '../sports/useSportsReadRefresh';
import { useAuth } from '../../lib/auth';
import { formatINR } from '../../lib/money';
import { useTheme } from '../../theme';

function slotLabel(value: string) {
  return new Date(value).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function SportsBookingsScreen() {
  const t = useTheme();
  const { bookings, error, refresh } = useSportsBookingsController();

  return (
    <Screen header={<Header
      title="My sports bookings"
      onBack={() => router.canGoBack() ? router.back() : router.replace('/sports' as Href)}
    />}>
      {error && !bookings ? (
        <ErrorState message={error} onRetry={() => void refresh()} />
      ) : !bookings ? (
        [0, 1, 2].map((i) => <Skeleton key={i} height={94} radius={t.radii.lg} />)
      ) : bookings.length === 0 ? (
        <EmptyState icon="calendar-outline" title="No sports bookings yet" message="Your sports bookings will appear here." />
      ) : (
        <View style={{ gap: t.spacing.sm }}>
          {bookings.map((booking) => {
            const deadline = booking.status === 'pending_payment'
              ? booking.hold_expires_at ?? booking.expires_at
              : booking.pay_by ?? booking.expires_at;
            return (
              <Pressable key={booking.id} accessibilityRole="button" onPress={() => router.push(`/sports-booking/${booking.id}` as Href)}>
                <Card gap={t.spacing.xs}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
                    <Text variant="bodyStrong" style={{ flex: 1 }}>{booking.venue_name}</Text>
                    <Text variant="captionStrong" color={booking.status === 'accepted' ? 'successText' : 'muted'}>
                      {getSportsBookingStatusLabel(booking.status)}
                    </Text>
                  </View>
                  <Text variant="footnote" color="muted">{booking.activity_name} · {booking.resource_name}</Text>
                  <Text variant="footnote">{slotLabel(booking.starts_at)}</Text>
                  <Text variant="footnote">
                    {formatINR(booking.total_paise ?? booking.price_paise)}
                    {' · '}
                    {getSportsPaymentSummary(booking.status, booking.payment_mode, booking.paid_at)}
                  </Text>
                  {booking.refund_paise ? (
                    <Text variant="caption" color="muted">Refund · {formatINR(booking.refund_paise)}</Text>
                  ) : null}
                  {deadline && ['requested', 'pending_payment', 'awaiting_payment'].includes(booking.status) ? (
                    <Text variant="caption" color="muted">
                      {booking.status === 'requested' ? 'Venue response due by ' : 'Payment due by '}{slotLabel(deadline)}
                    </Text>
                  ) : null}
                </Card>
              </Pressable>
            );
          })}
        </View>
      )}
      <InlineAlert message={error && bookings ? error : null} />
    </Screen>
  );
}

function useSportsBookingsController() {
  const { userId } = useAuth();
  const [bookings, setBookings] = useState<CustomerSportsBooking[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (guard: { isCurrent: () => boolean }) => {
    try {
      const next = await listMyCustomerSportsBookings();
      if (!guard.isCurrent()) return;
      setBookings(next);
      setError(null);
    } catch (caught) {
      if (guard.isCurrent()) setError((caught as Error).message);
    }
  }, []);
  const { refresh } = useSportsReadRefresh(load, {
    contextKey: `my-sports-bookings:${userId ?? ''}`,
    enabled: true,
    intervalMs: 60_000,
  });
  return { bookings, error, refresh };
}
