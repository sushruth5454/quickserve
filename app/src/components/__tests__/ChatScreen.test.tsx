jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('../../branding/useBrandIdentity', () => ({
  useBrandIdentity: (context: string) => {
    const { resolveBrandIdentity } = jest.requireActual('../../branding/identity') as typeof import('../../branding/identity');
    return resolveBrandIdentity(context as 'account', {
      brandOn: false,
      runtimeOn: false,
      bundledIdentityReady: false,
      published: null,
    });
  },
}));

import type { Booking, Message } from '../../lib/types';
import ChatDetailScreen from '../../features/communicationScreens/ChatDetailScreen';

const mockHookRuntime = {
  cursor: 0,
  slots: [] as unknown[],
  initialized: new Set<number>(),
  deps: new Map<number, unknown[] | undefined>(),
  callbacks: new Map<number, { deps: unknown[] | undefined; callback: unknown }>(),
  cleanups: new Map<number, (() => void) | undefined>(),
  pendingEffects: new Map<number, () => void | (() => void)>(),
  focusEffect: undefined as (() => void | (() => void)) | undefined,
  bookingId: 'booking-1',
  userId: 'customer-1',
};
const mockChat = {
  messages: [] as Message[] | null,
  phase: 'ready',
  error: null as string | null,
  sending: false,
  nudge: false,
  send: jest.fn<Promise<boolean>, [string]>(),
  reload: jest.fn<Promise<void>, []>(),
};
const mockGetBooking = jest.fn<Promise<Booking>, [string]>();
const mockGetChatReadState = jest.fn<Promise<{ my_last_read_at: string | null; other_last_read_at: string | null }>, [string]>();
const mockGetProfileName = jest.fn<Promise<string>, [string]>();
const mockSubscribeToBooking = jest.fn<() => void, [string, () => void]>();
const mockMarkChatRead = jest.fn<Promise<void>, [string, (boolean | null)?]>();
const mockMarkRead = jest.fn<Promise<void>, [string, boolean]>();
const mockSetActiveChat = jest.fn();
const mockRegisterForPush = jest.fn();
const mockRouter = { back: jest.fn(), canGoBack: jest.fn(), replace: jest.fn() };

jest.mock('react', () => {
  const actual = jest.requireActual<typeof import('react')>('react');
  const sameDeps = (a: unknown[] | undefined, b: unknown[] | undefined) =>
    !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = mockHookRuntime.cursor++;
      if (!mockHookRuntime.initialized.has(index)) {
        mockHookRuntime.initialized.add(index);
        mockHookRuntime.slots[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      }
      return [
        mockHookRuntime.slots[index],
        (next: unknown) => {
          mockHookRuntime.slots[index] =
            typeof next === 'function'
              ? (next as (mockPrevious: unknown) => unknown)(mockHookRuntime.slots[index])
              : next;
        },
      ];
    },
    useRef: (initial: unknown) => {
      const index = mockHookRuntime.cursor++;
      if (!mockHookRuntime.initialized.has(index)) {
        mockHookRuntime.initialized.add(index);
        mockHookRuntime.slots[index] = { current: initial };
      }
      return mockHookRuntime.slots[index];
    },
    useCallback: (callback: unknown, deps?: unknown[]) => {
      const index = mockHookRuntime.cursor++;
      const previous = mockHookRuntime.callbacks.get(index);
      if (previous && sameDeps(previous.deps, deps)) return previous.callback;
      mockHookRuntime.callbacks.set(index, { deps, callback });
      return callback;
    },
    useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
      const index = mockHookRuntime.cursor++;
      if (!mockHookRuntime.deps.has(index) || !sameDeps(mockHookRuntime.deps.get(index), deps)) {
        mockHookRuntime.deps.set(index, deps);
        mockHookRuntime.pendingEffects.set(index, effect);
      }
    },
  };
});

jest.mock('expo-router', () => ({
  router: mockRouter,
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockHookRuntime.cursor++;
    mockHookRuntime.focusEffect = callback;
  },
  useLocalSearchParams: () => {
    mockHookRuntime.cursor++;
    return { bookingId: mockHookRuntime.bookingId };
  },
}));
jest.mock('react-native', () => {
  const mockAppState = {
    currentState: 'active',
    listener: undefined as ((mockState: string) => void) | undefined,
    addEventListener: jest.fn((_event: string, mockListener: (mockState: string) => void) => {
      mockAppState.listener = mockListener;
      return { remove: jest.fn() };
    }),
  };
  return { AppState: mockAppState, ScrollView: 'ScrollView', View: 'View' };
});
jest.mock('../../components/ChatPanel', () => ({
  ChatComposer: 'ChatComposer',
  MessageList: 'MessageList',
  useChat: () => mockChat,
}));
jest.mock('../../components/ui', () => ({
  ErrorState: 'ErrorState',
  Header: 'Header',
  InlineAlert: 'InlineAlert',
  Screen: 'Screen',
  Skeleton: 'Skeleton',
  Text: 'Text',
}));
jest.mock('../../lib/api', () => ({
  getBooking: (...args: [string]) => mockGetBooking(...args),
  getChatReadState: (...args: [string]) => mockGetChatReadState(...args),
  getProfileName: (...args: [string]) => mockGetProfileName(...args),
  markChatRead: (...args: [string, (boolean | null)?]) => mockMarkChatRead(...args),
  subscribeToBooking: (...args: [string, () => void]) => mockSubscribeToBooking(...args),
}));
jest.mock('../../lib/auth', () => ({
  useAuth: () => {
    mockHookRuntime.cursor++;
    return { userId: mockHookRuntime.userId };
  },
}));
jest.mock('../../lib/push', () => ({ registerForPush: (...args: unknown[]) => mockRegisterForPush(...args) }));
jest.mock('../../lib/unreadContext', () => ({
  useUnread: () => {
    mockHookRuntime.cursor++;
    return { setActiveChat: mockSetActiveChat, markRead: mockMarkRead };
  },
}));
jest.mock('../../theme', () => ({
  useTheme: () => ({ spacing: { md: 12, xs: 4 } }),
}));

const mockAppState = (jest.requireMock('react-native') as {
  AppState: {
    currentState: string;
    listener?: (state: string) => void;
    addEventListener: jest.Mock;
  };
}).AppState;

function message(id: string, senderId: string, createdAt: string): Message {
  return {
    id,
    booking_id: 'booking-1',
    sender_id: senderId,
    body: id,
    image_url: null,
    created_at: createdAt,
  };
}

function booking(status: Booking['status']): Booking {
  return {
    id: 'booking-1',
    customer_id: 'customer-1',
    provider_id: 'provider-1',
    category_id: 'category-1',
    provider_service_id: 'service-1',
    description: 'Repair',
    photos: [],
    scheduled_at: null,
    status,
    visit_fee: 0,
    platform_fee: 0,
    approved_quote_id: null,
    total_amount: null,
    created_at: '2026-11-20T12:00:00.000Z',
    categories: { name: 'Repair' },
  } as unknown as Booking;
}

function findElements(node: unknown, type: unknown): Array<{ type: unknown; props: Record<string, any> }> {
  if (Array.isArray(node)) return node.flatMap((child) => findElements(child, type));
  if (!node || typeof node !== 'object') return [];
  const element = node as { type?: unknown; props?: Record<string, any> };
  if (!element.props) return [];
  return [
    ...(element.type === type ? [element as { type: unknown; props: Record<string, any> }] : []),
    ...findElements(element.props.children, type),
  ];
}

function renderScreen() {
  mockHookRuntime.cursor = 0;
  return ChatDetailScreen();
}

function flushEffects() {
  const effects = [...mockHookRuntime.pendingEffects.entries()];
  mockHookRuntime.pendingEffects.clear();
  for (const [index, effect] of effects) {
    mockHookRuntime.cleanups.get(index)?.();
    mockHookRuntime.cleanups.set(index, effect() ?? undefined);
  }
}

async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

async function mountScreen() {
  for (let i = 0; i < 6; i++) {
    renderScreen();
    flushEffects();
    await settle();
  }
  return renderScreen();
}

function resetRuntime() {
  mockHookRuntime.cursor = 0;
  mockHookRuntime.slots = [];
  mockHookRuntime.initialized.clear();
  mockHookRuntime.deps.clear();
  mockHookRuntime.callbacks.clear();
  mockHookRuntime.cleanups.clear();
  mockHookRuntime.pendingEffects.clear();
  mockHookRuntime.focusEffect = undefined;
  mockHookRuntime.bookingId = 'booking-1';
  mockHookRuntime.userId = 'customer-1';
}

beforeEach(() => {
  jest.useFakeTimers();
  resetRuntime();
  mockChat.messages = [];
  mockChat.phase = 'ready';
  mockChat.error = null;
  mockChat.sending = false;
  mockChat.nudge = false;
  mockChat.send.mockReset().mockResolvedValue(true);
  mockChat.reload.mockReset().mockResolvedValue(undefined);
  mockGetBooking.mockReset().mockResolvedValue(booking('accepted'));
  mockGetChatReadState.mockReset().mockResolvedValue({ my_last_read_at: null, other_last_read_at: null });
  mockGetProfileName.mockReset().mockResolvedValue('Provider One');
  mockSubscribeToBooking.mockReset().mockReturnValue(jest.fn());
  mockMarkChatRead.mockReset().mockResolvedValue(undefined);
  mockMarkRead.mockReset().mockResolvedValue(undefined);
  mockSetActiveChat.mockReset();
  mockRegisterForPush.mockReset();
  mockRouter.back.mockReset();
  mockRouter.canGoBack.mockReset().mockReturnValue(false);
  mockRouter.replace.mockReset();
  mockAppState.currentState = 'active';
  mockAppState.listener = undefined;
  mockAppState.addEventListener.mockClear();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('ChatDetailScreen', () => {
  it('CM_CHAT_REMOTE_CLOSE refreshes canonical booking state and removes the composer for all four closed statuses', async () => {
    let status: Booking['status'] = 'accepted';
    let onBookingChange: (() => void) | undefined;
    mockGetBooking.mockImplementation(async () => booking(status));
    mockSubscribeToBooking.mockImplementation((_id, callback) => {
      onBookingChange = callback;
      return jest.fn();
    });
    await mountScreen();
    expect(findElements(findElements(renderScreen(), 'Screen')[0]?.props.footer, 'ChatComposer')).toHaveLength(1);

    for (const next of ['cancelled', 'declined', 'expired', 'pending_payment'] as const) {
      status = next;
      onBookingChange?.();
      await settle();
      const tree = renderScreen();
      const screen = findElements(tree, 'Screen')[0];
      expect(mockGetBooking).toHaveBeenLastCalledWith('booking-1');
      expect(findElements(screen?.props.footer, 'ChatComposer')).toHaveLength(0);
      expect(findElements(screen?.props.footer, 'Text').map(({ props }) => props.children)).toContain(
        'Chat is closed for this booking.',
      );
    }
  });

  it('CM_CHAT_CLOSED_SERVER_RETAIN keeps existing completed and closed booking composer behavior', async () => {
    let status: Booking['status'] = 'completed';
    let onBookingChange: (() => void) | undefined;
    mockGetBooking.mockImplementation(async () => booking(status));
    mockSubscribeToBooking.mockImplementation((_id, callback) => {
      onBookingChange = callback;
      return jest.fn();
    });
    await mountScreen();

    for (const next of ['completed', 'closed', 'closed_no_work'] as const) {
      status = next;
      onBookingChange?.();
      await settle();
      const screen = findElements(renderScreen(), 'Screen')[0];
      expect(findElements(screen?.props.footer, 'ChatComposer')).toHaveLength(1);
    }
  });

  it('CM_CHAT_ERROR_NOT_EMPTY renders Retry rather than an empty-chat message after an initial read error', async () => {
    mockChat.messages = null;
    mockChat.phase = 'error';
    mockChat.error = 'message history unavailable';
    const tree = await mountScreen();
    const retry = findElements(tree, 'ErrorState')[0];

    expect(retry?.props.message).toBe('message history unavailable');
    expect(typeof retry?.props.onRetry).toBe('function');
    expect(findElements(tree, 'MessageList')).toHaveLength(0);
    expect(mockGetChatReadState).not.toHaveBeenCalled();
    expect(mockMarkRead).not.toHaveBeenCalled();
    retry?.props.onRetry();
    expect(mockChat.reload).toHaveBeenCalledTimes(1);
  });

  it('CM_CHAT_UNREAD_RETAIN fixes the opened-read divider across later canonical message reloads', async () => {
    const openedMessages = [
      message('read', 'provider-1', '2026-11-21T11:59:00.000Z'),
      message('first-unread', 'provider-1', '2026-11-21T12:01:00.000Z'),
    ];
    mockChat.messages = openedMessages;
    mockGetChatReadState.mockResolvedValue({
      my_last_read_at: '2026-11-21T12:00:00.000Z',
      other_last_read_at: null,
    });
    await mountScreen();
    const first = findElements(renderScreen(), 'MessageList')[0];
    expect(first?.props.newSinceId).toBe('first-unread');
    expect(mockGetChatReadState).toHaveBeenCalledWith('booking-1');

    mockChat.messages = [...openedMessages, message('later', 'provider-1', '2026-11-21T12:02:00.000Z')];
    const updated = renderScreen();
    flushEffects();
    await settle();
    const afterReload = findElements(updated, 'MessageList')[0];
    expect(afterReload?.props.newSinceId).toBe('first-unread');
  });

  it('reloads canonical booking and chat state when the focused screen resumes', async () => {
    await mountScreen();
    const onFocus = mockHookRuntime.focusEffect;
    expect(onFocus).toBeTruthy();
    const cleanup = onFocus?.();
    await settle();
    const bookingReads = mockGetBooking.mock.calls.length;
    const messageReads = mockChat.reload.mock.calls.length;

    mockAppState.listener?.('background');
    mockAppState.listener?.('active');
    await settle();

    expect(mockGetBooking.mock.calls.length).toBeGreaterThan(bookingReads);
    expect(mockChat.reload.mock.calls.length).toBeGreaterThan(messageReads);
    expect(mockMarkRead).toHaveBeenCalledWith('booking-1', true);
    cleanup?.();
  });
});
