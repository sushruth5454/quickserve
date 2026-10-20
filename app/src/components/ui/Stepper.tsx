import { Ionicons } from '@expo/vector-icons';
import { Fragment } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, withTiming } from 'react-native-reanimated';
import { haptics } from '../../lib/haptics';
import { useTheme } from '../../theme';
import { Text } from './Text';

interface StepperProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
}

/** Quantity stepper: [−] value [+] with 44pt buttons. */
export function Stepper({ value, onChange, min = 0, max = 999, step = 1, label = 'Quantity' }: StepperProps) {
  const t = useTheme();
  const btn = (icon: 'remove' | 'add', disabled: boolean, next: number) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${icon === 'add' ? 'Increase' : 'Decrease'} ${label.toLowerCase()}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={4}
      onPress={() => {
        haptics.select();
        onChange(next);
      }}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: t.radii.sm + 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? t.colors.primarySoft : t.colors.surface,
        opacity: disabled ? 0.35 : 1,
      })}
    >
      <Ionicons name={icon} size={20} color={t.colors.primary} />
    </Pressable>
  );
  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel={`${label} ${value}`}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'increment' && value + step <= max) onChange(value + step);
        if (e.nativeEvent.actionName === 'decrement' && value - step >= min) onChange(value - step);
      }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: t.colors.surfaceAlt,
        borderRadius: t.radii.md,
        padding: 2,
        gap: 2,
        alignSelf: 'flex-start',
      }}
    >
      {btn('remove', value - step < min, Math.max(min, +(value - step).toFixed(2)))}
      <Text variant="bodyStrong" tabular style={{ minWidth: 32, textAlign: 'center' }}>
        {value}
      </Text>
      {btn('add', value + step > max, Math.min(max, +(value + step).toFixed(2)))}
    </View>
  );
}

/** Horizontal wizard progress: numbered dots joined by a filling rail. */
export function StepIndicator({ steps, current }: { steps: string[]; current: number }) {
  const t = useTheme();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${current + 1} of ${steps.length}: ${steps[current] ?? ''}`}
      style={{ flexDirection: 'row', alignItems: 'flex-start' }}
    >
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <Fragment key={label}>
            <View style={{ alignItems: 'center', gap: 6, width: 72 }}>
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: done ? t.colors.success : active ? t.colors.primary : t.colors.surfaceAlt,
                  borderWidth: active ? 4 : 0,
                  borderColor: t.colors.primarySoft,
                }}
              >
                {done ? (
                  <Ionicons name="checkmark" size={16} color="#FFFFFF" />
                ) : (
                  <Text variant="captionStrong" style={{ color: active ? '#FFFFFF' : t.colors.muted }}>
                    {i + 1}
                  </Text>
                )}
              </View>
              <Text variant="caption" color={active ? 'text' : 'muted'} align="center" numberOfLines={1}>
                {label}
              </Text>
            </View>
            {i < steps.length - 1 ? <Rail filled={i < current} /> : null}
          </Fragment>
        );
      })}
    </View>
  );
}

function Rail({ filled }: { filled: boolean }) {
  const t = useTheme();
  const p = useDerivedValue(() => withTiming(filled ? 1 : 0, { duration: 300 }), [filled]);
  const fill = useAnimatedStyle(() => ({ width: `${p.value * 100}%` }));
  return (
    <View style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: t.colors.border, marginTop: 15, marginHorizontal: -14 }}>
      <Animated.View style={[{ height: 3, borderRadius: 2, backgroundColor: t.colors.success }, fill]} />
    </View>
  );
}
