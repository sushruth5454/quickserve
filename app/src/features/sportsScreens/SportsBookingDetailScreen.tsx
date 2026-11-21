import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, View } from 'react-native';
import { Button, Card, ErrorState, Header, InlineAlert, Input, Screen, Skeleton, Text, useToast } from '../../components/ui';
import { cancelSportsBooking, decideSportsBooking, getCustomerSportsBooking, previewSportsCancellation, type CustomerSportsBookingDetail } from '../sports/api';
import {
  getSportsBookingActions,
  getSportsBookingStatusLabel,
  getSportsCancellationConfirmationMessage,
  getSportsPaymentSummary,
} from '../sports/model';
import { useAuth } from '../../lib/auth';
import { formatINR } from '../../lib/money';
import { useTheme } from '../../theme';

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

function useSportsBookingDetailController() {
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useAuth();
  const [booking, setBooking] = useState<CustomerSportsBookingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const refreshedBoundaries = useRef(new Set<string>());

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

  useEffect(() => {
    refreshedBoundaries.current.clear();
  }, [id]);

  const isOwner = !!booking && booking.owner_id === userId;
  const isCustomer = !!booking && booking.customer_id === userId;
  const actions = useMemo(() => getSportsBookingActions({
    booking,
    viewerId: userId,
    now: new Date(now),
  }), [booking, now, userId]);

  const timeBoundaries = useMemo(() => {
    if (!booking) return [];
    const values = [actions.applicableDeadline];
    if (isCustomer && ['requested', 'pending_payment', 'awaiting_payment', 'accepted'].includes(booking.status)) {
      values.push(booking.starts_at);
    }
    return [...new Set(values.filter((value): value is string => (
      typeof value === 'string' && Number.isFinite(Date.parse(value))
    )))];
  }, [actions.applicableDeadline, booking, isCustomer]);
  const hasFutureBoundary = timeBoundaries.some((value) => Date.parse(value) > now);

  useEffect(() => {
    if (!hasFutureBoundary) return;
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, [hasFutureBoundary]);

  useEffect(() => {
    const expired = timeBoundaries.filter((value) => (
      Date.parse(value) <= now && !refreshedBoundaries.current.has(value)
    ));
    if (expired.length === 0) return;
    expired.forEach((value) => refreshedBoundaries.current.add(value));
    void load();
  }, [load, now, timeBoundaries]);

  const act = useCallback(async (action: () => Promise<void>, message: string) => {
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
  }, [load, toast]);

  const requestCancel = useCallback(async () => {
    if (!booking || busy) return;
    setBusy(true);
    setError(null);
    try {
      const preview = await previewSportsCancellation(booking.id);
      if (!preview.can_cancel) {
        setError('This booking can no longer be cancelled.');
        await load();
        return;
      }
      const message = getSportsCancellationConfirmationMessage(preview.refund_paise);
      if (Platform.OS === 'web') {
        if (!window.confirm(`Cancel this booking? ${message}`)) return;
        await cancelSportsBooking(booking.id, isOwner ? reason.trim() : '');
        toast({ message: 'Booking cancelled', tone: 'success' });
        await load();
      } else {
        Alert.alert('Cancel booking?', message, [
          { text: 'Keep booking', style: 'cancel' },
          {
            text: 'Cancel booking',
            style: 'destructive',
            onPress: () => void act(
              () => cancelSportsBooking(booking.id, isOwner ? reason.trim() : ''),
              'Booking cancelled',
            ),
          },
        ]);
      }
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }, [act, booking, busy, isOwner, load, reason, toast]);

  return {
    actions,
    act,
    booking,
    busy,
    error,
    isOwner,
    load,
    reason,
    requestCancel,
    setReason,
  };
}

export default function SportsBookingDetailScreen() {
  const t = useTheme();
  const {
    actions,
    act,
    booking,
    busy,
    error,
    isOwner,
    load,
    reason,
    requestCancel,
    setReason,
  } = useSportsBookingDetailController();

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
            {actions.applicableDeadline && (actions.deadlineKind === 'request' || !booking.paid_at) ? (
              <Text variant="caption" color="muted">
                {actions.deadlineKind === 'request' ? 'Request expires ' : 'Payment deadline '}
                {slotLabel(actions.applicableDeadline)}
              </Text>
            ) : null}
          </Card>
          {actions.canPay ? (
            <Button
              title={booking.status === 'pending_payment' ? 'Complete payment' : 'Pay now'}
              onPress={() => router.push(`/sports-checkout/${booking.id}` as Href)}
              fullWidth
              leftIcon="lock-closed"
            />
          ) : null}
          {actions.canDecide ? (
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
          {actions.canCancel ? (
            <Card gap={t.spacing.sm}>
              {isOwner ? <Input label="Cancellation reason" value={reason} onChangeText={setReason} maxLength={500} /> : null}
              {booking.payment_mode === 'online' ? (
                <Text variant="caption" color="muted">Any refund is calculated by the server using the applicable cancellation policy.</Text>
              ) : null}
              <Button
                title="Cancel booking"
                variant="ghost"
                onPress={() => void requestCancel()}
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
