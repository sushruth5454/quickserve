import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, Switch, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { CategoryIcon } from '../../src/components/CategoryIcon';
import { StatusPill } from '../../src/components/status';
import { ChatButton, UnreadMessagesRow } from '../../src/components/UnreadChat';
import { BottomSheet, Button, Card, CountBadge, Divider, ErrorState, IconButton, InlineAlert, LIST_INSET, Screen, Section, SkeletonCard, Text, TextArea, useToast } from '../../src/components/ui';
import {
  acceptBooking,
  declineBooking,
  getBooking,
  getMyProfile,
  getMyProvider,
  getProviderJobs,
  listCategories,
  listMyPayouts,
  setOnline,
  signedPhotoUrls,
  startTrip,
} from '../../src/lib/api';
import { haptics } from '../../src/lib/haptics';
import { commissionRateBp, formatINR, settleVisitOnly } from '../../src/lib/money';
import { pct, providerStats } from '../../src/lib/providerInsights';
import { bookingRef, scheduleLabel } from '../../src/lib/schedule';
import { useAuth } from '../../src/lib/auth';
import { registerForPush } from '../../src/lib/push';
import type { BookingStatus, Category, Payout, Provider, ProviderJob } from '../../src/lib/types';
import { useUnread } from '../../src/lib/unreadContext';
import { useTheme } from '../../src/theme';
import { GoLiveStatusCard } from '../../src/features/providerOnboarding/GoLiveStatusCard';
import { onboardingApi, type DocumentType, type GoLive } from '../../src/lib/onboarding';
import { TravelRequestInbox } from '../../src/features/travel/TravelRequestInbox';
import { ProviderProposalInbox } from '../../src/features/proposals/ProviderProposalInbox';

/** Active statuses in the order a pro should look at them (most time-critical first). */
const ACTIVE_PRIORITY: BookingStatus[] = [
  'en_route',
  'completion_requested',
  'inspecting',
  'in_progress',
  'accepted',
  'awaiting_payment',
  'quote_sent',
  'disputed',
];

type IconName = keyof typeof Ionicons.glyphMap;

const NEXT_STEP: Partial<Record<BookingStatus, { label: string; icon: IconName; primary: boolean }>> = {
  accepted: { label: 'Start trip', icon: 'navigate', primary: true },
  en_route: { label: 'Enter start code', icon: 'keypad-outline', primary: true },
  inspecting: { label: 'Send quote', icon: 'receipt-outline', primary: true },
  quote_sent: { label: 'Awaiting approval', icon: 'hourglass-outline', primary: false },
  awaiting_payment: { label: 'Awaiting payment', icon: 'hourglass-outline', primary: false },
  in_progress: { label: 'Mark complete', icon: 'checkmark-done', primary: true },
  completion_requested: { label: 'Enter completion code', icon: 'keypad-outline', primary: true },
  disputed: { label: 'On hold · view', icon: 'alert-circle-outline', primary: false },
};

const RESPONSE_WINDOW_MS = 15 * 60 * 1000;
/** react-native-web paints the ON thumb teal unless ctiveThumbColor is set (not in the RN types). */
const webSwitchThumb = { activeThumbColor: '#FFFFFF' } as object;
const DECLINE_REASONS = ['Too far', 'Busy right now', 'Not my skill', 'Other'] as const;

const openBooking = (id: string) => router.push({ pathname: '/booking/[id]', params: { id } });
const firstName = (name: string) => (name || 'Customer').split(' ')[0] ?? name;

export default function ProviderDashboard() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [provider, setProvider] = useState<Provider | null>(null);
  const [me, setMe] = useState('');
  const [jobs, setJobs] = useState<ProviderJob[] | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [photos, setPhotos] = useState<Record<string, string[]>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [declining, setDeclining] = useState<ProviderJob | null>(null);
  const [goLive, setGoLive] = useState<{ status: GoLive; docTypes: DocumentType[] } | null>(null);
  const { userId } = useAuth();
  const unread = useUnread();
  const refreshUnread = unread.refresh;

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    try {
      const p = await getMyProvider();
      if (!p) {
        router.replace('/onboarding');
        return;
      }
      setProvider(p);
      // Go-live status (docs/08): shown until the provider is live; failures here never block the dashboard.
      void Promise.all([onboardingApi.getOnboarding(), onboardingApi.getCatalog()])
        .then(([s, cat]) => setGoLive({ status: s.go_live, docTypes: cat.docTypes }))
        .catch(() => undefined);
      const [j, po, profile, cats] = await Promise.all([getProviderJobs(), listMyPayouts(), getMyProfile(), listCategories()]);
      setJobs(j);
      setPayouts(po);
      setCategories(cats);
      setMe(profile?.full_name?.split(' ')[0] ?? '');
      setError(null);
      // Problem photos for open requests (RLS lets the assigned pro read the booking and its photos).
      const incoming = j.filter((x) => x.status === 'requested');
      const entries = await Promise.all(
        incoming.map(async (x) => {
          const b = await getBooking(x.booking_id).catch(() => null);
          const urls = b?.photos.length ? await signedPhotoUrls(b.photos).catch(() => []) : [];
          return [x.booking_id, urls] as const;
        }),
      );
      setPhotos(Object.fromEntries(entries));
    } catch (e) {
      setError((e as Error).message);
    }
    void refreshUnread();
  }, [refreshUnread]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const toggleOnline = async (value: boolean) => {
    haptics.select();
    setProvider((p) => (p ? { ...p, is_online: value } : p));
    try {
      await setOnline(value);
      toast({ message: value ? "You're online — new requests will reach you" : "You're offline", tone: value ? 'success' : 'default' });
      // Going online is when a pro wants to hear about new requests: ask for notification permission here.
      if (value && userId) void registerForPush(userId, { prompt: true });
    } catch (e) {
      setError((e as Error).message);
      setProvider((p) => (p ? { ...p, is_online: !value } : p));
    }
  };

  const act = async (id: string, fn: () => Promise<void>, msg: string) => {
    setBusyId(id);
    try {
      await fn();
      await load();
      toast({ message: msg, tone: 'success' });
    } catch (e) {
      haptics.error();
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const rateBp = provider
    ? commissionRateBp({ jobsCompleted: provider.jobs_completed, providerCreatedAt: new Date(provider.created_at), at: new Date(now) })
    : 1200;
  const iconFor = (name: string) => categories.find((c) => c.name === name)?.icon;
  const incoming = (jobs ?? []).filter((j) => j.status === 'requested');
  const active = useMemo(
    () =>
      (jobs ?? [])
        .filter((j) => ACTIVE_PRIORITY.includes(j.status))
        .sort(
          (a, b) =>
            ACTIVE_PRIORITY.indexOf(a.status) - ACTIVE_PRIORITY.indexOf(b.status) ||
            (a.scheduled_at ?? a.created_at).localeCompare(b.scheduled_at ?? b.created_at),
        ),
    [jobs],
  );
  const [next, ...rest] = active;
  const stats = useMemo(() => providerStats((jobs ?? []).map((j) => j.status)), [jobs]);
  const sod = new Date(now);
  sod.setHours(0, 0, 0, 0);
  const today = payouts.filter((p) => new Date(p.created_at) >= sod && p.status !== 'reversed').reduce((a, p) => a + p.amount, 0);
  const online = !!provider?.is_online;
  const gutter = { paddingHorizontal: t.spacing.lg };

  const primaryAction = (j: ProviderJob) => {
    if (j.status === 'accepted') return void act(j.booking_id, () => startTrip(j.booking_id), `${firstName(j.customer_name)} has been told you're on the way`);
    if (j.status === 'inspecting') return router.push({ pathname: '/quote/[bookingId]', params: { bookingId: j.booking_id, changeOrder: '0' } });
    openBooking(j.booking_id);
  };

  return (
    <Screen
      inTabs
      padded={false}
      gap={t.spacing.xl}
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await load();
        setRefreshing(false);
      }}
    >
      <View style={[gutter, { paddingTop: insets.top + t.spacing.md, gap: t.spacing.lg }]}>
        <View style={{ gap: 2 }}>
          <Text variant="footnote" color="muted">
            {new Date(now).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
          </Text>
          <Text variant="title1" accessibilityRole="header" numberOfLines={1}>
            {me ? `Hi ${me}` : 'Your jobs'}
          </Text>
        </View>

        <OnlineCard online={online} radiusKm={provider?.service_radius_km ?? null} onChange={(v) => void toggleOnline(v)} disabled={!provider} />

        {goLive && (goLive.status.state !== 'live' || goLive.status.paused) ? (
          <GoLiveStatusCard
            goLive={goLive.status}
            docTypes={goLive.docTypes}
            onFix={(s) => router.push({ pathname: '/provider-profile/[section]', params: { section: s } })}
            onContinue={() => router.push('/onboarding')}
          />
        ) : !goLive && provider && provider.kyc_status !== 'verified' ? (
          <InlineAlert tone="warning" title="Not visible in search yet" message="Finish your provider profile and payout setup to go live." />
        ) : null}
        {provider?.suspended ? <InlineAlert title="Account suspended" message="Contact support to restore access." /> : null}
        {error ? <InlineAlert message={error} /> : null}

        <StatsStrip
          items={[
            { label: 'Today', value: formatINR(today), onPress: () => router.navigate('/earnings') },
            { label: 'Rating', value: provider && provider.rating_count > 0 ? Number(provider.rating_avg).toFixed(1) : '—', icon: 'star' },
            { label: 'Acceptance', value: pct(stats.acceptance) },
            { label: 'Completion', value: pct(stats.completion) },
          ]}
        />
      </View>

      {/* Requests first: they expire. */}
      <View style={gutter}>
        <TravelRequestInbox />
      </View>
      <View style={gutter}>
        <ProviderProposalInbox />
      </View>

      <View style={gutter}>
        <Section title="New requests" subtitle={incoming.length ? 'Accept within 15 minutes or the request expires' : undefined}>
          {!jobs ? (
            error ? (
              <ErrorState message={error} onRetry={() => void load()} compact />
            ) : (
              <SkeletonCard lines={3} />
            )
          ) : incoming.length === 0 ? (
            <WaitingRow online={online} />
          ) : (
            incoming.map((j) => (
              <RequestCard
                key={j.booking_id}
                job={j}
                icon={iconFor(j.category_name)}
                photos={photos[j.booking_id] ?? []}
                now={now}
                minEarning={settleVisitOnly({ visitFee: j.visit_fee, rateBp }).payout}
                busy={busyId === j.booking_id}
                unread={unread.countFor(j.booking_id)}
                onAccept={() => void act(j.booking_id, () => acceptBooking(j.booking_id), 'Accepted! Start your trip when ready.')}
                onDecline={() => setDeclining(j)}
              />
            ))
          )}
        </Section>
      </View>

      {next ? (
        <View style={gutter}>
          <Section title="Next job">
            <NextJobCard
              job={next}
              icon={iconFor(next.category_name)}
              busy={busyId === next.booking_id}
              onPrimary={() => primaryAction(next)}
              unread={unread.countFor(next.booking_id)}
              onNavigate={
                next.lat != null && next.lng != null
                  ? () =>
                      void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${next.lat},${next.lng}`).catch(() =>
                        toast({ message: 'Could not open maps.', tone: 'error' }),
                      )
                  : null
              }
            />
          </Section>
        </View>
      ) : null}

      <View style={gutter}>
        <Section title={next ? 'Other active jobs' : 'Active jobs'} actionLabel="All jobs" onAction={() => router.push('/jobs')}>
          {!jobs ? (
            <SkeletonCard lines={2} />
          ) : rest.length === 0 ? (
            <Text variant="footnote" color="muted">
              {next ? 'No other active jobs.' : 'No active jobs right now.'}
            </Text>
          ) : (
            <Card padding={0} gap={0}>
              {rest.map((j, i) => (
                <View key={j.booking_id}>
                  {i > 0 ? <Divider inset={LIST_INSET + 8} /> : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${j.category_name} for ${j.customer_name}. Next: ${NEXT_STEP[j.status]?.label ?? ''}`}
                    onPress={() => openBooking(j.booking_id)}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: t.spacing.md,
                      paddingHorizontal: t.spacing.lg,
                      paddingVertical: t.spacing.md,
                      backgroundColor: pressed ? t.colors.surfaceAlt : 'transparent',
                    })}
                  >
                    <CategoryIcon icon={iconFor(j.category_name)} size={40} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="calloutStrong" numberOfLines={1}>
                        {firstName(j.customer_name)} · {j.category_name}
                      </Text>
                      <Text variant="footnote" color="muted" numberOfLines={1}>
                        Next: {NEXT_STEP[j.status]?.label ?? '—'}
                      </Text>
                    </View>
                    <CountBadge count={unread.countFor(j.booking_id)} />
                    <StatusPill status={j.status} />
                  </Pressable>
                </View>
              ))}
            </Card>
          )}
        </Section>
      </View>

      <DeclineSheet
        job={declining}
        busy={!!declining && busyId === declining.booking_id}
        onClose={() => setDeclining(null)}
        onConfirm={(reason) => {
          const j = declining;
          if (!j) return;
          setDeclining(null);
          void act(j.booking_id, () => declineBooking(j.booking_id, reason), 'Request declined · the customer is refunded');
        }}
      />
    </Screen>
  );
}

function OnlineCard({ online, radiusKm, onChange, disabled }: { online: boolean; radiusKm: number | null; onChange: (v: boolean) => void; disabled: boolean }) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing.md,
        padding: t.spacing.lg,
        borderRadius: t.radii.lg,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: online ? t.colors.success : t.colors.border,
        backgroundColor: online ? t.colors.successSoft : t.colors.surface,
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: online ? t.colors.success : t.colors.surfaceAlt,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={online ? 'radio' : 'moon-outline'} size={20} color={online ? '#FFFFFF' : t.colors.textSecondary} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="calloutStrong" color={online ? 'successText' : 'text'}>
          {online ? "You're online" : "You're offline"}
        </Text>
        <Text variant="footnote" color={online ? 'successText' : 'muted'}>
          {online
            ? `Receiving requests${radiusKm ? ` within ${radiusKm} km` : ''}`
            : "Customers can't book you right now"}
        </Text>
      </View>
      <Switch
        value={online}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: t.colors.success, false: t.colors.outline }}
        thumbColor="#FFFFFF"
        {...webSwitchThumb}
        accessibilityLabel={online ? 'Online. Turn off to stop receiving requests' : 'Offline. Turn on to receive requests'}
      />
    </View>
  );
}

function StatsStrip({ items }: { items: { label: string; value: string; icon?: IconName; onPress?: () => void }[] }) {
  const t = useTheme();
  return (
    <Card padding={0} gap={0} style={{ flexDirection: 'row' }}>
      {items.map((it, i) => (
        <Pressable
          key={it.label}
          disabled={!it.onPress}
          onPress={it.onPress}
          accessibilityRole={it.onPress ? 'button' : 'text'}
          accessibilityLabel={`${it.label}: ${it.value}`}
          style={({ pressed }) => ({
            flex: 1,
            paddingVertical: t.spacing.md,
            paddingHorizontal: t.spacing.sm,
            alignItems: 'center',
            gap: 2,
            borderLeftWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
            borderLeftColor: t.colors.border,
            backgroundColor: pressed ? t.colors.surfaceAlt : 'transparent',
          })}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            {it.icon ? <Ionicons name={it.icon} size={13} color={t.colors.star} /> : null}
            <Text variant="calloutStrong" tabular numberOfLines={1} adjustsFontSizeToFit>
              {it.value}
            </Text>
          </View>
          <Text variant="caption" color="muted" numberOfLines={1}>
            {it.label}
          </Text>
        </Pressable>
      ))}
    </Card>
  );
}

function WaitingRow({ online }: { online: boolean }) {
  const t = useTheme();
  const reduce = useReducedMotion();
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (online && !reduce) pulse.value = withRepeat(withTiming(0.35, { duration: 900 }), -1, true);
    else pulse.value = 1;
  }, [online, reduce, pulse]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <Card padding={t.spacing.md} style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
      <Animated.View
        style={[
          { width: 10, height: 10, borderRadius: 5, marginHorizontal: 4, backgroundColor: online ? t.colors.success : t.colors.outline },
          style,
        ]}
      />
      <Text variant="footnote" color="textSecondary" style={{ flex: 1 }}>
        {online ? 'Waiting for requests — we’ll notify you when a customer nearby books you.' : 'Go online to start receiving requests.'}
      </Text>
    </Card>
  );
}

function CountdownRing({ leftMs }: { leftMs: number }) {
  const t = useTheme();
  const size = 52;
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, leftMs / RESPONSE_WINDOW_MS));
  const urgent = leftMs < 3 * 60 * 1000;
  const color = leftMs <= 0 ? t.colors.outline : urgent ? t.colors.danger : t.colors.warning;
  const mm = Math.floor(leftMs / 60000);
  const ss = Math.floor((leftMs % 60000) / 1000);
  return (
    <View
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      accessible
      accessibilityLabel={leftMs > 0 ? `${mm} minutes ${ss} seconds left to accept` : 'Expired'}
    >
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={t.colors.border} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={c * (1 - frac)}
        />
      </Svg>
      <Text variant="captionStrong" color={urgent ? 'dangerText' : 'text'} tabular maxFontSizeMultiplier={1}>
        {leftMs > 0 ? `${mm}:${String(ss).padStart(2, '0')}` : '0:00'}
      </Text>
    </View>
  );
}

function RequestCard(props: {
  job: ProviderJob;
  icon: string | undefined;
  photos: string[];
  now: number;
  minEarning: number;
  busy: boolean;
  unread: number;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const t = useTheme();
  const j = props.job;
  const left = Math.max(0, new Date(j.created_at).getTime() + RESPONSE_WINDOW_MS - props.now);
  return (
    <Animated.View entering={FadeInDown.duration(240)} layout={LinearTransition}>
      <Card variant="elevated" gap={t.spacing.md}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
          <CategoryIcon icon={props.icon} size={44} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="title3" numberOfLines={1}>
              {j.category_name}
            </Text>
            <Text variant="footnote" color="muted" numberOfLines={1}>
              {firstName(j.customer_name)} · {j.area}
              {j.distance_km != null ? ` · ${j.distance_km} km` : ''}
            </Text>
          </View>
          <CountdownRing leftMs={left} />
        </View>
        <Text variant="callout" color="textSecondary" numberOfLines={2}>
          {j.description || 'No description'}
        </Text>
        <UnreadMessagesRow bookingId={j.booking_id} count={props.unread} />
        {props.photos.length ? (
          <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
            {props.photos.slice(0, 4).map((u) => (
              <Image key={u} source={{ uri: u }} style={{ width: 56, height: 56, borderRadius: t.radii.sm }} contentFit="cover" accessibilityLabel="Problem photo" />
            ))}
          </View>
        ) : null}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: t.spacing.sm,
            paddingVertical: t.spacing.sm,
            paddingHorizontal: t.spacing.md,
            borderRadius: t.radii.sm,
            backgroundColor: t.colors.surfaceAlt,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
            <Ionicons name="time-outline" size={14} color={t.colors.muted} />
            <Text variant="footnote" color="textSecondary" numberOfLines={1}>
              {j.scheduled_at ? scheduleLabel(j.scheduled_at) : 'As soon as possible'}
            </Text>
          </View>
          <Text variant="footnote" color="muted" numberOfLines={1}>
            You earn{' '}
            <Text variant="footnoteStrong" color="successText" tabular>
              {formatINR(props.minEarning)}+
            </Text>
          </Text>
        </View>
        <Text variant="caption" color="muted">
          Exact address is shared after you accept · {bookingRef(j.booking_id)}
        </Text>
        <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
          <Button title="Decline" variant="outline" size="lg" style={{ flex: 1 }} disabled={props.busy} onPress={props.onDecline} />
          <Button title="Accept" size="lg" style={{ flex: 1.4 }} loading={props.busy} disabled={left <= 0} onPress={props.onAccept} />
        </View>
      </Card>
    </Animated.View>
  );
}

function NextJobCard(props: {
  job: ProviderJob;
  icon: string | undefined;
  busy: boolean;
  onPrimary: () => void;
  unread: number;
  onNavigate: (() => void) | null;
}) {
  const t = useTheme();
  const j = props.job;
  const step = NEXT_STEP[j.status];
  return (
    <Card variant="elevated" gap={t.spacing.lg} onPress={() => openBooking(j.booking_id)} accessibilityLabel={`Next job: ${j.category_name} for ${j.customer_name}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
        <CategoryIcon icon={props.icon} size={48} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="title3" numberOfLines={1}>
            {firstName(j.customer_name)}
          </Text>
          <Text variant="footnote" color="muted" numberOfLines={1}>
            {j.category_name} · {bookingRef(j.booking_id)}
          </Text>
        </View>
        {props.onNavigate ? <IconButton icon="navigate-outline" variant="neutral" accessibilityLabel="Navigate" onPress={props.onNavigate} /> : null}
        <ChatButton bookingId={j.booking_id} count={props.unread} accessibilityLabel="Chat with customer" />
      </View>
      <View style={{ gap: t.spacing.sm }}>
        <StatusPill status={j.status} />
        <Meta icon="time-outline" text={j.scheduled_at ? scheduleLabel(j.scheduled_at) : 'As soon as possible'} />
        <Meta
          icon="location-outline"
          text={`${j.address_line ? `${j.address_line}, ` : ''}${j.area}${j.distance_km != null ? ` · ${j.distance_km} km away` : ''}`}
        />
      </View>
      <Button
        title={step?.label ?? 'View job'}
        leftIcon={step?.icon}
        variant={step?.primary ? 'primary' : 'outline'}
        size="lg"
        fullWidth
        loading={props.busy}
        onPress={props.onPrimary}
      />
    </Card>
  );
}
function Meta({ icon, text }: { icon: IconName; text: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.sm }}>
      <Ionicons name={icon} size={16} color={t.colors.muted} style={{ marginTop: 2 }} />
      <Text variant="callout" color="textSecondary" style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

function DeclineSheet({ job, busy, onClose, onConfirm }: { job: ProviderJob | null; busy: boolean; onClose: () => void; onConfirm: (reason: string) => void }) {
  const t = useTheme();
  const [reason, setReason] = useState<(typeof DECLINE_REASONS)[number]>('Busy right now');
  const [other, setOther] = useState('');
  useEffect(() => {
    if (job) {
      setReason('Busy right now');
      setOther('');
    }
  }, [job]);
  const final = reason === 'Other' ? other.trim() : reason;
  return (
    <BottomSheet
      visible={!!job}
      onClose={onClose}
      title="Decline this request?"
      subtitle="The customer gets a full refund. Frequent declines lower your ranking."
      footer={<Button title="Decline request" variant="destructive" size="lg" fullWidth loading={busy} disabled={!final} onPress={() => onConfirm(final)} />}
    >
      <View style={{ marginHorizontal: -t.spacing.sm }}>
        {DECLINE_REASONS.map((r) => {
          const sel = r === reason;
          return (
            <Pressable
              key={r}
              accessibilityRole="radio"
              accessibilityState={{ checked: sel }}
              onPress={() => setReason(r)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: t.spacing.md,
                minHeight: 52,
                paddingHorizontal: t.spacing.sm,
                borderRadius: t.radii.md,
                backgroundColor: pressed ? t.colors.surfaceAlt : 'transparent',
              })}
            >
              <Ionicons name={sel ? 'radio-button-on' : 'radio-button-off'} size={22} color={sel ? t.colors.primary : t.colors.outline} />
              <Text variant="body">{r}</Text>
            </Pressable>
          );
        })}
      </View>
      {reason === 'Other' ? <TextArea placeholder="Add a short reason" value={other} onChangeText={setOther} maxLength={200} /> : null}
    </BottomSheet>
  );
}
