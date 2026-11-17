import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Button, EmptyState, Header, InlineAlert, ListItem, Screen, Skeleton, Text } from '../src/components/ui';
import { listShopProductEnquiries, type EnquirySummary } from '../src/features/shops/api';
import { FeatureUnavailable, useShopFeatureFlags } from '../src/features/shops/components';
import { useTheme } from '../src/theme';

export default function MerchantEnquiriesScreen() {
  const t = useTheme();
  const features = useShopFeatureFlags();
  const [enquiries, setEnquiries] = useState<EnquirySummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!features.enquiries) return;
    setLoading(true);
    try {
      setEnquiries(await listShopProductEnquiries());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [features.enquiries]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (!features.enquiries) {
    return <Screen header={<Header title="Shop enquiries" />}><FeatureUnavailable feature="Product enquiries are not available right now." /></Screen>;
  }

  return (
    <Screen header={<Header title="Shop enquiries" subtitle="Customer conversations about your catalogue" />} gap={t.spacing.md} refreshing={loading} onRefresh={() => void load()}>
      <InlineAlert message={error} />
      <Button title="Manage my shop" variant="outline" onPress={() => router.push('/merchant-shop')} />
      {loading ? <Skeleton height={80} radius={t.radii.lg} /> : enquiries.length ? enquiries.map((enquiry) => (
        <ListItem
          key={enquiry.id}
          icon="chatbubble-ellipses-outline"
          title={enquiry.product_name ?? 'General shop enquiry'}
          subtitle={`${enquiry.customer_name ?? 'Customer'} · ${enquiry.status} · ${new Date(enquiry.last_message_at).toLocaleDateString()}`}
          right={enquiry.shop_unread ? <Text variant="captionStrong" color="primaryText">{enquiry.shop_unread} new</Text> : undefined}
          chevron
          onPress={() => router.push(`/enquiry/${enquiry.id}`)}
        />
      )) : (
        <EmptyState title="No enquiries yet" message="Customer questions will appear here." />
      )}
    </Screen>
  );
}
