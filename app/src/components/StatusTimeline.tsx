import { StyleSheet, Text, View } from 'react-native';
import { colors, font, spacing } from '../lib/theme';
import type { BookingStatus } from '../lib/types';

const FLOW: { status: BookingStatus; label: string }[] = [
  { status: 'requested', label: 'Booked (visit fee paid)' },
  { status: 'accepted', label: 'Accepted by provider' },
  { status: 'en_route', label: 'On the way' },
  { status: 'inspecting', label: 'Arrived & inspecting' },
  { status: 'quote_sent', label: 'Quote sent' },
  { status: 'awaiting_payment', label: 'Quote approved — payment due' },
  { status: 'in_progress', label: 'Work in progress' },
  { status: 'completion_requested', label: 'Completion requested' },
  { status: 'completed', label: 'Completed' },
  { status: 'closed', label: 'Closed (provider paid)' },
];

export const statusLabel: Record<BookingStatus, string> = {
  pending_payment: 'Awaiting visit-fee payment',
  requested: 'Waiting for provider',
  accepted: 'Accepted',
  en_route: 'Provider on the way',
  inspecting: 'Inspecting',
  quote_sent: 'Quote sent',
  awaiting_payment: 'Payment due',
  in_progress: 'In progress',
  completion_requested: 'Completion requested',
  completed: 'Completed',
  closed: 'Closed',
  closed_no_work: 'Closed — quote rejected',
  declined: 'Declined by provider',
  expired: 'Expired (not accepted in time)',
  cancelled: 'Cancelled',
  disputed: 'Under dispute',
  refunded: 'Refunded',
};

export const terminalStatuses: BookingStatus[] = ['closed', 'closed_no_work', 'declined', 'expired', 'cancelled', 'refunded'];

const SIDE: Partial<Record<BookingStatus, string>> = {
  pending_payment: colors.warning,
  declined: colors.danger,
  expired: colors.muted,
  cancelled: colors.muted,
  closed_no_work: colors.muted,
  disputed: colors.danger,
  refunded: colors.muted,
};

export function StatusTimeline({ status }: { status: BookingStatus }) {
  const sideColor = SIDE[status];
  if (sideColor) {
    return (
      <View style={[styles.banner, { borderColor: sideColor }]} accessibilityRole="summary">
        <Text style={[font.heading, { color: sideColor }]}>{statusLabel[status]}</Text>
      </View>
    );
  }
  const current = FLOW.findIndex((s) => s.status === status);
  return (
    <View style={styles.list} accessibilityRole="summary" accessibilityLabel={`Status: ${statusLabel[status]}`}>
      {FLOW.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <View key={step.status} style={styles.row}>
            <View style={styles.rail}>
              <View
                style={[
                  styles.dot,
                  done && { backgroundColor: colors.success, borderColor: colors.success },
                  active && { backgroundColor: colors.primary, borderColor: colors.primary },
                ]}
              />
              {i < FLOW.length - 1 && <View style={[styles.line, done && { backgroundColor: colors.success }]} />}
            </View>
            <Text style={[styles.label, active && styles.activeLabel, !done && !active && { color: colors.muted }]}>
              {step.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 0 },
  row: { flexDirection: 'row', gap: spacing.md, minHeight: 32 },
  rail: { alignItems: 'center', width: 16 },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface },
  line: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2 },
  label: { ...font.body, fontSize: 14, paddingBottom: spacing.sm },
  activeLabel: { fontWeight: '700', color: colors.primary },
  banner: { borderWidth: 1, borderRadius: 12, padding: spacing.md, backgroundColor: colors.surface },
});
