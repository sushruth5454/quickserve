import type { ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { haptics } from '../../lib/haptics';
import { useTheme, type Elevation } from '../../theme';

interface CardProps {
  children: ReactNode;
  /** Default `outlined` (flat, 1px border) for dense lists; `elevated` adds a soft shadow for hero/floating content. */
  variant?: 'elevated' | 'outlined' | 'filled' | 'tinted';
  tint?: string;
  padding?: number;
  elevation?: Elevation;
  gap?: number;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}

export function Card({
  children,
  variant = 'outlined',
  tint,
  padding,
  elevation = 'sm',
  gap,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  style,
}: CardProps) {
  const t = useTheme();
  const base: ViewStyle = {
    borderRadius: t.radii.lg,
    padding: padding ?? t.spacing.lg,
    gap: gap ?? t.spacing.md,
    backgroundColor:
      variant === 'filled' ? t.colors.surfaceAlt : variant === 'tinted' ? (tint ?? t.colors.primarySoft) : t.colors.surface,
    borderWidth: variant === 'filled' || variant === 'tinted' ? 0 : 1,
    borderColor: t.colors.border,
  };
  const shadow = variant === 'elevated' ? t.shadows[elevation] : null;
  if (!onPress) return <View style={[base, shadow, style]}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={() => {
        haptics.select();
        onPress();
      }}
      style={({ pressed }) => [base, shadow, pressed && { backgroundColor: t.colors.surfaceAlt }, style]}
    >
      {children}
    </Pressable>
  );
}
