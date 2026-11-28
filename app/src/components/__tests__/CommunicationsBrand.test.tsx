import type React from 'react';
import { JSDOM } from 'jsdom';

const mockDom = new JSDOM('<!doctype html><html><body></body></html>');
Object.defineProperty(globalThis, 'window', { configurable: true, value: mockDom.window });
Object.defineProperty(globalThis, 'document', { configurable: true, value: mockDom.window.document });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: mockDom.window.navigator });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mockBrandOn = false;
let mockAuthLoading = true;
let mockBookingId = 'booking-a';
const mockIdentityContexts: string[] = [];
const mockStartSupport = jest.fn();
const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => false),
  dismissTo: jest.fn(),
};
const mockApi = {
  loadSupportConversation: jest.fn(),
  markSupportRead: jest.fn().mockResolvedValue(undefined),
  sendSupport: jest.fn().mockResolvedValue(undefined),
  setSupportStatus: jest.fn().mockResolvedValue(undefined),
};
const mockBooking = {
  id: '12345678-0000-0000-0000-000000000000',
  customer_id: 'actor-1',
  provider_id: 'provider-1',
  status: 'confirmed',
  categories: { name: 'Fitness' },
};

jest.doMock('expo-router', () => ({
  router: mockRouter,
  useFocusEffect: jest.fn(),
  useLocalSearchParams: () => ({ bookingId: mockBookingId, returnTo: 'account' }),
}));

jest.doMock('react-native', () => {
  const ReactModule = require('react') as typeof import('react');
  const View = ({ children }: { children?: React.ReactNode }) => ReactModule.createElement('div', null, children);
  return {
    AppState: { currentState: 'active', addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
    ScrollView: View,
    View,
  };
});

const uiMocks = () => {
  const ReactModule = require('react') as typeof import('react');
  const element = ReactModule.createElement;
  return {
    Badge: ({ label }: { label: string }) => element('span', null, label),
    Button: ({ title, onPress, disabled }: { title: string; onPress?: () => void; disabled?: boolean }) =>
      element('button', { type: 'button', disabled, onClick: onPress }, title),
    Card: ({ children }: { children?: React.ReactNode }) => element('article', null, children),
    EmptyState: ({ title, message }: { title: string; message: string }) =>
      element('aside', null, element('strong', null, title), element('p', null, message)),
    ErrorState: ({ message }: { message: string }) => element('p', null, message),
    Header: ({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) =>
      element('header', null, element('h1', null, title), element('small', null, subtitle), right),
    InlineAlert: ({ title, message }: { title?: string; message?: string | null }) =>
      element('div', { role: 'alert' }, title ? element('strong', null, title) : null, message),
    Input: ({
      label,
      value,
      onChangeText,
    }: { label: string; value: string; onChangeText: (value: string) => void }) =>
      element('input', {
        'aria-label': label,
        value,
        onInput: (event: { currentTarget: { value: string } }) => onChangeText(event.currentTarget.value),
      }),
    ListItem: ({ title, subtitle }: { title: string; subtitle?: string }) =>
      element('div', null, title, subtitle),
    Screen: ({
      header,
      footer,
      children,
    }: { header?: React.ReactNode; footer?: React.ReactNode; children?: React.ReactNode }) =>
      element('main', null, header, element('section', null, children, footer)),
    Skeleton: () => element('div', null, 'Loading'),
    Text: ({ children }: { children?: React.ReactNode }) => element('span', null, children),
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
    }) => element('textarea', {
      'aria-label': label,
      value,
      readOnly: editable === false,
      onInput: (event: { currentTarget: { value: string } }) => onChangeText(event.currentTarget.value),
    }),
    useConfirm: () => jest.fn().mockResolvedValue(true),
    useToast: () => jest.fn(),
  };
};

jest.doMock('../ui', uiMocks);
jest.doMock('../../components/ui', uiMocks);
jest.doMock('../../branding/useBrandIdentity', () => ({
  useBrandIdentity: (context: string) => {
    mockIdentityContexts.push(context);
    const { resolveBrandIdentity } = jest.requireActual('../../branding/identity') as typeof import('../../branding/identity');
    return resolveBrandIdentity(context as import('../../branding/identity').BrandContext, {
      brandOn: mockBrandOn,
      runtimeOn: true,
      bundledIdentityReady: false,
      published: {
        displayName: 'Oorva Studio',
        tagline: 'Support that stays connected.',
        logoLight: null,
        logoDark: null,
        compactLight: null,
        compactDark: null,
      },
    });
  },
}));
jest.doMock('../../lib/auth', () => ({
  useAuth: () => ({ userId: mockAuthLoading ? null : 'actor-1', loading: mockAuthLoading }),
}));
jest.doMock('../../lib/useEntityRefresh', () => ({
  useEntityRefresh: (load: (guard: { isCurrent: () => boolean }) => Promise<void>, options: { enabled: boolean }) => {
    const ReactModule = require('react') as typeof import('react');
    ReactModule.useEffect(() => {
      if (options.enabled) void load({ isCurrent: () => true }).catch(() => undefined);
    }, [load, options.enabled]);
    return { refresh: () => load({ isCurrent: () => true }), refreshing: false };
  },
}));
jest.doMock('../../lib/adminApi', () => ({
  ...mockApi,
  getDashboard: jest.fn(),
  listSupportThreads: jest.fn().mockResolvedValue([]),
  startSupport: mockStartSupport,
}));
jest.doMock('../../lib/featureFlags', () => ({
  useFeature: () => false,
  useAppFeatureFlags: () => ({ isOn: () => false }),
}));
jest.doMock('../../lib/adminFeaturePresentation', () => ({ isAdminRulesEditorEnabled: () => false }));
jest.doMock('../../lib/money', () => ({ formatINR: (value: number) => String(value) }));
jest.doMock('../../theme', () => ({
  useTheme: () => ({
    spacing: { xs: 4, sm: 8, md: 12 },
    radii: { lg: 12 },
    colors: { primary: '#000', primarySoft: '#eee', primaryText: '#000', surface: '#fff', danger: '#f00', muted: '#666' },
  }),
}));
jest.doMock('../../lib/notificationPresentation', () => ({
  exactCommunicationTime: (value: string) => value,
  supportThreadPresentation: (thread: { status: string }) => ({
    statusLabel: thread.status === 'closed' ? 'Closed' : 'Open',
    unreadLabel: null,
    unreadCount: 0,
    bookingLabel: null,
    timeLabel: 'Jan 2',
    timeAccessibilityLabel: 'January 2',
  }),
  isNearScrollEnd: () => true,
  shouldAutoScrollForMessage: () => false,
}));
jest.doMock('../../lib/api', () => ({
  getBooking: jest.fn().mockResolvedValue(mockBooking),
  getChatReadState: jest.fn().mockResolvedValue({ my_last_read_at: null, other_last_read_at: null }),
  getProfileName: jest.fn().mockResolvedValue('Counterpart'),
  markChatRead: jest.fn().mockResolvedValue(undefined),
  subscribeToBooking: jest.fn(() => jest.fn()),
}));
jest.doMock('../../lib/push', () => ({ registerForPush: jest.fn() }));
jest.doMock('../../lib/unreadContext', () => ({
  useUnread: () => ({ setActiveChat: jest.fn(), markRead: jest.fn().mockResolvedValue(undefined) }),
}));
jest.doMock('../../lib/unread', () => ({
  firstUnreadIndex: () => -1,
  seenMessageId: () => null,
}));
jest.doMock('../../components/ChatPanel', () => ({
  ChatComposer: () => null,
  MessageList: () => null,
  useChat: () => ({
    messages: null,
    phase: 'pending',
    error: null,
    sending: false,
    nudge: true,
    reload: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue(true),
  }),
}));

const ReactRuntime = require('react') as typeof import('react');
const { createRoot } = require('react-dom/client') as {
  createRoot: (container: Element) => { render: (node: React.ReactElement) => void; unmount: () => void };
};
const testAct = ReactRuntime.act as (callback: () => void | Promise<void>) => Promise<void>;
const { SupportConversation } = require('../SupportConversation') as typeof import('../SupportConversation');
const { default: AdminIndexScreen } = require('../../features/communicationScreens/AdminIndexScreen') as {
  default: () => React.ReactElement;
};
const { default: ChatDetailScreen } = require('../../features/communicationScreens/ChatDetailScreen') as {
  default: () => React.ReactElement;
};
const { default: SupportIndexScreen } = require('../../features/communicationScreens/SupportIndexScreen') as {
  default: () => React.ReactElement;
};
const {
  default: SupportNewScreen,
  supportStartRequest,
} = require('../../features/communicationScreens/SupportNewScreen') as typeof import('../../features/communicationScreens/SupportNewScreen');
const { bookingRef } = require('../../lib/schedule') as typeof import('../../lib/schedule');

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;

function makeThread() {
  return {
    id: 'thread-1',
    user_id: 'actor-1',
    booking_id: mockBooking.id,
    subject: 'Payment question',
    status: 'open' as const,
    user_unread: 0,
    admin_unread: 1,
    last_message: 'Original request',
    last_from_admin: true,
    last_message_at: '2026-01-02T03:04:05.000Z',
    created_at: '2026-01-02T03:04:05.000Z',
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function render(node: React.ReactNode) {
  await testAct(async () => {
    root.render(ReactRuntime.createElement(ReactRuntime.Fragment, null, node));
    await flushMicrotasks();
  });
}

function textContent() {
  return container.textContent ?? '';
}

beforeEach(() => {
  mockBrandOn = false;
  mockAuthLoading = true;
  mockBookingId = 'booking-a';
  mockIdentityContexts.length = 0;
  mockRouter.push.mockReset();
  mockRouter.replace.mockReset();
  mockRouter.back.mockReset();
  mockRouter.dismissTo.mockReset();
  mockStartSupport.mockReset().mockResolvedValue('thread-new');
  mockApi.loadSupportConversation.mockReset().mockImplementation(async () => ({
    thread: makeThread(),
    messages: [{
      id: 'message-1',
      thread_id: 'thread-1',
      sender_id: 'admin-1',
      from_admin: true,
      body: 'Existing support message stays verbatim.',
      created_at: '2026-01-02T03:04:05.000Z',
    }],
  }));
  mockApi.markSupportRead.mockReset().mockResolvedValue(undefined);
  mockApi.sendSupport.mockReset().mockResolvedValue(undefined);
  mockApi.setSupportStatus.mockReset().mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await testAct(() => root.unmount());
  container.remove();
});

describe('communications display identity', () => {
  it('CM_COMMS_BRAND_CONTEXT uses the resolved support and account identity on every host', async () => {
    mockBrandOn = true;
    mockAuthLoading = false;
    await render(ReactRuntime.createElement(ReactRuntime.Fragment, null,
      ReactRuntime.createElement(SupportConversation, { threadId: 'thread-1' }),
      ReactRuntime.createElement(SupportIndexScreen),
      ReactRuntime.createElement(SupportNewScreen),
      ReactRuntime.createElement(AdminIndexScreen),
      ReactRuntime.createElement(ChatDetailScreen),
    ));

    const rendered = textContent();
    expect(rendered).toContain('Oorva Studio support');
    expect(rendered).toContain('Messages stay private between you and Oorva Studio');
    expect(rendered).toContain('Send to Oorva Studio support');
    expect(rendered).toContain('Oorva Studio operations · last 30 days');
    expect(rendered).toContain("Payments outside Oorva Studio aren't covered by the guarantee. Use the in-app payment button.");
    expect(rendered).toContain('Existing support message stays verbatim.');
    expect(mockIdentityContexts).toEqual(expect.arrayContaining(['support', 'account']));
  });

  it('CM_SUPPORT_NEW_BRAND_OFF keeps legacy copy and the existing support action available', async () => {
    await render(ReactRuntime.createElement(ReactRuntime.Fragment, null,
      ReactRuntime.createElement(SupportNewScreen),
      ReactRuntime.createElement(ChatDetailScreen),
    ));

    expect(textContent()).toContain('Send to QuickServe support');
    expect(textContent()).toContain("Payments outside QuickServe aren't covered by the guarantee. Use the in-app payment button.");
    expect(mockIdentityContexts).toEqual(expect.arrayContaining(['support', 'account']));

    const message = container.querySelector('textarea');
    expect(message).not.toBeNull();
    await testAct(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      valueSetter?.call(message, 'Please help with this booking.');
      message?.dispatchEvent(new window.Event('input', { bubbles: true }));
      await flushMicrotasks();
    });
    const sendButton = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Send to QuickServe support');
    expect(sendButton?.disabled).toBe(false);
    await testAct(async () => {
      sendButton?.click();
      await flushMicrotasks();
    });
    expect(mockStartSupport).toHaveBeenCalledWith('Please help with this booking.', 'booking-a', null);
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/support/[id]', params: { id: 'thread-new' } });
  });

  it('CM_HISTORICAL_PAYLOAD_UNCHANGED leaves support request data, message text, and QS references intact', async () => {
    expect(supportStartRequest('booking-a', 'Changed subject')).toEqual({
      bookingId: 'booking-a',
      subject: null,
    });
    expect(bookingRef(mockBooking.id)).toBe('QS-12345678');

    const notification = {
      id: 'notification-1',
      kind: 'support_reply',
      title: 'Support reply',
      body: 'Your support conversation was updated.',
      data: { url: '/support/thread-1', booking_id: 'booking-a', source: 'existing' },
      count: 1,
      booking_id: null,
      category_name: null,
      at: '2026-01-02T03:04:05.000Z',
      read_at: null,
    };
    const notificationBefore = {
      title: notification.title,
      body: notification.body,
      data: { ...notification.data },
    };
    const { buildNotificationItems } = jest.requireActual('../../lib/unread') as typeof import('../../lib/unread');
    const [item] = buildNotificationItems([notification], {}, 'actor-1');
    expect(item).toMatchObject({
      title: notificationBefore.title,
      body: notificationBefore.body,
      route: '/support/thread-1',
    });
    expect(notification).toMatchObject(notificationBefore);

    mockBrandOn = true;
    mockAuthLoading = false;
    await render(ReactRuntime.createElement(SupportConversation, { threadId: 'thread-1' }));
    expect(textContent()).toContain('Existing support message stays verbatim.');
    expect(textContent()).toContain('Linked booking QS-12345678');
  });

  it('CM_CHAT_CONTEXT_REFERENCE uses account display identity without changing the technical QS booking reference', async () => {
    mockBrandOn = true;
    mockAuthLoading = false;
    await render(ReactRuntime.createElement(ChatDetailScreen));
    expect(textContent()).toContain('Oorva Studio');
    expect(textContent()).toContain('Fitness · QS-12345678');
    expect(mockIdentityContexts).toContain('account');
    expect(bookingRef(mockBooking.id)).toBe('QS-12345678');
  });
});
