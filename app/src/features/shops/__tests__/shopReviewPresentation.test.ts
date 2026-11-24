import React from 'react';
import type { ShopStatus } from '../api';
import { shopReviewActions } from '../shopReviewPresentation';

const mockApi = {
  adminListProductCategories: jest.fn(),
  adminListShops: jest.fn(),
  adminSetProductCategoryActive: jest.fn(),
  adminSetShopStatus: jest.fn(),
  adminShopDashboard: jest.fn(),
};
const mockToast = jest.fn();
const mockInputChanges = new Map<string, (value: string) => void>();

const mockDom = new (require('jsdom').JSDOM)('<!doctype html><html><body></body></html>');
Object.defineProperty(globalThis, 'window', { configurable: true, value: mockDom.window });
Object.defineProperty(globalThis, 'document', { configurable: true, value: mockDom.window.document });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: mockDom.window.navigator });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.doMock('expo-router', () => {
  const ReactModule = require('react') as typeof React;
  return {
    router: {},
    useFocusEffect(callback: () => void | (() => void)) {
      ReactModule.useEffect(() => callback(), [callback]);
    },
  };
});
jest.doMock('react-native', () => ({ View: 'div' }));
jest.doMock('../../../components/ui', () => {
  const ReactModule = require('react') as typeof React;
  return {
    Button: ({ title, onPress, disabled, loading }: { title: string; onPress?: () => void; disabled?: boolean; loading?: boolean }) =>
      ReactModule.createElement('button', { type: 'button', 'aria-label': title, disabled: !!disabled || !!loading, onClick: onPress }, title),
    Card: ({ children }: { children: React.ReactNode }) => ReactModule.createElement('section', null, children),
    Chip: ({ label }: { label: string }) => ReactModule.createElement('button', { type: 'button' }, label),
    EmptyState: ({ title }: { title: string }) => ReactModule.createElement('section', null, title),
    ErrorState: ({ message }: { message: string }) => ReactModule.createElement('section', null, message),
    Header: ({ title }: { title: string }) => ReactModule.createElement('header', null, title),
    InlineAlert: ({ message }: { message?: string | null }) =>
      message ? ReactModule.createElement('div', { role: 'alert' }, message) : null,
    Input: ({ label, value, onChangeText }: { label: string; value: string; onChangeText: (value: string) => void }) => {
      mockInputChanges.set(label, onChangeText);
      return ReactModule.createElement('label', null, label, ReactModule.createElement('input', {
        'aria-label': label,
        value,
        onChange: (event: { currentTarget: { value: string } }) => onChangeText(event.currentTarget.value),
      }));
    },
    Screen: ({ children, header }: { children: React.ReactNode; header?: React.ReactNode }) =>
      ReactModule.createElement('main', null, header, children),
    Skeleton: () => ReactModule.createElement('div', null, 'Loading'),
    Text: ({ children }: { children: React.ReactNode }) => ReactModule.createElement('span', null, children),
    useToast: () => mockToast,
  };
});
jest.doMock('../api', () => ({
  adminListProductCategories: (...args: unknown[]) => mockApi.adminListProductCategories(...args),
  adminListShops: (...args: unknown[]) => mockApi.adminListShops(...args),
  adminSetProductCategoryActive: (...args: unknown[]) => mockApi.adminSetProductCategoryActive(...args),
  adminSetShopStatus: (...args: unknown[]) => mockApi.adminSetShopStatus(...args),
  adminShopDashboard: (...args: unknown[]) => mockApi.adminShopDashboard(...args),
}));
jest.doMock('../components', () => ({
  ShopStatusLabel: ({ status }: { status: ShopStatus }) => React.createElement('span', null, status),
}));
jest.doMock('../../../theme', () => ({
  useTheme: () => ({
    spacing: { xs: 4, sm: 8, md: 12 },
    radii: { lg: 12 },
  }),
}));

const AdminShopsScreen = require('../../marketplaceScreens/AdminShopsScreen').default as React.ComponentType;
const { createRoot } = require('react-dom/client') as {
  createRoot: (container: Element) => { render: (element: React.ReactElement) => void; unmount: () => void };
};
const testAct = require('react').act as (callback: () => void | Promise<void>) => Promise<void>;

function assertActual(label: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  }
}

function shop(status: ShopStatus) {
  return {
    id: 'shop-1',
    name: 'Corner Supply',
    description: '',
    address_line: '12 Market Road',
    city: 'Hyderabad',
    area: 'North',
    lat: null,
    lng: null,
    gstin: null,
    status,
    status_reason: null,
    owner_name: 'Shop Owner',
    category_slugs: ['tiles'],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

type TestRoot = { render: (element: React.ReactElement) => void; unmount: () => void };
let root: TestRoot | undefined;
let container: HTMLDivElement;

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await testAct(async () => {
    root?.render(React.createElement(AdminShopsScreen));
    await flush();
  });
}

async function press(label: string) {
  const button = [...container.querySelectorAll('button')].find((item) => item.getAttribute('aria-label') === label);
  if (!button) throw new Error(`Missing button ${label}; DOM=${container.textContent}`);
  await testAct(async () => {
    button.click();
    await flush();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockInputChanges.clear();
  mockApi.adminListShops.mockResolvedValue([shop('submitted')]);
  mockApi.adminListProductCategories.mockResolvedValue([]);
  mockApi.adminSetProductCategoryActive.mockResolvedValue(undefined);
  mockApi.adminSetShopStatus.mockResolvedValue(undefined);
  mockApi.adminShopDashboard.mockResolvedValue({ shops: 1, verified_shops: 0, products: 0, open_enquiries: 0 });
});

afterEach(async () => {
  if (root) await testAct(() => root?.unmount());
  container?.remove();
  root = undefined;
});

describe('shop review presentation', () => {
  it('MK-ADMIN-six-state-actions mirrors the RPC verification origins and omits completed same-state actions', () => {
    const actual = Object.fromEntries(([
      'draft',
      'submitted',
      'under_review',
      'verified',
      'rejected',
      'suspended',
    ] as const).map((status) => [
      status,
      shopReviewActions(status).map(({ id, label, requiresReason, confirmation }) => ({
        id,
        label,
        requiresReason,
        confirmation,
      })),
    ]));
    const expected = {
      draft: [
        { id: 'under_review', label: 'Under review', requiresReason: false, confirmation: 'none' },
        { id: 'rejected', label: 'Reject', requiresReason: true, confirmation: 'destructive' },
        { id: 'suspended', label: 'Suspend', requiresReason: true, confirmation: 'destructive' },
      ],
      submitted: [
        { id: 'under_review', label: 'Under review', requiresReason: false, confirmation: 'none' },
        { id: 'verified', label: 'Verify', requiresReason: false, confirmation: 'none' },
        { id: 'rejected', label: 'Reject', requiresReason: true, confirmation: 'destructive' },
        { id: 'suspended', label: 'Suspend', requiresReason: true, confirmation: 'destructive' },
      ],
      under_review: [
        { id: 'verified', label: 'Verify', requiresReason: false, confirmation: 'none' },
        { id: 'rejected', label: 'Reject', requiresReason: true, confirmation: 'destructive' },
        { id: 'suspended', label: 'Suspend', requiresReason: true, confirmation: 'destructive' },
      ],
      verified: [
        { id: 'under_review', label: 'Under review', requiresReason: false, confirmation: 'none' },
        { id: 'rejected', label: 'Reject', requiresReason: true, confirmation: 'destructive' },
        { id: 'suspended', label: 'Suspend', requiresReason: true, confirmation: 'destructive' },
      ],
      rejected: [
        { id: 'under_review', label: 'Under review', requiresReason: false, confirmation: 'none' },
        { id: 'suspended', label: 'Suspend', requiresReason: true, confirmation: 'destructive' },
      ],
      suspended: [
        { id: 'under_review', label: 'Under review', requiresReason: false, confirmation: 'none' },
        { id: 'verified', label: 'Restore verification', requiresReason: false, confirmation: 'none' },
        { id: 'rejected', label: 'Reject', requiresReason: true, confirmation: 'destructive' },
      ],
    };
    assertActual('Six shop-state action map', actual, expected);
  });

  it('MK-ADMIN-reason-and-cancel keeps destructive reason inside confirmation and refreshes stale server denials', async () => {
    mockApi.adminListShops
      .mockResolvedValueOnce([shop('submitted')])
      .mockResolvedValueOnce([shop('verified')]);
    mockApi.adminSetShopStatus.mockRejectedValueOnce(new Error('stale status'));
    await mount();

    await press('Reject');
    const confirm = [...container.querySelectorAll('button')].find((item) => item.getAttribute('aria-label') === 'Confirm Reject');
    assertActual('Blank reason keeps confirmation disabled and makes no RPC call', {
      disabled: confirm?.disabled ?? false,
      rpcCalls: mockApi.adminSetShopStatus.mock.calls.length,
    }, { disabled: true, rpcCalls: 0 });
    await press('Cancel');
    assertActual('Cancelling confirmation makes no RPC call', mockApi.adminSetShopStatus.mock.calls.length, 0);

    await press('Reject');
    const reasonChange = mockInputChanges.get('Reason to reject');
    if (!reasonChange) throw new Error(`Missing destructive reason input; DOM=${container.textContent}`);
    await testAct(async () => {
      reasonChange('  profile issue  ');
      await flush();
    });
    await press('Confirm Reject');

    assertActual('Denied stale action refreshes without optimistic success', {
      rpcArgs: mockApi.adminSetShopStatus.mock.calls,
      reads: mockApi.adminListShops.mock.calls.length,
      status: container.textContent?.includes('verified') ?? false,
      actionError: [...container.querySelectorAll('[role="alert"]')].map((node) => node.textContent),
      successToasts: mockToast.mock.calls,
    }, {
      rpcArgs: [['shop-1', 'rejected', 'profile issue']],
      reads: 2,
      status: true,
      actionError: ['stale status'],
      successToasts: [],
    });
  });
});
