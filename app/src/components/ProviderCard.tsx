import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';
import { formatINR } from '../lib/money';
import type { ProviderSearchResult, SkillLevel } from '../lib/types';
import { useTheme } from '../theme';
import { Avatar, Badge, Button, Card, Text, type Tone } from './ui';

export const skillLabel: Record<SkillLevel, string> = {
  beginner: 'Beginner',
  skilled: 'Skilled',
  expert: 'Expert',
  certified: 'Certified',
};

export const skillTone: Record<SkillLevel, Tone> = {
  beginner: 'neutral',
  skilled: 'info',
  expert: 'primary',
  certified: 'success',
};

export function SkillBadge({ level }: { level: SkillLevel }) {
  return (
    <Badge
      label={skillLabel[level]}
      tone={skillTone[level]}
      icon={level === 'certified' ? 'ribbon' : level === 'expert' ? 'flash' : undefined}
      uppercase
    />
  );
}

export function VerifiedMark({ size = 16 }: { size?: number }) {
  const t = useTheme();
  return <Ionicons name="checkmark-circle" size={size} color={t.colors.success} accessibilityLabel="Verified" />;
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
      <Text variant="captionStrong">{value.toFixed(1)}</Text>
      <Text variant="caption" color="muted">
        ({count})
      </Text>
    </View>
  );
}

export function MetaItem({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Ionicons name={icon} size={13} color={t.colors.muted} />
      <Text variant="caption" color="muted">
        {label}
      </Text>
    </View>
  );
}

interface Props {
  provider: ProviderSearchResult;
  onPress: () => void;
  onBook: () => void;
}

export function ProviderCard({ provider: p, onPress, onBook }: Props) {
  const t = useTheme();
  const rating = Number(p.rating_avg);
  return (
    <Card
      onPress={onPress}
      padding={t.spacing.lg}
      gap={t.spacing.md}
      accessibilityLabel={`${p.full_name}, verified, ${skillLabel[p.skill_level]}, rated ${rating.toFixed(1)} from ${p.rating_count} reviews, visit fee ${formatINR(p.visit_fee)}`}
      accessibilityHint="Opens provider details"
    >
      <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
        <Avatar name={p.full_name} uri={p.avatar_url} size={56} online={p.is_online} />
        <View style={{ flex: 1, gap: 5 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text variant="title3" numberOfLines={1} style={{ flexShrink: 1 }}>
              {p.full_name || 'Provider'}
            </Text>
            <VerifiedMark />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <RatingInline value={rating} count={p.rating_count} />
            <SkillBadge level={p.skill_level} />
          </View>
          <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
            {p.distance_km != null ? <MetaItem icon="location-outline" label={`${p.distance_km.toFixed(1)} km`} /> : null}
            <MetaItem icon="briefcase-outline" label={`${p.jobs_completed} jobs`} />
            <MetaItem icon="time-outline" label={`${p.years_experience} yrs`} />
          </View>
        </View>
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: t.spacing.md,
          borderTopWidth: 1,
          borderTopColor: t.colors.border,
        }}
      >
        <View>
          <Text variant="caption" color="muted">
            Visit fee
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            <Text variant="title3" tabular>
              {formatINR(p.visit_fee)}
            </Text>
            <Text variant="caption" color="muted">
              adjusted in bill
            </Text>
          </View>
        </View>
        <Button title="Book" size="sm" onPress={onBook} rightIcon="arrow-forward" accessibilityLabel={`Book ${p.full_name}`} />
      </View>
    </Card>
  );
}
