import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { haptics } from '../../lib/haptics';
import { useTheme } from '../../theme';
import { Text } from './Text';

export type IconName = ComponentProps<typeof Ionicons>['name'];
export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'success';
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

const HEIGHT: Record<ButtonSize, number> = { sm: 40, md: 48, lg: 56 };

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
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const inactive = !!disabled || !!loading;

  const palette: Record<ButtonVariant, { bg: string; bgPressed: string; fg: string; border: string }> = {
    primary: { bg: c.primary, bgPressed: c.primaryPressed, fg: c.onPrimary, border: c.primary },
    secondary: { bg: c.primarySoft, bgPressed: c.primarySoft, fg: c.primary, border: c.primarySoft },
    outline: { bg: c.surface, bgPressed: c.surfaceAlt, fg: c.text, border: c.borderStrong },
    ghost: { bg: 'transparent', bgPressed: c.surfaceAlt, fg: c.primary, border: 'transparent' },
    destructive: { bg: c.danger, bgPressed: c.dangerText, fg: '#FFFFFF', border: c.danger },
    success: { bg: c.success, bgPressed: c.successText, fg: '#FFFFFF', border: c.success },
  };
  const p = palette[variant];
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
        scale.value = withSpring(0.97, t.motion.spring);
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
          paddingHorizontal: size === 'sm' ? t.spacing.md : t.spacing.xl,
          borderRadius: size === 'sm' ? t.radii.sm + 2 : t.radii.md,
          backgroundColor: pressed ? p.bgPressed : p.bg,
          borderColor: p.border,
          opacity: disabled && !loading ? 0.45 : 1,
        },
        variant === 'primary' && !inactive ? t.shadows.sm : null,
        { flexGrow: 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={p.fg} />
      ) : (
        <View style={styles.row}>
          {leftIcon ? <Ionicons name={leftIcon} size={iconSize} color={p.fg} /> : null}
          <Text
            variant={size === 'sm' ? 'subhead' : 'button'}
            style={{ color: p.fg }}
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  full: { alignSelf: 'stretch' },
});
