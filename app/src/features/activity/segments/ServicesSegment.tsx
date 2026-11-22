import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { CategoryIcon, iconForSlug } from '../../../components/CategoryIcon';
import { activeStatuses, nextStepCopy, StatusPill, statusShort } from '../../../components/status';
import { ProgressBar } from '../../../components/StatusTimeline';
import { UnreadMessagesRow } from '../../../components/UnreadChat';
import { Button, Card, Chip, EmptyState, ErrorState, InlineAlert, SegmentedControl, SkeletonBookingCard, Skeleton, Text, useToast } from '../../../components/ui';
import { getPayments, getProviderService, listMyBookings } from '../../../lib/api';
import { useT } from '../../../i18n';
import { useAppFeatureFlags } from '../../../lib/featureFlags';
import { formatINR } from '../../../lib/money';
import { bookingRef, scheduleLabel } from '../../../lib/schedule';
import type { Booking } from '../../../lib/types';
import { useUnread } from '../../../lib/unreadContext';
import { useTheme } from '../../../theme';
import { activityReceiptLabel, shouldShowPaymentReceipt } from '../../receipts/formatReceipt';
import { listMyRecurringPlans } from '../../recurring/api';
import { shouldShowRepeatPlansFilter } from '../../recurring/customerPresentation';
import { nextActivityPlanOccurrence } from '../model';
import { bookAgainRoute, shouldShowBookAgain } from '../bookAgain';
import { fmtDate, parseActivityPlans, planFrequencyLabel, type ActivityPlanSummary } from '../model';
import type { MarkRead, RegisterRefresh } from './types';

export function ServicesSegment({ registerRefresh, markRead }: { registerRefresh: RegisterRefresh; markRead: MarkRead }) {
  const t = useTheme();
  const translate = useT();
  const toast = useToast();
  const flags = useAppFeatureFlags();
  const bookAgainEnabled = flags.isOn('book_again');
  const recurringEnabled = flags.isOn('recurring_bookings');
  const receiptsEnabled = flags.isOn('payment_receipts');
  const unread = useUnread();
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [plans, setPlans] = useState<ActivityPlanSummary[] | null>(null);
  const [tab, setTab] = useState<'active' | 'past' | 'plans'>('active');
  const [error, setError] = useState<string | null>(null);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [plansLoading, setPlansLoading] = useState(true);

  const load = useCallback(async () => {
    setPlansLoading(true);
    setPlansError(null);
    try {
      const [bookingResult, planResult] = await Promise.allSettled([
        listMyBookings(),
        listMyRecurringPlans(),
      ]);
      if (bookingResult.status === 'fulfilled') {
        setBookings(bookingResult.value);
        setError(null);
      } else {
        setError((bookingResult.reason as Error).message);
      }
      if (planResult.status === 'fulfilled') {
        setPlans(parseActivityPlans(planResult.value));
      } else {
        setPlansError((planResult.reason as Error).message);
      }
    } finally {
      setPlansLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => registerRefresh(load), [load, registerRefresh]);

  const active = (bookings ?? []).filter((booking) => activeStatuses.includes(booking.status));
  const past = (bookings ?? []).filter((booking) => !activeStatuses.includes(booking.status));
  const list = tab === 'active' ? active : past;
  const showPlansFilter = shouldShowRepeatPlansFilter(
    recurringEnabled,
    plans?.length ?? 0,
    plans === null || plansLoading || !!plansError,
  );
  useEffect(() => {
    if (tab === 'plans' && !showPlansFilter) setTab('active');
  }, [tab, showPlansFilter]);
  const open = (booking: Booking) => {
    void markRead('booking', booking.id).catch(() => undefined);
    router.push({ pathname: '/booking/[id]', params: { id: booking.id } });
  };
  const openReceipt = async (booking: Booking) => {
    try {
      const payment = (await getPayments(booking.id))
        .filter((item) => shouldShowPaymentReceipt(true, item))
        .at(-1);
      if (payment) {
        router.push({ pathname: '/receipt/[paymentId]', params: { paymentId: payment.id } });
        return;
      }
    } catch {
      // Keep booking details available if receipt lookup is temporarily unavailable.
    }
    open(booking);
  };
  const openBookAgain = async (booking: Booking) => {
    if (!shouldShowBookAgain(booking, bookAgainEnabled)) return;
    try {
      const service = await getProviderService(booking.provider_service_id);
      const target = bookAgainRoute(booking, service.active);
      if (target) router.push(target);
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : translate('error.generic'),
        tone: 'error',
      });
    }
  };

  return (
    <>
      <SegmentedControl
        options={[
          { value: 'active', label: 'Active', badge: active.length || undefined },
          { value: 'past', label: 'Past' },
          ...(showPlansFilter ? [{ value: 'plans' as const, label: 'Repeat plans', badge: plans?.length || undefined }] : []),
        ]}
        value={tab}
        onChange={setTab}
        accessibilityLabel="Service activity filter"
      />
      {tab !== 'plans' && error && !!bookings?.length ? (
        <InlineAlert
          tone="danger"
          title="Could not refresh bookings"
          message={error}
          actionLabel="Retry"
          onAction={() => void load()}
        />
      ) : null}
      {tab === 'plans' && plansError && !!plans?.length ? (
        <InlineAlert
          tone="danger"
          title="Could not refresh repeat plans"
          message={plansError}
          actionLabel="Retry"
          onAction={() => void load()}
        />
      ) : null}
      {tab === 'plans' ? (
        plansError && !plans?.length ? (
          <ErrorState message={plansError} onRetry={() => void load()} />
        ) : !plans ? (
          Array.from({ length: 2 }).map((_, index) => <Skeleton key={index} height={94} radius={t.radii.lg} />)
        ) : plans.length === 0 ? (
          <EmptyState icon="repeat-outline" title="No repeat plans yet" message="Repeat service requests you create will appear here." />
        ) : (
          plans.map((item) => {
            const nextVisit = nextActivityPlanOccurrence(item);
            return (
              <Card
                key={item.plan.id}
                onPress={() => router.push({ pathname: '/recurring/[id]', params: { id: item.plan.id } })}
                gap={t.spacing.sm}
                accessibilityLabel={`${planFrequencyLabel(item.plan)}, ${item.plan.status}`}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: t.spacing.sm }}>
                  <Text variant="bodyStrong" style={{ flex: 1 }}>{planFrequencyLabel(item.plan)}</Text>
                  <Chip label={item.plan.status.replace(/_/g, ' ')} />
                </View>
                <Text variant="footnote" color="muted">Provider response: {item.plan.provider_acceptance.replace(/_/g, ' ')}</Text>
                {nextVisit ? <Text variant="footnote" color="textSecondary">Next visit · {fmtDate(nextVisit.scheduled_at)}</Text> : null}
              </Card>
            );
          })
        )
      ) : error && !bookings ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !bookings ? (
        Array.from({ length: 4 }).map((_, index) => <SkeletonBookingCard key={index} />)
      ) : list.length === 0 ? (
        <EmptyState
          icon={tab === 'active' ? 'calendar-outline' : 'time-outline'}
          title={tab === 'active' ? 'No active bookings' : 'No past bookings yet'}
          message={tab === 'active' ? 'Book a verified pro in under a minute.' : 'Completed and cancelled bookings will show up here.'}
          actionLabel={tab === 'active' ? 'Find a service' : undefined}
          onAction={() => router.navigate('/')}
        />
      ) : (
        list.map((booking, index) => {
          const done = booking.status === 'completed' || booking.status === 'closed';
          return (
            <Animated.View key={booking.id} entering={FadeInDown.delay(Math.min(index, 6) * 30).duration(240)}>
              <Card
                onPress={() => open(booking)}
                gap={t.spacing.md}
                accessibilityLabel={`${booking.categories?.name ?? 'Booking'} with ${booking.providers?.profiles?.full_name ?? 'your pro'}, ${statusShort[booking.status]}`}
              >
                <View style={{ flexDirection: 'row', gap: t.spacing.md, alignItems: 'center' }}>
                  <CategoryIcon icon={iconForSlug(booking.categories?.slug)} size={44} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.sm }}>
                      <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
                        {booking.categories?.name ?? 'Booking'}
                      </Text>
                      <StatusPill status={booking.status} />
                    </View>
                    <Text variant="footnote" color="muted" numberOfLines={1}>
                      {bookingRef(booking.id)} · {booking.providers?.profiles?.full_name ?? 'Your pro'}
                    </Text>
                  </View>
                </View>
                {booking.description ? (
                  <Text variant="footnote" color="textSecondary" numberOfLines={1}>
                    {booking.description}
                  </Text>
                ) : null}
                <UnreadMessagesRow bookingId={booking.id} count={unread.countFor(booking.id)} />
                {tab === 'active' ? (
                  <View style={{ gap: 6 }}>
                    <ProgressBar status={booking.status} showLabel={false} archetype={booking.archetype} />
                    {nextStepCopy[booking.status] ? (
                      <Text variant="footnoteStrong" color="textSecondary" numberOfLines={1}>
                        {nextStepCopy[booking.status]}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
                <AmountRow booking={booking} chevron={tab === 'active'} />
                {tab === 'active' ? null : (
                  <View style={{ flexDirection: 'row', gap: t.spacing.sm, marginTop: 2 }}>
                    {booking.status === 'completed' ? (
                      <Button title="Rate" size="sm" variant="secondary" leftIcon="star-outline" onPress={() => open(booking)} style={{ flex: 1 }} />
                    ) : null}
                    {shouldShowBookAgain(booking, bookAgainEnabled) ? (
                      <Button
                        title={translate('booking.bookAgain')}
                        size="sm"
                        variant="secondary"
                        onPress={() => void openBookAgain(booking)}
                        style={{ flex: 1 }}
                      />
                    ) : null}
                    <Button
                      title={activityReceiptLabel(done, receiptsEnabled)}
                      size="sm"
                      variant="outline"
                      leftIcon={done && receiptsEnabled ? 'receipt-outline' : 'document-text-outline'}
                      onPress={() => done && receiptsEnabled ? void openReceipt(booking) : open(booking)}
                      style={{ flex: 1 }}
                    />
                  </View>
                )}
              </Card>
            </Animated.View>
          );
        })
      )}
    </>
  );
}

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
            {scheduleLabel(b.scheduled_at)}
          </Text>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 }}>
          <Text variant="footnote" color="muted" numberOfLines={1}>
            {fmtDate(b.created_at)}
          </Text>
          {chevron ? <Ionicons name="chevron-forward" size={16} color={t.colors.muted} /> : null}
        </View>
      )}
    </View>
  );
}
