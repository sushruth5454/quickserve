import type React from 'react';

const mockRuntime = { hookIndex: 0, states: [] as unknown[], refs: [] as Array<{ current: unknown } | undefined> };
const mockRouter = { push: jest.fn(), replace: jest.fn() };
const mockUseFocusEffect = jest.fn();
const mockGetMyProfile = jest.fn();
const mockGetMyProvider = jest.fn();
const mockGetMyCoinBalance = jest.fn();
const mockGetCoinsConfig = jest.fn();
const mockGetOnboarding = jest.fn();
const mockAmIAdmin = jest.fn();
const mockListMyBusinessMemberships = jest.fn();
const mockSetActiveRole = jest.fn();
const mockToast = jest.fn();
const mockConfirm = jest.fn();
let mockFlags: Record<string, boolean> = {};

jest.mock('react', () => {
  const actual = jest.requireActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = mockRuntime.hookIndex++;
      if (!(index in mockRuntime.states)) mockRuntime.states[index] = initial;
      return [
        mockRuntime.states[index],
        (next: unknown) => {
          mockRuntime.states[index] = typeof next === 'function'
            ? (next as (mockCurrent: unknown) => unknown)(mockRuntime.states[index])
            : next;
        },
      ];
    },
    useRef: (initial: unknown) => {
      const index = mockRuntime.hookIndex++;
      if (!mockRuntime.refs[index]) mockRuntime.refs[index] = { current: initial };
      return mockRuntime.refs[index]!;
    },
    useCallback: (callback: unknown) => callback,
  };
});

jest.mock('expo-router', () => ({ router: mockRouter, useFocusEffect: mockUseFocusEffect }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: 'test' } } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native', () => ({
  Linking: { openSettings: jest.fn().mockResolvedValue(undefined) },
  Pressable: 'Pressable',
  View: 'View',
}));
jest.mock('../../lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('../../lib/api', () => ({
  getMyCoinBalance: mockGetMyCoinBalance,
  getMyProfile: mockGetMyProfile,
  getMyProvider: mockGetMyProvider,
  isDemoMode: false,
  signOut: jest.fn(),
  updateMyProfile: jest.fn(),
}));
jest.mock('../../lib/adminApi', () => ({ amIAdmin: mockAmIAdmin }));
jest.mock('../../lib/featureFlags', () => ({
  useAppFeatureFlags: () => ({ isOn: (key: string) => mockFlags[key] ?? false }),
}));
jest.mock('../../lib/coinsConfigApi', () => ({ getCoinsConfig: mockGetCoinsConfig }));
jest.mock('../../lib/onboarding', () => ({ onboardingApi: { getOnboarding: mockGetOnboarding } }));
jest.mock('../../features/merchantStaff/api', () => ({ listMyBusinessMemberships: mockListMyBusinessMemberships }));
jest.mock('../../i18n', () => ({
  useLanguage: () => ({ language: 'en', languagePickerEnabled: false, setLanguage: jest.fn() }),
  useT: () => (key: string) => key,
}));
jest.mock('../../theme', () => ({
  useTheme: () => ({
    spacing: { sm: 8, md: 12, lg: 16, section: 24 },
    radii: { lg: 12 },
    colors: { surfaceAlt: '#eee', subtle: '#777' },
  }),
}));
jest.mock('../ProviderMeSections', () => ({ ProviderMeSections: 'ProviderMeSections' }));
jest.mock('../ui', () => ({
  Avatar: 'Avatar',
  BottomSheet: 'BottomSheet',
  Button: 'Button',
  Card: 'Card',
  Divider: 'Divider',
  Header: 'Header',
  InlineAlert: 'InlineAlert',
  Input: 'Input',
  LIST_INSET: 16,
  ListItem: 'ListItem',
  Screen: 'Screen',
  Skeleton: 'Skeleton',
  Text: 'Text',
  useConfirm: () => mockConfirm,
  useToast: () => mockToast,
}));

const ReactRuntime = require('react') as typeof import('react');
const { AccountScreen } = require('../AccountScreen') as typeof import('../AccountScreen');
const { router, useFocusEffect } = require('expo-router') as typeof import('expo-router');
const { useAuth } = require('../../lib/auth') as typeof import('../../lib/auth');
const { getMyCoinBalance, getMyProfile, getMyProvider } = require('../../lib/api') as typeof import('../../lib/api');
const { getCoinsConfig } = require('../../lib/coinsConfigApi') as typeof import('../../lib/coinsConfigApi');
const { onboardingApi } = require('../../lib/onboarding') as typeof import('../../lib/onboarding');
const { amIAdmin } = require('../../lib/adminApi') as typeof import('../../lib/adminApi');
const { listMyBusinessMemberships } = require('../../features/merchantStaff/api') as typeof import('../../features/merchantStaff/api');
const mockUseAuth = useAuth as unknown as jest.Mock;
const mockGetProfile = getMyProfile as jest.MockedFunction<typeof import('../../lib/api').getMyProfile>;
const mockGetProvider = getMyProvider as jest.MockedFunction<typeof import('../../lib/api').getMyProvider>;
const mockGetCoinBalance = getMyCoinBalance as jest.MockedFunction<typeof import('../../lib/api').getMyCoinBalance>;
const mockGetCoinConfig = getCoinsConfig as jest.MockedFunction<typeof import('../../lib/coinsConfigApi').getCoinsConfig>;
const mockGetOwnerOnboarding = onboardingApi.getOnboarding as jest.MockedFunction<typeof onboardingApi.getOnboarding>;
const mockGetAdmin = amIAdmin as jest.MockedFunction<typeof import('../../lib/adminApi').amIAdmin>;
const mockListMemberships = listMyBusinessMemberships as jest.MockedFunction<typeof import('../../features/merchantStaff/api').listMyBusinessMemberships>;

const provider = {
  id: 'owner-1',
  kyc_status: 'verified',
  service_radius_km: 10,
  rating_avg: 4.8,
  rating_count: 2,
} as never;

const profile = { id: 'user-1', full_name: 'A User', avatar_url: null } as never;
const coinConfig = {
  coins_earning_enabled: true,
  coins_redemption_enabled: true,
  coin_paise: 100,
  expiry_months: 12,
  max_earning_per_order_paise: 500,
  max_earning_per_month_paise: 1000,
  max_redemption_percent: 20,
  min_redemption_paise: 100,
  max_redemption_paise: 5000,
  redemption_increment_paise: 100,
} as unknown as Awaited<ReturnType<typeof import('../../lib/coinsConfigApi').getCoinsConfig>>;

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

function renderedText(node: unknown): string[] {
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(renderedText);
  if (!ReactRuntime.isValidElement(node)) return [];
  const element = node as React.ReactElement<Record<string, unknown>>;
  if (typeof element.type === 'function') {
    return renderedText((element.type as (props: Record<string, unknown>) => unknown)(element.props));
  }
  const props = element.props;
  return [
    ...(['title', 'subtitle', 'value', 'message'] as const).flatMap((key) =>
      typeof props[key] === 'string' ? [props[key] as string] : [],
    ),
    ...renderedText(props.children),
  ];
}

function item(tree: unknown, title: string) {
  return findElements(tree, 'ListItem').find((element) => element.props.title === title);
}

function button(tree: unknown, title: string) {
  return findElements(tree, 'Button').find((element) => element.props.title === title);
}

function renderAccount(mode: 'customer' | 'provider') {
  mockRuntime.hookIndex = 0;
  return AccountScreen({ mode });
}

function runFocusedLoad() {
  const callback = mockUseFocusEffect.mock.calls[mockUseFocusEffect.mock.calls.length - 1]?.[0];
  if (typeof callback === 'function') return (callback as () => unknown)();
  return undefined;
}

async function drainMicrotasks() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

function ownerState(goLiveState: 'live' | 'action_needed'): Awaited<ReturnType<typeof import('../../lib/onboarding').onboardingApi.getOnboarding>> {
  return {
    provider,
    profile: { full_name: 'A User', avatar_url: null },
    payout: null,
    documents: [],
    availability: [],
    time_off: [],
    portfolio: [],
    checks: [],
    go_live: { state: goLiveState, reasons: [], paused: false },
    terms_version: '',
  } as Awaited<ReturnType<typeof import('../../lib/onboarding').onboardingApi.getOnboarding>>;
}

function press(element: React.ReactElement<Record<string, unknown>> | undefined) {
  const onPress = element?.props.onPress;
  if (typeof onPress === 'function') (onPress as () => void)();
}

beforeEach(() => {
  mockRuntime.hookIndex = 0;
  mockRuntime.states = [];
  mockRuntime.refs = [];
  mockUseFocusEffect.mockReset();
  mockRouter.push.mockReset();
  mockRouter.replace.mockReset();
  mockSetActiveRole.mockReset();
  mockToast.mockReset();
  mockConfirm.mockReset();
  mockFlags = { merchant_staff: true, sports: true, products: true };
  mockUseAuth.mockReturnValue({ session: { phone: '+15551234567' }, setActiveRole: mockSetActiveRole });
  mockGetProfile.mockReset().mockResolvedValue(profile);
  mockGetProvider.mockReset().mockResolvedValue(provider);
  mockGetCoinBalance.mockReset().mockResolvedValue(0);
  mockGetCoinConfig.mockReset().mockResolvedValue(coinConfig);
  mockGetOwnerOnboarding.mockReset().mockResolvedValue(ownerState('live'));
  mockGetAdmin.mockReset().mockResolvedValue(false);
  mockListMemberships.mockReset().mockResolvedValue([]);
});

describe('AccountScreen identity readiness and membership entries', () => {
  it('ID-ACCOUNT-CUSTOMER keeps own-provider onboarding and listing paths separate from memberships', async () => {
    mockGetProvider.mockResolvedValueOnce(null);
    const first = renderAccount('customer');
    runFocusedLoad();
    await drainMicrotasks();
    const tree = renderAccount('customer');

    expect(item(tree, 'account.switchToProvider.title')?.props.subtitle).toBe('account.switchToProvider.offerServices');
    expect(item(tree, 'Business work')).toBeUndefined();
    expect(item(tree, 'account.myVenues.title')).toBeDefined();
    expect(item(tree, 'account.myShop.title')).toBeDefined();
    expect(mockListMemberships).toHaveBeenCalledTimes(1);

    press(item(tree, 'account.switchToProvider.title'));
    expect(mockSetActiveRole).toHaveBeenCalledWith('provider');
    expect(mockRouter.replace).toHaveBeenCalledWith('/onboarding');
    expect(first).toBeDefined();
  });

  it('ID-ACCOUNT-OWNER uses canonical go-live readiness and routes profile edits to basics', async () => {
    mockGetOwnerOnboarding.mockResolvedValueOnce(ownerState('action_needed'));
    const first = renderAccount('provider');
    runFocusedLoad();
    await drainMicrotasks();
    const tree = renderAccount('provider');
    const avatar = findElements(tree, 'Avatar')[0];
    const profilePress = findElements(tree, 'Pressable').find((element) =>
      String(element.props.accessibilityLabel ?? '').includes('account.profile.accessibility'),
    );

    expect(avatar?.props.verified).toBe(false);
    expect(findElements(tree, 'ProviderMeSections')).toHaveLength(1);
    press(profilePress);
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/provider-profile/[section]',
      params: { section: 'basics', returnTo: 'hub' },
    });

    mockGetOwnerOnboarding.mockResolvedValueOnce(ownerState('live'));
    runFocusedLoad();
    await drainMicrotasks();
    expect(findElements(renderAccount('provider'), 'Avatar')[0]?.props.verified).toBe(true);
    expect(first).toBeDefined();
  });

  it('ID-ACCOUNT-MEMBER shows Business work for real memberships without owner payout controls', async () => {
    mockGetProvider.mockResolvedValueOnce(null);
    mockListMemberships.mockResolvedValueOnce([
      { owner_id: 'owner-a', business_id: 'shop-a', role: 'staff', business_type: 'shop', business_name: 'North Shop' },
      { owner_id: 'owner-b', business_id: 'venue-b', role: 'manager', business_type: 'sports', business_name: 'North Shop' },
    ]);
    renderAccount('customer');
    runFocusedLoad();
    await drainMicrotasks();
    const tree = renderAccount('customer');

    expect(item(tree, 'Business work')?.props.subtitle).toContain('2');
    press(item(tree, 'Business work'));
    expect(mockRouter.push).toHaveBeenCalledWith('/merchant-work');
    expect(findElements(tree, 'ProviderMeSections')).toHaveLength(0);
    expect(renderedText(tree)).not.toContain('Payout account & KYC');
    expect(item(tree, 'account.myVenues.title')).toBeDefined();
    expect(item(tree, 'account.myShop.title')).toBeDefined();
  });

  it('ID-ACCOUNT-ADMIN distinguishes an admin read error from a negative result and retries', async () => {
    mockGetAdmin.mockRejectedValueOnce(new Error('Admin lookup unavailable')).mockResolvedValueOnce(true);
    renderAccount('customer');
    runFocusedLoad();
    await drainMicrotasks();
    const failed = renderAccount('customer');
    expect(renderedText(failed).join(' ')).toContain('Admin lookup unavailable');
    press(button(failed, 'Retry admin status'));
    await drainMicrotasks();

    const retried = renderAccount('customer');
    expect(item(retried, 'account.adminPortal.title')).toBeDefined();
  });

  it('ID-ACCOUNT-PROVIDER-READ-ERROR does not switch to onboarding until the own-provider read succeeds', async () => {
    mockGetProvider.mockRejectedValueOnce(new Error('Provider read unavailable')).mockResolvedValueOnce(null);
    renderAccount('customer');
    runFocusedLoad();
    await drainMicrotasks();
    const failed = renderAccount('customer');
    expect(renderedText(failed).join(' ')).toContain('Provider read unavailable');
    press(item(failed, 'account.switchToProvider.title'));
    expect(mockSetActiveRole).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();

    press(button(failed, 'Retry provider status'));
    await drainMicrotasks();
    press(item(renderAccount('customer'), 'account.switchToProvider.title'));
    expect(mockSetActiveRole).toHaveBeenCalledWith('provider');
    expect(mockRouter.replace).toHaveBeenCalledWith('/onboarding');
  });

  it('ID-ACCOUNT-WALLET-OFF keeps Seva Coins history visible when both reward capabilities are off', async () => {
    mockGetCoinBalance.mockResolvedValueOnce(1250);
    mockGetCoinConfig.mockResolvedValueOnce({ ...coinConfig, coins_earning_enabled: false, coins_redemption_enabled: false });
    renderAccount('customer');
    runFocusedLoad();
    await drainMicrotasks();
    const row = item(renderAccount('customer'), 'account.coins.title');

    expect(row?.props.subtitle).toContain('paused');
    expect(row?.props.value).not.toBe('₹0.00');
    press(row);
    expect(mockRouter.push).toHaveBeenCalledWith('/coins');
  });

  it('ID-ACCOUNT-COIN-READ-ERROR shows unavailable instead of zero and retries the balance', async () => {
    mockGetCoinBalance.mockRejectedValueOnce(new Error('Balance read unavailable')).mockResolvedValueOnce(900);
    renderAccount('customer');
    runFocusedLoad();
    await drainMicrotasks();
    const failed = renderAccount('customer');
    expect(item(failed, 'account.coins.title')?.props.value).toBe('Unavailable');
    expect(item(failed, 'account.coins.title')?.props.value).not.toBe('₹0.00');
    press(button(failed, 'Retry coin details'));
    await drainMicrotasks();
    expect(item(renderAccount('customer'), 'account.coins.title')?.props.value).not.toBe('Unavailable');
  });

  it('ID-ACCOUNT-MERCHANT-STAFF-OFF does not read or expose member work', async () => {
    mockFlags.merchant_staff = false;
    renderAccount('customer');
    runFocusedLoad();
    await drainMicrotasks();

    expect(mockListMemberships).not.toHaveBeenCalled();
    expect(item(renderAccount('customer'), 'Business work')).toBeUndefined();
  });
});
