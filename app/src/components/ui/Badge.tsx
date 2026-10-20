import { Ionicons } from '@expo/vector-icons';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { haptics } from '../../lib/haptics';
import { useTheme, type Palette } from '../../theme';
import type { IconName } from './Button';
import { Text } from './Text';

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

export function toneColors(colors: Palette, tone: Tone): { bg: string; fg: string; solid: string } {
  switch (tone) {
    case 'primary':
      return { bg: colors.primarySoft, fg: colors.primary, solid: colors.primary };
    case 'success':
      return { bg: colors.successSoft, fg: colors.successText, solid: colors.success };
    case 'warning':
      return { bg: colors.warningSoft, fg: colors.warningText, solid: colors.warning };
    case 'danger':
      return { bg: colors.dangerSoft, fg: colors.dangerText, solid: colors.danger };
    case 'info':
      return { bg: colors.infoSoft, fg: colors.info, solid: colors.info };
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
  uppercase?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Badge({ label, tone = 'neutral', icon, dot, size = 'sm', uppercase, style }: BadgeProps) {
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
          gap: 4,
          backgroundColor: c.bg,
          borderRadius: t.radii.pill,
          paddingHorizontal: size === 'sm' ? 8 : 10,
          paddingVertical: size === 'sm' ? 2 : 4,
        },
        style,
      ]}
    >
      {dot ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: c.solid }} /> : null}
      {icon ? <Ionicons name={icon} size={size === 'sm' ? 12 : 14} color={c.fg} /> : null}
      <Text
        variant={uppercase ? 'micro' : size === 'sm' ? 'captionStrong' : 'subhead'}
        uppercase={uppercase}
        style={{ color: c.fg, fontSize: uppercase ? 10.5 : size === 'sm' ? 12 : 13 }}
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
      >
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
  trailingIcon?: IconName;
  count?: number;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/** Selectable filter/choice chip (≥ 40pt tall with hit slop to reach 48pt). */
export function Chip({ label, selected, onPress, icon, trailingIcon, count, disabled, accessibilityLabel, style }: ChipProps) {
  const t = useTheme();
  const fg = selected ? t.colors.onPrimary : t.colors.textSecondary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      disabled={disabled}
      hitSlop={{ top: 4, bottom: 4 }}
      onPress={() => {
        haptics.select();
        onPress?.();
      }}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          minHeight: 40,
          paddingHorizontal: t.spacing.md + 2,
          borderRadius: t.radii.pill,
          borderWidth: 1,
          borderColor: selected ? t.colors.primary : t.colors.border,
          backgroundColor: selected ? t.colors.primary : pressed ? t.colors.surfaceAlt : t.colors.surface,
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={16} color={selected ? fg : t.colors.muted} /> : null}
      <Text variant="subhead" style={{ color: fg }} numberOfLines={1} maxFontSizeMultiplier={1.3}>
        {label}
      </Text>
      {count ? (
        <View
          style={{
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            paddingHorizontal: 5,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: selected ? 'rgba(255,255,255,0.25)' : t.colors.primary,
          }}
        >
          <Text variant="micro" style={{ color: '#FFFFFF' }}>
            {count}
          </Text>
        </View>
      ) : null}
      {trailingIcon ? <Ionicons name={trailingIcon} size={14} color={fg} /> : null}
    </Pressable>
  );
}
