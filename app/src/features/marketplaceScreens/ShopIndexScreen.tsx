import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Badge, Button, Card, Chip, EmptyState, Header, InlineAlert, Input, ListItem, Screen, Skeleton, Text } from '../../components/ui';
import { listMyProductEnquiries, listProductCategories, searchShops, type EnquirySummary, type ProductCategory, type ShopResult } from '../shops/api';
import { FeatureUnavailable, useShopFeatureFlags } from '../shops/components';
import { useSelectedLocation } from '../../lib/locationContext';
import { useTheme } from '../../theme';

export default function ShopMarketplaceScreen() {
  const t = useTheme();
  const features = useShopFeatureFlags();
  const { location } = useSelectedLocation();
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [shops, setShops] = useState<ShopResult[]>([]);
  const [enquiries, setEnquiries] = useState<EnquirySummary[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!features.products) return;
    setLoading(true);
    try {
      const [nextCategories, nextShops, nextEnquiries] = await Promise.all([
        listProductCategories(),
        searchShops(location.lat, location.lng),
        features.enquiries ? listMyProductEnquiries() : Promise.resolve([]),
      ]);
      setCategories(nextCategories);
      setShops(nextShops);
      setEnquiries(nextEnquiries);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [features.products, features.enquiries, location.lat, location.lng]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (!features.products) {
    return <Screen header={<Header title="Shop local" />}><FeatureUnavailable /></Screen>;
  }

  return (
    <Screen
      header={<Header title="Shop local" subtitle="Products from verified neighbourhood shops" />}
      gap={t.spacing.lg}
      refreshing={loading}
      onRefresh={() => void load()}
    >
      <InlineAlert message={error} />
      <Card gap={t.spacing.md}>
        <Text variant="title3">Find a product</Text>
        <Input label="Search products" placeholder="Tiles, paint, switches…" value={query} onChangeText={setQuery} returnKeyType="search" onSubmitEditing={() => router.push({ pathname: '/products', params: { q: query.trim() } })} />
        <Button title="Search products" onPress={() => router.push({ pathname: '/products', params: { q: query.trim() } })} />
      </Card>

      <View style={{ gap: t.spacing.sm }}>
        <Text variant="title3">Browse categories</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
          {categories.map((category) => (
            <Chip
              key={category.id}
              label={category.name}
              onPress={() => router.push({ pathname: '/products', params: { category: category.slug } })}
            />
          ))}
        </View>
      </View>

      {features.enquiries ? (
        <View style={{ gap: t.spacing.sm }}>
          <Text variant="title3">Your product enquiries</Text>
          {enquiries.length ? enquiries.slice(0, 5).map((enquiry) => (
            <ListItem
              key={enquiry.id}
              icon="chatbubble-ellipses-outline"
              title={enquiry.product_name ?? 'Shop enquiry'}
              subtitle={`${enquiry.shop_name} · ${enquiry.status}`}
              right={enquiry.customer_unread ? <Badge label={String(enquiry.customer_unread)} tone="primary" /> : undefined}
              onPress={() => router.push(`/enquiry/${enquiry.id}`)}
            />
          )) : <Text variant="footnote" color="muted">Your shop conversations will appear here.</Text>}
        </View>
      ) : null}

      <View style={{ gap: t.spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text variant="title3">Nearby shops</Text>
          <Text variant="caption" color="muted">{location.city}</Text>
        </View>
        {loading ? <Skeleton height={92} radius={t.radii.lg} /> : shops.length ? shops.map((shop) => (
          <Card key={shop.id} gap={4} onPress={() => router.push(`/shop/${shop.id}`)}>
            <Text variant="calloutStrong">{shop.name}</Text>
            <Text variant="footnote" color="muted">{[shop.area, shop.city, shop.distance_km == null ? null : `${shop.distance_km.toFixed(1)} km`].filter(Boolean).join(' · ')}</Text>
            <Text variant="caption" color="muted">
              {shop.category_slugs.slice(0, 3).join(' · ')}{shop.offers_delivery ? ' · Delivery' : ''}{shop.offers_pickup ? ' · Pickup' : ''}
            </Text>
          </Card>
        )) : (
          <EmptyState title="No verified shops nearby yet" message="Try searching for a product across other nearby areas." />
        )}
      </View>
    </Screen>
  );
}
