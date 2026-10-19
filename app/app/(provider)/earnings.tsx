import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card, ErrorText, Screen, Section } from '../../src/components/Screen';
import { listMyPayouts } from '../../src/lib/api';
import { formatINR } from '../../src/lib/money';
import { colors, font, spacing } from '../../src/lib/theme';
import type { Payout, PayoutStatus } from '../../src/lib/types';

const statusText: Record<PayoutStatus, string> = {
  pending: 'Pending (24h dispute window)',
  frozen: 'On hold (dispute)',
  transferred: 'Paid',
  failed: 'Failed — support will retry',
  reversed: 'Reversed',
  partially_reversed: 'Partially reversed',
};

export default function Earnings() {
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setPayouts(await listMyPayouts());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const summary = useMemo(() => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(startOfDay);
    startOfWeek.setDate(startOfWeek.getDate() - ((startOfWeek.getDay() + 6) % 7));
    const earned = payouts.filter((p) => p.status !== 'reversed');
    const sum = (list: Payout[]) => list.reduce((acc, p) => acc + p.amount, 0);
    return {
      today: sum(earned.filter((p) => new Date(p.created_at) >= startOfDay)),
      week: sum(earned.filter((p) => new Date(p.created_at) >= startOfWeek)),
      pending: sum(payouts.filter((p) => p.status === 'pending' || p.status === 'frozen' || p.status === 'failed')),
      paid: sum(payouts.filter((p) => p.status === 'transferred')),
      commission: payouts.reduce((acc, p) => acc + p.commission + p.gst_on_commission, 0),
    };
  }, [payouts]);

  return (
    <Screen refreshing={refreshing} onRefresh={load}>
      <View style={styles.grid}>
        <Stat label="Today" value={summary.today} />
        <Stat label="This week" value={summary.week} />
        <Stat label="Pending payout" value={summary.pending} color={colors.warning} />
        <Stat label="Paid out" value={summary.paid} color={colors.success} />
      </View>
      <Text style={font.caption}>
        Commission + GST deducted so far: {formatINR(summary.commission)}. Commission is charged on labour only — parts
        are passed through at 0%.
      </Text>
      <ErrorText message={error} />
      <Section title="Payouts">
        {payouts.length === 0 && <Text style={font.caption}>No payouts yet.</Text>}
        {payouts.map((p) => (
          <Card key={p.id}>
            <View style={styles.between}>
              <Text style={font.heading}>{formatINR(p.amount)}</Text>
              <Text style={font.caption}>{statusText[p.status]}</Text>
            </View>
            <Text style={font.caption}>
              Billed {formatINR(p.gross)} − commission {formatINR(p.commission)} − GST {formatINR(p.gst_on_commission)}
            </Text>
            <Text style={font.caption}>
              {p.transferred_at
                ? `Paid ${new Date(p.transferred_at).toLocaleString()}`
                : `Releases after ${new Date(p.release_after).toLocaleString()}`}
            </Text>
          </Card>
        ))}
      </Section>
    </Screen>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <Card style={styles.stat}>
      <Text style={font.caption}>{label}</Text>
      <Text style={[font.title, color ? { color } : null]}>{formatINR(value)}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  stat: { width: '47%', flexGrow: 1 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
