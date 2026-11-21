import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentRef, type RefObject } from 'react';
import { AppState, ScrollView, View } from 'react-native';
import { ChatComposer, MessageList, useChat } from '../../components/ChatPanel';
import { ErrorState, Header, InlineAlert, Screen, Skeleton, Text } from '../../components/ui';
import { getBooking, getChatReadState, getProfileName, markChatRead, subscribeToBooking } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { registerForPush } from '../../lib/push';
import type { Booking } from '../../lib/types';
import { bookingRef } from '../../lib/schedule';
import { firstUnreadIndex, seenMessageId } from '../../lib/unread';
import { useUnread } from '../../lib/unreadContext';
import { useTheme } from '../../theme';

const CHAT_CLOSED = new Set(['pending_payment', 'declined', 'expired', 'cancelled']);
/** Presence heartbeat while the chat is open (server presence lasts 45 s) and "Seen" refresh. */
const HEARTBEAT_MS = 20_000;

interface ChatDetailController {
  bookingId: string;
  userId: string | null;
  booking: Booking | null;
  counterpart: string;
  loadError: string | null;
  messages: ReturnType<typeof useChat>['messages'];
  phase: ReturnType<typeof useChat>['phase'];
  error: string | null;
  sending: boolean;
  nudge: boolean;
  send: (body: string) => Promise<boolean>;
  reload: () => Promise<void>;
  scrollRef: RefObject<ComponentRef<typeof ScrollView> | null>;
  dividerId: string | null | undefined;
  otherReadAt: string | null;
  load: () => Promise<void>;
  back: () => void;
  enabled: boolean;
  name: string;
}

interface BookingState {
  key: string;
  booking: Booking | null;
  counterpart: string;
  counterpartId: string | null;
  loadError: string | null;
}

function useChatDetailController(): ChatDetailController {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const { userId } = useAuth();
  const { setActiveChat, markRead } = useUnread();
  const routeKey = JSON.stringify([bookingId ?? null, userId ?? null]);
  const routeKeyRef = useRef(routeKey);
  routeKeyRef.current = routeKey;
  const [bookingState, setBookingState] = useState<BookingState | null>(null);
  const bookingRequest = useRef(0);
  const currentBookingState = bookingState?.key === routeKey ? bookingState : null;
  const booking = currentBookingState?.booking ?? null;
  const counterpart = currentBookingState?.counterpart ?? '';
  const loadError = currentBookingState?.loadError ?? null;
  const { messages, phase, error, sending, nudge, reload, send } = useChat(bookingId, userId);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  // Read time when the chat was opened (fetched before marking read) → where the "New messages" divider goes.
  const openedReadAt = useRef<{ key: string; promise: Promise<string | null> } | null>(null);
  const [dividerState, setDividerState] = useState<{ key: string; id: string | null | undefined } | null>(null);
  const [otherReadState, setOtherReadState] = useState<{ key: string; at: string | null } | null>(null);
  const focused = useRef(false);

  const load = useCallback(async () => {
    if (!bookingId || !userId) return;
    const key = routeKey;
    const request = ++bookingRequest.current;
    setBookingState((previous) => {
      const current = previous?.key === key ? previous : null;
      return current
        ? { ...current, loadError: null }
        : { key, booking: null, counterpart: '', counterpartId: null, loadError: null };
    });
    try {
      const b = await getBooking(bookingId);
      if (request !== bookingRequest.current || routeKeyRef.current !== key) return;
      const counterpartId = b.customer_id === userId ? b.provider_id : b.customer_id;
      setBookingState((previous) => {
        const current = previous?.key === key ? previous : null;
        return {
          key,
          booking: b,
          counterpart: current?.counterpartId === counterpartId ? current.counterpart : '',
          counterpartId,
          loadError: null,
        };
      });
      const name = await getProfileName(counterpartId).catch(() => '');
      if (request !== bookingRequest.current || routeKeyRef.current !== key) return;
      setBookingState((previous) =>
        previous?.key === key && previous.counterpartId === counterpartId
          ? { ...previous, counterpart: name }
          : previous,
      );
    } catch (e) {
      if (request !== bookingRequest.current || routeKeyRef.current !== key) return;
      setBookingState((previous) => {
        const current = previous?.key === key ? previous : null;
        return current
          ? { ...current, loadError: (e as Error).message }
          : { key, booking: null, counterpart: '', counterpartId: null, loadError: (e as Error).message };
      });
    }
  }, [bookingId, userId, routeKey]);

  useEffect(() => {
    if (!bookingId || !userId) return;
    void load();
    const unsubscribe = subscribeToBooking(bookingId, () => void load());
    return () => {
      unsubscribe();
      if (routeKeyRef.current === routeKey) bookingRequest.current += 1;
    };
  }, [bookingId, userId, routeKey, load]);

  const usableCurrentChat = !!booking && booking.id === bookingId && !!userId && phase === 'ready' && !!messages;
  const usableCurrentChatRef = useRef(usableCurrentChat);
  usableCurrentChatRef.current = usableCurrentChat;
  const openedSnapshot = openedReadAt.current?.key === routeKey ? openedReadAt.current.promise : null;
  const currentDivider = dividerState?.key === routeKey ? dividerState : null;
  const dividerId = currentDivider?.id;
  const otherReadAt = otherReadState?.key === routeKey ? otherReadState.at : null;

  useEffect(() => {
    if (!bookingId || !userId || !usableCurrentChat || openedReadAt.current?.key === routeKey) return;
    setOtherReadState({ key: routeKey, at: null });
    setDividerState((previous) => (previous?.key === routeKey ? previous : { key: routeKey, id: undefined }));
    const promise = getChatReadState(bookingId)
      .then((state) => {
        if (routeKeyRef.current === routeKey) setOtherReadState({ key: routeKey, at: state.other_last_read_at });
        return state.my_last_read_at;
      })
      .catch(() => null);
    openedReadAt.current = { key: routeKey, promise };
  }, [bookingId, userId, routeKey, usableCurrentChat]);

  // Place the divider once, from the first message list after opening (messages arriving later never move it).
  useEffect(() => {
    if (!messages || phase !== 'ready' || !userId || dividerId !== undefined || !openedSnapshot) return;
    let alive = true;
    void openedSnapshot.then((readAt) => {
      if (!alive || routeKeyRef.current !== routeKey) return;
      const i = firstUnreadIndex(messages, userId, readAt);
      setDividerState({ key: routeKey, id: i >= 0 ? messages[i]!.id : null });
    });
    return () => {
      alive = false;
    };
  }, [messages, phase, userId, routeKey, dividerId, openedSnapshot]);

  const heartbeat = useCallback(async () => {
    const key = routeKey;
    const snapshot = openedReadAt.current;
    if (!bookingId || !userId || !usableCurrentChatRef.current || snapshot?.key !== key) return;
    await snapshot.promise;
    if (!focused.current || routeKeyRef.current !== key || !usableCurrentChatRef.current) return;
    await markRead(bookingId, true).catch(() => undefined);
    const s = await getChatReadState(bookingId).catch(() => null);
    if (s && focused.current && routeKeyRef.current === key) setOtherReadState({ key, at: s.other_last_read_at });
  }, [bookingId, userId, routeKey, markRead]);

  useEffect(() => {
    if (!focused.current || !bookingId) return;
    setActiveChat(usableCurrentChat ? bookingId : null);
    if (usableCurrentChat) void heartbeat();
  }, [bookingId, routeKey, setActiveChat, usableCurrentChat, heartbeat]);

  // While open and focused: no badge/banner/push for this chat, read state kept current, presence heartbeat.
  useFocusEffect(
    useCallback(() => {
      if (!bookingId) return;
      const enter = () => {
        focused.current = true;
        setActiveChat(usableCurrentChatRef.current ? bookingId : null);
        void load();
        void reload();
        void heartbeat();
      };
      const leave = () => {
        focused.current = false;
        setActiveChat(null);
        if (routeKeyRef.current === routeKey && usableCurrentChatRef.current) {
          void markChatRead(bookingId, false).catch(() => undefined);
        }
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
    }, [bookingId, routeKey, setActiveChat, load, reload, heartbeat]),
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

  return {
    bookingId,
    userId,
    booking,
    counterpart,
    loadError,
    messages,
    phase,
    error,
    sending,
    nudge,
    send,
    reload,
    scrollRef,
    dividerId,
    otherReadAt,
    load,
    back,
    enabled,
    name,
  };
}

export default function ChatDetailScreen() {
  const t = useTheme();
  const {
    bookingId,
    userId,
    booking,
    counterpart,
    loadError,
    messages,
    phase,
    error,
    sending,
    nudge,
    send,
    reload,
    scrollRef,
    dividerId,
    otherReadAt,
    load,
    back,
    enabled,
    name,
  } = useChatDetailController();

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
      ) : phase === 'error' ? (
        <ErrorState message={error} onRetry={() => void reload()} />
      ) : phase !== 'ready' || !messages || !userId || !booking ? (
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
