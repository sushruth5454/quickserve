import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { Button, Chip, EmptyState, Header, InlineAlert, Input, Screen, Skeleton, Text } from '../src/components/ui';
import { listProductCategories, searchProducts, signedProductImage, type ProductCategory, type SearchProduct } from '../src/features/shops/api';
import { FeatureUnavailable, ShopProductCard, useShopFeatureFlags } from '../src/features/shops/components';
import { useRfqFeatureFlags } from '../src/features/rfq/components';
import { parseRupees } from '../src/lib/onboarding/validation';
import { useSelectedLocation } from '../src/lib/locationContext';
import { useTheme } from '../src/theme';

export default function ProductSearchScreen() {
  const t = useTheme();
  const features = useShopFeatureFlags();
  const { rfq: rfqEnabled } = useRfqFeatureFlags();
  const { location } = useSelectedLocation();
  const params = useLocalSearchParams<{ q?: string; category?: string }>();
  const initialQuery = useMemo(() => typeof params.q === 'string' ? params.q : '', [params.q]);
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState(typeof params.category === 'string' ? params.category : '');
  const [maxPrice, setMaxPrice] = useState('');
  const [inStockOnly, setInStockOnly] = useState(false);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [products, setProducts] = useState<SearchProduct[]>([]);
  const [images, setImages] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!features.products) return;
    const price = maxPrice.trim() ? parseRupees(maxPrice) : null;
    if (maxPrice.trim() && (price == null || price < 0)) {
      setError('Enter a valid maximum price in rupees.');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [nextCategories, nextProducts] = await Promise.all([
        listProductCategories(),
        searchProducts({
          query,
          categorySlug: category || null,
          lat: location.lat,
          lng: location.lng,
          radiusKm: 15,
          maxPricePaise: price,
          inStockOnly,
        }),
      ]);
      const nextImages = await Promise.all(nextProducts.map(async (product) => [
        product.id,
        await signedProductImage(product.image_paths[0]).catch(() => null),
      ] as const));
      setCategories(nextCategories);
      setProducts(nextProducts);
      setImages(Object.fromEntries(nextImages));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [features.products, query, category, location.lat, location.lng, maxPrice, inStockOnly]);

  const loadRef = useRef(load);
  loadRef.current = load;
  useFocusEffect(useCallback(() => { void loadRef.current(); }, [features.products]));

  if (!features.products) {
    return <Screen header={<Header title="Products" />}><FeatureUnavailable /></Screen>;
  }

  return (
    <Screen
      header={<Header title="Products" subtitle={`Verified shops near ${location.city}`} />}
      gap={t.spacing.md}
      refreshing={loading}
      onRefresh={() => void load()}
    >
      <InlineAlert message={error} />
      <Input label="Search products" value={query} onChangeText={setQuery} placeholder="Name, brand or model" returnKeyType="search" onSubmitEditing={() => void load()} />
      <View style={{ flexDirection: 'row', gap: t.spacing.sm, alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}>
          <Input label="Maximum price (₹)" value={maxPrice} onChangeText={setMaxPrice} keyboardType="decimal-pad" placeholder="Any price" />
        </View>
        <Chip label="In stock only" selected={inStockOnly} onPress={() => setInStockOnly((value) => !value)} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
        <Chip label="All categories" selected={!category} onPress={() => setCategory('')} />
        {categories.map((item) => (
          <Chip key={item.id} label={item.name} selected={category === item.slug} onPress={() => setCategory(category === item.slug ? '' : item.slug)} />
        ))}
      </View>
      <Button title="Apply search and filters" variant="outline" onPress={() => void load()} />
      {rfqEnabled ? (
        <Button title="Request quotes from multiple shops" variant="outline" onPress={() => router.push('/rfq/new')} />
      ) : null}
      {loading ? <Skeleton height={100} radius={t.radii.lg} /> : products.length ? products.map((product) => (
        <ShopProductCard key={product.id} product={product} imageUrl={images[product.id] ?? null} onPress={() => router.push(`/product/${product.id}`)} />
      )) : (
        <EmptyState title="No products found" message="Try a different product name, category, price or location." />
      )}
      {!loading && products.length ? <Text variant="caption" color="muted">Showing verified shops, ordered by distance.</Text> : null}
    </Screen>
  );
}
