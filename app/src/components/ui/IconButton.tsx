import { Ionicons } from '@expo/vector-icons';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { haptics } from '../../lib/haptics';
import { useTheme, type Palette } from '../../theme';
import type { IconName } from './Button';
import { Text } from './Text';

interface Props {
  icon: IconName;
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  /** `neutral`: quiet grey disc for back/close/utility actions. `tonal`: primary-tinted. `glass`: over imagery/gradients. */
  variant?: 'plain' | 'neutral' | 'tonal' | 'surface' | 'glass';
  color?: keyof Palette;
  size?: number;
  /** Visible diameter; the touch target is always padded to 48pt with hitSlop. */
  visualSize?: number;
  disabled?: boolean;
  /** true: a dot. A number > 0: a count pill (99+ caps it). */
  badge?: boolean | number;
  style?: StyleProp<ViewStyle>;
}

/** Round icon-only button with a 48pt minimum touch target. */
export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  variant = 'plain',
  color,
  size,
  visualSize,
  disabled,
  badge,
  style,
}: Props) {
  const t = useTheme();
  const d = visualSize ?? (variant === 'neutral' || variant === 'surface' ? 40 : t.minTouch);
  const slop = Math.max(0, Math.ceil((t.minTouch - d) / 2));
  const bg: Record<NonNullable<Props['variant']>, string> = {
    plain: 'transparent',
    neutral: t.colors.surfaceAlt,
    tonal: t.colors.primarySoft,
    surface: t.colors.surface,
    glass: 'rgba(16,24,40,0.32)',
  };
  const fg =
    variant === 'glass'
      ? '#FFFFFF'
      : t.colors[color ?? (variant === 'neutral' ? 'textSecondary' : variant === 'tonal' ? 'primaryText' : 'text')];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      hitSlop={slop + 2}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [
        {
          width: d,
          height: d,
          borderRadius: d / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed && variant === 'plain' ? t.colors.surfaceAlt : bg[variant],
          opacity: disabled ? 0.4 : pressed && variant !== 'plain' ? 0.7 : 1,
        },
        variant === 'surface' ? [t.shadows.sm, { borderWidth: 1, borderColor: t.colors.border }] : null,
        style,
      ]}
    >
      <Ionicons name={icon} size={size ?? (d <= 32 ? 18 : 20)} color={fg} />
      {typeof badge === 'number' && badge > 0 ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: -4,
            right: -6,
            minWidth: 20,
            height: 20,
            paddingHorizontal: 5,
            borderRadius: 10,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: t.colors.danger,
            borderWidth: 2,
            borderColor: t.colors.bg,
          }}
        >
          <Text style={{ color: '#FFFFFF', fontSize: 11, lineHeight: 13, fontFamily: t.fontFamily.semibold }} tabular maxFontSizeMultiplier={1.2}>
            {badge > 99 ? '99+' : badge}
          </Text>
        </View>
      ) : badge === true ? (
        <View
          style={{
            position: 'absolute',
            top: d * 0.2,
            right: d * 0.2,
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: t.colors.danger,
            borderWidth: 1.5,
            borderColor: bg[variant] === 'transparent' ? t.colors.bg : bg[variant],
          }}
        />
      ) : null}
    </Pressable>
  );
}
