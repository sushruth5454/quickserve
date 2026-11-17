import { Image } from 'expo-image';
import { Pressable, View } from 'react-native';
import { Badge, Card, Text } from '../../components/ui';
import { formatINR } from '../../lib/money';
import { useAppFeatureFlags } from '../../lib/featureFlags';
import { useTheme } from '../../theme';
import type { SearchProduct, ShopStatus } from './api';

export function useShopFeatureFlags() {
  const flags = useAppFeatureFlags();
  return {
    products: flags.isOn('products'),
    enquiries: flags.isOn('products') && flags.isOn('product_enquiries'),
  };
}

export function FeatureUnavailable({ feature = 'Products and shops are not available right now.' }: { feature?: string }) {
  return <Card><Text color="muted">{feature}</Text></Card>;
}

export function IndicativePrice({ pricePaise }: { pricePaise: number | null }) {
  return (
    <View style={{ gap: 2 }}>
      <Text variant="calloutStrong">{pricePaise == null ? 'Ask shop for price' : formatINR(pricePaise)}</Text>
      <Text variant="footnote" color="muted">Indicative price — confirm with shop.</Text>
    </View>
  );
}

export function ShopProductCard({
  product,
  imageUrl,
  onPress,
}: {
  product: SearchProduct;
  imageUrl: string | null;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Card style={{ flexDirection: 'row', gap: t.spacing.md, alignItems: 'center' }}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={{ width: 76, height: 76, borderRadius: t.radii.md, backgroundColor: t.colors.surfaceAlt }} contentFit="cover" />
        ) : (
          <View style={{ width: 76, height: 76, borderRadius: t.radii.md, backgroundColor: t.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
            <Text variant="caption" color="muted">No photo</Text>
          </View>
        )}
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="calloutStrong" numberOfLines={2}>{product.name}</Text>
          <Text variant="footnote" color="muted" numberOfLines={1}>
            {[product.brand, product.model, product.shop_name].filter(Boolean).join(' · ')}
          </Text>
          <IndicativePrice pricePaise={product.indicative_price_paise} />
          {product.distance_km != null ? <Text variant="caption" color="muted">{product.distance_km.toFixed(1)} km away</Text> : null}
          {!product.in_stock ? <Badge label="Currently unavailable" tone="warning" /> : null}
        </View>
      </Card>
    </Pressable>
  );
}

const STATUS_LABELS: Record<ShopStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under review',
  verified: 'Verified',
  rejected: 'Changes requested',
  suspended: 'Suspended',
};

export function ShopStatusLabel({ status }: { status: ShopStatus }) {
  const tone = status === 'verified' ? 'success' : status === 'rejected' || status === 'suspended' ? 'danger' : status === 'submitted' || status === 'under_review' ? 'warning' : 'neutral';
  return <Badge label={STATUS_LABELS[status]} tone={tone} />;
}
