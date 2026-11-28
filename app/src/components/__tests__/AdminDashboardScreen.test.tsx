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

import type React from 'react';
import type { AdminDashboard } from '../../lib/adminApi';

const mockRuntime = {
  cursor: 0,
  states: [] as unknown[],
  featureStates: { oorva_brand: false, oorva_admin_ops_ux: false } as Record<string, unknown>,
  returnTo: 'account',
};
const mockUseFocusEffect = jest.fn();
const mockGetDashboard = jest.fn();
const mockRouter = { dismissTo: jest.fn(), push: jest.fn() };

jest.mock('react', () => {
  const actual = jest.requireActual<typeof import('react')>('react');
  return {
    ...actual,
    useState(initial: unknown) {
      const index = mockRuntime.cursor++;
      if (!(index in mockRuntime.states)) mockRuntime.states[index] = initial;
      return [mockRuntime.states[index], (next: unknown) => {
        mockRuntime.states[index] = typeof next === 'function'
          ? (next as (mockCurrent: unknown) => unknown)(mockRuntime.states[index])
          : next;
      }];
    },
    useCallback(callback: unknown) { return callback; },
  };
});
jest.mock('expo-router', () => ({
  router: mockRouter,
  useFocusEffect: mockUseFocusEffect,
  useLocalSearchParams: () => ({ returnTo: mockRuntime.returnTo }),
}));
jest.mock('react-native', () => ({ View: 'View' }));
jest.mock('../../components/ui', () => ({
  Badge: 'Badge',
  Card: 'Card',
  EmptyState: 'EmptyState',
  Header: 'Header',
  ListItem: 'ListItem',
  Screen: 'Screen',
  Skeleton: 'Skeleton',
  Text: 'Text',
}));
jest.mock('../../lib/adminApi', () => ({ getDashboard: mockGetDashboard }));
jest.mock('../../lib/adminFeaturePresentation', () => ({ isAdminRulesEditorEnabled: () => false }));
jest.mock('../../lib/featureFlags', () => ({
  useAppFeatureFlags: () => {
    const { isFeatureOn } = jest.requireActual('../../lib/featureFlagModel') as typeof import('../../lib/featureFlagModel');
    return { isOn: (key: string) => isFeatureOn(mockRuntime.featureStates, key) };
  },
}));
jest.mock('../../theme', () => ({ useTheme: () => ({
  spacing: { sm: 8, md: 12 },
  radii: { lg: 12 },
  colors: { primary: '#000' },
}) }));

const ReactRuntime = require('react') as typeof import('react');
const { default: AdminIndexScreen } = require('../../features/communicationScreens/AdminIndexScreen') as {
  default: () => unknown;
};

const dashboard: AdminDashboard = {
  days: 30,
  totals: {
    users: 1,
    customers: 1,
    providers: 0,
    providers_verified: 0,
    providers_online: 0,
    providers_pending: 0,
    creators: 0,
    bookings: 0,
    bookings_active: 0,
    disputes_open: 0,
    gmv_paise: 193760,
    gmv_period_paise: 193760,
    platform_fees_paise: 0,
    requests_open: 0,
    support_open: 0,
    support_unread: 0,
  },
  daily: [],
  top_categories: [],
  status: {},
};

function renderScreen() {
  mockRuntime.cursor = 0;
  return AdminIndexScreen();
}

function expectWithEvidence(condition: boolean, evidence: unknown) {
  const evidenceJson = JSON.stringify(evidence);
  expect({ condition, evidenceJson }).toEqual({ condition: true, evidenceJson });
}

function findElements(node: unknown, type: string): Array<React.ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.flatMap((child) => findElements(child, type));
  if (!ReactRuntime.isValidElement(node)) return [];
  const element = node as React.ReactElement<Record<string, unknown>>;
  if (typeof element.type === 'function') {
    return findElements((element.type as (props: Record<string, unknown>) => unknown)(element.props), type);
  }
  return [
    ...(element.type === type ? [element] : []),
    ...findElements(element.props.children, type),
  ];
}

function runFocusedLoad() {
  const callback = mockUseFocusEffect.mock.calls.at(-1)?.[0];
  if (typeof callback === 'function') (callback as () => void)();
}

async function drainMicrotasks() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function renderedText(node: unknown): string[] {
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(renderedText);
  if (!ReactRuntime.isValidElement(node)) return [];
  const element = node as React.ReactElement<Record<string, unknown>>;
  if (typeof element.type === 'function') {
    return renderedText((element.type as (props: Record<string, unknown>) => unknown)(element.props));
  }
  return renderedText(element.props.children);
}

beforeEach(() => {
  mockRuntime.cursor = 0;
  mockRuntime.states = [];
  mockRuntime.featureStates = { oorva_brand: false, oorva_admin_ops_ux: false };
  mockRuntime.returnTo = 'account';
  mockUseFocusEffect.mockReset();
  mockGetDashboard.mockReset().mockResolvedValue(dashboard);
  mockRouter.dismissTo.mockReset();
  mockRouter.push.mockReset();
});

describe('AdminIndexScreen', () => {
  it('CM_DASHBOARD_GROSS_LABEL shows gross wording and preserves returned paise', async () => {
    renderScreen();
    runFocusedLoad();
    await drainMicrotasks();

    const visible = renderedText(renderScreen());
    expect(mockGetDashboard).toHaveBeenCalledWith(30);
    expect(dashboard.totals.gmv_period_paise).toBe(193760);
    expect(visible).toContain('Gross payments collected');
    expect(visible).toContain('₹1,937.60');
    expect(visible).toContain('KYC verified');
  });

  it('CM_ADMIN_QUEUE_ORDER puts pending operations before reporting when effective admin operations UX is on', async () => {
    mockRuntime.featureStates = { oorva_brand: true, oorva_admin_ops_ux: true };
    renderScreen();
    runFocusedLoad();
    await drainMicrotasks();

    const visible = renderedText(renderScreen());
    const order = {
      people: visible.indexOf('People'),
      support: visible.indexOf('Support'),
      trend: visible.indexOf('Bookings trend'),
    };
    expectWithEvidence(['People', 'Support', 'Bookings trend'].every((item) => visible.includes(item)), { order, visible });
    expectWithEvidence(Math.max(order.people, order.support) < order.trend, { order, visible });
  });

  it('CM_ADMIN_QUEUE_ORDER retains legacy trend-before-queues order when the leaf is off', async () => {
    mockRuntime.featureStates = { oorva_brand: true, oorva_admin_ops_ux: false };
    renderScreen();
    runFocusedLoad();
    await drainMicrotasks();

    const visible = renderedText(renderScreen());
    const order = { people: visible.indexOf('People'), trend: visible.indexOf('Bookings trend') };
    expectWithEvidence(order.people > order.trend, { order, visible });
  });

  it('CM_ADMIN_OPS_PRESENTATION_MATRIX keeps legacy order and truthful zero work when parent is off but child is on', async () => {
    mockRuntime.featureStates = { oorva_brand: false, oorva_admin_ops_ux: true };
    mockGetDashboard.mockResolvedValueOnce({
      ...dashboard,
      totals: {
        ...dashboard.totals,
        users: 0,
        customers: 0,
        providers_verified: 0,
        providers_pending: 0,
        providers_online: 0,
        creators: 0,
        bookings: 0,
        bookings_active: 0,
        disputes_open: 0,
        gmv_period_paise: 0,
        support_open: 0,
        support_unread: 0,
      },
    });
    renderScreen();
    runFocusedLoad();
    await drainMicrotasks();

    const visible = renderedText(renderScreen());
    const order = { people: visible.indexOf('People'), trend: visible.indexOf('Bookings trend') };
    expectWithEvidence(order.people > order.trend, { featureStates: mockRuntime.featureStates, order, visible });
    expectWithEvidence(visible.includes('₹0'), { featureStates: mockRuntime.featureStates, visible });
    expectWithEvidence(visible.includes('KYC verified'), { featureStates: mockRuntime.featureStates, visible });
  });

  it('CM_ADMIN_OPS_PRESENTATION_MATRIX preserves a genuine dashboard failure instead of presenting zero work', async () => {
    mockGetDashboard.mockRejectedValueOnce(new Error('dashboard service unavailable'));
    renderScreen();
    runFocusedLoad();
    await drainMicrotasks();

    const tree = renderScreen();
    const error = findElements(tree, 'EmptyState').find((element) => element.props.title === 'Dashboard unavailable');
    expectWithEvidence(error?.props.message === 'dashboard service unavailable', { error: error?.props, visible: renderedText(tree) });
  });

  it('CM_ADMIN_SETTINGS_LINK uses the implemented settings destination and preserves the return target', async () => {
    mockRuntime.returnTo = 'pro-account';
    renderScreen();
    runFocusedLoad();
    await drainMicrotasks();

    const tree = renderScreen() as React.ReactElement<Record<string, unknown>>;
    const settings = findElements(tree, 'Card').find((card) =>
      renderedText(card.props.children).includes('Settings'));
    (settings?.props.onPress as (() => void) | undefined)?.();
    expectWithEvidence(mockRouter.push.mock.calls.some(([target]) => target === '/admin/settings'), {
      settingsFound: Boolean(settings),
      pushes: mockRouter.push.mock.calls,
    });

    const header = tree.props.header as React.ReactElement<Record<string, unknown>>;
    (header.props.onBack as (() => void) | undefined)?.();
    expectWithEvidence(mockRouter.dismissTo.mock.calls.some(([target]) => target === '/pro-account'), {
      returnTo: mockRuntime.returnTo,
      dismissals: mockRouter.dismissTo.mock.calls,
    });
  });
});
