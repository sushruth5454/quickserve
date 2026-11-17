import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Header, InlineAlert, Screen, Skeleton, Text, TextArea } from '../../src/components/ui';
import { getShop, listShopProducts, signedProductImage, startProductEnquiry, type ShopDetail, type ShopProduct } from '../../src/features/shops/api';
import { FeatureUnavailable, ShopProductCard, useShopFeatureFlags } from '../../src/features/shops/components';
import { useTheme } from '../../src/theme';

export default function ShopDetailScreen() {
  const t = useTheme();
  const features = useShopFeatureFlags();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [shop, setShop] = useState<ShopDetail | null>(null);
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [images, setImages] = useState<Record<string, string | null>>({});
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!features.products || !id) return;
    setLoading(true);
    try {
      const [nextShop, nextProducts] = await Promise.all([getShop(id), listShopProducts(id)]);
      setShop(nextShop);
      setProducts(nextProducts);
      const nextImages = await Promise.all(nextProducts.map(async (product) => [
        product.id,
        await signedProductImage(product.image_paths[0]).catch(() => null),
      ] as const));
      setImages(Object.fromEntries(nextImages));
      setError(nextShop ? null : 'This shop is not available.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [features.products, id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const enquire = async () => {
    if (!shop || !body.trim()) return;
    setBusy(true);
    try {
      const enquiryId = await startProductEnquiry(shop.id, null, body);
      router.push(`/enquiry/${enquiryId}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!features.products) {
    return <Screen header={<Header title="Shop" />}><FeatureUnavailable /></Screen>;
  }

  return (
    <Screen header={<Header title={shop?.name ?? 'Shop'} subtitle={shop ? [shop.area, shop.city].filter(Boolean).join(' · ') : undefined} />} gap={t.spacing.md} refreshing={loading} onRefresh={() => void load()}>
      <InlineAlert message={error} />
      {loading && !shop ? <Skeleton height={180} radius={t.radii.lg} /> : null}
      {shop ? (
        <>
          <Card>
            <Text variant="title3">{shop.name}</Text>
            {shop.description ? <Text>{shop.description}</Text> : null}
            <Text variant="footnote" color="muted">{shop.address_line}</Text>
            <Text variant="footnote" color="muted">
              {shop.offers_pickup ? 'Pickup available' : 'Pickup not listed'}
              {shop.offers_delivery ? ` · Delivery within ${shop.delivery_radius_km} km` : ''}
              {shop.whatsapp_contact ? ' · WhatsApp contact available' : ''}
            </Text>
            <Text variant="caption" color="muted">Categories: {shop.category_slugs.join(' · ')}</Text>
          </Card>
          {features.enquiries ? (
            <Card gap={t.spacing.sm}>
              <Text variant="title3">Ask this shop</Text>
              <TextArea label="Message" value={body} onChangeText={setBody} placeholder="What are you looking for?" maxLength={2000} />
              <Button title="Start enquiry" loading={busy} disabled={!body.trim()} onPress={() => void enquire()} />
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
            {!products.length && !loading ? <Text variant="footnote" color="muted">This shop has no active products listed yet.</Text> : null}
          </View>
        </>
      ) : null}
    </Screen>
  );
}
