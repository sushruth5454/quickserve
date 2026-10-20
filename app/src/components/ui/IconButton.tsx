import { Ionicons } from '@expo/vector-icons';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { haptics } from '../../lib/haptics';
import { useTheme, type Palette } from '../../theme';
import type { IconName } from './Button';

interface Props {
  icon: IconName;
  onPress: () => void;
  accessibilityLabel: string;
  variant?: 'plain' | 'tonal' | 'surface' | 'glass';
  color?: keyof Palette;
  size?: number;
  disabled?: boolean;
  badge?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Round icon-only button with a 48pt minimum touch target. */
export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  variant = 'plain',
  color = 'text',
  size = 22,
  disabled,
  badge,
  style,
}: Props) {
  const t = useTheme();
  const bg: Record<NonNullable<Props['variant']>, string> = {
    plain: 'transparent',
    tonal: t.colors.primarySoft,
    surface: t.colors.surface,
    glass: 'rgba(255,255,255,0.18)',
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      hitSlop={4}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [
        {
          width: t.minTouch,
          height: t.minTouch,
          borderRadius: t.minTouch / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: bg[variant],
          opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
        },
        variant === 'surface' ? [t.shadows.sm, { borderWidth: 1, borderColor: t.colors.border }] : null,
        style,
      ]}
    >
      <Ionicons name={icon} size={size} color={variant === 'glass' ? '#FFFFFF' : t.colors[color]} />
      {badge ? (
        <View
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            width: 9,
            height: 9,
            borderRadius: 5,
            backgroundColor: t.colors.danger,
            borderWidth: 2,
            borderColor: variant === 'glass' ? t.colors.primary : t.colors.surface,
          }}
        />
      ) : null}
    </Pressable>
  );
}
