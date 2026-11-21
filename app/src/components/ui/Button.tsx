import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';
import { haptics } from '../../lib/haptics';
import { useTheme } from '../../theme';
import { Text } from './Text';

export type IconName = ComponentProps<typeof Ionicons>['name'];
/** `success` is kept as an alias of `primary`: green is a status colour, never a CTA fill. */
export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'destructiveGhost' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  haptic?: boolean;
  leftIcon?: IconName;
  rightIcon?: IconName;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}

const HEIGHT: Record<ButtonSize, number> = { sm: 40, md: 48, lg: 52 };
const PAD_X: Record<ButtonSize, number> = { sm: 12, md: 20, lg: 24 };

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled,
  loading,
  haptic = true,
  leftIcon,
  rightIcon,
  fullWidth,
  style,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: ButtonProps) {
  const t = useTheme();
  const c = t.colors;
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const inactive = !!disabled || !!loading;

  const palette: Record<ButtonVariant, { bg: string; bgPressed: string; fg: string; border: string }> = {
    primary: { bg: c.primary, bgPressed: c.primaryPressed, fg: c.onPrimary, border: c.primary },
    success: { bg: c.primary, bgPressed: c.primaryPressed, fg: c.onPrimary, border: c.primary },
    secondary: { bg: c.primarySoft, bgPressed: c.primarySoft, fg: c.primaryText, border: c.primarySoft },
    outline: { bg: c.surface, bgPressed: c.surfaceAlt, fg: c.text, border: c.borderStrong },
    ghost: { bg: 'transparent', bgPressed: c.surfaceAlt, fg: c.primaryText, border: 'transparent' },
    destructive: { bg: c.dangerStrong, bgPressed: c.dangerPressed, fg: c.onDanger, border: c.dangerStrong },
    destructiveGhost: { bg: 'transparent', bgPressed: c.dangerSoft, fg: c.dangerText, border: 'transparent' },
  };
  const ghostLike = variant === 'ghost' || variant === 'destructiveGhost';
  const base = palette[variant];
  // M3-style disabled: neutral container + low-emphasis content, full opacity (no washed-out brand colour).
  const p =
    disabled && !loading
      ? { bg: ghostLike ? 'transparent' : c.surfaceAlt, bgPressed: c.surfaceAlt, fg: c.subtle, border: ghostLike ? 'transparent' : c.surfaceAlt }
      : base;
  const iconSize = size === 'sm' ? 16 : 18;

  return (
    <Animated.View style={[fullWidth ? styles.full : null, animatedStyle, style]}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? title}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: inactive, busy: !!loading }}
        disabled={inactive}
        hitSlop={size === 'sm' ? 4 : 0}
        onPressIn={() => {
          if (!reduceMotion) scale.value = withSpring(0.98, t.motion.spring);
        }}
        onPressOut={() => {
          scale.value = withSpring(1, t.motion.spring);
        }}
        onPress={() => {
          if (haptic) haptics.tap();
          onPress();
        }}
        style={({ pressed }) => [
          styles.base,
          {
            minHeight: HEIGHT[size],
            paddingHorizontal: PAD_X[size],
            borderRadius: t.radii.md,
            backgroundColor: pressed ? p.bgPressed : p.bg,
            borderColor: p.border,
          },
          { flexGrow: 1 },
        ]}
      >
        {loading ? (
          <ActivityIndicator color={p.fg} />
        ) : (
          <View style={styles.row}>
            {leftIcon ? <Ionicons name={leftIcon} size={iconSize} color={p.fg} /> : null}
            <Text
              variant={size === 'sm' ? 'subheadStrong' : 'button'}
              style={{ color: p.fg, flexShrink: 1, maxWidth: '100%' }}
              critical
            >
              {title}
            </Text>
            {rightIcon ? <Ionicons name={rightIcon} size={iconSize} color={p.fg} /> : null}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 8, maxWidth: '100%' },
  full: { alignSelf: 'stretch' },
});
