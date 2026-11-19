import { View } from 'react-native';
import { Badge, Card, Text } from '../../components/ui';
import { ListingCard } from '../../components/market/ListingCard';
import { useT } from '../../i18n';
import { useAppFeatureFlags } from '../../lib/featureFlags';
import { useTheme } from '../../theme';
import type { ProductUnit, SearchProduct, ShopStatus } from './api';
import { formatIndicativePrice } from './format';

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

export function IndicativePrice({
  pricePaise,
  unit,
  updatedAt,
}: {
  pricePaise: number | null;
  unit: ProductUnit;
  updatedAt?: string | null;
}) {
  return (
    <View style={{ gap: 2 }}>
      <Text variant="calloutStrong">{formatIndicativePrice(pricePaise, unit)}</Text>
      {updatedAt ? <Text variant="caption" color="muted">Price updated {new Date(updatedAt).toLocaleDateString('en-IN')}</Text> : null}
      <Text variant="footnote" color="muted">Indicative price — confirm with shop.</Text>
    </View>
  );
}

export function ShopProductCard({
  product,
  imageUrl,
  onPress,
  layout = 'row',
}: {
  product: SearchProduct;
  imageUrl: string | null;
  onPress: () => void;
  layout?: 'row' | 'grid';
}) {
  const theme = useTheme();
  const translate = useT();
  const indicativePrice = formatIndicativePrice(product.indicative_price_paise, product.unit);
  const priceLabel = product.indicative_price_paise == null
    ? indicativePrice
    : translate('listing.from', { price: indicativePrice });
  const subtitle = [
    product.brand,
    product.model,
    product.shop_name,
    product.distance_km == null ? null : translate('listing.kmAway', { km: product.distance_km.toFixed(1) }),
  ].filter(Boolean).join(' · ');

  return (
    <View
      style={{
        width: layout === 'grid' ? '48%' : undefined,
        gap: theme.spacing.xs,
        marginBottom: layout === 'grid' ? theme.spacing.md : undefined,
      }}
    >
      <ListingCard
        variant="product"
        layout={layout}
        title={product.name}
        subtitle={subtitle}
        imageUrl={imageUrl}
        priceLabel={priceLabel}
        onPress={onPress}
      />
      {layout === 'grid' ? (
        <Text variant="footnote" color="muted" numberOfLines={1}>
          {[product.shop_name, product.distance_km == null ? null : translate('listing.kmAway', { km: product.distance_km.toFixed(1) })].filter(Boolean).join(' · ')}
        </Text>
      ) : null}
      {!product.in_stock ? <Badge label="Currently unavailable" tone="warning" /> : null}
    </View>
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
