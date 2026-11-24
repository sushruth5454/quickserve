import { Children, type ReactNode } from 'react';
import { View } from 'react-native';
import { useAppFeatureFlags } from '../../lib/featureFlags';
import { Badge, Card, Text } from '../../components/ui';
import { useTheme } from '../../theme';
import type { RfqStatus } from './api';
import { rfqViewState } from './rfqStateModel';

export function useRfqFeatureFlags() {
  const flags = useAppFeatureFlags();
  return {
    rfq: flags.isOn('products') && flags.isOn('product_rfq'),
    enquiries: flags.isOn('products') && flags.isOn('product_enquiries'),
    composition: flags.isOn('oorva_brand') && flags.isOn('oorva_rfq_ux'),
  };
}

export function RfqCompositionSection({
  enabled,
  title,
  children,
}: {
  enabled: boolean;
  title: string;
  children: ReactNode;
}) {
  const t = useTheme();
  if (!enabled) return children;

  return (
    <View style={{ gap: t.spacing.sm }}>
      <Text variant="title3">{title}</Text>
      {children}
    </View>
  );
}

export function RfqSupplierComparisonLayout({
  wide,
  children,
}: {
  wide: boolean;
  children: ReactNode;
}) {
  const t = useTheme();
  return (
    <View
      testID="rfq-supplier-comparison"
      accessibilityLabel={`Supplier comparison, ${wide ? 'columns' : 'stacked'}`}
      style={{
        flexDirection: wide ? 'row' : 'column',
        flexWrap: wide ? 'wrap' : 'nowrap',
        alignItems: 'stretch',
        gap: t.spacing.md,
      }}
    >
      {Children.map(children, (child, index) => (
        <View
          key={index}
          style={wide ? { flexGrow: 1, flexBasis: 320, minWidth: 280 } : undefined}
        >
          {child}
        </View>
      ))}
    </View>
  );
}

export function rfqQuoteValidityWarning(validUntil: string, nowMs: number): string | null {
  const expiryMs = Date.parse(validUntil);
  if (!Number.isFinite(expiryMs)) return 'Quote validity is unavailable; refresh before selecting.';
  if (expiryMs <= nowMs) return 'Quote validity has ended; this supplier can no longer be selected.';
  return null;
}

export function RfqFeatureUnavailable() {
  return (
    <Card>
      <Text color="muted">Bulk product quotations are not available right now.</Text>
    </Card>
  );
}

export function RfqStatusLabel({
  status,
  expiresAt,
  nowMs = Date.now(),
}: {
  status: RfqStatus;
  expiresAt?: string;
  nowMs?: number;
}) {
  const label = expiresAt
    ? rfqViewState({
      status,
      expiresAt,
      quoteStatus: null,
      myOutcome: null,
      canSendQuote: false,
      nowMs,
    }).rfqLabel
    : status === 'closed' ? 'Closed' : status.charAt(0).toUpperCase() + status.slice(1);
  const expiryMs = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  const deadlinePassed = Number.isFinite(expiryMs) && expiryMs <= nowMs;
  const deadlineFuture = Number.isFinite(expiryMs) && expiryMs > nowMs;
  const tone = status === 'open' && (!expiresAt || deadlineFuture)
    ? 'success'
    : status === 'expired' || status === 'cancelled' || (status === 'open' && deadlinePassed)
      ? 'danger'
      : 'neutral';
  return <Badge label={label} tone={tone} />;
}
