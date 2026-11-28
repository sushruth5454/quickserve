import React from 'react';
import type { ProviderJob } from '../../../lib/types';

const mockRouter = { push: jest.fn() };
const mockGetProviderJobs = jest.fn();
const mockListCategories = jest.fn();
const mockRefreshUnread = jest.fn(async () => undefined);

jest.doMock('expo-router', () => {
  const ReactModule = require('react') as typeof React;
  return {
    router: mockRouter,
    useFocusEffect(callback: () => void | (() => void)) {
      ReactModule.useEffect(() => {
        const cleanup = callback();
        return typeof cleanup === 'function' ? cleanup : undefined;
      }, [callback]);
    },
  };
});
jest.doMock('react-native', () => ({ View: 'div' }));
jest.doMock('../../../components/CategoryIcon', () => ({
  CategoryIcon: () => React.createElement('span', null, 'category'),
  iconForCategory: () => undefined,
}));
jest.doMock('../../../components/UnreadChat', () => ({
  UnreadMessagesRow: ({ bookingId }: { bookingId: string }) => React.createElement('span', null, `unread:${bookingId}`),
}));
jest.doMock('../../../components/ui', () => {
  const ReactModule = require('react') as typeof React;
  return {
    Card: ({ children, onPress, accessibilityLabel }: {
      children: React.ReactNode;
      onPress?: () => void;
      accessibilityLabel?: string;
    }) => ReactModule.createElement('article', { 'data-label': accessibilityLabel, onClick: onPress }, children),
    EmptyState: ({ title, message }: { title: string; message?: string }) =>
      ReactModule.createElement('div', { 'data-testid': 'empty' }, ReactModule.createElement('strong', null, title), message),
    ErrorState: ({ message, onRetry }: { message: string; onRetry?: () => void }) =>
      ReactModule.createElement('div', { role: 'alert' }, message,
        onRetry ? ReactModule.createElement('button', { type: 'button', onClick: onRetry }, 'Retry') : null),
    Header: ({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) =>
      ReactModule.createElement('header', null, title, subtitle, children),
    InlineAlert: ({ title, message }: { title?: string; message?: string }) =>
      ReactModule.createElement('div', { role: 'alert' }, title, message),
    Screen: ({ header, children, onRefresh }: {
      header?: React.ReactNode;
      children: React.ReactNode;
      onRefresh?: () => Promise<void>;
    }) =>
      ReactModule.createElement('main', null, header, children,
        ReactModule.createElement('button', {
          type: 'button',
          'aria-label': 'Refresh jobs',
          onClick: () => void onRefresh?.(),
        }, 'Refresh')),
    SegmentedControl: <T extends string,>({ options, onChange }: {
      options: { value: T; label: string }[];
      onChange: (value: T) => void;
    }) =>
      ReactModule.createElement('nav', null, ...options.map((option) =>
        ReactModule.createElement('button', {
          key: option.value,
          type: 'button',
          'aria-label': `filter:${option.value}`,
          onClick: () => onChange(option.value),
        }, option.label),
      )),
    SkeletonBookingCard: () => ReactModule.createElement('div', { 'data-testid': 'skeleton' }, 'Loading'),
    Text: ({ children }: { children: React.ReactNode }) => ReactModule.createElement('span', null, children),
  };
});
jest.doMock('../../../components/status', () => {
  const actual = jest.requireActual('../../../components/status') as { activeStatuses: string[] };
  return {
    activeStatuses: actual.activeStatuses,
    StatusPill: ({ status }: { status: string }) => React.createElement('span', null, status),
  };
});
jest.doMock('../../../lib/api', () => ({
  getProviderJobs: (...args: unknown[]) => mockGetProviderJobs(...args),
  listCategories: (...args: unknown[]) => mockListCategories(...args),
}));
jest.doMock('../../../lib/money', () => ({ formatINR: (amount: number) => `₹${amount}` }));
jest.doMock('../../../lib/unreadContext', () => ({
  useUnread: () => ({ refresh: mockRefreshUnread, countFor: () => 0 }),
}));
jest.doMock('../../../theme', () => ({ useTheme: () => ({ spacing: { lg: 20, md: 12 } }) }));

const { createRoot } = require('react-dom/client') as { createRoot: (container: Element) => TestRoot };
const testAct = require('react').act as (callback: () => void | Promise<void>) => Promise<void>;
type TestRoot = { render: (node: React.ReactNode) => void; unmount: () => void };
const mockDom = new (require('jsdom').JSDOM)('<!doctype html><html><body></body></html>');
Object.defineProperty(globalThis, 'window', { configurable: true, value: mockDom.window });
Object.defineProperty(globalThis, 'document', { configurable: true, value: mockDom.window.document });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: mockDom.window.navigator });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const JobsScreen = require('../../identityScreens/JobsScreen').default as React.ComponentType;
const { activeStatuses } = require('../../../components/status') as { activeStatuses: ProviderJob['status'][] };
const { selectDashboardWork } = require('../model') as {
  selectDashboardWork: (jobs: ProviderJob[]) => { incoming: ProviderJob[]; next: ProviderJob | undefined; rest: ProviderJob[] };
};

let container: HTMLDivElement;
let root: TestRoot | undefined;

function job(booking_id: string, status: ProviderJob['status']): ProviderJob {
  return {
    booking_id,
    status,
    archetype: 'proposal',
    category_name: 'Repairs',
    customer_name: booking_id,
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
    root?.render(React.createElement(JobsScreen));
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

async function unmount() {
  if (root) await testAct(() => root?.unmount());
  container?.remove();
  root = undefined;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetProviderJobs.mockResolvedValue([]);
  mockListCategories.mockResolvedValue([]);
  mockRefreshUnread.mockResolvedValue(undefined);
});

afterEach(async () => {
  await unmount();
});

describe('O25-ID08 jobs presentation', () => {
  it('ID-JOBS-STALE-ERROR: shows refresh failure while retaining previously loaded jobs', async () => {
    mockGetProviderJobs.mockResolvedValue([job('shared-confirmed-booking', 'confirmed')]);
    await mount();
    mockGetProviderJobs.mockRejectedValueOnce(new Error('network unavailable'));
    await press('Refresh jobs');

    const actual = {
      error: container.querySelector('[role="alert"]')?.textContent,
      visibleJobs: [...container.querySelectorAll('article')].map((item) => item.getAttribute('data-label')),
      staleRow: container.textContent?.includes('shared-confirmed-booking') ?? false,
    };
    expect(actual).toEqual({
      error: 'Could not refresh jobsnetwork unavailable Previously loaded jobs are still shown.',
      visibleJobs: ['Repairs for shared-confirmed-booking'],
      staleRow: true,
    });
  });

  it('ID-JOBS-SAME-BOOKING: confirmed and delivery_pending retain the same IDs in dashboard, Jobs Active and member work', async () => {
    const jobs = [
      job('shared-confirmed-booking', 'confirmed'),
      job('shared-delivery-booking', 'delivery_pending'),
      job('closed-booking', 'closed'),
    ];
    const dashboard = selectDashboardWork(jobs);
    const dashboardIds = [dashboard.next?.booking_id, ...dashboard.rest.map((item) => item.booking_id)];
    const activeIds = jobs.filter((item) => activeStatuses.includes(item.status)).map((item) => item.booking_id);
    const memberAssignedIds = jobs.map((item) => item.booking_id);
    mockGetProviderJobs.mockResolvedValue(jobs);
    await mount();
    await press('filter:active');

    const actual = {
      dashboardIds,
      activeIds,
      memberAssignedIds,
      visibleJobs: [...container.querySelectorAll('article')].map((item) => item.getAttribute('data-label')),
    };
    expect(actual).toEqual({
      dashboardIds: ['shared-confirmed-booking', 'shared-delivery-booking'],
      activeIds: ['shared-confirmed-booking', 'shared-delivery-booking'],
      memberAssignedIds: ['shared-confirmed-booking', 'shared-delivery-booking', 'closed-booking'],
      visibleJobs: [
        'Repairs for shared-confirmed-booking',
        'Repairs for shared-delivery-booking',
      ],
    });
  });

  it('uses distinct empty guidance for all, active and closed filters', async () => {
    mockGetProviderJobs.mockResolvedValue([]);
    await mount();
    expect(container.querySelector('[data-testid="empty"]')?.textContent).toBe('No jobs yetNew requests and bookings will appear here.');

    await press('filter:active');
    expect(container.querySelector('[data-testid="empty"]')?.textContent).toBe('No active jobsRequests and ongoing bookings will appear here.');

    await press('filter:done');
    expect(container.querySelector('[data-testid="empty"]')?.textContent).toBe('No closed jobs yetCompleted or closed jobs will appear here.');
  });
});
