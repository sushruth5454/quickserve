import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, InlineAlert, Skeleton, Text } from '../../components/ui';
import { formatINR } from '../../lib/money';
import { useTheme } from '../../theme';
import { usePayment } from '../../lib/payments';
import { getPaymentSchedule, type PaymentScheduleItem } from './api';

/**
 * Read-only list of the booking's payment obligations, plus ONE pay button for everything due now.
 * The booking footer owns the first payment (pending_payment), so pass showPay=false there.
 */
export function PaymentScheduleTimeline({ bookingId, canPay, showPay = true, onPaid }: { bookingId: string; canPay: boolean; showPay?: boolean; onPaid?: () => void }) {
  const t = useTheme();
  const [items, setItems] = useState<PaymentScheduleItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const startPayment = usePayment();
  const load = useCallback(() => getPaymentSchedule(bookingId).then(setItems).catch((caught: Error) => setError(caught.message)), [bookingId]);
  useEffect(() => { void load(); }, [load]);

  const payDue = async () => {
    setPaying(true);
    setError(null);
    try {
      await startPayment(bookingId);
      await load();
      onPaid?.();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setPaying(false);
    }
  };

  if (items === null) return <Skeleton height={120} radius={t.radii.lg} />;
  if (items.length === 0) return null;
  const dueNow = items.filter((item) => item.status === 'due').reduce((sum, item) => sum + item.amount, 0);
  return (
    <Card gap={t.spacing.md} variant="outlined">
      <View style={{ gap: 2 }}>
        <Text variant="title3">Payment timeline</Text>
        <Text variant="footnote" color="muted">Anything due is paid together in one payment. Later milestones are collected when they fall due.</Text>
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
                <Text variant="footnote" color={due ? 'warningText' : 'muted'}>
                  {paid ? item.status.replaceAll('_', ' ') : due ? 'Due now' : item.due_at ? new Date(item.due_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : item.due_rule.replaceAll('_', ' ')}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
      {canPay && showPay && dueNow > 0 ? (
        <Button title={`Pay ${formatINR(dueNow)}`} leftIcon="lock-closed" onPress={() => void payDue()} loading={paying} fullWidth />
      ) : null}
    </Card>
  );
}
