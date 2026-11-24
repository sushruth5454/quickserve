import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Badge, Button, Card, Chip, EmptyState, ErrorState, Header, InlineAlert, Input, ListItem, Screen, Skeleton, Text } from '../../components/ui';
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
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [shopsError, setShopsError] = useState<string | null>(null);
  const [enquiriesError, setEnquiriesError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [categoriesRead, setCategoriesRead] = useState(false);
  const [shopsRead, setShopsRead] = useState(false);
  const [enquiriesRead, setEnquiriesRead] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [categoryResult, shopResult, enquiryResult] = await Promise.allSettled([
      features.products ? listProductCategories() : Promise.resolve([]),
      features.products ? searchShops(location.lat, location.lng) : Promise.resolve([]),
      listMyProductEnquiries(),
    ]);
    if (categoryResult.status === 'fulfilled') {
      setCategories(categoryResult.value);
      setCategoriesRead(true);
      setCategoriesError(null);
    } else {
      setCategoriesError((categoryResult.reason as Error).message);
    }
    if (shopResult.status === 'fulfilled') {
      setShops(shopResult.value);
      setShopsRead(true);
      setShopsError(null);
    } else {
      setShopsError((shopResult.reason as Error).message);
    }
    if (enquiryResult.status === 'fulfilled') {
      setEnquiries(enquiryResult.value);
      setEnquiriesRead(true);
      setEnquiriesError(null);
    } else {
      setEnquiriesError((enquiryResult.reason as Error).message);
    }
    setLoading(false);
  }, [features.products, location.lat, location.lng]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <Screen
      header={<Header title="Shop local" subtitle="Products from verified neighbourhood shops" />}
      gap={t.spacing.lg}
      refreshing={loading}
      onRefresh={() => void load()}
    >
      {!features.products ? <FeatureUnavailable /> : (
        <>
          <Card gap={t.spacing.md}>
            <Text variant="title3">Find a product</Text>
            <Input label="Search products" placeholder="Tiles, paint, switches…" value={query} onChangeText={setQuery} returnKeyType="search" onSubmitEditing={() => router.push({ pathname: '/products', params: { q: query.trim() } })} />
            <Button title="Search products" onPress={() => router.push({ pathname: '/products', params: { q: query.trim() } })} />
          </Card>

          <View style={{ gap: t.spacing.sm }}>
            <Text variant="title3">Browse categories</Text>
            {categoriesError && !categoriesRead ? <ErrorState message={categoriesError} onRetry={() => void load()} /> : null}
            {categoriesError && categoriesRead ? <InlineAlert message={`Category refresh failed. Showing saved categories. ${categoriesError}`} actionLabel="Retry" onAction={() => void load()} /> : null}
            {categoriesRead && !categories.length && !categoriesError ? <Text variant="footnote" color="muted">No product categories are available.</Text> : null}
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
        </>
      )}

      <View style={{ gap: t.spacing.sm }}>
          <Text variant="title3">Your product enquiries</Text>
          {enquiriesError && !enquiriesRead ? <ErrorState message={enquiriesError} onRetry={() => void load()} /> : null}
          {enquiriesError && enquiriesRead ? <InlineAlert message={`Enquiry history refresh failed. Showing saved history. ${enquiriesError}`} actionLabel="Retry" onAction={() => void load()} /> : null}
          {enquiriesRead && enquiries.length ? enquiries.slice(0, 5).map((enquiry) => (
            <ListItem
              key={enquiry.id}
              icon="chatbubble-ellipses-outline"
              title={enquiry.product_name ?? 'Shop enquiry'}
              subtitle={`${enquiry.shop_name} · ${enquiry.status}`}
              right={enquiry.customer_unread ? <Badge label={String(enquiry.customer_unread)} tone="primary" /> : undefined}
              onPress={() => router.push(`/enquiry/${enquiry.id}`)}
            />
          )) : enquiriesRead && !enquiries.length ? <Text variant="footnote" color="muted">Your shop conversations will appear here.</Text> : null}
          {!features.enquiries ? <Text variant="caption" color="muted">Existing product enquiry history is read-only while enquiries are turned off.</Text> : null}
      </View>

      {features.products ? <View style={{ gap: t.spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text variant="title3">Nearby shops</Text>
          <Text variant="caption" color="muted">{location.city}</Text>
        </View>
        {loading && !shopsRead ? <Skeleton height={92} radius={t.radii.lg} /> : null}
        {shopsError && !shopsRead ? <ErrorState message={shopsError} onRetry={() => void load()} /> : null}
        {shopsError && shopsRead ? <InlineAlert message={`Shop refresh failed. Showing saved shops. ${shopsError}`} actionLabel="Retry" onAction={() => void load()} /> : null}
        {shopsRead && shops.length ? shops.map((shop) => (
          <Card key={shop.id} gap={4} onPress={() => router.push(`/shop/${shop.id}`)}>
            <Text variant="calloutStrong">{shop.name}</Text>
            <Text variant="footnote" color="muted">{[shop.area, shop.city, shop.distance_km == null ? null : `${shop.distance_km.toFixed(1)} km`].filter(Boolean).join(' · ')}</Text>
            <Text variant="caption" color="muted">
              {shop.category_slugs.slice(0, 3).join(' · ')}{shop.offers_delivery ? ' · Delivery' : ''}{shop.offers_pickup ? ' · Pickup' : ''}
            </Text>
          </Card>
        )) : shopsRead && !shopsError ? (
          <EmptyState title="No verified shops nearby yet" message="Try searching for a product across other nearby areas." />
        ) : null}
      </View> : null}
    </Screen>
  );
}
