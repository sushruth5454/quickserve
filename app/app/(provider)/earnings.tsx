import { router, useFocusEffect } from 'expo-router';
import { Fragment, useCallback, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { HeroAmount } from '../../src/components/Money';
import {
  Badge,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  Header,
  InlineAlert,
  Screen,
  SegmentedControl,
  Skeleton,
  SkeletonCard,
  Text,
  type Tone,
} from '../../src/components/ui';
import { listMyPayouts } from '../../src/lib/api';
import { haptics } from '../../src/lib/haptics';
import { formatINR } from '../../src/lib/money';
import type { Payout, PayoutStatus } from '../../src/lib/types';
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
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>('week');
  const [picked, setPicked] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setPayouts(await listMyPayouts());
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
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 120, gap: 6 }} accessibilityRole="adjustable" accessibilityLabel="Earnings chart">
            {bars.map((b, i) => {
              const h = b.value > 0 ? Math.max(8, Math.round((b.value / max) * 112)) : 4;
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

      <InlineAlert
        tone="neutral"
        title="How payouts work"
        message={`Commission is charged on labour only — parts are passed through at 0%. Payouts reach your bank 24 hours after the customer confirms completion. Commission + GST so far: ${formatINR(summary.commission)} on ${formatINR(summary.gross)} billed.`}
      />

      <View style={{ gap: t.spacing.md }}>
        <Text variant="title3" accessibilityRole="header">
          Payouts
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
                          {`Billed ${formatINR(p.gross)} · Fees −\u00A0${formatINR(p.commission + p.gst_on_commission)}`}
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
