import React from 'react';

const mockRouter = { push: jest.fn(), replace: jest.fn() };
const mockGetProduct = jest.fn();
const mockGetMyShop = jest.fn();
const mockListProductCategories = jest.fn();
const mockSearchShops = jest.fn();
const mockListMyProductEnquiries = jest.fn();
const mockListMyProducts = jest.fn();
const mockStartProductEnquiry = jest.fn();
const mockShopFlags = { products: true, enquiries: true };
const mockInputChanges = new Map<string, (value: string) => void>();

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
      ReactModule.useEffect(() => callback(), [callback]);
    },
    useLocalSearchParams: () => ({ id: 'product-1' }),
  };
});

jest.doMock('react-native', () => ({ View: 'div' }));
jest.doMock('expo-image', () => ({ Image: 'img' }));
jest.doMock('../../../components/ui', () => {
  const ReactModule = require('react') as typeof React;
  return {
    Badge: ({ label }: { label: string }) => ReactModule.createElement('span', null, label),
    Button: ({ title, onPress, disabled, loading }: { title: string; onPress?: () => void; disabled?: boolean; loading?: boolean }) =>
      ReactModule.createElement('button', { type: 'button', 'aria-label': title, disabled: !!disabled || !!loading, onClick: onPress }, title),
    Card: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) =>
      ReactModule.createElement('section', { onClick: onPress }, children),
    Chip: ({ label }: { label: string }) => ReactModule.createElement('button', { type: 'button' }, label),
    EmptyState: ({ title, message }: { title: string; message?: string }) =>
      ReactModule.createElement('section', { 'data-testid': 'empty' }, title, message),
    ErrorState: ({ title, message, onRetry }: { title?: string; message?: string | null; onRetry?: () => void }) =>
      ReactModule.createElement('section', { 'data-testid': 'error' }, title, message,
        onRetry ? ReactModule.createElement('button', { type: 'button', 'aria-label': 'Retry', onClick: onRetry }, 'Retry') : null),
    Header: ({ title }: { title: string }) => ReactModule.createElement('header', null, title),
    InlineAlert: ({ message, actionLabel, onAction }: { message?: string | null; actionLabel?: string; onAction?: () => void }) =>
      message ? ReactModule.createElement('div', { role: 'alert' }, message,
        actionLabel && onAction ? ReactModule.createElement('button', { type: 'button', 'aria-label': actionLabel, onClick: onAction }, actionLabel) : null) : null,
    Input: ({ label, value, onChangeText }: { label: string; value: string; onChangeText: (value: string) => void }) => {
      mockInputChanges.set(label, onChangeText);
      return ReactModule.createElement('label', null, label, ReactModule.createElement('input', {
        'aria-label': label,
        value,
        onChange: (event: { currentTarget: { value: string } }) => onChangeText(event.currentTarget.value),
      }));
    },
    ListItem: ({ title, subtitle, onPress }: { title: string; subtitle?: string; onPress?: () => void }) =>
      ReactModule.createElement('button', { type: 'button', onClick: onPress }, title, subtitle),
    Screen: ({ children, header, footer }: { children: React.ReactNode; header?: React.ReactNode; footer?: React.ReactNode }) =>
      ReactModule.createElement('main', null, header, children, footer),
    Skeleton: () => ReactModule.createElement('div', { 'data-testid': 'skeleton' }, 'Loading'),
    Text: ({ children }: { children: React.ReactNode }) => ReactModule.createElement('span', null, children),
    TextArea: ({ label, value, onChangeText, editable = true }: { label: string; value: string; onChangeText: (value: string) => void; editable?: boolean }) =>
      ReactModule.createElement('label', null, label, ReactModule.createElement('textarea', {
        'aria-label': label,
        value,
        disabled: !editable,
        onChange: (event: { currentTarget: { value: string } }) => onChangeText(event.currentTarget.value),
      })),
    useToast: () => jest.fn(),
    useConfirm: () => jest.fn(async () => true),
  };
});

jest.doMock('../api', () => ({
  getProduct: (...args: unknown[]) => mockGetProduct(...args),
  signedProductImage: jest.fn(async () => 'https://image.invalid/product.jpg'),
  startProductEnquiry: (...args: unknown[]) => mockStartProductEnquiry(...args),
  getMyShop: (...args: unknown[]) => mockGetMyShop(...args),
  listProductCategories: (...args: unknown[]) => mockListProductCategories(...args),
  searchShops: (...args: unknown[]) => mockSearchShops(...args),
  listMyProductEnquiries: (...args: unknown[]) => mockListMyProductEnquiries(...args),
  listMyProducts: (...args: unknown[]) => mockListMyProducts(...args),
  saveShop: jest.fn(),
  submitShop: jest.fn(),
  saveProduct: jest.fn(),
  deleteProduct: jest.fn(),
}));
jest.doMock('../components', () => ({
  FeatureUnavailable: () => React.createElement('div', null, 'Feature unavailable'),
  IndicativePrice: () => React.createElement('span', null, 'Price'),
  ShopProductCard: () => React.createElement('div', null, 'Product'),
  ShopStatusLabel: () => React.createElement('span', null, 'Status'),
  useShopFeatureFlags: () => mockShopFlags,
}));
jest.doMock('../../providerOnboarding/media', () => ({ pickPhoto: jest.fn() }));
jest.doMock('../../shops/SpecFields', () => ({ SpecFields: () => React.createElement('div') }));
jest.doMock('../../shops/format', () => ({ UNIT_LABELS: { piece: 'piece' } }));
jest.doMock('../../shops/specs', () => ({ cleanSpecs: (value: unknown) => value }));
jest.doMock('../../../lib/locationContext', () => ({
  useSelectedLocation: () => ({ location: { lat: 1, lng: 2, city: 'Test City', area: 'Test Area' }, ready: true }),
  resolvePlace: jest.fn(),
  searchPlaces: jest.fn(async () => []),
}));
jest.doMock('../../../lib/places', () => ({ newPlacesSession: () => ({}) }));
jest.doMock('../../../lib/onboarding/validation', () => ({ parseRupees: jest.fn() }));
jest.doMock('../../../lib/featureFlags', () => ({ useAppFeatureFlags: () => ({ isOn: () => false }) }));
jest.doMock('../../rfq/components', () => ({ useRfqFeatureFlags: () => ({ rfq: true, enquiries: true }) }));
jest.doMock('../../../theme', () => ({
  useTheme: () => ({
    spacing: { xs: 4, sm: 8, md: 12, lg: 20 },
    radii: { sm: 4, md: 8, lg: 12 },
    colors: { surfaceAlt: '#eee', primary: '#111', surface: '#fff', border: '#ddd', primarySoft: '#eee', text: '#111', textSecondary: '#444', muted: '#777' },
  }),
}));

const ProductDetailScreen = require('../../marketplaceScreens/ProductDetailScreen').default as React.ComponentType;
const MerchantShopScreen = require('../../marketplaceScreens/MerchantShopScreen').default as React.ComponentType;
const ShopIndexScreen = require('../../marketplaceScreens/ShopIndexScreen').default as React.ComponentType;
const { createRoot } = require('react-dom/client') as { createRoot: (container: Element) => TestRoot };
const testAct = require('react').act as (callback: () => void | Promise<void>) => Promise<void>;

type TestRoot = { render: (element: React.ReactElement) => void; unmount: () => void };
let root: TestRoot | undefined;
let container: HTMLDivElement;

async function flush() {
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

function assertActual(label: string, actual: Record<string, unknown>, predicate: (state: Record<string, unknown>) => boolean) {
  if (!predicate(actual)) throw new Error(`${label}: ${JSON.stringify(actual)}`);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockInputChanges.clear();
  mockShopFlags.products = true;
  mockShopFlags.enquiries = true;
  mockGetProduct.mockReset();
  mockGetMyShop.mockReset();
  mockListProductCategories.mockReset();
  mockSearchShops.mockReset();
  mockListMyProductEnquiries.mockReset();
  mockListMyProducts.mockReset();
  mockStartProductEnquiry.mockReset();
  mockListProductCategories.mockResolvedValue([]);
  mockListMyProducts.mockResolvedValue([]);
});

afterEach(async () => {
  if (root) await testAct(() => root?.unmount());
  container?.remove();
  root = undefined;
});

describe('marketplace read states', () => {
  it('MK-READ-product-shop-error-empty renders a retry for failed product reads and only reports unavailable after a successful null', async () => {
    mockGetProduct.mockRejectedValueOnce(new Error('product read denied')).mockResolvedValueOnce(null);
    await mount(ProductDetailScreen);

    let actual: Record<string, unknown> = {
      error: container.querySelector('[data-testid="error"]')?.textContent ?? '',
      retry: !!container.querySelector('button[aria-label="Retry"]'),
      empty: container.querySelector('[data-testid="empty"]')?.textContent ?? '',
    };
    assertActual('Initial product read must remain an error, not empty', actual, (state) =>
      String(state.error).includes('product read denied') && state.retry === true && !String(state.empty).includes('Product unavailable'));

    await press('Retry');
    actual = {
      error: container.querySelector('[data-testid="error"]')?.textContent ?? '',
      retry: !!container.querySelector('button[aria-label="Retry"]'),
      empty: container.querySelector('[data-testid="empty"]')?.textContent ?? '',
    };
    assertActual('Successful null product read must become unavailable, not a read error', actual, (state) =>
      !state.error && String(state.empty).includes('Product unavailable'));
  });

  it('MK-READ-merchant-failed-setup requires a successful no-shop read before showing setup', async () => {
    mockGetMyShop.mockRejectedValueOnce(new Error('shop eligibility read failed')).mockResolvedValueOnce(null);
    await mount(MerchantShopScreen);

    let actual: Record<string, unknown> = {
      error: container.querySelector('[data-testid="error"]')?.textContent ?? '',
      retry: !!container.querySelector('button[aria-label="Retry"]'),
      setup: container.textContent?.includes('Set up your shop') ?? false,
      saveButtons: [...container.querySelectorAll('button')].filter((button) => button.getAttribute('aria-label') === 'Save shop details').length,
    };
    assertActual('Failed shop lookup must not expose setup or a save action', actual, (state) =>
      String(state.error).includes('shop eligibility read failed') && state.retry === true && state.setup === false && state.saveButtons === 0);

    await press('Retry');
    actual = {
      error: container.querySelector('[data-testid="error"]')?.textContent ?? '',
      setup: container.textContent?.includes('Set up your shop') ?? false,
      saveButtons: [...container.querySelectorAll('button')].filter((button) => button.getAttribute('aria-label') === 'Save shop details').length,
      getMyShopCalls: mockGetMyShop.mock.calls.length,
    };
    assertActual('A successful no-shop read should enable setup', actual, (state) =>
      !state.error && state.setup === true && state.saveButtons === 1 && state.getMyShopCalls === 2);
  });

  it('MK-READ-independent-shop-sections preserves successful catalogue and OFF history when another read fails', async () => {
    mockListProductCategories.mockRejectedValue(new Error('category query unavailable'));
    mockSearchShops.mockResolvedValue([{
      id: 'shop-1', name: 'Corner Supply', area: 'North', city: 'Test City', distance_km: 1.2,
      category_slugs: ['tiles'], offers_delivery: true, offers_pickup: true,
    }]);
    mockListMyProductEnquiries.mockResolvedValue([{
      id: 'enquiry-1', product_name: 'Floor tile', shop_name: 'Corner Supply', status: 'open', customer_unread: 0,
    }]);
    mockShopFlags.enquiries = false;
    await mount(ShopIndexScreen);

    const actual = {
      categoriesError: [...container.querySelectorAll('[data-testid="error"]')].map((node) => node.textContent),
      shops: container.textContent?.includes('Corner Supply') ?? false,
      enquiry: container.textContent?.includes('Floor tile') ?? false,
      readOnly: container.textContent?.includes('read-only while enquiries are turned off') ?? false,
      historyReadCalls: mockListMyProductEnquiries.mock.calls.length,
    };
    assertActual('One failed catalogue read must not erase successful shops or authorized OFF history', actual, (state) =>
      JSON.stringify(state.categoriesError).includes('category query unavailable')
      && state.shops === true && state.enquiry === true && state.readOnly === true && state.historyReadCalls === 1);
  });
});
