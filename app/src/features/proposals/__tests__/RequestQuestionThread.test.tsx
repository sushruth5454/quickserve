import React from 'react';
import { sendRequestMessageWithResult } from '../../../lib/supabaseApi';

const mockApi = {
  getServiceRequest: jest.fn(),
  listProviderServiceRequests: jest.fn(),
  listRequestProposals: jest.fn(),
  listRequestMessages: jest.fn(),
  sendRequestMessage: jest.fn(),
};
const mockRpc = jest.fn();
const mockToast = jest.fn();
let mockChangeText: (value: string) => void = () => {};
let mockUserId: string | null = 'customer-1';
let mockResolveMessageRead: ((rows: ReturnType<typeof message>[]) => void) | null = null;
let mockResolvePreSendRead: ((rows: ReturnType<typeof message>[]) => void) | null = null;

jest.mock('../../../lib/api', () => mockApi);
jest.mock('../../../lib/config', () => ({ isDemoMode: false, supportContact: '' }));
jest.mock('../../../lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }));
jest.mock('../../../lib/invokeFunction', () => ({ invokeFunction: jest.fn() }));
jest.mock('../../../lib/auth', () => ({ useAuth: () => ({ userId: mockUserId }) }));
jest.mock('react-native', () => ({ View: 'div', Linking: {} }));
jest.mock('../../serviceLifecycle/useFocusedServiceRefresh', () => {
  const ReactRuntime = require('react') as typeof React;
  return {
    useFocusedServiceRefresh(load: (guard: { isCurrent: () => boolean }) => Promise<void>, options: { contextKey: string }) {
      ReactRuntime.useEffect(() => {
        void load({ isCurrent: () => true });
      }, [load, options.contextKey]);
      return {
        refresh: ReactRuntime.useCallback(
          () => load({ isCurrent: () => true }),
          [load],
        ),
        refreshing: false,
      };
    },
  };
});
jest.mock('../../../components/ui', () => {
  const ReactRuntime = require('react') as typeof React;
  return {
    Button: ({ title, disabled, loading, onPress }: {
      title: string;
      disabled?: boolean;
      loading?: boolean;
      onPress?: () => void;
    }) => ReactRuntime.createElement('button', {
      disabled: disabled || loading,
      onClick: onPress,
    }, title),
    Card: ({ children }: { children?: React.ReactNode }) => ReactRuntime.createElement('div', null, children),
    InlineAlert: ({ title, message }: { title?: string; message?: string }) =>
      ReactRuntime.createElement('div', null, title, message),
    Text: ({ children }: { children?: React.ReactNode }) => ReactRuntime.createElement('span', null, children),
    TextArea: ({ label, value, onChangeText }: {
      label: string;
      value: string;
      onChangeText: (next: string) => void;
    }) => {
      mockChangeText = onChangeText;
      return ReactRuntime.createElement('label', null, label, ReactRuntime.createElement('textarea', {
        value,
        onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => onChangeText(event.currentTarget.value),
      }));
    },
    useToast: () => mockToast,
  };
});

const ReactRuntime = require('react') as typeof React;
const { JSDOM } = require('jsdom') as typeof import('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>');
Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const testAct = ReactRuntime.act as (callback: () => void | Promise<void>) => Promise<void>;
type TestRoot = { render: (element: React.ReactElement) => void; unmount: () => void };
let root: TestRoot | undefined;
let container: HTMLDivElement;

function message(id: string, createdAt: string, body = 'A request question') {
  return {
    id,
    request_id: 'request-1',
    provider_id: 'provider-1',
    sender_id: 'customer-1',
    body,
    created_at: createdAt,
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function mount(props: {
  canMessage?: boolean;
  requestStatus?: 'open' | 'closed' | 'booked' | 'cancelled' | 'expired' | null;
} = {}) {
  const { createRoot } = require('react-dom/client') as { createRoot: (node: Element) => TestRoot };
  await testAct(async () => {
    container = document.createElement('div');
    root = createRoot(container);
    root.render(threadElement(props));
    await flush();
  });
}

function threadElement(props: {
  canMessage?: boolean;
  requestStatus?: 'open' | 'closed' | 'booked' | 'cancelled' | 'expired' | null;
} = {}): React.ReactElement {
  const { RequestQuestionThread } = require('../RequestQuestionThread') as
    typeof import('../RequestQuestionThread');
  return ReactRuntime.createElement(RequestQuestionThread, {
    requestId: 'request-1',
    providerId: 'provider-1',
    otherPartyLabel: 'Creator',
    canMessage: true,
    requestStatus: 'open',
    ...props,
  });
}

async function clickButton(label: string) {
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent === label);
  if (!button) throw new Error(`Missing button ${label}; rendered=${container.textContent}`);
  await testAct(async () => {
    button.click();
    await flush();
  });
}

beforeEach(() => {
  mockApi.getServiceRequest.mockReset();
  mockApi.listProviderServiceRequests.mockReset();
  mockApi.listRequestProposals.mockReset();
  mockApi.listRequestMessages.mockReset().mockResolvedValue([]);
  mockApi.sendRequestMessage.mockReset().mockImplementation(async (
    requestId: string,
    providerId: string,
    body: string,
  ) => await sendRequestMessageWithResult(requestId, providerId, body) as unknown as void);
  mockRpc.mockReset();
  mockToast.mockReset();
  mockChangeText = () => {};
  mockUserId = 'customer-1';
  mockResolveMessageRead = null;
  mockResolvePreSendRead = null;
});

afterEach(async () => {
  if (root) {
    await testAct(async () => {
      root?.unmount();
      await flush();
    });
  }
  root = undefined;
});

afterAll(() => dom.window.close());

describe('RequestQuestionThread', () => {
  it('rpcResolvedErrorRetainsDraft', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'request conversation is closed' },
    });
    await mount();

    await testAct(async () => {
      mockChangeText('Keep this draft');
      await flush();
    });
    await clickButton('Send message');

    expect(container.querySelector('textarea')?.value).toBe('Keep this draft');
    expect(container.textContent).toContain('request conversation is closed');
    expect(mockToast).not.toHaveBeenCalledWith({ message: 'Message sent', tone: 'success' });
    expect(mockRpc).toHaveBeenCalledWith('send_request_message', {
      p_request_id: 'request-1',
      p_provider_id: 'provider-1',
      p_body: 'Keep this draft',
    });
  });

  it.each(['booked', 'cancelled', 'expired'] as const)('%s conversations stay read-only', async (requestStatus) => {
    const previousMessage = message('message-old', '2030-01-15T10:00:00.000Z');
    mockApi.listRequestMessages.mockResolvedValue([previousMessage]);
    await mount({ canMessage: false, requestStatus });

    expect(container.textContent).toContain('A request question');
    expect(container.textContent).toContain(new Date(previousMessage.created_at).toLocaleString());
    expect(container.querySelector('textarea')).toBeNull();
    expect([...container.querySelectorAll('button')].some((button) => button.textContent === 'Send message')).toBe(false);
    expect(container.textContent).toContain('read-only');
  });

  it('keeps a closed request messageable', async () => {
    await mount({ canMessage: true, requestStatus: 'closed' });

    expect(container.querySelector('textarea')).not.toBeNull();
    expect([...container.querySelectorAll('button')].some((button) => button.textContent === 'Send message')).toBe(true);
  });

  it('does not retain messages or drafts when the authenticated user changes', async () => {
    const previousMessage = message('message-old-account', '2030-01-15T10:00:00.000Z');
    mockApi.listRequestMessages.mockResolvedValueOnce([previousMessage]);
    mockApi.listRequestProposals.mockResolvedValue([]);
    mockApi.listProviderServiceRequests.mockResolvedValue([]);
    mockApi.getServiceRequest.mockResolvedValue(null);
    await mount();
    await testAct(async () => {
      mockChangeText('Private draft');
      await flush();
    });

    mockApi.listRequestMessages.mockImplementationOnce(() => new Promise((resolve) => {
      mockResolveMessageRead = resolve;
    }));
    mockUserId = 'customer-2';
    await testAct(async () => {
      root?.render(threadElement());
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain(previousMessage.body);
    expect(container.querySelector('textarea')).toBeNull();
    await testAct(async () => {
      mockResolveMessageRead?.([]);
      await flush();
    });
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('does not send a draft if the authenticated user changes during the pre-send read', async () => {
    mockApi.listRequestProposals.mockResolvedValue([]);
    mockApi.listProviderServiceRequests.mockResolvedValue([]);
    mockApi.getServiceRequest.mockResolvedValue(null);
    await mount();
    await testAct(async () => {
      mockChangeText('Old account draft');
      await flush();
    });
    mockApi.listRequestMessages.mockImplementationOnce(() => new Promise((resolve) => {
      mockResolvePreSendRead = resolve;
    }));
    await clickButton('Send message');

    mockUserId = 'customer-2';
    await testAct(async () => {
      root?.render(threadElement());
      await flush();
    });
    await testAct(async () => {
      mockResolvePreSendRead?.([]);
      await flush();
    });

    expect(mockApi.sendRequestMessage).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockToast).not.toHaveBeenCalledWith({ message: 'Message sent', tone: 'success' });
  });

  it('clears only after timestamped thread readback and preserves the leakage nudge', async () => {
    const sentMessage = message(
      'message-returned-by-rpc',
      '2030-01-15T10:00:00.000Z',
      'Please send payment outside QuickServe',
    );
    mockRpc.mockResolvedValueOnce({
      data: { message_id: sentMessage.id, nudge: true },
      error: null,
    });
    mockApi.listRequestMessages
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValue([sentMessage]);
    await mount();

    await testAct(async () => {
      mockChangeText('Please send payment outside QuickServe');
      await flush();
    });
    await clickButton('Send message');

    expect(container.querySelector('textarea')?.value).toBe('');
    expect(container.textContent).toContain(sentMessage.body);
    expect(container.textContent).toContain(new Date(sentMessage.created_at).toLocaleString());
    expect(container.textContent).toContain('Keep this conversation protected');
    expect(mockToast).toHaveBeenCalledWith({ message: 'Message sent', tone: 'success' });
  });
});
