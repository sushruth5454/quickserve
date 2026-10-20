import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Badge, Card, Divider, EmptyState, ErrorState, Header, Screen, Section, Skeleton, SkeletonCard, Text, type Tone } from '../../src/components/ui';
import { listMyPayouts } from '../../src/lib/api';
import { formatINR } from '../../src/lib/money';
import type { Payout, PayoutStatus } from '../../src/lib/types';
import { useTheme, type Palette } from '../../src/theme';

const statusText: Record<PayoutStatus, [string, Tone]> = {
  pending: ['In 24h hold', 'warning'],
  frozen: ['On hold (dispute)', 'danger'],
  transferred: ['Paid', 'success'],
  failed: ['Retrying', 'danger'],
  reversed: ['Reversed', 'neutral'],
  partially_reversed: ['Partly reversed', 'neutral'],
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export default function Earnings() {
  const t = useTheme();
  const [payouts, setPayouts] = useState<Payout[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfWeek.getDate() - ((startOfWeek.getDay() + 6) % 7));
    const earned = list.filter((p) => p.status !== 'reversed');
    const sum = (xs: Payout[]) => xs.reduce((acc, p) => acc + p.amount, 0);
    return {
      today: sum(earned.filter((p) => new Date(p.created_at) >= startOfDay)),
      week: sum(earned.filter((p) => new Date(p.created_at) >= startOfWeek)),
      pending: sum(list.filter((p) => p.status === 'pending' || p.status === 'frozen' || p.status === 'failed')),
      paid: sum(list.filter((p) => p.status === 'transferred')),
      commission: list.reduce((acc, p) => acc + p.commission + p.gst_on_commission, 0),
      gross: list.reduce((acc, p) => acc + p.gross, 0),
    };
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
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.md }}>
        <Stat label="Today" value={summary.today} icon="today-outline" tint="primary" loading={!payouts} />
        <Stat label="This week" value={summary.week} icon="calendar-outline" tint="info" loading={!payouts} />
        <Stat label="Pending payout" value={summary.pending} icon="hourglass-outline" tint="warning" loading={!payouts} />
        <Stat label="Paid to bank" value={summary.paid} icon="checkmark-done-outline" tint="success" loading={!payouts} />
      </View>

      <Card variant="filled" gap={t.spacing.sm}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
          <Ionicons name="information-circle" size={18} color={t.colors.primary} />
          <Text variant="subhead">How payouts work</Text>
        </View>
        <Text variant="caption" color="textSecondary">
          Commission is charged on labour only — parts are passed through at 0%. Payouts reach your bank 24 hours after the
          customer confirms completion. Commission + GST so far: {formatINR(summary.commission)} on {formatINR(summary.gross)} billed.
        </Text>
      </Card>

      <Section title="Payouts">
        {!payouts ? (
          Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} avatar={false} />)
        ) : payouts.length === 0 ? (
          <EmptyState icon="wallet-outline" title="No payouts yet" message="Complete your first job to see earnings here." />
        ) : (
          payouts.map((p) => {
            const [label, tone] = statusText[p.status];
            return (
              <Card key={p.id} gap={t.spacing.sm} onPress={() => router.push({ pathname: '/booking/[id]', params: { id: p.booking_id } })} accessibilityLabel={`Payout ${formatINR(p.amount)}, ${label}`}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.sm }}>
                  <View>
                    <Text variant="title3" tabular>
                      {formatINR(p.amount)}
                    </Text>
                    <Text variant="caption" color="muted">
                      Booking #{p.booking_id.slice(0, 8)}
                    </Text>
                  </View>
                  <Badge label={label} tone={tone} dot size="md" />
                </View>
                <Divider />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Mini label="Billed" value={formatINR(p.gross)} />
                  <Mini label="Commission" value={`−${formatINR(p.commission)}`} />
                  <Mini label="GST" value={`−${formatINR(p.gst_on_commission)}`} />
                </View>
                <Text variant="caption" color="muted">
                  {p.transferred_at ? `Paid ${fmt(p.transferred_at)}` : `Releases after ${fmt(p.release_after)}`}
                </Text>
              </Card>
            );
          })
        )}
      </Section>
    </Screen>
  );
}

function Stat({
  label,
  value,
  icon,
  tint,
  loading,
}: {
  label: string;
  value: number;
  icon: keyof typeof Ionicons.glyphMap;
  tint: keyof Pick<Palette, 'primary' | 'info' | 'warning' | 'success'>;
  loading: boolean;
}) {
  const t = useTheme();
  const soft = { primary: t.colors.primarySoft, info: t.colors.infoSoft, warning: t.colors.warningSoft, success: t.colors.successSoft }[tint];
  return (
    <Card style={{ width: '47%', flexGrow: 1 }} gap={t.spacing.md}>
      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: soft, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={18} color={t.colors[tint]} />
      </View>
      <View style={{ gap: 2 }}>
        <Text variant="caption" color="muted">
          {label}
        </Text>
        {loading ? <Skeleton width={90} height={24} /> : (
          <Text variant="title2" tabular numberOfLines={1} adjustsFontSizeToFit>
            {formatINR(value)}
          </Text>
        )}
      </View>
    </Card>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Text variant="micro" color="muted" uppercase>
        {label}
      </Text>
      <Text variant="subhead" tabular>
        {value}
      </Text>
    </View>
  );
}
