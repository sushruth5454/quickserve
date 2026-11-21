import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { haptics } from '../../lib/haptics';
import { useTheme, type Palette } from '../../theme';
import type { IconName } from './Button';
import { Text } from './Text';

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

export function toneColors(colors: Palette, tone: Tone): { bg: string; fg: string; solid: string } {
  switch (tone) {
    case 'primary':
      return { bg: colors.primarySoft, fg: colors.primaryText, solid: colors.primary };
    case 'success':
      return { bg: colors.successSoft, fg: colors.successText, solid: colors.success };
    case 'warning':
      return { bg: colors.warningSoft, fg: colors.warningText, solid: colors.warning };
    case 'danger':
      return { bg: colors.dangerSoft, fg: colors.dangerText, solid: colors.danger };
    case 'info':
      return { bg: colors.infoSoft, fg: colors.infoText, solid: colors.info };
    default:
      return { bg: colors.surfaceAlt, fg: colors.textSecondary, solid: colors.muted };
  }
}

interface BadgeProps {
  label: string;
  tone?: Tone;
  icon?: IconName;
  dot?: boolean;
  size?: 'sm' | 'md';
  /** Deprecated: badges are sentence case. Ignored. */
  uppercase?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** Status badge: small radius (not a pill) so state reads differently from tappable chips. */
export function Badge({ label, tone = 'neutral', icon, dot, size = 'sm', style }: BadgeProps) {
  const t = useTheme();
  const c = toneColors(t.colors, tone);
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'flex-start',
          maxWidth: '100%',
          gap: 5,
          minHeight: size === 'sm' ? 22 : 26,
          backgroundColor: c.bg,
          borderRadius: t.radii.xs,
          paddingHorizontal: size === 'sm' ? 8 : 10,
        },
        style,
      ]}
    >
      {dot ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.solid }} /> : null}
      {icon ? <Ionicons name={icon} size={size === 'sm' ? 12 : 14} color={c.fg} /> : null}
      <Text variant="captionStrong" style={{ color: c.fg, flexShrink: 1, minWidth: 0 }} critical>
        {label}
      </Text>
    </View>
  );
}

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  /** Custom leading element (e.g. a status dot). Replaced by a check mark when selected. */
  leading?: ReactNode;
  trailingIcon?: IconName;
  count?: number;
  disabled?: boolean;
  /** Show a leading check when selected (M3 filter chip). Default true. */
  check?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** Filter/choice chip: 36pt visual with hit slop to a 48pt target. Selected = tonal fill + primary outline + check. */
export function Chip({
  label,
  selected,
  onPress,
  icon,
  leading,
  trailingIcon,
  count,
  disabled,
  check = true,
  accessibilityLabel,
  style,
}: ChipProps) {
  const t = useTheme();
  const fg = selected ? t.colors.primaryText : t.colors.textSecondary;
  const showCheck = selected && check;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={() => {
        haptics.select();
        onPress?.();
      }}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 6,
          minHeight: 36,
          maxWidth: '100%',
          paddingHorizontal: t.spacing.md,
          paddingVertical: 6,
          borderRadius: t.radii.pill,
          borderWidth: 1,
          borderColor: selected ? t.colors.primary : t.colors.borderStrong,
          backgroundColor: selected ? t.colors.primarySoft : pressed ? t.colors.surfaceAlt : t.colors.surface,
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
    >
      {showCheck ? (
        <Ionicons name="checkmark" size={16} color={fg} />
      ) : leading ? (
        leading
      ) : icon ? (
        <Ionicons name={icon} size={16} color={t.colors.muted} />
      ) : null}
      <Text variant="subhead" style={{ color: fg, flexShrink: 1, minWidth: 0 }} critical>
        {label}
      </Text>
      {count ? (
        <View
          style={{
            minWidth: 18,
            minHeight: 18,
            borderRadius: 9,
            paddingHorizontal: 5,
            paddingVertical: 2,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: t.colors.primary,
          }}
        >
          <Text variant="micro" style={{ color: t.colors.onPrimary }} critical>
            {count}
          </Text>
        </View>
      ) : null}
      {trailingIcon ? <Ionicons name={trailingIcon} size={14} color={fg} /> : null}
    </Pressable>
  );
}

/** Small round dot used for presence ("Online now") and similar leading markers. */
export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}
