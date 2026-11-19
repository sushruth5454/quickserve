import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { CategoryIcon, iconForSlug } from '../../components/CategoryIcon';
import { activeStatuses, nextStepCopy, StatusPill, statusShort } from '../../components/status';
import { ProgressBar } from '../../components/StatusTimeline';
import { UnreadMessagesRow } from '../../components/UnreadChat';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Header,
  InlineAlert,
  Screen,
  SegmentedControl,
  SkeletonBookingCard,
  Skeleton,
  Text,
} from '../../components/ui';
import { listMyBookings, listMyServiceRequests } from '../../lib/api';
import { useAppFeatureFlags, useFeature } from '../../lib/featureFlags';
import { useAuth } from '../../lib/auth';
import { formatINR } from '../../lib/money';
import { bookingRef, scheduleLabel } from '../../lib/schedule';
import type { Booking, ServiceRequest } from '../../lib/types';
import { badgeLabel } from '../../lib/unread';
import { useUnread } from '../../lib/unreadContext';
import { useTheme } from '../../theme';
import { listMyProductEnquiries, type EnquirySummary } from '../shops/api';
import { ActivitySegmentControl } from './ActivitySegmentControl';
import { useActivityUnread } from './ActivityUnreadProvider';
import { listMyCustomerRfqs, type CustomerRfqSummary } from '../rfq/api';
import { RfqStatusLabel } from '../rfq/components';
import { listMyCustomerSportsBookings, type CustomerSportsBooking } from '../sports/api';
import { listMyRecurringPlans } from '../recurring/api';
import { shouldShowRepeatPlansFilter } from '../recurring/customerPresentation';
import type { Frequency, PlanStatus } from '../recurring/types';
import { bookAgainRoute } from './bookAgain';
import { visibleActivitySegments, type ActivitySegment } from './model';

const LABELS: Record<ActivitySegment, string> = {
  services: 'Services',
  requests: 'Requests',
  shop: 'Shop',
  sports: 'Sports',
};

const NO_REFRESH = async () => {};

type ActivityPlanSummary = {
  plan: {
    id: string;
    status: PlanStatus;
    provider_acceptance: string;
    frequency?: Frequency;
    weekdays?: number[];
  };
  occurrences: { id: string; scheduled_at: string; status: string }[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseActivityPlans(value: unknown): ActivityPlanSummary[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || !isRecord(item.plan) || !Array.isArray(item.occurrences)) return [];
    const plan = item.plan;
    if (
      typeof plan.id !== 'string' ||
      !['active', 'paused', 'cancelled', 'completed'].includes(String(plan.status)) ||
      typeof plan.provider_acceptance !== 'string'
    ) return [];
    const occurrences = item.occurrences.filter(
      (row): row is ActivityPlanSummary['occurrences'][number] =>
        isRecord(row) && typeof row.id === 'string' && typeof row.scheduled_at === 'string' && typeof row.status === 'string',
    );
    return [{
      plan: plan as ActivityPlanSummary['plan'],
      occurrences,
    }];
  });
}

function planFrequencyLabel(plan: ActivityPlanSummary['plan']) {
  const labels: Record<Frequency, string> = {
    daily: 'Every day',
    alternate_days: 'Every other day',
    weekly: 'Weekly',
    monthly: 'Monthly',
    custom: 'Custom dates',
  };
  const frequency = plan.frequency ? labels[plan.frequency] ?? 'Repeat plan' : 'Repeat plan';
  if (plan.frequency !== 'weekly' || !Array.isArray(plan.weekdays)) return frequency;
  const days = plan.weekdays
    .map((day) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][day - 1])
    .filter(Boolean)
    .join(', ');
  return days ? `${frequency} · ${days}` : frequency;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export default function UnifiedActivityScreen() {
  const t = useTheme();
  const flags = useAppFeatureFlags();
  const productsEnabled = flags.isOn('products');
  const sportsEnabled = flags.isOn('sports');
  const { userId } = useAuth();
  const activityUnread = useActivityUnread();
  const chatUnread = useUnread();
  const [hasSportsBookings, setHasSportsBookings] = useState(false);

  useEffect(() => {
    setHasSportsBookings(false);
    if (sportsEnabled || !userId) {
      return;
    }
    let active = true;
    void listMyCustomerSportsBookings()
      .then((bookings) => {
        if (active) setHasSportsBookings(bookings.length > 0);
      })
      .catch(() => {
        if (active) setHasSportsBookings(false);
      });
    return () => {
      active = false;
    };
  }, [sportsEnabled, userId]);

  const segments = useMemo(
    () => visibleActivitySegments({
      products: productsEnabled,
      sports: sportsEnabled,
      hasSportsBookings: hasSportsBookings || activityUnread.counts.sports > 0,
    }),
    [productsEnabled, sportsEnabled, hasSportsBookings, activityUnread.counts.sports],
  );
  const [segment, setSegment] = useState<ActivitySegment>('services');
  const [refreshing, setRefreshing] = useState(false);
  const refreshCurrent = useRef<() => Promise<void>>(NO_REFRESH);

  useEffect(() => {
    if (!segments.includes(segment)) setSegment('services');
  }, [segments, segment]);

  const registerRefresh = useCallback((refresh: () => Promise<void>) => {
    refreshCurrent.current = refresh;
    return () => {
      if (refreshCurrent.current === refresh) refreshCurrent.current = NO_REFRESH;
    };
  }, []);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshCurrent.current(), activityUnread.refresh(), chatUnread.refresh()]);
    } finally {
      setRefreshing(false);
    }
  }, [activityUnread.refresh, chatUnread.refresh]);

  useFocusEffect(
    useCallback(() => {
      void activityUnread.refresh();
      void chatUnread.refresh();
    }, [activityUnread.refresh, chatUnread.refresh]),
  );

  const options = useMemo(
    () =>
      segments.map((value) => ({
        value,
        label: LABELS[value],
        badge: badgeLabel(activityUnread.counts[value]),
      })),
    [segments, activityUnread.counts],
  );
  const activeSegment = segments.includes(segment) ? segment : 'services';

  return (
    <Screen
      inTabs
      header={
        <Header title="My activity" large back={false}>
          <View style={{ paddingBottom: t.spacing.md }}>
            <ActivitySegmentControl options={options} value={activeSegment} onChange={setSegment} />
          </View>
        </Header>
      }
      refreshing={refreshing}
      onRefresh={() => void refreshAll()}
      gap={t.spacing.md}
    >
      <View testID={`my-activity-panel-${activeSegment}`}>
        {activeSegment === 'services' ? (
          <ServicesSegment registerRefresh={registerRefresh} markRead={activityUnread.markRead} />
        ) : activeSegment === 'requests' ? (
          <RequestsSegment registerRefresh={registerRefresh} markRead={activityUnread.markRead} />
        ) : activeSegment === 'shop' ? (
          <ShopSegment
            enquiriesEnabled={productsEnabled && flags.isOn('product_enquiries')}
            rfqEnabled={productsEnabled && flags.isOn('product_rfq')}
            registerRefresh={registerRefresh}
            markRead={activityUnread.markRead}
          />
        ) : (
          <SportsSegment registerRefresh={registerRefresh} markRead={activityUnread.markRead} />
        )}
      </View>
    </Screen>
  );
}

type RegisterRefresh = (refresh: () => Promise<void>) => () => void;
type MarkRead = ReturnType<typeof useActivityUnread>['markRead'];

function ServicesSegment({ registerRefresh, markRead }: { registerRefresh: RegisterRefresh; markRead: MarkRead }) {
  const t = useTheme();
  const recurringEnabled = useFeature('recurring_bookings');
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
            const nextVisit = item.occurrences
              .filter((visit) => new Date(visit.scheduled_at).getTime() >= Date.now())
              .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))[0];
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
          const bookAgain = bookAgainRoute(booking);
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
                    {bookAgain ? (
                      <Button
                        title="Book again"
                        size="sm"
                        variant="outline"
                        leftIcon="refresh"
                        onPress={() => router.push(bookAgain)}
                        style={{ flex: 1 }}
                      />
                    ) : null}
                    <Button
                      title={done ? 'Receipt' : 'Details'}
                      size="sm"
                      variant="outline"
                      leftIcon={done ? 'receipt-outline' : 'document-text-outline'}
                      onPress={() => open(booking)}
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

function RequestsSegment({ registerRefresh, markRead }: { registerRefresh: RegisterRefresh; markRead: MarkRead }) {
  const t = useTheme();
  const [requests, setRequests] = useState<ServiceRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRequests(await listMyServiceRequests());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => registerRefresh(load), [load, registerRefresh]);

  if (error && !requests) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!requests) return [0, 1, 2].map((index) => <Skeleton key={index} height={94} radius={t.radii.lg} />);
  if (!requests.length) {
    return <EmptyState icon="document-text-outline" title="No service requests yet" message="Requests you create for proposals will appear here." />;
  }

  return (
    <View style={{ gap: t.spacing.sm }}>
      {requests.map((request) => (
        <Card
          key={request.id}
          onPress={() => {
            void markRead('request', request.id).catch(() => undefined);
            router.push({ pathname: '/request/[id]', params: { id: request.id } });
          }}
          gap={t.spacing.sm}
          accessibilityLabel={`${request.categories?.name ?? 'Service request'}, ${request.status}`}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
            <CategoryIcon icon={iconForSlug(request.categories?.slug)} size={40} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong" numberOfLines={1}>{request.categories?.name ?? 'Service request'}</Text>
              <Text variant="footnote" color="muted" numberOfLines={1}>
                {request.area || request.city} · {new Date(request.event_start).toLocaleDateString('en-IN')}
              </Text>
            </View>
            <Text variant="captionStrong" color={request.status === 'open' ? 'primaryText' : 'muted'}>
              {request.status === 'open' ? 'Proposals arriving' : request.status}
            </Text>
          </View>
          <Text variant="caption" color="muted">Expires {new Date(request.expires_at).toLocaleDateString('en-IN')}</Text>
        </Card>
      ))}
    </View>
  );
}

function ShopSegment({
  enquiriesEnabled,
  rfqEnabled,
  registerRefresh,
  markRead,
}: {
  enquiriesEnabled: boolean;
  rfqEnabled: boolean;
  registerRefresh: RegisterRefresh;
  markRead: MarkRead;
}) {
  const t = useTheme();
  const [enquiries, setEnquiries] = useState<EnquirySummary[] | null>(null);
  const [rfqs, setRfqs] = useState<CustomerRfqSummary[] | null>(null);
  const [enquiryError, setEnquiryError] = useState<string | null>(null);
  const [rfqError, setRfqError] = useState<string | null>(null);

  const loadEnquiries = useCallback(async () => {
    if (!enquiriesEnabled) {
      setEnquiries([]);
      setEnquiryError(null);
      return;
    }
    try {
      setEnquiries(await listMyProductEnquiries());
      setEnquiryError(null);
    } catch (e) {
      setEnquiryError((e as Error).message);
    }
  }, [enquiriesEnabled]);

  const loadRfqs = useCallback(async () => {
    if (!rfqEnabled) {
      setRfqs([]);
      setRfqError(null);
      return;
    }
    try {
      setRfqs(await listMyCustomerRfqs());
      setRfqError(null);
    } catch (e) {
      setRfqError((e as Error).message);
    }
  }, [rfqEnabled]);

  const load = useCallback(async () => {
    await Promise.all([loadEnquiries(), loadRfqs()]);
  }, [loadEnquiries, loadRfqs]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => registerRefresh(load), [load, registerRefresh]);

  if (!enquiriesEnabled && !rfqEnabled) {
    return <EmptyState icon="storefront-outline" title="Shop activity is unavailable" message="Product enquiries and RFQs are turned off right now." />;
  }

  return (
    <View style={{ gap: t.spacing.lg }}>
      {enquiriesEnabled ? (
        <View style={{ gap: t.spacing.sm }}>
          <Text variant="title3">Product enquiries</Text>
          {enquiryError ? <InlineAlert message={enquiryError} /> : null}
          {enquiries == null ? (
            <Skeleton height={86} radius={t.radii.lg} />
          ) : !enquiries.length ? (
            <EmptyState icon="chatbubble-ellipses-outline" title="No product enquiries yet" message="Your shop conversations will appear here." compact />
          ) : enquiries.map((enquiry) => (
            <Card
              key={enquiry.id}
              onPress={() => router.push({ pathname: '/enquiry/[id]', params: { id: enquiry.id } })}
              gap={t.spacing.xs}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
                <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>{enquiry.product_name ?? 'Shop enquiry'}</Text>
                {enquiry.customer_unread ? <Text variant="captionStrong" color="primaryText">{enquiry.customer_unread} unread</Text> : null}
              </View>
              <Text variant="footnote" color="muted">{enquiry.shop_name} · {enquiry.status}</Text>
              <Text variant="caption" color="muted">{fmtDate(enquiry.last_message_at)}</Text>
            </Card>
          ))}
        </View>
      ) : null}

      {rfqEnabled ? (
        <View style={{ gap: t.spacing.sm }}>
          <Text variant="title3">Product RFQs</Text>
          {rfqError ? <InlineAlert message={rfqError} /> : null}
          {rfqs == null ? (
            <Skeleton height={86} radius={t.radii.lg} />
          ) : !rfqs.length ? (
            <EmptyState icon="document-text-outline" title="No RFQs yet" message="Your product quote requests will appear here." compact />
          ) : rfqs.map((rfq) => (
            <Card
              key={rfq.id}
              onPress={() => {
                void markRead('rfq', rfq.id).catch(() => undefined);
                router.push({ pathname: '/rfq/[id]', params: { id: rfq.id } });
              }}
              gap={t.spacing.xs}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.sm }}>
                <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>{rfq.title}</Text>
                <RfqStatusLabel status={rfq.status} />
              </View>
              <Text variant="footnote" color="muted">{rfq.category_name} · {rfq.area}, {rfq.city}</Text>
              <Text variant="caption" color="muted">
                {rfq.recipient_count} shops contacted · Needed by {new Date(`${rfq.needed_by}T00:00:00`).toLocaleDateString('en-IN')}
              </Text>
            </Card>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function SportsSegment({ registerRefresh, markRead }: { registerRefresh: RegisterRefresh; markRead: MarkRead }) {
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
