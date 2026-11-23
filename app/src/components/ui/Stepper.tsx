import { Ionicons } from '@expo/vector-icons';
import { Fragment, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, useReducedMotion, withTiming } from 'react-native-reanimated';
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

/** Quantity stepper: one outlined control [−  value  +] with 44pt buttons. */
export function Stepper({ value, onChange, min = 0, max = 999, step = 1, label = 'Quantity' }: StepperProps) {
  const t = useTheme();
  const btn = (icon: 'remove' | 'add', disabled: boolean, next: number) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${icon === 'add' ? 'Increase' : 'Decrease'} ${label.toLowerCase()}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={2}
      onPress={() => {
        haptics.select();
        onChange(next);
      }}
      style={({ pressed }) => ({
        width: 44,
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? t.colors.surfaceAlt : 'transparent',
      })}
    >
      <Ionicons name={icon} size={20} color={disabled ? t.colors.subtle : t.colors.primaryText} />
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
        minHeight: 48,
        paddingVertical: 2,
        backgroundColor: t.colors.surface,
        borderRadius: t.radii.md,
        borderWidth: 1,
        borderColor: t.colors.outline,
        alignSelf: 'flex-start',
      }}
    >
      {btn('remove', value - step < min, Math.max(min, +(value - step).toFixed(2)))}
      <Text variant="title3" tabular style={{ minWidth: 40, textAlign: 'center' }} critical>
        {value}
      </Text>
      {btn('add', value + step > max, Math.min(max, +(value + step).toFixed(2)))}
    </View>
  );
}

/** Horizontal wizard progress: numbered dots joined by a filling rail (single accent). */
export function StepIndicator({ steps, current }: { steps: string[]; current: number }) {
  const t = useTheme();
  const [width, setWidth] = useState(0);
  const reduceMotion = useReducedMotion();
  const compact = steps.length > 4 || (width > 0 && width < steps.length * 88);
  const stepDescription = steps.join(', ');
  const progressLabel = `Step ${current + 1} of ${steps.length}: ${steps[current] ?? ''}. Steps: ${stepDescription}`;

  if (compact) {
    const progress = steps.length ? ((current + 1) / steps.length) * 100 : 0;
    return (
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={progressLabel}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={{ alignSelf: 'stretch', flexDirection: 'column', gap: 8 }}
      >
        <View style={{ height: 4, borderRadius: 2, backgroundColor: t.colors.border, overflow: 'hidden' }}>
          <View style={{ width: `${progress}%`, height: 4, borderRadius: 2, backgroundColor: t.colors.primary }} />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 8 }}>
          <Text variant="captionStrong" critical>
            Step {current + 1} of {steps.length}
          </Text>
          <Text variant="subhead" style={{ flex: 1, minWidth: 0 }} critical>
            {steps[current] ?? ''}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={progressLabel}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ flexDirection: 'row', alignItems: 'flex-start', alignSelf: 'stretch', width: '100%' }}
    >
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <Fragment key={label}>
            <View style={{ flex: 1, minWidth: 0, alignItems: 'center', gap: 6 }}>
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: done || active ? t.colors.primary : t.colors.surface,
                  borderWidth: done || active ? 0 : 1.5,
                  borderColor: t.colors.outline,
                }}
              >
                {done ? (
                  <Ionicons name="checkmark" size={14} color={t.colors.onPrimary} />
                ) : (
                  <Text variant="captionStrong" style={{ color: active ? t.colors.onPrimary : t.colors.muted }} critical>
                    {i + 1}
                  </Text>
                )}
              </View>
              <Text
                variant={active ? 'captionStrong' : 'caption'}
                color={active ? 'text' : 'muted'}
                align="center"
                style={{ maxWidth: '100%', flexShrink: 1 }}
                critical
              >
                {label}
              </Text>
            </View>
            {i < steps.length - 1 ? <Rail filled={i < current} reduceMotion={reduceMotion} /> : null}
          </Fragment>
        );
      })}
    </View>
  );
}

function Rail({ filled, reduceMotion }: { filled: boolean; reduceMotion: boolean }) {
  const t = useTheme();
  const p = useDerivedValue(
    () => (reduceMotion ? (filled ? 1 : 0) : withTiming(filled ? 1 : 0, { duration: 300 })),
    [filled, reduceMotion],
  );
  const fill = useAnimatedStyle(() => ({ width: `${p.value * 100}%` }));
  return (
    <View style={{ flex: 0.25, minWidth: 8, height: 2, borderRadius: 1, backgroundColor: t.colors.border, marginTop: 11 }}>
      <Animated.View style={[{ height: 2, borderRadius: 1, backgroundColor: t.colors.primary }, fill]} />
    </View>
  );
}
