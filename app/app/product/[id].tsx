import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Badge, Button, Card, Header, InlineAlert, Screen, Skeleton, Text, TextArea } from '../../src/components/ui';
import { MediaImage } from '../../src/components/market/MediaImage';
import { PriceFooter } from '../../src/components/market/PriceFooter';
import { getProduct, signedProductImage, startProductEnquiry, type ProductDetail } from '../../src/features/shops/api';
import { FeatureUnavailable, useShopFeatureFlags } from '../../src/features/shops/components';
import { formatIndicativePrice } from '../../src/features/shops/format';
import { useTheme } from '../../src/theme';

export default function ProductDetailScreen() {
  const t = useTheme();
  const features = useShopFeatureFlags();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [images, setImages] = useState<(string | null)[]>([]);
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
      setImages(signed);
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

  const shopRoute = () => {
    if (product) router.push(`/shop/${product.shop_id}`);
  };
  const priceUpdatedAt = product?.price_updated_at
    ? new Date(product.price_updated_at).toLocaleDateString('en-IN')
    : null;

  return (
    <Screen
      header={<Header title={product?.name ?? 'Product'} subtitle={product ? `${product.shop_name} · ${product.area}, ${product.city}` : undefined} />}
      gap={t.spacing.md}
      refreshing={loading}
      onRefresh={() => void load()}
      footer={product ? (
        <PriceFooter
          caption="Indicative price"
          amountLabel={formatIndicativePrice(product.indicative_price_paise, product.unit)}
          amountVariant="text"
          note={{
            text: priceUpdatedAt
              ? `Indicative price — confirm with shop. Price updated ${priceUpdatedAt}`
              : 'Indicative price — confirm with shop.',
          }}
          above={features.enquiries ? (
            <Button title={`Visit ${product.shop_name}`} variant="outline" onPress={shopRoute} />
          ) : null}
          cta={features.enquiries ? {
            title: 'Send enquiry',
            loading: busy,
            disabled: !body.trim(),
            onPress: () => void enquire(),
          } : {
            title: `Visit ${product.shop_name}`,
            onPress: shopRoute,
          }}
        />
      ) : undefined}
    >
      <InlineAlert message={error} />
      {loading && !product ? <Skeleton height={220} radius={t.radii.lg} /> : null}
      {product ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
            {(images.length ? images : [null]).map((url, index) => (
              <View key={product.image_paths[index] ?? `${product.id}-${index}`} style={{ width: '48%', marginBottom: t.spacing.md }}>
                <MediaImage
                  uri={url}
                  aspectRatio={1}
                  fallbackIcon="image-outline"
                  accessibilityLabel={product.name}
                />
              </View>
            ))}
          </View>
          <Card>
            <Text variant="title2">{product.name}</Text>
            <Text variant="footnote" color="muted">{[product.brand, product.model, product.category_name].filter(Boolean).join(' · ')}</Text>
            <Badge label={product.in_stock ? 'In stock' : 'Currently unavailable'} tone={product.in_stock ? 'success' : 'warning'} />
            {product.description ? <Text>{product.description}</Text> : null}
          </Card>
          {Object.keys(product.specs ?? {}).length ? (
            <Card gap={t.spacing.md}>
              <Text variant="title3">Specifications</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
                {Object.entries(product.specs ?? {}).map(([key, value]) => (
                  <View key={key} style={{ width: '48%', gap: t.spacing.xs, marginBottom: t.spacing.md }}>
                    <Text variant="caption" color="muted">{key.replaceAll('_', ' ')}</Text>
                    <Text variant="footnote" color="textSecondary">{String(value)}</Text>
                  </View>
                ))}
              </View>
            </Card>
          ) : null}
          {features.enquiries ? (
            <Card>
              <Text variant="title3">Enquire with the shop</Text>
              <TextArea label="Message" value={body} onChangeText={setBody} placeholder="Ask about availability, specifications or delivery" maxLength={2000} />
            </Card>
          ) : <Text variant="footnote" color="muted">Product enquiries are not available right now.</Text>}
        </>
      ) : null}
    </Screen>
  );
}
