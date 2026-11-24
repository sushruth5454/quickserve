import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, EmptyState, ErrorState, Header, InlineAlert, Screen, Skeleton, Text, TextArea } from '../../components/ui';
import { getShop, listShopProducts, signedProductImage, startProductEnquiry, type ShopDetail, type ShopProduct } from '../shops/api';
import { FeatureUnavailable, ShopProductCard, useShopFeatureFlags } from '../shops/components';
import { useTheme } from '../../theme';

export default function ShopDetailScreen() {
  const t = useTheme();
  const features = useShopFeatureFlags();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [shop, setShop] = useState<ShopDetail | null>(null);
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [images, setImages] = useState<Record<string, string | null>>({});
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [hasRead, setHasRead] = useState(false);

  const load = useCallback(async () => {
    if (!features.products || !id) return;
    setLoading(true);
    setError(null);
    try {
      const [nextShop, nextProducts] = await Promise.all([getShop(id), listShopProducts(id)]);
      setShop(nextShop);
      setProducts(nextProducts);
      const nextImages = await Promise.all(nextProducts.map(async (product) => [
        product.id,
        await signedProductImage(product.image_paths[0]).catch(() => null),
      ] as const));
      setImages(Object.fromEntries(nextImages));
      setError(null);
      setHasRead(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [features.products, id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const enquire = async () => {
    if (!shop || !hasRead || loading || error || !body.trim()) return;
    setBusy(true);
    setActionError(null);
    try {
      const enquiryId = await startProductEnquiry(shop.id, null, body);
      router.push(`/enquiry/${enquiryId}`);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!features.products) {
    return <Screen header={<Header title="Shop" />}><FeatureUnavailable /></Screen>;
  }

  return (
    <Screen header={<Header title={shop?.name ?? 'Shop'} subtitle={shop ? [shop.area, shop.city].filter(Boolean).join(' · ') : undefined} />} gap={t.spacing.md} refreshing={loading} onRefresh={() => void load()}>
      {error && !hasRead ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {error && hasRead ? <InlineAlert message={`Refresh failed. Showing saved shop details; enquiry is disabled until a successful refresh. ${error}`} actionLabel="Retry" onAction={() => void load()} /> : null}
      <InlineAlert message={actionError} />
      {loading && !shop ? <Skeleton height={180} radius={t.radii.lg} /> : null}
      {hasRead && !loading && !error && !shop ? <EmptyState title="Shop unavailable" message="This shop is no longer available." /> : null}
      {shop ? (
        <>
          <Card>
            <Text variant="title3">{shop.name}</Text>
            {shop.description ? <Text>{shop.description}</Text> : null}
            <Text variant="footnote" color="muted">{shop.address_line}</Text>
            <Text variant="footnote" color="muted">
              {shop.offers_pickup ? 'Pickup available' : 'Pickup not listed'}
              {shop.offers_delivery ? ` · Delivery within ${shop.delivery_radius_km} km` : ''}
            </Text>
            <Text variant="caption" color="muted">Categories: {shop.category_slugs.join(' · ')}</Text>
          </Card>
          {features.enquiries ? (
            <Card gap={t.spacing.sm}>
              <Text variant="title3">Ask this shop</Text>
              <TextArea label="Message" value={body} onChangeText={setBody} placeholder="What are you looking for?" maxLength={2000} />
              <Button title="Start enquiry" loading={busy} disabled={!body.trim() || !hasRead || loading || !!error} onPress={() => void enquire()} />
            </Card>
          ) : null}
          <View style={{ gap: t.spacing.sm }}>
            <Text variant="title3">Catalogue</Text>
            {products.map((product) => (
              <ShopProductCard
                key={product.id}
                product={{ ...product, shop_name: shop.name, city: shop.city, area: shop.area, distance_km: null }}
                imageUrl={images[product.id] ?? null}
                onPress={() => router.push(`/product/${product.id}`)}
              />
            ))}
            {!products.length && hasRead && !loading && !error ? <Text variant="footnote" color="muted">This shop has no active products listed yet.</Text> : null}
          </View>
        </>
      ) : null}
    </Screen>
  );
}
