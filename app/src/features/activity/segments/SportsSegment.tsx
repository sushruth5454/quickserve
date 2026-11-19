import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Card, EmptyState, ErrorState, Skeleton, Text } from '../../../components/ui';
import { formatINR } from '../../../lib/money';
import { listMyCustomerSportsBookings, type CustomerSportsBooking } from '../../sports/api';
import { useTheme } from '../../../theme';
import { slotLabel } from '../model';
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
        <Card
          key={booking.id}
          onPress={() => {
            void markRead('sports_booking', booking.id).catch(() => undefined);
            router.push({ pathname: '/sports-booking/[id]', params: { id: booking.id } } as Href);
          }}
          gap={t.spacing.xs}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
            <Text variant="bodyStrong" style={{ flex: 1 }}>{booking.venue_name}</Text>
            <Text variant="captionStrong" color={booking.status === 'accepted' ? 'successText' : 'muted'}>
              {booking.status.toUpperCase()}
            </Text>
          </View>
          <Text variant="footnote" color="muted">{booking.activity_name} · {booking.resource_name}</Text>
          <Text variant="footnote">
            {slotLabel(booking.starts_at)} · {formatINR(booking.price_paise)} · {booking.status === 'accepted' ? 'Pay at venue' : 'No online payment'}
          </Text>
          {booking.status === 'requested' ? (
            <Text variant="caption" color="muted">Owner response due by {slotLabel(booking.expires_at)}</Text>
          ) : null}
        </Card>
      ))}
    </View>
  );
}
