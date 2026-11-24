import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Button, EmptyState, ErrorState, Header, InlineAlert, ListItem, Screen, Skeleton, Text } from '../../components/ui';
import { listShopProductEnquiries, type EnquirySummary } from '../shops/api';
import { useShopFeatureFlags } from '../shops/components';
import { useTheme } from '../../theme';

function routeParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function readRouteParams<T extends object>(): T {
  const routeHook = useLocalSearchParams as unknown as (() => T) | undefined;
  return (routeHook ?? (() => ({} as T)))();
}

export default function MerchantEnquiriesScreen() {
  const t = useTheme();
  const params = readRouteParams<{ ownerId?: string | string[]; shopId?: string | string[] }>();
  const ownerId = routeParam(params.ownerId);
  const shopId = routeParam(params.shopId);
  const features = useShopFeatureFlags();
  const [enquiries, setEnquiries] = useState<EnquirySummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasRead, setHasRead] = useState(false);
  const [readShopId, setReadShopId] = useState<string | undefined>();
  const hasReadCurrentScope = hasRead && readShopId === shopId;
  const visibleEnquiries = hasReadCurrentScope ? enquiries : [];

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const authorizedEnquiries = await listShopProductEnquiries();
      setEnquiries(shopId ? authorizedEnquiries.filter((enquiry) => enquiry.shop_id === shopId) : authorizedEnquiries);
      setError(null);
      setHasRead(true);
      setReadShopId(shopId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const manageShop = () => {
    if (ownerId || shopId) {
      router.push({
        pathname: '/merchant-shop',
        params: {
          ...(ownerId ? { ownerId } : {}),
          ...(shopId ? { shopId } : {}),
        },
      });
    } else {
      router.push('/merchant-shop');
    }
  };

  return (
    <Screen header={<Header title="Shop enquiries" subtitle="Customer conversations about your catalogue" />} gap={t.spacing.md} refreshing={loading} onRefresh={() => void load()}>
      {error && !hasReadCurrentScope ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {error && hasReadCurrentScope ? <InlineAlert message={`Refresh failed. Showing saved enquiry history. ${error}`} actionLabel="Retry" onAction={() => void load()} /> : null}
      {!features.enquiries ? <Text variant="caption" color="muted">Existing enquiry history is read-only while product enquiries are turned off.</Text> : null}
      <Text variant="captionStrong">{shopId ? 'Selected shop' : 'All businesses'}</Text>
      {loading && !hasReadCurrentScope ? <Skeleton height={80} radius={t.radii.lg} /> : visibleEnquiries.length ? visibleEnquiries.map((enquiry) => (
        <ListItem
          key={enquiry.id}
          icon="chatbubble-ellipses-outline"
          title={enquiry.product_name ?? 'General shop enquiry'}
          subtitle={`${enquiry.shop_name} · ${enquiry.customer_name ?? 'Customer'} · ${enquiry.status} · ${new Date(enquiry.last_message_at).toLocaleDateString()}`}
          right={enquiry.shop_unread ? <Text variant="captionStrong" color="primaryText">{enquiry.shop_unread} new</Text> : undefined}
          chevron
          onPress={() => router.push(`/enquiry/${enquiry.id}`)}
        />
      )) : hasReadCurrentScope ? (
        <EmptyState
          title={shopId ? 'No enquiries for this selected shop' : 'No enquiries yet'}
          message="Customer questions will appear here."
        />
      ) : null}
      <Button title="Manage my shop" variant="outline" onPress={manageShop} />
    </Screen>
  );
}
