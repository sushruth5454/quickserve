import type React from 'react';
import type { AdminDashboard } from '../../lib/adminApi';

const mockRuntime = { cursor: 0, states: [] as unknown[] };
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
  useLocalSearchParams: () => ({ returnTo: 'account' }),
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
jest.mock('../../lib/featureFlags', () => ({ useAppFeatureFlags: () => ({ isOn: () => false }) }));
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
});
