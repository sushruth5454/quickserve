import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import type { BookingEvent, BookingStatus } from '../lib/types';
import { useTheme } from '../theme';
import { statusLabel, statusTone } from './status';
import { Text, toneColors } from './ui';

const FLOW: { status: BookingStatus; label: string; hint: string }[] = [
  { status: 'requested', label: 'Booked', hint: 'Visit fee paid — waiting for the provider to accept' },
  { status: 'accepted', label: 'Accepted', hint: 'Provider confirmed your booking' },
  { status: 'en_route', label: 'On the way', hint: 'Share the start code when they arrive' },
  { status: 'inspecting', label: 'Inspecting', hint: 'Provider is checking the problem' },
  { status: 'quote_sent', label: 'Quote ready', hint: 'Review and approve the itemised quote' },
  { status: 'awaiting_payment', label: 'Payment', hint: 'Pay the balance to start work' },
  { status: 'in_progress', label: 'Work in progress', hint: 'Your money is held until completion' },
  { status: 'completion_requested', label: 'Check the work', hint: 'Share the completion code if satisfied' },
  { status: 'completed', label: 'Completed', hint: 'Thanks for using QuickServe' },
];

const SIDE_ICON: Partial<Record<BookingStatus, keyof typeof Ionicons.glyphMap>> = {
  pending_payment: 'card-outline',
  declined: 'close-circle-outline',
  expired: 'time-outline',
  cancelled: 'ban-outline',
  closed_no_work: 'document-text-outline',
  disputed: 'alert-circle-outline',
  refunded: 'return-down-back-outline',
};

const dayKey = (iso: string) => new Date(iso).toDateString();
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const fmtDayTime = (iso: string) => `${fmtDay(iso)}, ${fmtTime(iso)}`;

/** Position of a status in the happy-path flow (−1 for side states). */
export function flowIndex(status: BookingStatus): number {
  const effective: BookingStatus = status === 'closed' ? 'completed' : status;
  return FLOW.findIndex((s) => s.status === effective);
}

export const FLOW_LENGTH = FLOW.length;

export function flowLabel(status: BookingStatus): string | undefined {
  const i = flowIndex(status);
  return i >= 0 ? FLOW[i]?.label : undefined;
}

/**
 * Booking progress. Collapsed by default: a "n steps done" summary, the active step (with its hint) and the next
 * step. Completed bookings collapse to a single row. Times show the date only when it differs from the first event.
 */
export function StatusTimeline({ status, events = [] }: { status: BookingStatus; events?: BookingEvent[] }) {
  const t = useTheme();
  const [expanded, setExpanded] = useState(false);
  const side = SIDE_ICON[status];
  if (side) {
    const c = toneColors(t.colors, statusTone[status]);
    return (
      <View
        accessibilityRole="summary"
        style={{ flexDirection: 'row', gap: t.spacing.md, alignItems: 'center', padding: t.spacing.md, borderRadius: t.radii.md, backgroundColor: c.bg }}
      >
        <Ionicons name={side} size={20} color={c.fg} />
        <Text variant="calloutStrong" style={{ color: c.fg, flex: 1 }}>
          {statusLabel[status]}
        </Text>
      </View>
    );
  }
  const current = flowIndex(status);
  const completed = FLOW[current]?.status === 'completed';
  const reachedAt = (s: BookingStatus) => [...events].reverse().find((e) => e.to_status === s)?.at;
  const firstDay = events[0]?.at ? dayKey(events[0].at) : null;
  const stamp = (iso: string) => (firstDay && dayKey(iso) === firstDay ? fmtTime(iso) : fmtDayTime(iso));

  const toggle = (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={() => setExpanded((e) => !e)}
      hitSlop={8}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 32, opacity: pressed ? 0.6 : 1 })}
    >
      <Text variant="subheadStrong" color="primaryText">
        {expanded ? 'Show less' : completed ? 'View timeline' : 'View all'}
      </Text>
      <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={t.colors.primaryText} />
    </Pressable>
  );

  if (!expanded && completed) {
    const at = reachedAt('completed');
    return (
      <View accessibilityRole="summary" style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
        <Dot done active={false} />
        <View style={{ flex: 1 }}>
          <Text variant="calloutStrong">Completed</Text>
          {at ? (
            <Text variant="footnote" color="muted">
              {fmtDayTime(at)}
            </Text>
          ) : null}
        </View>
        {toggle}
      </View>
    );
  }

  const visible = expanded
    ? FLOW.map((s, i) => ({ s, i }))
    : FLOW.map((s, i) => ({ s, i })).filter(({ i }) => i === current || i === current + 1);
  const doneCount = Math.max(0, current);

  return (
    <View accessibilityRole="summary" accessibilityLabel={`Status: ${statusLabel[status]}`} style={{ gap: t.spacing.sm }}>
      {!expanded ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.sm }}>
          <Text variant="footnote" color="muted" style={{ flex: 1 }}>
            {doneCount > 0
              ? `${doneCount} step${doneCount === 1 ? '' : 's'} done${events[0]?.at ? ` · since ${fmtDay(events[0].at)}` : ''}`
              : `Step 1 of ${FLOW.length}`}
          </Text>
          {toggle}
        </View>
      ) : null}
      <View>
        {visible.map(({ s: step, i }, idx) => {
          const done = i < current || (i === current && completed);
          const active = i === current && !done;
          const at = done || active ? reachedAt(step.status) : undefined;
          const last = idx === visible.length - 1;
          return (
            <Animated.View key={step.status} entering={FadeIn.duration(180)} style={{ flexDirection: 'row', gap: t.spacing.md }}>
              <View style={{ alignItems: 'center', width: 20 }}>
                <Dot done={done} active={active} />
                {!last ? <View style={{ flex: 1, width: 2, marginVertical: 2, borderRadius: 1, backgroundColor: i < current ? t.colors.primary : t.colors.border }} /> : null}
              </View>
              <View style={{ flex: 1, paddingBottom: last ? 0 : t.spacing.md, minHeight: last ? 0 : 36 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: t.spacing.sm, minHeight: 20 }}>
                  <Text
                    variant={active ? 'calloutStrong' : 'callout'}
                    color={active ? 'text' : done ? 'textSecondary' : 'muted'}
                    style={{ flexShrink: 1 }}
                  >
                    {step.label}
                  </Text>
                  {at ? (
                    <Text variant="caption" color="muted" tabular>
                      {stamp(at)}
                    </Text>
                  ) : null}
                </View>
                {active ? (
                  <Text variant="footnote" color="muted" style={{ marginTop: 2 }}>
                    {step.hint}
                  </Text>
                ) : null}
              </View>
            </Animated.View>
          );
        })}
      </View>
      {expanded ? <View style={{ alignItems: 'flex-start' }}>{toggle}</View> : null}
    </View>
  );
}

function Dot({ done, active }: { done: boolean; active: boolean }) {
  const t = useTheme();
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (active && !reduceMotion) pulse.value = withRepeat(withTiming(1, { duration: 1400 }), -1, false);
  }, [active, pulse, reduceMotion]);
  const ring = useAnimatedStyle(() => ({
    opacity: active ? 0.35 * (1 - pulse.value) : 0,
    transform: [{ scale: 1 + pulse.value * 0.9 }],
  }));
  return (
    <View style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ position: 'absolute', width: 20, height: 20, borderRadius: 10, backgroundColor: t.colors.primary }, ring]} />
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: done || active ? t.colors.primary : t.colors.surface,
          borderWidth: done || active ? 0 : 1.5,
          borderColor: t.colors.outline,
        }}
      >
        {done ? <Ionicons name="checkmark" size={12} color="#FFFFFF" /> : null}
        {active ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFFFFF' }} /> : null}
      </View>
    </View>
  );
}

/** Compact progress for list rows: one 4pt bar plus "Step n of 9 · label". */
export function ProgressBar({ status, showLabel = true }: { status: BookingStatus; showLabel?: boolean }) {
  const t = useTheme();
  const current = flowIndex(status);
  if (current < 0) return null;
  const pct = (current + 1) / FLOW.length;
  return (
    <View style={{ gap: 6 }} accessible accessibilityLabel={`Step ${current + 1} of ${FLOW.length}: ${FLOW[current]?.label ?? ''}`}>
      <View style={{ height: 4, borderRadius: 2, backgroundColor: t.colors.border, overflow: 'hidden' }}>
        <View style={{ width: `${pct * 100}%`, height: 4, borderRadius: 2, backgroundColor: t.colors.primary }} />
      </View>
      {showLabel ? (
        <Text variant="caption" color="muted">
          Step {current + 1} of {FLOW.length} · {FLOW[current]?.label}
        </Text>
      ) : null}
    </View>
  );
}
