import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Button, EmptyState, Header, InlineAlert, ListItem, Screen, Skeleton, Text } from '../../components/ui';
import { listMySupplierRfqs, type SupplierRfqSummary } from '../rfq/api';
import { useRfqFeatureFlags } from '../rfq/components';
import { useTheme } from '../../theme';

export default function MerchantRfqsScreen() {
  const t = useTheme();
  const { rfq: enabled } = useRfqFeatureFlags();
  const [rfqs, setRfqs] = useState<SupplierRfqSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRfqs(await listMySupplierRfqs());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <Screen
      header={<Header title="Supplier RFQs" subtitle="Requests routed to your verified shop" />}
      gap={t.spacing.md}
      refreshing={loading}
      onRefresh={() => void load()}
    >
      <InlineAlert message={error} />
      {!enabled ? <Text variant="caption" color="muted">Existing RFQ history is read-only while product RFQs are turned off.</Text> : null}
      {loading ? <Skeleton height={84} radius={t.radii.lg} /> : rfqs.length ? rfqs.map((rfq) => {
        const outcomeLabel = rfq.my_outcome === 'selected' ? 'Selected'
          : rfq.my_outcome === 'rejected' ? 'Not selected'
            : rfq.rfq_status === 'cancelled' ? 'Cancelled'
              : rfq.rfq_status === 'expired' ? 'Expired'
                : rfq.quote_status ? 'Quote sent' : 'Reply';
        return (
          <ListItem
            key={`${rfq.shop_id}:${rfq.rfq_id}`}
            icon="document-text-outline"
            title={rfq.title}
            subtitle={`${rfq.category_name} · ${rfq.item_count} item(s) · ${rfq.area}, ${rfq.city} · Needed by ${new Date(`${rfq.needed_by}T00:00:00`).toLocaleDateString()}`}
            right={<Text variant="captionStrong" color={rfq.my_outcome === 'selected' ? 'successText' : rfq.my_outcome === 'rejected' ? 'muted' : 'primaryText'}>{outcomeLabel}</Text>}
            chevron
            onPress={() => router.push({
              pathname: '/rfq/merchant/[id]',
              params: { id: rfq.rfq_id, shopId: rfq.shop_id },
            })}
          />
        );
      }) : (
        <EmptyState title="No recent RFQs" message="Requests routed to your shop and their outcomes appear here for 30 days." />
      )}
      <Button title="Manage my shop" variant="outline" onPress={() => router.push('/merchant-shop')} />
    </Screen>
  );
}
