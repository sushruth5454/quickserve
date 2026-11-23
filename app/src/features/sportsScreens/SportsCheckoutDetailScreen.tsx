import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, ErrorState, Header, InlineAlert, Screen, Skeleton, Text } from '../../components/ui';
import { getCustomerSportsBooking, type CustomerSportsBookingDetail } from '../sports/api';
import { canContinueSportsCheckout, getSportsBookingActions, getSportsBookingStatusLabel } from '../sports/model';
import { useAuth } from '../../lib/auth';
import { formatINR } from '../../lib/money';
import { useAppFeatureFlags } from '../../lib/featureFlags';
import { usePayment } from '../../lib/payments';
import { useTheme } from '../../theme';
import { useSportsReadRefresh } from '../sports/useSportsReadRefresh';

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

function countdown(deadline: string, now: number) {
  const seconds = Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${seconds % 60}s`;
}

function useSportsCheckoutDetailController() {
  const startPayment = usePayment();
  const flags = useAppFeatureFlags();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useAuth();
  const [booking, setBooking] = useState<CustomerSportsBookingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const refreshedDeadline = useRef<string | null>(null);
  const sportsDiscoveryEnabled = flags.isOn('sports');

  const loadForRefresh = useCallback(async (guard: { isCurrent: () => boolean }) => {
    if (!id) return;
    try {
      const next = await getCustomerSportsBooking(id);
      if (!guard.isCurrent()) return;
      if (!next) {
        setBooking(null);
        setError('This booking is not available.');
        return;
      }
      setBooking(next);
      setError(null);
    } catch (caught) {
      if (guard.isCurrent()) setError((caught as Error).message);
    }
  }, [id]);
  const { refresh: load } = useSportsReadRefresh(loadForRefresh, {
    contextKey: `sports-checkout:${id ?? ''}:${userId ?? ''}`,
    enabled: !!id,
    intervalMs: 30_000,
  });

  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, []);

  useEffect(() => {
    refreshedDeadline.current = null;
  }, [id]);

  const actions = useMemo(() => getSportsBookingActions({
    booking,
    viewerId: userId,
    now: new Date(now),
  }), [booking, now, userId]);
  const isPaymentDue = !!booking
    && canContinueSportsCheckout(booking.status)
    && booking.payment_mode === 'online'
    && booking.paid_at == null;
  const paymentDeadline = isPaymentDue
    ? actions.applicableDeadline
    : null;
  const remainingMs = paymentDeadline ? Date.parse(paymentDeadline) - now : null;
  const hasFiniteDeadline = remainingMs != null && Number.isFinite(remainingMs);
  const deadlineExpired = remainingMs != null && Number.isFinite(remainingMs) && remainingMs <= 0;

  useEffect(() => {
    if (!booking || !paymentDeadline || !deadlineExpired) return;
    const key = `${booking.id}:${paymentDeadline}`;
    if (refreshedDeadline.current === key) return;
    refreshedDeadline.current = key;
    void load();
  }, [booking, deadlineExpired, load, paymentDeadline]);

  const pay = useCallback(async () => {
    if (!booking || !id || !actions.canPay || loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await startPayment(id, undefined, 'sports');
      if (result !== 'cancelled') await load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, [actions.canPay, booking, id, load, loading, startPayment]);

  const viewBooking = useCallback(() => {
    if (!booking) return;
    router.replace(`/sports-booking/${booking.id}` as Href);
  }, [booking]);

  const chooseAnotherSlot = useCallback(() => {
    if (!sportsDiscoveryEnabled) return;
    router.replace((booking?.venue_id ? `/venue/${booking.venue_id}` : '/sports') as Href);
  }, [booking?.venue_id, sportsDiscoveryEnabled]);

  return {
    actions,
    booking,
    chooseAnotherSlot,
    deadlineExpired,
    error,
    hasFiniteDeadline,
    isPaymentDue,
    load,
    loading,
    now,
    paymentDeadline,
    pay,
    sportsDiscoveryEnabled,
    viewBooking,
  };
}

export default function SportsCheckoutDetailScreen() {
  const t = useTheme();
  const {
    actions,
    booking,
    chooseAnotherSlot,
    deadlineExpired,
    error,
    hasFiniteDeadline,
    isPaymentDue,
    load,
    loading,
    now,
    paymentDeadline,
    pay,
    sportsDiscoveryEnabled,
    viewBooking,
  } = useSportsCheckoutDetailController();
  const showNewSlot = !!booking
    && sportsDiscoveryEnabled
    && ['declined', 'cancelled', 'expired'].includes(booking.status);

  return (
    <Screen header={<Header
      title="Sports checkout"
      onBack={() => router.canGoBack() ? router.back() : router.replace('/sports' as Href)}
    />}>
      {error && !booking ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !booking ? (
        <Skeleton height={280} radius={t.radii.lg} />
      ) : (
        <>
          <Card gap={t.spacing.sm}>
            <Text variant="title3">{booking.venue_name}</Text>
            <Text variant="callout">{booking.activity_name} · {booking.resource_name}</Text>
            <Text variant="footnote">{slotLabel(booking.starts_at)} – {new Date(booking.ends_at).toLocaleTimeString('en-IN', {
              timeZone: 'Asia/Kolkata',
              hour: 'numeric',
              minute: '2-digit',
            })}</Text>
            <Text variant="footnote">Participants · {booking.participants ?? 1}</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="footnote">Price</Text>
              <Text variant="footnoteStrong">{formatINR(booking.price_paise)}</Text>
            </View>
            {booking.customer_fee_paise != null ? (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text variant="footnote">Customer fee</Text>
                <Text variant="footnoteStrong">{formatINR(booking.customer_fee_paise)}</Text>
              </View>
            ) : null}
            {booking.total_paise != null ? (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text variant="calloutStrong">Total</Text>
                <Text variant="calloutStrong">{formatINR(booking.total_paise)}</Text>
              </View>
            ) : null}
          </Card>
          <Card gap={t.spacing.sm}>
            <Text variant="footnoteStrong">{getSportsBookingStatusLabel(booking.status)}</Text>
            {paymentDeadline && hasFiniteDeadline && remainingMsForLabel(paymentDeadline, now) > 0 ? (
              <Text variant="callout">Complete payment in {countdown(paymentDeadline, now)}</Text>
            ) : paymentDeadline && hasFiniteDeadline && deadlineExpired ? (
              <Text variant="callout" color="dangerText">This payment window has expired.</Text>
            ) : paymentDeadline && !hasFiniteDeadline ? (
              <Text variant="footnote" color="muted">Payment deadline is unavailable. Refresh before trying again.</Text>
            ) : isPaymentDue && !paymentDeadline ? (
              <Text variant="footnote" color="muted">Payment deadline is unavailable. Refresh before trying again.</Text>
            ) : null}
          </Card>
          <InlineAlert message={error} />
          {actions.canPay ? (
            <Button
              title={`Pay ${formatINR(booking.total_paise ?? booking.price_paise)}`}
              onPress={() => void pay()}
              loading={loading}
              fullWidth
              leftIcon="lock-closed"
            />
          ) : (
            <Button
              title={actions.nextAction === 'view_request' ? 'View request' : 'View booking'}
              onPress={viewBooking}
              fullWidth
              leftIcon="calendar-outline"
            />
          )}
          {showNewSlot ? (
            <Button
              title="Choose another slot"
              variant="outline"
              onPress={chooseAnotherSlot}
              fullWidth
              leftIcon="calendar-outline"
            />
          ) : null}
        </>
      )}
    </Screen>
  );
}

function remainingMsForLabel(deadline: string, now: number) {
  return Date.parse(deadline) - now;
}
