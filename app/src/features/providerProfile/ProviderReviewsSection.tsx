import { Ionicons } from '@expo/vector-icons';
import { Fragment } from 'react';
import { View } from 'react-native';
import { Button, Card, Chip, Divider, RatingStars, Section, Text } from '../../components/ui';
import type { PublicReview } from '../../lib/apiTypes';
import type { ProviderDetail } from '../../lib/api';
import type { PublicProfile } from '../../lib/onboarding';
import { type useTheme } from '../../theme';
import { Bar } from './ProfileParts';

export function ProviderReviewsSection({
  pub,
  provider,
  first,
  rating,
  reviews,
  visibleReviews,
  breakdown,
  subs,
  showAll,
  onToggleShowAll,
  theme: t,
  gutter,
}: {
  pub: PublicProfile | null;
  provider: ProviderDetail['provider'];
  first: string;
  rating: number;
  reviews: PublicReview[];
  visibleReviews: PublicReview[];
  breakdown: { counts: number[]; total: number };
  subs: readonly (readonly [string, number | null])[];
  showAll: boolean;
  onToggleShowAll: () => void;
  theme: ReturnType<typeof useTheme>;
  gutter: { paddingHorizontal: number };
}) {
  return (
    <View style={gutter}>
      <Section title="Ratings & reviews">
        {pub && pub.review_themes.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.xs, marginBottom: t.spacing.md }}>
            {pub.review_themes.map((theme) => (
              <Chip key={theme.tag} label={`${theme.tag.replaceAll('_', ' ')} · ${theme.count}`} selected={false} check={false} />
            ))}
          </View>
        ) : null}
        <Card gap={t.spacing.lg}>
          <View style={{ flexDirection: 'row', gap: t.spacing.xl, alignItems: 'center' }}>
            <View style={{ alignItems: 'center', gap: 4, minWidth: 92 }}>
              <Text variant="display" tabular>
                {rating.toFixed(1)}
              </Text>
              <RatingStars value={rating} size={14} count={provider.rating_count} />
              <Text variant="caption" color="muted">
                {provider.rating_count} ratings
              </Text>
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              {breakdown.counts.map((c, i) => {
                const star = 5 - i;
                const pct = breakdown.total ? c / breakdown.total : 0;
                return (
                  <View
                    key={star}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
                    accessible
                    accessibilityLabel={`${star} stars: ${Math.round(pct * 100)} percent`}
                  >
                    <Text variant="caption" color="muted" style={{ width: 10 }}>
                      {star}
                    </Text>
                    <Bar pct={pct} color={t.colors.star} />
                  </View>
                );
              })}
            </View>
          </View>
          {subs.some(([, v]) => v != null) ? (
            <>
              <Divider />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: t.spacing.md, columnGap: t.spacing.lg }}>
                {subs.map(([label, v]) =>
                  v != null ? (
                    <View key={label} style={{ width: '46%', flexGrow: 1, gap: 6 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text variant="footnote" color="textSecondary">
                          {label}
                        </Text>
                        <Text variant="footnoteStrong" tabular>
                          {v.toFixed(1)}
                        </Text>
                      </View>
                      <Bar pct={v / 5} color={t.colors.primary} />
                    </View>
                  ) : null,
                )}
              </View>
            </>
          ) : null}
        </Card>
        {reviews.length === 0 ? (
          <Text variant="callout" color="muted">
            No written reviews yet.
          </Text>
        ) : (
          <Card padding={0} gap={0}>
            {visibleReviews.map((r, i) => (
              <Fragment key={r.id}>
                {i > 0 ? <Divider inset={t.spacing.lg} /> : null}
                <View style={{ padding: t.spacing.lg, gap: t.spacing.sm }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
                    <View
                      style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: t.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Ionicons name="person" size={16} color={t.colors.muted} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text variant="calloutStrong">Verified customer</Text>
                      <Text variant="caption" color="muted">
                        {new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </Text>
                    </View>
                    <RatingStars value={r.rating} size={13} />
                  </View>
                  {r.comment ? (
                    <Text variant="callout" color="textSecondary">
                      {r.comment}
                    </Text>
                  ) : null}
                  {r.provider_reply ? (
                    <View style={{ backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.sm, padding: t.spacing.md, gap: 2 }}>
                      <Text variant="captionStrong" color="textSecondary">
                        Reply from {first}
                      </Text>
                      <Text variant="footnote" color="textSecondary">
                        {r.provider_reply}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </Fragment>
            ))}
          </Card>
        )}
        {reviews.length > 4 ? (
          <Button
            title={showAll ? 'Show fewer reviews' : `Show all ${reviews.length} written reviews`}
            variant="ghost"
            onPress={onToggleShowAll}
          />
        ) : null}
      </Section>
    </View>
  );
}
