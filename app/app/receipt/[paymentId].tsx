import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { Button, Card, EmptyState, Header, Screen, Text } from '../../src/components/ui';
import { getReceipt } from '../../src/lib/api';
import type { PaymentReceipt } from '../../src/lib/apiTypes';
import { useAppFeatureFlags } from '../../src/lib/featureFlags';
import { formatReceipt } from '../../src/features/receipts/formatReceipt';
import { useTheme } from '../../src/theme';

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

export default function PaymentReceiptScreen() {
  const t = useTheme();
  const { paymentId } = useLocalSearchParams<{ paymentId: string }>();
  const receiptsEnabled = useAppFeatureFlags().isOn('payment_receipts');
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

  const formatted = receipt ? formatReceipt(receipt) : null;

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
              {' · Status: '}{formatted.status}
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
            <ReceiptRow label={`Paid now (${formatted.paidNowMethod})`} value={formatted.paidNow} strong />
            {formatted.paidNowGatewayRef ? (
              <Text variant="footnote" color="muted">Reference: {formatted.paidNowGatewayRef}</Text>
            ) : null}
            <ReceiptRow label="Balance due" value={formatted.balanceDue} strong />
          </View>

          <View style={{ gap: t.spacing.sm }}>
            <Text variant="bodyStrong">Refunds</Text>
            {formatted.refunds.length === 0 ? (
              <Text variant="footnote" color="muted">None</Text>
            ) : formatted.refunds.map((refund, index) => (
              <ReceiptRow
                key={`${refund.amount}-${index}`}
                label={`Refund · ${refund.status}${refund.processedAt ? ` · ${refund.processedAt}` : ''}`}
                value={refund.amount}
              />
            ))}
          </View>

          <Text variant="footnote" color="muted">
            Money is held by Nearo and released to the provider 24 h after you confirm completion.
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
