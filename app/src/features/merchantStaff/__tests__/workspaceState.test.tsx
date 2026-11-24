import React from 'react';
import type { BusinessMembership } from '../api';

const mockRouter = { back: jest.fn(), push: jest.fn() };
const mockAuth = { userId: 'owner-1', loading: false };
const mockFlags: Record<string, boolean> = {
  merchant_staff: true,
  products: true,
  product_enquiries: true,
  product_rfq: true,
  sports: true,
};
const mockListBusinessMembers = jest.fn();
const mockAddBusinessMember = jest.fn();
const mockRemoveBusinessMember = jest.fn();
const mockListMyBusinessMemberships = jest.fn();
const mockListMyServices = jest.fn();
const mockListMyByoInvites = jest.fn();
const mockCreateByoInvite = jest.fn();
const mockCancelByoInvite = jest.fn();
const mockToast = jest.fn();
const mockFocusCallbacks = new Set<() => void | (() => void)>();

const mockDom = new (require('jsdom').JSDOM)('<!doctype html><html><body></body></html>');
Object.defineProperty(globalThis, 'window', { configurable: true, value: mockDom.window });
Object.defineProperty(globalThis, 'document', { configurable: true, value: mockDom.window.document });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: mockDom.window.navigator });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.doMock('expo-router', () => {
  const ReactModule = require('react') as typeof React;
  return {
    router: mockRouter,
    useFocusEffect(callback: () => void | (() => void)) {
      ReactModule.useEffect(() => {
        mockFocusCallbacks.add(callback);
        const cleanup = callback();
        return () => {
          mockFocusCallbacks.delete(callback);
          if (typeof cleanup === 'function') cleanup();
        };
      }, [callback]);
    },
  };
});
jest.doMock('react-native', () => ({
  Pressable: 'button',
  Share: { share: jest.fn(async () => undefined) },
  View: 'div',
}));
jest.doMock('@expo/vector-icons', () => ({ Ionicons: 'span' }));
jest.doMock('../../../components/ui', () => {
  const ReactModule = require('react') as typeof React;
  return {
    Button: ({ title, onPress, disabled, loading }: { title: string; onPress?: () => void; disabled?: boolean; loading?: boolean }) =>
      ReactModule.createElement('button', { type: 'button', 'aria-label': title, disabled: !!disabled || !!loading, onClick: onPress }, title),
    Card: ({ children }: { children: React.ReactNode }) => ReactModule.createElement('section', null, children),
    EmptyState: ({ title, message }: { title: string; message?: string }) =>
      ReactModule.createElement('section', { 'data-testid': 'empty' }, title, message),
    ErrorState: ({ title, message, onRetry }: { title?: string; message?: string | null; onRetry?: () => void }) =>
      ReactModule.createElement('section', { 'data-testid': 'error' }, title, message,
        onRetry ? ReactModule.createElement('button', { type: 'button', 'aria-label': 'Retry', onClick: onRetry }, 'Retry') : null),
    Header: ({ title }: { title: string }) => ReactModule.createElement('header', null, title),
    InlineAlert: ({ title, message, actionLabel, onAction }: { title?: string; message?: string | null; actionLabel?: string; onAction?: () => void }) =>
      message ? ReactModule.createElement('div', { role: 'alert' }, title, message,
        actionLabel && onAction ? ReactModule.createElement('button', { type: 'button', 'aria-label': actionLabel, onClick: onAction }, actionLabel) : null) : null,
    Input: ({ label, value, onChangeText }: { label: string; value: string; onChangeText: (value: string) => void }) =>
      ReactModule.createElement('label', null, label, ReactModule.createElement('input', {
        'aria-label': label,
        value,
        onChange: (event: { currentTarget: { value: string } }) => onChangeText(event.currentTarget.value),
      })),
    Screen: ({ children, header }: { children: React.ReactNode; header?: React.ReactNode }) =>
      ReactModule.createElement('main', null, header, children),
    Section: ({ children, title }: { children: React.ReactNode; title: string }) =>
      ReactModule.createElement('section', null, ReactModule.createElement('h2', null, title), children),
    Skeleton: () => ReactModule.createElement('div', { 'data-testid': 'skeleton' }, 'Loading'),
    Text: ({ children }: { children: React.ReactNode }) => ReactModule.createElement('span', null, children),
    TextArea: ({ label, value, onChangeText }: { label: string; value: string; onChangeText: (value: string) => void }) =>
      ReactModule.createElement('label', null, label, ReactModule.createElement('textarea', {
        'aria-label': label,
        value,
        onChange: (event: { currentTarget: { value: string } }) => onChangeText(event.currentTarget.value),
      })),
    useToast: () => mockToast,
  };
});
jest.doMock('../../../lib/auth', () => ({ useAuth: () => mockAuth }));
jest.doMock('../../../lib/featureFlags', () => ({
  useAppFeatureFlags: () => ({ isOn: (key: string) => mockFlags[key] === true }),
}));
jest.doMock('../../../theme', () => ({
  useTheme: () => ({
    spacing: { xs: 4, sm: 8, md: 12, lg: 20, xl: 28 },
    radii: { md: 8, lg: 12 },
    colors: {
      border: '#ddd',
      muted: '#777',
      primary: '#111',
      primarySoft: '#eee',
      primaryText: '#111',
      surface: '#fff',
      successText: '#080',
      text: '#111',
    },
  }),
}));
jest.doMock('../api', () => ({
  addBusinessMember: (...args: unknown[]) => mockAddBusinessMember(...args),
  listBusinessMembers: (...args: unknown[]) => mockListBusinessMembers(...args),
  listMyBusinessMemberships: (...args: unknown[]) => mockListMyBusinessMemberships(...args),
  removeBusinessMember: (...args: unknown[]) => mockRemoveBusinessMember(...args),
}));
jest.doMock('../../../lib/api', () => ({
  listMyServices: (...args: unknown[]) => mockListMyServices(...args),
}));
jest.doMock('../../../lib/providerBusiness', () => ({
  cancelByoInvite: (...args: unknown[]) => mockCancelByoInvite(...args),
  createByoInvite: (...args: unknown[]) => mockCreateByoInvite(...args),
  listMyByoInvites: (...args: unknown[]) => mockListMyByoInvites(...args),
}));

const MerchantWorkModule = require('../../identityScreens/MerchantWorkScreen') as {
  default: React.ComponentType;
  getBusinessWorkKey: (membership: BusinessMembership) => string;
  getBusinessWorkPresentation: (
    membership: BusinessMembership,
    features: {
      merchantStaff: boolean;
      products: boolean;
      productEnquiries: boolean;
      productRfq: boolean;
      sports: boolean;
    },
  ) => { actions: string[]; message: string | null };
};
const MerchantStaffScreen = require('../../identityScreens/MerchantStaffScreen').default as React.ComponentType;
const ProviderBusinessToolsScreen = require('../../identityScreens/ProviderBusinessToolsScreen').default as React.ComponentType;
const { createRoot } = require('react-dom/client') as { createRoot: (container: Element) => TestRoot };
const testAct = require('react').act as (callback: () => void | Promise<void>) => Promise<void>;

type TestRoot = { render: (element: React.ReactElement) => void; unmount: () => void };
let root: TestRoot | undefined;
let container: HTMLDivElement;

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function mount(Component: React.ComponentType) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await testAct(async () => {
    root?.render(React.createElement(Component));
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

async function refocus() {
  const callbacks = [...mockFocusCallbacks];
  const callback = callbacks[callbacks.length - 1];
  if (!callback) throw new Error('No focused screen callback is registered');
  await testAct(async () => {
    callback();
    await flush();
  });
}

function assertActual(label: string, actual: Record<string, unknown>, predicate: (state: Record<string, unknown>) => boolean) {
  if (!predicate(actual)) throw new Error(`${label}: ${JSON.stringify(actual)}`);
}

function membership(
  businessType: BusinessMembership['business_type'],
  businessId: string,
  role: BusinessMembership['role'] = 'manager',
): BusinessMembership {
  return {
    business_id: businessId,
    owner_id: 'owner-1',
    role,
    business_type: businessType,
    business_name: 'Same business name',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFocusCallbacks.clear();
  mockAuth.userId = 'owner-1';
  mockAuth.loading = false;
  Object.assign(mockFlags, {
    merchant_staff: true,
    products: true,
    product_enquiries: true,
    product_rfq: true,
    sports: true,
  });
  mockListBusinessMembers.mockReset().mockResolvedValue([]);
  mockAddBusinessMember.mockReset().mockResolvedValue(undefined);
  mockRemoveBusinessMember.mockReset().mockResolvedValue(undefined);
  mockListMyBusinessMemberships.mockReset().mockResolvedValue([]);
  mockListMyServices.mockReset().mockResolvedValue([]);
  mockListMyByoInvites.mockReset().mockResolvedValue([]);
  mockCreateByoInvite.mockReset();
  mockCancelByoInvite.mockReset();
});

afterEach(async () => {
  if (root) await testAct(() => root?.unmount());
  container?.remove();
  root = undefined;
});

describe('merchant workspace read and capability state', () => {
  it('ID-WORK-ERROR-NOT-EMPTY: keeps a denied membership read in ErrorState until a successful empty retry', async () => {
    mockListMyBusinessMemberships
      .mockRejectedValueOnce(new Error('membership read denied'))
      .mockResolvedValueOnce([]);
    await mount(MerchantWorkModule.default);

    let actual: Record<string, unknown> = {
      error: container.querySelector('[data-testid="error"]')?.textContent ?? '',
      empty: container.querySelector('[data-testid="empty"]')?.textContent ?? '',
      retry: !!container.querySelector('button[aria-label="Retry"]'),
    };
    assertActual('Membership denial must not be reported as loaded-empty', actual, (state) =>
      String(state.error).includes('membership read denied') && !state.empty && state.retry === true);

    await press('Retry');
    actual = {
      error: container.querySelector('[data-testid="error"]')?.textContent ?? '',
      empty: container.querySelector('[data-testid="empty"]')?.textContent ?? '',
      retry: !!container.querySelector('button[aria-label="Retry"]'),
    };
    assertActual('Successful empty membership read clears the stale error', actual, (state) =>
      !state.error && String(state.empty).includes('No active business access') && state.retry === false);
  });

  it('ID-WORK-UNIQUE-KEYS: distinguishes same-owner same-name venues by stable business ID', () => {
    const first = membership('sports', 'venue-1');
    const second = membership('sports', 'venue-2');
    const actual = {
      firstKey: MerchantWorkModule.getBusinessWorkKey(first),
      secondKey: MerchantWorkModule.getBusinessWorkKey(second),
      sameOwner: first.owner_id === second.owner_id,
      sameName: first.business_name === second.business_name,
    };
    assertActual('Venue keys must include the business identity', actual, (state) =>
      state.sameOwner === true
      && state.sameName === true
      && state.firstKey === 'sports:venue-1'
      && state.secondKey === 'sports:venue-2'
      && String(state.firstKey) !== String(state.secondKey));
  });

  it('ID-WORK-PARENT-OFF: hides child actions when a domain parent is off but preserves owner work under its parent', () => {
    const managerShop = membership('shop', 'shop-1', 'manager');
    const parentOff = MerchantWorkModule.getBusinessWorkPresentation(managerShop, {
      merchantStaff: true,
      products: false,
      productEnquiries: true,
      productRfq: true,
      sports: false,
    });
    const staffSports = MerchantWorkModule.getBusinessWorkPresentation(membership('sports', 'venue-1', 'staff'), {
      merchantStaff: true,
      products: true,
      productEnquiries: true,
      productRfq: true,
      sports: false,
    });
    const ownerShop = MerchantWorkModule.getBusinessWorkPresentation(membership('shop', 'shop-2', 'owner'), {
      merchantStaff: false,
      products: true,
      productEnquiries: true,
      productRfq: true,
      sports: false,
    });
    const actual = { parentOff, staffSports, ownerShop };
    assertActual('Invalid child actions stay hidden with truthful explanations while owner capabilities use domain parents', actual, (state) => {
      const shop = state.parentOff as { actions: string[]; message: string | null };
      const sports = state.staffSports as { actions: string[]; message: string | null };
      const owner = state.ownerShop as { actions: string[]; message: string | null };
      return shop.actions.length === 0
        && !!shop.message?.includes('Products is turned off')
        && sports.actions.length === 0
        && !!sports.message?.includes('Sports is turned off')
        && owner.actions.includes('shop-enquiries')
        && owner.actions.includes('shop-rfqs');
    });
  });

  it('ID-STAFF-OWNER-DENY: hides owner actions and No staff after a denied member read', async () => {
    mockListBusinessMembers
      .mockRejectedValueOnce(new Error('owner membership read denied'))
      .mockResolvedValueOnce([]);
    await mount(MerchantStaffScreen);

    let actual: Record<string, unknown> = {
      error: container.querySelector('[data-testid="error"]')?.textContent ?? '',
      addForm: container.textContent?.includes('Add an existing user') ?? false,
      noStaff: container.textContent?.includes('No staff members yet.') ?? false,
    };
    assertActual('Denied owner membership read must not expose the add form or a successful-empty claim', actual, (state) =>
      String(state.error).includes('owner membership read denied') && state.addForm === false && state.noStaff === false);

    await press('Retry');
    actual = {
      error: container.querySelector('[data-testid="error"]')?.textContent ?? '',
      addForm: container.textContent?.includes('Add an existing user') ?? false,
      noStaff: container.textContent?.includes('No staff members yet.') ?? false,
    };
    assertActual('Only a successful empty owner read enables staff management', actual, (state) =>
      !state.error && state.addForm === true && state.noStaff === true);
  });

  it('ID-BYO-READ-ERROR: shows an invite read error and retries even with merchant_staff turned off', async () => {
    mockFlags.merchant_staff = false;
    mockListMyByoInvites
      .mockRejectedValueOnce(new Error('BYO invite read denied'))
      .mockResolvedValueOnce([]);
    await mount(ProviderBusinessToolsScreen);

    let actual: Record<string, unknown> = {
      error: container.querySelector('[data-testid="error"]')?.textContent ?? '',
      empty: container.querySelector('[data-testid="empty"]')?.textContent ?? '',
      retry: !!container.querySelector('button[aria-label="Retry"]'),
      inviteReads: mockListMyByoInvites.mock.calls.length,
      staffShortcut: container.textContent?.includes('Manage business staff') ?? false,
    };
    assertActual('BYO history is independent of merchant_staff and read failure is not empty', actual, (state) =>
      String(state.error).includes('BYO invite read denied')
      && !state.empty
      && state.retry === true
      && state.inviteReads === 1
      && state.staffShortcut === false);

    await press('Retry');
    actual = {
      error: container.querySelector('[data-testid="error"]')?.textContent ?? '',
      empty: container.querySelector('[data-testid="empty"]')?.textContent ?? '',
      inviteReads: mockListMyByoInvites.mock.calls.length,
    };
    assertActual('Successful invite reload clears the error and then reports loaded-empty', actual, (state) =>
      !state.error && String(state.empty).includes('No client invites yet') && state.inviteReads === 2);
  });

  it('ID-BYO-SERVICE-READ-ERROR: keeps failed services distinct from loaded-empty and loads BYO history independently', async () => {
    mockListMyServices
      .mockRejectedValueOnce(new Error('service read denied'))
      .mockResolvedValueOnce([]);
    await mount(ProviderBusinessToolsScreen);

    let actual: Record<string, unknown> = {
      error: container.querySelector('[data-testid="error"]')?.textContent ?? '',
      empty: container.querySelector('[data-testid="empty"]')?.textContent ?? '',
      inviteReads: mockListMyByoInvites.mock.calls.length,
      retry: !!container.querySelector('button[aria-label="Retry"]'),
    };
    assertActual('Service read denial remains retryable while BYO history loads independently', actual, (state) =>
      String(state.error).includes('service read denied')
      && String(state.empty).includes('No client invites yet')
      && state.inviteReads === 1
      && state.retry === true);

    await press('Retry');
    actual = {
      error: container.querySelector('[data-testid="error"]')?.textContent ?? '',
      noService: container.textContent?.includes('Add a live service in your provider profile first.') ?? false,
      inviteReads: mockListMyByoInvites.mock.calls.length,
    };
    assertActual('Successful service reload becomes loaded-empty and does not reload invite history', actual, (state) =>
      !state.error && state.noService === true && state.inviteReads === 1);
  });

  it('ID-WORK-STALE-REFRESH: retains prior memberships, disables delegated actions after denial, and clears on successful reload', async () => {
    mockListMyBusinessMemberships
      .mockResolvedValueOnce([membership('shop', 'shop-1')])
      .mockRejectedValueOnce(new Error('membership refresh denied'))
      .mockResolvedValueOnce([]);
    await mount(MerchantWorkModule.default);

    let actual: Record<string, unknown> = {
      membership: container.textContent?.includes('Same business name') ?? false,
      actionPresent: !![...container.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === 'Open shop enquiries'),
      retry: !!container.querySelector('button[aria-label="Retry"]'),
    };
    assertActual('Initial membership result exposes its current assigned action', actual, (state) =>
      state.membership === true && state.actionPresent === true && state.retry === false);

    await refocus();
    const action = [...container.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === 'Open shop enquiries');
    actual = {
      membership: container.textContent?.includes('Same business name') ?? false,
      error: container.querySelector('[role="alert"]')?.textContent ?? '',
      actionDisabled: action?.disabled ?? false,
      retry: !!container.querySelector('button[aria-label="Retry"]'),
      empty: container.querySelector('[data-testid="empty"]')?.textContent ?? '',
    };
    assertActual('Refresh denial preserves identity but removes actionable delegated work and avoids empty state', actual, (state) =>
      state.membership === true
      && String(state.error).includes('membership refresh denied')
      && state.actionDisabled === true
      && state.retry === true
      && !state.empty);

    await press('Retry');
    actual = {
      error: container.querySelector('[role="alert"]')?.textContent ?? '',
      empty: container.querySelector('[data-testid="empty"]')?.textContent ?? '',
      membership: container.textContent?.includes('Same business name') ?? false,
    };
    assertActual('Successful re-read removes the delegated entry and stale read error', actual, (state) =>
      !state.error && String(state.empty).includes('No active business access') && state.membership === false);
  });
});
