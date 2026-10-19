import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatINR } from '../lib/money';
import { colors, font, radius, spacing } from '../lib/theme';
import type { ProviderSearchResult, SkillLevel } from '../lib/types';
import { RatingStars } from './RatingStars';

export const skillLabel: Record<SkillLevel, string> = {
  beginner: 'Beginner',
  skilled: 'Skilled',
  expert: 'Expert',
  certified: 'Certified',
};

interface Props {
  provider: ProviderSearchResult;
  onPress: () => void;
}

export function ProviderCard({ provider: p, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${p.full_name}, ${p.rating_avg} stars, visit fee ${formatINR(p.visit_fee)}`}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
    >
      {p.avatar_url ? (
        <Image source={{ uri: p.avatar_url }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback]}>
          <Text style={styles.initial}>{p.full_name.slice(0, 1).toUpperCase() || '?'}</Text>
        </View>
      )}
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={font.heading} numberOfLines={1}>
            {p.full_name || 'Provider'}
          </Text>
          <Text style={styles.verified}>✓ Verified</Text>
        </View>
        <View style={styles.row}>
          <RatingStars value={Number(p.rating_avg)} size={14} />
          <Text style={font.caption}>
            {' '}
            {Number(p.rating_avg).toFixed(1)} ({p.rating_count})
          </Text>
          {p.is_online && <Text style={styles.online}> • Online</Text>}
        </View>
        <View style={styles.row}>
          <Text style={styles.badge}>{skillLabel[p.skill_level]}</Text>
          <Text style={font.caption}>
            {p.years_experience} yrs • {p.jobs_completed} jobs
            {p.distance_km != null ? ` • ${p.distance_km.toFixed(1)} km` : ''}
          </Text>
        </View>
        <Text style={styles.fee}>Visit fee {formatINR(p.visit_fee)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  avatarFallback: { backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  initial: { color: colors.primary, fontSize: 22, fontWeight: '700' },
  body: { flex: 1, gap: spacing.xs },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flexWrap: 'wrap' },
  verified: { color: colors.success, fontSize: 12, fontWeight: '600' },
  online: { color: colors.success, fontSize: 13, fontWeight: '600' },
  badge: {
    backgroundColor: colors.primarySoft,
    color: colors.primary,
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  fee: { ...font.body, fontWeight: '600' },
});
