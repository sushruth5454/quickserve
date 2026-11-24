import { router, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Badge, Card, EmptyState, ErrorState, Header, InlineAlert, Screen, Skeleton, Text } from '../../components/ui';
import { listMyCustomerSportsBookings, type CustomerSportsBooking } from '../sports/api';
import {
  getSportsBookingCardPresentation,
  SportsBookingCard,
  type SportsBookingCardBooking,
} from '../sports/SportsBookingCard';
import { useSportsReadRefresh } from '../sports/useSportsReadRefresh';
import { useAuth } from '../../lib/auth';
import { useAppFeatureFlags } from '../../lib/featureFlags';
import { useTheme } from '../../theme';

export function getSportsBookingsCardComposition(sportsUxEnabled: boolean, brandEnabled: boolean): 'family' | 'legacy' {
  return sportsUxEnabled && brandEnabled ? 'family' : 'legacy';
}

export function SportsBookingsHistoryCard({
  booking,
  onPress,
}: {
  booking: SportsBookingCardBooking;
  onPress: () => void;
}) {
  const presentation = getSportsBookingCardPresentation(booking);

  return (
    <Card
      gap={8}
      onPress={onPress}
      accessibilityLabel={`View sports booking for ${booking.venue_name}, ${booking.activity_name}, ${booking.resource_name}, ${presentation.timeRange}`}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text variant="bodyStrong" style={{ flex: 1, minWidth: 0 }}>{booking.venue_name}</Text>
        <Badge label={presentation.statusLabel} tone={presentation.statusTone} />
      </View>
      <Text variant="footnote" color="muted">{booking.activity_name} · {booking.resource_name}</Text>
      <Text variant="calloutStrong">{presentation.timeRange}</Text>
      <Text variant="footnote">
        {presentation.participantsLabel ? `${presentation.participantsLabel} · ` : ''}
        {presentation.amountLabel} · {presentation.paymentSummary}
      </Text>
      {presentation.refundLabel ? (
        <Text variant="caption" color="muted">{presentation.refundLabel}</Text>
      ) : null}
      {presentation.deadlineLabel ? (
        <Text variant="caption" color="muted">{presentation.deadlineLabel}</Text>
      ) : null}
    </Card>
  );
}

export default function SportsBookingsScreen() {
  const t = useTheme();
  const flags = useAppFeatureFlags();
  const cardComposition = getSportsBookingsCardComposition(
    flags.isOn('oorva_sports_ux'),
    flags.isOn('oorva_brand'),
  );
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
          {bookings.map((booking) => (
            <View key={booking.id}>
              {cardComposition === 'family' ? (
                <SportsBookingsHistoryCard
                  booking={booking}
                  onPress={() => router.push(`/sports-booking/${booking.id}` as Href)}
                />
              ) : (
                <SportsBookingCard
                  booking={booking}
                  onPress={() => router.push(`/sports-booking/${booking.id}` as Href)}
                />
              )}
            </View>
          ))}
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
