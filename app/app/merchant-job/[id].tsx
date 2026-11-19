import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Header, InlineAlert, Screen, Skeleton, Text, TextArea, useConfirm, useToast } from '../../src/components/ui';
import * as api from '../../src/lib/api';
import { isDemoMode } from '../../src/lib/config';
import { useAppFeatureFlags } from '../../src/lib/featureFlags';
import type { Booking, BookingAddress, Message } from '../../src/lib/types';
import { useAuth } from '../../src/lib/auth';
import { useTheme } from '../../src/theme';

export default function MerchantJobScreen() {
  const t = useTheme();
  const confirm = useConfirm();
  const toast = useToast();
  const featureFlags = useAppFeatureFlags();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useAuth();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [address, setAddress] = useState<BookingAddress | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [nextBooking, nextMessages, nextAddress] = await Promise.all([
        api.getBooking(id),
        api.listMessages(id),
        api.getBookingAddress(id),
      ]);
      setBooking(nextBooking);
      setMessages(nextMessages);
      setAddress(nextAddress);
      await api.markChatRead(id, true);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useFocusEffect(useCallback(() => {
    void load();
    if (!id) return;
    return api.subscribeToMessages(id, (message) => setMessages((current) => [...current, message]));
  }, [id, load]));

  const send = async () => {
    if (!id || !body.trim() || !booking) return;
    setBusy(true);
    try {
      await api.sendMessage(id, body);
      setBody('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const isHomeBooking =
    !!booking
    && (booking.archetype === 'inspect_quote' || booking.archetype === 'fixed' || booking.archetype === 'time_based');
  const providerCancelStatuses = [
    'requested', 'accepted', 'confirmed', 'en_route', 'inspecting', 'quote_sent', 'awaiting_payment',
  ];
  const canProviderCancel =
    isHomeBooking
    && booking!.provider_id === userId
    && providerCancelStatuses.includes(booking!.status);
  const noShowParty = booking?.customer_id === userId
    ? 'provider'
    : booking?.provider_id === userId
      ? 'customer'
      : null;
  const canReportNoShow =
    !isDemoMode
    && isHomeBooking
    && !!noShowParty
    && featureFlags.isOn('home_no_show_reporting')
    && (booking!.status === 'accepted' || booking!.status === 'en_route');

  const runSafetyAction = async (action: () => Promise<void>, successMessage: string) => {
    if (!booking || actionBusy) return;
    setActionBusy(true);
    setError(null);
    try {
      await action();
      await load();
      toast({ message: successMessage, tone: 'success' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActionBusy(false);
    }
  };

  const cancelAsProvider = async () => {
    if (!booking) return;
    const confirmed = await confirm({
      title: "Can't attend this booking?",
      message: 'The booking will be cancelled under the provider cancellation policy. Any refund is calculated by the server.',
      confirmLabel: 'Cancel booking',
      cancelLabel: 'Keep booking',
      destructive: true,
    });
    if (confirmed) {
      await runSafetyAction(
        () => api.providerCancelBooking(booking.id, 'provider_cancellation'),
        'Booking cancelled',
      );
    }
  };

  const reportNoShow = async () => {
    if (!booking || !noShowParty) return;
    const confirmed = await confirm({
      title: 'Report a no-show?',
      message: 'A support case will be opened and any pending provider payout will be paused while it is reviewed.',
      confirmLabel: 'Report no-show',
      cancelLabel: 'Not now',
      destructive: true,
    });
    if (confirmed) {
      await runSafetyAction(
        () => api.reportNoShow(booking.id, noShowParty),
        'No-show report sent to support',
      );
    }
  };

  const chatOpen = !!booking && !['pending_payment', 'declined', 'expired', 'cancelled'].includes(booking.status);

  return (
    <Screen
      header={<Header title={booking?.categories?.name ?? 'Assigned job'} subtitle={booking ? `${booking.status} · ${booking.scheduled_at ? new Date(booking.scheduled_at).toLocaleString('en-IN') : 'Schedule pending'}` : undefined} onBack={() => router.back()} />}
      gap={t.spacing.md}
      footer={booking ? (
        <View style={{ gap: t.spacing.sm }}>
          <InlineAlert message={error} />
          <TextArea label={chatOpen ? 'Message' : 'Chat closed'} value={body} onChangeText={setBody} maxLength={2000} placeholder="Message the customer…" editable={chatOpen} />
          <Button title="Send message" onPress={() => void send()} loading={busy} disabled={!chatOpen || !body.trim()} fullWidth />
        </View>
      ) : undefined}
    >
      {!booking && !error ? <Skeleton height={160} radius={t.radii.lg} /> : null}
      {error && !booking ? <InlineAlert message={error} /> : null}
      {booking ? (
        <Card gap={t.spacing.xs}>
          <Text variant="title3">{booking.customer_id === userId ? 'Your booking' : 'Customer'}</Text>
          <Text variant="footnote" color="muted">{booking.description}</Text>
          <Text variant="caption" color="muted">
            {address?.area}{address?.address_line ? ` · ${address.address_line}` : ''}
          </Text>
        </Card>
      ) : null}
      {canProviderCancel || canReportNoShow ? (
        <Card gap={t.spacing.sm}>
          <Text variant="title3">Booking actions</Text>
          {canProviderCancel ? (
            <Button
              title="Can't attend"
              variant="outline"
              leftIcon="close-circle-outline"
              loading={actionBusy}
              onPress={() => void cancelAsProvider()}
            />
          ) : null}
          {canReportNoShow ? (
            <Button
              title={noShowParty === 'provider' ? 'Provider did not come' : 'Customer not home'}
              variant="destructive"
              leftIcon="flag-outline"
              loading={actionBusy}
              onPress={() => void reportNoShow()}
            />
          ) : null}
        </Card>
      ) : null}
      {messages.map((message) => {
        const mine = message.sender_id === userId;
        return (
          <Card key={message.id} style={{
            alignSelf: mine ? 'flex-end' : 'flex-start',
            width: '88%',
            backgroundColor: mine ? t.colors.primarySoft : t.colors.surface,
          }}>
            <Text variant="captionStrong" color={mine ? 'primaryText' : 'muted'}>{mine ? 'You' : 'Customer'}</Text>
            <Text>{message.body ?? ''}</Text>
            <Text variant="caption" color="muted" align="right">
              {new Date(message.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
            </Text>
          </Card>
        );
      })}
    </Screen>
  );
}
