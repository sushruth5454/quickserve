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
} from '../../src/components/ui';
import { getCommissionTerms, getMyProvider, listMyPayouts, type CommissionTerms } from '../../src/lib/api';
import { useAppFeatureFlags } from '../../src/lib/featureFlags';
import { haptics } from '../../src/lib/haptics';
import { formatINR } from '../../src/lib/money';
import { payoutStatusCopy, tierProgress } from '../../src/lib/providerInsights';
import type { Payout, Provider } from '../../src/lib/types';
import { bookingRef } from '../../src/lib/schedule';
import { useTheme } from '../../src/theme';

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
  const flags = useAppFeatureFlags();
  const statementEnabled = flags.isOn('provider_earnings_statement');
  const [payouts, setPayouts] = useState<Payout[] | null>(null);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [providerLoaded, setProviderLoaded] = useState(false);
  const [commissionTerms, setCommissionTerms] = useState<CommissionTerms | null>(null);
  const [commissionError, setCommissionError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>('week');
  const [picked, setPicked] = useState<number | null>(null);

  const load = useCallback(async () => {
    setCommissionTerms(null);
    setCommissionError(null);
    try {
      const [po, pr] = await Promise.all([listMyPayouts(), getMyProvider()]);
      setPayouts(po);
      setProvider(pr);
      setProviderLoaded(true);
      setError(null);
      try {
        setCommissionTerms(await getCommissionTerms());
        setCommissionError(null);
      } catch (e) {
        setCommissionTerms(null);
        setCommissionError((e as Error).message);
      }
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
    const financial = list.filter((p) => p.status !== 'demo');
    const earned = financial.filter((p) => p.status !== 'reversed' && p.status !== 'frozen');
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
      pending: sum(financial.filter((p) => p.status === 'pending')),
      frozen: sum(financial.filter((p) => p.status === 'frozen')),
      failed: sum(financial.filter((p) => p.status === 'failed')),
      paid: sum(financial.filter((p) => p.status === 'transferred')),
      commission: financial.reduce((acc, p) => acc + p.commission, 0),
      gstOnCommission: financial.reduce((acc, p) => acc + p.gst_on_commission, 0),
      gross: financial.reduce((acc, p) => acc + p.gross, 0),
      nextRelease: financial
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
      <View style={{ flexDirection: 'row', gap: t.spacing.md, marginTop: -t.spacing.sm }}>
        <MiniStat label="On hold · dispute" value={summary.frozen} loading={!payouts} />
        <MiniStat label="Payment problem" value={summary.failed} loading={!payouts} />
      </View>

      {provider ? <TierCard provider={provider} terms={commissionTerms} error={commissionError} /> : providerLoaded ? null : <SkeletonCard avatar={false} lines={2} />}

      <Card padding={0} gap={0}>
        {provider ? (
          <>
            <InfoLine
              icon="business-outline"
              title="Payout account"
              value={
                provider.razorpay_account_id && provider.kyc_status === 'verified'
                  ? 'Linked · verified'
                  : provider.kyc_status === 'rejected'
                    ? 'Verification failed'
                    : 'Verification pending'
              }
              tone={provider.razorpay_account_id && provider.kyc_status === 'verified' ? 'success' : 'warning'}
              onPress={() => router.push('/onboarding')}
            />
            <Divider inset={t.spacing.lg + 32 + t.spacing.md} />
          </>
        ) : null}
        <InfoLine
          icon="calendar-outline"
          title="Next payout"
          value={
            summary.nextRelease
              ? `${formatINR(summary.nextRelease.amount)} · ${
                  new Date(summary.nextRelease.release_after).getTime() > Date.now()
                    ? `scheduled ${fmtWhen(summary.nextRelease.release_after)}`
                    : `awaiting transfer since ${fmtWhen(summary.nextRelease.release_after)}`
                }`
              : 'Nothing pending'
          }
        />
        {statementEnabled ? (
          <>
            <Divider inset={t.spacing.lg + 32 + t.spacing.md} />
            <InfoLine
              icon="document-text-outline"
              title="Monthly statement"
              value="View payout rows"
              onPress={() => router.push('/earnings-statement')}
            />
          </>
        ) : null}
      </Card>
      <Text variant="footnote" color="muted" style={{ marginTop: -t.spacing.sm, paddingHorizontal: t.spacing.xs }}>
        Commission: {formatINR(summary.commission)} · GST on commission: {formatINR(summary.gstOnCommission)} on {formatINR(summary.gross)} billed.
        {' '}Statutory deductions, if any, will be shown here.
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
                  const status = payoutStatusCopy(p.status);
                  return (
                    <Fragment key={p.id}>
                      {i > 0 ? <Divider inset={t.spacing.lg} /> : null}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Payout ${formatINR(p.amount)}, ${status.label}`}
                        onPress={() => {
                          if (p.sports_booking_id) {
                            router.push({ pathname: '/sports-booking/[id]', params: { id: p.sports_booking_id } });
                          } else if (p.booking_id) {
                            router.push({ pathname: '/booking/[id]', params: { id: p.booking_id } });
                          }
                        }}
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
                          <Badge label={status.label} tone={status.tone} dot />
                        </View>
                        <Text variant="caption" color={p.status === 'failed' ? 'dangerText' : 'muted'}>
                          {status.detail}
                        </Text>
                        <Text variant="footnote" color="muted" tabular numberOfLines={1}>
                          {`Billed ${formatINR(p.gross)} · Commission −${formatINR(p.commission)} · GST −${formatINR(p.gst_on_commission)}`}
                        </Text>
                        <Text variant="footnote" color="muted" tabular numberOfLines={1}>
                          {`Net payout ${formatINR(p.amount)}`}
                        </Text>
                        <Text variant="footnote" color="muted" numberOfLines={1}>
                          {`${bookingRef(p.sports_booking_id ?? p.booking_id ?? p.id)} · `}
                          {p.transferred_at
                            ? `Paid ${fmtWhen(p.transferred_at)}`
                            : p.status === 'pending'
                                ? new Date(p.release_after).getTime() > Date.now()
                                  ? `Scheduled ${fmtWhen(p.release_after)}`
                                  : 'Awaiting transfer; scheduled release time passed'
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

function TierCard({ provider, terms, error }: { provider: Provider; terms: CommissionTerms | null; error: string | null }) {
  const t = useTheme();
  if (!terms) {
    return (
      <Card gap={t.spacing.sm}>
        <Text variant="calloutStrong">Commission information unavailable</Text>
        <Text variant="footnote" color="muted">{error ?? 'Try refreshing to load the current provider terms.'}</Text>
      </Card>
    );
  }
  const tier = tierProgress({ jobsCompleted: provider.jobs_completed, terms, at: new Date() });
  const rate = tier.rateBp == null ? null : tier.rateBp / 100;
  const title = tier.freeUntil ? 'Standard jobs · 0% commission' : rate == null ? 'Standard-job commission unavailable' : `Standard jobs · ${rate}% commission`;
  const percent = (bp: number) => `${bp / 100}%`;
  const sub = tier.freeUntil
    ? `Your ${terms.founding_days}-day free period ends ${tier.freeUntil.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}.${tier.nextRateBp != null ? ` Then ${percent(tier.nextRateBp)} at your current job count.` : ''}`
    : tier.nextRateBp != null && tier.jobsToNext != null
      ? `${tier.jobsToNext} more completed in-app job${tier.jobsToNext === 1 ? '' : 's'} to ${percent(tier.nextRateBp)}`
      : 'You are on the lowest commission tier.';
  const tiers = [...terms.tiers].sort((a, b) => a.min_jobs - b.min_jobs);
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
      {!tier.freeUntil && tier.nextRateBp != null ? (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(tier.progress * 100) }}
          style={{ height: 8, borderRadius: 4, backgroundColor: t.colors.surfaceAlt, overflow: 'hidden' }}
        >
          <View style={{ width: `${Math.round(tier.progress * 100)}%`, height: '100%', borderRadius: 4, backgroundColor: t.colors.primary }} />
        </View>
      ) : null}
      <Text variant="captionStrong" color="muted">Standard job tiers</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {tiers.map((configuredTier, index) => {
          const nextThreshold = tiers[index + 1]?.min_jobs;
          const jobs = nextThreshold == null ? `${configuredTier.min_jobs}+` : `${configuredTier.min_jobs}–${nextThreshold - 1}`;
          const on = !tier.freeUntil && tier.currentTierMinJobs === configuredTier.min_jobs;
          return (
            <View key={configuredTier.min_jobs} style={{ alignItems: 'center', flex: 1 }}>
              <Text variant={on ? 'subheadStrong' : 'subhead'} color={on ? 'primaryText' : 'muted'}>
                {percent(configuredTier.bp)}
              </Text>
              <Text variant="caption" color="muted">
                {jobs} jobs
              </Text>
            </View>
          );
        })}
      </View>
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="subheadStrong">Time-based sessions</Text>
        <Text variant="caption" color="muted">
          Default rates after the {terms.founding_days}-day founding period · no repeat-customer discount
        </Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: t.spacing.md }}>
          <View style={{ flex: 1 }}>
            <Text variant="caption" color="muted">One-off</Text>
            <Text variant="calloutStrong">{percent(terms.time_based.one_off_bp)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="caption" color="muted">Recurring</Text>
            <Text variant="calloutStrong">{percent(terms.time_based.recurring_bp)}</Text>
          </View>
        </View>
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