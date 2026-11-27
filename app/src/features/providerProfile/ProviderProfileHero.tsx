import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { View } from 'react-native';
import { Avatar, IconButton, Text } from '../../components/ui';
import type { ProviderDetail } from '../../lib/api';
import type { PublicTrustBadge } from '../../lib/onboarding/publicTrust';
import { type useTheme } from '../../theme';
import { MetaChip } from './ProfileParts';

export function ProviderProfileHero({
  provider,
  name,
  payoutBadge,
  theme: t,
  topInset,
  onBack,
  onShare,
}: {
  provider: ProviderDetail['provider'];
  name: string;
  payoutBadge: PublicTrustBadge | null;
  theme: ReturnType<typeof useTheme>;
  topInset: number;
  onBack: () => void;
  onShare: () => void;
}) {
  return (
    <View>
      <LinearGradient
        colors={[t.colors.heroFrom, t.colors.heroTo]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ height: topInset + 112, paddingTop: topInset + t.spacing.xs, paddingHorizontal: t.spacing.md }}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <IconButton icon="chevron-back" accessibilityLabel="Go back" onPress={onBack} variant="glass" visualSize={40} />
          <IconButton icon="share-outline" accessibilityLabel="Share profile" onPress={onShare} variant="glass" visualSize={40} size={20} />
        </View>
      </LinearGradient>
      <View style={{ alignItems: 'center', marginTop: -48, paddingHorizontal: t.spacing.lg, gap: t.spacing.sm }}>
        <View style={{ borderRadius: 52, borderWidth: 4, borderColor: t.colors.bg }}>
          <Avatar name={name} uri={provider.profiles?.avatar_url} size={88} online={provider.is_online} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
          <Text variant="title1" accessibilityRole="header" numberOfLines={1} style={{ flexShrink: 1 }}>
            {name}
          </Text>
          {payoutBadge ? (
            <Ionicons
              name="checkmark-circle"
              size={20}
              color={t.colors.primary}
              accessible
              accessibilityLabel={payoutBadge.label}
              accessibilityHint={payoutBadge.description}
            />
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center', columnGap: 10, rowGap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: provider.is_online ? t.colors.success : t.colors.outline }} />
            <Text variant="footnote" color="textSecondary">
              {provider.is_online ? 'Online' : 'Offline'}
            </Text>
          </View>
          <Text variant="footnote" color="muted">·</Text>
          <MetaChip icon="location-outline" label={provider.city} />
        </View>
      </View>
    </View>
  );
}
