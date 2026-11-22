import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { Button, Card, EmptyState, Header, Screen, Text } from '../../components/ui';
import { getReceipt } from '../../lib/api';
import type { PaymentReceipt } from '../../lib/apiTypes';
import { useAppFeatureFlags } from '../../lib/featureFlags';
import { formatReceipt } from '../receipts/formatReceipt';
import { useTheme } from '../../theme';

function ReceiptRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 16 }}>
      <Text variant={strong ? 'bodyStrong' : 'callout'} color={strong ? 'text' : 'muted'} style={{ flex: 1 }}>
        {label}
      </Text>
      <Text variant={strong ? 'bodyStrong' : 'callout'} color="text" tabular>
        {value}
      </Text>
    </View>
  );
}

function useReceiptDetailController(paymentId: string | undefined, receiptsEnabled: boolean) {
  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    if (!receiptsEnabled || !paymentId) {
      setReceipt(null);
      setLoading(false);
      return () => {
        active = false;
      };
    }

    setLoading(true);
    void getReceipt(paymentId)
      .then((result) => {
        if (active) setReceipt(result);
      })
      .catch(() => {
        if (active) setReceipt(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [paymentId, receiptsEnabled]);

  return { receipt, formatted: receipt ? formatReceipt(receipt) : null, loading };
}

export default function ReceiptDetailScreen() {
  const t = useTheme();
  const { paymentId } = useLocalSearchParams<{ paymentId: string }>();
  const receiptsEnabled = useAppFeatureFlags().isOn('payment_receipts');
  const { receipt, formatted, loading } = useReceiptDetailController(paymentId, receiptsEnabled);

  return (
    <Screen
      header={<Header title="Payment receipt" onBack={() => router.back()} />}
      gap={t.spacing.md}
    >
      {loading ? (
        <Card>
          <Text variant="callout" color="muted">Loading receipt…</Text>
        </Card>
      ) : !formatted || !receipt ? (
        <EmptyState
          icon="receipt-outline"
          title="Receipt unavailable"
          message="This payment receipt is unavailable or receipt access is turned off."
          actionLabel="Back to booking"
          onAction={() => router.back()}
        />
      ) : (
        <Card variant="elevated" gap={t.spacing.md}>
          <View style={{ gap: 4 }}>
            <Text variant="title3">Nearo — Payment receipt</Text>
            <Text variant="footnote" color="muted">Receipt no: {formatted.receiptNumber}</Text>
            <Text variant="footnote" color="muted">
              {formatted.issuedAt ? `Date & time: ${formatted.issuedAt}` : 'Date & time unavailable'}
              {' · Status at issue: '}{formatted.statusAtIssue}
            </Text>
          </View>

          <View style={{ gap: 3 }}>
            <Text variant="callout">{formatted.bookingRef} · {formatted.category}</Text>
            <Text variant="footnote" color="muted">Provider: {formatted.providerDisplayName}</Text>
            <Text variant="footnote" color="muted">
              Billed to: {formatted.customerName}{formatted.customerLocality ? ` · ${formatted.customerLocality}` : ''}
            </Text>
          </View>

          <View style={{ gap: t.spacing.sm }}>
            <Text variant="bodyStrong">Items</Text>
            {formatted.items.length === 0 ? (
              <Text variant="footnote" color="muted">No itemized services on this payment.</Text>
            ) : formatted.items.map((item, index) => (
              <View key={`${item.description}-${index}`} style={{ gap: 2 }}>
                <ReceiptRow label={item.description} value={item.amount} />
                <Text variant="footnote" color="muted">
                  {item.qty} × {item.unitPrice} · {item.kind.replace(/_/g, ' ')}
                </Text>
              </View>
            ))}
          </View>

          <View style={{ gap: t.spacing.sm }}>
            <ReceiptRow label="Service subtotal" value={formatted.subtotal} />
            <ReceiptRow label="Platform fee" value={formatted.platformFee} />
            {formatted.taxLines.map((line, index) => (
              <ReceiptRow key={`${line.label}-${index}`} label={line.label} value={line.amount} />
            ))}
            {receipt.snapshot.coins_discount > 0 ? (
              <ReceiptRow label="Seva Coins (funded by Nearo)" value={formatted.coinsDiscount} />
            ) : null}
            <ReceiptRow label="Total" value={formatted.total} strong />
          </View>

          {formatted.priorPayments.length > 0 ? (
            <View style={{ gap: t.spacing.sm }}>
              <Text variant="bodyStrong">Paid earlier</Text>
              {formatted.priorPayments.map((payment, index) => (
                <View key={`${payment.label}-${index}`} style={{ gap: 2 }}>
                  <ReceiptRow label={payment.label} value={`−${payment.amount}`} />
                  <Text variant="footnote" color="muted">
                    {payment.paidAt ?? 'Date unavailable'} · {payment.method}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          <View style={{ gap: 2 }}>
            <ReceiptRow label={`Original payment on receipt (${formatted.paidNowMethod})`} value={formatted.paidNow} strong />
            {formatted.paidNowGatewayRef ? (
              <Text variant="footnote" color="muted">Reference: {formatted.paidNowGatewayRef}</Text>
            ) : null}
            <ReceiptRow label="Balance at issue time" value={formatted.balanceDueAtIssue} strong />
          </View>

          <View style={{ gap: 2 }}>
            <ReceiptRow label="Current payment status" value={formatted.currentPaymentStatus} />
            {formatted.readAt ? (
              <Text variant="footnote" color="muted">Current status read at {formatted.readAt}</Text>
            ) : null}
            {formatted.isDemoPayment ? (
              <Text variant="footnote" color="muted">Simulated demo payment</Text>
            ) : null}
          </View>

          <View style={{ gap: t.spacing.sm }}>
            <Text variant="bodyStrong">Current refunds</Text>
            {formatted.currentRefunds.length === 0 ? (
              <Text variant="footnote" color="muted">None currently recorded</Text>
            ) : formatted.currentRefunds.map((refund) => (
              <ReceiptRow
                key={refund.id}
                label={`Refund · ${refund.status}${refund.createdAt ? ` · Created ${refund.createdAt}` : ''}${refund.processedAt ? ` · Processed ${refund.processedAt}` : ''}`}
                value={refund.amount}
              />
            ))}
          </View>

          {formatted.refundsAtIssue.length > 0 ? (
            <View style={{ gap: t.spacing.sm }}>
              <Text variant="bodyStrong">Refunds recorded on original receipt</Text>
              {formatted.refundsAtIssue.map((refund, index) => (
                <ReceiptRow
                  key={`${refund.amount}-${index}`}
                  label={`Refund · ${refund.status}${refund.processedAt ? ` · ${refund.processedAt}` : ''}`}
                  value={refund.amount}
                />
              ))}
            </View>
          ) : null}

          <Text variant="footnote" color="muted">
            Release timing follows the terms stored for this booking.
          </Text>
          <Text variant="footnote" color="muted">This is a payment receipt, not a tax invoice.</Text>

          {formatted.taxInvoiceUrl ? (
            <Button
              title={formatted.taxInvoiceLabel}
              size="sm"
              variant="outline"
              onPress={() => void Linking.openURL(formatted.taxInvoiceUrl!)}
            />
          ) : (
            <Text variant="footnote" color="muted">Tax invoice: {formatted.taxInvoiceLabel}</Text>
          )}
          {formatted.disputeLink ? (
            <Button
              title="Open booking"
              size="sm"
              variant="outline"
              onPress={() => router.push({ pathname: '/booking/[id]', params: { id: receipt.booking_id } })}
            />
          ) : null}
        </Card>
      )}
    </Screen>
  );
}
