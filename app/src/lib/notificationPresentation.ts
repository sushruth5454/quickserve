import { bookingRef } from './schedule';
import {
  notificationTimePresentation,
  shortAgo,
  type NotificationGroup,
  type NotificationItem,
} from './unread';
import type { SupportThread } from './adminApi';
import { isFeatureOn } from './featureFlagModel';

export { notificationTimePresentation };
export type { NotificationGroup };

function isValidTime(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

function dateKey(date: Date, timeZone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone,
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return null;
  }
}

function offsetDateKey(key: string | null, days: number): string | null {
  if (!key) return null;
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function sortNotificationItems(items: NotificationItem[]): NotificationItem[] {
  const sorted = items
    .map((item, index) => ({ item, index, at: isValidTime(item.at) ? Date.parse(item.at) : Number.NEGATIVE_INFINITY }))
    .sort((left, right) => right.at - left.at || left.index - right.index);
  const seenChats = new Set<string>();
  return sorted
    .map(({ item }) => item)
    .filter((item) => {
      if (!item.key.startsWith('chat:')) return true;
      if (seenChats.has(item.key)) return false;
      seenChats.add(item.key);
      return true;
    });
}

/** Stable newest-first date groups that use calendar days in the selected timezone. */
export function groupNotificationItems(
  items: NotificationItem[],
  now = Date.now(),
  timeZone = 'Asia/Kolkata',
): NotificationGroup[] {
  const today = dateKey(new Date(now), timeZone);
  const yesterday = offsetDateKey(today, -1);
  const groups = new Map<string, NotificationGroup>();

  for (const item of sortNotificationItems(items)) {
    const dateIsKnown = isValidTime(item.at) && item.timeSource !== 'unknown';
    const itemDate = dateIsKnown ? dateKey(new Date(item.at), timeZone) : null;
    const source = dateIsKnown ? item.timeSource : 'unknown';
    const key = itemDate ? `${source}:${itemDate}` : 'unknown';
    let group = groups.get(key);
    if (!group) {
      const prefix = source === 'legacy_created_at'
        ? 'Records created'
        : source === 'queued_event'
          ? 'Activity recorded'
          : source === 'message_created_at'
            ? 'Messages'
            : null;
      const label = itemDate && prefix
        ? `${prefix} ${itemDate === today
          ? 'Today'
          : itemDate === yesterday
            ? 'Yesterday'
            : new Date(item.at).toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              timeZone,
            })}`
        : 'Date unavailable';
      group = { key, label, items: [] };
      groups.set(key, group);
    }
    group.items.push(item);
  }

  return [...groups.values()];
}

export interface SupportThreadPresentation {
  statusLabel: 'Open' | 'Closed';
  unreadCount: number;
  unreadLabel: string | null;
  bookingLabel: string | null;
  timeLabel: string;
  timeAccessibilityLabel: string;
}

export interface ChatScrollMetrics {
  contentOffset: { y: number };
  contentSize: { height: number };
  layoutMeasurement: { height: number };
}

const SCROLL_END_THRESHOLD = 80;

export function isNearScrollEnd(event: ChatScrollMetrics): boolean {
  const remaining = event.contentSize.height - event.layoutMeasurement.height - event.contentOffset.y;
  return Number.isFinite(remaining) && remaining <= SCROLL_END_THRESHOLD;
}

export function shouldAutoScrollForMessage(isNearBottom: boolean, messageFromCurrentUser: boolean): boolean {
  return isNearBottom || messageFromCurrentUser;
}

export function exactCommunicationTime(iso: string, timeZone = 'Asia/Kolkata'): string {
  if (!isValidTime(iso)) return 'Time unavailable';
  return new Date(iso).toLocaleString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short',
  });
}

export function supportThreadPresentation(
  thread: SupportThread,
  audience: 'participant' | 'admin' = 'participant',
  now = Date.now(),
  timeZone = 'Asia/Kolkata',
): SupportThreadPresentation {
  const unreadCount = audience === 'admin' ? thread.admin_unread : thread.user_unread;
  const hasTime = isValidTime(thread.last_message_at);
  let timeAccessibilityLabel = 'Last message time unavailable';
  let timeLabel = 'Time unavailable';
  if (hasTime) {
    try {
      timeLabel = `Message ${shortAgo(thread.last_message_at, now)}`;
      timeAccessibilityLabel = `Last message ${exactCommunicationTime(thread.last_message_at, timeZone)}`;
    } catch {
      timeLabel = 'Time unavailable';
    }
  }
  return {
    statusLabel: thread.status === 'closed' ? 'Closed' : 'Open',
    unreadCount,
    unreadLabel: unreadCount > 0 ? `${unreadCount} unread` : null,
    bookingLabel: thread.booking_id ? `Booking ${bookingRef(thread.booking_id)}` : null,
    timeLabel,
    timeAccessibilityLabel,
  };
}

export function communicationsCompositionEnabled(features: Record<string, unknown>): boolean {
  return isFeatureOn(features, 'oorva_comms_ux');
}
