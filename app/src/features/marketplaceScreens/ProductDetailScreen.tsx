import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Badge, Button, Card, EmptyState, ErrorState, Header, InlineAlert, Screen, Skeleton, Text, TextArea } from '../../components/ui';
import { getProduct, signedProductImage, startProductEnquiry, type ProductDetail } from '../shops/api';
import { FeatureUnavailable, IndicativePrice, useShopFeatureFlags } from '../shops/components';
import { useAuth } from '../../lib/auth';
import { requireSignIn } from '../../lib/authGate';
import { useTheme } from '../../theme';

export default function ProductDetailScreen() {
  const t = useTheme();
  const features = useShopFeatureFlags();
  const { userId, loading: authLoading } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [body, setBody] = useState('');
  const [bodyUserId, setBodyUserId] = useState<string | null>(userId);
  const [productReadUserId, setProductReadUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [hasRead, setHasRead] = useState(false);
  const userIdRef = useRef(userId);
  const draftUserIdRef = useRef(userId);
  userIdRef.current = userId;
  const productReadMatchesUser = hasRead && productReadUserId === userId;
  const currentBody = bodyUserId === userId ? body : '';

  useEffect(() => {
    if (draftUserIdRef.current === userId) return;
    draftUserIdRef.current = userId;
    setBody('');
    setBodyUserId(userId);
  }, [userId]);

  const load = useCallback(async () => {
    if (!features.products || !id) return;
    const requestedUserId = userId;
    setLoading(true);
    setError(null);
    try {
      const next = await getProduct(id);
      if (userIdRef.current !== requestedUserId) return;
      setProduct(next);
      setProductReadUserId(requestedUserId);
      const signed = await Promise.all((next?.image_paths ?? []).map((path) => signedProductImage(path).catch(() => null)));
      if (userIdRef.current !== requestedUserId) return;
      setImages(signed.filter((url): url is string => !!url));
      setError(null);
      setHasRead(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [features.products, id, userId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const enquire = async () => {
    if (!product || !productReadMatchesUser || !product.can_enquire || authLoading || !userId || !hasRead || loading || error || bodyUserId !== userId || !currentBody.trim()) return;
    setBusy(true);
    setActionError(null);
    try {
      const enquiryId = await startProductEnquiry(product.shop_id, product.id, currentBody);
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
              {productReadMatchesUser && product.can_enquire && !authLoading && userId ? (
                <>
                  <TextArea label="Message" value={currentBody} onChangeText={(value) => { setBodyUserId(userId); setBody(value); }} placeholder="Ask about availability, specifications or delivery" maxLength={2000} />
                  <Button title="Send enquiry" loading={busy} disabled={!currentBody.trim() || !hasRead || loading || !!error} onPress={() => void enquire()} />
                </>
              ) : !authLoading && !userId ? (
                <Button title="Sign in to ask shop" variant="outline" onPress={() => void requireSignIn(`/product/${product.id}`)} />
              ) : productReadMatchesUser && userId && product.enquiry_block_reason === 'own_shop' ? (
                <Button title="Manage shop" variant="outline" onPress={() => router.push('/merchant-shop')} />
              ) : productReadMatchesUser && product.enquiry_block_reason === 'sign_in' ? (
                <Button title="Sign in to ask shop" variant="outline" onPress={() => void requireSignIn(`/product/${product.id}`)} />
              ) : (
                <Text variant="footnote" color="muted">Product enquiries are not available right now.</Text>
              )}
            </Card>
          ) : <Text variant="footnote" color="muted">Product enquiries are not available right now.</Text>}
        </>
      ) : null}
    </Screen>
  );
}
