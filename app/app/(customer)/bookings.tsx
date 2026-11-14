import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { CategoryIcon, iconForSlug } from '../../src/components/CategoryIcon';
import { activeStatuses, nextStepCopy, StatusPill } from '../../src/components/status';
import { ProgressBar } from '../../src/components/StatusTimeline';
import { Button, Card, EmptyState, ErrorState, Header, Screen, SegmentedControl, SkeletonBookingCard, Text } from '../../src/components/ui';
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
  const open = (b: Booking) => router.push({ pathname: '/booking/[id]', params: { id: b.id } });

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
        Array.from({ length: 4 }).map((_, i) => <SkeletonBookingCard key={i} />)
      ) : list.length === 0 ? (
        <EmptyState
          icon={tab === 'active' ? 'calendar-outline' : 'time-outline'}
          title={tab === 'active' ? 'No active bookings' : 'No past bookings yet'}
          message={tab === 'active' ? 'Book a verified pro in under a minute.' : 'Completed and cancelled bookings will show up here.'}
          actionLabel={tab === 'active' ? 'Find a service' : undefined}
          onAction={() => router.navigate('/')}
        />
      ) : (
        list.map((b, i) => {
          const done = b.status === 'completed' || b.status === 'closed';
          return (
            <Animated.View key={b.id} entering={FadeInDown.delay(Math.min(i, 6) * 30).duration(240)}>
              <Card onPress={() => open(b)} accessibilityLabel={`${b.categories?.name ?? 'Booking'}, ${b.status.replaceAll('_', ' ')}`}>
                <View style={{ flexDirection: 'row', gap: t.spacing.md, alignItems: 'center' }}>
                  <CategoryIcon icon={iconForSlug(b.categories?.slug)} size={44} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.sm }}>
                      <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
                        {b.categories?.name ?? 'Booking'}
                      </Text>
                      <StatusPill status={b.status} />
                    </View>
                    <Text variant="footnote" color="muted" numberOfLines={1}>
                      #{b.id.slice(0, 8)} · {fmtDate(b.created_at)}
                    </Text>
                  </View>
                </View>
                {b.description ? (
                  <Text variant="footnote" color="textSecondary" numberOfLines={1}>
                    {b.description}
                  </Text>
                ) : null}
                {tab === 'active' ? (
                  <View style={{ gap: 6 }}>
                    <ProgressBar status={b.status} showLabel={false} />
                    {nextStepCopy[b.status] ? (
                      <Text variant="footnote" color="muted" numberOfLines={1}>
                        {nextStepCopy[b.status]}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
                <AmountRow booking={b} chevron={tab === 'active'} />
                {tab === 'active' ? null : (
                  <View style={{ flexDirection: 'row', gap: t.spacing.sm, marginTop: 2 }}>
                    {b.status === 'completed' ? (
                      <Button title="Rate" size="sm" variant="secondary" leftIcon="star-outline" onPress={() => open(b)} style={{ flex: 1 }} />
                    ) : null}
                    <Button
                      title="Book again"
                      size="sm"
                      variant="outline"
                      leftIcon="refresh"
                      onPress={() => router.push({ pathname: '/book/[providerServiceId]', params: { providerServiceId: b.provider_service_id } })}
                      style={{ flex: 1 }}
                    />
                    <Button
                      title={done ? 'Receipt' : 'Details'}
                      size="sm"
                      variant="outline"
                      leftIcon={done ? 'receipt-outline' : 'document-text-outline'}
                      onPress={() => open(b)}
                      style={{ flex: 1 }}
                    />
                  </View>
                )}
              </Card>
            </Animated.View>
          );
        })
      )}
    </Screen>
  );
}

/** Amount + schedule on one hairline-separated row, like a receipt footer. */
function AmountRow({ booking: b, chevron }: { booking: Booking; chevron: boolean }) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: t.spacing.sm,
        paddingTop: t.spacing.sm,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: t.colors.border,
      }}
    >
      <Text variant="footnote" color="muted">
        {b.total_amount ? 'Total ' : 'Visit fee '}
        <Text variant="subheadStrong" color="text" tabular>
          {formatINR(b.total_amount ?? b.visit_fee)}
        </Text>
      </Text>
      {b.scheduled_at ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 }}>
          <Ionicons name="calendar-outline" size={14} color={t.colors.muted} />
          <Text variant="footnote" color="muted" numberOfLines={1}>
            {fmtDate(b.scheduled_at)}
          </Text>
        </View>
      ) : chevron ? (
        <Ionicons name="chevron-forward" size={16} color={t.colors.muted} />
      ) : null}
    </View>
  );
}