import { View, type StyleProp, type ViewStyle } from 'react-native';
import { badgeLabel } from '../../lib/unread';
import { useTheme } from '../../theme';
import { Text } from './Text';

interface Props {
  count: number;
  /** Accessible noun, e.g. "unread messages". */
  label?: string;
  /** Overlay on the top-right corner of an icon button. */
  overlay?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Numeric unread pill (hidden at 0, "99+" above 99). */
export function CountBadge({ count, label = 'unread messages', overlay, style }: Props) {
  const t = useTheme();
  const text = badgeLabel(count);
  if (!text) return null;
  return (
    <View
      accessible
      accessibilityLabel={`${count} ${label}`}
      pointerEvents="none"
      style={[
        {
          minWidth: 20,
          minHeight: 20,
          borderRadius: 10,
          paddingHorizontal: 6,
          paddingVertical: 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: t.colors.dangerStrong,
        },
        overlay ? { position: 'absolute', top: -4, right: -4, borderWidth: 2, borderColor: t.colors.surface } : null,
        style,
      ]}
    >
      <Text variant="micro" style={{ color: t.colors.onDanger }} critical>
        {text}
      </Text>
    </View>
  );
}
