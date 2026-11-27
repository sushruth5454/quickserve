import type { AppNotification, UnreadMap } from '../../lib/unread';
import type React from 'react';
import { JSDOM } from 'jsdom';

const mockDom = new JSDOM('<!doctype html><html><body></body></html>');
Object.defineProperty(globalThis, 'window', { configurable: true, value: mockDom.window });
Object.defineProperty(globalThis, 'document', { configurable: true, value: mockDom.window.document });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: mockDom.window.navigator });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockApi = {
  listNotifications: jest.fn<Promise<AppNotification[]>, [number?]>(),
  markNotificationsRead: jest.fn<Promise<void>, [string[] | null]>(),
  getChatHeading: jest.fn<Promise<{ name: string; category: string | null } | null>, [string]>(),
};
const mockRouter = { push: jest.fn() };
const mockUnread = {
  map: {} as UnreadMap,
  refresh: jest.fn<Promise<void>, []>(),
};
let mockUserId: string | null = 'customer-1';
interface NotificationScreenRoot {
  render(children: React.ReactNode): void;
  unmount(): void;
}

let root: NotificationScreenRoot | null = null;
let host: HTMLDivElement | null = null;

jest.doMock('expo-router', () => {
  const ReactModule = require('react') as typeof import('react');
  return {
    router: mockRouter,
    useFocusEffect(callback: () => void | (() => void)) {
      ReactModule.useEffect(() => callback(), [callback]);
    },
  };
});

jest.doMock('@expo/vector-icons', () => ({
  Ionicons: () => null,
}));

jest.doMock('react-native', () => {
  const ReactModule = require('react') as typeof import('react');
  return {
    Pressable: ({
      children,
      onPress,
      disabled,
      accessibilityLabel,
      accessibilityHint,
      accessibilityState,
    }: {
      children?: React.ReactNode;
      onPress?: () => void;
      disabled?: boolean;
      accessibilityLabel?: string;
      accessibilityHint?: string;
      accessibilityState?: { busy?: boolean; disabled?: boolean };
    }) => ReactModule.createElement('button', {
      type: 'button',
      onClick: onPress,
      disabled,
      'aria-label': accessibilityLabel,
      'aria-description': accessibilityHint,
      'aria-busy': accessibilityState?.busy,
    }, children),
    View: ({ children }: { children?: React.ReactNode }) => ReactModule.createElement('div', null, children),
  };
});

jest.doMock('../ui', () => {
  const ReactModule = require('react') as typeof import('react');
  return {
    Button: ({
      title,
      onPress,
      disabled,
      loading,
    }: {
      title: string;
      onPress?: () => void;
      disabled?: boolean;
      loading?: boolean;
    }) => ReactModule.createElement('button', {
      type: 'button',
      onClick: onPress,
      disabled,
      'aria-busy': loading,
    }, title),
    EmptyState: ({ title, message }: { title: string; message: string }) =>
      ReactModule.createElement('section', null,
        ReactModule.createElement('h2', null, title),
        ReactModule.createElement('p', null, message)),
    ErrorState: ({ message, onRetry }: { message?: string | null; onRetry?: () => void }) =>
      ReactModule.createElement('section', { role: 'alert' },
        ReactModule.createElement('p', null, message),
        ReactModule.createElement('button', { type: 'button', onClick: onRetry }, 'Try again')),
    Header: ({ title }: { title: string }) => ReactModule.createElement('h1', null, title),
    InlineAlert: ({ message }: { message?: string | null }) =>
      message ? ReactModule.createElement('div', { role: 'alert' }, message) : null,
    Screen: ({
      header,
      children,
      onRefresh,
    }: {
      header?: React.ReactNode;
      children?: React.ReactNode;
      onRefresh?: () => void;
    }) => ReactModule.createElement('main', null,
      header,
      children,
      ReactModule.createElement('button', { type: 'button', onClick: onRefresh }, 'Refresh')),
    Skeleton: () => ReactModule.createElement('div', { 'data-testid': 'skeleton' }),
    Text: ({
      children,
      accessibilityRole,
      accessibilityLabel,
    }: {
      children?: React.ReactNode;
      accessibilityRole?: string;
      accessibilityLabel?: string;
    }) => ReactModule.createElement('span', {
      role: accessibilityRole === 'header' ? 'heading' : undefined,
      'aria-label': accessibilityLabel,
    }, children),
  };
});

jest.doMock('../../lib/api', () => ({
  listNotifications: (...args: [number?]) => mockApi.listNotifications(...args),
  markNotificationsRead: (...args: [string[] | null]) => mockApi.markNotificationsRead(...args),
  getChatHeading: (...args: [string]) => mockApi.getChatHeading(...args),
}));
jest.doMock('../../lib/auth', () => ({
  useAuth: () => ({ userId: mockUserId }),
}));
jest.doMock('../../lib/unreadContext', () => ({
  useUnread: () => mockUnread,
}));
jest.doMock('../../theme', () => ({
  useTheme: () => ({
    spacing: { sm: 8, md: 12 },
    radii: { md: 12 },
    colors: {
      primary: '#000',
      primaryText: '#000',
      primarySoft: '#eee',
      border: '#ccc',
      surface: '#fff',
      surfaceAlt: '#eee',
    },
  }),
}));

const ReactRuntime = require('react') as typeof import('react');
const { act } = require('react') as typeof import('react');
const { createRoot } = require('react-dom/client') as {
  createRoot(container: Element): NotificationScreenRoot;
};
const NotificationsScreen = require('../../features/communicationScreens/NotificationsScreen').default as React.ComponentType;

function notification(
  id: string,
  overrides: Partial<AppNotification> = {},
): AppNotification {
  return {
    id,
    kind: 'booking_accepted',
    title: 'Booking accepted',
    body: '',
    data: { _notification_time_source: 'legacy_created_at' },
    count: 1,
    booking_id: null,
    category_name: null,
    at: '2026-11-25T10:00:00.000Z',
    read_at: null,
    ...overrides,
  };
}

async function settle() {
  for (let index = 0; index < 8; index++) await Promise.resolve();
}

async function renderScreen() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(ReactRuntime.createElement(NotificationsScreen));
    await settle();
  });
  return host;
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();
  });
}

beforeEach(() => {
  mockUserId = 'customer-1';
  mockUnread.map = {};
  mockUnread.refresh.mockReset().mockResolvedValue(undefined);
  mockApi.listNotifications.mockReset().mockResolvedValue([notification('booking-1')]);
  mockApi.markNotificationsRead.mockReset().mockResolvedValue(undefined);
  mockApi.getChatHeading.mockReset().mockResolvedValue({ name: 'Customer One', category: 'AC Repair' });
  mockRouter.push.mockReset();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

describe('NotificationsScreen', () => {
  it('CM_NOTIFICATION_READ_ROLLBACK keeps an unread row on failed acknowledgement and guards duplicate taps', async () => {
    let rejectAcknowledgement: ((error: Error) => void) | undefined;
    let serverRows = [notification('booking-1')];
    mockApi.listNotifications.mockImplementation(async () => serverRows);
    mockApi.markNotificationsRead
      .mockImplementationOnce(() => new Promise((_, reject) => {
        rejectAcknowledgement = reject;
      }))
      .mockImplementationOnce(async () => {
        serverRows = serverRows.map((row) => ({ ...row, read_at: '2026-11-25T11:00:00.000Z' }));
      });
    const view = await renderScreen();
    const row = view.querySelector('button[aria-label^="Unread."]');
    expect(JSON.stringify({ foundUnreadRow: !!row })).toBe(JSON.stringify({ foundUnreadRow: true }));
    await click(row!);
    const pending = row?.getAttribute('aria-busy');
    await click(row!);
    expect(JSON.stringify({ pending, callsWhilePending: mockApi.markNotificationsRead.mock.calls.length }))
      .toBe(JSON.stringify({ pending: 'true', callsWhilePending: 1 }));
    await act(async () => {
      rejectAcknowledgement?.(new Error('acknowledgement denied'));
      await settle();
    });
    const actual = {
      rowStillUnread: !!view.querySelector('button[aria-label^="Unread."]'),
      rowHasBookingTitle: view.querySelector('button[aria-label^="Unread."]')?.getAttribute('aria-label')?.includes('Booking accepted'),
      error: view.querySelector('[role="alert"]')?.textContent,
      calls: mockApi.markNotificationsRead.mock.calls.length,
      canonicalReads: mockApi.listNotifications.mock.calls.length,
    };
    expect(JSON.stringify({ actual })).toBe(JSON.stringify({
      actual: {
        rowStillUnread: true,
        rowHasBookingTitle: true,
        error: 'acknowledgement denied',
        calls: 1,
        canonicalReads: 2,
      },
    }));
    await click(view.querySelector('button[aria-label^="Unread."]')!);
    const recovered = {
      unreadRowCount: view.querySelectorAll('button[aria-label^="Unread."]').length,
      acknowledgementCalls: mockApi.markNotificationsRead.mock.calls.length,
      canonicalReads: mockApi.listNotifications.mock.calls.length,
      errors: [...view.querySelectorAll('[role="alert"]')].map((element) => element.textContent),
    };
    expect(JSON.stringify({ recovered })).toBe(JSON.stringify({
      recovered: {
        unreadRowCount: 0,
        acknowledgementCalls: 2,
        canonicalReads: 3,
        errors: [],
      },
    }));
  });

  it('keeps a new same-user read guard when an old signed-out acknowledgement finishes late', async () => {
    let rejectOld: ((error: Error) => void) | undefined;
    let resolveCurrent: (() => void) | undefined;
    let serverRows = [notification('booking-1')];
    mockApi.listNotifications.mockImplementation(async () => serverRows);
    mockApi.markNotificationsRead
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject; }))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveCurrent = () => {
          serverRows = serverRows.map((row) => ({ ...row, read_at: '2026-11-25T11:00:00.000Z' }));
          resolve();
        };
      }));
    const view = await renderScreen();
    await click(view.querySelector('button[aria-label^="Unread."]')!);

    await act(async () => {
      mockUserId = null;
      root?.render(ReactRuntime.createElement(NotificationsScreen));
      await settle();
    });
    await act(async () => {
      mockUserId = 'customer-1';
      root?.render(ReactRuntime.createElement(NotificationsScreen));
      await settle();
    });
    const currentRow = view.querySelector('button[aria-label^="Unread."]');
    expect(JSON.stringify({ currentActorRowLoaded: !!currentRow })).toBe(JSON.stringify({ currentActorRowLoaded: true }));
    await click(currentRow!);
    await act(async () => {
      rejectOld?.(new Error('old actor request failed'));
      await settle();
    });
    const busyBeforeDuplicate = view.querySelector('button[aria-label^="Unread."]')?.getAttribute('aria-busy');
    await click(view.querySelector('button[aria-label^="Unread."]')!);
    const whileCurrentPending = {
      calls: mockApi.markNotificationsRead.mock.calls.length,
      busy: view.querySelector('button[aria-label^="Unread."]')?.getAttribute('aria-busy'),
      error: [...view.querySelectorAll('[role="alert"]')].map((element) => element.textContent),
    };
    expect(JSON.stringify({ actual: { busyBeforeDuplicate, whileCurrentPending } })).toBe(JSON.stringify({
      actual: {
        busyBeforeDuplicate: 'true',
        whileCurrentPending: { calls: 2, busy: 'true', error: [] },
      },
    }));
    await act(async () => {
      resolveCurrent?.();
      await settle();
    });
    const afterRecovery = {
      unreadRows: view.querySelectorAll('button[aria-label^="Unread."]').length,
      errors: [...view.querySelectorAll('[role="alert"]')].map((element) => element.textContent),
      canonicalReads: mockApi.listNotifications.mock.calls.length,
    };
    expect(JSON.stringify({ actual: afterRecovery })).toBe(JSON.stringify({
      actual: { unreadRows: 0, errors: [], canonicalReads: 3 },
    }));
  });

  it('CM_NOTIFICATION_MARK_ALL_CHAT_INDEPENDENT reconciles non-chat rows without clearing chat read state', async () => {
    const chat = notification('chat-outbox', {
      kind: 'chat_message',
      title: 'Provider One',
      body: 'Message preview',
      booking_id: 'booking-chat',
      data: { _notification_time_source: 'queued_event' },
    });
    const event = notification('booking-event', { title: 'Booking update' });
    let canonicalRows = [chat, event];
    mockUnread.map = {
      'booking-chat': {
        booking_id: 'booking-chat',
        role: 'customer',
        unread: 2,
        last_message_at: '2026-11-25T10:00:00.000Z',
      },
    };
    mockApi.listNotifications.mockImplementation(async () => canonicalRows);
    mockApi.markNotificationsRead.mockImplementation(async (ids) => {
      expect(JSON.stringify({ ids })).toBe(JSON.stringify({ ids: null }));
      canonicalRows = canonicalRows.map((row) => ({ ...row, read_at: '2026-11-25T11:00:00.000Z' }));
    });
    const view = await renderScreen();
    const markAll = [...view.querySelectorAll('button')].find((button) => button.textContent === 'Mark all as read');
    expect(JSON.stringify({ markAllFound: !!markAll })).toBe(JSON.stringify({ markAllFound: true }));
    await click(markAll!);
    const rowLabels = [...view.querySelectorAll('button[aria-label]')]
      .map((button) => button.getAttribute('aria-label') ?? '');
    const actual = {
      chatStillUnread: rowLabels.some((label) => label.startsWith('Unread. 2 new messages from Provider One')),
      nonChatRead: rowLabels.some((label) => label.includes('Booking update') && !label.startsWith('Unread.')),
      readArgs: mockApi.markNotificationsRead.mock.calls[0]?.[0],
      reads: mockApi.listNotifications.mock.calls.length,
      refreshes: mockUnread.refresh.mock.calls.length,
    };
    expect(JSON.stringify({ actual })).toBe(JSON.stringify({
      actual: {
        chatStillUnread: true,
        nonChatRead: true,
        readArgs: null,
        reads: 2,
        refreshes: 2,
      },
    }));
  });

  it('CM_NOTIFICATION_MARK_ALL_CHAT_INDEPENDENT retains unread presentation when the all-read acknowledgement fails', async () => {
    const chat = notification('chat-outbox', {
      kind: 'chat_message',
      title: 'Provider One',
      body: 'Message preview',
      booking_id: 'booking-chat',
      data: { _notification_time_source: 'queued_event' },
    });
    const event = notification('booking-event', { title: 'Booking update' });
    mockApi.listNotifications.mockResolvedValue([chat, event]);
    mockApi.markNotificationsRead.mockRejectedValue(new Error('all-read denied'));
    mockUnread.map = {
      'booking-chat': {
        booking_id: 'booking-chat',
        role: 'customer',
        unread: 2,
        last_message_at: '2026-11-25T10:00:00.000Z',
      },
    };
    const view = await renderScreen();
    const markAll = [...view.querySelectorAll('button')].find((button) => button.textContent === 'Mark all as read');
    expect(JSON.stringify({ markAllFound: !!markAll })).toBe(JSON.stringify({ markAllFound: true }));
    await click(markAll!);
    const labels = [...view.querySelectorAll('button[aria-label]')]
      .map((button) => button.getAttribute('aria-label') ?? '');
    const actual = {
      chatStillUnread: labels.some((label) => label.startsWith('Unread. 2 new messages from Provider One')),
      nonChatStillUnread: labels.some((label) => label.startsWith('Unread. Booking update')),
      error: view.querySelector('[role="alert"]')?.textContent,
      reads: mockApi.listNotifications.mock.calls.length,
    };
    expect(JSON.stringify({ actual })).toBe(JSON.stringify({
      actual: {
        chatStillUnread: true,
        nonChatStillUnread: true,
        error: 'all-read denied',
        reads: 2,
      },
    }));
  });

  it('keeps navigation and acknowledgement errors separate while displaying exact legacy provenance', async () => {
    mockApi.listNotifications.mockResolvedValue([notification('booking-1', {
      data: { _notification_time_source: 'legacy_created_at', url: '/booking/booking-1' },
    })]);
    mockRouter.push.mockImplementation(() => {
      throw new Error('navigation failed');
    });
    const view = await renderScreen();
    const row = view.querySelector('button[aria-label^="Unread."]');
    const provenance = {
      label: row?.getAttribute('aria-label'),
      visibleTime: view.textContent?.includes('Record created'),
    };
    expect(JSON.stringify({
      actual: {
        hasUnknownHistoryNotice: provenance.label?.includes('latest historical activity time is unknown') ?? false,
        visibleLegacyTime: provenance.visibleTime,
      },
    })).toBe(JSON.stringify({
      actual: { hasUnknownHistoryNotice: true, visibleLegacyTime: true },
    }));
    await click(row!);
    const actual = {
      navigationError: view.querySelector('[role="alert"]')?.textContent,
      acknowledgementError: view.textContent?.includes('Could not mark notifications as read.'),
      acknowledgementCalls: mockApi.markNotificationsRead.mock.calls.length,
      route: mockRouter.push.mock.calls.length,
    };
    expect(JSON.stringify({ actual })).toBe(JSON.stringify({
      actual: {
        navigationError: 'navigation failed',
        acknowledgementError: false,
        acknowledgementCalls: 1,
        route: 1,
      },
    }));
  });

  it('CM_CHAT_MEMBER_HEADING_ACTOR_CHANGE discards a late heading fetched for the prior actor', async () => {
    mockUnread.map = {
      'booking-member': {
        booking_id: 'booking-member',
        role: 'provider',
        unread: 1,
        last_message_at: '2026-11-25T10:00:00.000Z',
      },
    };
    let finishOldHeading: ((heading: { name: string; category: string | null }) => void) | undefined;
    mockApi.getChatHeading
      .mockImplementationOnce(() => new Promise((resolve) => { finishOldHeading = resolve; }))
      .mockResolvedValueOnce({ name: 'Current customer', category: 'Current category' });
    const view = await renderScreen();
    await act(async () => {
      mockUserId = 'business-member-2';
      root?.render(ReactRuntime.createElement(NotificationsScreen));
      await settle();
    });
    await act(async () => {
      finishOldHeading?.({ name: 'Prior actor customer', category: 'Prior category' });
      await settle();
    });
    const actual = view.textContent ?? '';
    expect(JSON.stringify({
      actual: {
        currentHeading: actual.includes('New message from Current customer'),
        currentContext: actual.includes('Current category booking'),
        staleHeadingDiscarded: !actual.includes('Prior actor customer'),
      },
    })).toBe(JSON.stringify({
      actual: { currentHeading: true, currentContext: true, staleHeadingDiscarded: true },
    }));
  });
});
