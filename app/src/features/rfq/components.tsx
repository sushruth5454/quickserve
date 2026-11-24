import { useAppFeatureFlags } from '../../lib/featureFlags';
import { Badge, Card, Text } from '../../components/ui';
import type { RfqStatus } from './api';
import { rfqViewState } from './rfqStateModel';

export function useRfqFeatureFlags() {
  const flags = useAppFeatureFlags();
  return {
    rfq: flags.isOn('products') && flags.isOn('product_rfq'),
    enquiries: flags.isOn('products') && flags.isOn('product_enquiries'),
  };
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
