import { useAppFeatureFlags } from '../../lib/featureFlags';
import { Badge, Card, Text } from '../../components/ui';
import type { RfqStatus } from './api';

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

export function RfqStatusLabel({ status }: { status: RfqStatus }) {
  const tone = status === 'open' ? 'success' : status === 'expired' || status === 'cancelled' ? 'danger' : 'neutral';
  return <Badge label={status === 'closed' ? 'Closed' : status[0].toUpperCase() + status.slice(1)} tone={tone} />;
}
