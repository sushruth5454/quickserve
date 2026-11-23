import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { haptics } from '../../lib/haptics';
import { useTheme } from '../../theme';
import type { IconName } from './Button';
import { Text } from './Text';

interface Option<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  badge?: number;
}

interface Props<T extends string> {
  /** Up to 3 options; use chips for 4 or more. */
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export function SegmentedControl<T extends string>({ options, value, onChange, style, accessibilityLabel }: Props<T>) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const segment = width > 0 ? (width - 6) / options.length : 0;
  const x = useSharedValue(0);

  useEffect(() => {
    x.value = withSpring(index * segment, t.motion.spring);
  }, [index, segment, x, t.motion.spring]);

  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={[
        {
          flexDirection: 'row',
          backgroundColor: t.colors.surfaceAlt,
          borderRadius: t.radii.md,
          padding: 3,
          minHeight: 44,
        },
        style,
      ]}
    >
      {segment > 0 ? (
        <Animated.View
          style={[
            {
              position: 'absolute',
              top: 3,
              bottom: 3,
              left: 3,
              width: segment,
              borderRadius: t.radii.sm,
              backgroundColor: t.colors.segmentThumb,
            },
            t.shadows.sm,
            thumb,
          ]}
        />
      ) : null}
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={o.label}
            onPress={() => {
              if (!selected) haptics.select();
              onChange(o.value);
            }}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, minHeight: 38, paddingHorizontal: 6 }}
          >
            {o.icon ? <Ionicons name={o.icon} size={16} color={selected ? t.colors.text : t.colors.muted} /> : null}
            <Text
              variant={selected ? 'subheadStrong' : 'subhead'}
              color={selected ? 'text' : 'muted'}
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}
              style={{ flexShrink: 1 }}
            >
              {o.label}
            </Text>
            {o.badge ? (
              <View
                style={{
                  minWidth: 18,
                  height: 18,
                  paddingHorizontal: 5,
                  borderRadius: 9,
                  backgroundColor: selected ? t.colors.primary : t.colors.surfaceAlt,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text variant="micro" style={{ color: selected ? t.colors.onPrimary : t.colors.textSecondary }}>
                  {o.badge}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
