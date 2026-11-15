import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, InlineAlert, Skeleton, Text } from '../../components/ui';
import { formatINR } from '../../lib/money';
import { useTheme } from '../../theme';
import { getPaymentSchedule, payMilestone, type PaymentScheduleItem } from './api';

export function PaymentScheduleTimeline({ bookingId, canPay }: { bookingId: string; canPay: boolean }) {
  const t = useTheme();
  const [items, setItems] = useState<PaymentScheduleItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState<string | null>(null);
  const load = useCallback(() => getPaymentSchedule(bookingId).then(setItems).catch((caught: Error) => setError(caught.message)), [bookingId]);
  useEffect(() => { void load(); }, [load]);

  const pay = async (item: PaymentScheduleItem) => {
    setPaying(item.id);
    try {
      const payment = await payMilestone(item.id);
      await WebBrowser.openBrowserAsync(payment.short_url);
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setPaying(null);
    }
  };

  if (items === null) return <Skeleton height={120} radius={t.radii.lg} />;
  if (items.length === 0) return null;
  return (
    <Card gap={t.spacing.md} variant="outlined">
      <View style={{ gap: 2 }}>
        <Text variant="title3">Payment timeline</Text>
        <Text variant="footnote" color="muted">Each milestone is paid separately when it becomes due.</Text>
      </View>
      <InlineAlert message={error} />
      <View>
        {items.map((item, index) => {
          const paid = item.status === 'paid' || item.status === 'waived' || item.status === 'refunded';
          const due = item.status === 'due';
          return (
            <View key={item.id} style={{ flexDirection: 'row', gap: t.spacing.md }}>
              <View style={{ alignItems: 'center', width: 24 }}>
                <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: paid ? t.colors.successSoft : due ? t.colors.warningSoft : t.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name={paid ? 'checkmark' : due ? 'card-outline' : 'time-outline'} size={14} color={paid ? t.colors.successText : due ? t.colors.warningText : t.colors.muted} />
                </View>
                {index < items.length - 1 ? <View style={{ width: 1, flex: 1, minHeight: 32, backgroundColor: t.colors.border }} /> : null}
              </View>
              <View style={{ flex: 1, paddingBottom: t.spacing.lg, gap: 3 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
                  <Text variant="bodyStrong" style={{ flex: 1 }}>{item.label}</Text>
                  <Text variant="calloutStrong" tabular>{formatINR(item.amount)}</Text>
                </View>
                <Text variant="footnote" color="muted">
                  {paid ? item.status.replaceAll('_', ' ') : item.due_at ? new Date(item.due_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : item.due_rule.replaceAll('_', ' ')}
                </Text>
                {canPay && due ? <Button title={`Pay ${formatINR(item.amount)}`} onPress={() => void pay(item)} loading={paying === item.id} size="sm" variant="primary" style={{ marginTop: t.spacing.xs, alignSelf: 'flex-start' }} /> : null}
              </View>
            </View>
          );
        })}
      </View>
    </Card>
  );
}
