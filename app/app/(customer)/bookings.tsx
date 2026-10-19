import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ErrorText, Screen } from '../../src/components/Screen';
import { statusLabel } from '../../src/components/StatusTimeline';
import { listMyBookings } from '../../src/lib/api';
import { formatINR } from '../../src/lib/money';
import { colors, font, radius, spacing } from '../../src/lib/theme';
import type { Booking } from '../../src/lib/types';

export default function MyBookings() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setBookings(await listMyBookings());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <Screen refreshing={refreshing} onRefresh={load}>
      <ErrorText message={error} />
      {!refreshing && bookings.length === 0 && <Text style={font.caption}>No bookings yet.</Text>}
      {bookings.map((b) => (
        <Pressable
          key={b.id}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/booking/[id]', params: { id: b.id } })}
          style={styles.row}
        >
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Text style={font.heading}>{b.categories?.name ?? 'Booking'}</Text>
            <Text style={font.caption} numberOfLines={1}>
              {b.description || '—'}
            </Text>
            <Text style={font.caption}>{new Date(b.created_at).toLocaleString()}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: spacing.xs }}>
            <Text style={styles.status}>{statusLabel[b.status]}</Text>
            <Text style={font.caption}>{formatINR(b.total_amount ?? b.visit_fee)}</Text>
          </View>
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    padding: spacing.md,
    gap: spacing.md,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  status: { fontSize: 13, fontWeight: '600', color: colors.primary, textAlign: 'right', maxWidth: 140 },
});
