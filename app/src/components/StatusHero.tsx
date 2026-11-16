import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import type { BookingArchetype, BookingEvent, BookingStatus } from '../lib/types';
import { useTheme } from '../theme';
import { StatusPill } from './status';
import { StatusTimeline } from './StatusTimeline';
import { stepperModel } from '../lib/bookingSteps';
import { Card, Text } from './ui';

export interface HeroCopy {
  title: string;
  subtitle?: string;
}

/** Compact horizontal stepper. The step matching the current status is the filled ring; side states end in a marker. */
export function MiniStepper({ status, history = [], archetype }: { status: BookingStatus; history?: BookingStatus[]; archetype?: BookingArchetype | null }) {
  const t = useTheme();
  const model = stepperModel(status, history, archetype);
  const n = model.steps.length;
  const endColor = model.endTone === 'danger' ? t.colors.danger : t.colors.muted;
  const current = model.steps.find((s) => s.state === 'current' || s.state === 'end');
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={current ? `Current step: ${current.label}` : 'All steps done'}
      style={{ flexDirection: 'row' }}
    >
      {model.steps.map((step, i) => {
        const done = step.state === 'done';
        const ring = step.state === 'current' ? t.colors.primary : step.state === 'end' ? endColor : done ? t.colors.primary : t.colors.outline;
        // A connector is "filled" when the step it leads into has been reached.
        const leftFilled = step.state !== 'todo';
        const rightFilled = model.steps[i + 1] ? model.steps[i + 1]!.state !== 'todo' : false;
        const lineColor = (filled: boolean, toEnd: boolean) => (filled ? (toEnd ? endColor : t.colors.primary) : t.colors.border);
        return (
          <View key={`${step.label}-${i}`} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' }}>
              <View style={{ flex: 1, height: 2, backgroundColor: i === 0 ? 'transparent' : lineColor(leftFilled, step.state === 'end') }} />
              <View
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  borderWidth: done || step.state === 'end' ? 0 : 2,
                  borderColor: ring,
                  backgroundColor: done ? t.colors.primary : step.state === 'end' ? endColor : t.colors.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {done ? <Ionicons name="checkmark" size={12} color={t.colors.onPrimary} /> : null}
                {step.state === 'end' ? <Ionicons name={model.endTone === 'danger' ? 'alert' : 'close'} size={12} color="#FFFFFF" /> : null}
                {step.state === 'current' ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.colors.primary }} /> : null}
              </View>
              <View
                style={{
                  flex: 1,
                  height: 2,
                  backgroundColor: i === n - 1 ? 'transparent' : lineColor(rightFilled, model.steps[i + 1]?.state === 'end'),
                }}
              />
            </View>
            <Text
              variant="micro"
              style={step.state === 'current' || step.state === 'end' ? { fontFamily: t.fontFamily.semibold } : undefined}
              color={step.state === 'current' ? 'primaryText' : step.state === 'end' ? (model.endTone === 'danger' ? 'dangerText' : 'textSecondary') : done ? 'textSecondary' : 'muted'}
              numberOfLines={1}
            >
              {step.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
/** Status-first hero: pill, plain-language title + subtitle, compact stepper, collapsible full timeline. */
export function StatusHero({ status, copy, events, archetype }: { status: BookingStatus; copy: HeroCopy; events: BookingEvent[]; archetype?: BookingArchetype | null }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const history = events.map((e) => e.to_status);
  return (
    <Card variant="elevated" gap={t.spacing.lg}>
      <View style={{ gap: t.spacing.sm }}>
        <StatusPill status={status} />
        <Text variant="title2" accessibilityRole="header">
          {copy.title}
        </Text>
        {copy.subtitle ? (
          <Text variant="callout" color="textSecondary">
            {copy.subtitle}
          </Text>
        ) : null}
      </View>
      <MiniStepper status={status} history={history} archetype={archetype} />
      {events.length > 0 ? (
        <View style={{ gap: t.spacing.md }}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            onPress={() => setOpen((o) => !o)}
            hitSlop={8}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}
          >
            <Text variant="subheadStrong" color="primaryText">
              {open ? 'Hide timeline' : 'View timeline'}
            </Text>
            <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={t.colors.primaryText} />
          </Pressable>
          {open ? (
            <Animated.View entering={FadeIn.duration(200)}>
              <StatusTimeline status={status} events={events} initiallyExpanded archetype={archetype} />
            </Animated.View>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}
