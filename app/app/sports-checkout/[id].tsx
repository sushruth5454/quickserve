import * as WebBrowser from 'expo-web-browser';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, ErrorState, Header, InlineAlert, Screen, Skeleton, Text } from '../../src/components/ui';
import { createSportsPayment, getCustomerSportsBooking, type CustomerSportsBookingDetail } from '../../src/features/sports/api';
import { canContinueSportsCheckout, getSportsBookingStatusLabel } from '../../src/features/sports/model';
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

function countdown(deadline: string, now: number) {
  const seconds = Math.max(0, Math.ceil((new Date(deadline).getTime() - now) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${seconds % 60}s`;
}

export default function SportsCheckoutScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [booking, setBooking] = useState<CustomerSportsBookingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const next = await getCustomerSportsBooking(id);
      if (!next) {
        setBooking(null);
        setError('This booking is not available.');
        return;
      }
      setBooking(next);
      setError(null);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }, [id]);

  useFocusEffect(useCallback(() => {
    void load();
    const refresh = setInterval(() => void load(), 30_000);
    return () => clearInterval(refresh);
  }, [load]));

  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, []);

  const deadline = useMemo(() => {
    if (!booking) return null;
    return booking.status === 'pending_payment'
      ? booking.hold_expires_at ?? booking.expires_at
      : booking.pay_by ?? booking.expires_at;
  }, [booking]);
  const remainingMs = deadline ? new Date(deadline).getTime() - now : null;
  const deadlineExpired = remainingMs != null && Number.isFinite(remainingMs) && remainingMs <= 0;
  const isPayable = !!booking
    && canContinueSportsCheckout(booking.status)
    && !deadlineExpired;

  const pay = async () => {
    if (!booking || !id || !isPayable || loading) return;
    setLoading(true);
    setError(null);
    try {
      const payment = await createSportsPayment(id);
      await WebBrowser.openBrowserAsync(payment.short_url);
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const chooseAnotherSlot = () => {
    router.replace((booking?.venue_id ? `/venue/${booking.venue_id}` : '/sports') as Href);
  };

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
            {deadline && remainingMs != null && Number.isFinite(remainingMs) && remainingMs > 0 ? (
              <Text variant="callout">Complete payment in {countdown(deadline, now)}</Text>
            ) : deadlineExpired ? (
              <Text variant="callout" color="dangerText">This payment window has expired.</Text>
            ) : (
              <Text variant="footnote" color="muted">Payment deadline will be checked securely before payment.</Text>
            )}
          </Card>
          <InlineAlert message={error} />
          {isPayable ? (
            <Button
              title={`Pay ${formatINR(booking.total_paise ?? booking.price_paise)}`}
              onPress={() => void pay()}
              loading={loading}
              fullWidth
              leftIcon="lock-closed"
            />
          ) : (
            <Button title="Choose another slot" onPress={chooseAnotherSlot} fullWidth leftIcon="calendar-outline" />
          )}
        </>
      )}
    </Screen>
  );
}
