import { Ionicons } from '@expo/vector-icons';
import type { JSX } from 'react';
import { View } from 'react-native';
import { useTheme } from '../../theme';
import { Card } from '../ui/Card';
import { Text } from '../ui/Text';
import type { IconName } from '../ui/Button';

export function TrustStrip({
  items,
}: {
  items: { icon: IconName; label: string }[];
}): JSX.Element {
  const theme = useTheme();

  return (
    <Card variant="filled">
      <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
        {items.map((item, index) => (
          <View
            key={`${item.label}-${index}`}
            style={{ flex: 1, alignItems: 'center', gap: theme.spacing.sm }}
          >
            <Ionicons name={item.icon} size={theme.iconSize.md} color={theme.colors.primaryText} />
            <Text variant="caption" color="muted" align="center" numberOfLines={2}>
              {item.label}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
}
