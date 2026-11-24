import React from 'react';
import type { BusinessMember, BusinessMembership } from '../api';
import type { EnquirySummary, ShopProfile } from '../../shops/api';
import type { SupplierRfqSummary } from '../../rfq/api';
import type { ManagementVenue } from '../../sports/manage/types';

const mockRouter = { back: jest.fn(), push: jest.fn() };
const mockAuth = { userId: 'owner-current', loading: false };
const mockRouteParams: Record<string, string | string[]> = {};
const mockFlags: Record<string, boolean> = {
  merchant_staff: true,
  products: true,
  product_enquiries: true,
  product_rfq: true,
  sports: true,
  oorva_brand: true,
  oorva_business_staff_ux: true,
  oorva_merchant_shop_ux: false,
  oorva_rfq_ux: false,
};
const mockFocusCallbacks = new Set<() => void | (() => void)>();
const mockListBusinessMembers = jest.fn();
const mockAddBusinessMember = jest.fn();
const mockRemoveBusinessMember = jest.fn();
const mockListMyBusinessMemberships = jest.fn();
const mockListMyServices = jest.fn();
const mockListMyByoInvites = jest.fn();
const mockCreateByoInvite = jest.fn();
const mockCancelByoInvite = jest.fn();
const mockListShopProductEnquiries = jest.fn();
const mockListMySupplierRfqs = jest.fn();
const mockGetMyShop = jest.fn();
const mockListMyProducts = jest.fn();
const mockListProductCategories = jest.fn();
const mockToast = jest.fn();
const mockConfirm = jest.fn(async (_options: unknown) => false);
const mockShare = jest.fn(async (_value: unknown) => undefined);
const mockBrandContexts: string[] = [];
const mockSportsRpc = jest.fn();

const mockDom = new (require('jsdom').JSDOM)('<!doctype html><html><body></body></html>');
Object.defineProperty(globalThis, 'window', { configurable: true, value: mockDom.window });
Object.defineProperty(globalThis, 'document', { configurable: true, value: mockDom.window.document });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: mockDom.window.navigator });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function isFeatureOn(key: string): boolean {
  const parent = key === 'oorva_business_staff_ux' || key === 'oorva_merchant_shop_ux' || key === 'oorva_rfq_ux'
    ? 'oorva_brand'
    : null;
  return mockFlags[key] === true && (!parent || mockFlags[parent] === true);
}

jest.doMock('expo-router', () => {
  const ReactModule = require('react') as typeof React;
  return {
    router: mockRouter,
    useLocalSearchParams: () => mockRouteParams,
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
  Share: { share: (value: unknown) => mockShare(value) },
  View: 'div',
}));
jest.doMock('expo-image', () => ({ Image: 'img' }));
jest.doMock('@expo/vector-icons', () => ({ Ionicons: 'span' }));
jest.doMock('../../../components/ui', () => {
  const ReactModule = require('react') as typeof React;
  return {
    Button: ({ title, onPress, disabled, loading, variant, size }: {
      title: string;
      onPress?: () => void;
      disabled?: boolean;
      loading?: boolean;
      variant?: string;
      size?: string;
    }) => ReactModule.createElement('button', {
      type: 'button',
      'aria-label': title,
      'data-variant': variant,
      'data-size': size,
      disabled: !!disabled || !!loading,
      onClick: onPress,
    }, title),
    Card: ({ children }: { children: React.ReactNode }) => ReactModule.createElement('section', null, children),
    EmptyState: ({ title, message }: { title: string; message?: string }) =>
      ReactModule.createElement('section', { 'data-testid': 'empty' }, title, message),
    ErrorState: ({ title, message, onRetry }: { title?: string; message?: string | null; onRetry?: () => void }) =>
      ReactModule.createElement('section', { 'data-testid': 'error' }, title, message,
        onRetry ? ReactModule.createElement('button', { type: 'button', 'aria-label': 'Retry', onClick: onRetry }, 'Retry') : null),
    Header: ({ title, subtitle }: { title: string; subtitle?: string }) =>
      ReactModule.createElement('header', null, title, subtitle),
    InlineAlert: ({ title, message, actionLabel, onAction }: {
      title?: string;
      message?: string | null;
      actionLabel?: string;
      onAction?: () => void;
    }) => message ? ReactModule.createElement('div', { role: 'alert' }, title, message,
      actionLabel && onAction ? ReactModule.createElement('button', { type: 'button', 'aria-label': actionLabel, onClick: onAction }, actionLabel) : null) : null,
    Input: ({ label, value, onChangeText }: {
      label: string;
      value: string;
      onChangeText: (value: string) => void;
    }) => ReactModule.createElement('label', null, label, ReactModule.createElement('input', {
      'aria-label': label,
      value,
      onInput: (event: { currentTarget: { value: string } }) => onChangeText(event.currentTarget.value),
    })),
    ListItem: ({ title, subtitle, onPress }: { title: string; subtitle?: string; onPress?: () => void }) =>
      ReactModule.createElement('button', { type: 'button', 'aria-label': `List item ${title}`, onClick: onPress }, title, subtitle),
    Screen: ({ children, header }: { children: React.ReactNode; header?: React.ReactNode }) =>
      ReactModule.createElement('main', null, header, children),
    Section: ({ children, title }: { children: React.ReactNode; title: string }) =>
      ReactModule.createElement('section', null, ReactModule.createElement('h2', null, title), children),
    Skeleton: () => ReactModule.createElement('div', { 'data-testid': 'skeleton' }, 'Loading'),
    Text: ({ children, testID }: { children: React.ReactNode; testID?: string }) =>
      ReactModule.createElement('span', { 'data-testid': testID }, children),
    TextArea: ({ label, value, onChangeText }: {
      label: string;
      value: string;
      onChangeText: (value: string) => void;
    }) => ReactModule.createElement('label', null, label, ReactModule.createElement('textarea', {
      'aria-label': label,
      value,
      onInput: (event: { currentTarget: { value: string } }) => onChangeText(event.currentTarget.value),
    })),
    useConfirm: () => mockConfirm,
    useToast: () => mockToast,
  };
});
jest.doMock('../../../lib/auth', () => ({ useAuth: () => mockAuth }));
jest.doMock('../../../lib/featureFlags', () => ({
  useAppFeatureFlags: () => ({ isOn: isFeatureOn }),
}));
jest.doMock('../../../lib/api', () => ({
  listMyServices: (...args: unknown[]) => mockListMyServices(...args),
}));
jest.doMock('../../../lib/providerBusiness', () => ({
  cancelByoInvite: (...args: unknown[]) => mockCancelByoInvite(...args),
  createByoInvite: (...args: unknown[]) => mockCreateByoInvite(...args),
  listMyByoInvites: (...args: unknown[]) => mockListMyByoInvites(...args),
}));
jest.doMock('../../merchantStaff/api', () => ({
  addBusinessMember: (...args: unknown[]) => mockAddBusinessMember(...args),
  listBusinessMembers: (...args: unknown[]) => mockListBusinessMembers(...args),
  listMyBusinessMemberships: (...args: unknown[]) => mockListMyBusinessMemberships(...args),
  removeBusinessMember: (...args: unknown[]) => mockRemoveBusinessMember(...args),
}));
jest.doMock('../../shops/api', () => ({
  deleteProduct: jest.fn(async () => undefined),
  getMyShop: (...args: unknown[]) => mockGetMyShop(...args),
  listMyProducts: (...args: unknown[]) => mockListMyProducts(...args),
  listProductCategories: (...args: unknown[]) => mockListProductCategories(...args),
  listShopProductEnquiries: (...args: unknown[]) => mockListShopProductEnquiries(...args),
  saveProduct: jest.fn(async () => undefined),
  saveShop: jest.fn(async () => 'shop-id'),
  signedProductImage: jest.fn(async () => null),
  submitShop: jest.fn(async () => undefined),
}));
jest.doMock('../../shops/components', () => ({
  IndicativePrice: 'span',
  ShopStatusLabel: 'span',
  useShopFeatureFlags: () => ({ products: isFeatureOn('products'), enquiries: isFeatureOn('product_enquiries') }),
}));
jest.doMock('../../shops/manage/ProductEditorSection', () => ({ __esModule: true, default: () => null }));
jest.doMock('../../shops/manage/ShopDetailsSection', () => ({ __esModule: true, default: () => null }));
jest.doMock('../../shops/manage/shopManageModel', () => ({
  shopManageActions: ({ shop, productsEnabled }: { shop: ShopProfile | null; productsEnabled: boolean }) => ({
    canEditProducts: shop?.business_role === 'owner' && productsEnabled,
    canSaveDetails: shop?.business_role === 'owner' && productsEnabled,
    canSubmit: false,
  }),
}));
jest.doMock('../../rfq/api', () => ({
  listMySupplierRfqs: (...args: unknown[]) => mockListMySupplierRfqs(...args),
  supplierRfqDetailRouteParams: (rfq: SupplierRfqSummary) => ({ id: rfq.rfq_id, shopId: rfq.shop_id }),
}));
jest.doMock('../../rfq/components', () => ({
  useRfqFeatureFlags: () => ({ rfq: isFeatureOn('product_rfq') }),
}));
jest.doMock('../../rfq/rfqStateModel', () => ({
  nearestFutureRfqDeadlineMs: () => null,
  rfqViewState: () => ({ rfqLabel: 'Open', quoteLabel: 'No quote' }),
}));
jest.doMock('../../../branding/useBrandIdentity', () => ({
  useBrandIdentity: (context: string) => {
    mockBrandContexts.push(context);
    return { displayName: isFeatureOn('oorva_brand') ? 'Oorva' : 'Nearo', tagline: null };
  },
}));
jest.doMock('../../../lib/locationContext', () => ({
  useSelectedLocation: () => ({ location: { line1: '', area: 'Area', city: 'City', lat: 1, lng: 1 } }),
  resolvePlace: jest.fn(),
  searchPlaces: jest.fn(async () => []),
}));
jest.doMock('../../../lib/places', () => ({ newPlacesSession: () => ({}) }));
jest.doMock('../../../lib/onboarding/validation', () => ({ parseRupees: jest.fn(() => 0) }));
jest.doMock('../../providerOnboarding/media', () => ({ pickPhoto: jest.fn() }));
jest.doMock('../../../lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => mockSportsRpc(...args) } }));
jest.doMock('../../sports/model', () => ({
  getSportsVenueSettingsVisibility: jest.fn(() => ({})),
  isSportsCapacityValid: jest.fn(() => true),
  resolveSportsVenuePaymentModes: jest.fn(() => ['pay_at_venue']),
}));
jest.doMock('../../sports/useSportsReadRefresh', () => ({
  useSportsReadRefresh: (load: (guard: { isCurrent: () => boolean }) => Promise<void>) => ({
    refresh: () => load({ isCurrent: () => true }),
    refreshing: false,
  }),
}));

jest.doMock('../../../theme', () => ({
  useTheme: () => ({
    spacing: { xs: 4, sm: 8, md: 12, lg: 20, xl: 28 },
    radii: { md: 8, lg: 12 },
    colors: {
      border: '#ddd',
      dangerText: '#a00',
      muted: '#777',
      primary: '#111',
      primarySoft: '#eee',
      primaryText: '#111',
      surface: '#fff',
      successText: '#080',
      text: '#111',
      textSecondary: '#444',
      surfaceAlt: '#eee',
    },
  }),
}));

const MerchantWorkModule = require('../../identityScreens/MerchantWorkScreen') as {
  default: React.ComponentType;
  getBusinessWorkKey: (membership: BusinessMembership) => string;
};
const MerchantStaffScreen = require('../../identityScreens/MerchantStaffScreen').default as React.ComponentType;
const ProviderBusinessToolsScreen = require('../../identityScreens/ProviderBusinessToolsScreen').default as React.ComponentType;
const MerchantEnquiriesScreen = require('../../marketplaceScreens/MerchantEnquiriesScreen').default as React.ComponentType;
const MerchantRfqsScreen = require('../../marketplaceScreens/MerchantRfqsScreen').default as React.ComponentType;
const MerchantShopScreen = require('../../marketplaceScreens/MerchantShopScreen').default as React.ComponentType;
const SportsStateModule = require('../../sports/manage/useSportsVenueManagementState') as {
  resolveInitialVenueSelection: (venues: readonly ManagementVenue[], initialVenueId: string) => {
    venueId: string;
    unavailable: boolean;
  };
  useSportsVenueManagementState: () => {
    load: () => Promise<boolean>;
    selectedId: string;
    error: string | null;
  };
};
const { createRoot } = require('react-dom/client') as { createRoot: (container: Element) => TestRoot };
const testAct = require('react').act as (callback: () => void | Promise<void>) => Promise<void>;

type TestRoot = { render: (element: React.ReactElement) => void; unmount: () => void };
let root: TestRoot | undefined;
let container: HTMLDivElement;
let mountedSportsState: ReturnType<typeof SportsStateModule.useSportsVenueManagementState> | undefined;

function SportsStateHarness() {
  mountedSportsState = SportsStateModule.useSportsVenueManagementState();
  return null;
}

const createdAt = '2030-04-05T06:07:08.000Z';
const expiresAt = '2030-04-12T06:07:08.000Z';
const invite = {
  invite_id: 'invite-open-1',
  provider_service_id: 'service-1',
  category_name: 'Repairs',
  customer_label: 'Client A',
  description: 'Kitchen tap repair',
  amount_paise: 250000,
  fee_paise: 7500,
  total_paise: 257500,
  scheduled_at: null,
  status: 'open' as const,
  booking_id: null,
  created_at: createdAt,
  expires_at: expiresAt,
};
const shopA: ShopProfile = {
  id: 'shop-a',
  owner_id: 'owner-a',
  business_role: 'manager',
  name: 'Shop A',
  description: '',
  address_line: '',
  city: 'City',
  area: 'Area',
  lat: null,
  lng: null,
  delivery_radius_km: 10,
  offers_delivery: false,
  offers_pickup: true,
  whatsapp_contact: false,
  gstin: null,
  status: 'verified',
  status_reason: null,
  category_slugs: [],
};
const shopB: ShopProfile = { ...shopA, id: 'shop-b', owner_id: 'owner-b', name: 'Shop B' };

const enquiries: EnquirySummary[] = [
  { id: 'enquiry-a', shop_id: 'shop-a', product_id: null, shop_name: 'Shop A', product_name: null, status: 'open', last_message_at: createdAt },
  { id: 'enquiry-b', shop_id: 'shop-b', product_id: null, shop_name: 'Shop B', product_name: 'Tool B', status: 'open', last_message_at: createdAt },
];
const rfqs: SupplierRfqSummary[] = [
  {
    shop_id: 'shop-a', shop_name: 'Shop A', rfq_id: 'rfq-a', title: 'Request A', category_name: 'Tools',
    city: 'City', area: 'Area', needs_delivery: false, needed_by: '2030-04-20', expires_at: expiresAt,
    created_at: createdAt, item_count: 1, quote_status: null, rfq_status: 'open', my_outcome: null, business_role: 'manager',
  },
  {
    shop_id: 'shop-b', shop_name: 'Shop B', rfq_id: 'rfq-b', title: 'Request B', category_name: 'Tools',
    city: 'City', area: 'Area', needs_delivery: false, needed_by: '2030-04-20', expires_at: expiresAt,
    created_at: createdAt, item_count: 1, quote_status: null, rfq_status: 'open', my_outcome: null, business_role: 'manager',
  },
];

function managementVenue(id: string, ownerId: string): ManagementVenue {
  return {
    venue: {
      id,
      owner_id: ownerId,
      business_role: 'manager',
      name: 'Same venue name',
      description: '',
      address_line: '',
      city: 'City',
      area: 'Area',
      lat: 1,
      lng: 1,
      amenities: [],
      photos: [],
      status: 'verified',
      status_reason: '',
      payment_modes: ['pay_at_venue'],
    },
    resources: [],
    hours: [],
    price_rules: [],
    blocks: [],
  };
}

function assertActual(label: string, actual: Record<string, unknown>, predicate: (state: Record<string, unknown>) => boolean) {
  if (!predicate(actual)) throw new Error(`${label}: ${JSON.stringify(actual)}`);
}

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

async function unmount() {
  if (root) await testAct(() => root?.unmount());
  container?.remove();
  root = undefined;
}

async function press(label: string, occurrence = 0) {
  const buttons = [...container.querySelectorAll('button')].filter((item) => item.getAttribute('aria-label') === label);
  const button = buttons[occurrence];
  if (!button) throw new Error(`Missing button ${label}[${occurrence}]; DOM=${container.textContent}`);
  await testAct(async () => {
    button.click();
    await flush();
  });
}

async function change(label: string, value: string) {
  const control = container.querySelector(`[aria-label="${label}"]`) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!control) throw new Error(`Missing control ${label}; DOM=${container.textContent}`);
  await testAct(async () => {
    control.value = value;
    control.dispatchEvent(new window.Event('input', { bubbles: true }));
    await flush();
  });
}

function membership(
  businessType: BusinessMembership['business_type'],
  businessId: string,
  ownerId: string,
  businessName: string,
  role: BusinessMembership['role'] = 'manager',
): BusinessMembership {
  return { business_id: businessId, owner_id: ownerId, role, business_type: businessType, business_name: businessName };
}

const members: BusinessMember[] = [
  { member_id: 'member-active', full_name: 'Alex Active', role: 'staff', active: true, invited_at: createdAt },
  { member_id: 'member-inactive', full_name: 'Sam Inactive', role: 'manager', active: false, invited_at: createdAt },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockFocusCallbacks.clear();
  Object.keys(mockRouteParams).forEach((key) => delete mockRouteParams[key]);
  Object.assign(mockFlags, {
    merchant_staff: true,
    products: true,
    product_enquiries: true,
    product_rfq: true,
    sports: true,
    oorva_brand: true,
    oorva_business_staff_ux: true,
    oorva_merchant_shop_ux: false,
    oorva_rfq_ux: false,
  });
  mockListBusinessMembers.mockReset().mockResolvedValue(members);
  mockAddBusinessMember.mockReset().mockResolvedValue(undefined);
  mockRemoveBusinessMember.mockReset().mockResolvedValue(undefined);
  mockListMyBusinessMemberships.mockReset().mockResolvedValue([]);
  mockListMyServices.mockReset().mockResolvedValue([{ id: 'service-1', categories: { name: 'Repairs' } }]);
  mockListMyByoInvites.mockReset().mockResolvedValue([invite]);
  mockCreateByoInvite.mockReset().mockResolvedValue({
    invite_id: 'invite-created-1',
    token: 'server-token-must-not-be-rebuilt',
    share_url: 'quickserve://byo/server-returned-share-url',
    expires_at: expiresAt,
  });
  mockCancelByoInvite.mockReset().mockResolvedValue(undefined);
  mockListShopProductEnquiries.mockReset().mockResolvedValue(enquiries);
  mockListMySupplierRfqs.mockReset().mockResolvedValue(rfqs);
  mockGetMyShop.mockReset().mockImplementation(async (ownerId?: string) => ownerId === 'owner-b' ? shopB : shopA);
  mockListMyProducts.mockReset().mockResolvedValue([]);
  mockListProductCategories.mockReset().mockResolvedValue([]);
  mockConfirm.mockReset().mockResolvedValue(false);
  mockBrandContexts.length = 0;
  mockSportsRpc.mockReset().mockImplementation(async (name: string) => {
    if (name === 'get_my_business_sports_venues') return { data: [], error: null };
    if (name === 'list_sports_activities') return { data: [], error: null };
    if (name === 'get_my_business_sports_bookings') return { data: [], error: null };
    return { data: null, error: null };
  });
  mountedSportsState = undefined;
  mockRouter.push.mockReset();
  mockShare.mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  await unmount();
});

describe('O28-ID16 business workspace context and confirmations', () => {
  it('ID-BYO-SHARE-FIRST: promotes the returned invite share and shows server dates/status without reconstructing a token', async () => {
    await mount(ProviderBusinessToolsScreen);
    await change('Client name', 'Client B');
    await change('Agreed job', 'Kitchen tap repair');
    await change('Agreed amount', '2500');
    await press('Create secure invite');

    const actions = [...container.querySelectorAll('button')]
      .map((button) => button.getAttribute('aria-label'))
      .filter((label) => label === 'Share invite' || label === 'Create another');
    const actionButtons = [...container.querySelectorAll('button')].filter((button) =>
      button.getAttribute('aria-label') === 'Share invite' || button.getAttribute('aria-label') === 'Create another');
    const actual = {
      actions,
      shareVariant: actionButtons[0]?.getAttribute('data-variant') ?? 'primary',
      createAnotherVariant: actionButtons[1]?.getAttribute('data-variant'),
      hasServerExpiry: container.textContent?.includes(new Date(expiresAt).toLocaleString('en-IN')) ?? false,
      hasDatedStatus: container.textContent?.includes(new Date(createdAt).toLocaleString('en-IN')) ?? false,
      hasOpenStatus: container.textContent?.includes('OPEN') ?? false,
      hasToken: container.textContent?.includes('server-token-must-not-be-rebuilt') ?? false,
      feeAmount: container.textContent?.includes('₹75') ?? false,
      totalAmount: container.textContent?.includes('₹2,575') ?? false,
      createArgs: mockCreateByoInvite.mock.calls[0]?.[0],
    };
    assertActual('New invite offers Share before the subordinate create action and shows server-returned timing', actual, (state) =>
      JSON.stringify(state.actions) === JSON.stringify(['Share invite', 'Create another'])
      && state.shareVariant === 'primary'
      && state.createAnotherVariant === 'outline'
      && state.hasServerExpiry === true
      && state.hasDatedStatus === true
      && state.hasOpenStatus === true
      && state.hasToken === false
      && state.feeAmount === true
      && state.totalAmount === true
      && (state.createArgs as { amountPaise?: number })?.amountPaise === 250000);

    await press('Share invite');
    const shareActual = { shareCalls: mockShare.mock.calls, returnedUrl: 'quickserve://byo/server-returned-share-url' };
    assertActual('Share uses the server-returned URL', shareActual, (state) =>
      JSON.stringify(state.shareCalls).includes(String(state.returnedUrl)));
  });

  it('ID-BYO-CANCEL-CONFIRM: cancellation is confirmed before only the selected open invite is cancelled', async () => {
    mockConfirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await mount(ProviderBusinessToolsScreen);

    await press('Cancel invite');
    let actual: Record<string, unknown> = {
      cancelCalls: mockCancelByoInvite.mock.calls,
      confirmation: mockConfirm.mock.calls[0]?.[0],
    };
    assertActual('Declining the invite confirmation makes no cancellation call', actual, (state) =>
      Array.isArray(state.cancelCalls) && state.cancelCalls.length === 0
      && String((state.confirmation as { title?: string })?.title).includes('invite'));

    await press('Cancel invite');
    actual = { cancelCalls: mockCancelByoInvite.mock.calls, confirmationCount: mockConfirm.mock.calls.length };
    assertActual('Confirming cancellation sends only the selected open invite ID', actual, (state) =>
      JSON.stringify(state.cancelCalls) === JSON.stringify([['invite-open-1']])
      && state.confirmationCount === 2);
  });

  it('ID-STAFF-REMOVE-CONFIRM: removal dialog identifies the member and owner and cancellation leaves membership untouched', async () => {
    mockConfirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await mount(MerchantStaffScreen);

    let actual: Record<string, unknown> = {
      activeMember: container.textContent?.includes('Alex Active') ?? false,
      inactiveMember: container.textContent?.includes('Sam Inactive') ?? false,
      activeStatus: container.textContent?.includes('staff · Active · member-active') ?? false,
      inactiveStatus: container.textContent?.includes('manager · Inactive · member-inactive') ?? false,
      staffRights: container.textContent?.includes('Staff · view jobs, RFQs and chat') ?? false,
      managerRights: container.textContent?.includes('Manager · staff access plus quotes') ?? false,
      listedStaffRights: container.textContent?.includes('Rights: View jobs, RFQs and chat; cannot send quotes or change owner settings.') ?? false,
      listedManagerRights: container.textContent?.includes('Rights: View jobs, RFQs and chat; send quotes. Cannot manage members, payouts, prices or verification.') ?? false,
      ownerWideScope: container.textContent?.includes('all businesses owned') ?? false,
    };
    assertActual('Staff screen shows current/inactive members, exact role rights, and owner-wide scope', actual, (state) =>
      state.activeMember === true && state.inactiveMember === true
      && state.activeStatus === true && state.inactiveStatus === true
      && state.staffRights === true && state.managerRights === true
      && state.listedStaffRights === true && state.listedManagerRights === true
      && state.ownerWideScope === true);

    await press('Remove');
    const confirmation = mockConfirm.mock.calls[0]?.[0] as { message?: string } | undefined;
    actual = {
      removeCalls: mockRemoveBusinessMember.mock.calls,
      confirmationMessage: confirmation?.message ?? '',
    };
    assertActual('Declining access removal makes no RPC call and the prompt names the member and owner', actual, (state) =>
      Array.isArray(state.removeCalls) && state.removeCalls.length === 0
      && String(state.confirmationMessage).includes('Alex Active')
      && String(state.confirmationMessage).includes('member-active')
      && String(state.confirmationMessage).includes('owner-current'));

    await press('Remove');
    actual = { removeCalls: mockRemoveBusinessMember.mock.calls };
    assertActual('Confirmed removal is scoped to the current owner and selected member', actual, (state) =>
      JSON.stringify(state.removeCalls) === JSON.stringify([['owner-current', 'member-active']]));
  });

  it('ID-PROVIDER-CONTEXT: keeps provider business selection on providerId', async () => {
    mockListMyBusinessMemberships.mockResolvedValue([
      membership('provider', 'provider-b', 'provider-b', 'Provider B'),
    ]);
    await mount(MerchantWorkModule.default);
    await press('Open assigned jobs');
    const actual = { route: mockRouter.push.mock.calls[0]?.[0] };
    assertActual('Provider work retains the established providerId route parameter', actual, (state) =>
      JSON.stringify(state.route) === JSON.stringify({
        pathname: '/dashboard',
        params: { providerId: 'provider-b' },
      }));
  });

  it('ID-SELECT-SHOP-B: carries shop B context from membership, filters authorized enquiry/RFQ rows, and returns to B', async () => {
    mockListMyBusinessMemberships.mockResolvedValue([
      membership('shop', 'shop-a', 'owner-a', 'Shop A'),
      membership('shop', 'shop-b', 'owner-b', 'Shop B'),
    ]);
    await mount(MerchantWorkModule.default);
    await press('Open shop enquiries', 1);
    const workRoute = mockRouter.push.mock.calls[0]?.[0];
    let actual: Record<string, unknown> = { workRoute };
    assertActual('Selecting Shop B carries returned owner/business IDs as context', actual, (state) =>
      JSON.stringify(state.workRoute) === JSON.stringify({
        pathname: '/merchant-enquiries',
        params: { ownerId: 'owner-b', shopId: 'shop-b' },
      }));
    await press('Open supplier RFQs', 1);
    actual = { workRoute: mockRouter.push.mock.calls[1]?.[0] };
    assertActual('RFQ selection carries the same returned owner/business context', actual, (state) =>
      JSON.stringify(state.workRoute) === JSON.stringify({
        pathname: '/merchant-rfqs',
        params: { ownerId: 'owner-b', shopId: 'shop-b' },
      }));

    await unmount();
    mockRouter.push.mockReset();
    mockRouteParams.ownerId = 'owner-b';
    mockRouteParams.shopId = 'shop-b';
    await mount(MerchantEnquiriesScreen);
    actual = {
      rows: container.textContent,
      listCalls: mockListShopProductEnquiries.mock.calls,
    };
    assertActual('Enquiries are filtered by actual authorized shop_id, not a broader owner list', actual, (state) =>
      String(state.rows).includes('Tool B')
      && !String(state.rows).includes('Shop A')
      && JSON.stringify(state.listCalls) === JSON.stringify([[]]));
    await press('Manage my shop');
    actual = { manageRoute: mockRouter.push.mock.calls[0]?.[0] };
    assertActual('Manage shop retains the selected shop and owner context', actual, (state) =>
      JSON.stringify(state.manageRoute) === JSON.stringify({
        pathname: '/merchant-shop',
        params: { ownerId: 'owner-b', shopId: 'shop-b' },
      }));

    await unmount();
    mockRouter.push.mockReset();
    mockFlags.oorva_business_staff_ux = false;
    await mount(MerchantRfqsScreen);
    actual = { rows: container.textContent, identityContexts: [...mockBrandContexts] };
    assertActual('RFQs use the same selected-shop filter and brand identity context independently of the staff leaf', actual, (state) =>
      String(state.rows).includes('Request B')
      && !String(state.rows).includes('Request A')
      && (state.identityContexts as string[]).includes('rfq'));
    await press('Manage my shop');
    actual = { manageRoute: mockRouter.push.mock.calls[0]?.[0] };
    assertActual('RFQ Manage shop action retains the selected shop and owner context', actual, (state) =>
      JSON.stringify(state.manageRoute) === JSON.stringify({
        pathname: '/merchant-shop',
        params: { ownerId: 'owner-b', shopId: 'shop-b' },
      }));
  });

  it('ID-SELECT-VENUE-B: selects the requested venue only from authorized venues and carries B through sports routing', async () => {
    const authorized = [managementVenue('venue-a', 'owner-b'), managementVenue('venue-b', 'owner-b')];
    mockListMyBusinessMemberships.mockResolvedValue([
      membership('sports', 'venue-b', 'owner-b', 'Same venue name'),
    ]);
    await mount(MerchantWorkModule.default);
    await press('Open sports bookings');
    const selected = SportsStateModule.resolveInitialVenueSelection(authorized, 'venue-b');
    const actual = {
      route: mockRouter.push.mock.calls[0]?.[0],
      selection: selected,
      distinctMembershipKeys: [
        MerchantWorkModule.getBusinessWorkKey(membership('sports', 'venue-a', 'owner-b', 'Same venue name')),
        MerchantWorkModule.getBusinessWorkKey(membership('sports', 'venue-b', 'owner-b', 'Same venue name')),
      ],
    };
    assertActual('Venue B remains distinct by ID and is carried into its authorized management context', actual, (state) =>
      JSON.stringify(state.route) === JSON.stringify({
        pathname: '/sports/manage',
        params: { ownerId: 'owner-b', venueId: 'venue-b' },
      })
      && (state.selection as { venueId: string }).venueId === 'venue-b'
      && JSON.stringify(state.distinctMembershipKeys) === JSON.stringify(['sports:venue-a', 'sports:venue-b']));

    await unmount();
    mockRouteParams.venueId = 'venue-b';
    mockSportsRpc.mockImplementation(async (name: string) => {
      if (name === 'get_my_business_sports_venues') return { data: authorized, error: null };
      if (name === 'list_sports_activities') return { data: [], error: null };
      if (name === 'get_my_business_sports_bookings') return { data: [], error: null };
      return { data: null, error: null };
    });
    await mount(SportsStateHarness);
    await testAct(async () => {
      await mountedSportsState?.load();
      await flush();
    });
    const hookActual = { selectedId: mountedSportsState?.selectedId, error: mountedSportsState?.error };
    assertActual('Sports state accepts venueId only after the authorized server list contains it', hookActual, (state) =>
      state.selectedId === 'venue-b' && state.error === null);
  });

  it('ID-SPOOFED-SELECTION: arbitrary shop and venue IDs cannot make unauthorized rows or venues selectable', async () => {
    mockRouteParams.ownerId = 'owner-b';
    mockRouteParams.shopId = 'spoofed-shop';
    await mount(MerchantEnquiriesScreen);
    let actual: Record<string, unknown> = {
      showsShopA: container.textContent?.includes('Shop A') ?? false,
      showsAuthorizedRows: container.textContent?.includes('Tool B') ?? false,
      empty: container.querySelector('[data-testid="empty"]')?.textContent ?? '',
      listCalls: mockListShopProductEnquiries.mock.calls,
    };
    assertActual('A route parameter only filters the already-authorized enquiry list', actual, (state) =>
      state.showsShopA === false
      && state.showsAuthorizedRows === false
      && String(state.empty).includes('selected shop')
      && JSON.stringify(state.listCalls) === JSON.stringify([[]]));

    const venue = managementVenue('venue-a', 'owner-a');
    const selection = SportsStateModule.resolveInitialVenueSelection([venue], 'spoofed-venue');
    actual = { selection };
    assertActual('An unavailable venue request is refused rather than silently defaulted', actual, (state) =>
      JSON.stringify(state.selection) === JSON.stringify({ venueId: '', unavailable: true }));

    await unmount();
    mockRouteParams.venueId = 'spoofed-venue';
    mockSportsRpc.mockImplementation(async (name: string) => {
      if (name === 'get_my_business_sports_venues') return { data: [venue], error: null };
      if (name === 'list_sports_activities') return { data: [], error: null };
      if (name === 'get_my_business_sports_bookings') return { data: [], error: null };
      return { data: null, error: null };
    });
    await mount(SportsStateHarness);
    await testAct(async () => {
      await mountedSportsState?.load();
      await flush();
    });
    actual = {
      selectedId: mountedSportsState?.selectedId,
      error: mountedSportsState?.error,
      rpcCalls: mockSportsRpc.mock.calls,
    };
    assertActual('Spoofed venue context remains unselected and is visibly refused', actual, (state) =>
      state.selectedId === ''
      && String(state.error).includes('not available in your authorized venue list')
      && !(state.rpcCalls as unknown[][]).some((call) => JSON.stringify(call).includes('spoofed-venue')));
  });

  it('ID-BUSINESS-FLAG-PARENTS: business presentation requires brand parent and leaf while legacy access remains available', async () => {
    mockListMyBusinessMemberships.mockResolvedValue([
      membership('shop', 'shop-a', 'owner-a', 'Shop A'),
    ]);
    mockFlags.oorva_brand = true;
    mockFlags.oorva_business_staff_ux = false;
    await mount(MerchantWorkModule.default);
    let actual: Record<string, unknown> = {
      effectiveLeaf: isFeatureOn('oorva_business_staff_ux'),
      legacySubtitle: container.textContent?.includes('Jobs and requests assigned to you') ?? false,
      actionsRetained: container.textContent?.includes('Open shop enquiries') ?? false,
      allBusinessesBrandLabel: container.textContent?.includes('All businesses') ?? false,
    };
    assertActual('Leaf OFF keeps the legacy composition and existing authorized work', actual, (state) =>
      state.effectiveLeaf === false
      && state.legacySubtitle === true
      && state.actionsRetained === true
      && state.allBusinessesBrandLabel === false);

    await unmount();
    mockFlags.oorva_brand = false;
    mockFlags.oorva_business_staff_ux = true;
    await mount(MerchantWorkModule.default);
    actual = {
      effectiveLeaf: isFeatureOn('oorva_business_staff_ux'),
      legacySubtitle: container.textContent?.includes('Jobs and requests assigned to you') ?? false,
      actionsRetained: container.textContent?.includes('Open shop enquiries') ?? false,
      allBusinessesBrandLabel: container.textContent?.includes('All businesses') ?? false,
    };
    assertActual('Parent OFF prevents the presentation leaf while existing authorized work remains accessible', actual, (state) =>
      state.effectiveLeaf === false
      && state.legacySubtitle === true
      && state.actionsRetained === true
      && state.allBusinessesBrandLabel === false);

    await unmount();
    mockFlags.oorva_brand = true;
    await mount(MerchantWorkModule.default);
    actual = {
      effectiveLeaf: isFeatureOn('oorva_business_staff_ux'),
      aggregateLabel: container.textContent?.includes('All businesses') ?? false,
      actionsRetained: container.textContent?.includes('Open shop enquiries') ?? false,
    };
    assertActual('The business presentation appears only when both brand parent and leaf are enabled', actual, (state) =>
      state.effectiveLeaf === true && state.aggregateLabel === true && state.actionsRetained === true);
  });

  it('ID-SHOP-OWNER-CONTEXT: MerchantShop calls the explicit owner-aware read and refuses a mismatched shop context', async () => {
    mockRouteParams.ownerId = 'owner-b';
    mockRouteParams.shopId = 'shop-b';
    mockGetMyShop.mockResolvedValueOnce(shopB);
    await mount(MerchantShopScreen);
    let actual: Record<string, unknown> = {
      calls: mockGetMyShop.mock.calls,
      readOnly: container.textContent?.includes('Read-only manager access') ?? false,
    };
    assertActual('Shop screen uses ID-T03 owner-aware read while preserving non-owner read-only behavior', actual, (state) =>
      JSON.stringify(state.calls) === JSON.stringify([['owner-b']]) && state.readOnly === true);

    await unmount();
    mockRouteParams.shopId = 'spoofed-shop';
    mockGetMyShop.mockResolvedValueOnce(shopB);
    await mount(MerchantShopScreen);
    actual = {
      calls: mockGetMyShop.mock.calls,
      showsShop: container.textContent?.includes('Shop B') ?? false,
      mismatchMessage: container.textContent?.includes('selected shop') ?? false,
      editEntry: container.textContent?.includes('Manage my local shop and catalogue') ?? false,
    };
    assertActual('A mismatched context is not silently replaced with another shop or an editable owner view', actual, (state) =>
      JSON.stringify((state.calls as unknown[][]).slice(-1)) === JSON.stringify([['owner-b']])
      && state.showsShop === false
      && state.mismatchMessage === true
      && state.editEntry === false);
  });
});
