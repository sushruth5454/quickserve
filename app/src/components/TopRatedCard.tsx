import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import type { TopRatedProvider } from '../lib/apiTypes';
import { useTheme } from '../theme';
import { skillLabel } from './ProviderCard';
import { providerCardModel } from './providerCardModel';
import { Avatar, Skeleton, Text, hashHue, lighten } from './ui';

const MEDIA_HEIGHT = 104;

/**
 * Horizontal-carousel listing card (Urban Company / Airbnb pattern): fixed width so the next card
 * peeks, a media band, then strictly single-line rows so every card has the same height.
 */
export function TopRatedCard({ provider: p, width, onPress }: { provider: TopRatedProvider; width: number; onPress: () => void }) {
  const t = useTheme();
  const name = p.profiles?.full_name || 'Provider';
  const hue = hashHue(name);
  const rating = Number(p.rating_avg);
  const { lead, categoryLabel, priceLabel, isOnline } = providerCardModel({
    services: p.provider_services,
    isOnline: p.is_online,
    onLeaveUntil: p.on_leave_until,
  });
  const category = categoryLabel;
  const service = lead ? [category, skillLabel[lead.skill_level]].filter(Boolean).join(' · ') : `${p.years_experience} yrs experience`;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, verified${lead ? `, ${service}` : ''}, rated ${rating.toFixed(1)} from ${p.rating_count} reviews, ${
        isOnline ? 'online' : 'not online'
      }, ${priceLabel}, view profile`}
      style={({ pressed }) => [
        {
          width,
          borderRadius: t.radii.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: t.colors.border,
          backgroundColor: t.colors.surface,
          overflow: 'hidden',
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
        t.shadows.md,
      ]}
    >
      {({ pressed }) => (
        <>
          <View
            style={{
              height: MEDIA_HEIGHT,
              backgroundColor: t.dark ? t.colors.surfaceRaised : lighten(hue, 0.92),
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View style={{ padding: 3, borderRadius: 40, backgroundColor: t.colors.surface }}>
              <Avatar name={name} uri={p.profiles?.avatar_url} size={64} online={isOnline} />
            </View>
            <View
              style={{
                position: 'absolute',
                top: t.spacing.sm,
                left: t.spacing.sm,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                height: 24,
                paddingHorizontal: 8,
                borderRadius: t.radii.pill,
                backgroundColor: t.colors.surface,
              }}
            >
              <Ionicons name="shield-checkmark" size={12} color={t.colors.primaryText} />
              <Text variant="captionStrong" color="text" maxFontSizeMultiplier={1.2}>
                Verified
              </Text>
            </View>
          </View>

          <View style={{ padding: t.spacing.md, gap: 2, backgroundColor: pressed ? t.colors.surfaceAlt : 'transparent' }}>
            <Text variant="calloutStrong" numberOfLines={1}>
              {name}
            </Text>
            <Text variant="footnote" color="textSecondary" numberOfLines={1}>
              {service}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
              <Ionicons name="star" size={13} color={t.colors.star} />
              <Text variant="footnoteStrong" tabular>
                {rating.toFixed(1)}
              </Text>
              <Text variant="footnote" color="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                {`(${p.rating_count})  ·  ${p.jobs_completed} jobs  ·  ${p.city}`}
              </Text>
            </View>

            <View
              style={{
                marginTop: t.spacing.sm,
                paddingTop: t.spacing.sm,
                borderTopWidth: StyleSheet.hairlineWidth,
                borderTopColor: t.colors.border,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Text variant="footnote" color="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                {priceLabel}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                <Text variant="caption" color="muted">
                  View profile
                </Text>
                <Ionicons name="chevron-forward" size={16} color={t.colors.muted} />
              </View>
            </View>
          </View>
        </>
      )}
    </Pressable>
  );
}

/** Full-width list row for the "See all" screen: same data as the carousel card, list density. */
export function TopRatedRow({ provider: p, onPress }: { provider: TopRatedProvider; onPress: () => void }) {
  const t = useTheme();
  const name = p.profiles?.full_name || 'Provider';
  const rating = Number(p.rating_avg);
  const { lead, categoryLabel, priceLabel, isOnline } = providerCardModel({
    services: p.provider_services,
    isOnline: p.is_online,
    onLeaveUntil: p.on_leave_until,
  });
  const category = categoryLabel;
  const service = lead ? [category, skillLabel[lead.skill_level]].filter(Boolean).join(' · ') : `${p.years_experience} yrs experience`;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, verified, ${service}, rated ${rating.toFixed(1)} from ${p.rating_count} reviews, ${
        isOnline ? 'online' : 'not online'
      }, ${priceLabel}, view profile`}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.spacing.md,
          padding: t.spacing.lg,
          borderRadius: t.radii.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: t.colors.border,
          backgroundColor: pressed ? t.colors.surfaceAlt : t.colors.surface,
        },
      ]}
    >
      <Avatar name={name} uri={p.profiles?.avatar_url} size={52} online={isOnline} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text variant="calloutStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
            {name}
          </Text>
          <Ionicons name="checkmark-circle" size={15} color={t.colors.primary} accessibilityLabel="Verified" />
        </View>
        <Text variant="footnote" color="textSecondary" numberOfLines={1}>
          {service}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name="star" size={13} color={t.colors.star} />
          <Text variant="footnoteStrong" tabular>
            {rating.toFixed(1)}
          </Text>
          <Text variant="footnote" color="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
            {`(${p.rating_count})  ·  ${p.jobs_completed} jobs`}
          </Text>
        </View>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text variant="footnote" color="muted" numberOfLines={1}>
          {priceLabel}
        </Text>
        <Text variant="caption" color="muted">
          View profile
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={t.colors.muted} />
    </Pressable>
  );
}

export function TopRatedCardSkeleton({ width }: { width: number }) {
  const t = useTheme();
  return (
    <View style={{ width, borderRadius: t.radii.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border, overflow: 'hidden' }}>
      <Skeleton width={width} height={MEDIA_HEIGHT} radius={0} />
      <View style={{ padding: t.spacing.md, gap: t.spacing.sm }}>
        <Skeleton width="70%" height={16} />
        <Skeleton width="50%" height={12} />
        <Skeleton width="60%" height={12} />
        <Skeleton width="40%" height={16} />
      </View>
    </View>
  );
}
