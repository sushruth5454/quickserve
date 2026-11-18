import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Button, EmptyState, Header, InlineAlert, ListItem, Screen, Skeleton, Text } from '../src/components/ui';
import { listMySupplierRfqs, type SupplierRfqSummary } from '../src/features/rfq/api';
import { RfqFeatureUnavailable, useRfqFeatureFlags } from '../src/features/rfq/components';
import { useTheme } from '../src/theme';

export default function MerchantRfqsScreen() {
  const t = useTheme();
  const { rfq: enabled } = useRfqFeatureFlags();
  const [rfqs, setRfqs] = useState<SupplierRfqSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      setRfqs(await listMySupplierRfqs());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (!enabled) {
    return <Screen header={<Header title="Supplier RFQs" />}><RfqFeatureUnavailable /></Screen>;
  }

  return (
    <Screen
      header={<Header title="Supplier RFQs" subtitle="Requests routed to your verified shop" />}
      gap={t.spacing.md}
      refreshing={loading}
      onRefresh={() => void load()}
    >
      <InlineAlert message={error} />
      {loading ? <Skeleton height={84} radius={t.radii.lg} /> : rfqs.length ? rfqs.map((rfq) => (
        <ListItem
          key={`${rfq.shop_id}:${rfq.rfq_id}`}
          icon="document-text-outline"
          title={rfq.title}
          subtitle={`${rfq.category_name} · ${rfq.item_count} item(s) · ${rfq.area}, ${rfq.city} · Needed by ${new Date(`${rfq.needed_by}T00:00:00`).toLocaleDateString()}`}
          right={<Text variant="captionStrong" color={rfq.quote_status ? 'successText' : 'primaryText'}>{rfq.quote_status ? 'Quote sent' : 'Reply'}</Text>}
          chevron
          onPress={() => router.push({
            pathname: '/rfq/merchant/[id]',
            params: { id: rfq.rfq_id, shopId: rfq.shop_id },
          })}
        />
      )) : (
        <EmptyState title="No open RFQs" message="Customer product quote requests routed to your shop will appear here." />
      )}
      <Button title="Manage my shop" variant="outline" onPress={() => router.push('/merchant-shop')} />
    </Screen>
  );
}
