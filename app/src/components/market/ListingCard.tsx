import type { JSX } from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme';
import { Avatar, Badge, Card, RatingStars, Text } from '../ui';
import type { IconName } from '../ui/Button';
import { MediaImage } from './MediaImage';
import { listingA11yLabel, visibleTags, type CardPresentation } from './listingModel';
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
  presentation?: CardPresentation;
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
  presentation = 'legacy',
  onPress,
  testID,
}: ListingCardProps): JSX.Element {
  const t = useTheme();
  const isOorva = presentation === 'oorva';
  const shownTags = visibleTags(tags, presentation);
  const hasMetadata = rating != null || shownTags.length > 0 || verified === true;
  const accessibilityLabel = listingA11yLabel({
    title,
    subtitle,
    rating,
    ratingCount,
    verified,
    priceLabel,
  });
  const isAvatar = variant === 'provider' || variant === 'creator';
  const metadata = hasMetadata ? (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: isOorva ? 'wrap' : undefined,
        alignItems: 'center',
        gap: t.spacing.sm,
      }}
    >
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
  ) : null;

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
            <Text variant="bodyStrong" numberOfLines={isOorva ? undefined : 2}>
              {title}
            </Text>
            {isOorva ? metadata : null}
            {priceLabel ? (
              <Text variant="calloutStrong" numberOfLines={isOorva ? undefined : 1}>
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
              <Text variant="bodyStrong" numberOfLines={isOorva ? undefined : 1}>
                {title}
              </Text>
              {subtitle ? (
                <Text variant="footnote" color="muted" numberOfLines={isOorva ? undefined : 1}>
                  {subtitle}
                </Text>
              ) : null}
              {isOorva ? metadata : (
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
              )}
              {isOorva && priceLabel ? <Text variant="calloutStrong">{priceLabel}</Text> : null}
            </View>
          </View>
        )}
      </Card>
    </View>
  );
}
