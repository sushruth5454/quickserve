import { Ionicons } from '@expo/vector-icons';
import type { JSX } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { useTheme } from '../../theme';
import { Card } from '../ui/Card';
import { Text } from '../ui/Text';
import type { IconName } from '../ui/Button';
import { pillarAccent, pillarCardLayout, type Pillar } from './pillars';
import type { CardPresentation } from './listingModel';

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
  fullWidth = false,
  presentation = 'legacy',
  testID,
}: {
  pillar: Pillar;
  title: string;
  subtitle: string;
  onPress: () => void;
  fullWidth?: boolean;
  presentation?: CardPresentation;
  testID?: string;
}): JSX.Element {
  const theme = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const isOorva = presentation === 'oorva';
  const layout = pillarCardLayout({ presentation, viewportWidth: width, fontScale, fullWidth });
  const accent = pillarAccent(pillar, theme.colors);

  return (
    <Card
      variant="outlined"
      style={{
        width: layout.width,
        ...(isOorva ? {} : { minHeight: 132 }),
        justifyContent: 'center',
      }}
      onPress={onPress}
      accessibilityLabel={`${title}. ${subtitle}`}
    >
      <View
        testID={testID}
        style={{ flexDirection: layout.stacked ? 'column' : 'row', alignItems: 'center', gap: theme.spacing.md }}
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
        <View style={{ flex: 1, width: layout.stacked ? '100%' : undefined, gap: theme.spacing.xs }}>
          <Text variant="calloutStrong" maxFontSizeMultiplier={2}>
            {title}
          </Text>
          <Text variant="caption" color="muted" numberOfLines={isOorva ? undefined : 2}>
            {subtitle}
          </Text>
        </View>
      </View>
    </Card>
  );
}
