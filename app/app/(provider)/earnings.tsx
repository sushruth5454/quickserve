import { router, useFocusEffect } from 'expo-router';
import { Fragment, useCallback, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { HeroAmount } from '../../src/components/Money';
import {
  Badge,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  Header,
  Screen,
  SegmentedControl,
  Skeleton,
  SkeletonCard,
  Text,
  type Tone,
} from '../../src/components/ui';
import { getMyProvider, listMyPayouts } from '../../src/lib/api';
import { haptics } from '../../src/lib/haptics';
import { formatINR } from '../../src/lib/money';
import { tierProgress } from '../../src/lib/providerInsights';
import type { Payout, PayoutStatus, Provider } from '../../src/lib/types';
import { bookingRef } from '../../src/lib/schedule';
import { useTheme } from '../../src/theme';

const statusText: Record<PayoutStatus, [string, Tone]> = {
  pending: ['On hold', 'warning'],
  frozen: ['Frozen · dispute', 'danger'],
  transferred: ['Paid', 'success'],
  failed: ['Retrying', 'danger'],
  reversed: ['Reversed', 'neutral'],
  partially_reversed: ['Partly reversed', 'neutral'],
};

const DAY = 24 * 60 * 60 * 1000;
const fmtDay = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const fmtWhen = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function dayLabel(d: Date) {
  const today = startOfDay(new Date());
  const diff = Math.round((today.getTime() - startOfDay(d).getTime()) / DAY);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

type Period = 'week' | 'month';

export default function Earnings() {
  const t = useTheme();
  const [payouts, setPayouts] = useState<Payout[] | null>(null);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>('week');
  const [picked, setPicked] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [po, pr] = await Promise.all([listMyPayouts(), getMyProvider()]);
      setPayouts(po);
      setProvider(pr);
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

  const summary = useMemo(() => {
    const list = payouts ?? [];
    const sod = startOfDay(new Date());
    const startOfWeek = new Date(sod);
    startOfWeek.setDate(startOfWeek.getDate() - ((startOfWeek.getDay() + 6) % 7));
    const earned = list.filter((p) => p.status !== 'reversed');
    const sum = (xs: Payout[]) => xs.reduce((acc, p) => acc + p.amount, 0);
    const between = (from: Date, to: Date) => sum(earned.filter((p) => new Date(p.created_at) >= from && new Date(p.created_at) < to));

    const week = Array.from({ length: 7 }).map((_, i) => {
      const from = new Date(startOfWeek.getTime() + i * DAY);
      const to = new Date(from.getTime() + DAY);
      return {
        short: from.toLocaleDateString('en-IN', { weekday: 'narrow' }),
        long: from.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }),
        value: between(from, to),
        future: from > sod,
      };
    });
    const month = Array.from({ length: 4 }).map((_, i) => {
      const from = new Date(startOfWeek.getTime() - (3 - i) * 7 * DAY);
      const to = new Date(from.getTime() + 7 * DAY);
      return { short: fmtDay(from), long: `Week of ${fmtDay(from)}`, value: between(from, to), future: false };
    });
    const todayIndex = (sod.getDay() + 6) % 7;
    return {
      week,
      month,
      todayIndex,
      weekTotal: sum(earned.filter((p) => new Date(p.created_at) >= startOfWeek)),
      monthTotal: month.reduce((a, b) => a + b.value, 0),
      pending: sum(list.filter((p) => p.status === 'pending' || p.status === 'frozen' || p.status === 'failed')),
      paid: sum(list.filter((p) => p.status === 'transferred')),
      commission: list.reduce((acc, p) => acc + p.commission + p.gst_on_commission, 0),
      gross: list.reduce((acc, p) => acc + p.gross, 0),
      nextRelease: list
        .filter((p) => p.status === 'pending')
        .sort((a, b) => a.release_after.localeCompare(b.release_after))[0] ?? null,
    };
  }, [payouts]);

  const bars = period === 'week' ? summary.week : summary.month;
  const selected = picked ?? (period === 'week' ? summary.todayIndex : bars.length - 1);
  const sel = bars[selected];
  const max = Math.max(1, ...bars.map((b) => b.value));

  const groups = useMemo(() => {
    const out: { key: string; label: string; items: Payout[] }[] = [];
    for (const p of payouts ?? []) {
      const d = new Date(p.created_at);
      const key = d.toDateString();
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(p);
      else out.push({ key, label: dayLabel(d), items: [p] });
    }
    return out;
  }, [payouts]);

  return (
    <Screen
      inTabs
      header={<Header title="Earnings" large back={false} />}
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await load();
        setRefreshing(false);
      }}
    >
      {error && !payouts ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      <Card variant="elevated" gap={t.spacing.lg}>
        <SegmentedControl<Period>
          options={[
            { value: 'week', label: 'This week' },
            { value: 'month', label: 'Last 4 weeks' },
          ]}
          value={period}
          onChange={(v) => {
            setPeriod(v);
            setPicked(null);
          }}
          accessibilityLabel="Earnings period"
        />
        <View style={{ gap: 2 }}>
          <Text variant="footnote" color="muted">
            {period === 'week' ? 'Earned this week' : 'Earned in the last 4 weeks'}
          </Text>
          {!payouts ? <Skeleton width={160} height={36} /> : <HeroAmount paise={period === 'week' ? summary.weekTotal : summary.monthTotal} />}
        </View>
        <View style={{ gap: t.spacing.sm }}>
          <Text variant="footnote" color="textSecondary" tabular>
            {sel ? `${sel.long} · ${formatINR(sel.value)}` : ' '}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 96, gap: 6 }} accessibilityRole="adjustable" accessibilityLabel="Earnings chart">
            {bars.map((b, i) => {
              const h = b.value > 0 ? Math.max(8, Math.round((b.value / max) * 88)) : 4;
              const isSel = i === selected;
              return (
                <Pressable
                  key={b.long}
                  accessibilityRole="button"
                  accessibilityLabel={`${b.long}: ${formatINR(b.value)}`}
                  accessibilityState={{ selected: isSel }}
                  onPress={() => {
                    haptics.select();
                    setPicked(i);
                  }}
                  style={{ flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center' }}
                >
                  <View
                    style={{
                      width: '64%',
                      maxWidth: 32,
                      height: h,
                      borderRadius: 6,
                      backgroundColor:
                        b.value === 0 ? t.colors.border : isSel ? t.colors.primary : t.dark ? '#24407F' : '#C7D7FE',
                    }}
                  />
                </Pressable>
              );
            })}
          </View>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {bars.map((b, i) => (
              <Text
                key={b.long}
                variant={i === selected ? 'captionStrong' : 'caption'}
                color={i === selected ? 'text' : 'muted'}
                align="center"
                numberOfLines={1}
                style={{ flex: 1 }}
              >
                {b.short}
              </Text>
            ))}
          </View>
        </View>
      </Card>

      <View style={{ flexDirection: 'row', gap: t.spacing.md, marginTop: -t.spacing.sm }}>
        <MiniStat label="Pending payout" value={summary.pending} loading={!payouts} />
        <MiniStat label="Paid to bank" value={summary.paid} loading={!payouts} />
      </View>

      {provider ? <TierCard provider={provider} /> : <SkeletonCard avatar={false} lines={2} />}

      <Card padding={0} gap={0}>
        <InfoLine
          icon="business-outline"
          title="Payout account"
          value={
            provider?.razorpay_account_id && provider.kyc_status === 'verified'
              ? 'Linked · verified'
              : provider?.kyc_status === 'rejected'
                ? 'Verification failed'
                : 'Verification pending'
          }
          tone={provider?.razorpay_account_id && provider.kyc_status === 'verified' ? 'success' : 'warning'}
          onPress={() => router.push('/onboarding')}
        />
        <Divider inset={t.spacing.lg + 32 + t.spacing.md} />
        <InfoLine
          icon="calendar-outline"
          title="Next payout"
          value={
            summary.nextRelease
              ? `${formatINR(summary.nextRelease.amount)} on ${fmtWhen(summary.nextRelease.release_after)}`
              : 'Nothing pending'
          }
        />
      </Card>
      <Text variant="footnote" color="muted" style={{ marginTop: -t.spacing.sm, paddingHorizontal: t.spacing.xs }}>
        Payouts are released 24 hours after the customer confirms completion. Commission applies to labour only — parts pass
        through at 0%. Fees so far: {formatINR(summary.commission)} on {formatINR(summary.gross)} billed.
      </Text>

      <View style={{ gap: t.spacing.md }}>
        <Text variant="title3" accessibilityRole="header">
          Jobs & payouts
        </Text>
        {!payouts ? (
          Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} avatar={false} lines={2} />)
        ) : payouts.length === 0 ? (
          <EmptyState icon="wallet-outline" title="No payouts yet" message="Complete your first job to see earnings here." />
        ) : (
          groups.map((g) => (
            <View key={g.key} style={{ gap: t.spacing.sm }}>
              <Text variant="overline" color="muted" style={{ paddingHorizontal: t.spacing.lg }}>
                {g.label}
              </Text>
              <Card padding={0} gap={0} style={{ overflow: 'hidden' }}>
                {g.items.map((p, i) => {
                  const [label, tone] = statusText[p.status];
                  return (
                    <Fragment key={p.id}>
                      {i > 0 ? <Divider inset={t.spacing.lg} /> : null}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Payout ${formatINR(p.amount)}, ${label}`}
                        onPress={() => router.push({ pathname: '/booking/[id]', params: { id: p.booking_id } })}
                        style={({ pressed }) => ({
                          paddingHorizontal: t.spacing.lg,
                          paddingVertical: t.spacing.md,
                          gap: 4,
                          backgroundColor: pressed ? t.colors.surfaceAlt : 'transparent',
                        })}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.sm }}>
                          <Text variant="bodyStrong" tabular>
                            {formatINR(p.amount)}
                          </Text>
                          <Badge label={label} tone={tone} dot />
                        </View>
                        <Text variant="footnote" color="muted" tabular numberOfLines={1}>
                          {`Billed ${formatINR(p.gross)} · Fees −\u00A0${formatINR(p.commission + p.gst_on_commission)} · Net ${formatINR(p.amount)}`}
                        </Text>
                        <Text variant="footnote" color="muted" numberOfLines={1}>
                          {`${bookingRef(p.booking_id)} · `}
                          {p.transferred_at
                            ? `Paid ${fmtWhen(p.transferred_at)}`
                            : p.status === 'pending'
                              ? `Releases ${fmtWhen(p.release_after)}`
                              : `Created ${fmtWhen(p.created_at)}`}
                        </Text>
                      </Pressable>
                    </Fragment>
                  );
                })}
              </Card>
            </View>
          ))
        )}
      </View>
    </Screen>
  );
}

function MiniStat({ label, value, loading }: { label: string; value: number; loading: boolean }) {
  return (
    <Card style={{ flex: 1 }} gap={4}>
      <Text variant="footnote" color="muted">
        {label}
      </Text>
      {loading ? (
        <Skeleton width={90} height={24} />
      ) : (
        <Text variant="title2" tabular numberOfLines={1} adjustsFontSizeToFit style={{ minHeight: 26 }}>
          {formatINR(value)}
        </Text>
      )}
    </Card>
  );
}

function TierCard({ provider }: { provider: Provider }) {
  const t = useTheme();
  const tier = tierProgress({ jobsCompleted: provider.jobs_completed, createdAt: new Date(provider.created_at), at: new Date() });
  const rate = tier.rateBp / 100;
  const title = tier.freeUntil ? '0% commission' : `${rate}% commission`;
  const sub = tier.freeUntil
    ? `Free period until ${tier.freeUntil.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}. Then 12%, falling to 10% at 50 jobs.`
    : tier.nextRateBp != null && tier.jobsToNext != null
      ? `${tier.jobsToNext} more completed in-app job${tier.jobsToNext === 1 ? '' : 's'} to ${tier.nextRateBp / 100}%`
      : 'You are on the lowest commission tier.';
  return (
    <Card gap={t.spacing.md}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="trending-down" size={20} color={t.colors.primaryText} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="calloutStrong">{title}</Text>
          <Text variant="footnote" color="muted">
            {sub}
          </Text>
        </View>
        <Text variant="title3" tabular>
          {provider.jobs_completed}
          <Text variant="footnote" color="muted">
            {' '}
            jobs
          </Text>
        </Text>
      </View>
      {!tier.freeUntil ? (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(tier.progress * 100) }}
          style={{ height: 8, borderRadius: 4, backgroundColor: t.colors.surfaceAlt, overflow: 'hidden' }}
        >
          <View style={{ width: `${Math.round(tier.progress * 100)}%`, height: '100%', borderRadius: 4, backgroundColor: t.colors.primary }} />
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {[
          ['12%', '0–49'],
          ['10%', '50–199'],
          ['8%', '200+'],
        ].map(([r, jobs]) => {
          const on = !tier.freeUntil && `${rate}%` === r;
          return (
            <View key={r} style={{ alignItems: 'center', flex: 1 }}>
              <Text variant={on ? 'subheadStrong' : 'subhead'} color={on ? 'primaryText' : 'muted'}>
                {r}
              </Text>
              <Text variant="caption" color="muted">
                {jobs} jobs
              </Text>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

function InfoLine(props: { icon: keyof typeof Ionicons.glyphMap; title: string; value: string; tone?: 'success' | 'warning'; onPress?: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      disabled={!props.onPress}
      onPress={props.onPress}
      accessibilityRole={props.onPress ? 'button' : 'text'}
      accessibilityLabel={`${props.title}: ${props.value}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing.md,
        paddingHorizontal: t.spacing.lg,
        paddingVertical: t.spacing.md,
        backgroundColor: pressed ? t.colors.surfaceAlt : 'transparent',
      })}
    >
      <View style={{ width: 32, height: 32, borderRadius: t.radii.sm, backgroundColor: t.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={props.icon} size={18} color={t.colors.textSecondary} />
      </View>
      <Text variant="body" style={{ flex: 1 }}>
        {props.title}
      </Text>
      <Text
        variant="footnoteStrong"
        color={props.tone === 'success' ? 'successText' : props.tone === 'warning' ? 'warningText' : 'textSecondary'}
        numberOfLines={1}
        style={{ flexShrink: 1 }}
      >
        {props.value}
      </Text>
      {props.onPress ? <Ionicons name="chevron-forward" size={16} color={t.colors.subtle} /> : null}
    </Pressable>
  );
}