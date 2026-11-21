import type { Message } from '../../lib/types';
import { ChatComposer, useChat } from '../ChatPanel';

const mockHookRuntime = {
  cursor: 0,
  slots: [] as unknown[],
  initialized: new Set<number>(),
  deps: new Map<number, unknown[] | undefined>(),
  callbacks: new Map<number, { deps: unknown[] | undefined; callback: unknown }>(),
  cleanups: new Map<number, (() => void) | undefined>(),
  pendingEffects: new Map<number, () => void | (() => void)>(),
};
const mockListMessages = jest.fn<Promise<Message[]>, [string]>();
const mockSubscribeToMessages = jest.fn<() => void, [string, (message: Message) => void]>();
const mockSendProtectedBookingMessage = jest.fn<Promise<{ message_id: string; nudge: boolean }>, [string, string]>();
const mockTap = jest.fn();

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

jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
  Pressable: 'Pressable',
  TextInput: 'TextInput',
  View: 'View',
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView' },
  FadeInUp: { duration: jest.fn(() => 'FadeInUp') },
}));
jest.mock('../../lib/api', () => ({
  listMessages: (...args: [string]) => mockListMessages(...args),
  subscribeToMessages: (...args: [string, (message: Message) => void]) => mockSubscribeToMessages(...args),
}));
jest.mock('../../lib/leakageChat', () => ({
  sendProtectedBookingMessage: (...args: [string, string]) => mockSendProtectedBookingMessage(...args),
}));
jest.mock('../../lib/haptics', () => ({ haptics: { tap: (...args: []) => mockTap(...args) } }));
jest.mock('../../theme', () => ({
  useTheme: () => ({
    spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, huge: 48 },
    colors: {
      surfaceAlt: '#eee',
      muted: '#777',
      text: '#111',
      bubbleMine: '#05a',
      bubbleTheirs: '#eee',
      outline: '#ccc',
      surface: '#fff',
      primary: '#05a',
      primaryPressed: '#048',
      subtle: '#aaa',
      primaryText: '#fff',
    },
    fontFamily: { regular: 'regular' },
  }),
}));
jest.mock('../ui', () => ({ Avatar: 'Avatar', Text: 'Text' }));

function message(id: string, createdAt: string, body = id): Message {
  return {
    id,
    booking_id: 'booking-1',
    sender_id: 'provider-1',
    body,
    image_url: null,
    created_at: createdAt,
  };
}

function renderChat(bookingId = 'booking-1', actorId?: string) {
  mockHookRuntime.cursor = 0;
  const hook = useChat as unknown as (id: string, userId?: string) => ReturnType<typeof useChat>;
  return hook(bookingId, actorId);
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
  for (let i = 0; i < 6; i++) await Promise.resolve();
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

function resetRuntime() {
  mockHookRuntime.cursor = 0;
  mockHookRuntime.slots = [];
  mockHookRuntime.initialized.clear();
  mockHookRuntime.deps.clear();
  mockHookRuntime.callbacks.clear();
  mockHookRuntime.cleanups.clear();
  mockHookRuntime.pendingEffects.clear();
}

beforeEach(() => {
  resetRuntime();
  mockListMessages.mockReset();
  mockSubscribeToMessages.mockReset().mockReturnValue(jest.fn());
  mockSendProtectedBookingMessage.mockReset().mockResolvedValue({ message_id: 'sent-1', nudge: false });
  mockTap.mockReset();
});

describe('useChat', () => {
  it('CM_CHAT_ACK_WITHOUT_REALTIME refetches an accepted message once without a subscription event', async () => {
    const accepted = message('sent-1', '2026-11-21T12:00:00.000Z', 'Accepted');
    mockListMessages.mockResolvedValueOnce([]).mockResolvedValueOnce([accepted]);
    mockSendProtectedBookingMessage.mockResolvedValueOnce({ message_id: 'sent-1', nudge: true });
    const mounted = renderChat();
    flushEffects();
    await settle();
    expect(renderChat().messages).toEqual([]);

    await mounted.send('Accepted');

    expect(mockListMessages).toHaveBeenCalledTimes(2);
    expect(renderChat().messages).toEqual([accepted]);
    expect(renderChat().nudge).toBe(true);
    expect(mockTap).toHaveBeenCalledTimes(1);
  });

  it('CM_CHAT_SNAPSHOT_EVENT_MERGE merges a realtime event into the delayed initial snapshot by id and order', async () => {
    let resolveSnapshot!: (messages: Message[]) => void;
    mockListMessages.mockReturnValueOnce(
      new Promise<Message[]>((resolve) => {
        resolveSnapshot = resolve;
      }),
    );
    const mounted = renderChat();
    flushEffects();
    const event = message('b', '2026-11-21T12:00:02.000Z', 'Realtime');
    const subscribe = mockSubscribeToMessages.mock.calls[0]?.[1];
    expect(subscribe).toBeTruthy();
    subscribe?.(event);
    expect(renderChat().messages).toEqual([event]);

    resolveSnapshot([
      message('a', '2026-11-21T12:00:01.000Z', 'Earlier'),
      event,
      message('c', '2026-11-21T12:00:02.000Z', 'Same time'),
    ]);
    await settle();

    expect(renderChat().messages?.map(({ id }) => id)).toEqual(['a', 'b', 'c']);
    expect(renderChat().messages?.filter(({ id }) => id === 'b')).toHaveLength(1);
    expect(mounted).toBeTruthy();
  });

  it('CM_CHAT_ERROR_NOT_EMPTY keeps a failed initial read retryable instead of presenting an empty conversation', async () => {
    const recovered = message('recovered', '2026-11-21T12:00:00.000Z');
    mockListMessages.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([recovered]);
    renderChat();
    flushEffects();
    await settle();
    const failed = renderChat() as ReturnType<typeof useChat> & {
      phase?: string;
      reload?: () => Promise<void>;
    };

    expect(failed.messages).toBeNull();
    expect(failed.phase).toBe('error');
    expect(failed.error).toBe('offline');
    await failed.reload?.();
    expect(renderChat().messages).toEqual([recovered]);
  });

  it('clears prior booking messages when the booking or actor key changes', async () => {
    const first = message('first', '2026-11-21T12:00:00.000Z');
    const second = { ...message('second', '2026-11-21T12:01:00.000Z'), booking_id: 'booking-2' };
    mockListMessages.mockResolvedValueOnce([first]).mockResolvedValueOnce([second]);
    renderChat('booking-1', 'customer-1');
    flushEffects();
    await settle();
    expect(renderChat('booking-1', 'customer-1').messages).toEqual([first]);

    const switched = renderChat('booking-2', 'provider-2');
    expect(switched.phase).toBe('loading');
    expect(switched.messages).toBeNull();
    flushEffects();
    await settle();

    expect(mockListMessages).toHaveBeenLastCalledWith('booking-2');
    expect(renderChat('booking-2', 'provider-2').messages).toEqual([second]);
  });

  it('CM_CHAT_REMOTE_CLOSE leaves a direct send rejection to the existing server guard', async () => {
    mockListMessages.mockResolvedValue([]);
    mockSendProtectedBookingMessage.mockRejectedValueOnce(new Error('chat is closed for this booking'));
    const mounted = renderChat();
    flushEffects();
    await settle();
    expect(await mounted.send('Keep this draft')).toBe(false);
    expect(mockSendProtectedBookingMessage).toHaveBeenCalledWith('booking-1', 'Keep this draft');
    expect(renderChat().error).toBe('chat is closed for this booking');
  });

  it('keeps the composer draft when the server rejects a send', async () => {
    mockHookRuntime.cursor = 0;
    const onSend = jest.fn<Promise<boolean>, [string]>().mockResolvedValue(false);
    const tree = ChatComposer({ counterpartName: 'Provider One', sending: false, onSend });
    const input = findElements(tree, 'TextInput')[0];
    (input?.props.onChangeText as ((text: string) => void) | undefined)?.('Keep this draft');

    mockHookRuntime.cursor = 0;
    const edited = ChatComposer({ counterpartName: 'Provider One', sending: false, onSend });
    const press = findElements(edited, 'Pressable')[0];
    (press?.props.onPress as (() => void) | undefined)?.();
    await settle();
    mockHookRuntime.cursor = 0;
    const afterFailure = ChatComposer({ counterpartName: 'Provider One', sending: false, onSend });

    expect(onSend).toHaveBeenCalledWith('Keep this draft');
    expect(findElements(afterFailure, 'TextInput')[0]?.props.value).toBe('Keep this draft');
  });
});
