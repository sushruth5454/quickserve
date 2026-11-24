import React from 'react';

const mockRouter = { push: jest.fn(), replace: jest.fn() };
const mockGetProduct = jest.fn();
const mockGetShop = jest.fn();
const mockListShopProducts = jest.fn();
const mockListProductCategories = jest.fn();
const mockSearchProducts = jest.fn();
const mockStartProductEnquiry = jest.fn();
const mockRequireSignIn = jest.fn();
const mockSearchProductsWithAi = jest.fn();
const mockShopFlags = { products: true, enquiries: true };
const mockAiFlags = new Set(['ai_assistant', 'ai_product_search']);
const mockTextAreaChanges = new Map<string, (value: string) => void>();
let mockUserId: string | null = null;
let mockAuthLoading = false;

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

jest.doMock('react-native', () => ({ View: 'div', AppState: undefined }));
jest.doMock('expo-image', () => ({ Image: 'img' }));
jest.doMock('../../../lib/auth', () => ({
  useAuth: () => ({ userId: mockUserId, loading: mockAuthLoading }),
}));
jest.doMock('../../../lib/authGate', () => ({
  requireSignIn: (...args: unknown[]) => mockRequireSignIn(...args),
}));
jest.doMock('../../../lib/config', () => ({ isDemoMode: false }));
jest.doMock('../../../lib/featureFlags', () => ({
  useAppFeatureFlags: () => ({ isOn: (key: string) => mockAiFlags.has(key) }),
}));
jest.doMock('../../../lib/locationContext', () => ({
  useSelectedLocation: () => ({ location: { lat: 16.5, lng: 80.6, city: 'Vijayawada', area: 'Benz Circle' } }),
}));
jest.doMock('../../../lib/onboarding/validation', () => ({ parseRupees: () => 0 }));
jest.doMock('../../rfq/components', () => ({ useRfqFeatureFlags: () => ({ rfq: false }) }));
jest.doMock('../../ai/productSearch', () => ({
  searchProductsWithAi: (...args: unknown[]) => mockSearchProductsWithAi(...args),
}));
jest.doMock('../api', () => ({
  getProduct: (...args: unknown[]) => mockGetProduct(...args),
  getShop: (...args: unknown[]) => mockGetShop(...args),
  listShopProducts: (...args: unknown[]) => mockListShopProducts(...args),
  listProductCategories: (...args: unknown[]) => mockListProductCategories(...args),
  searchProducts: (...args: unknown[]) => mockSearchProducts(...args),
  signedProductImage: jest.fn(async () => null),
  startProductEnquiry: (...args: unknown[]) => mockStartProductEnquiry(...args),
}));
jest.doMock('../components', () => ({
  FeatureUnavailable: () => React.createElement('div', null, 'Feature unavailable'),
  IndicativePrice: () => React.createElement('span', null, 'Indicative price'),
  ShopProductCard: () => React.createElement('div', null, 'Product'),
  useShopFeatureFlags: () => mockShopFlags,
}));
jest.doMock('../../../components/ui', () => {
  const ReactModule = require('react') as typeof React;
  return {
    Badge: ({ label }: { label: string }) => ReactModule.createElement('span', null, label),
    Button: ({ title, onPress, disabled, loading }: { title: string; onPress?: () => void; disabled?: boolean; loading?: boolean }) =>
      ReactModule.createElement('button', { type: 'button', 'aria-label': title, disabled: !!disabled || !!loading, onClick: onPress }, title),
    Card: ({ children }: { children: React.ReactNode }) => ReactModule.createElement('section', null, children),
    Chip: ({ label }: { label: string }) => ReactModule.createElement('button', { type: 'button' }, label),
    EmptyState: ({ title, message }: { title: string; message?: string }) =>
      ReactModule.createElement('section', null, title, message),
    ErrorState: ({ message, onRetry }: { message?: string | null; onRetry?: () => void }) =>
      ReactModule.createElement('section', null, message,
        onRetry ? ReactModule.createElement('button', { type: 'button', 'aria-label': 'Retry', onClick: onRetry }, 'Retry') : null),
    Header: ({ title }: { title: string }) => ReactModule.createElement('header', null, title),
    InlineAlert: ({ message }: { message?: string | null }) =>
      message ? ReactModule.createElement('div', { role: 'alert' }, message) : null,
    Input: ({ label, value, onChangeText }: { label: string; value: string; onChangeText: (value: string) => void }) =>
      ReactModule.createElement('label', null, label, ReactModule.createElement('input', {
        'aria-label': label,
        value,
        onChange: (event: { currentTarget: { value: string } }) => onChangeText(event.currentTarget.value),
      })),
    Screen: ({ children, header }: { children: React.ReactNode; header?: React.ReactNode }) =>
      ReactModule.createElement('main', null, header, children),
    Skeleton: () => ReactModule.createElement('div', null, 'Loading'),
    Text: ({ children }: { children: React.ReactNode }) => ReactModule.createElement('span', null, children),
    TextArea: ({ label, value, onChangeText }: { label: string; value: string; onChangeText: (value: string) => void }) => {
      mockTextAreaChanges.set(label, onChangeText);
      return ReactModule.createElement('label', null, label, ReactModule.createElement('textarea', {
        'aria-label': label,
        value,
        onChange: (event: { currentTarget: { value: string } }) => onChangeText(event.currentTarget.value),
      }));
    },
  };
});
jest.doMock('../../../theme', () => ({
  useTheme: () => ({
    spacing: { xs: 4, sm: 8, md: 12, lg: 20 },
    radii: { sm: 4, md: 8, lg: 12 },
    colors: { surfaceAlt: '#eee', primary: '#111', surface: '#fff', border: '#ddd', primarySoft: '#eee', text: '#111', textSecondary: '#444', muted: '#777' },
  }),
}));

const ProductDetailScreen = require('../../marketplaceScreens/ProductDetailScreen').default as React.ComponentType;
const ShopDetailScreen = require('../../marketplaceScreens/ShopDetailScreen').default as React.ComponentType;
const ProductsScreen = require('../../marketplaceScreens/ProductsScreen').default as React.ComponentType;
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

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: 'product-1',
    shop_id: 'shop-1',
    category_id: 'category-1',
    category_slug: 'tiles',
    category_name: 'Tiles',
    name: 'Floor tile',
    brand: 'O18',
    model: '',
    description: '',
    specs: {},
    unit: 'box',
    indicative_price_paise: 0,
    price_updated_at: null,
    in_stock: false,
    active: true,
    image_paths: [],
    shop_name: 'Verified shop',
    city: 'Vijayawada',
    area: 'Benz Circle',
    can_enquire: true,
    enquiry_block_reason: null,
    ...overrides,
  };
}

function shop(overrides: Record<string, unknown> = {}) {
  return {
    id: 'shop-1',
    name: 'Verified shop',
    description: '',
    address_line: null,
    city: 'Vijayawada',
    area: 'Benz Circle',
    lat: null,
    lng: null,
    delivery_radius_km: 20,
    offers_delivery: true,
    offers_pickup: true,
    whatsapp_contact: false,
    category_slugs: ['tiles'],
    can_enquire: false,
    enquiry_block_reason: 'sign_in',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTextAreaChanges.clear();
  mockUserId = null;
  mockAuthLoading = false;
  mockShopFlags.products = true;
  mockShopFlags.enquiries = true;
  mockAiFlags.clear();
  mockAiFlags.add('ai_assistant');
  mockAiFlags.add('ai_product_search');
  mockGetProduct.mockResolvedValue(product({ can_enquire: false, enquiry_block_reason: 'sign_in' }));
  mockGetShop.mockResolvedValue(shop());
  mockListShopProducts.mockResolvedValue([]);
  mockListProductCategories.mockResolvedValue([]);
  mockSearchProducts.mockResolvedValue([]);
  mockStartProductEnquiry.mockResolvedValue('enquiry-1');
  mockRequireSignIn.mockResolvedValue(false);
  mockSearchProductsWithAi.mockResolvedValue({ filters: {}, products: [] });
});

afterEach(async () => {
  if (root) await testAct(() => root?.unmount());
  container?.remove();
  root = undefined;
});

describe('marketplace customer actions', () => {
  it('MK-ACTOR-guest-sign-in-before-composer uses a safe product/shop return route without sending a mutation', async () => {
    await mount(ProductDetailScreen);

    expect(container.textContent).toContain('Sign in to ask shop');
    expect(container.querySelector('textarea[aria-label="Message"]')).toBeNull();
    await press('Sign in to ask shop');
    expect(mockRequireSignIn).toHaveBeenCalledWith('/product/product-1');
    expect(mockStartProductEnquiry).not.toHaveBeenCalled();
    expect(mockRouter.push).not.toHaveBeenCalledWith(expect.stringContaining('Message'));

    if (root) await testAct(() => root?.unmount());
    root = undefined;
    container.remove();
    mockRequireSignIn.mockClear();
    await mount(ShopDetailScreen);

    expect(container.textContent).toContain('Sign in to ask shop');
    expect(container.textContent).not.toContain('1 O18 Market Road');
    expect(container.querySelector('textarea[aria-label="Message"]')).toBeNull();
    await press('Sign in to ask shop');
    expect(mockRequireSignIn).toHaveBeenCalledWith('/shop/shop-1');
    expect(mockStartProductEnquiry).not.toHaveBeenCalled();
  });

  it('MK-ACTOR-owner-manage-not-enquire replaces self-enquiry with shop management', async () => {
    mockUserId = 'owner-1';
    mockGetProduct.mockResolvedValue(product({ can_enquire: false, enquiry_block_reason: 'own_shop' }));

    await mount(ProductDetailScreen);

    expect(container.textContent).toContain('Manage shop');
    expect(container.querySelector('textarea[aria-label="Message"]')).toBeNull();
    await press('Manage shop');
    expect(mockRouter.push).toHaveBeenCalledWith('/merchant-shop');
    expect(mockStartProductEnquiry).not.toHaveBeenCalled();

    if (root) await testAct(() => root?.unmount());
    root = undefined;
    container.remove();
    mockRouter.push.mockClear();
    mockGetShop.mockResolvedValue(shop({
      address_line: '1 Owner Road',
      lat: 16.5,
      lng: 80.6,
      can_enquire: false,
      enquiry_block_reason: 'own_shop',
    }));
    await mount(ShopDetailScreen);

    expect(container.textContent).toContain('Manage shop');
    expect(container.querySelector('textarea[aria-label="Message"]')).toBeNull();
    await press('Manage shop');
    expect(mockRouter.push).toHaveBeenCalledWith('/merchant-shop');
    expect(mockStartProductEnquiry).not.toHaveBeenCalled();
  });

  it('MK-ACTOR-sign-out-redacts-cached-shop-address while the public refresh is failing', async () => {
    mockUserId = 'shop-owner-1';
    mockGetShop.mockResolvedValue(shop({
      address_line: '1 Private Road',
      lat: 16.5,
      lng: 80.6,
      can_enquire: false,
      enquiry_block_reason: 'own_shop',
    }));
    await mount(ShopDetailScreen);
    expect(container.textContent).toContain('1 Private Road');
    expect(container.textContent).toContain('Manage shop');

    mockUserId = null;
    mockGetShop.mockRejectedValueOnce(new Error('refresh denied'));
    await testAct(async () => {
      root?.render(React.createElement(ShopDetailScreen));
      await flush();
    });

    expect(container.textContent).not.toContain('1 Private Road');
    expect(container.textContent).toContain('Sign in to ask shop');
    expect(container.textContent).not.toContain('Manage shop');
  });

  it('MK-ACTOR-customer-allowed keeps the existing composer for an eligible out-of-stock product', async () => {
    mockUserId = 'customer-1';
    mockGetProduct.mockResolvedValue(product({ can_enquire: true, enquiry_block_reason: null, in_stock: false }));

    await mount(ProductDetailScreen);

    expect(container.querySelector('textarea[aria-label="Message"]')).not.toBeNull();
    await testAct(async () => {
      mockTextAreaChanges.get('Message')?.('Is this tile available next week?');
      await flush();
    });
    await press('Send enquiry');

    expect(mockStartProductEnquiry).toHaveBeenCalledWith('shop-1', 'product-1', 'Is this tile available next week?');
    expect(mockRouter.push).toHaveBeenCalledWith('/enquiry/enquiry-1');
  });

  it('MK-ACTOR-AI-guest-sign-in gates the editable AI query and submits no AI request', async () => {
    await mount(ProductsScreen);

    expect(container.textContent).toContain('Sign in to use AI');
    expect(container.querySelector('input[aria-label="Ask in your words"]')).toBeNull();
    await press('Sign in to use AI');

    expect(mockRequireSignIn).toHaveBeenCalledWith('/products');
    expect(mockSearchProductsWithAi).not.toHaveBeenCalled();
  });
});
