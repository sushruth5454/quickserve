import { Ionicons } from '@expo/vector-icons';
import type { JSX } from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme';
import { Card } from '../ui/Card';
import { Text } from '../ui/Text';
import type { IconName } from '../ui/Button';
import type { CardPresentation } from './listingModel';

export function TrustStrip({
  items,
  presentation = 'legacy',
}: {
  items: { icon: IconName; label: string }[];
  presentation?: CardPresentation;
}): JSX.Element {
  const theme = useTheme();
  const isOorva = presentation === 'oorva';

  return (
    <Card variant="filled">
      <View
        style={{
          flexDirection: 'row',
          flexWrap: isOorva ? 'wrap' : undefined,
          gap: theme.spacing.md,
        }}
      >
        {items.map((item, index) => (
          <View
            key={`${item.label}-${index}`}
            style={{
              flex: 1,
              ...(isOorva ? { flexBasis: 140, minWidth: 140, alignItems: 'flex-start' } : { alignItems: 'center' }),
              gap: theme.spacing.sm,
            }}
          >
            <Ionicons name={item.icon} size={theme.iconSize.md} color={theme.colors.primaryText} />
            <Text
              variant="caption"
              color="muted"
              align={isOorva ? 'left' : 'center'}
              numberOfLines={isOorva ? undefined : 2}
            >
              {item.label}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
}
