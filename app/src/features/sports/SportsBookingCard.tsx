import { View } from 'react-native';
import { Badge, Card, Text, type Tone } from '../../components/ui';
import { formatINR } from '../../lib/money';
import {
  getSportsBookingDeadline,
  getSportsBookingStatusLabel,
  getSportsPaymentSummary,
} from './model';

export interface SportsBookingCardBooking {
  id: string;
  venue_name: string;
  activity_name: string;
  resource_name: string;
  customer_name?: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  price_paise: number;
  total_paise?: number | null;
  payment_mode?: 'online' | 'pay_at_venue' | null;
  paid_at?: string | null;
  participants?: number | null;
  refund_paise?: number | null;
  expires_at?: string | null;
  hold_expires_at?: string | null;
  pay_by?: string | null;
}

export interface SportsBookingCardPresentation {
  statusLabel: string;
  statusTone: Tone;
  timeRange: string;
  amountLabel: string;
  paymentSummary: string;
  participantsLabel: string | null;
  refundLabel: string | null;
  deadlineLabel: string | null;
}

const SPORTS_BOOKING_STATUS_TONES: Record<string, Tone> = {
  pending_payment: 'warning',
  requested: 'primary',
  awaiting_payment: 'warning',
  accepted: 'success',
  declined: 'danger',
  cancelled: 'neutral',
  completed: 'success',
  expired: 'neutral',
};

function formatBookingTime(value: string): string | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function getSportsBookingCardPresentation(
  booking: SportsBookingCardBooking,
): SportsBookingCardPresentation {
  const start = formatBookingTime(booking.starts_at);
  const end = formatBookingTime(booking.ends_at);
  const deadline = getSportsBookingDeadline(booking);
  const refundPaise = booking.refund_paise;
  const participants = booking.participants;

  return {
    statusLabel: getSportsBookingStatusLabel(booking.status),
    statusTone: SPORTS_BOOKING_STATUS_TONES[booking.status] ?? 'neutral',
    timeRange: start && end ? `${start} – ${end}` : start ?? 'Time unavailable',
    amountLabel: formatINR(booking.total_paise ?? booking.price_paise),
    paymentSummary: getSportsPaymentSummary(booking.status, booking.payment_mode, booking.paid_at),
    participantsLabel: Number.isInteger(participants) && (participants ?? 0) > 0
      ? `${participants} participant${participants === 1 ? '' : 's'}`
      : null,
    refundLabel: typeof refundPaise === 'number' && Number.isFinite(refundPaise) && refundPaise > 0
      ? `Refund requested · ${formatINR(refundPaise)}`
      : null,
    deadlineLabel: deadline
      ? `${deadline.label} ${formatBookingTime(deadline.value) ?? ''}`.trim()
      : null,
  };
}

export function SportsBookingCard({
  booking,
  onPress,
  showCustomer = false,
}: {
  booking: SportsBookingCardBooking;
  onPress?: () => void;
  showCustomer?: boolean;
}) {
  const presentation = getSportsBookingCardPresentation(booking);

  return (
    <Card
      gap={8}
      onPress={onPress}
      accessibilityLabel={`View sports booking for ${booking.venue_name}, ${booking.activity_name}, ${booking.resource_name}, ${presentation.timeRange}`}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text variant="bodyStrong" style={{ flex: 1 }}>{booking.venue_name}</Text>
        <Badge label={presentation.statusLabel} tone={presentation.statusTone} />
      </View>
      <Text variant="footnote" color="muted">{booking.activity_name} · {booking.resource_name}</Text>
      {showCustomer && booking.customer_name ? (
        <Text variant="footnote">Customer · {booking.customer_name}</Text>
      ) : null}
      <Text variant="footnote">{presentation.timeRange}</Text>
      <Text variant="footnote">
        {presentation.participantsLabel ? `${presentation.participantsLabel} · ` : ''}
        {presentation.amountLabel} · {presentation.paymentSummary}
      </Text>
      {presentation.refundLabel ? (
        <Text variant="caption" color="muted">{presentation.refundLabel}</Text>
      ) : null}
      {presentation.deadlineLabel ? (
        <Text variant="caption" color="muted">{presentation.deadlineLabel}</Text>
      ) : null}
    </Card>
  );
}
