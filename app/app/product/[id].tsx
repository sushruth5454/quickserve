import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Badge, Button, Card, Header, InlineAlert, Screen, Skeleton, Text, TextArea } from '../../src/components/ui';
import { getProduct, signedProductImage, startProductEnquiry, type ProductDetail } from '../../src/features/shops/api';
import { FeatureUnavailable, IndicativePrice, useShopFeatureFlags } from '../../src/features/shops/components';
import { useTheme } from '../../src/theme';

export default function ProductDetailScreen() {
  const t = useTheme();
  const features = useShopFeatureFlags();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!features.products || !id) return;
    setLoading(true);
    try {
      const next = await getProduct(id);
      setProduct(next);
      const signed = await Promise.all((next?.image_paths ?? []).map((path) => signedProductImage(path).catch(() => null)));
      setImages(signed.filter((url): url is string => !!url));
      setError(next ? null : 'This product is no longer available.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [features.products, id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const enquire = async () => {
    if (!product || !body.trim()) return;
    setBusy(true);
    try {
      const enquiryId = await startProductEnquiry(product.shop_id, product.id, body);
      router.push(`/enquiry/${enquiryId}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!features.products) {
    return <Screen header={<Header title="Product" />}><FeatureUnavailable /></Screen>;
  }

  return (
    <Screen header={<Header title={product?.name ?? 'Product'} subtitle={product ? `${product.shop_name} · ${product.area}, ${product.city}` : undefined} />} gap={t.spacing.md} refreshing={loading} onRefresh={() => void load()}>
      <InlineAlert message={error} />
      {loading && !product ? <Skeleton height={220} radius={t.radii.lg} /> : null}
      {product ? (
        <>
          {images.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
              {images.map((url) => <Image key={url} source={{ uri: url }} style={{ width: '48%', aspectRatio: 1, borderRadius: t.radii.md, backgroundColor: t.colors.surfaceAlt }} contentFit="cover" />)}
            </View>
          ) : null}
          <Card>
            <Text variant="title2">{product.name}</Text>
            <Text variant="footnote" color="muted">{[product.brand, product.model, product.category_name].filter(Boolean).join(' · ')}</Text>
            <IndicativePrice pricePaise={product.indicative_price_paise} />
            <Badge label={product.in_stock ? 'In stock' : 'Currently unavailable'} tone={product.in_stock ? 'success' : 'warning'} />
            {product.description ? <Text>{product.description}</Text> : null}
            {Object.entries(product.specs ?? {}).map(([key, value]) => (
              <Text key={key} variant="footnote" color="textSecondary">{`${key.replaceAll('_', ' ')}: ${String(value)}`}</Text>
            ))}
            <Button title={`Visit ${product.shop_name}`} variant="outline" onPress={() => router.push(`/shop/${product.shop_id}`)} />
          </Card>
          {features.enquiries ? (
            <Card>
              <Text variant="title3">Enquire with the shop</Text>
              <TextArea label="Message" value={body} onChangeText={setBody} placeholder="Ask about availability, specifications or delivery" maxLength={2000} />
              <Button title="Send enquiry" loading={busy} disabled={!body.trim()} onPress={() => void enquire()} />
            </Card>
          ) : <Text variant="footnote" color="muted">Product enquiries are not available right now.</Text>}
        </>
      ) : null}
    </Screen>
  );
}
