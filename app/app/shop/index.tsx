import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Badge, Button, Card, EmptyState, Header, InlineAlert, ListItem, Screen, Skeleton, Text } from '../../src/components/ui';
import { ChipRow } from '../../src/components/market/ChipRow';
import { ListingCard } from '../../src/components/market/ListingCard';
import { SearchField } from '../../src/components/market/SearchField';
import { listMyProductEnquiries, listProductCategories, searchShops, type EnquirySummary, type ProductCategory, type ShopResult } from '../../src/features/shops/api';
import { FeatureUnavailable, useShopFeatureFlags } from '../../src/features/shops/components';
import { useRfqFeatureFlags } from '../../src/features/rfq/components';
import { useT } from '../../src/i18n';
import { useSelectedLocation } from '../../src/lib/locationContext';
import { useTheme } from '../../src/theme';

export default function ShopMarketplaceScreen() {
  const theme = useTheme();
  const translate = useT();
  const features = useShopFeatureFlags();
  const { rfq: rfqEnabled } = useRfqFeatureFlags();
  const { location } = useSelectedLocation();
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [shops, setShops] = useState<ShopResult[]>([]);
  const [enquiries, setEnquiries] = useState<EnquirySummary[]>([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
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

  const openProducts = (searchQuery: string) => {
    router.push({ pathname: '/products', params: { q: searchQuery.trim() } });
  };

  const selectCategory = (slug: string) => {
    setCategory(slug);
    router.push(slug ? { pathname: '/products', params: { category: slug } } : '/products');
  };

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (!features.products) {
    return <Screen header={<Header title="Shop local" />}><FeatureUnavailable /></Screen>;
  }

  return (
    <Screen
      header={<Header title="Shop local" subtitle="Products from verified neighbourhood shops" />}
      gap={theme.spacing.lg}
      refreshing={loading}
      onRefresh={() => void load()}
    >
      <InlineAlert message={error} />
      <SearchField
        mode="input"
        value={query}
        onChangeText={setQuery}
        onSubmit={openProducts}
        placeholder={translate('search.placeholder')}
      />
      <Button title="Search products" onPress={() => openProducts(query)} />

      <View style={{ gap: theme.spacing.sm }}>
        <Text variant="title3">Browse categories</Text>
        <ChipRow
          options={[
            { value: '', label: translate('search.scope.all') },
            ...categories.map((item) => ({ value: item.slug, label: item.name })),
          ]}
          value={category}
          onChange={selectCategory}
          accessibilityLabel={translate('search.title')}
        />
      </View>

      {rfqEnabled ? (
        <Card
          variant="tinted"
          tint={theme.colors.catShopsSoft}
          onPress={() => router.push('/rfq/new')}
          accessibilityLabel={translate('rfq.banner')}
        >
          <Text variant="bodyStrong">{translate('rfq.banner')}</Text>
        </Card>
      ) : null}

      {features.enquiries ? (
        <View style={{ gap: theme.spacing.sm }}>
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

      <View style={{ gap: theme.spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text variant="title3">Nearby shops</Text>
          <Text variant="caption" color="muted">{location.city}</Text>
        </View>
        {loading ? <Skeleton height={92} radius={theme.radii.lg} /> : shops.length ? shops.map((shop) => (
          <ListingCard
            key={shop.id}
            variant="shop"
            title={shop.name}
            subtitle={[
              shop.area,
              shop.city,
              shop.distance_km == null ? null : translate('listing.kmAway', { km: shop.distance_km.toFixed(1) }),
            ].filter(Boolean).join(' · ')}
            tags={[
              ...shop.category_slugs.slice(0, 2),
              ...(shop.offers_delivery ? ['Delivery'] : []),
              ...(shop.offers_pickup ? ['Pickup'] : []),
            ]}
            onPress={() => router.push(`/shop/${shop.id}`)}
          />
        )) : (
          <EmptyState title="No verified shops nearby yet" message="Try searching for a product across other nearby areas." />
        )}
      </View>
    </Screen>
  );
}
