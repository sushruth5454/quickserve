import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Badge, Button, Card, EmptyState, ErrorState, Header, InlineAlert, Screen, Skeleton, Text, TextArea } from '../../components/ui';
import { getProduct, signedProductImage, startProductEnquiry, type ProductDetail } from '../shops/api';
import { FeatureUnavailable, IndicativePrice, useShopFeatureFlags } from '../shops/components';
import { useTheme } from '../../theme';

export default function ProductDetailScreen() {
  const t = useTheme();
  const features = useShopFeatureFlags();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [images, setImages] = useState<string[]>([]);
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
      const next = await getProduct(id);
      setProduct(next);
      const signed = await Promise.all((next?.image_paths ?? []).map((path) => signedProductImage(path).catch(() => null)));
      setImages(signed.filter((url): url is string => !!url));
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
    if (!product || !hasRead || loading || error || !body.trim()) return;
    setBusy(true);
    setActionError(null);
    try {
      const enquiryId = await startProductEnquiry(product.shop_id, product.id, body);
      router.push(`/enquiry/${enquiryId}`);
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!features.products) {
    return <Screen header={<Header title="Product" />}><FeatureUnavailable /></Screen>;
  }

  return (
    <Screen header={<Header title={product?.name ?? 'Product'} subtitle={product ? `${product.shop_name} · ${product.area}, ${product.city}` : undefined} />} gap={t.spacing.md} refreshing={loading} onRefresh={() => void load()}>
      {error && !hasRead ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {error && hasRead ? <InlineAlert message={`Refresh failed. Showing saved product details; enquiry is disabled until a successful refresh. ${error}`} actionLabel="Retry" onAction={() => void load()} /> : null}
      <InlineAlert message={actionError} />
      {loading && !product ? <Skeleton height={220} radius={t.radii.lg} /> : null}
      {hasRead && !loading && !error && !product ? <EmptyState title="Product unavailable" message="This product is no longer available." /> : null}
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
            <IndicativePrice pricePaise={product.indicative_price_paise} unit={product.unit} updatedAt={product.price_updated_at} />
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
              <Button title="Send enquiry" loading={busy} disabled={!body.trim() || !hasRead || loading || !!error} onPress={() => void enquire()} />
            </Card>
          ) : <Text variant="footnote" color="muted">Product enquiries are not available right now.</Text>}
        </>
      ) : null}
    </Screen>
  );
}
