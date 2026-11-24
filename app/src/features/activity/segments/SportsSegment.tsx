import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { EmptyState, ErrorState, Skeleton } from '../../../components/ui';
import { listMyCustomerSportsBookings, type CustomerSportsBooking } from '../../sports/api';
import { SportsBookingCard } from '../../sports/SportsBookingCard';
import { useTheme } from '../../../theme';
import type { MarkRead, RegisterRefresh } from './types';

export function SportsSegment({ registerRefresh, markRead }: { registerRefresh: RegisterRefresh; markRead: MarkRead }) {
  const t = useTheme();
  const [bookings, setBookings] = useState<CustomerSportsBooking[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setBookings(await listMyCustomerSportsBookings());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => registerRefresh(load), [load, registerRefresh]);

  if (error && !bookings) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!bookings) return [0, 1, 2].map((index) => <Skeleton key={index} height={94} radius={t.radii.lg} />);
  if (!bookings.length) {
    return <EmptyState icon="calendar-outline" title="No sports requests yet" message="Your sports booking requests will appear here." />;
  }

  return (
    <View style={{ gap: t.spacing.sm }}>
      {bookings.map((booking) => (
        <SportsBookingCard
          key={booking.id}
          booking={booking}
          onPress={() => {
            void markRead('sports_booking', booking.id).catch(() => undefined);
            router.push({ pathname: '/sports-booking/[id]', params: { id: booking.id } } as Href);
          }}
        />
      ))}
    </View>
  );
}
