import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Button, EmptyState, ErrorState, Header, InlineAlert, ListItem, Screen, Skeleton, Text } from '../../components/ui';
import { listShopProductEnquiries, type EnquirySummary } from '../shops/api';
import { useShopFeatureFlags } from '../shops/components';
import { useTheme } from '../../theme';

export default function MerchantEnquiriesScreen() {
  const t = useTheme();
  const features = useShopFeatureFlags();
  const [enquiries, setEnquiries] = useState<EnquirySummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasRead, setHasRead] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEnquiries(await listShopProductEnquiries());
      setError(null);
      setHasRead(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <Screen header={<Header title="Shop enquiries" subtitle="Customer conversations about your catalogue" />} gap={t.spacing.md} refreshing={loading} onRefresh={() => void load()}>
      {error && !hasRead ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {error && hasRead ? <InlineAlert message={`Refresh failed. Showing saved enquiry history. ${error}`} actionLabel="Retry" onAction={() => void load()} /> : null}
      {!features.enquiries ? <Text variant="caption" color="muted">Existing enquiry history is read-only while product enquiries are turned off.</Text> : null}
      <Button title="Manage my shop" variant="outline" onPress={() => router.push('/merchant-shop')} />
      {loading && !hasRead ? <Skeleton height={80} radius={t.radii.lg} /> : enquiries.length ? enquiries.map((enquiry) => (
        <ListItem
          key={enquiry.id}
          icon="chatbubble-ellipses-outline"
          title={enquiry.product_name ?? 'General shop enquiry'}
          subtitle={`${enquiry.shop_name} · ${enquiry.customer_name ?? 'Customer'} · ${enquiry.status} · ${new Date(enquiry.last_message_at).toLocaleDateString()}`}
          right={enquiry.shop_unread ? <Text variant="captionStrong" color="primaryText">{enquiry.shop_unread} new</Text> : undefined}
          chevron
          onPress={() => router.push(`/enquiry/${enquiry.id}`)}
        />
      )) : hasRead ? (
        <EmptyState title="No enquiries yet" message="Customer questions will appear here." />
      ) : null}
    </Screen>
  );
}
