import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { CategoryIcon, iconForSlug } from '../../src/components/CategoryIcon';
import { activeStatuses, StatusPill } from '../../src/components/status';
import { ProgressBar } from '../../src/components/StatusTimeline';
import { Card, EmptyState, ErrorState, Header, Screen, SegmentedControl, SkeletonCard, Text } from '../../src/components/ui';
import { listMyBookings } from '../../src/lib/api';
import { formatINR } from '../../src/lib/money';
import type { Booking } from '../../src/lib/types';
import { useTheme } from '../../src/theme';

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export default function MyBookings() {
  const t = useTheme();
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [tab, setTab] = useState<'active' | 'past'>('active');
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setBookings(await listMyBookings());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const active = (bookings ?? []).filter((b) => activeStatuses.includes(b.status));
  const past = (bookings ?? []).filter((b) => !activeStatuses.includes(b.status));
  const list = tab === 'active' ? active : past;

  return (
    <Screen
      inTabs
      header={
        <Header title="My bookings" large back={false}>
          <View style={{ paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.md }}>
            <SegmentedControl
              options={[
                { value: 'active', label: 'Active', badge: active.length || undefined },
                { value: 'past', label: 'Past' },
              ]}
              value={tab}
              onChange={setTab}
              accessibilityLabel="Booking filter"
            />
          </View>
        </Header>
      }
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await load();
        setRefreshing(false);
      }}
      gap={t.spacing.md}
    >
      {error && !bookings ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !bookings ? (
        Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} lines={3} />)
      ) : list.length === 0 ? (
        <EmptyState
          icon={tab === 'active' ? 'calendar-outline' : 'time-outline'}
          title={tab === 'active' ? 'No active bookings' : 'No past bookings yet'}
          message={tab === 'active' ? 'Book a verified pro in under a minute.' : 'Completed and cancelled bookings will show up here.'}
          actionLabel={tab === 'active' ? 'Find a service' : undefined}
          onAction={() => router.navigate('/')}
        />
      ) : (
        list.map((b, i) => (
          <Animated.View key={b.id} entering={FadeInDown.delay(Math.min(i, 6) * 40).duration(260)}>
            <Card
              onPress={() => router.push({ pathname: '/booking/[id]', params: { id: b.id } })}
              accessibilityLabel={`${b.categories?.name ?? 'Booking'}, ${b.status.replaceAll('_', ' ')}`}
              gap={t.spacing.md}
            >
              <View style={{ flexDirection: 'row', gap: t.spacing.md, alignItems: 'center' }}>
                <CategoryIcon icon={iconForSlug(b.categories?.slug)} size={46} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {b.categories?.name ?? 'Booking'}
                  </Text>
                  <Text variant="caption" color="muted">
                    #{b.id.slice(0, 8)} · {fmtDate(b.created_at)}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text variant="subhead" tabular>
                    {formatINR(b.total_amount ?? b.visit_fee)}
                  </Text>
                  <Text variant="micro" color="muted" uppercase>
                    {b.total_amount ? 'Total' : 'Visit fee'}
                  </Text>
                </View>
              </View>
              {b.description ? (
                <Text variant="callout" color="textSecondary" numberOfLines={2}>
                  {b.description}
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <StatusPill status={b.status} />
                {b.scheduled_at ? (
                  <Text variant="caption" color="muted">
                    Scheduled {fmtDate(b.scheduled_at)}
                  </Text>
                ) : null}
              </View>
              {tab === 'active' ? <ProgressBar status={b.status} /> : null}
            </Card>
          </Animated.View>
        ))
      )}
    </Screen>
  );
}
