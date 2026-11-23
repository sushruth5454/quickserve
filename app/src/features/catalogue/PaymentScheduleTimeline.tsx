import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';
import { Button, Card, ErrorState, InlineAlert, Skeleton, Text } from '../../components/ui';
import { formatINR } from '../../lib/money';
import type { PaymentSchedule } from '../../lib/types';
import { useTheme } from '../../theme';

/**
 * Read-only presentation of the booking's parent-loaded payment obligations.
 * The booking screen owns refresh, retry and the single payment action.
 */
export function PaymentScheduleTimeline({
  bookingId,
  items,
  loading,
  error,
  onRetry,
  canPay,
  showPay = true,
  onPayDue,
  paying,
}: {
  bookingId: string;
  items: PaymentSchedule[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  canPay: boolean;
  showPay?: boolean;
  onPayDue: () => void;
  paying: boolean;
}) {
  const t = useTheme();

  if (items === null) {
    if (error) return <ErrorState message={error} onRetry={onRetry} />;
    if (loading) return <Skeleton height={120} radius={t.radii.lg} />;
    return <ErrorState message="Payment schedule is unavailable." onRetry={onRetry} />;
  }
  if (items.length === 0 && !error) return null;

  const dueNow = items.filter((item) => item.status === 'due').reduce((sum, item) => sum + item.amount, 0);
  return (
    <Card gap={t.spacing.md} variant="outlined" accessibilityLabel={`Payment timeline for booking ${bookingId}`}>
      <View style={{ gap: 2 }}>
        <Text variant="title3">Payment timeline</Text>
        <Text variant="footnote" color="muted">Anything due is paid together in one payment. Later milestones are collected when they fall due.</Text>
      </View>
      <InlineAlert message={error} />
      {error ? <Button title="Retry" variant="outline" onPress={onRetry} /> : null}
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
        <Button title={`Pay ${formatINR(dueNow)}`} leftIcon="lock-closed" onPress={onPayDue} loading={paying} fullWidth />
      ) : null}
    </Card>
  );
}
