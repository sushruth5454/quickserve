import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CategoryIcon } from '../../src/components/CategoryIcon';
import { MetaItem } from '../../src/components/ProviderCard';
import { StatusPill } from '../../src/components/status';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  InlineAlert,
  Screen,
  Section,
  SkeletonCard,
  Text,
  useConfirm,
  useToast,
} from '../../src/components/ui';
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
      <View style={{ paddingTop: insets.top + t.spacing.md, paddingHorizontal: t.spacing.lg, gap: t.spacing.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
          <View style={{ flex: 1 }}>
            <Text variant="caption" color="muted">
              {new Date(now).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
            </Text>
            <Text variant="title1" accessibilityRole="header">
              {firstName ? `Hi ${firstName}` : 'Your jobs'}
            </Text>
          </View>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: online }}
            accessibilityLabel={online ? 'You are online. Double tap to go offline' : 'You are offline. Double tap to go online'}
            onPress={() => void toggleOnline(!online)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingLeft: 14,
              paddingRight: 6,
              minHeight: 48,
              borderRadius: t.radii.pill,
              backgroundColor: online ? t.colors.successSoft : t.colors.surfaceAlt,
              borderWidth: 1,
              borderColor: online ? t.colors.success : t.colors.border,
            }}
          >
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: online ? t.colors.success : t.colors.subtle }} />
            <Text variant="captionStrong" color={online ? 'successText' : 'muted'}>
              {online ? 'ONLINE' : 'OFFLINE'}
            </Text>
            <Switch
              value={online}
              onValueChange={(v) => void toggleOnline(v)}
              trackColor={{ true: t.colors.success, false: t.colors.borderStrong }}
              thumbColor="#FFFFFF"
              importantForAccessibility="no-hide-descendants"
              accessibilityElementsHidden
              style={{ transform: [{ scale: 0.85 }] }}
            />
          </Pressable>
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

        <Pressable accessibilityRole="button" accessibilityLabel={`Today's earnings ${formatINR(today)}. Open earnings`} onPress={() => router.navigate('/earnings')}>
          <LinearGradient
            colors={[t.colors.heroFrom, t.colors.heroTo]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ borderRadius: t.radii.xl, padding: t.spacing.xl, gap: t.spacing.lg, overflow: 'hidden' }}
          >
            <Ionicons name="wallet" size={120} color="rgba(255,255,255,0.08)" style={{ position: 'absolute', right: -16, bottom: -24 }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ gap: 2 }}>
                <Text variant="caption" style={{ color: 'rgba(255,255,255,0.8)' }}>
                  Today's earnings
                </Text>
                <Text variant="display" style={{ color: '#FFFFFF' }} tabular>
                  {formatINR(today)}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
                <Ionicons name="star" size={12} color="#FEC84B" />
                <Text variant="captionStrong" style={{ color: '#FFFFFF' }}>
                  {Number(provider?.rating_avg ?? 0).toFixed(1)}
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: t.spacing.xl }}>
              <HeroStat label="Jobs today" value={String(todayPayouts.length)} />
              <HeroStat label="Active" value={String(active.length)} />
              <HeroStat label="Total jobs" value={String(provider?.jobs_completed ?? 0)} />
            </View>
          </LinearGradient>
        </Pressable>
      </View>

      <View style={{ paddingHorizontal: t.spacing.lg }}>
        <Section
          title="New requests"
          subtitle={incoming.length ? 'Respond within 15 minutes' : undefined}
          action={incoming.length ? <Badge label={`${incoming.length} new`} tone="danger" /> : undefined}
        >
          {!jobs ? (
            <SkeletonCard lines={4} />
          ) : error && !jobs ? (
            <ErrorState message={error} onRetry={() => void load()} compact />
          ) : incoming.length === 0 ? (
            <Card variant="outlined">
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
                <Animated.View key={j.booking_id} entering={FadeInDown.duration(260)} layout={LinearTransition}>
                  <Card elevation="md" gap={t.spacing.md} style={{ borderColor: urgent ? t.colors.danger : t.colors.border }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
                      <CategoryIcon icon={iconFor(j.category_name)} size={44} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text variant="title3">{j.category_name}</Text>
                        <Text variant="caption" color="muted">
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
                    <View style={{ flexDirection: 'row', gap: t.spacing.lg, flexWrap: 'wrap' }}>
                      {j.distance_km != null ? <MetaItem icon="navigate-outline" label={`${j.distance_km} km away`} /> : null}
                      <MetaItem
                        icon="time-outline"
                        label={j.scheduled_at ? new Date(j.scheduled_at).toLocaleString('en-IN', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'ASAP'}
                      />
                      <MetaItem icon="checkmark-circle-outline" label={`Visit ${formatINR(j.visit_fee)} paid`} />
                    </View>
                    <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
                      <Button title="Decline" variant="outline" style={{ flex: 1 }} disabled={busyId === j.booking_id} onPress={() => void decline(j)} />
                      <Button
                        title="Accept"
                        leftIcon="checkmark"
                        style={{ flex: 2 }}
                        loading={busyId === j.booking_id}
                        onPress={() =>
                          void act(j.booking_id, () => acceptBooking(j.booking_id), 'Accepted! Start your trip when ready.')
                        }
                      />
                    </View>
                  </Card>
                </Animated.View>
              );
            })
          )}
        </Section>
      </View>

      <View style={{ paddingHorizontal: t.spacing.lg }}>
        <Section
          title="Active jobs"
          action={<Button title="All jobs" variant="ghost" size="sm" rightIcon="chevron-forward" onPress={() => router.push('/jobs')} />}
        >
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
                gap={t.spacing.md}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
                  <CategoryIcon icon={iconFor(j.category_name)} size={40} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="bodyStrong" numberOfLines={1}>
                      {j.customer_name || 'Customer'}
                    </Text>
                    <Text variant="caption" color="muted" numberOfLines={1}>
                      #{j.booking_id.slice(0, 8)} · {j.category_name}
                    </Text>
                  </View>
                  <StatusPill status={j.status} />
                </View>
                {j.address_line ?? j.area ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Ionicons name="location-outline" size={15} color={t.colors.muted} />
                    <Text variant="caption" color="textSecondary" numberOfLines={1} style={{ flex: 1 }}>
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
                    paddingVertical: 10,
                  }}
                >
                  <Text variant="caption" color="muted">
                    Next step
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Text variant="subhead" color="primary">
                      {NEXT_STEP[j.status]}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color={t.colors.primary} />
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

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text variant="title3" style={{ color: '#FFFFFF' }}>
        {value}
      </Text>
      <Text variant="caption" style={{ color: 'rgba(255,255,255,0.8)' }}>
        {label}
      </Text>
    </View>
  );
}
