import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CategoryIcon } from '../../src/components/CategoryIcon';
import { HeroAmount } from '../../src/components/Money';
import { MetaItem } from '../../src/components/ProviderCard';
import { StatusPill } from '../../src/components/status';
import { Badge, Button, Card, EmptyState, ErrorState, InlineAlert, Screen, Section, SkeletonCard, Text, useConfirm, useToast } from '../../src/components/ui';
import { acceptBooking, declineBooking, getMyProfile, getMyProvider, getProviderJobs, listMyPayouts, listCategories, setOnline } from '../../src/lib/api';
import { haptics } from '../../src/lib/haptics';
import { formatINR } from '../../src/lib/money';
import type { BookingStatus, Category, Payout, Provider, ProviderJob } from '../../src/lib/types';
import { useTheme } from '../../src/theme';

const ACTIVE: BookingStatus[] = [
  'accepted',
  'en_route',
  'inspecting',
  'quote_sent',
  'awaiting_payment',
  'in_progress',
  'completion_requested',
  'disputed',
];

const NEXT_STEP: Partial<Record<BookingStatus, string>> = {
  accepted: 'Start trip',
  en_route: 'Enter start code',
  inspecting: 'Send quote',
  quote_sent: 'Awaiting approval',
  awaiting_payment: 'Awaiting payment',
  in_progress: 'Mark done',
  completion_requested: 'Enter completion code',
  disputed: 'On hold',
};

const RESPONSE_WINDOW_MS = 15 * 60 * 1000;

export default function ProviderDashboard() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const confirm = useConfirm();
  const [provider, setProvider] = useState<Provider | null>(null);
  const [firstName, setFirstName] = useState('');
  const [jobs, setJobs] = useState<ProviderJob[] | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

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
      const [j, po, profile, cats] = await Promise.all([getProviderJobs(), listMyPayouts(), getMyProfile(), listCategories()]);
      setJobs(j);
      setPayouts(po);
      setCategories(cats);
      setFirstName(profile?.full_name?.split(' ')[0] ?? '');
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

  const toggleOnline = async (value: boolean) => {
    haptics.select();
    setProvider((p) => (p ? { ...p, is_online: value } : p));
    try {
      await setOnline(value);
      toast({ message: value ? "You're online — new requests will reach you" : "You're offline", tone: value ? 'success' : 'default' });
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
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const decline = async (j: ProviderJob) => {
    const ok = await confirm({
      title: 'Decline this request?',
      message: 'The customer gets a full refund. Declining often lowers your ranking.',
      confirmLabel: 'Decline',
      destructive: true,
    });
    if (ok) void act(j.booking_id, () => declineBooking(j.booking_id), 'Request declined');
  };

  const iconFor = (name: string) => categories.find((c) => c.name === name)?.icon;
  const incoming = (jobs ?? []).filter((j) => j.status === 'requested');
  const active = (jobs ?? []).filter((j) => ACTIVE.includes(j.status));
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const todayPayouts = payouts.filter((p) => new Date(p.created_at) >= startOfDay && p.status !== 'reversed');
  const today = todayPayouts.reduce((a, p) => a + p.amount, 0);
  const online = !!provider?.is_online;
  const gutter = { paddingHorizontal: t.spacing.lg };

  return (
    <Screen
      inTabs
      padded={false}
      gap={t.spacing.section}
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await load();
        setRefreshing(false);
      }}
    >
      <View style={[gutter, { paddingTop: insets.top + t.spacing.md, gap: t.spacing.lg }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
          <View style={{ flex: 1 }}>
            <Text variant="footnote" color="muted">
              {new Date(now).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
            </Text>
            <Text variant="title1" accessibilityRole="header" numberOfLines={1}>
              {firstName ? `Hi ${firstName}` : 'Your jobs'}
            </Text>
          </View>
          <OnlineToggle online={online} onChange={(v) => void toggleOnline(v)} />
        </View>

        {provider && provider.kyc_status !== 'verified' ? (
          <InlineAlert
            tone="warning"
            title="Not visible in search yet"
            message={`Verification happens with our payment partner during payout setup. Status: ${provider.kyc_status}.`}
          />
        ) : null}
        {provider?.suspended ? <InlineAlert title="Account suspended" message="Contact support to restore access." /> : null}
        {error ? <InlineAlert message={error} /> : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Today's earnings ${formatINR(today)}. Open earnings`}
          onPress={() => router.navigate('/earnings')}
          style={({ pressed }) => ({ opacity: pressed ? 0.92 : 1 })}
        >
          <LinearGradient
            colors={[t.colors.heroFrom, t.colors.heroTo]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ borderRadius: t.radii.lg, padding: t.spacing.xl, gap: t.spacing.lg }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ gap: 2 }}>
                <Text variant="footnote" style={{ color: 'rgba(255,255,255,0.85)' }}>
                  Today's earnings
                </Text>
                <HeroAmount paise={today} light />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                <Text variant="footnoteStrong" style={{ color: '#FFFFFF' }}>
                  Earnings
                </Text>
                <Ionicons name="chevron-forward" size={16} color="#FFFFFF" />
              </View>
            </View>
            <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.18)', paddingTop: t.spacing.md }}>
              <HeroStat label="Jobs today" value={String(todayPayouts.length)} />
              <HeroStat label="Active" value={String(active.length)} />
              <HeroStat label="Rating" value={Number(provider?.rating_avg ?? 0).toFixed(1)} icon="star" />
              <HeroStat label="Total jobs" value={String(provider?.jobs_completed ?? 0)} />
            </View>
          </LinearGradient>
        </Pressable>
      </View>

      <View style={gutter}>
        <Section
          title="New requests"
          subtitle={incoming.length ? 'Respond within 15 minutes' : undefined}
          action={incoming.length ? <Badge label={`${incoming.length} new`} tone="primary" /> : undefined}
        >
          {!jobs ? (
            <SkeletonCard lines={4} />
          ) : error && !jobs ? (
            <ErrorState message={error} onRetry={() => void load()} compact />
          ) : incoming.length === 0 ? (
            <Card>
              <EmptyState
                compact
                icon={online ? 'radio-outline' : 'moon-outline'}
                title={online ? 'Waiting for requests' : "You're offline"}
                message={online ? "We'll notify you as soon as a customer nearby books you." : 'Go online to start receiving jobs.'}
              />
            </Card>
          ) : (
            incoming.map((j) => {
              const left = Math.max(0, new Date(j.created_at).getTime() + RESPONSE_WINDOW_MS - now);
              const mm = Math.floor(left / 60000);
              const ss = Math.floor((left % 60000) / 1000);
              const urgent = left < 3 * 60 * 1000;
              return (
                <Animated.View key={j.booking_id} entering={FadeInDown.duration(240)} layout={LinearTransition}>
                  <Card variant="elevated" style={{ borderColor: urgent ? t.colors.danger : t.colors.border }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
                      <CategoryIcon icon={iconFor(j.category_name)} size={44} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text variant="title3" numberOfLines={1}>
                          {j.category_name}
                        </Text>
                        <Text variant="footnote" color="muted" numberOfLines={1}>
                          {j.customer_name || 'Customer'} · {j.area}
                        </Text>
                      </View>
                      <Badge
                        label={left > 0 ? `${mm}:${String(ss).padStart(2, '0')}` : 'Expired'}
                        tone={urgent ? 'danger' : 'warning'}
                        icon="timer-outline"
                        size="md"
                      />
                    </View>
                    <Text variant="callout" color="textSecondary" numberOfLines={3}>
                      “{j.description || 'No description'}”
                    </Text>
                    <View style={{ flexDirection: 'row', columnGap: t.spacing.lg, rowGap: 4, flexWrap: 'wrap' }}>
                      {j.distance_km != null ? <MetaItem icon="navigate-outline" label={`${j.distance_km} km away`} /> : null}
                      <MetaItem
                        icon="time-outline"
                        label={j.scheduled_at ? new Date(j.scheduled_at).toLocaleString('en-IN', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'ASAP'}
                      />
                      <MetaItem icon="checkmark-circle-outline" label={`${formatINR(j.visit_fee)} visit paid`} />
                    </View>
                    <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
                      <Button title="Decline" variant="outline" style={{ flex: 1 }} disabled={busyId === j.booking_id} onPress={() => void decline(j)} />
                      <Button
                        title="Accept"
                        style={{ flex: 2 }}
                        loading={busyId === j.booking_id}
                        onPress={() => void act(j.booking_id, () => acceptBooking(j.booking_id), 'Accepted! Start your trip when ready.')}
                      />
                    </View>
                  </Card>
                </Animated.View>
              );
            })
          )}
        </Section>
      </View>

      <View style={gutter}>
        <Section title="Active jobs" actionLabel="All jobs" onAction={() => router.push('/jobs')}>
          {!jobs ? (
            <SkeletonCard lines={2} />
          ) : active.length === 0 ? (
            <Text variant="callout" color="muted">
              No active jobs right now.
            </Text>
          ) : (
            active.map((j) => (
              <Card
                key={j.booking_id}
                onPress={() => router.push({ pathname: '/booking/[id]', params: { id: j.booking_id } })}
                accessibilityLabel={`${j.category_name} for ${j.customer_name}. Next: ${NEXT_STEP[j.status] ?? ''}`}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
                  <CategoryIcon icon={iconFor(j.category_name)} size={40} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="calloutStrong" numberOfLines={1}>
                      {j.customer_name || 'Customer'}
                    </Text>
                    <Text variant="footnote" color="muted" numberOfLines={1}>
                      #{j.booking_id.slice(0, 8)}
                    </Text>
                  </View>
                  <StatusPill status={j.status} />
                </View>
                {j.address_line ?? j.area ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Ionicons name="location-outline" size={14} color={t.colors.muted} />
                    <Text variant="footnote" color="textSecondary" numberOfLines={1} style={{ flex: 1 }}>
                      {j.address_line ? `${j.address_line}, ${j.area}` : j.area}
                    </Text>
                  </View>
                ) : null}
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    backgroundColor: t.colors.surfaceAlt,
                    borderRadius: t.radii.sm,
                    paddingHorizontal: t.spacing.md,
                    minHeight: 40,
                  }}
                >
                  <Text variant="footnote" color="muted">
                    Next step
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                    <Text variant="subheadStrong" color="primaryText">
                      {NEXT_STEP[j.status]}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color={t.colors.primaryText} />
                  </View>
                </View>
              </Card>
            ))
          )}
        </Section>
      </View>
    </Screen>
  );
}

function OnlineToggle({ online, onChange }: { online: boolean; onChange: (v: boolean) => void }) {
  const t = useTheme();
  const seg = (value: boolean, label: string) => {
    const selected = online === value;
    return (
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 12,
          height: 34,
          borderRadius: 17,
          backgroundColor: selected ? t.colors.segmentThumb : 'transparent',
          boxShadow: selected && !t.dark ? '0px 1px 2px rgba(16,24,40,0.08)' : undefined,
        }}
      >
        {value ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: selected ? t.colors.success : t.colors.outline }} /> : null}
        <Text variant={selected ? 'subheadStrong' : 'subhead'} color={selected ? 'text' : 'muted'}>
          {label}
        </Text>
      </View>
    );
  };
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: online }}
      accessibilityLabel={online ? 'You are online. Double tap to go offline' : 'You are offline. Double tap to go online'}
      onPress={() => onChange(!online)}
      hitSlop={4}
      style={{ flexDirection: 'row', padding: 3, borderRadius: 20, backgroundColor: t.colors.surfaceAlt, minHeight: 40 }}
    >
      {seg(true, 'Online')}
      {seg(false, 'Offline')}
    </Pressable>
  );
}

function HeroStat({ label, value, icon }: { label: string; value: string; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        {icon ? <Ionicons name={icon} size={14} color="#FEC84B" /> : null}
        <Text variant="title3" tabular style={{ color: '#FFFFFF' }}>
          {value}
        </Text>
      </View>
      <Text variant="caption" style={{ color: 'rgba(255,255,255,0.8)' }}>
        {label}
      </Text>
    </View>
  );
}
