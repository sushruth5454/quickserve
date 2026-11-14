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
export function notificationRoute(data: unknown): string | null {
  const url = (data as { url?: unknown } | null)?.url;
  if (typeof url !== 'string') return null;
  return /^\/(chat|booking|quote)\/[A-Za-z0-9-]{1,64}$/.test(url) ? url : null;
}
