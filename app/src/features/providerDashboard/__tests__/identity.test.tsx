import React from 'react';
import type { GoLive } from '../../../lib/onboarding';

const mockRouter = { replace: jest.fn(), push: jest.fn() };
const mockRouteParams: Record<string, string | string[]> = {};
const mockAuth = { userId: 'user-a' };
const mockGetMyProviderBusinessContext = jest.fn();
const mockListMyBusinessProviderJobs = jest.fn();
const mockGetMyProfile = jest.fn();
const mockListCategories = jest.fn();
const mockListMyPayouts = jest.fn();
const mockGetOnboarding = jest.fn();
const mockGetCatalog = jest.fn();
const mockRefreshUnread = jest.fn(async () => undefined);
const mockToast = jest.fn();
const mockOpenBooking = jest.fn();
let mockPrimaryAction: ((job: { booking_id: string }) => unknown) | undefined;

jest.doMock('expo-router', () => {
  const ReactModule = require('react') as typeof React;
  return {
    router: mockRouter,
    useLocalSearchParams: () => mockRouteParams,
    useFocusEffect(callback: () => void | (() => void)) {
      ReactModule.useEffect(() => {
        const cleanup = callback();
        return typeof cleanup === 'function' ? cleanup : undefined;
      }, [callback]);
    },
  };
});
jest.doMock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.doMock('../../../components/CategoryIcon', () => ({ iconForCategory: () => undefined }));
jest.doMock('../../../components/ui', () => ({ useToast: () => mockToast }));
jest.doMock('../../../lib/api', () => ({
  acceptBooking: jest.fn(async () => undefined),
  declineBooking: jest.fn(async () => undefined),
  getBooking: jest.fn(async () => ({ photos: [] })),
  getBookingCommissionRate: jest.fn(async () => 1000),
  getMyProfile: (...args: unknown[]) => mockGetMyProfile(...args),
  listCategories: (...args: unknown[]) => mockListCategories(...args),
  listMyPayouts: (...args: unknown[]) => mockListMyPayouts(...args),
  setOnline: jest.fn(async () => undefined),
  signedPhotoUrls: jest.fn(async () => []),
  startTrip: jest.fn(async () => undefined),
}));
jest.doMock('../../../lib/haptics', () => ({ haptics: { error: jest.fn(), select: jest.fn() } }));
jest.doMock('../../../lib/providerInsights', () => ({
  providerStats: () => ({ acceptance: null, completion: null }),
}));
jest.doMock('../../../lib/auth', () => ({ useAuth: () => mockAuth }));
jest.doMock('../../../lib/push', () => ({ registerForPush: jest.fn() }));
jest.doMock('../../../lib/onboarding', () => ({
  onboardingApi: {
    getOnboarding: (...args: unknown[]) => mockGetOnboarding(...args),
    getCatalog: (...args: unknown[]) => mockGetCatalog(...args),
  },
}));
jest.doMock('../../../lib/unreadContext', () => ({
  useUnread: () => ({ total: () => 0, notifications: 0, refresh: mockRefreshUnread, countFor: () => 0 }),
}));
jest.doMock('../../../theme', () => ({
  useTheme: () => ({ spacing: { lg: 20 }, colors: {} }),
}));
jest.doMock('../../merchantStaff/api', () => ({
  getMyProviderBusinessContext: (...args: unknown[]) => mockGetMyProviderBusinessContext(...args),
  listMyBusinessProviderJobs: (...args: unknown[]) => mockListMyBusinessProviderJobs(...args),
}));
jest.doMock('../DashboardWidgets', () => ({
  getPrimaryJobAction: () => 'booking_detail',
}));
jest.doMock('../navigation', () => ({ openBooking: (...args: unknown[]) => mockOpenBooking(...args) }));
jest.doMock('../BusinessDashboardView', () => ({
  BusinessDashboardView: (props: { provider: { business_role: string; id: string }; jobs: { booking_id: string }[] | null }) =>
    React.createElement('div', {
      'data-testid': 'business-dashboard',
      'data-provider-id': props.provider.id,
      'data-role': props.provider.business_role,
      'data-jobs': props.jobs?.map((job) => job.booking_id).join(',') ?? 'loading',
    }),
}));
jest.doMock('../ProviderDashboardView', () => ({
  ProviderDashboardView: (props: {
    provider: { id: string } | null;
    jobs: { booking_id: string }[] | null;
    goLiveReadFailed: boolean;
    payoutReadFailed: boolean;
    primaryAction: (job: { booking_id: string }) => unknown;
  }) =>
    (() => {
      mockPrimaryAction = props.primaryAction;
      return React.createElement('div', {
        'data-testid': 'owner-dashboard',
        'data-provider-id': props.provider?.id ?? 'none',
        'data-jobs': props.jobs?.map((job) => job.booking_id).join(',') ?? 'loading',
        'data-go-live-failed': String(props.goLiveReadFailed),
        'data-payout-failed': String(props.payoutReadFailed),
      });
    })(),
}));

const { createRoot } = require('react-dom/client') as { createRoot: (container: Element) => TestRoot };
const testAct = require('react').act as (callback: () => void | Promise<void>) => Promise<void>;
type TestRoot = { render: (node: React.ReactNode) => void; unmount: () => void };
const mockDom = new (require('jsdom').JSDOM)('<!doctype html><html><body></body></html>');
Object.defineProperty(globalThis, 'window', { configurable: true, value: mockDom.window });
Object.defineProperty(globalThis, 'document', { configurable: true, value: mockDom.window.document });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: mockDom.window.navigator });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ProviderDashboard = require('../ProviderDashboard').default as React.ComponentType;
const { getPayoutSetupLabel, shouldShowStaffManagementShortcut } = require('../model') as {
  getPayoutSetupLabel: (goLive: GoLive | null, readFailed: boolean) => string;
  shouldShowStaffManagementShortcut: (role: 'owner' | 'manager' | 'staff' | null, enabled: boolean) => boolean;
};

let container: HTMLDivElement;
let root: TestRoot | undefined;

function provider(id: string, business_role: 'owner' | 'manager' | 'staff' = 'owner') {
  return {
    id,
    business_role,
    is_online: true,
    service_radius_km: 15,
    suspended: false,
    rating_count: 0,
    rating_avg: 0,
  };
}

function job(booking_id: string) {
  return {
    booking_id,
    status: 'confirmed',
    archetype: 'proposal',
    category_name: 'Repairs',
    customer_name: 'Customer',
    description: '',
    scheduled_at: null,
    created_at: '2026-11-27T10:00:00.000Z',
    visit_fee: 100,
    area: '',
    distance_km: null,
    address_line: null,
    lat: null,
    lng: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await testAct(async () => {
    root?.render(React.createElement(ProviderDashboard));
    await flush();
  });
}

async function rerender() {
  await testAct(async () => {
    root?.render(React.createElement(ProviderDashboard));
    await flush();
  });
}

async function unmount() {
  if (root) await testAct(() => root?.unmount());
  container?.remove();
  root = undefined;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrimaryAction = undefined;
  Object.keys(mockRouteParams).forEach((key) => delete mockRouteParams[key]);
  mockAuth.userId = 'user-a';
  mockGetMyProviderBusinessContext.mockImplementation(async (id: string) => provider(id ?? 'provider-default'));
  mockListMyBusinessProviderJobs.mockImplementation(async (id: string) => [job(`${id}-booking`)]);
  mockGetMyProfile.mockResolvedValue({ full_name: 'Provider Owner' });
  mockListCategories.mockResolvedValue([]);
  mockListMyPayouts.mockResolvedValue([]);
  mockGetOnboarding.mockResolvedValue({ go_live: { state: 'live', reasons: [], paused: false } });
  mockGetCatalog.mockResolvedValue({ docTypes: [] });
  mockRefreshUnread.mockResolvedValue(undefined);
});

afterEach(async () => {
  await unmount();
});

describe('O25-ID08 dashboard identity and readiness', () => {
  it('ID-DASH-CONTEXT-RACE: late provider A load cannot replace provider B or its jobs', async () => {
    const requestA = deferred<ReturnType<typeof provider>>();
    const requestB = deferred<ReturnType<typeof provider>>();
    mockRouteParams.providerId = 'A';
    mockGetMyProviderBusinessContext.mockImplementation((id: string) =>
      id === 'A' ? requestA.promise : requestB.promise,
    );

    await mount();
    mockRouteParams.providerId = 'B';
    await rerender();

    requestB.resolve(provider('B'));
    await testAct(flush);
    expect(container.querySelector('[data-testid="owner-dashboard"]')?.getAttribute('data-provider-id')).toBe('B');
    expect(container.querySelector('[data-testid="owner-dashboard"]')?.getAttribute('data-jobs')).toBe('B-booking');

    requestA.resolve(provider('A'));
    await testAct(flush);
    const actual = {
      provider: container.querySelector('[data-testid="owner-dashboard"]')?.getAttribute('data-provider-id'),
      jobs: container.querySelector('[data-testid="owner-dashboard"]')?.getAttribute('data-jobs'),
    };
    expect(actual).toEqual({ provider: 'B', jobs: 'B-booking' });
  });

  it('ID-DASH-OWNER-MEMBER: member work stays in its business context and never fetches owner payouts', async () => {
    mockRouteParams.providerId = 'owner';
    mockGetMyProviderBusinessContext.mockImplementation(async (id: string) =>
      provider(id, id === 'member' ? 'manager' : 'owner'),
    );
    mockListMyBusinessProviderJobs.mockResolvedValue([job('shared-confirmed-booking')]);
    await mount();

    expect(container.querySelector('[data-testid="owner-dashboard"]')?.getAttribute('data-jobs')).toBe('shared-confirmed-booking');
    expect(mockListMyPayouts).toHaveBeenCalledTimes(1);
    const staleOwnerAction = mockPrimaryAction;

    mockRouteParams.providerId = 'member';
    await rerender();
    await testAct(flush);
    await testAct(async () => {
      staleOwnerAction?.(job('shared-confirmed-booking'));
      await flush();
    });
    const actual = {
      memberRole: container.querySelector('[data-testid="business-dashboard"]')?.getAttribute('data-role'),
      memberJobs: container.querySelector('[data-testid="business-dashboard"]')?.getAttribute('data-jobs'),
      payoutCalls: mockListMyPayouts.mock.calls.length,
      staleActionCalls: mockOpenBooking.mock.calls.length,
    };
    expect(actual).toEqual({ memberRole: 'manager', memberJobs: 'shared-confirmed-booking', payoutCalls: 1, staleActionCalls: 0 });
  });

  it('ID-DASH-READINESS-UNKNOWN: failed canonical reads are not presented as verified or empty', async () => {
    mockRouteParams.providerId = 'owner';
    mockGetOnboarding.mockRejectedValue(new Error('offline'));
    mockListMyPayouts.mockRejectedValue(new Error('offline'));
    await mount();

    const actual = {
      provider: container.querySelector('[data-testid="owner-dashboard"]')?.getAttribute('data-provider-id'),
      marketplaceUnknown: container.querySelector('[data-testid="owner-dashboard"]')?.getAttribute('data-go-live-failed'),
      payoutUnknown: container.querySelector('[data-testid="owner-dashboard"]')?.getAttribute('data-payout-failed'),
      payoutLabel: getPayoutSetupLabel(null, true),
    };
    expect(actual).toEqual({
      provider: 'owner',
      marketplaceUnknown: 'true',
      payoutUnknown: 'true',
      payoutLabel: 'Unknown',
    });
  });

  it('ID-DASH-STAFF-FLAG-OFF: staff management is hidden when merchant_staff is off', () => {
    const actual = {
      enabledOwner: shouldShowStaffManagementShortcut('owner', true),
      disabledOwner: shouldShowStaffManagementShortcut('owner', false),
      enabledManager: shouldShowStaffManagementShortcut('manager', true),
    };
    expect(actual).toEqual({ enabledOwner: true, disabledOwner: false, enabledManager: false });
  });
});
