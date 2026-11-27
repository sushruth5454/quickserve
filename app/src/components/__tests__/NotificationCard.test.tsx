import React from 'react';
import type { NotificationItem } from '../../lib/unread';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native', () => ({ Pressable: 'Pressable', View: 'View' }));
jest.mock('../ui', () => ({ Text: 'Text' }));
jest.mock('../../theme', () => ({
  useTheme: () => ({
    spacing: { md: 12, sm: 8 },
    radii: { lg: 16 },
    colors: {
      primary: '#123',
      border: '#456',
      surface: '#fff',
      surfaceAlt: '#eee',
      primaryText: '#123',
    },
  }),
}));

import { NotificationCard } from '../NotificationCard';
import { notificationRoute } from '../../lib/unread';

function notification(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    key: 'event-1',
    kind: 'booking_accepted',
    title: 'Your booking was accepted',
    body: 'The provider accepted your booking request.',
    context: 'AC Repair booking',
    at: '2025-01-01T04:30:00.000Z',
    timeSource: 'queued_event',
    unread: true,
    route: '/booking/booking-a',
    ...overrides,
  };
}

function textContent(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join(' ');
  if (!React.isValidElement(node)) return '';
  return textContent((node.props as { children?: React.ReactNode }).children);
}

describe('NotificationCard', () => {
  it('CM_NOTIFICATION_CARD_CONTRACT: supplies actual event, context, meaning, unread, exact time and action', () => {
    const item = notification();
    const onOpen = jest.fn();
    const card = NotificationCard({ item, pending: false, onOpen, now: Date.parse(item.at) });
    const renderedText = textContent(card);

    expect(renderedText).toContain(item.title);
    expect(renderedText).toContain(item.context);
    expect(renderedText).toContain(item.body);
    expect(renderedText).toContain('Unread');
    expect(renderedText).toContain('Open');
    expect(card.props.accessibilityLabel).toContain('2025');
    expect(card.props.accessibilityHint).toContain('Opens the related');
    expect(renderedText).not.toMatch(/\b(Paid|Refunded|Settled)\b/);

    card.props.onPress();
    expect(onOpen).toHaveBeenCalledWith(item);
  });

  it('CM_NOTIFICATION_SAFE_ROUTES: rejects untrusted routes and retains an authorized booking fallback', () => {
    expect(notificationRoute({ url: 'https://example.invalid' }, 'booking_accepted')).toBeNull();
    expect(notificationRoute({ url: '/chat/../admin', booking_id: 'booking-a' }, 'chat_message')).toBe('/chat/booking-a');
    expect(notificationRoute({ url: '/support/thread-1' }, 'support_message')).toBe('/support/thread-1');
  });
});
