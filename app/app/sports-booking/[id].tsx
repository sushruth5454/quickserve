import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Button, Card, ErrorState, Header, InlineAlert, Input, Screen, Skeleton, Text, useToast } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';
import { useAppFeatureFlags } from '../../src/lib/featureFlags';
import { formatINR } from '../../src/lib/money';
import { supabase } from '../../src/lib/supabase';
import { useTheme } from '../../src/theme';

interface SportsBooking {
  id: string;
  customer_id: string;
  customer_name: string;
  owner_id: string;
  venue_name: string;
  resource_name: string;
  activity_name: string;
  starts_at: string;
  ends_at: string;
  status: string;
  price_paise: number;
  note: string;
  decision_reason: string;
  expires_at: string;
}

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
  const flags = useAppFeatureFlags();
  const enabled = flags.isOn('sports');
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useAuth();
  const [booking, setBooking] = useState<SportsBooking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!enabled || !id) return;
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('get_sports_booking', { p_id: id });
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setBooking((data ?? null) as SportsBooking | null);
  }, [enabled, id]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const act = async (rpc: string, params: Record<string, unknown>, message: string) => {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc(rpc, params);
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    toast({ message, tone: 'success' });
    await load();
  };

  const isOwner = !!booking && booking.owner_id === userId;

  return (
    <Screen header={<Header title="Sports booking" onBack={() => router.back()} />}>
      {!enabled ? (
        <InlineAlert message="Sports & venues are turned off right now." />
      ) : error && !booking ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !booking ? (
        <Skeleton height={250} radius={t.radii.lg} />
      ) : (
        <>
          <Card gap={t.spacing.sm}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}>
              <Text variant="title3" style={{ flex: 1 }}>{booking.venue_name}</Text>
              <Text variant="captionStrong" color={booking.status === 'accepted' ? 'successText' : 'muted'}>{booking.status.toUpperCase()}</Text>
            </View>
            <Text variant="callout">{booking.activity_name} · {booking.resource_name}</Text>
            <Text variant="footnote">{slotLabel(booking.starts_at)} – {new Date(booking.ends_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' })}</Text>
            <Text variant="bodyStrong">
              {formatINR(booking.price_paise)} · {booking.status === 'accepted' ? 'Pay at venue' : 'No online payment collected'}
            </Text>
            {booking.note ? <Text variant="footnote" color="textSecondary">Your note: {booking.note}</Text> : null}
            {booking.decision_reason ? <Text variant="footnote" color="textSecondary">Update: {booking.decision_reason}</Text> : null}
            {isOwner ? <Text variant="footnote" color="muted">Customer: {booking.customer_name || 'QuickServe customer'}</Text> : null}
            {booking.status === 'requested' ? (
              <Text variant="caption" color="muted">Request expires {slotLabel(booking.expires_at)}</Text>
            ) : null}
          </Card>
          <InlineAlert
            tone="info"
            title="No online payment"
            message="QuickServe does not collect sports booking payments; payment arrangements are with the venue."
          />
          {isOwner && booking.status === 'requested' ? (
            <Card gap={t.spacing.sm}>
              <Text variant="subheadStrong">Respond to request</Text>
              <Input label="Decline reason (required to decline)" value={reason} onChangeText={setReason} maxLength={500} />
              <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
                <Button
                  title="Accept"
                  onPress={() => void act('decide_sports_booking', { p_id: booking.id, p_accept: true, p_reason: '' }, 'Request accepted')}
                  loading={busy}
                  style={{ flex: 1 }}
                />
                <Button
                  title="Decline"
                  variant="outline"
                  onPress={() => void act('decide_sports_booking', { p_id: booking.id, p_accept: false, p_reason: reason.trim() }, 'Request declined')}
                  disabled={busy || reason.trim().length < 3}
                  style={{ flex: 1 }}
                />
              </View>
            </Card>
          ) : null}
          {booking.status === 'requested' || booking.status === 'accepted' ? (
            <Card gap={t.spacing.sm}>
              {isOwner ? <Input label="Cancellation reason" value={reason} onChangeText={setReason} maxLength={500} /> : null}
              <Button
                title="Cancel request"
                variant="ghost"
                onPress={() => void act('cancel_sports_booking', { p_id: booking.id, p_reason: isOwner ? reason.trim() : '' }, 'Booking cancelled')}
                disabled={busy || (isOwner && reason.trim().length < 3)}
              />
            </Card>
          ) : null}
          <InlineAlert message={error && booking ? error : null} />
        </>
      )}
    </Screen>
  );
}
