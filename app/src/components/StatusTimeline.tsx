import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  FadeInLeft,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
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

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function StatusTimeline({ status, events = [] }: { status: BookingStatus; events?: BookingEvent[] }) {
  const t = useTheme();
  const side = SIDE_ICON[status];
  if (side) {
    const c = toneColors(t.colors, statusTone[status]);
    return (
      <View
        accessibilityRole="summary"
        style={{
          flexDirection: 'row',
          gap: t.spacing.md,
          alignItems: 'center',
          padding: t.spacing.md,
          borderRadius: t.radii.md,
          backgroundColor: c.bg,
        }}
      >
        <Ionicons name={side} size={22} color={c.fg} />
        <Text variant="bodyStrong" style={{ color: c.fg, flex: 1 }}>
          {statusLabel[status]}
        </Text>
      </View>
    );
  }
  const effective: BookingStatus = status === 'closed' ? 'completed' : status;
  const current = FLOW.findIndex((s) => s.status === effective);
  const reachedAt = (s: BookingStatus) => [...events].reverse().find((e) => e.to_status === s)?.at;

  return (
    <View accessibilityRole="summary" accessibilityLabel={`Status: ${statusLabel[status]}`}>
      {FLOW.map((step, i) => {
        const done = i < current || (i === current && effective === 'completed');
        const active = i === current && !done;
        const at = done || active ? reachedAt(step.status) : undefined;
        const last = i === FLOW.length - 1;
        return (
          <Animated.View
            key={step.status}
            entering={FadeInLeft.delay(i * 40).duration(260)}
            style={{ flexDirection: 'row', gap: t.spacing.md }}
          >
            <View style={{ alignItems: 'center', width: 22 }}>
              <Dot done={done} active={active} />
              {!last ? <Connector filled={i < current} delay={i * 60} /> : null}
            </View>
            <View style={{ flex: 1, paddingBottom: last ? 0 : t.spacing.md, minHeight: last ? 0 : 40 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: t.spacing.sm, minHeight: 22 }}>
                <Text
                  variant={active ? 'bodyStrong' : 'callout'}
                  color={active ? 'primary' : done ? 'text' : 'subtle'}
                  style={{ flexShrink: 1 }}
                >
                  {step.label}
                </Text>
                {at ? (
                  <Text variant="caption" color="muted">
                    {fmtTime(at)}
                  </Text>
                ) : null}
              </View>
              {active ? (
                <Text variant="caption" color="muted">
                  {step.hint}
                </Text>
              ) : null}
            </View>
          </Animated.View>
        );
      })}
    </View>
  );
}

function Dot({ done, active }: { done: boolean; active: boolean }) {
  const t = useTheme();
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (active) pulse.value = withRepeat(withTiming(1, { duration: 1400 }), -1, false);
  }, [active, pulse]);
  const ring = useAnimatedStyle(() => ({
    opacity: active ? 0.4 * (1 - pulse.value) : 0,
    transform: [{ scale: 1 + pulse.value * 0.9 }],
  }));
  return (
    <View style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={[{ position: 'absolute', width: 22, height: 22, borderRadius: 11, backgroundColor: t.colors.primary }, ring]}
      />
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: done ? t.colors.success : active ? t.colors.primary : t.colors.surface,
          borderWidth: done || active ? 0 : 2,
          borderColor: t.colors.borderStrong,
        }}
      >
        {done ? <Ionicons name="checkmark" size={13} color="#FFFFFF" /> : null}
        {active ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFFFFF' }} /> : null}
      </View>
    </View>
  );
}

function Connector({ filled, delay }: { filled: boolean; delay: number }) {
  const t = useTheme();
  const h = useSharedValue(0);
  useEffect(() => {
    h.value = withDelay(delay, withTiming(filled ? 1 : 0, { duration: 380 }));
  }, [filled, delay, h]);
  const fill = useAnimatedStyle(() => ({ height: `${h.value * 100}%` }));
  return (
    <View style={{ flex: 1, width: 2, marginVertical: 3, borderRadius: 1, backgroundColor: t.colors.border, overflow: 'hidden' }}>
      <Animated.View style={[{ width: 2, backgroundColor: t.colors.success }, fill]} />
    </View>
  );
}

/** Compact segmented progress bar for list rows. */
export function ProgressBar({ status }: { status: BookingStatus }) {
  const t = useTheme();
  const effective: BookingStatus = status === 'closed' ? 'completed' : status;
  const current = FLOW.findIndex((s) => s.status === effective);
  if (current < 0) return null;
  return (
    <View style={{ flexDirection: 'row', gap: 3 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {FLOW.map((s, i) => (
        <View
          key={s.status}
          style={{
            flex: 1,
            height: 4,
            borderRadius: 2,
            backgroundColor:
              i < current || effective === 'completed' ? t.colors.success : i === current ? t.colors.primary : t.colors.border,
          }}
        />
      ))}
    </View>
  );
}
