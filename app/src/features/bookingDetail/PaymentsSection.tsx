import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Fragment } from 'react';
import { View } from 'react-native';
import { Badge, Button, Card, Divider, LIST_INSET, Section, Text, type Tone } from '../../components/ui';
import { useAppFeatureFlags } from '../../lib/featureFlags';
import { formatINR } from '../../lib/money';
import type { Payment, PaymentSchedule, PaymentStatus } from '../../lib/types';
import type { useTheme } from '../../theme';
import { shouldShowPaymentReceipt } from '../receipts/formatReceipt';
import { fmt, paymentRefundPresentation, paymentRowLabel, shouldShowPaymentRow } from './model';

type Theme = ReturnType<typeof useTheme>;

const PAYMENT_STATUS: Record<PaymentStatus, [string, Tone]> = {
  created: ['Pending', 'warning'],
  paid: ['Paid', 'success'],
  failed: ['Failed', 'danger'],
  refund_pending: ['Refund pending', 'neutral'],
  refund_processing: ['Refund processing', 'neutral'],
  refunded: ['Refunded', 'neutral'],
};

export function PaymentsSection({
  payments,
  schedules,
  theme: t,
}: {
  payments: Payment[];
  schedules: Pick<PaymentSchedule, 'payment_id' | 'label'>[];
  theme: Theme;
}) {
  const receiptsEnabled = useAppFeatureFlags().isOn('payment_receipts');
  const visiblePayments = payments.filter(shouldShowPaymentRow);
  return (
    <Section title="Payments">
      <Card padding={0} gap={0}>
        {visiblePayments.length === 0 ? (
          <View style={{ padding: t.spacing.lg }}>
            <Text variant="callout" color="muted">
              No payments yet.
            </Text>
          </View>
        ) : (
          visiblePayments.map((p, i) => {
            const [label, tone] = PAYMENT_STATUS[p.status];
            const refunds = paymentRefundPresentation(p);
            return (
              <Fragment key={p.id}>
                {i > 0 ? <Divider inset={LIST_INSET} /> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, paddingHorizontal: t.spacing.lg, paddingVertical: t.spacing.md }}>
                  <View
                    style={{ width: 32, height: 32, borderRadius: t.radii.sm, backgroundColor: t.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Ionicons name={p.purpose === 'visit_fee' ? 'home-outline' : 'construct-outline'} size={18} color={t.colors.textSecondary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="body">{paymentRowLabel(p, schedules)}</Text>
                    <Text variant="footnote" color="muted">
                      {fmt(p.paid_at ?? p.created_at)}
                    </Text>
                    {refunds.map((refund, refundIndex) => (
                      <Text key={`${p.id}-refund-${refundIndex}`} variant="footnote" color="muted">
                        {`Refund ${formatINR(refund.amountPaise)} · ${refund.status}${refund.at ? ` · ${fmt(refund.at)}` : ''}`}
                      </Text>
                    ))}
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text variant="calloutStrong" tabular>
                      {formatINR(p.amount)}
                    </Text>
                    <Badge label={label} tone={tone} />
                  </View>
                </View>
                {shouldShowPaymentReceipt(receiptsEnabled, p) ? (
                  <View style={{ alignItems: 'flex-end', paddingHorizontal: t.spacing.lg, paddingBottom: t.spacing.md }}>
                    <Button
                      title="View receipt"
                      size="sm"
                      variant="outline"
                      testID={`view-receipt-${p.id}`}
                      onPress={() => router.push({ pathname: '/receipt/[paymentId]', params: { paymentId: p.id } })}
                    />
                  </View>
                ) : null}
              </Fragment>
            );
          })
        )}
      </Card>
      <View style={{ flexDirection: 'row', gap: t.spacing.sm, alignItems: 'flex-start', paddingHorizontal: t.spacing.xs }}>
        <Ionicons name="shield-checkmark-outline" size={16} color={t.colors.successText} style={{ marginTop: 1 }} />
        <Text variant="footnote" color="muted" style={{ flex: 1 }}>
          Held by QuickServe and released to the pro 24 hours after completion.
        </Text>
      </View>
    </Section>
  );
}
