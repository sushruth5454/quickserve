import { router, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { EmptyState, ErrorState, Header, InlineAlert, Screen, Skeleton } from '../../components/ui';
import { listMyCustomerSportsBookings, type CustomerSportsBooking } from '../sports/api';
import { SportsBookingCard } from '../sports/SportsBookingCard';
import { useSportsReadRefresh } from '../sports/useSportsReadRefresh';
import { useAuth } from '../../lib/auth';
import { useTheme } from '../../theme';

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
          {bookings.map((booking) => (
            <SportsBookingCard
              key={booking.id}
              booking={booking}
              onPress={() => router.push(`/sports-booking/${booking.id}` as Href)}
            />
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
