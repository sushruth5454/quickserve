import { useEffect } from 'react';
import { View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useTheme } from '../../theme';

interface Props {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

export function Skeleton({ width = '100%', height = 14, radius, style }: Props) {
  const t = useTheme();
  const o = useSharedValue(0.55);
  useEffect(() => {
    o.value = withRepeat(withTiming(1, { duration: 800 }), -1, true);
  }, [o]);
  const anim = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, borderRadius: radius ?? t.radii.sm, backgroundColor: t.colors.skeleton }, anim, style]}
    />
  );
}

/** Placeholder shaped like a list card (avatar + 3 lines). */
export function SkeletonCard({ lines = 3, avatar = true }: { lines?: number; avatar?: boolean }) {
  const t = useTheme();
  return (
    <View
      accessibilityLabel="Loading"
      accessibilityRole="progressbar"
      style={{
        flexDirection: 'row',
        gap: t.spacing.md,
        padding: t.spacing.lg,
        borderRadius: t.radii.lg,
        backgroundColor: t.colors.surface,
        borderWidth: 1,
        borderColor: t.colors.border,
      }}
    >
      {avatar ? <Skeleton width={52} height={52} radius={26} /> : null}
      <View style={{ flex: 1, gap: 10, paddingTop: 2 }}>
        <Skeleton width="55%" height={16} />
        {Array.from({ length: lines - 1 }).map((_, i) => (
          <Skeleton key={i} width={i % 2 === 0 ? '80%' : '40%'} height={12} />
        ))}
      </View>
    </View>
  );
}
