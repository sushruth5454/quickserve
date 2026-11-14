import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { ScrollView, View } from 'react-native';
import { ChatComposer, MessageList, useChat } from '../../src/components/ChatPanel';
import { ErrorState, Header, InlineAlert, Screen, Skeleton, Text } from '../../src/components/ui';
import { getBooking, getProfileName } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import type { Booking } from '../../src/lib/types';
import { bookingRef } from '../../src/lib/schedule';
import { useTheme } from '../../src/theme';

const CHAT_CLOSED = new Set(['pending_payment', 'declined', 'expired', 'cancelled']);

export default function ChatScreen() {
  const t = useTheme();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const { userId } = useAuth();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [counterpart, setCounterpart] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const { messages, error, sending, send } = useChat(bookingId);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);

  const load = useCallback(async () => {
    if (!bookingId || !userId) return;
    try {
      const b = await getBooking(bookingId);
      setBooking(b);
      setCounterpart(await getProfileName(b.customer_id === userId ? b.provider_id : b.customer_id));
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [bookingId, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (messages?.length) setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
  }, [messages?.length]);

  const back = () => {
    if (router.canGoBack()) router.back();
    else if (bookingId) router.replace({ pathname: '/booking/[id]', params: { id: bookingId } });
  };

  const enabled = !!booking && !CHAT_CLOSED.has(booking.status);
  const name = counterpart || 'Chat';

  return (
    <Screen
      header={
        <Header
          title={name}
          subtitle={booking ? `${booking.categories?.name ?? 'Booking'} · ${bookingRef(booking.id)}` : undefined}
          onBack={back}
        />
      }
      scrollRef={scrollRef}
      gap={t.spacing.md}
      footer={
        booking ? (
          enabled ? (
            <ChatComposer counterpartName={name} sending={sending} onSend={send} />
          ) : (
            <Text variant="footnote" color="muted" align="center" style={{ paddingVertical: t.spacing.xs }}>
              Chat is closed for this booking.
            </Text>
          )
        ) : undefined
      }
    >
      {loadError && !booking ? (
        <ErrorState message={loadError} onRetry={() => void load()} />
      ) : !messages || !userId ? (
        <View style={{ gap: t.spacing.md }}>
          <Skeleton width="60%" height={40} radius={18} />
          <Skeleton width="45%" height={40} radius={18} style={{ alignSelf: 'flex-end' }} />
          <Skeleton width="55%" height={40} radius={18} />
        </View>
      ) : (
        <MessageList messages={messages} userId={userId} counterpartName={counterpart || 'Them'} />
      )}
      <InlineAlert message={error} />
    </Screen>
  );
}
