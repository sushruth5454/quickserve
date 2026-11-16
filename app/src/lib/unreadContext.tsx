import { router } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { useToast } from '../components/ui';
import { countUnreadNotifications, getChatHeading, getUnreadCounts, markChatRead, subscribeToMyMessages } from './api';
import { useAuth } from './auth';
import { applyIncoming, chatTitle, clearBooking, maskPreview, toUnreadMap, totalUnread, type ChatRole, type UnreadMap } from './unread';

interface UnreadState {
  map: UnreadMap;
  total: (role?: ChatRole) => number;
  countFor: (bookingId: string | null | undefined) => number;
  /** Unread non-chat notifications (booking updates, proposals); the bell badge adds chat unread to this. */
  notifications: number;
  /** Clears the non-chat count after the notifications screen marked them read. */
  clearNotifications: () => void;
  refresh: () => Promise<void>;
  /** The chat currently open and focused (its messages never count as unread or raise a banner). */
  setActiveChat: (bookingId: string | null) => void;
  activeChat: () => string | null;
  /** Optimistically clears a chat's badge and records the read on the server. */
  markRead: (bookingId: string, viewing?: boolean | null) => Promise<void>;
}

const UnreadContext = createContext<UnreadState | null>(null);
const POLL_MS = 60_000;

/**
 * Unread chat counts for the signed-in user: fetched on sign-in, app foreground and a slow poll, and updated live from
 * Realtime (with a debounced server refetch so the count stays authoritative). Shows an in-app banner for messages in
 * chats that are not open, which works in Expo Go where remote push does not.
 */
export function UnreadProvider({ children }: { children: ReactNode }) {
  const { userId } = useAuth();
  const toast = useToast();
  const [map, setMap] = useState<UnreadMap>({});
  const [notifications, setNotifications] = useState(0);
  const headings = useRef(new Map<string, { name: string; category: string | null } | null>());
  const active = useRef<string | null>(null);
  const userRef = useRef(userId);
  userRef.current = userId;

  const refresh = useCallback(async () => {
    if (!userId) {
      setMap({});
      setNotifications(0);
      return;
    }
    void countUnreadNotifications()
      .then((n) => {
        if (userRef.current === userId) setNotifications(n);
      })
      .catch(() => undefined);
    try {
      const rows = await getUnreadCounts();
      if (userRef.current !== userId) return;
      const next = toUnreadMap(rows);
      // The open chat is being read right now; a slower server response must not resurrect its badge.
      setMap(active.current ? clearBooking(next, active.current) : next);
    } catch {
      // Offline or transient: keep the last known counts; the next foreground/poll retries.
    }
  }, [userId]);

  useEffect(() => {
    setMap({});
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!userId) return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void refresh();
    });
    const poll = setInterval(() => {
      if (AppState.currentState === 'active') void refresh();
    }, POLL_MS);
    return () => {
      sub.remove();
      clearInterval(poll);
    };
  }, [userId, refresh]);

  useEffect(() => {
    if (!userId) return;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeToMyMessages((m) => {
      if (m.sender_id === userId || m.booking_id === active.current) return;
      setMap((prev) => applyIncoming(prev, m, userId, active.current));
      if (AppState.currentState === 'active') {
        const preview = m.body ? maskPreview(m.body, 60) : 'Sent a photo';
        const show = (h: { name: string; category: string | null } | null) => {
          if (m.booking_id === active.current) return;
          toast({
            message: h ? `${chatTitle(h.name, 1)}${h.category ? ` · ${h.category} booking` : ''}\n${preview}` : `New message: ${preview}`,
            icon: 'chatbubble-ellipses-outline',
            actionLabel: 'Open',
            onAction: () => router.push({ pathname: '/chat/[bookingId]', params: { bookingId: m.booking_id } }),
          });
        };
        if (headings.current.has(m.booking_id)) show(headings.current.get(m.booking_id) ?? null);
        else {
          void getChatHeading(m.booking_id)
            .catch(() => null)
            .then((h) => {
              headings.current.set(m.booking_id, h);
              show(h);
            });
        }
      }
      clearTimeout(debounce);
      debounce = setTimeout(() => void refresh(), 1500);
    });
    return () => {
      clearTimeout(debounce);
      unsubscribe();
    };
  }, [userId, refresh, toast]);

  const setActiveChat = useCallback((bookingId: string | null) => {
    active.current = bookingId;
    if (bookingId) setMap((prev) => clearBooking(prev, bookingId));
  }, []);

  const markRead = useCallback(async (bookingId: string, viewing: boolean | null = null) => {
    setMap((prev) => clearBooking(prev, bookingId));
    await markChatRead(bookingId, viewing);
  }, []);

  const activeChat = useCallback(() => active.current, []);
  const clearNotifications = useCallback(() => setNotifications(0), []);

  const value = useMemo<UnreadState>(
    () => ({
      map,
      total: (role) => totalUnread(map, role),
      countFor: (id) => (id ? (map[id]?.unread ?? 0) : 0),
      notifications,
      clearNotifications,
      refresh,
      setActiveChat,
      activeChat,
      markRead,
    }),
    [map, notifications, clearNotifications, refresh, setActiveChat, activeChat, markRead],
  );

  return <UnreadContext.Provider value={value}>{children}</UnreadContext.Provider>;
}

export function useUnread(): UnreadState {
  const ctx = useContext(UnreadContext);
  if (!ctx) throw new Error('useUnread must be used inside UnreadProvider');
  return ctx;
}
