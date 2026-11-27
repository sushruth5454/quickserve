jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
  useLocalSearchParams: () => ({ bookingId: 'booking-a' }),
}));
jest.mock('../../components/ui', () => ({
  Button: 'Button',
  Header: 'Header',
  InlineAlert: 'InlineAlert',
  Input: 'Input',
  Screen: 'Screen',
  Text: 'Text',
  TextArea: 'TextArea',
}));
jest.mock('../../lib/adminApi', () => ({ startSupport: jest.fn() }));

import type { SupportThread } from '../../lib/adminApi';
import {
  communicationsCompositionEnabled,
  isNearScrollEnd,
  shouldAutoScrollForMessage,
  supportThreadPresentation,
} from '../../lib/notificationPresentation';
import { supportStartRequest } from '../../features/communicationScreens/SupportNewScreen';

describe('communications presentation', () => {
  it('CM_SUPPORT_CONTEXT and CM_SUPPORT_CLOSED_UNREAD: keeps linked booking, status, unread, and time independent', () => {
    const thread: SupportThread = {
      id: 'thread-a',
      user_id: 'user-a',
      booking_id: '12345678-0000-0000-0000-000000000000',
      subject: 'Help with a booking',
      status: 'closed',
      user_unread: 2,
      admin_unread: 1,
      last_message: 'We have an update.',
      last_from_admin: true,
      last_message_at: '2025-01-01T04:30:00.000Z',
      created_at: '2024-12-31T18:30:00.000Z',
    };

    const participant = supportThreadPresentation(thread, 'participant', Date.parse(thread.last_message_at));
    const admin = supportThreadPresentation(thread, 'admin', Date.parse(thread.last_message_at));
    expect(participant.statusLabel).toBe('Closed');
    expect(participant.unreadLabel).toBe('2 unread');
    expect(participant.bookingLabel).toBe('Booking QS-12345678');
    expect(participant.timeAccessibilityLabel).toContain('2025');
    expect(admin.unreadLabel).toBe('1 unread');
  });

  it('CM_SUPPORT_BOOKING_SUBJECT: linked support delegates its subject to the server', () => {
    expect(supportStartRequest('booking-a', 'Help with this booking')).toEqual({
      bookingId: 'booking-a',
      subject: null,
    });
    expect(supportStartRequest(undefined, 'Account question')).toEqual({
      bookingId: null,
      subject: 'Account question',
    });
  });

  it('CM_CHAT_HISTORY_SCROLL: incoming messages do not move a reader away from old history', () => {
    expect(isNearScrollEnd({
      contentOffset: { y: 120 },
      contentSize: { height: 1400 },
      layoutMeasurement: { height: 500 },
    })).toBe(false);
    expect(isNearScrollEnd({
      contentOffset: { y: 850 },
      contentSize: { height: 1400 },
      layoutMeasurement: { height: 500 },
    })).toBe(true);
    expect(shouldAutoScrollForMessage(false, false)).toBe(false);
    expect(shouldAutoScrollForMessage(false, true)).toBe(true);
    expect(shouldAutoScrollForMessage(true, false)).toBe(true);
  });

  it('CM_COMMS_PRESENTATION_MATRIX: composition requires both the brand parent and communications leaf', () => {
    expect(communicationsCompositionEnabled({ oorva_brand: true, oorva_comms_ux: true })).toBe(true);
    expect(communicationsCompositionEnabled({ oorva_brand: true, oorva_comms_ux: false })).toBe(false);
    expect(communicationsCompositionEnabled({ oorva_brand: false, oorva_comms_ux: true })).toBe(false);
  });
});
