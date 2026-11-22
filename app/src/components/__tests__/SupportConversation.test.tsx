import type React from 'react';
import { JSDOM } from 'jsdom';

const mockDom = new JSDOM('<!doctype html><html><body></body></html>');
Object.defineProperty(globalThis, 'window', { configurable: true, value: mockDom.window });
Object.defineProperty(globalThis, 'document', { configurable: true, value: mockDom.window.document });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: mockDom.window.navigator });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type SupportThread = {
  id: string;
  user_id: string;
  booking_id: string | null;
  subject: string;
  status: 'open' | 'closed';
  user_unread: number;
  admin_unread: number;
  last_message: string;
  last_from_admin: boolean;
  last_message_at: string;
  created_at: string;
};

type SupportMessage = {
  id: string;
  thread_id: string;
  sender_id: string;
  from_admin: boolean;
  body: string;
  created_at: string;
};

type SupportRead = { thread: SupportThread | null; messages: SupportMessage[] };

const mockAppStateListeners = new Set<(state: string) => void>();
const mockAppState = {
  currentState: 'active',
  addEventListener: jest.fn((_eventName: string, listener: (state: string) => void) => {
    mockAppStateListeners.add(listener);
    return { remove: () => mockAppStateListeners.delete(listener) };
  }),
};
const mockPlatform = { OS: 'web' };
const mockFocusManager = {
  focused: false,
  entries: new Set<{ focus: () => void; blur: () => void }>(),
  setFocused(next: boolean) {
    if (this.focused === next) return;
    this.focused = next;
    for (const entry of [...this.entries]) {
      if (next) entry.focus();
      else entry.blur();
    }
  },
};
const mockApi = {
  loadSupportConversation: jest.fn<Promise<SupportRead>, [string, 'participant' | 'admin', string]>(),
  markSupportRead: jest.fn<Promise<void>, [string]>(),
  sendSupport: jest.fn<Promise<void>, [string, string]>(),
  setSupportStatus: jest.fn<Promise<void>, [string, 'open' | 'closed']>(),
};
const mockToast = jest.fn();
const mockConfirm = jest.fn<Promise<boolean>, []>();
const mockButtonHandlers = new Map<string, () => void>();
let mockActorId = 'actor-1';
let mockActorIsAdmin = false;
let serverThread: SupportThread;
let serverMessages: SupportMessage[];

jest.doMock('expo-router', () => {
  const ReactModule = require('react') as typeof import('react');
  return {
    useFocusEffect(callback: () => void | (() => void)) {
      const callbackRef = ReactModule.useRef(callback);
      callbackRef.current = callback;
      ReactModule.useEffect(() => {
        let cleanup: (() => void) | undefined;
        const entry = {
          focus: () => {
            cleanup?.();
            const result = callbackRef.current();
            cleanup = typeof result === 'function' ? result : undefined;
          },
          blur: () => {
            cleanup?.();
            cleanup = undefined;
          },
        };
        mockFocusManager.entries.add(entry);
        if (mockFocusManager.focused) entry.focus();
        return () => {
          entry.blur();
          mockFocusManager.entries.delete(entry);
        };
      }, []);
    },
  };
});

jest.doMock('react-native', () => {
  const ReactModule = require('react') as typeof import('react');
  return {
    AppState: mockAppState,
    Platform: mockPlatform,
    View: ({ children }: { children?: React.ReactNode }) => ReactModule.createElement('div', null, children),
    KeyboardAvoidingView: ({ children }: { children?: React.ReactNode }) =>
      ReactModule.createElement('div', { 'data-keyboard-owner': 'outer' }, children),
  };
});

jest.doMock('../ui', () => {
  const ReactModule = require('react') as typeof import('react');
  return {
    Button: ({ title, onPress, disabled }: { title: string; onPress?: () => void; disabled?: boolean }) => {
      if (onPress) mockButtonHandlers.set(title, onPress);
      return ReactModule.createElement('button', { 'data-label': title, disabled, onClick: onPress }, title);
    },
    Card: ({ children }: { children?: React.ReactNode }) => ReactModule.createElement('article', null, children),
    EmptyState: ({
      title,
      message,
      actionLabel,
      onAction,
    }: {
      title: string;
      message: string;
      actionLabel?: string;
      onAction?: () => void;
    }) => ReactModule.createElement(
      'aside',
      null,
      ReactModule.createElement('strong', null, title),
      ReactModule.createElement('p', null, message),
      actionLabel ? ReactModule.createElement('button', { 'data-label': actionLabel, onClick: onAction }, actionLabel) : null,
    ),
    Header: ({ title, subtitle, right }: { title: string; subtitle: string; right?: React.ReactNode }) =>
      ReactModule.createElement('header', null, ReactModule.createElement('h1', null, title), ReactModule.createElement('small', null, subtitle), right),
    InlineAlert: ({ message }: { message: string }) => ReactModule.createElement('div', { role: 'alert' }, message),
    Screen: ({
      header,
      footer,
      children,
    }: {
      header?: React.ReactNode;
      footer?: React.ReactNode;
      children?: React.ReactNode;
    }) => ReactModule.createElement(
      'main',
      null,
      header,
      ReactModule.createElement('div', { 'data-keyboard-owner': 'screen' }, children, footer),
    ),
    Skeleton: () => ReactModule.createElement('div', { 'data-testid': 'skeleton' }),
    Text: ({ children }: { children?: React.ReactNode }) => ReactModule.createElement('span', null, children),
    TextArea: ({
      label,
      value,
      onChangeText,
      editable,
    }: {
      label: string;
      value: string;
      onChangeText: (value: string) => void;
      editable?: boolean;
    }) => ReactModule.createElement('textarea', {
      'aria-label': label,
      value,
      readOnly: editable === false,
      onChange: (event: { currentTarget: { value: string } }) => onChangeText(event.currentTarget.value),
    }),
    useConfirm: () => mockConfirm,
    useToast: () => mockToast,
  };
});

jest.doMock('../../lib/auth', () => ({
  useAuth: () => ({ userId: mockActorId, loading: false }),
}));
jest.doMock('../../lib/adminApi', () => mockApi);
jest.doMock('../../theme', () => ({
  useTheme: () => ({
    spacing: { md: 12 },
    radii: { lg: 12 },
    colors: { primarySoft: '#eee', surface: '#fff' },
  }),
}));

const ReactRuntime = require('react') as typeof import('react');
const { createRoot } = require('react-dom/client') as {
  createRoot: (container: Element) => { render: (node: React.ReactElement) => void; unmount: () => void };
};
const testAct = ReactRuntime.act as (callback: () => void | Promise<void>) => Promise<void>;
const { SupportConversation } = require('../SupportConversation') as typeof import('../SupportConversation');

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
const mockIntervals = new Set<ReturnType<typeof setInterval>>();

function makeThread(status: 'open' | 'closed' = 'open'): SupportThread {
  return {
    id: 'thread-1',
    user_id: 'actor-1',
    booking_id: null,
    subject: 'Payment question',
    status,
    user_unread: 0,
    admin_unread: 1,
    last_message: 'Original request',
    last_from_admin: false,
    last_message_at: '2026-01-02T03:04:05.000Z',
    created_at: '2026-01-02T03:04:05.000Z',
  };
}

function makeMessage(id: string, body: string, fromAdmin = false): SupportMessage {
  return {
    id,
    thread_id: 'thread-1',
    sender_id: fromAdmin ? 'admin-1' : 'actor-1',
    from_admin: fromAdmin,
    body,
    created_at: '2026-01-02T03:04:05.000Z',
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function render(threadId: string, admin = false) {
  await testAct(async () => {
    root!.render(ReactRuntime.createElement(SupportConversation, { threadId, admin }));
    await flushMicrotasks();
  });
}

async function setFocused(next: boolean) {
  await testAct(async () => {
    mockFocusManager.setFocused(next);
    await flushMicrotasks();
  });
}

async function setAppState(state: string) {
  await testAct(async () => {
    mockAppState.currentState = state;
    for (const listener of [...mockAppStateListeners]) listener(state);
    await flushMicrotasks();
  });
}

async function advanceInterval(ms = 60_000) {
  await testAct(async () => {
    jest.advanceTimersByTime(ms);
    await flushMicrotasks();
  });
}

async function enterDraft(value: string) {
  const input = container.querySelector('textarea');
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
  if (input) valueSetter?.call(input, value);
  await testAct(async () => {
    input?.dispatchEvent(new window.Event('input', { bubbles: true }));
    await flushMicrotasks();
  });
}

function textContent() {
  return container.textContent ?? '';
}

function assertActual(condition: boolean, actual: unknown, description: string) {
  if (!condition) throw new Error(`${description}: ${JSON.stringify(actual)}`);
}

function assertEqual(actual: unknown, expected: unknown, description: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${description}: actual=${JSON.stringify(actual)}, expected=${JSON.stringify(expected)}`);
  }
}

function button(label: string): HTMLButtonElement | null {
  return container.querySelector(`button[data-label="${label}"]`);
}

beforeEach(() => {
  jest.useFakeTimers();
  mockIntervals.clear();
  const scheduleInterval = globalThis.setInterval.bind(globalThis);
  const cancelInterval = globalThis.clearInterval.bind(globalThis);
  jest.spyOn(globalThis, 'setInterval').mockImplementation((handler, timeout, ...args) => {
    const interval = scheduleInterval(handler, timeout, ...args);
    mockIntervals.add(interval);
    return interval;
  });
  jest.spyOn(globalThis, 'clearInterval').mockImplementation((interval) => {
    if (interval !== null && interval !== undefined) mockIntervals.delete(interval as ReturnType<typeof setInterval>);
    cancelInterval(interval);
  });

  mockFocusManager.focused = false;
  mockFocusManager.entries.clear();
  mockAppState.currentState = 'active';
  mockAppStateListeners.clear();
  mockApi.loadSupportConversation.mockReset();
  mockApi.markSupportRead.mockReset();
  mockApi.sendSupport.mockReset();
  mockApi.setSupportStatus.mockReset();
  mockToast.mockReset();
  mockConfirm.mockReset().mockResolvedValue(true);
  mockButtonHandlers.clear();
  mockActorId = 'actor-1';
  mockActorIsAdmin = false;
  serverThread = makeThread();
  serverMessages = [makeMessage('message-1', 'Original request')];
  mockApi.loadSupportConversation.mockImplementation(async (id, _scope, _actor) => ({
    thread: id === serverThread.id ? { ...serverThread } : null,
    messages: id === serverThread.id ? serverMessages.map((message) => ({ ...message })) : [],
  }));
  mockApi.markSupportRead.mockImplementation(async () => {
    serverThread = {
      ...serverThread,
      ...(mockActorIsAdmin ? { admin_unread: 0 } : { user_unread: 0 }),
    };
  });
  mockApi.sendSupport.mockImplementation(async (_id, body) => {
    serverMessages = [...serverMessages, makeMessage(`message-${serverMessages.length + 1}`, body, mockActorIsAdmin)];
    serverThread = {
      ...serverThread,
      last_message: body,
      last_from_admin: mockActorIsAdmin,
      user_unread: mockActorIsAdmin ? serverThread.user_unread + 1 : 0,
      admin_unread: mockActorIsAdmin ? 0 : serverThread.admin_unread + 1,
    };
  });
  mockApi.setSupportStatus.mockImplementation(async (_id, status) => {
    serverThread = { ...serverThread, status };
  });

  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(async () => {
  if (root) {
    await testAct(async () => {
      root!.unmount();
      await flushMicrotasks();
    });
  }
  root = undefined;
  mockFocusManager.setFocused(false);
  mockAppStateListeners.clear();
  jest.clearAllTimers();
  jest.restoreAllMocks();
  jest.useRealTimers();
  mockIntervals.clear();
});

afterAll(() => mockDom.window.close());

describe('SupportConversation', () => {
  it('CM_SUPPORT_NOTFOUND_AND_SWITCH hides old messages and ignores a delayed old-thread result', async () => {
    const oldThread = { ...makeThread(), id: 'old-thread' };
    const oldMessage = { ...makeMessage('old-message', 'private old message'), thread_id: 'old-thread' };
    const oldRead = deferred<SupportRead>();
    mockApi.loadSupportConversation.mockImplementation(async (id) => (
      id === 'old-thread'
        ? { thread: { ...oldThread }, messages: [{ ...oldMessage }] }
        : { thread: null, messages: [] }
    ));

    await render('old-thread');
    await setFocused(true);
    assertActual(textContent().includes('private old message'), { text: textContent() }, 'ready old thread is rendered');

    const input = container.querySelector('textarea');
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (input) valueSetter?.call(input, 'draft should not follow the thread');
    await testAct(async () => {
      input?.dispatchEvent(new window.Event('input', { bubbles: true }));
      await flushMicrotasks();
    });
    mockApi.loadSupportConversation.mockImplementationOnce(() => oldRead.promise);
    await advanceInterval();

    await render('new-thread');

    assertActual(textContent().includes('Conversation not found'), { text: textContent() }, 'missing thread reaches not-found');
    assertActual(!textContent().includes('private old message'), { text: textContent() }, 'old thread body is hidden on switch');
    assertActual(button('Send') === null, { sendButton: button('Send')?.textContent ?? null }, 'not-found has no Send action');
    assertActual(button('Close') === null, { closeButton: button('Close')?.textContent ?? null }, 'not-found has no status action');

    oldRead.resolve({ thread: oldThread, messages: [oldMessage] });
    await testAct(async () => { await flushMicrotasks(); });
    assertActual(!textContent().includes('private old message'), { text: textContent() }, 'delayed old result is ignored');
    assertEqual(mockApi.markSupportRead.mock.calls, [['old-thread']], 'only the originally authorized read is marked');

    await render('old-thread');
    assertEqual((container.querySelector('textarea') as HTMLTextAreaElement).value, '', 'thread switch clears the prior draft');
  });

  it('CM_SUPPORT_PARTICIPANT_LOAD keeps actions unavailable through error and retries the scoped adapter', async () => {
    mockApi.loadSupportConversation
      .mockRejectedValueOnce(new Error('support read unavailable'))
      .mockImplementation(async (id, _scope, _actor) => ({
        thread: id === serverThread.id ? { ...serverThread } : null,
        messages: [...serverMessages],
      }));

    await render('thread-1');
      assertActual(button('Send') === null && button('Close') === null, {
        sendButton: button('Send')?.textContent ?? null,
        closeButton: button('Close')?.textContent ?? null,
      }, 'pending load has no enabled actions');
    await setFocused(true);
      assertActual(textContent().includes('support read unavailable'), { text: textContent() }, 'load error is surfaced');
      assertActual(button('Retry') !== null, { retryButton: button('Retry')?.textContent ?? null }, 'load error offers Retry');
      assertActual(button('Send') === null && button('Close') === null, {
        sendButton: button('Send')?.textContent ?? null,
        closeButton: button('Close')?.textContent ?? null,
      }, 'error state has no thread actions');

    await testAct(async () => {
      button('Retry')?.click();
      await flushMicrotasks();
    });
    assertActual(mockApi.loadSupportConversation.mock.calls.every(
      ([id, scope, actorId]) => id === 'thread-1' && scope === 'participant' && actorId === 'actor-1',
    ), { calls: mockApi.loadSupportConversation.mock.calls }, 'participant uses the actor-scoped adapter');
    assertActual(textContent().includes('Original request'), { text: textContent() }, 'Retry replaces the error with canonical data');
    assertActual(button('Close') !== null, { closeButton: button('Close')?.textContent ?? null }, 'ready thread exposes status action');
    assertEqual(mockApi.markSupportRead.mock.calls, [['thread-1']], 'participant read invokes the existing mark-read RPC');
  });

  it('CM_SUPPORT_CROSS_ROLE_REFRESH refreshes the same thread only while focused and active', async () => {
    await render('thread-1');
    await setFocused(true);
    assertEqual(mockApi.loadSupportConversation.mock.calls.length, 2, 'participant initial and post-read canonical loads');
    assertEqual(mockIntervals.size, 1, 'one focused-active fallback interval is registered');

    mockActorId = 'admin-1';
    mockActorIsAdmin = true;
    await render('thread-1', true);
    assertEqual(mockApi.loadSupportConversation.mock.calls.slice(2, 4).map((call) => call.slice(0, 3)), [
      ['thread-1', 'admin', 'admin-1'],
      ['thread-1', 'admin', 'admin-1'],
    ], 'admin read uses the same primary key with the separate actor/scope');

    serverMessages = [...serverMessages, makeMessage('message-remote', 'Remote admin reply', true)];
    serverThread = { ...serverThread, status: 'closed' };
    await setAppState('background');
    assertEqual(mockIntervals.size, 0, 'background clears the focused refresh interval');
    await advanceInterval(120_000);
    assertEqual(mockApi.loadSupportConversation.mock.calls.length, 4, 'background polling makes no support reads');
    assertActual(!textContent().includes('Remote admin reply'), { text: textContent() }, 'background does not apply incoming data');

    await setAppState('active');
    assertEqual(mockApi.loadSupportConversation.mock.calls.length, 6, 'foreground resumes with one canonical load pair');
    assertActual(textContent().includes('Remote admin reply'), { text: textContent() }, 'foreground read applies the remote reply');
    assertActual(button('Reopen') !== null, { reopenButton: button('Reopen')?.textContent ?? null }, 'foreground read applies remote status');
    assertEqual(mockIntervals.size, 1, 'foreground restores one fallback interval');

    const pendingConfirmation = deferred<boolean>();
    mockConfirm.mockReturnValue(pendingConfirmation.promise);
    await testAct(async () => {
      mockButtonHandlers.get('Reopen')?.();
      mockButtonHandlers.get('Reopen')?.();
      await flushMicrotasks();
    });
    assertEqual(mockConfirm.mock.calls.length, 1, 'concurrent status presses open one confirmation');
    assertEqual(mockApi.setSupportStatus.mock.calls, [], 'status RPC waits for confirmation');
    pendingConfirmation.resolve(true);
    await testAct(async () => { await flushMicrotasks(); });
    assertEqual(mockApi.setSupportStatus.mock.calls, [['thread-1', 'open']], 'status writes are serialized');
    assertEqual(mockApi.loadSupportConversation.mock.calls.length, 8, 'status write awaits canonical readback');
    assertActual(button('Close') !== null, { closeButton: button('Close')?.textContent ?? null }, 'canonical status readback renders Close');

    await setFocused(false);
    assertEqual(mockIntervals.size, 0, 'blur clears the focused refresh interval');
    serverThread = { ...serverThread, status: 'closed' };
    await advanceInterval(120_000);
    assertEqual(mockApi.loadSupportConversation.mock.calls.length, 8, 'blurred screen makes no fallback reads');
    await setFocused(true);
    assertEqual(mockApi.loadSupportConversation.mock.calls.length, 10, 'refocus resumes exactly one canonical load pair');
    assertActual(button('Reopen') !== null, { reopenButton: button('Reopen')?.textContent ?? null }, 'refocus applies latest status');
  });

  it('CM_SUPPORT_REMOTE_REPLY preserves the draft through refresh and reads back after send', async () => {
    await render('thread-1');
    await setFocused(true);
    const input = container.querySelector('textarea');
    assertActual(input !== null, { textareaCount: container.querySelectorAll('textarea').length }, 'ready participant has a composer');
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    if (input) valueSetter?.call(input, 'Draft reply');
    await testAct(async () => {
      input?.dispatchEvent(new window.Event('input', { bubbles: true }));
      await flushMicrotasks();
    });

    serverMessages = [...serverMessages, makeMessage('message-remote', 'Remote reply', true)];
    serverThread = { ...serverThread, user_unread: 1, last_message: 'Remote reply', last_from_admin: true };
    await advanceInterval();
    assertActual(textContent().includes('Remote reply'), { text: textContent() }, 'focused refresh applies a remote reply');
    assertEqual((container.querySelector('textarea') as HTMLTextAreaElement).value, 'Draft reply', 'same-thread refresh preserves the draft');

    await testAct(async () => {
      button('Send')?.click();
      await flushMicrotasks();
    });
    assertEqual(mockApi.sendSupport.mock.calls, [['thread-1', 'Draft reply']], 'send RPC receives the preserved draft');
    assertEqual(mockApi.loadSupportConversation.mock.calls.length, 6, 'send awaits canonical adapter readback');
    assertActual(mockApi.markSupportRead.mock.calls.length > 0, { calls: mockApi.markSupportRead.mock.calls }, 'readback uses markSupportRead');
    assertEqual(serverThread.user_unread, 0, 'read RPC refreshes the actor-side unread counter');
    assertActual(textContent().includes('Draft reply'), { text: textContent() }, 'canonical readback includes the sent message');
    assertEqual((container.querySelector('textarea') as HTMLTextAreaElement).value, '', 'successful send clears the draft');
  });

  it('CM_SUPPORT_CONCURRENT_CONTEXT_SEND_LOCKS keeps in-flight sends isolated across role switches', async () => {
    await render('thread-1');
    await setFocused(true);
    await enterDraft('Participant reply');

    const participantSend = deferred<void>();
    mockApi.sendSupport.mockImplementationOnce(() => participantSend.promise);
    await testAct(async () => {
      mockButtonHandlers.get('Send')?.();
      await flushMicrotasks();
    });
    assertEqual(mockApi.sendSupport.mock.calls.length, 1, 'participant send starts once');

    mockActorId = 'admin-1';
    mockActorIsAdmin = true;
    await render('thread-1', true);
    await enterDraft('Admin reply');
    const adminSend = deferred<void>();
    mockApi.sendSupport.mockImplementationOnce(() => adminSend.promise);
    await testAct(async () => {
      mockButtonHandlers.get('Send')?.();
      await flushMicrotasks();
    });
    assertEqual(mockApi.sendSupport.mock.calls.length, 2, 'admin may send under its own actor/scope');

    mockActorId = 'actor-1';
    mockActorIsAdmin = false;
    await render('thread-1');
    await enterDraft('Second participant reply');
    assertActual(button('Send')?.disabled === true, {
      disabled: button('Send')?.disabled ?? null,
      calls: mockApi.sendSupport.mock.calls,
    }, 'returning to participant context retains its in-flight lock');
    await testAct(async () => {
      mockButtonHandlers.get('Send')?.();
      await flushMicrotasks();
    });
    assertEqual(mockApi.sendSupport.mock.calls.length, 2, 'participant retry cannot overlap its pending RPC');

    mockActorId = 'admin-1';
    mockActorIsAdmin = true;
    await render('thread-1', true);
    await enterDraft('Second admin reply');
    assertActual(button('Send')?.disabled === true, {
      disabled: button('Send')?.disabled ?? null,
      calls: mockApi.sendSupport.mock.calls,
    }, 'participant completion cannot clear the independent admin lock');

    participantSend.resolve();
    await testAct(async () => { await flushMicrotasks(); await flushMicrotasks(); });
    assertActual(button('Send')?.disabled === true, {
      disabled: button('Send')?.disabled ?? null,
      calls: mockApi.sendSupport.mock.calls,
    }, 'older participant completion leaves the admin operation locked');
    adminSend.resolve();
    await testAct(async () => { await flushMicrotasks(); await flushMicrotasks(); });
    assertEqual(mockApi.sendSupport.mock.calls.length, 2, 'both in-flight sends complete without a duplicate write');
  });

  it('CM_SUPPORT_SINGLE_KEYBOARD_OWNER leaves keyboard ownership to Screen', async () => {
    await render('thread-1');
    assertEqual(container.querySelectorAll('[data-keyboard-owner]').length, 1, 'shared body adds no second keyboard owner');
    assertActual(container.querySelector('[data-keyboard-owner="screen"]') !== null, {
      owner: container.querySelector('[data-keyboard-owner]')?.getAttribute('data-keyboard-owner') ?? null,
    }, 'Screen owns keyboard avoidance');
    assertActual(container.querySelector('[data-keyboard-owner="outer"]') === null, {
      outerOwner: container.querySelector('[data-keyboard-owner="outer"]')?.getAttribute('data-keyboard-owner') ?? null,
    }, 'shared component has no outer keyboard wrapper');
  });
});
