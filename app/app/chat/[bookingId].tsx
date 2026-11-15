import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { AppState, ScrollView, View } from 'react-native';
import { ChatComposer, MessageList, useChat } from '../../src/components/ChatPanel';
import { ErrorState, Header, InlineAlert, Screen, Skeleton, Text } from '../../src/components/ui';
import { getBooking, getChatReadState, getProfileName, markChatRead } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { registerForPush } from '../../src/lib/push';
import type { Booking } from '../../src/lib/types';
import { bookingRef } from '../../src/lib/schedule';
import { firstUnreadIndex, seenMessageId } from '../../src/lib/unread';
import { useUnread } from '../../src/lib/unreadContext';
import { useTheme } from '../../src/theme';

const CHAT_CLOSED = new Set(['pending_payment', 'declined', 'expired', 'cancelled']);
/** Presence heartbeat while the chat is open (server presence lasts 45 s) and "Seen" refresh. */
const HEARTBEAT_MS = 20_000;

export default function ChatScreen() {
  const t = useTheme();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const { userId } = useAuth();
  const { setActiveChat, markRead } = useUnread();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [counterpart, setCounterpart] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const { messages, error, sending, nudge, send } = useChat(bookingId);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  // Read time when the chat was opened (fetched before marking read) → where the "New messages" divider goes.
  const openedReadAt = useRef<Promise<string | null> | null>(null);
  const [dividerId, setDividerId] = useState<string | null | undefined>(undefined);
  const [otherReadAt, setOtherReadAt] = useState<string | null>(null);
  const focused = useRef(false);

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
    if (!bookingId) return;
    openedReadAt.current = getChatReadState(bookingId)
      .then((s) => {
        setOtherReadAt(s.other_last_read_at);
        return s.my_last_read_at;
      })
      .catch(() => null);
    setDividerId(undefined);
  }, [bookingId]);

  // Place the divider once, from the first message list after opening (messages arriving later never move it).
  useEffect(() => {
    if (!messages || !userId || dividerId !== undefined || !openedReadAt.current) return;
    let alive = true;
    void openedReadAt.current.then((readAt) => {
      if (!alive) return;
      const i = firstUnreadIndex(messages, userId, readAt);
      setDividerId(i >= 0 ? messages[i]!.id : null);
    });
    return () => {
      alive = false;
    };
  }, [messages, userId, dividerId]);

  const heartbeat = useCallback(async () => {
    if (!bookingId) return;
    await openedReadAt.current;
    if (!focused.current) return;
    await markRead(bookingId, true).catch(() => undefined);
    const s = await getChatReadState(bookingId).catch(() => null);
    if (s && focused.current) setOtherReadAt(s.other_last_read_at);
  }, [bookingId, markRead]);

  // While open and focused: no badge/banner/push for this chat, read state kept current, presence heartbeat.
  useFocusEffect(
    useCallback(() => {
      if (!bookingId) return;
      const enter = () => {
        focused.current = true;
        setActiveChat(bookingId);
        void heartbeat();
      };
      const leave = () => {
        focused.current = false;
        setActiveChat(null);
        void markChatRead(bookingId, false).catch(() => undefined);
      };
      enter();
      const timer = setInterval(() => {
        if (AppState.currentState === 'active') void heartbeat();
      }, HEARTBEAT_MS);
      const sub = AppState.addEventListener('change', (s) => (s === 'active' ? enter() : leave()));
      return () => {
        clearInterval(timer);
        sub.remove();
        leave();
      };
    }, [bookingId, setActiveChat, heartbeat]),
  );

  // Opening a chat is a natural moment to ask for notification permission (once; never at cold start).
  useEffect(() => {
    if (userId) void registerForPush(userId, { prompt: true });
  }, [userId]);

  const lastId = messages?.[messages.length - 1]?.id;
  const lastFromOther = !!messages?.length && messages[messages.length - 1]!.sender_id !== userId;
  useEffect(() => {
    if (lastId) setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    // A message arriving while the chat is on screen is read immediately.
    if (lastId && lastFromOther && focused.current) void heartbeat();
  }, [lastId, lastFromOther, heartbeat]);

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
        <MessageList
          messages={messages}
          userId={userId}
          counterpartName={counterpart || 'Them'}
          newSinceId={dividerId}
          seenId={seenMessageId(messages, userId, otherReadAt)}
        />
      )}
      {nudge ? (
        <InlineAlert
          tone="warning"
          title="Keep this booking protected"
          message="Payments outside QuickServe aren't covered by the guarantee. Use the in-app payment button."
        />
      ) : null}
      <InlineAlert message={error} />
    </Screen>
  );
}
