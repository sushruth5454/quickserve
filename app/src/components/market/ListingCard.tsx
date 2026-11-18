import type { JSX } from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme';
import { Avatar, Badge, Card, RatingStars, Text } from '../ui';
import type { IconName } from '../ui/Button';
import { MediaImage } from './MediaImage';
import { listingA11yLabel, visibleTags } from './listingModel';
import { VerifiedBadge } from './VerifiedBadge';

export type ListingVariant = 'provider' | 'venue' | 'shop' | 'product' | 'creator';

export interface ListingCardProps {
  variant: ListingVariant;
  title: string;
  subtitle?: string;
  imageUrl?: string | null;
  avatarName?: string;
  rating?: number | null;
  ratingCount?: number;
  verified?: boolean;
  priceLabel?: string | null;
  tags?: string[];
  layout?: 'row' | 'grid';
  onPress: () => void;
  testID?: string;
}

const FALLBACK_ICONS: Record<ListingVariant, IconName> = {
  provider: 'person-outline',
  venue: 'location-outline',
  shop: 'storefront-outline',
  product: 'image-outline',
  creator: 'color-palette-outline',
};

export function ListingCard({
  variant,
  title,
  subtitle,
  imageUrl,
  avatarName,
  rating,
  ratingCount,
  verified,
  priceLabel,
  tags = [],
  layout = 'row',
  onPress,
  testID,
}: ListingCardProps): JSX.Element {
  const t = useTheme();
  const shownTags = visibleTags(tags);
  const accessibilityLabel = listingA11yLabel({
    title,
    subtitle,
    rating,
    ratingCount,
    verified,
    priceLabel,
  });
  const isAvatar = variant === 'provider' || variant === 'creator';

  return (
    <View testID={testID}>
      <Card onPress={onPress} accessibilityLabel={accessibilityLabel}>
        {layout === 'grid' ? (
          <View style={{ gap: t.spacing.md }}>
            <MediaImage
              uri={imageUrl}
              aspectRatio={1}
              fallbackIcon={FALLBACK_ICONS[variant]}
              accessibilityLabel={title}
            />
            <Text variant="bodyStrong" numberOfLines={2}>
              {title}
            </Text>
            {priceLabel ? (
              <Text variant="calloutStrong" numberOfLines={1}>
                {priceLabel}
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: t.spacing.md }}>
            {isAvatar ? (
              <Avatar name={avatarName ?? title} uri={imageUrl} size={48} />
            ) : (
              <View style={{ width: t.minTouch * 2 }}>
                <MediaImage
                  uri={imageUrl}
                  aspectRatio={16 / 9}
                  fallbackIcon={FALLBACK_ICONS[variant]}
                  accessibilityLabel={title}
                />
              </View>
            )}
            <View style={{ flex: 1, minWidth: 0, gap: t.spacing.sm }}>
              <Text variant="bodyStrong" numberOfLines={1}>
                {title}
              </Text>
              {subtitle ? (
                <Text variant="footnote" color="muted" numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: t.spacing.sm }}>
                  {rating != null ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.xs }}>
                      <RatingStars value={rating} count={ratingCount} />
                      <Text variant="footnote" color="muted">
                        {rating.toFixed(1)}
                      </Text>
                    </View>
                  ) : null}
                  {shownTags.map((tag, index) => (
                    <Badge key={`${tag}-${index}`} tone="neutral" label={tag} />
                  ))}
                  {verified ? <VerifiedBadge /> : null}
                </View>
                {priceLabel ? (
                  <Text variant="calloutStrong" align="right" numberOfLines={1}>
                    {priceLabel}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>
        )}
      </Card>
    </View>
  );
}
