import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Badge, Card, ErrorState, Header, Input, Screen, SegmentedControl, Skeleton, Text } from '../../components/ui';
import { listBookings, type AdminBooking } from '../../lib/adminApi';
import { formatINR } from '../../lib/money';
import { scheduleLabel } from '../../lib/schedule';
import { useTheme } from '../../theme';

function useAdminBookingsController() {
  const t = useTheme();
  const [filter, setFilter] = useState('active');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<AdminBooking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    void listBookings(filter, q || null).then(setRows).catch((e: Error) => setError(e.message));
  }, [filter, q]);
  useFocusEffect(load);
  return { t, filter, setFilter, q, setQ, rows, error, load };
}

export default function AdminBookingsScreen() {
  const { t, filter, setFilter, q, setQ, rows, error, load } = useAdminBookingsController();
  return (
    <Screen header={<Header title="All bookings" subtitle="Payments and disputes" />}>
      <Input label="Search" placeholder="Booking, name or service" value={q} onChangeText={setQ} />
      <SegmentedControl
        options={[{ value: 'active', label: 'Active' }, { value: 'disputed', label: 'Disputes' }, { value: 'all', label: 'All' }]}
        value={filter}
        onChange={setFilter}
      />
      {error ? <ErrorState message={error} onRetry={load} /> : !rows ? <Skeleton height={420} radius={t.radii.lg} /> : rows.map((b) => (
        <Card key={b.id} onPress={() => router.push({ pathname: '/admin/booking/[id]', params: { id: b.id } })}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text variant="calloutStrong" style={{ flex: 1 }}>{b.category}</Text>
            <Badge label={b.status.replaceAll('_', ' ')} tone={b.status === 'disputed' ? 'danger' : 'neutral'} />
          </View>
          <Text variant="footnote" color="textSecondary">{b.customer} → {b.provider}</Text>
          <Text variant="caption" color="muted">
            {b.city} · {b.scheduled_at ? scheduleLabel(b.scheduled_at) : new Date(b.created_at).toLocaleDateString('en-IN')}
          </Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="calloutStrong">{formatINR(b.total_amount)}</Text>
            <Text variant="footnote" color="muted">Legacy paid total {formatINR(b.paid_paise)}</Text>
          </View>
          <View style={{ gap: t.spacing.xs }}>
            <Text variant="caption" color="muted">
              Cash captured {formatINR(b.cash_captured_paise)} · Coins applied {formatINR(b.coins_applied_paise)}
              {' · Demo captured '}{formatINR(b.demo_captured_paise)}
            </Text>
            <Text variant="caption" color="muted">
              Refund pending {formatINR(b.refund_pending_paise)} · Processing {formatINR(b.refund_processing_paise)}
              {' · Completed '}{formatINR(b.refund_completed_paise)}
              {' · Failed attempts '}{formatINR(b.refund_failed_paise)}
            </Text>
            <Text variant="captionStrong">Net held {formatINR(b.net_held_paise)}</Text>
          </View>
        </Card>
      ))}
    </Screen>
  );
}
