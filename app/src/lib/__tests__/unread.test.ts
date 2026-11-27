jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import { demoApi as api, demoControls } from '../demo/demoApi';
import {
  applyIncoming,
  badgeLabel,
  buildNotificationItems,
  chatTitle,
  clearBooking,
  firstUnreadIndex,
  groupNotificationItems,
  maskPreview,
  notificationTimePresentation,
  notificationRoute,
  seenMessageId,
  toUnreadMap,
  totalUnread,
  type AppNotification,
  type UnreadMap,
} from '../unread';

const ME = 'me';
const msg = (id: string, sender: string, at: string, booking = 'b1') => ({ id, booking_id: booking, sender_id: sender, created_at: at });

describe('unread helpers', () => {
  const map: UnreadMap = toUnreadMap([
    { booking_id: 'b1', role: 'customer', unread: 2, last_message_at: null },
    { booking_id: 'b2', role: 'provider', unread: 3, last_message_at: null },
    { booking_id: 'b3', role: 'provider', unread: 0, last_message_at: null },
  ]);

  it('totals per side (customer Bookings tab vs provider Jobs tab)', () => {
    expect(totalUnread(map)).toBe(5);
    expect(totalUnread(map, 'customer')).toBe(2);
    expect(totalUnread(map, 'provider')).toBe(3);
    expect(map.b3).toBeUndefined();
  });

  it('never counts my own messages or the chat I am looking at', () => {
    expect(applyIncoming(map, msg('m', ME, '2026-01-01T00:00:00Z'), ME, null)).toBe(map);
    expect(applyIncoming(map, msg('m', 'ravi', '2026-01-01T00:00:00Z'), ME, 'b1')).toBe(map);
    const next = applyIncoming(map, msg('m', 'ravi', '2026-01-01T00:00:00Z'), ME, null);
    expect(next.b1?.unread).toBe(3);
    const fresh = applyIncoming({}, msg('m', 'ravi', '2026-01-01T00:00:00Z', 'b9'), ME, null);
    expect(fresh.b9).toMatchObject({ unread: 1, role: null });
    expect(totalUnread(fresh, 'customer')).toBe(1);
    expect(totalUnread(fresh, 'provider')).toBe(1);
  });

  it('clears a booking and formats badges', () => {
    expect(clearBooking(map, 'b1').b1).toBeUndefined();
    expect(clearBooking(map, 'zzz')).toBe(map);
    expect(badgeLabel(0)).toBeUndefined();
    expect(badgeLabel(7)).toBe('7');
    expect(badgeLabel(120)).toBe('99+');
  });

  it('places the "New messages" divider at the first unread message from the other person', () => {
    const list = [
      msg('a', 'ravi', '2026-01-01T10:00:00Z'),
      msg('b', ME, '2026-01-01T10:01:00Z'),
      msg('c', ME, '2026-01-01T10:03:00Z'),
      msg('d', 'ravi', '2026-01-01T10:04:00Z'),
    ];
    expect(firstUnreadIndex(list, ME, '2026-01-01T10:02:00Z')).toBe(3);
    expect(firstUnreadIndex(list, ME, null)).toBe(0);
    expect(firstUnreadIndex(list, ME, '2026-01-01T11:00:00Z')).toBe(-1);
  });

  it('shows "Seen" only on my latest message once the other side read after it', () => {
    const list = [msg('a', ME, '2026-01-01T10:00:00Z'), msg('b', 'ravi', '2026-01-01T10:01:00Z'), msg('c', ME, '2026-01-01T10:02:00Z')];
    expect(seenMessageId(list, ME, '2026-01-01T10:05:00Z')).toBe('c');
    expect(seenMessageId(list, ME, '2026-01-01T10:01:30Z')).toBeNull();
    expect(seenMessageId(list, ME, null)).toBeNull();
  });

  it('masks contact details in previews like the server', () => {
    expect(maskPreview('Call +91 98765 43210, mail a.b@x.com, pay ravi@okaxis, see https://x.co/a or foo.com/x')).toBe(
      'Call [number], mail [email], pay [upi], see [link] or [link]',
    );
    expect(maskPreview('AC 1.5 ton at 5pm, flat 302')).toBe('AC 1.5 ton at 5pm, flat 302');
    expect(maskPreview('x'.repeat(100), 20)).toHaveLength(20);
  });

  it('follows only our own notification routes', () => {
    expect(notificationRoute({ url: '/chat/3f2c-11' })).toBe('/chat/3f2c-11');
    expect(notificationRoute({ url: '/booking/abc' })).toBe('/booking/abc');
    expect(notificationRoute({ url: '/earnings' }, 'payout_sent')).toBe('/earnings');
    expect(notificationRoute({ url: '/venue/venue-1' })).toBe('/venue/venue-1');
    expect(notificationRoute({ url: '/sports-booking/booking-1' })).toBe('/sports-booking/booking-1');
    expect(notificationRoute({ url: '/recurring/plan-1' })).toBe('/recurring/plan-1');
    expect(notificationRoute({ url: '/shop/shop-1' })).toBe('/shop/shop-1');
    expect(notificationRoute({ url: '/product/product-1' })).toBe('/product/product-1');
    expect(notificationRoute({ url: '/enquiry/enquiry-1' })).toBe('/enquiry/enquiry-1');
    expect(notificationRoute({ url: '/rfq/rfq-1' })).toBe('/rfq/rfq-1');
    expect(notificationRoute({ url: '/rfq/merchant/rfq-1' })).toBe('/rfq/merchant/rfq-1');
    expect(notificationRoute({ url: 'https://evil.example/chat/x' })).toBeNull();
    expect(notificationRoute({ url: '/chat/../../x' })).toBeNull();
    expect(notificationRoute({ url: '/product/../../x' })).toBeNull();
    expect(notificationRoute({ url: '/rfq/merchant/../../x' })).toBeNull();
    expect(notificationRoute({ url: '/earnings/../../x' }, 'payout_sent')).toBeNull();
    expect(notificationRoute(null)).toBeNull();
  });

  it('routes proposal, request and travel notifications that carry no booking link', () => {
    expect(notificationRoute({ request_id: 'r1', proposal_id: 'p1' }, 'proposal_received')).toBe('/request/r1');
    expect(notificationRoute({ request_id: 'r1' }, 'proposal_request_received')).toBe('/proposal/compose/r1');
    expect(notificationRoute({ request_id: 'r1', provider_id: 'pro' }, 'request_message', 'pro')).toBe('/proposal/compose/r1');
    expect(notificationRoute({ request_id: 'r1', provider_id: 'pro' }, 'request_message', 'cust')).toBe('/request/r1');
    expect(notificationRoute({ booking_id: 'b9' }, 'milestone_due')).toBe('/booking/b9');
    expect(notificationRoute({ booking_id: 'b9', kind: 'chat_message' })).toBe('/chat/b9');
    expect(notificationRoute({ url: '/provider/dashboard' }, 'travel_request_created')).toBe('/dashboard');
    expect(notificationRoute({ request_id: '../x' }, 'proposal_received')).toBeNull();
  });

  it('routes recurring plan and sports booking notifications to validated in-app screens', () => {
    expect(notificationRoute({ recurring_schedule_id: 'plan-1' }, 'recurring_plan_requested')).toBe('/recurring/plan-1');
    expect(notificationRoute({ recurring_schedule_id: 'plan-1' }, 'recurring_visit_unavailable')).toBe('/recurring/plan-1');
    expect(notificationRoute(
      { url: '/recurring/provider/plan-1', recurring_schedule_id: 'plan-1' },
      'recurring_plan_requested',
    )).toBe('/recurring/provider/plan-1');
    expect(notificationRoute({ sports_booking_id: 'sports-1' }, 'sports_payment_due')).toBe('/sports-booking/sports-1');
    expect(notificationRoute({ recurring_schedule_id: '../external' }, 'recurring_plan_requested')).toBeNull();
    expect(notificationRoute({ url: '/recurring/provider/../external' }, 'recurring_plan_requested')).toBeNull();
    expect(notificationRoute({ sports_booking_id: '../external' }, 'sports_payment_due')).toBeNull();
  });

  it('lists one entry per chat ("New message from Ravi · AC Repair booking") and newest first', () => {
    const row = (id: string, kind: string, at: string, extra: Partial<AppNotification> = {}): AppNotification => ({
      id, kind, title: 'Ravi', body: 'On my way', data: null, count: 1, booking_id: null, category_name: 'AC Repair', at, read_at: null, ...extra,
    });
    const items = buildNotificationItems(
      [
        row('c1', 'chat_message', '2026-11-16T09:00:00Z', { booking_id: 'b1', body: 'old' }),
        row('c2', 'chat_message', '2026-11-16T10:00:00Z', { booking_id: 'b1', body: 'Reaching in 10 min' }),
        row('q1', 'quote_sent', '2026-11-16T09:30:00Z', { title: 'Quote received', data: { url: '/booking/b1' }, read_at: '2026-11-16T09:31:00Z' }),
      ],
      toUnreadMap([{ booking_id: 'b1', role: 'customer', unread: 2, last_message_at: '2026-11-16T10:00:00Z' }]),
      ME,
    );
    expect(items.map((i) => i.key)).toEqual(['chat:b1', 'q1']);
    expect(items[0]).toMatchObject({ title: '2 new messages from Ravi', body: 'Reaching in 10 min', context: 'AC Repair booking', unread: true, route: '/chat/b1' });
    expect(items[1]).toMatchObject({ title: 'Quote received', unread: false, route: '/booking/b1' });
    expect(chatTitle('Ravi', 1)).toBe('New message from Ravi');
    expect(chatTitle('Ravi', 0)).toBe('Message from Ravi');
  });

  it('CM_CHAT_MEMBER_NOTIFICATION_ITEM synthesizes only an authorized unread chat without inventing a preview', () => {
    const result = buildNotificationItems(
      [],
      toUnreadMap([{
        booking_id: 'booking-member-1',
        role: 'provider',
        unread: 2,
        last_message_at: '2026-11-25T10:00:00.000Z',
      }]),
      ME,
      { 'booking-member-1': { name: 'Customer One', category: 'AC Repair' } },
    );
    const actual = result.map(({ key, title, body, context, at, timeSource, unread, route }) => ({
      key, title, body, context, at, timeSource, unread, route,
    }));
    expect(JSON.stringify({ actual })).toBe(JSON.stringify({
      actual: [{
        key: 'chat:booking-member-1',
        title: '2 new messages from Customer One',
        body: '',
        context: 'AC Repair booking',
        at: '2026-11-25T10:00:00.000Z',
        timeSource: 'message_created_at',
        unread: true,
        route: '/chat/booking-member-1',
      }],
    }));
  });

  it('CM_UI_CHAT_TIMESTAMP_PROVENANCE tags the timestamp actually selected for a chat', () => {
    const row: AppNotification = {
      id: 'chat-row',
      kind: 'chat_message',
      title: 'Provider One',
      body: 'A preview',
      data: { _notification_time_source: 'legacy_created_at' },
      count: 2,
      booking_id: 'booking-1',
      category_name: null,
      at: '2026-11-25T09:00:00.000Z',
      read_at: null,
    };
    const fromMessage = buildNotificationItems(
      [row],
      toUnreadMap([{
        booking_id: 'booking-1',
        role: 'customer',
        unread: 1,
        last_message_at: '2026-11-25T10:00:00.000Z',
      }]),
      ME,
    )[0];
    const fromRow = buildNotificationItems(
      [{ ...row, at: '2026-11-25T11:00:00.000Z' }],
      toUnreadMap([{
        booking_id: 'booking-1',
        role: 'customer',
        unread: 1,
        last_message_at: '2026-11-25T10:00:00.000Z',
      }]),
      ME,
    )[0];
    const actual = {
      message: { at: fromMessage?.at, timeSource: fromMessage?.timeSource },
      row: { at: fromRow?.at, timeSource: fromRow?.timeSource },
    };
    expect(JSON.stringify({ actual })).toBe(JSON.stringify({
      actual: {
        message: { at: '2026-11-25T10:00:00.000Z', timeSource: 'message_created_at' },
        row: { at: '2026-11-25T11:00:00.000Z', timeSource: 'legacy_created_at' },
      },
    }));
  });

  it('CM_UI_TIMESTAMP_SOURCE_FALLBACK never turns an unknown timestamp into now or a dated group', () => {
    const unknown = {
      key: 'legacy',
      kind: 'booking_accepted',
      title: 'Accepted',
      body: '',
      context: null,
      at: 'not-a-time',
      timeSource: 'queued_event' as const,
      unread: true,
      route: null,
    };
    const presentation = notificationTimePresentation(unknown, Date.parse('2026-11-25T12:00:00.000Z'));
    const groups = groupNotificationItems([unknown], Date.parse('2026-11-25T12:00:00.000Z'));
    const missingSource = notificationTimePresentation({
      at: '2026-11-25T10:00:00.000Z',
      timeSource: 'unknown',
    }, Date.parse('2026-11-25T12:00:00.000Z'));
    const missingMarkerRow = buildNotificationItems([{
      id: 'missing-marker',
      kind: 'booking_accepted',
      title: 'Accepted',
      body: '',
      data: null,
      count: 1,
      booking_id: null,
      category_name: null,
      at: '2026-11-25T10:00:00.000Z',
      read_at: null,
    }], {}, ME)[0];
    const missingMarker = missingMarkerRow
      ? notificationTimePresentation(missingMarkerRow, Date.parse('2026-11-25T12:00:00.000Z'))
      : null;
    const actual = {
      presentation,
      group: groups[0]?.label,
      missingSource,
      missingMarkerSource: missingMarkerRow?.timeSource,
      missingMarker,
    };
    expect(JSON.stringify({ actual })).toBe(JSON.stringify({
      actual: {
        presentation: {
          label: 'Time unavailable',
          accessibilityLabel: 'Notification time source is unavailable',
        },
        group: 'Date unavailable',
        missingSource: {
          label: 'Time unavailable',
          accessibilityLabel: 'Notification time source is unavailable',
        },
        missingMarkerSource: 'unknown',
        missingMarker: {
          label: 'Time unavailable',
          accessibilityLabel: 'Notification time source is unavailable',
        },
      },
    }));
  });

  it('CM_UI_LEGACY_TIMESTAMP_LABEL and CM_NOTIFICATION_DATE_GROUPS preserve historical provenance', () => {
    const item = {
      key: 'legacy',
      kind: 'booking_accepted',
      title: 'Accepted',
      body: '',
      context: null,
      at: '2026-11-25T10:00:00.000Z',
      timeSource: 'legacy_created_at' as const,
      unread: true,
      route: null,
    };
    const presentation = notificationTimePresentation(item, Date.parse('2026-11-25T11:00:00.000Z'));
    const groups = groupNotificationItems([item], Date.parse('2026-11-25T11:00:00.000Z'));
    const actual = {
      label: presentation.label,
      historicalActivityUnknown: presentation.accessibilityLabel.includes('latest historical activity time is unknown'),
      forbidsActivityClaim: !/Updated|Latest activity|Last event/.test(presentation.accessibilityLabel),
      groups: groups.map(({ label }) => label),
    };
    expect(JSON.stringify({ actual })).toBe(JSON.stringify({
      actual: {
        label: 'Record created 1h',
        historicalActivityUnknown: true,
        forbidsActivityClaim: true,
        groups: ['Records created Today'],
      },
    }));
  });

  it('CM_NOTIFICATION_DATE_GROUPS distinguish queued events and message timestamps', () => {
    const now = Date.parse('2026-11-25T11:00:00.000Z');
    const item = (key: string, timeSource: 'queued_event' | 'message_created_at') => ({
      key,
      kind: 'chat_message',
      title: key,
      body: '',
      context: null,
      at: '2026-11-25T10:00:00.000Z',
      timeSource,
      unread: true,
      route: null,
    });
    const queued = item('queued', 'queued_event');
    const message = item('message', 'message_created_at');
    const actual = {
      labels: groupNotificationItems([queued, message], now).map(({ label }) => label),
      queuedTime: notificationTimePresentation(queued, now).label,
      messageTime: notificationTimePresentation(message, now).label,
    };
    expect(JSON.stringify({ actual })).toBe(JSON.stringify({
      actual: {
        labels: ['Activity recorded Today', 'Messages Today'],
        queuedTime: 'Recorded 1h',
        messageTime: 'Message 1h',
      },
    }));
  });
});

describe('demo api — unread counts mirror the server rules', () => {
  beforeEach(() => {
    demoControls.reset();
    demoControls.setLatency(0, 0);
    demoControls.setAutopilot(false);
    demoControls.signInForTests();
  });

  it('counts the other side\'s messages, clears on read, and the sender never sees their own as unread', async () => {
    const me = (await api.getSession())!.userId;
    const booking = demoControls.db().bookings.find((b) => b.customer_id === me && !['pending_payment', 'declined', 'expired', 'cancelled'].includes(b.status))!;
    const other = booking.provider_id;
    const heard: string[] = [];
    const unsubscribe = api.subscribeToMyMessages((m) => heard.push(m.id));

    await api.markChatRead(booking.id);
    expect((await api.getUnreadCounts()).find((r) => r.booking_id === booking.id)).toBeUndefined();

    demoControls.db().messages.push({ id: 'x1', booking_id: booking.id, sender_id: other, body: 'hi', image_url: null, created_at: new Date(Date.now() + 1000).toISOString() });
    const row = (await api.getUnreadCounts()).find((r) => r.booking_id === booking.id);
    expect(row).toMatchObject({ unread: 1, role: 'customer' });

    await api.sendMessage(booking.id, 'my reply');
    expect(heard).toHaveLength(1);
    const state = await api.getChatReadState(booking.id);
    expect(state.my_last_read_at).not.toBeNull();

    await api.markChatRead(booking.id);
    await new Promise((r) => setTimeout(r, 5));
    demoControls.db().messages.forEach((m) => {
      if (m.id === 'x1') m.created_at = new Date(Date.now() - 1000).toISOString();
    });
    expect((await api.getUnreadCounts()).find((r) => r.booking_id === booking.id)).toBeUndefined();
    unsubscribe();
  });

  it('rejects read-state calls for bookings the user is not part of', async () => {
    await expect(api.markChatRead('no-such-booking')).rejects.toThrow();
  });
});
