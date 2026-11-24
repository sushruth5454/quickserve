import React from 'react';

const mockReact = require('react') as typeof React;
const mockRpc = jest.fn();
const mockConfirm = jest.fn().mockResolvedValue(false);
const mockToast = jest.fn();
const mockFlags = { sports: true, oorva_brand: true, oorva_admin_ops_ux: true };
let mockSportsReadLoad: ((guard: { isCurrent: () => boolean }) => Promise<void>) | undefined;

const venueRows = [
  { id: 'submitted-1', name: 'A Submitted Court', city: 'Pune', area: 'Camp', owner_name: 'Owner A', status: 'submitted', status_reason: '' },
  { id: 'verified-1', name: 'B Verified Court', city: 'Pune', area: 'Camp', owner_name: 'Owner B', status: 'verified', status_reason: '' },
  { id: 'rejected-1', name: 'C Rejected Court', city: 'Pune', area: 'Camp', owner_name: 'Owner C', status: 'rejected', status_reason: 'Needs review' },
  { id: 'rejected-2', name: 'D Rejected Court', city: 'Pune', area: 'Camp', owner_name: 'Owner D', status: 'rejected', status_reason: 'Needs review' },
  { id: 'suspended-1', name: 'E Suspended Court', city: 'Pune', area: 'Camp', owner_name: 'Owner E', status: 'suspended', status_reason: 'Temporarily unavailable' },
  { id: 'draft-1', name: 'F Draft Court', city: 'Pune', area: 'Camp', owner_name: 'Owner F', status: 'draft', status_reason: '' },
];
const activityRows = [{ id: 'activity-1', name: 'Tennis', slug: 'tennis', active: true }];

jest.doMock('expo-router', () => ({ router: { back: jest.fn() } }));
jest.doMock('react-native', () => ({
  View: 'div',
  Switch: ({ value, disabled, onValueChange }: {
    value: boolean;
    disabled?: boolean;
    onValueChange: (value: boolean) => void;
  }) => mockReact.createElement('input', {
    type: 'checkbox',
    checked: value,
    disabled,
    onChange: (event: { target: { checked: boolean } }) => onValueChange(event.target.checked),
  }),
}));
jest.doMock('../../../../components/ui', () => ({
  Button: ({ title, onPress, disabled, testID, accessibilityLabel }: {
    title: string;
    onPress: () => void;
    disabled?: boolean;
    testID?: string;
    accessibilityLabel?: string;
  }) => mockReact.createElement('button', {
    type: 'button',
    disabled,
    'data-testid': testID,
    'aria-label': accessibilityLabel ?? title,
    onClick: onPress,
  }, title),
  Card: ({ children }: { children: React.ReactNode }) => mockReact.createElement('article', null, children),
  EmptyState: ({ title, message }: { title: string; message: string }) =>
    mockReact.createElement('div', null, title, ' ', message),
  ErrorState: ({ message }: { message: string }) => mockReact.createElement('div', null, message),
  Header: ({ title, subtitle }: { title: string; subtitle: string }) =>
    mockReact.createElement('header', null, title, ' ', subtitle),
  InlineAlert: ({ title, message }: { title?: string; message: string }) =>
    mockReact.createElement('div', { role: 'alert' }, title, ' ', message),
  Input: ({ label, value, onChangeText }: {
    label: string;
    value: string;
    onChangeText: (value: string) => void;
  }) => mockReact.createElement('label', null, label, mockReact.createElement('input', {
    value,
    onChange: (event: { target: { value: string } }) => onChangeText(event.target.value),
  })),
  Screen: ({ header, children }: { header: React.ReactNode; children: React.ReactNode }) =>
    mockReact.createElement('main', null, header, children),
  Skeleton: () => mockReact.createElement('div', { 'data-testid': 'loading' }),
  Text: ({ children }: { children: React.ReactNode }) => mockReact.createElement('span', null, children),
  useConfirm: () => mockConfirm,
  useToast: () => mockToast,
}));
jest.doMock('../../../../lib/featureFlags', () => ({
  useAppFeatureFlags: () => ({
    isOn: (key: string) => {
      if (key === 'sports') return mockFlags.sports;
      if (key === 'oorva_admin_ops_ux') return mockFlags.oorva_brand && mockFlags.oorva_admin_ops_ux;
      return false;
    },
  }),
}));
jest.doMock('../../../../lib/supabase', () => ({ supabase: { rpc: mockRpc } }));
jest.doMock('../../../../theme', () => ({
  useTheme: () => ({ radii: { lg: 12 }, spacing: { sm: 8, md: 16 } }),
}));
jest.doMock('../../useSportsReadRefresh', () => ({
  useSportsReadRefresh: (load: (guard: { isCurrent: () => boolean }) => Promise<void>) => {
    mockSportsReadLoad = load;
    return { refresh: jest.fn().mockResolvedValue(undefined) };
  },
}));

const AdminSportsScreen = require('../../../sportsScreens/AdminSportsScreen').default as () => React.ReactElement;
const {
  filterAdminVenueReviews,
  getAdminVenueReviewCounts,
} = require('../../../sportsScreens/AdminSportsScreen') as typeof import('../../../sportsScreens/AdminSportsScreen');
const mockDom = new (require('jsdom').JSDOM)('<!doctype html><html><body></body></html>');
Object.defineProperty(globalThis, 'window', { configurable: true, value: mockDom.window });
Object.defineProperty(globalThis, 'document', { configurable: true, value: mockDom.window.document });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: mockDom.window.navigator });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = require('react-dom/client') as {
  createRoot: (container: Element) => { render: (element: React.ReactElement) => void; unmount: () => void };
};
const testAct = require('react').act as (callback: () => void | Promise<void>) => Promise<void>;

type TestRoot = { render: (element: React.ReactElement) => void; unmount: () => void };
let root: TestRoot | undefined;
let container: HTMLDivElement;

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function renderAdminScreen() {
  container = document.createElement('div');
  await testAct(async () => {
    root = createRoot(container);
    root.render(React.createElement(AdminSportsScreen));
    await flushMicrotasks();
  });
  if (mockFlags.sports) {
    const load = mockSportsReadLoad;
    if (!load) throw new Error('admin sports read refresh was not registered');
    await testAct(async () => {
      await load({ isCurrent: () => true });
      await flushMicrotasks();
    });
  }
}

function clickFilter(status: string) {
  const button = container.querySelector(`[data-testid="admin-sports-review-filter-${status}"]`);
  if (!button) throw new Error(`missing ${status} review filter`);
  button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

beforeEach(() => {
  mockFlags.sports = true;
  mockFlags.oorva_brand = true;
  mockFlags.oorva_admin_ops_ux = true;
  mockSportsReadLoad = undefined;
  mockRpc.mockReset().mockImplementation((name: string) => {
    if (name === 'admin_list_sports_venues') return Promise.resolve({ data: venueRows, error: null });
    if (name === 'admin_list_sports_activities') return Promise.resolve({ data: activityRows, error: null });
    return Promise.resolve({ data: null, error: null });
  });
});

afterEach(async () => {
  if (root) {
    await testAct(async () => {
      root!.unmount();
      await flushMicrotasks();
    });
  }
  root = undefined;
  jest.clearAllMocks();
});

describe('SP-QUEUE-FILTER-COUNTS', () => {
  it('counts current states and filters rows without changing the server order', async () => {
    const counts = getAdminVenueReviewCounts(venueRows);
    const rejectedRows = filterAdminVenueReviews(venueRows, 'rejected');
    const allRows = filterAdminVenueReviews(venueRows, 'all');
    const expected = {
      counts: { all: 6, submitted: 1, verified: 1, rejected: 2, suspended: 1, draft: 1 },
      rejectedNames: ['C Rejected Court', 'D Rejected Court'],
      allNames: venueRows.map((venue) => venue.name),
    };
    const actual = {
      counts,
      rejectedNames: rejectedRows.map((venue: { name: string }) => venue.name),
      allNames: allRows.map((venue: { name: string }) => venue.name),
    };
    expect({ actual, json: JSON.stringify(actual) }).toEqual({
      actual: expected,
      json: JSON.stringify(expected),
    });

    await renderAdminScreen();
    const filterNames = Array.from(container.querySelectorAll('[data-testid^="admin-sports-review-filter-"]'))
      .map((button) => button.textContent);
    expect({ filterNames, json: JSON.stringify(filterNames) }).toEqual({
      filterNames: ['Submitted (1)', 'All (6)', 'Verified (1)', 'Rejected (2)', 'Suspended (1)', 'Draft (1)'],
      json: JSON.stringify(['Submitted (1)', 'All (6)', 'Verified (1)', 'Rejected (2)', 'Suspended (1)', 'Draft (1)']),
    });
    expect({ visible: container.textContent?.includes('A Submitted Court'), hidden: container.textContent?.includes('B Verified Court') })
      .toEqual({ visible: true, hidden: false });

    await testAct(async () => {
      clickFilter('all');
      await flushMicrotasks();
    });
    const renderedNames = Array.from(container.querySelectorAll('article'))
      .map((card) => card.textContent?.match(/[A-F] (?:Submitted|Verified|Rejected|Suspended|Draft) Court/)?.[0]);
    expect({ renderedNames, json: JSON.stringify(renderedNames) }).toEqual({
      renderedNames: venueRows.map((venue) => venue.name),
      json: JSON.stringify(venueRows.map((venue) => venue.name)),
    });
  });
});

describe('SP-RESTORE-NOT-VERIFY', () => {
  it('offers only different-state review actions across every current-state filter', async () => {
    await renderAdminScreen();
    const actual: Record<string, string[]> = {};
    for (const status of ['submitted', 'verified', 'rejected', 'suspended', 'draft']) {
      await testAct(async () => {
        clickFilter(status);
        await flushMicrotasks();
      });
      const card = container.querySelector('article');
      actual[status] = Array.from(card?.querySelectorAll('button') ?? []).map((button) => button.textContent ?? '');
    }
    const expected = {
      submitted: ['Verify venue', 'Reject', 'Suspend'],
      verified: ['Reject', 'Suspend'],
      rejected: ['Restore / Re-verify', 'Suspend'],
      suspended: ['Restore / Re-verify', 'Reject'],
      draft: [],
    };
    expect({ actual, json: JSON.stringify(actual) }).toEqual({
      actual: expected,
      json: JSON.stringify(expected),
    });
  });
});

describe('SP-ADMIN-FAMILY-OFF', () => {
  it('uses the corrected all-state composition when the admin family selector is off', async () => {
    mockFlags.oorva_admin_ops_ux = false;
    await renderAdminScreen();

    const text = container.textContent ?? '';
    const expectedVisible = venueRows.every((venue) => text.includes(venue.name));
    const activitiesAfterReviews = text.indexOf('Sports activities') > text.indexOf('F Draft Court');
    const filterCount = container.querySelectorAll('[data-testid^="admin-sports-review-filter-"]').length;
    const queueHeading = text.includes('Venue review queue');
    expect({
      heading: text.includes('Venue review'),
      queueHeading,
      expectedVisible,
      activitiesAfterReviews,
      filterCount,
      json: JSON.stringify({ heading: text.includes('Venue review'), queueHeading, expectedVisible, activitiesAfterReviews, filterCount }),
    }).toEqual({
      heading: true,
      queueHeading: false,
      expectedVisible: true,
      activitiesAfterReviews: true,
      filterCount: 0,
      json: JSON.stringify({ heading: true, queueHeading: false, expectedVisible: true, activitiesAfterReviews: true, filterCount: 0 }),
    });
  });
});

describe('SP-ADMIN-PARENT-OFF', () => {
  it('fails closed when the brand parent is off even if the admin leaf is on', async () => {
    mockFlags.oorva_brand = false;
    mockFlags.oorva_admin_ops_ux = true;
    await renderAdminScreen();

    const text = container.textContent ?? '';
    const actual = {
      queueHeading: text.includes('Venue review queue'),
      allVenueRowsVisible: venueRows.every((venue) => text.includes(venue.name)),
      filterCount: container.querySelectorAll('[data-testid^="admin-sports-review-filter-"]').length,
    };
    const expected = { queueHeading: false, allVenueRowsVisible: true, filterCount: 0 };
    expect({ actual, json: JSON.stringify(actual) }).toEqual({
      actual: expected,
      json: JSON.stringify(expected),
    });
  });
});

describe('SP-SPORTS-PARENT-OFF', () => {
  it('keeps the truthful sports-off notice and does not issue admin reads when sports is disabled', async () => {
    mockFlags.sports = false;
    await renderAdminScreen();

    const actual = {
      notice: container.textContent?.includes('Enable Sports & venues from Admin → Features before managing venues or activities.'),
      venueVisible: venueRows.some((venue) => container.textContent?.includes(venue.name)),
      rpcCalls: mockRpc.mock.calls.map(([name]) => name),
    };
    const expected = { notice: true, venueVisible: false, rpcCalls: [] };
    expect({ actual, json: JSON.stringify(actual) }).toEqual({
      actual: expected,
      json: JSON.stringify(expected),
    });
  });
});
