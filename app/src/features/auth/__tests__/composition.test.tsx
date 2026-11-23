import type React from 'react';

const mockRuntime: { hookIndex: number; states: unknown[] } = { hookIndex: 0, states: [] };
const mockFeatureFlags = { oorva_brand: false, oorva_auth_ux: false };
const mockIdentityContexts: string[] = [];
const mockParams: Record<string, string | undefined> = {
  inviteToken: 'invite-123',
  returnTo: '/',
  phone: '+919876543210',
};
let mockUserId: string | null = null;
const mockSendOtp = jest.fn().mockResolvedValue(undefined);
const mockRouter = {
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
  push: jest.fn(),
  replace: jest.fn(),
};
const mockTheme = {
  colors: {
    bg: '#fff',
    border: '#ccc',
    borderStrong: '#aaa',
    heroFrom: '#123456',
    heroTo: '#345678',
    muted: '#666',
    onPrimary: '#fff',
    outline: '#888',
    primary: '#123456',
    primarySoft: '#eef',
    primaryText: '#123456',
    success: '#078',
    surface: '#fff',
    surfaceAlt: '#eee',
    textSecondary: '#444',
  },
  radii: { lg: 16, md: 12, xl: 24 },
  spacing: { huge: 48, lg: 24, md: 16, section: 24, sm: 8, xl: 32, xs: 4, xxl: 24 },
};

jest.mock('react', () => {
  const actual = jest.requireActual<typeof import('react')>('react');
  return {
    ...actual,
    useCallback: (callback: unknown) => {
      mockRuntime.hookIndex++;
      return callback;
    },
    useEffect: () => {
      mockRuntime.hookIndex++;
    },
    useMemo: (factory: () => unknown) => {
      mockRuntime.hookIndex++;
      return factory();
    },
    useReducer: (reducer: (state: unknown, action: unknown) => unknown, initial: unknown) => {
      const index = mockRuntime.hookIndex++;
      if (!(index in mockRuntime.states)) mockRuntime.states[index] = initial;
      return [
        mockRuntime.states[index],
        (action: unknown) => {
          mockRuntime.states[index] = reducer(mockRuntime.states[index], action);
        },
      ];
    },
    useRef: (initial: unknown) => {
      const index = mockRuntime.hookIndex++;
      if (!(index in mockRuntime.states)) mockRuntime.states[index] = { current: initial };
      return mockRuntime.states[index];
    },
    useState: (initial: unknown) => {
      const index = mockRuntime.hookIndex++;
      if (!(index in mockRuntime.states)) {
        mockRuntime.states[index] = typeof initial === 'function'
          ? (initial as () => unknown)()
          : initial;
      }
      return [
        mockRuntime.states[index],
        (next: unknown) => {
          mockRuntime.states[index] = typeof next === 'function'
            ? (next as (previous: unknown) => unknown)(mockRuntime.states[index])
            : next;
        },
      ];
    },
  };
});

jest.mock('react-native', () => ({
  Linking: { openSettings: jest.fn() },
  Platform: { OS: 'ios' },
  Pressable: 'Pressable',
  View: 'View',
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons', MaterialCommunityIcons: 'MaterialCommunityIcons' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('expo-router', () => ({
  router: mockRouter,
  useLocalSearchParams: () => mockParams,
}));
jest.mock('../../../components/ui', () => ({
  BottomSheet: 'BottomSheet',
  Button: 'Button',
  Card: 'Card',
  Chip: 'Chip',
  Header: 'Header',
  IconButton: 'IconButton',
  InlineAlert: 'InlineAlert',
  Input: 'Input',
  OTPInput: 'OTPInput',
  Screen: 'Screen',
  Section: 'Section',
  Skeleton: 'Skeleton',
  Text: 'Text',
  useConfirm: () => jest.fn().mockResolvedValue(false),
  useToast: () => jest.fn(),
}));
jest.mock('../../../branding/FeatureFlagsProvider', () => ({
  useFeature: (key: string) => key === 'oorva_auth_ux'
    && mockFeatureFlags.oorva_brand
    && mockFeatureFlags.oorva_auth_ux,
}));
jest.mock('../../../branding/useBrandIdentity', () => ({
  useBrandIdentity: (context: string) => {
    mockIdentityContexts.push(context);
    const displayName = mockFeatureFlags.oorva_brand ? 'Oorva' : 'QuickServe';
    return {
      compactDark: null,
      compactLight: null,
      displayName,
      logoDark: null,
      logoLight: null,
      source: mockFeatureFlags.oorva_brand ? 'bundled' : 'legacy',
      tagline: mockFeatureFlags.oorva_brand ? 'Services, thoughtfully connected' : null,
    };
  },
}));
jest.mock('../../../i18n', () => ({ useT: () => (key: string) => key }));
jest.mock('../../../theme', () => ({ useTheme: () => mockTheme }));
jest.mock('../../../lib/api', () => ({
  addAddress: jest.fn(),
  deleteAddress: jest.fn(),
  getCommissionTerms: jest.fn(),
  getMyProfile: jest.fn(),
  getMyProvider: jest.fn(),
  isDemoMode: false,
  listMyAddresses: jest.fn(),
  sendOtp: (...args: unknown[]) => mockSendOtp(...args),
  updateMyProfile: jest.fn(),
  verifyOtp: jest.fn(),
}));
jest.mock('../../../lib/auth', () => ({
  useAuth: () => ({
    loading: false,
    setActiveRole: jest.fn(),
    setChoosingRole: jest.fn(),
    userId: mockUserId,
  }),
}));
jest.mock('../../../lib/locationContext', () => ({
  locateWithGps: jest.fn(),
  placeSearchSupported: false,
  searchPlaces: jest.fn(),
  resolvePlace: jest.fn(),
  useSelectedLocation: () => ({
    coords: { lat: 17.385, lng: 78.4867 },
    location: { area: 'Madhapur', city: 'Hyderabad', lat: 17.385, line1: '12 Sample Street', lng: 78.4867, source: 'manual' },
    setLocation: jest.fn(),
  }),
}));
jest.mock('../../../lib/geographyApi', () => ({ isAreaPickerEnabled: jest.fn(), listAreas: jest.fn() }));
jest.mock('../../../lib/places', () => ({ newPlacesSession: () => ({}) }));
jest.mock('../../../lib/locationModel', () => ({
  DEFAULT_LOCATION: { area: 'Hyderabad', city: 'Hyderabad', lat: 17.385, line1: '', lng: 78.4867, source: 'manual' },
  confirmedLocationActor: (_loading: boolean, userId: string | null) => userId,
  formatSavedAddress: () => '12 Sample Street, Hyderabad',
  fromManagedArea: (area: unknown) => area,
  fromSavedAddress: (address: unknown) => address,
  initialLocationAddressState: { actorId: null, addresses: null, error: null },
  locationAddressReducer: (state: unknown) => state,
  runPrivateLocationRequest: jest.fn(),
  sameLocation: () => false,
}));
jest.mock('../../../lib/providerBusiness', () => ({
  claimByoInvite: jest.fn(),
  previewByoInvite: jest.fn(),
}));
jest.mock('../../../lib/byoInvitePresentation', () => ({
  byoInviteAction: (_presentation: unknown, _token: string, authenticated: boolean) => authenticated ? 'claim' : 'sign-in',
  commitByoInviteClaim: (state: unknown) => state,
  failByoInviteClaim: (state: unknown) => state,
  failByoInvitePreview: (state: unknown) => state,
  loadingByoInvite: (token: string, requestId: number) => ({
    requestId,
    status: 'available',
    token,
    preview: {
      amount_paise: 10000,
      category_name: 'Repair',
      customer_label: 'Client',
      description: 'Protected invite',
      fee_paise: 300,
      provider_name: 'Provider',
      scheduled_at: null,
      total_paise: 10300,
    },
  }),
  recordByoPaymentIssue: (state: unknown) => state,
  resolveByoInvitePreview: (state: unknown) => state,
  startByoPayment: (state: unknown) => state,
}));
jest.mock('../../../lib/payments', () => ({ usePayment: () => jest.fn() }));
jest.mock('../../../lib/money', () => ({ formatINR: (paise: number) => String(paise) }));
jest.mock('../../../lib/authGate', () => ({ safeReturnTo: (value: string | undefined) => !!value }));
jest.mock('../../../lib/authErrors', () => ({
  authErrorMessage: (error: Error) => error.message,
  formatOtpCountdown: (seconds: number) => String(seconds),
}));
jest.mock('../../../lib/haptics', () => ({ haptics: { error: jest.fn(), select: jest.fn(), success: jest.fn() } }));
jest.mock('../../../lib/phone', () => ({
  formatPhone: (phone: string) => phone,
  normalizeIndianPhone: (digits: string) => digits.length === 10 ? `+91${digits}` : null,
}));
jest.mock('../../../lib/roleSelection', () => ({ roleProfilePatch: () => null }));
jest.mock('../../../lib/returningUser', () => ({
  hasCompletedOnboarding: () => false,
  isSafeAuthReturnTo: (value: string | undefined) => !!value,
  resolveAuthDestination: () => '/',
  returningUserRole: () => 'customer',
}));

const ReactRuntime = require('react') as typeof import('react');
const LoginScreen = require('../platformScreens/AuthLoginScreen').default as () => React.ReactElement;
const RoleScreen = require('../platformScreens/AuthRoleScreen').default as () => React.ReactElement;
const VerifyScreen = require('../platformScreens/AuthVerifyScreen').default as () => React.ReactElement;
const ByoScreen = require('../platformScreens/ByoDetailScreen').default as (props: { token: string }) => React.ReactElement;
const LocationScreen = require('../platformScreens/LocationScreen').default as () => React.ReactElement;
const { AddressEditorSheet } = require('../../../components/AddressEditor') as typeof import('../../../components/AddressEditor');

function resetRuntime() {
  mockRuntime.hookIndex = 0;
  mockRuntime.states = [];
  mockIdentityContexts.length = 0;
  mockFeatureFlags.oorva_brand = false;
  mockFeatureFlags.oorva_auth_ux = false;
  mockUserId = null;
  mockParams.inviteToken = 'invite-123';
  mockParams.returnTo = '/';
  mockParams.phone = '+919876543210';
  mockSendOtp.mockClear().mockResolvedValue(undefined);
  mockRouter.back.mockClear();
  mockRouter.canGoBack.mockClear().mockReturnValue(true);
  mockRouter.push.mockClear();
  mockRouter.replace.mockClear();
}

function render<T>(screen: () => T): T {
  mockRuntime.hookIndex = 0;
  return screen();
}

function elements(node: unknown, type: unknown): Array<React.ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.flatMap((child) => elements(child, type));
  if (!ReactRuntime.isValidElement(node)) return [];
  const element = node as React.ReactElement<Record<string, unknown>>;
  return [
    ...(element.type === type ? [element] : []),
    ...elements(element.props.children, type),
  ];
}

function byTestId(tree: unknown, testID: string) {
  return elements(tree, 'View').find((element) => element.props.testID === testID);
}

describe('O13C flagged auth/location/protected-invite composition', () => {
  beforeEach(resetRuntime);

  it('uses the parent-gated leaf on all five hosts and keeps the legacy composition when either flag is off', () => {
    const hosts: Array<[string, () => React.ReactElement]> = [
      ['o13c-auth-ux', () => LoginScreen()],
      ['o13c-auth-ux', () => RoleScreen()],
      ['o13c-auth-ux', () => VerifyScreen()],
      ['o13c-protected-invite-composition', () => ByoScreen({ token: 'invite-123' })],
      ['o13c-auth-ux', () => LocationScreen()],
    ];

    for (const [testID, host] of hosts) {
      resetRuntime();
      mockFeatureFlags.oorva_brand = false;
      mockFeatureFlags.oorva_auth_ux = true;
      expect(byTestId(render(host), testID)).toBeUndefined();

      mockFeatureFlags.oorva_brand = true;
      mockFeatureFlags.oorva_auth_ux = false;
      expect(byTestId(render(host), testID)).toBeUndefined();

      mockFeatureFlags.oorva_auth_ux = true;
      expect(byTestId(render(host), testID)).toBeDefined();
    }

  });

  it('retains phone, role-name, OTP, invite-address, location-query and address drafts across flag refreshes', () => {
    mockFeatureFlags.oorva_brand = true;

    let tree = render(() => LoginScreen());
    (elements(tree, 'Input')[0]!.props.onChangeText as (value: string) => void)('9876543210');
    mockFeatureFlags.oorva_auth_ux = true;
    tree = render(() => LoginScreen());
    expect(elements(tree, 'Input')[0]!.props.value).toBe('98765 43210');

    resetRuntime();
    mockFeatureFlags.oorva_brand = true;
    tree = render(() => RoleScreen());
    (elements(tree, 'Input')[0]!.props.onChangeText as (value: string) => void)('Priya');
    mockFeatureFlags.oorva_auth_ux = true;
    tree = render(() => RoleScreen());
    expect(elements(tree, 'Input')[0]!.props.value).toBe('Priya');

    resetRuntime();
    mockFeatureFlags.oorva_brand = true;
    tree = render(() => VerifyScreen());
    (elements(tree, 'OTPInput')[0]!.props.onChange as (value: string) => void)('123');
    mockFeatureFlags.oorva_auth_ux = true;
    tree = render(() => VerifyScreen());
    expect(elements(tree, 'OTPInput')[0]!.props.value).toBe('123');

    resetRuntime();
    mockFeatureFlags.oorva_brand = true;
    mockUserId = 'customer-1';
    tree = render(() => ByoScreen({ token: 'invite-123' }));
    const inviteInputs = elements(tree, 'Input');
    (inviteInputs[0]!.props.onChangeText as (value: string) => void)('Apartment 7');
    (inviteInputs[1]!.props.onChangeText as (value: string) => void)('Hyderabad');
    mockFeatureFlags.oorva_auth_ux = true;
    tree = render(() => ByoScreen({ token: 'invite-123' }));
    expect(elements(tree, 'Input').map((input) => input.props.value)).toEqual(['Apartment 7', 'Hyderabad']);

    resetRuntime();
    mockFeatureFlags.oorva_brand = true;
    tree = render(() => LocationScreen());
    (elements(tree, 'Input')[0]!.props.onChangeText as (value: string) => void)('Madhapur');
    mockFeatureFlags.oorva_auth_ux = true;
    tree = render(() => LocationScreen());
    expect(elements(tree, 'Input')[0]!.props.value).toBe('Madhapur');

    resetRuntime();
    mockFeatureFlags.oorva_brand = true;
    const props = {
      onClose: jest.fn(),
      onSaved: jest.fn(),
      pin: { area: 'Madhapur', city: 'Hyderabad', lat: 17.385, line1: '', lng: 78.4867, source: 'manual' as const },
      visible: true,
    };
    tree = render(() => AddressEditorSheet(props));
    const addressInputs = elements(tree, 'Input');
    (addressInputs[0]!.props.onChangeText as (value: string) => void)('Flat 7');
    (addressInputs[1]!.props.onChangeText as (value: string) => void)('Hyderabad');
    mockFeatureFlags.oorva_auth_ux = true;
    tree = render(() => AddressEditorSheet({
      ...props,
      pin: { ...props.pin, line1: 'Refreshed pin line' },
    }));
    expect(elements(tree, 'Input').map((input) => input.props.value)).toEqual(['Flat 7', 'Hyderabad']);
  });

  it('keeps protected identity independent of the auth leaf and carries invite/return targets through sign-in', async () => {
    mockFeatureFlags.oorva_brand = true;
    mockFeatureFlags.oorva_auth_ux = false;
    const inviteTree = render(() => ByoScreen({ token: 'invite-123' }));
    expect(elements(inviteTree, 'Text').some((text) => text.props.children === 'OORVA PROTECTED BOOKING')).toBe(true);
    expect(mockIdentityContexts).toContain('protectedInvite');

    mockRuntime.hookIndex = 0;
    mockRuntime.states = [];
    const loginTree = render(() => LoginScreen());
    (elements(loginTree, 'Input')[0]!.props.onChangeText as (value: string) => void)('9876543210');
    const sendButton = elements(loginTree, 'Button').find((button) => button.props.title === 'login.sendOtp');
    await (sendButton?.props.onPress as (() => void) | undefined)?.();
    await Promise.resolve();
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/verify',
      params: { inviteToken: 'invite-123', phone: '+919876543210', returnTo: '/' },
    });

    mockRuntime.hookIndex = 0;
    mockRuntime.states = [];
    mockUserId = null;
    const protectedTree = render(() => ByoScreen({ token: 'invite-123' }));
    const signInButton = elements(protectedTree, 'Button').find((button) => button.props.title === 'Log in to accept this booking');
    (signInButton?.props.onPress as (() => void) | undefined)?.();
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/login', params: { inviteToken: 'invite-123' } });
  });

  it('keeps keyboard-ready screen actions and address editor composition accessible', () => {
    mockFeatureFlags.oorva_brand = true;
    mockFeatureFlags.oorva_auth_ux = true;

    for (const screen of [LoginScreen(), RoleScreen(), VerifyScreen(), ByoScreen({ token: 'invite-123' }), LocationScreen()]) {
      const shell = elements(screen, 'Screen')[0];
      expect(shell).toBeDefined();
      expect(shell?.props.children).toBeDefined();
    }

    mockRuntime.hookIndex = 0;
    mockRuntime.states = [];
    const editor = render(() => AddressEditorSheet({
      onClose: jest.fn(),
      onSaved: jest.fn(),
      pin: { area: 'Madhapur', city: 'Hyderabad', lat: 17.385, line1: '', lng: 78.4867, source: 'manual' },
      visible: true,
    }));
    expect(byTestId(editor, 'o13c-auth-ux')).toBeDefined();
    const save = elements(editor, 'Button').find((button) => button.props.title === 'Save address');
    expect(save?.props.fullWidth).toBe(true);
  });
});
