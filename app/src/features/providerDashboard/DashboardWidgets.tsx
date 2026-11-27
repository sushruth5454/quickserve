import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Switch, View, Pressable } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Card, Text } from '../../components/ui';
import type { BookingStatus, ProviderJob } from '../../lib/types';
import { useTheme } from '../../theme';

export type IconName = keyof typeof Ionicons.glyphMap;

type NextStep = { label: string; icon: IconName; primary: boolean };
type PrimaryJobAction = 'start_trip' | 'quote' | 'booking_detail';

export const ACTIVE_PRIORITY: BookingStatus[] = [
  'en_route',
  'completion_requested',
  'confirmed',
  'delivery_pending',
  'inspecting',
  'in_progress',
  'accepted',
  'awaiting_payment',
  'quote_sent',
  'disputed',
];

export const NEXT_STEP: Partial<Record<BookingStatus, NextStep>> = {
  accepted: { label: 'Start trip', icon: 'navigate', primary: true },
  en_route: { label: 'Enter start code', icon: 'keypad-outline', primary: true },
  inspecting: { label: 'Send quote', icon: 'receipt-outline', primary: true },
  quote_sent: { label: 'Awaiting approval', icon: 'hourglass-outline', primary: false },
  awaiting_payment: { label: 'Awaiting payment', icon: 'hourglass-outline', primary: false },
  in_progress: { label: 'Mark complete', icon: 'checkmark-done', primary: true },
  confirmed: { label: 'View job', icon: 'eye-outline', primary: true },
  delivery_pending: { label: 'View delivery', icon: 'eye-outline', primary: true },
  completion_requested: { label: 'Enter completion code', icon: 'keypad-outline', primary: true },
  disputed: { label: 'On hold · view', icon: 'alert-circle-outline', primary: false },
};

export const RESPONSE_WINDOW_MS = 15 * 60 * 1000;

export function getRequestActionState(
  job: Pick<ProviderJob, 'request_expires_at' | 'recurring_schedule_id' | 'can_accept' | 'can_decline'>,
  now: number,
) {
  const deadline = job.request_expires_at == null ? null : Date.parse(job.request_expires_at);
  const leftMs = deadline == null || !Number.isFinite(deadline) ? null : Math.max(0, deadline - now);
  const recurring = job.recurring_schedule_id != null;
  const deadlineIsValid = leftMs !== null && leftMs > 0;
  return {
    leftMs,
    canAccept: job.can_accept === true && (recurring || deadlineIsValid),
    canDecline: job.can_decline === true,
  };
}

export function getNextStep(job: Pick<ProviderJob, 'status' | 'archetype'>): NextStep | undefined {
  if (job.archetype === 'time_based' && job.status === 'accepted') {
    return { label: 'Enter session start code', icon: 'keypad-outline', primary: true };
  }
  if (job.archetype === 'proposal' && job.status === 'confirmed') {
    return { label: 'Enter start code', icon: 'keypad-outline', primary: true };
  }
  if (job.archetype === 'proposal' && job.status === 'delivery_pending') {
    return { label: 'Submit delivery', icon: 'checkmark-done', primary: true };
  }
  if (job.archetype === 'proposal' && job.status === 'in_progress') {
    return { label: 'Manage deliverables', icon: 'albums-outline', primary: true };
  }
  return NEXT_STEP[job.status];
}

export function getPrimaryJobAction(job: Pick<ProviderJob, 'status' | 'archetype'>): PrimaryJobAction {
  if (
    job.status === 'accepted'
    && (job.archetype === 'fixed' || job.archetype === 'inspect_quote')
  ) {
    return 'start_trip';
  }
  if (job.status === 'inspecting') return 'quote';
  return 'booking_detail';
}

export function isActiveProviderJob(job: Pick<ProviderJob, 'status' | 'archetype'>): boolean {
  if (!ACTIVE_PRIORITY.includes(job.status)) return false;
  return (job.status !== 'confirmed' && job.status !== 'delivery_pending') || job.archetype === 'proposal';
}

export function OnlineCard({ online, radiusKm, onChange, disabled }: { online: boolean; radiusKm: number | null; onChange: (v: boolean) => void; disabled: boolean }) {
  const t = useTheme();
  /** react-native-web paints the ON thumb teal unless activeThumbColor is set (not in the RN types). */
  const webSwitchThumb = { activeThumbColor: t.colors.onPrimary } as object;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.spacing.md,
        padding: t.spacing.lg,
        borderRadius: t.radii.lg,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: online ? t.colors.success : t.colors.border,
        backgroundColor: online ? t.colors.successSoft : t.colors.surface,
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          backgroundColor: online ? t.colors.success : t.colors.surfaceAlt,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={online ? 'radio' : 'moon-outline'} size={20} color={online ? t.colors.onPrimary : t.colors.textSecondary} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="calloutStrong" color={online ? 'successText' : 'text'}>
          {online ? "You're online" : "You're offline"}
        </Text>
        <Text variant="footnote" color={online ? 'successText' : 'muted'}>
          {online
            ? `Receiving requests${radiusKm ? ` within ${radiusKm} km` : ''}`
            : "Customers can't book you right now"}
        </Text>
      </View>
      <Switch
        value={online}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: t.colors.success, false: t.colors.outline }}
        thumbColor={t.colors.onPrimary}
        {...webSwitchThumb}
        accessibilityLabel={online ? 'Online. Turn off to stop receiving requests' : 'Offline. Turn on to receive requests'}
      />
    </View>
  );
}
export function StatsStrip({ items }: { items: { label: string; value: string; icon?: IconName; onPress?: () => void }[] }) {
  const t = useTheme();
  return (
    <Card padding={0} gap={0} style={{ flexDirection: 'row' }}>
      {items.map((it, i) => (
        <Pressable
          key={it.label}
          disabled={!it.onPress}
          onPress={it.onPress}
          accessibilityRole={it.onPress ? 'button' : 'text'}
          accessibilityLabel={`${it.label}: ${it.value}`}
          style={({ pressed }) => ({
            flex: 1,
            paddingVertical: t.spacing.md,
            paddingHorizontal: t.spacing.sm,
            alignItems: 'center',
            gap: 2,
            borderLeftWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
            borderLeftColor: t.colors.border,
            backgroundColor: pressed ? t.colors.surfaceAlt : 'transparent',
          })}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            {it.icon ? <Ionicons name={it.icon} size={13} color={t.colors.star} /> : null}
            <Text variant="calloutStrong" tabular numberOfLines={1} adjustsFontSizeToFit>
              {it.value}
            </Text>
          </View>
          <Text variant="caption" color="muted" numberOfLines={1}>
            {it.label}
          </Text>
        </Pressable>
      ))}
    </Card>
  );
}

export function CountdownRing({ leftMs }: { leftMs: number }) {
  const t = useTheme();
  const size = 52;
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, leftMs / RESPONSE_WINDOW_MS));
  const urgent = leftMs < 3 * 60 * 1000;
  const color = leftMs <= 0 ? t.colors.outline : urgent ? t.colors.danger : t.colors.warning;
  const mm = Math.floor(leftMs / 60000);
  const ss = Math.floor((leftMs % 60000) / 1000);
  return (
    <View
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      accessible
      accessibilityLabel={leftMs > 0 ? `${mm} minutes ${ss} seconds left to accept` : 'Expired'}
    >
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={t.colors.border} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={c * (1 - frac)}
        />
      </Svg>
      <Text variant="captionStrong" color={urgent ? 'dangerText' : 'text'} tabular maxFontSizeMultiplier={1}>
        {leftMs > 0 ? `${mm}:${String(ss).padStart(2, '0')}` : '0:00'}
      </Text>
    </View>
  );
}
