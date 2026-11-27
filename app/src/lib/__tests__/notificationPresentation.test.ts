import type { NotificationItem } from '../unread';
import { groupNotificationItems, notificationTimePresentation } from '../notificationPresentation';

function item(
  key: string,
  at: string,
  timeSource: NotificationItem['timeSource'],
  overrides: Partial<NotificationItem> = {},
): NotificationItem {
  return {
    key,
    kind: key.startsWith('chat:') ? 'chat_message' : 'booking_accepted',
    title: key,
    body: '',
    context: null,
    at,
    timeSource,
    unread: false,
    route: null,
    ...overrides,
  };
}

describe('notification presentation', () => {
  it('CM_NOTIFICATION_DATE_GROUPS: groups by timezone calendar boundaries, stably, without duplicate chat rows', () => {
    const now = Date.parse('2024-12-31T18:30:00.000Z');
    const chat = item('chat:booking-a', '2024-12-31T18:30:00.000Z', 'message_created_at');
    const groups = groupNotificationItems([
      chat,
      item('today-event', '2024-12-31T18:30:00.000Z', 'queued_event'),
      item('chat:booking-a', '2024-12-31T18:29:00.000Z', 'message_created_at', { title: 'duplicate chat' }),
      item('yesterday-record', '2024-12-31T18:29:00.000Z', 'legacy_created_at'),
      item('unknown', '', 'unknown'),
    ], now, 'Asia/Kolkata');

    expect(groups.map(({ label }) => label)).toEqual([
      'Messages Today',
      'Activity recorded Today',
      'Records created Yesterday',
      'Date unavailable',
    ]);
    expect(groups[0]?.items.map(({ key }) => key)).toEqual(['chat:booking-a']);
    expect(groups[1]?.items.map(({ key }) => key)).toEqual(['today-event']);
    expect(groups[2]?.items.map(({ key }) => key)).toEqual(['yesterday-record']);
    expect(groups[3]?.items.map(({ key }) => key)).toEqual(['unknown']);
  });

  it('keeps an exact selected timestamp accessible with its timezone and year', () => {
    const exact = notificationTimePresentation(
      item('record-a', '2024-12-31T18:30:00.000Z', 'queued_event'),
      Date.parse('2024-12-31T18:30:00.000Z'),
      'Asia/Kolkata',
    );

    expect(exact.accessibilityLabel).toContain('2025');
    expect(exact.accessibilityLabel).not.toContain('Time unavailable');
  });
});
