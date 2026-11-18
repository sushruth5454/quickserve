import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, ErrorState, Header, InlineAlert, Input, Screen, Skeleton, Text, useToast } from '../../src/components/ui';
import { cancelSportsBooking, decideSportsBooking, getCustomerSportsBooking, type CustomerSportsBookingDetail } from '../../src/features/sports/api';
import { canContinueSportsCheckout, getSportsBookingStatusLabel, getSportsPaymentSummary } from '../../src/features/sports/model';
import { useAuth } from '../../src/lib/auth';
import { formatINR } from '../../src/lib/money';
import { useTheme } from '../../src/theme';

function slotLabel(value: string) {
  return new Date(value).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function SportsBookingDetailScreen() {
  const t = useTheme();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useAuth();
  const [booking, setBooking] = useState<CustomerSportsBookingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const next = await getCustomerSportsBooking(id);
      setBooking(next);
      setError(next ? null : 'This booking is not available.');
    } catch (caught) {
      setError((caught as Error).message);
    }
  }, [id]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const act = async (action: () => Promise<void>, message: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      toast({ message, tone: 'success' });
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const isOwner = !!booking && booking.owner_id === userId;
  const isCustomer = !!booking && booking.customer_id === userId;
  const cancellableStatus = !!booking && ['requested', 'pending_payment', 'awaiting_payment', 'accepted'].includes(booking.status);
  const canCancel = cancellableStatus && (isOwner || isCustomer);
  const deadline = booking?.status === 'pending_payment'
    ? booking.hold_expires_at ?? booking.expires_at
    : booking?.status === 'awaiting_payment'
      ? booking.pay_by ?? booking.expires_at
      : booking?.expires_at;

  return (
    <Screen header={<Header
      title="Sports booking"
      onBack={() => router.canGoBack() ? router.back() : router.replace('/sports/bookings' as Href)}
    />}>
      {error && !booking ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !booking ? (
        <Skeleton height={250} radius={t.radii.lg} />
      ) : (
        <>
          <Card gap={t.spacing.sm}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
              <Text variant="title3" style={{ flex: 1 }}>{booking.venue_name}</Text>
              <Text variant="captionStrong" color={booking.status === 'accepted' ? 'successText' : 'muted'}>
                {getSportsBookingStatusLabel(booking.status)}
              </Text>
            </View>
            <Text variant="callout">{booking.activity_name} · {booking.resource_name}</Text>
            <Text variant="footnote">{slotLabel(booking.starts_at)} – {new Date(booking.ends_at).toLocaleTimeString('en-IN', {
              timeZone: 'Asia/Kolkata',
              hour: 'numeric',
              minute: '2-digit',
            })}</Text>
            <Text variant="footnote">Participants · {booking.participants ?? 1}</Text>
            <Text variant="bodyStrong">
              {formatINR(booking.total_paise ?? booking.price_paise)} · {getSportsPaymentSummary(booking.status, booking.payment_mode, booking.paid_at)}
            </Text>
            {booking.customer_fee_paise != null ? (
              <Text variant="footnote" color="muted">Customer fee · {formatINR(booking.customer_fee_paise)}</Text>
            ) : null}
            {booking.refund_paise ? (
              <Text variant="footnote" color="successText">Refund · {formatINR(booking.refund_paise)}</Text>
            ) : null}
            {booking.note ? <Text variant="footnote" color="textSecondary">Your note: {booking.note}</Text> : null}
            {booking.decision_reason ? <Text variant="footnote" color="textSecondary">Update: {booking.decision_reason}</Text> : null}
            {isOwner ? <Text variant="footnote" color="muted">Customer: {booking.customer_name || 'QuickServe customer'}</Text> : null}
            {deadline && ['requested', 'pending_payment', 'awaiting_payment'].includes(booking.status) ? (
              <Text variant="caption" color="muted">
                {booking.status === 'requested' ? 'Request expires ' : 'Payment deadline '}{slotLabel(deadline)}
              </Text>
            ) : null}
          </Card>
          {isCustomer && canContinueSportsCheckout(booking.status) ? (
            <Button
              title={booking.status === 'pending_payment' ? 'Complete payment' : 'Pay now'}
              onPress={() => router.push(`/sports-checkout/${booking.id}` as Href)}
              fullWidth
              leftIcon="lock-closed"
            />
          ) : null}
          {isOwner && booking.status === 'requested' ? (
            <Card gap={t.spacing.sm}>
              <Text variant="subheadStrong">Respond to request</Text>
              <Input label="Decline reason (required to decline)" value={reason} onChangeText={setReason} maxLength={500} />
              <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
                <Button
                  title="Accept"
                  onPress={() => void act(() => decideSportsBooking(booking.id, true), 'Request accepted')}
                  loading={busy}
                  style={{ flex: 1 }}
                />
                <Button
                  title="Decline"
                  variant="outline"
                  onPress={() => void act(() => decideSportsBooking(booking.id, false, reason.trim()), 'Request declined')}
                  disabled={busy || reason.trim().length < 3}
                  style={{ flex: 1 }}
                />
              </View>
            </Card>
          ) : null}
          {canCancel ? (
            <Card gap={t.spacing.sm}>
              {isOwner ? <Input label="Cancellation reason" value={reason} onChangeText={setReason} maxLength={500} /> : null}
              {booking.payment_mode === 'online' ? (
                <Text variant="caption" color="muted">Any refund is calculated by the server using the applicable cancellation policy.</Text>
              ) : null}
              <Button
                title="Cancel booking"
                variant="ghost"
                onPress={() => void act(
                  () => cancelSportsBooking(booking.id, isOwner ? reason.trim() : ''),
                  'Booking cancelled',
                )}
                disabled={busy || (isOwner && reason.trim().length < 3)}
              />
            </Card>
          ) : null}
          <InlineAlert message={error} />
        </>
      )}
    </Screen>
  );
}
