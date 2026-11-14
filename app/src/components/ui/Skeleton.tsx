import { useEffect, type ReactNode } from 'react';
import { View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useTheme } from '../../theme';

interface Props {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

export function Skeleton({ width = '100%', height = 14, radius, style }: Props) {
  const t = useTheme();
  const reduceMotion = useReducedMotion();
  const o = useSharedValue(0.55);
  useEffect(() => {
    if (!reduceMotion) o.value = withRepeat(withTiming(1, { duration: 800 }), -1, true);
  }, [o, reduceMotion]);
  const anim = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, borderRadius: radius ?? t.radii.sm, backgroundColor: t.colors.skeleton }, anim, style]}
    />
  );
}

function Shell({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <View
      accessibilityLabel="Loading"
      accessibilityRole="progressbar"
      style={{
        gap: t.spacing.md,
        padding: t.spacing.lg,
        borderRadius: t.radii.lg,
        backgroundColor: t.colors.surface,
        borderWidth: 1,
        borderColor: t.colors.border,
      }}
    >
      {children}
    </View>
  );
}

/** Generic list card placeholder (avatar + lines). */
export function SkeletonCard({ lines = 3, avatar = true }: { lines?: number; avatar?: boolean }) {
  const t = useTheme();
  return (
    <Shell>
      <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
        {avatar ? <Skeleton width={44} height={44} radius={t.radii.md} /> : null}
        <View style={{ flex: 1, gap: 10, paddingTop: 2 }}>
          <Skeleton width="55%" height={16} />
          {Array.from({ length: Math.max(0, lines - 1) }).map((_, i) => (
            <Skeleton key={i} width={i % 2 === 0 ? '80%' : '40%'} height={12} />
          ))}
        </View>
      </View>
    </Shell>
  );
}

/** Matches ProviderCard: avatar 52, three text lines, divider, price + button footer. */
export function SkeletonProviderCard() {
  const t = useTheme();
  return (
    <Shell>
      <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
        <Skeleton width={52} height={52} radius={26} />
        <View style={{ flex: 1, gap: 9, paddingTop: 2 }}>
          <Skeleton width="50%" height={16} />
          <Skeleton width="65%" height={12} />
          <Skeleton width="40%" height={12} />
        </View>
      </View>
      <View style={{ height: 1, backgroundColor: t.colors.border }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ gap: 6 }}>
          <Skeleton width={56} height={10} />
          <Skeleton width={72} height={16} />
        </View>
        <Skeleton width={88} height={40} radius={t.radii.md} />
      </View>
    </Shell>
  );
}

/** Matches the bookings list card: category tile, two lines, amount, status row. */
export function SkeletonBookingCard() {
  const t = useTheme();
  return (
    <Shell>
      <View style={{ flexDirection: 'row', gap: t.spacing.md, alignItems: 'center' }}>
        <Skeleton width={44} height={44} radius={t.radii.md} />
        <View style={{ flex: 1, gap: 8 }}>
          <Skeleton width="55%" height={16} />
          <Skeleton width="40%" height={12} />
        </View>
        <Skeleton width={56} height={16} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Skeleton width={96} height={22} radius={t.radii.xs} />
        <Skeleton width={110} height={12} />
      </View>
    </Shell>
  );
}
