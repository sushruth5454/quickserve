import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';
import { formatINR } from '../lib/money';
import type { ProviderSearchResult, SkillLevel } from '../lib/types';
import { useTheme } from '../theme';
import { Badge, Button, Text, type Tone } from './ui';
import { ListingCard } from './market/ListingCard';
import { providerCardModel } from './providerCardModel';

export const skillLabel: Record<SkillLevel, string> = {
  beginner: 'Beginner',
  skilled: 'Skilled',
  expert: 'Expert',
  certified: 'Certified',
};

export const skillTone: Record<SkillLevel, Tone> = {
  beginner: 'neutral',
  skilled: 'neutral',
  expert: 'neutral',
  certified: 'success',
};

export function SkillBadge({ level }: { level: SkillLevel }) {
  return <Badge label={skillLabel[level]} tone={skillTone[level]} icon={level === 'certified' ? 'ribbon-outline' : undefined} />;
}

export function VerifiedMark({ size = 16 }: { size?: number }) {
  const t = useTheme();
  return <Ionicons name="checkmark-circle" size={size} color={t.colors.primary} accessibilityLabel="Verified" />;
}

export function RatingInline({ value, count }: { value: number; count: number }) {
  const t = useTheme();
  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}
      accessible
      accessibilityLabel={`Rated ${value.toFixed(1)} out of 5 from ${count} reviews`}
    >
      <Ionicons name="star" size={14} color={t.colors.star} />
      <Text variant="footnoteStrong">{value.toFixed(1)}</Text>
      <Text variant="footnote" color="muted">
        ({count})
      </Text>
    </View>
  );
}

export function MetaItem({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Ionicons name={icon} size={14} color={t.colors.muted} />
      <Text variant="footnote" color="muted" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** "a · b · c" meta line with consistent separators. */
export function MetaLine({ items }: { items: (string | null | undefined | false)[] }) {
  return (
    <Text variant="footnote" color="muted" numberOfLines={1}>
      {items.filter(Boolean).join('  ·  ')}
    </Text>
  );
}

interface Props {
  provider: ProviderSearchResult;
  onPress: () => void;
  onBook: () => void;
  /** Creator/event categories have no visit fee; providers send a fixed proposal per brief. */
  mode?: 'visit' | 'proposal';
}

export function ProviderCard({ provider: p, onPress, onBook, mode = 'visit' }: Props) {
  const t = useTheme();
  const rating = Number(p.rating_avg);
  const name = p.full_name || 'Provider';
  const model = providerCardModel({
    visitFeeLabel: formatINR(p.visit_fee),
    isOnline: p.is_online,
    mode,
  });
  const ctaAccessibilityLabel =
    mode === 'proposal'
      ? `Request a proposal from ${name}`
      : p.is_online
        ? `Book ${name}`
        : `Schedule with ${name}`;
  const subtitle = [
    p.distance_km != null && `${p.distance_km.toFixed(1)} km`,
    `${p.jobs_completed} jobs`,
    `${p.years_experience} yrs exp.`,
  ]
    .filter(Boolean)
    .join('  ·  ');

  return (
    <View style={{ gap: t.spacing.sm }}>
      <ListingCard
        variant="provider"
        title={name}
        avatarName={name}
        imageUrl={p.avatar_url}
        subtitle={subtitle}
        rating={rating}
        ratingCount={p.rating_count}
        verified
        tags={[p.is_online ? 'Online' : 'Offline', skillLabel[p.skill_level]]}
        priceLabel={model.priceLabel}
        onPress={onPress}
        testID={`provider-${p.provider_service_id}`}
      />
      <View style={{ alignItems: 'flex-end' }}>
        <Button
          title={model.ctaLabel}
          size="sm"
          onPress={onBook}
          accessibilityLabel={ctaAccessibilityLabel}
          style={{ minWidth: 88 }}
        />
      </View>
    </View>
  );
}
