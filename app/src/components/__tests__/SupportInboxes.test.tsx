jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('../../branding/useBrandIdentity', () => ({
  useBrandIdentity: (context: string) => {
    const { resolveBrandIdentity } = jest.requireActual('../../branding/identity') as typeof import('../../branding/identity');
    return resolveBrandIdentity(context as 'support', {
      brandOn: false,
      runtimeOn: false,
      bundledIdentityReady: false,
      published: null,
    });
  },
}));
jest.mock('../../lib/featureFlags', () => ({ useFeature: () => false }));

import type React from 'react';

const mockRuntime = {
  hookIndex: 0,
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
  focusEffects: [] as Array<() => void | (() => void)>,
  userId: 'actor-1' as string | null,
  authLoading: false,
};

jest.mock('react', () => {
  const actual = jest.requireActual<typeof import('react')>('react');
  return {
    ...actual,
    useCallback: (callback: (...args: never[]) => unknown) => callback,
    useRef: (initial: unknown) => {
      const index = mockRuntime.hookIndex++;
      if (!mockRuntime.refs[index]) mockRuntime.refs[index] = { current: initial };
      return mockRuntime.refs[index];
    },
    useState: (initial: unknown) => {
      const index = mockRuntime.hookIndex++;
      if (!(index in mockRuntime.states)) mockRuntime.states[index] = initial;
      return [
        mockRuntime.states[index],
        (next: unknown) => {
          mockRuntime.states[index] = typeof next === 'function'
            ? (next as (mockValue: unknown) => unknown)(mockRuntime.states[index])
            : next;
        },
      ];
    },
  };
});

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockRuntime.focusEffects.push(callback);
  },
}));
jest.mock('../ui', () => ({
  Badge: 'Badge',
  Button: 'Button',
  Card: 'Card',
  EmptyState: 'EmptyState',
  Header: 'Header',
  Screen: 'Screen',
  SegmentedControl: 'SegmentedControl',
  Skeleton: 'Skeleton',
  Text: 'Text',
}));
jest.mock('../../lib/auth', () => ({
  useAuth: () => ({ userId: mockRuntime.userId, loading: mockRuntime.authLoading }),
}));
jest.mock('../../lib/adminApi', () => ({
  listAdminSupport: jest.fn(),
  listSupportThreads: jest.fn(),
}));

const ReactRuntime = require('react') as typeof import('react');
const { listAdminSupport, listSupportThreads } = require('../../lib/adminApi') as {
  listAdminSupport: jest.Mock;
  listSupportThreads: jest.Mock;
};
const { default: AdminSupportIndexScreen } = require('../../features/communicationScreens/AdminSupportIndexScreen') as typeof import('../../features/communicationScreens/AdminSupportIndexScreen');
const { default: SupportIndexScreen } = require('../../features/communicationScreens/SupportIndexScreen') as typeof import('../../features/communicationScreens/SupportIndexScreen');

function renderScreen(screen: () => React.ReactElement) {
  mockRuntime.hookIndex = 0;
  mockRuntime.focusEffects = [];
  return screen();
}

function findElements(node: unknown, type: string): Array<React.ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.flatMap((child) => findElements(child, type));
  if (!ReactRuntime.isValidElement(node)) return [];
  const element = node as React.ReactElement<Record<string, unknown>>;
  return [
    ...(element.type === type ? [element] : []),
    ...findElements(element.props.children, type),
  ];
}

function textValues(tree: unknown): string[] {
  return findElements(tree, 'Text').map((element) => String(element.props.children ?? ''));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function expectWithEvidence(condition: boolean, evidence: unknown) {
  const evidenceJson = JSON.stringify(evidence);
  expect({ condition, evidenceJson }).toEqual({ condition: true, evidenceJson });
}

async function loadAdminRows(rows: ReturnType<typeof adminRow>[], filter = 'open') {
  listAdminSupport.mockResolvedValueOnce(rows);
  let tree = renderScreen(AdminSupportIndexScreen);
  if (filter !== 'open') {
    const control = findElements(tree, 'SegmentedControl')[0];
    (control?.props.onChange as ((value: string) => void) | undefined)?.(filter);
    tree = renderScreen(AdminSupportIndexScreen);
  }
  mockRuntime.focusEffects[0]?.();
  await settle();
  return renderScreen(AdminSupportIndexScreen);
}

const adminRow = (id: string, status: 'open' | 'closed' = 'open', adminUnread = 1) => ({
  id,
  subject: id,
  status,
  booking_id: null,
  user_id: 'user-2',
  user_name: 'Private copied customer name',
  user_phone: 'Private copied phone',
  is_provider: false,
  admin_unread: adminUnread,
  last_message: 'Private copied message body',
  last_from_admin: false,
  last_message_at: '2026-01-02T03:04:05.000Z',
});

const personalRow = {
  id: 'own-thread',
  user_id: 'actor-1',
  booking_id: null,
  subject: 'My support request',
  status: 'open' as const,
  user_unread: 1,
  admin_unread: 0,
  last_message: 'Please help',
  last_from_admin: true,
  last_message_at: '2026-01-02T03:04:05.000Z',
  created_at: '2026-01-02T03:04:05.000Z',
};

beforeEach(() => {
  mockRuntime.hookIndex = 0;
  mockRuntime.states = [];
  mockRuntime.refs = [];
  mockRuntime.focusEffects = [];
  mockRuntime.userId = 'actor-1';
  mockRuntime.authLoading = false;
  listAdminSupport.mockReset();
  listSupportThreads.mockReset();
});

describe('support inbox load states', () => {
  it('CM_ADMIN_SUPPORT_FAILURE_NOT_CLEAR keeps pending and rejected admin loads out of Inbox clear', async () => {
    const first = deferred<ReturnType<typeof adminRow>[]>();
    listAdminSupport.mockReturnValueOnce(first.promise).mockResolvedValueOnce([adminRow('Recovered thread')]);
    let tree = renderScreen(AdminSupportIndexScreen);
    const cleanup = mockRuntime.focusEffects[0]?.();
    tree = renderScreen(AdminSupportIndexScreen);
    expect(findElements(tree, 'Skeleton')).toHaveLength(1);
    expect(findElements(tree, 'EmptyState').some((item) => item.props.title === 'Inbox clear')).toBe(false);

    first.reject(new Error('admin support unavailable'));
    await settle();
    tree = renderScreen(AdminSupportIndexScreen);
    const error = findElements(tree, 'EmptyState').find((element) => element.props.title === 'Support inbox unavailable');
    expect(error?.props.message).toBe('admin support unavailable');
    expect(error?.props.actionLabel).toBe('Retry');
    expect(typeof error?.props.onAction).toBe('function');
    expect(findElements(tree, 'EmptyState').some((item) => item.props.title === 'Inbox clear')).toBe(false);

    (error?.props.onAction as (() => void) | undefined)?.();
    await settle();
    tree = renderScreen(AdminSupportIndexScreen);
    expect(textValues(tree)).toContain('Recovered thread');
    if (typeof cleanup === 'function') cleanup();
  });

  it('CM_SUPPORT_ERROR_RECOVERY retries the personal inbox and replaces the error with data', async () => {
    listSupportThreads
      .mockRejectedValueOnce(new Error('support temporarily unavailable'))
      .mockResolvedValueOnce([personalRow]);
    let tree = renderScreen(SupportIndexScreen);
    mockRuntime.focusEffects[0]?.();
    tree = renderScreen(SupportIndexScreen);
    expect(findElements(tree, 'Skeleton')).toHaveLength(1);
    expect(listSupportThreads).toHaveBeenCalledWith('actor-1');

    await settle();
    tree = renderScreen(SupportIndexScreen);
    let error = findElements(tree, 'EmptyState')[0];
    expect(error?.props.title).toBe('Support unavailable');
    expect(error?.props.message).toBe('support temporarily unavailable');
    expect(error?.props.actionLabel).toBe('Retry');
    expect(textValues(tree)).not.toContain('How can we help?');

    (error?.props.onAction as (() => void) | undefined)?.();
    await settle();
    tree = renderScreen(SupportIndexScreen);
    expect(textValues(tree)).toContain('My support request');
    expect(findElements(tree, 'EmptyState')).toHaveLength(0);
  });

  it('CM_ADMIN_SUPPORT_FILTER_ORDER ignores a delayed response for the previous filter', async () => {
    const open = deferred<ReturnType<typeof adminRow>[]>();
    const closed = deferred<ReturnType<typeof adminRow>[]>();
    listAdminSupport.mockImplementation((filter: string) => filter === 'open' ? open.promise : closed.promise);
    renderScreen(AdminSupportIndexScreen);
    const oldCleanup = mockRuntime.focusEffects[0]?.();

    let tree = renderScreen(AdminSupportIndexScreen);
    const filter = findElements(tree, 'SegmentedControl')[0];
    (filter?.props.onChange as ((value: string) => void) | undefined)?.('closed');
    if (typeof oldCleanup === 'function') oldCleanup();

    tree = renderScreen(AdminSupportIndexScreen);
    mockRuntime.focusEffects[0]?.();
    expect(listAdminSupport).toHaveBeenNthCalledWith(1, 'open');
    expect(listAdminSupport).toHaveBeenNthCalledWith(2, 'closed');

    closed.resolve([adminRow('Closed result')]);
    await settle();
    open.resolve([adminRow('Stale open result')]);
    await settle();
    tree = renderScreen(AdminSupportIndexScreen);
    expect(textValues(tree)).toContain('Closed result');
    expect(textValues(tree)).not.toContain('Stale open result');
  });

  it('CM_ADMIN_SUPPORT_CLOSED_UNREAD shows closed status and unread count independently', async () => {
    const row = adminRow('Closed unread request', 'closed', 2);
    const tree = await loadAdminRows([row], 'closed');
    const badges = findElements(tree, 'Badge').map((element) => element.props.label);
    expectWithEvidence(['closed', '2 unread'].every((label) => badges.includes(label)), { badges, row });
  });

  it('CM_ADMIN_SUPPORT_TIME_PRIVACY shows readable last-message time without copied private fields', async () => {
    const row = adminRow('Support request');
    const tree = await loadAdminRows([row]);
    const visible = textValues(tree).join(' ');
    const privateCopiedFields = [row.user_name, row.user_phone, row.last_message];

    expectWithEvidence(visible.includes('Last message'), { visible, timestamp: row.last_message_at });
    expectWithEvidence(visible.includes('2 Jan 2026'), { visible, timestamp: row.last_message_at });
    expectWithEvidence(!privateCopiedFields.some((value) => visible.includes(value)), { visible, privateCopiedFields });
    expectWithEvidence(!visible.includes(row.last_message_at), { visible, timestamp: row.last_message_at });
  });
});
