import { Ionicons } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';
import { formatINR } from '../lib/money';
import type { PaymentSchedule as PaymentScheduleRow } from '../lib/types';
import { useTheme } from '../theme';
import { Card, Text } from './ui';

interface Props {
  rows: PaymentScheduleRow[];
  onPay?: (row: PaymentScheduleRow) => void;
}

export function PaymentSchedule({ rows, onPay }: Props) {
  const t = useTheme();
  return (
    <Card gap={0} padding={0}>
      {rows.map((row, index) => {
        const paid = row.status === 'paid';
        const due = row.status === 'due';
        const color = paid ? t.colors.success : due ? t.colors.warning : t.colors.muted;
        return (
          <Pressable
            key={row.id}
            accessibilityRole={due && onPay ? 'button' : undefined}
            onPress={() => due && onPay?.(row)}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: t.spacing.md,
              padding: t.spacing.lg,
              borderTopWidth: index ? 1 : 0, borderTopColor: t.colors.border,
              opacity: row.status === 'waived' || row.status === 'refunded' ? 0.6 : 1,
            }}
          >
            <Ionicons name={paid ? 'checkmark-circle' : due ? 'card' : 'ellipse-outline'} size={23} color={color} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text variant="bodyStrong">{row.label}</Text>
              <Text variant="caption" color="muted">
                {paid ? 'Paid' : due ? 'Due now' : row.due_at ? new Date(row.due_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : row.due_rule.replaceAll('_', ' ')}
              </Text>
            </View>
            <Text variant="calloutStrong" tabular>{formatINR(row.amount)}</Text>
            {due && onPay ? <Ionicons name="chevron-forward" size={18} color={t.colors.primaryText} /> : null}
          </Pressable>
        );
      })}
    </Card>
  );
}
