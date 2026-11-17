import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Card, EmptyState, ErrorState, Header, InlineAlert, Screen, Skeleton, Text } from '../../src/components/ui';
import { useAppFeatureFlags } from '../../src/lib/featureFlags';
import { formatINR } from '../../src/lib/money';
import { supabase } from '../../src/lib/supabase';
import { useTheme } from '../../src/theme';

interface SportsBookingRow {
  id: string;
  venue_name: string;
  resource_name: string;
  activity_name: string;
  starts_at: string;
  ends_at: string;
  status: string;
  price_paise: number;
  expires_at: string;
}

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

export default function MySportsBookingsScreen() {
  const t = useTheme();
  const flags = useAppFeatureFlags();
  const enabled = flags.isOn('sports');
  const [bookings, setBookings] = useState<SportsBookingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('get_my_sports_bookings');
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setBookings((data ?? []) as SportsBookingRow[]);
  }, [enabled]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <Screen header={<Header title="My sports requests" onBack={() => router.back()} />}>
      {!enabled ? (
        <InlineAlert message="Sports & venues are turned off right now." />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !bookings ? (
        [0, 1, 2].map((i) => <Skeleton key={i} height={94} radius={t.radii.lg} />)
      ) : bookings.length === 0 ? (
        <EmptyState icon="calendar-outline" title="No sports requests yet" message="Your sports booking requests will appear here." />
      ) : (
        <View style={{ gap: t.spacing.sm }}>
          {bookings.map((booking) => (
            <Pressable key={booking.id} accessibilityRole="button" onPress={() => router.push(`/sports-booking/${booking.id}` as Href)}>
              <Card gap={t.spacing.xs}>
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
            </Pressable>
          ))}
        </View>
      )}
    </Screen>
  );
}
