import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Badge,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  Header,
  Screen,
  SkeletonCard,
  Text,
} from '../src/components/ui';
import { getProviderStatement } from '../src/lib/api';
import { formatINR } from '../src/lib/money';
import { payoutStatusCopy, summarizeProviderStatement } from '../src/lib/providerInsights';
import { useAppFeatureFlags } from '../src/lib/featureFlags';
import type { ProviderStatementRow } from '../src/lib/types';
import { useTheme } from '../src/theme';

const pad = (value: number) => String(value).padStart(2, '0');
const monthRange = (month: Date) => {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const from = `${year}-${pad(monthIndex + 1)}-01`;
  const to = `${year}-${pad(monthIndex + 1)}-${pad(new Date(year, monthIndex + 1, 0).getDate())}`;
  return { from, to };
};
const shiftMonth = (month: Date, amount: number) =>
  new Date(month.getFullYear(), month.getMonth() + amount, 1);
const fmtDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const fmtWhen = (value: string) =>
  new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export default function EarningsStatement() {
  const t = useTheme();
  const flags = useAppFeatureFlags();
  const enabled = flags.isOn('provider_earnings_statement');
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [rows, setRows] = useState<ProviderStatementRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const range = useMemo(() => monthRange(month), [month]);

  const load = useCallback(async () => {
    setRows(null);
    try {
      setRows(await getProviderStatement(range.from, range.to));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [range.from, range.to]);

  useFocusEffect(useCallback(() => {
    if (enabled) void load();
  }, [enabled, load]));

  const totals = useMemo(() => summarizeProviderStatement(rows ?? []), [rows]);

  return (
    <Screen
      header={<Header title="Monthly statement" />}
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        if (enabled) await load();
        setRefreshing(false);
      }}
    >
      {!enabled ? (
        <EmptyState
          icon="document-text-outline"
          title="Statements unavailable"
          message="Monthly earnings statements and venue payout rows are currently unavailable."
        />
      ) : error && !rows ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : (
        <>
          <Card gap={t.spacing.md}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Previous month"
                onPress={() => setMonth((current) => shiftMonth(current, -1))}
                hitSlop={8}
                style={{ padding: t.spacing.sm }}
              >
                <Ionicons name="chevron-back" size={20} color={t.colors.text} />
              </Pressable>
              <Text variant="title3" accessibilityRole="header">
                {month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Next month"
                onPress={() => setMonth((current) => shiftMonth(current, 1))}
                hitSlop={8}
                style={{ padding: t.spacing.sm }}
              >
                <Ionicons name="chevron-forward" size={20} color={t.colors.text} />
              </Pressable>
            </View>
            <Text variant="footnote" color="muted" align="center">
              {fmtDate(range.from)} – {fmtDate(range.to)}
            </Text>
          </Card>

          {!rows ? (
            <SkeletonCard avatar={false} lines={4} />
          ) : (
            <>
              <Card gap={t.spacing.sm}>
                <Text variant="title3">Statement totals</Text>
                <AmountLine label="Provider bill" value={totals.gross} />
                <AmountLine label="Commission" value={-totals.commission} />
                <AmountLine label="GST on commission" value={-totals.gstOnCommission} />
                <AmountLine label="Reversed" value={-totals.reversedAmount} />
                {totals.demo > 0 ? (
                  <>
                    <AmountLine label="Demo-only rows (excluded)" value={totals.demo} />
                    <Text variant="caption" color="muted">
                      Demo-only amounts are simulated and are not bank transfers; they are excluded from statement totals.
                    </Text>
                  </>
                ) : null}
                <Divider />
                <AmountLine label="Net payout recorded before reversals" value={totals.net} strong />
                <Divider />
                <AmountLine label="Pending transfer" value={totals.pending} />
                <AmountLine label="On hold · dispute" value={totals.frozen} />
                <AmountLine label="Payment problem" value={totals.failed} />
                <Text variant="caption" color="muted">
                  Statutory deductions, if any, will be shown here. Customer platform fees are not part of your provider bill.
                </Text>
              </Card>

              <View style={{ gap: t.spacing.sm }}>
                <Text variant="title3" accessibilityRole="header">Payout rows</Text>
                {rows.length === 0 ? (
                  <EmptyState title="No payouts this month" message="Payout records for this month will appear here." />
                ) : rows.map((row) => <StatementRow key={row.payout_id} row={row} />)}
              </View>
            </>
          )}
        </>
      )}
    </Screen>
  );
}

function StatementRow({ row }: { row: ProviderStatementRow }) {
  const t = useTheme();
  const status = payoutStatusCopy(row.status);
  const openTarget = () => {
    if (row.sports_booking_id) {
      router.push({ pathname: '/sports-booking/[id]', params: { id: row.sports_booking_id } });
    } else if (row.booking_id) {
      router.push({ pathname: '/booking/[id]', params: { id: row.booking_id } });
    }
  };
  const releaseDate = new Date(row.release_after);
  const pendingDetail = row.status === 'pending'
    ? releaseDate.getTime() > Date.now()
      ? `Scheduled for ${fmtWhen(row.release_after)}`
      : 'Awaiting transfer; the scheduled release time has passed.'
    : null;

  return (
    <Card gap={t.spacing.sm} padding={t.spacing.md}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${row.booking_ref}, ${status.label}, ${formatINR(row.net)}`}
        onPress={openTarget}
        style={{ gap: t.spacing.sm }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.sm }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">{row.booking_ref}</Text>
            <Text variant="caption" color="muted">{fmtDate(row.date)}</Text>
          </View>
          <Badge label={status.label} tone={status.tone} dot />
        </View>
        <AmountLine label="Provider bill" value={row.gross} />
        <AmountLine label="Commission" value={-row.commission} />
        <AmountLine label="GST on commission" value={-row.gst_on_commission} />
        {row.reversed_amount > 0 ? <AmountLine label="Reversed" value={-row.reversed_amount} /> : null}
        <Divider />
        <AmountLine label="Net payout before reversals" value={row.net} strong />
        <Text variant="caption" color={row.status === 'failed' ? 'dangerText' : 'muted'}>
          {pendingDetail ?? status.detail}
        </Text>
        {row.transferred_at ? (
          <Text variant="caption" color="muted">
            Transferred {fmtWhen(row.transferred_at)}
            {row.utr ? ` · UTR ${row.utr}` : row.razorpay_transfer_id ? ` · Transfer ${row.razorpay_transfer_id}` : ''}
          </Text>
        ) : row.razorpay_transfer_id ? (
          <Text variant="caption" color="muted">Transfer {row.razorpay_transfer_id}</Text>
        ) : null}
      </Pressable>
    </Card>
  );
}

function AmountLine({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <Text variant={strong ? 'bodyStrong' : 'footnote'} color={strong ? 'text' : 'textSecondary'}>{label}</Text>
      <Text variant={strong ? 'bodyStrong' : 'footnote'} tabular>{value < 0 ? `−${formatINR(Math.abs(value))}` : formatINR(value)}</Text>
    </View>
  );
}
