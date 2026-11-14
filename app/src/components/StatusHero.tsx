import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import type { BookingEvent, BookingStatus } from '../lib/types';
import { useTheme } from '../theme';
import { StatusPill } from './status';
import { StatusTimeline } from './StatusTimeline';
import { Card, Text } from './ui';

const STEPS = ['Booked', 'Accepted', 'Arrived', 'Quote', 'Work', 'Done'] as const;

/** Index of the step currently in play (−1 = not on the happy path, e.g. cancelled). Done = all steps complete. */
export function stepIndex(status: BookingStatus): number {
  switch (status) {
    case 'pending_payment':
    case 'requested':
      return 0;
    case 'accepted':
    case 'en_route':
      return 2;
    case 'inspecting':
    case 'quote_sent':
    case 'awaiting_payment':
      return 3;
    case 'in_progress':
    case 'completion_requested':
      return 4;
    case 'completed':
    case 'closed':
      return STEPS.length;
    default:
      return -1;
  }
}

/** Steps strictly before `current` are done. "accepted" counts the Accepted step as done (current = Arrived). */
function doneCount(status: BookingStatus): number {
  if (status === 'pending_payment') return 0;
  if (status === 'requested') return 1;
  return stepIndex(status);
}

export interface HeroCopy {
  title: string;
  subtitle?: string;
}

/** Compact horizontal stepper: Booked → Accepted → Arrived → Quote → Work → Done. */
export function MiniStepper({ status }: { status: BookingStatus }) {
  const t = useTheme();
  const done = doneCount(status);
  const all = done >= STEPS.length;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={all ? 'All steps done' : `Step ${Math.min(done + 1, STEPS.length)} of ${STEPS.length}: ${STEPS[Math.min(done, STEPS.length - 1)]}`}
      style={{ flexDirection: 'row' }}
    >
      {STEPS.map((label, i) => {
        const isDone = i < done;
        const isCurrent = i === done && !all;
        const color = isDone || isCurrent ? t.colors.primary : t.colors.outline;
        return (
          <View key={label} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' }}>
              <View style={{ flex: 1, height: 2, backgroundColor: i === 0 ? 'transparent' : i <= done ? t.colors.primary : t.colors.border }} />
              <View
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 9,
                  borderWidth: isDone ? 0 : 2,
                  borderColor: color,
                  backgroundColor: isDone ? t.colors.primary : t.colors.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {isDone ? <Ionicons name="checkmark" size={12} color={t.colors.onPrimary} /> : null}
                {isCurrent ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: t.colors.primary }} /> : null}
              </View>
              <View
                style={{ flex: 1, height: 2, backgroundColor: i === STEPS.length - 1 ? 'transparent' : i < done ? t.colors.primary : t.colors.border }}
              />
            </View>
            <Text variant="micro" color={isCurrent ? 'primaryText' : isDone ? 'textSecondary' : 'muted'} numberOfLines={1}>
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** Status-first hero: pill, plain-language title + subtitle, compact stepper, collapsible full timeline. */
export function StatusHero({ status, copy, events }: { status: BookingStatus; copy: HeroCopy; events: BookingEvent[] }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const onPath = stepIndex(status) >= 0;
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
      {onPath ? <MiniStepper status={status} /> : null}
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
              <StatusTimeline status={status} events={events} initiallyExpanded />
            </Animated.View>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}
