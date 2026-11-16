/** Pure unread-message helpers (no I/O) shared by the unread context, chat screen and tests. */
import type { Message } from './types';

export type ChatRole = 'customer' | 'provider';

export interface UnreadCount {
  booking_id: string;
  /** Which side of the booking the signed-in user is on; null until the server confirms (realtime-only entries). */
  role: ChatRole | null;
  unread: number;
  last_message_at: string | null;
}

export type UnreadMap = Record<string, UnreadCount>;

export function toUnreadMap(rows: UnreadCount[]): UnreadMap {
  const map: UnreadMap = {};
  for (const r of rows) if (r.unread > 0) map[r.booking_id] = { ...r };
  return map;
}

/** Total unread for one side (customer Bookings tab vs provider Jobs tab). Unconfirmed entries count for both. */
export function totalUnread(map: UnreadMap, role?: ChatRole): number {
  let n = 0;
  for (const c of Object.values(map)) if (!role || !c.role || c.role === role) n += c.unread;
  return n;
}

export function unreadFor(map: UnreadMap, bookingId: string | null | undefined): number {
  return bookingId ? (map[bookingId]?.unread ?? 0) : 0;
}

/** Badge text: nothing for 0, "99+" above 99. */
export function badgeLabel(n: number): string | undefined {
  if (!n || n < 0) return undefined;
  return n > 99 ? '99+' : String(n);
}

/** A realtime message: counts unless the user sent it or is looking at that chat right now. */
export function applyIncoming(map: UnreadMap, m: Pick<Message, 'booking_id' | 'sender_id' | 'created_at'>, userId: string, activeBookingId: string | null): UnreadMap {
  if (m.sender_id === userId || m.booking_id === activeBookingId) return map;
  const prev = map[m.booking_id];
  return {
    ...map,
    [m.booking_id]: { booking_id: m.booking_id, role: prev?.role ?? null, unread: (prev?.unread ?? 0) + 1, last_message_at: m.created_at },
  };
}

export function clearBooking(map: UnreadMap, bookingId: string): UnreadMap {
  if (!map[bookingId]) return map;
  const { [bookingId]: _removed, ...rest } = map;
  return rest;
}

/** Index of the first message from the other person after the user's last read time (-1: nothing new). */
export function firstUnreadIndex(messages: Pick<Message, 'sender_id' | 'created_at'>[], userId: string, lastReadAt: string | null): number {
  const since = lastReadAt ? Date.parse(lastReadAt) : Number.NEGATIVE_INFINITY;
  return messages.findIndex((m) => m.sender_id !== userId && Date.parse(m.created_at) > since);
}

/** The user's latest message, if the other person has read the chat since it was sent ("Seen"). */
export function seenMessageId(messages: Pick<Message, 'id' | 'sender_id' | 'created_at'>[], userId: string, otherLastReadAt: string | null): string | null {
  if (!otherLastReadAt) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.sender_id !== userId) continue;
    return Date.parse(m.created_at) <= Date.parse(otherLastReadAt) ? m.id : null;
  }
  return null;
}

/**
 * Masks contact details in previews (in-app banners), mirroring the server's _mask_preview used for push bodies:
 * emails, UPI ids, links and phone-like digit runs.
 */
export function maskPreview(text: string | null | undefined, max = 80): string {
  const masked = (text ?? '')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/[A-Za-z0-9._-]{2,}@[A-Za-z]{2,}/g, '[upi]')
    .replace(/(https?:\/\/|www\.)\S+/gi, '[link]')
    .replace(/\b[A-Za-z0-9-]+\.(com|in|net|org|io|co|app|me|ly|link|xyz|info|biz|page|site)\b(\/\S*)?/gi, '[link]')
    .replace(/(\+?\d[\s-]?){8,}\d/g, '[number]')
    .replace(/\s+/g, ' ')
    .trim();
  return masked.length > max ? `${masked.slice(0, max - 1).trimEnd()}…` : masked;
}

/** Only in-app routes we expect from our own notifications (never arbitrary URLs from a payload). */
const SAFE_ROUTE = /^\/(chat|booking|quote|book|request|proposal|proposal\/compose)\/[A-Za-z0-9-]{1,64}$/;
const ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * Where a notification opens. Uses the payload url when it is one of ours, else derives the screen from the kind:
 * proposal/request notifications carry only request ids. `userId` tells which side a request message was sent to.
 */
export function notificationRoute(data: unknown, kind?: string | null, userId?: string | null): string | null {
  const d = (data ?? {}) as Record<string, unknown>;
  const k = kind ?? (typeof d.kind === 'string' ? d.kind : null);
  const url = typeof d.url === 'string' ? d.url : null;
  if (url === '/provider/dashboard') return '/dashboard';
  if (url && SAFE_ROUTE.test(url)) return url;
  const booking = typeof d.booking_id === 'string' && ID.test(d.booking_id) ? d.booking_id : null;
  if (booking) return k === 'chat_message' ? `/chat/${booking}` : `/booking/${booking}`;
  const request = typeof d.request_id === 'string' && ID.test(d.request_id) ? d.request_id : null;
  if (request) {
    const toProvider = k === 'proposal_request_received' || (k === 'request_message' && !!userId && d.provider_id === userId);
    return toProvider ? `/proposal/compose/${request}` : `/request/${request}`;
  }
  return null;
}

/** A row of list_my_notifications. */
export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  count: number;
  booking_id: string | null;
  category_name: string | null;
  at: string;
  read_at: string | null;
}

export interface NotificationItem {
  key: string;
  kind: string;
  title: string;
  body: string;
  /** "AC Repair booking" style context line, when known. */
  context: string | null;
  at: string;
  unread: boolean;
  route: string | null;
}

/** Chat push/list title: "New message from Ravi", "3 new messages from Ravi" or, once read, "Message from Ravi". */
export function chatTitle(name: string, unread: number): string {
  if (unread > 1) return `${unread} new messages from ${name}`;
  return unread === 1 ? `New message from ${name}` : `Message from ${name}`;
}

/**
 * Instagram-style list: one entry per booking chat (latest preview, unread from the chat read-state, which is the
 * source of truth for messages) and one per other notification, newest first.
 */
export function buildNotificationItems(rows: AppNotification[], unread: UnreadMap, userId: string | null): NotificationItem[] {
  const items: NotificationItem[] = [];
  const chats = new Map<string, AppNotification>();
  for (const n of rows) {
    if (n.kind === 'chat_message' && n.booking_id) {
      const prev = chats.get(n.booking_id);
      if (!prev || Date.parse(n.at) > Date.parse(prev.at)) chats.set(n.booking_id, n);
      continue;
    }
    items.push({
      key: n.id,
      kind: n.kind,
      title: n.count > 1 ? `${n.title} (${n.count})` : n.title,
      body: n.body,
      context: n.category_name,
      at: n.at,
      unread: !n.read_at,
      route: notificationRoute(n.data, n.kind, userId),
    });
  }
  for (const [bookingId, n] of chats) {
    const count = unreadFor(unread, bookingId);
    const lastMessage = unread[bookingId]?.last_message_at;
    items.push({
      key: `chat:${bookingId}`,
      kind: n.kind,
      title: chatTitle(n.title, count),
      body: n.body,
      context: n.category_name ? `${n.category_name} booking` : null,
      at: lastMessage && Date.parse(lastMessage) > Date.parse(n.at) ? lastMessage : n.at,
      unread: count > 0,
      route: `/chat/${bookingId}`,
    });
  }
  return items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** "now", "5m", "3h", "2d", else a short date. */
export function shortAgo(iso: string, now = Date.now()): string {
  const mins = Math.floor((now - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(mins) || mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h`;
  if (mins < 7 * 24 * 60) return `${Math.floor(mins / 1440)}d`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
}
