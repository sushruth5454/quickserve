export type CardPresentation = 'legacy' | 'oorva';

export interface ListingA11yLabelProps {
  title: string;
  subtitle?: string;
  rating?: number | null;
  ratingCount?: number;
  verified?: boolean;
  priceLabel?: string | null;
}

export function listingA11yLabel({
  title,
  subtitle,
  rating,
  ratingCount,
  verified,
  priceLabel,
}: ListingA11yLabelProps): string {
  const ratingLabel =
    rating == null
      ? null
      : `Rated ${rating.toFixed(1)} out of 5${ratingCount != null ? ` from ${ratingCount} reviews` : ''}`;
  return [title, subtitle, ratingLabel, verified ? 'verified' : null, priceLabel]
    .filter((part): part is string => Boolean(part))
    .join(', ');
}

export function visibleTags(tags: string[], presentation: CardPresentation = 'legacy'): string[] {
  return presentation === 'oorva' ? tags : tags.slice(0, 2);
}
