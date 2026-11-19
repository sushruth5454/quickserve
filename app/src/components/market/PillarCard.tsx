import { Ionicons } from '@expo/vector-icons';
import type { JSX } from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme';
import { Card } from '../ui/Card';
import { Text } from '../ui/Text';
import type { IconName } from '../ui/Button';
import { pillarAccent, type Pillar } from './pillars';

const PILLAR_ICONS: Record<Pillar, IconName> = {
  home: 'construct-outline',
  shops: 'storefront-outline',
  sports: 'football-outline',
  creators: 'color-palette-outline',
};

export function PillarCard({
  pillar,
  title,
  subtitle,
  onPress,
  testID,
}: {
  pillar: Pillar;
  title: string;
  subtitle: string;
  onPress: () => void;
  testID?: string;
}): JSX.Element {
  const theme = useTheme();
  const accent = pillarAccent(pillar, theme.colors);

  return (
    <Card
      variant="outlined"
      style={{ width: '48%', minHeight: 132, justifyContent: 'center' }}
      onPress={onPress}
      accessibilityLabel={`${title}. ${subtitle}`}
    >
      <View
        testID={testID}
        style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md }}
      >
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: theme.radii.pill,
            backgroundColor: accent.soft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={PILLAR_ICONS[pillar]} size={theme.iconSize.lg} color={accent.fg} />
        </View>
        <View style={{ flex: 1, gap: theme.spacing.xs }}>
          <Text variant="calloutStrong" numberOfLines={2}>
            {title}
          </Text>
          <Text variant="caption" color="muted" numberOfLines={2}>
            {subtitle}
          </Text>
        </View>
      </View>
    </Card>
  );
}
