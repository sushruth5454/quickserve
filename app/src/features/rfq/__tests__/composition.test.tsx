import React from 'react';
import type { RfqQuoteComparison } from '../api';

const mockRouter = { push: jest.fn(), replace: jest.fn() };
const mockWidth = { width: 390 };
const mockFlags: Record<string, boolean> = {};
const mockGetRfq = jest.fn();
const mockCompareRfqQuotes = jest.fn();
const mockGetSupplierRfq = jest.fn();
const mockGetProductEnquiry = jest.fn();
const mockListProductEnquiryMessages = jest.fn();
const mockListProductCategories = jest.fn();
const mockSelectSupplierQuote = jest.fn();
const mockDom = new (require('jsdom').JSDOM)('<!doctype html><html><body></body></html>');

Object.defineProperty(globalThis, 'window', { configurable: true, value: mockDom.window });
Object.defineProperty(globalThis, 'document', { configurable: true, value: mockDom.window.document });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: mockDom.window.navigator });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function isOn(key: string): boolean {
  if (mockFlags[key] !== true) return false;
  return key === 'oorva_rfq_ux' ? isOn('oorva_brand') : true;
}

jest.doMock('expo-router', () => {
  const ReactModule = require('react') as typeof React;
  return {
    router: mockRouter,
    useLocalSearchParams: () => ({ id: 'rfq-1', shopId: 'shop-1' }),
    useFocusEffect(callback: () => void | (() => void)) {
      ReactModule.useEffect(() => callback(), [callback]);
    },
  };
});

jest.doMock('react-native', () => {
  const ReactModule = require('react') as typeof React;
  return {
    Alert: { alert: jest.fn() },
    AppState: { addEventListener: () => ({ remove: jest.fn() }) },
    Platform: { OS: 'web' },
    View: ({ children, testID, accessibilityLabel, style }: {
      children?: React.ReactNode;
      testID?: string;
      accessibilityLabel?: string;
      style?: { flexDirection?: string };
    }) => ReactModule.createElement('div', {
      'data-testid': testID,
      'aria-label': accessibilityLabel,
      'data-flex-direction': style?.flexDirection,
    }, children),
    useWindowDimensions: () => mockWidth,
  };
});

jest.doMock('../../../lib/featureFlags', () => ({
  useAppFeatureFlags: () => ({ isOn }),
}));
jest.doMock('../../../lib/auth', () => ({
  useAuth: () => ({ userId: 'customer-1' }),
}));
jest.doMock('../../../lib/locationContext', () => ({
  useSelectedLocation: () => ({
    location: { lat: 17.44, lng: 78.39, city: 'Hyderabad', area: 'Madhapur' },
    ready: true,
  }),
}));
jest.doMock('../../../components/ui', () => {
  const ReactModule = require('react') as typeof React;
  return {
    Badge: ({ label }: { label: string }) => ReactModule.createElement('span', null, label),
    Button: ({ title, onPress, disabled, loading }: {
      title: string;
      onPress?: () => void;
      disabled?: boolean;
      loading?: boolean;
    }) => ReactModule.createElement('button', {
      type: 'button',
      'aria-label': title,
      disabled: !!disabled || !!loading,
      onClick: onPress,
    }, title),
    Card: ({ children }: { children: React.ReactNode }) => ReactModule.createElement('section', null, children),
    Chip: ({ label }: { label: string }) => ReactModule.createElement('button', { type: 'button' }, label),
    EmptyState: ({ title, message }: { title: string; message?: string }) =>
      ReactModule.createElement('section', null, title, message),
    ErrorState: ({ message, onRetry }: { message: string; onRetry?: () => void }) =>
      ReactModule.createElement('section', null, message,
        onRetry ? ReactModule.createElement('button', { type: 'button', onClick: onRetry }, 'Retry') : null),
    Header: ({ title, subtitle }: { title: string; subtitle?: string }) =>
      ReactModule.createElement('header', null, title, subtitle),
    InlineAlert: ({ message }: { message?: string | null }) =>
      message ? ReactModule.createElement('div', { role: 'alert' }, message) : null,
    Input: ({ label, value }: { label: string; value?: string }) =>
      ReactModule.createElement('label', null, label, ReactModule.createElement('input', { 'aria-label': label, value })),
    Screen: ({ children, header, footer }: {
      children: React.ReactNode;
      header?: React.ReactNode;
      footer?: React.ReactNode;
    }) => ReactModule.createElement('main', null, header, children, footer),
    Skeleton: () => ReactModule.createElement('div', null, 'Loading'),
    Text: ({ children }: { children: React.ReactNode }) => ReactModule.createElement('span', null, children),
    TextArea: ({ label }: { label: string }) => ReactModule.createElement('label', null, label),
    useConfirm: () => jest.fn(async () => true),
    useToast: () => jest.fn(),
  };
});
jest.doMock('../../shops/components', () => ({
  useShopFeatureFlags: () => ({
    products: isOn('products'),
    enquiries: isOn('products') && isOn('product_enquiries'),
  }),
}));
jest.doMock('../../shops/SpecFields', () => ({
  SpecFields: () => React.createElement('div', null, 'Specifications'),
}));
jest.doMock('../../shops/specs', () => ({
  cleanSpecs: (value: unknown) => value,
}));
jest.doMock('../../shops/api', () => ({
  getProductEnquiry: (...args: unknown[]) => mockGetProductEnquiry(...args),
  listProductEnquiryMessages: (...args: unknown[]) => mockListProductEnquiryMessages(...args),
  listProductCategories: (...args: unknown[]) => mockListProductCategories(...args),
  markEnquiryRead: jest.fn(async () => undefined),
  sendEnquiryMessage: jest.fn(async () => undefined),
  setProductEnquiryStatus: jest.fn(async () => undefined),
}));
jest.doMock('../api', () => ({
  cancelRfq: jest.fn(async () => undefined),
  compareRfqQuotes: (...args: unknown[]) => mockCompareRfqQuotes(...args),
  createRfq: jest.fn(async () => 'rfq-1'),
  getRfq: (...args: unknown[]) => mockGetRfq(...args),
  getSupplierRfq: (...args: unknown[]) => mockGetSupplierRfq(...args),
  selectSupplierQuote: (...args: unknown[]) => mockSelectSupplierQuote(...args),
  sendSupplierQuote: jest.fn(async () => undefined),
}));
jest.doMock('../../../theme', () => ({
  useTheme: () => ({
    spacing: { xs: 4, sm: 8, md: 12, lg: 20 },
    radii: { sm: 4, md: 8, lg: 12 },
    colors: { border: 'border-token', primarySoft: 'primary-soft-token', surface: 'surface-token' },
  }),
}));

const RfqDetailScreen = require('../../marketplaceScreens/RfqDetailScreen').default as React.ComponentType;
const RfqMerchantDetailScreen = require('../../marketplaceScreens/RfqMerchantDetailScreen').default as React.ComponentType;
const RfqNewScreen = require('../../marketplaceScreens/RfqNewScreen').default as React.ComponentType;
const EnquiryDetailScreen = require('../../marketplaceScreens/EnquiryDetailScreen').default as React.ComponentType;
const { buildComparePresentation } = require('../comparePresentation') as typeof import('../comparePresentation');
const { rfqQuoteValidityWarning } = require('../components') as typeof import('../components');
const { createRoot } = require('react-dom/client') as { createRoot: (container: Element) => TestRoot };
const testAct = require('react').act as (callback: () => void | Promise<void>) => Promise<void>;

type TestRoot = { render: (element: React.ReactElement) => void; unmount: () => void };
let root: TestRoot | undefined;
let container: HTMLDivElement;

const requestedItem = {
  id: 'item-1',
  seq: 1,
  description: 'Floor tile',
  brand_pref: 'Acme',
  specs: { finish: 'matte', size: '600x600' },
  quantity: 10,
  unit: 'box',
};

function rfq() {
  return {
    id: 'rfq-1',
    customer_id: 'customer-1',
    category_id: 'category-1',
    category_name: 'Tiles',
    title: 'Kitchen tiles',
    city: 'Hyderabad',
    area: 'Madhapur',
    lat: 17.44,
    lng: 78.39,
    needs_delivery: true,
    needed_by: '2027-01-15',
    notes: '',
    status: 'open',
    expires_at: '2030-01-10T00:00:00.000Z',
    created_at: '2026-11-20T00:00:00.000Z',
    recipient_count: 2,
    items: [requestedItem],
  };
}

function quote(overrides: Partial<RfqQuoteComparison> = {}): RfqQuoteComparison {
  return {
    quote_id: 'quote-1',
    shop_id: 'shop-1',
    shop_name: 'Tile House',
    version: 1,
    status: 'sent',
    valid_until: '2030-01-01T00:00:00.000Z',
    delivery_charge_paise: 2500,
    delivery_days: 5,
    notes: 'Delivery to Madhapur',
    subtotal_paise: 10000,
    gst_paise: 1800,
    total_paise: 14300,
    unavailable_count: 0,
    complete: true,
    arrives_after_needed_by: false,
    delivery_terms_missing: false,
    items: [{
      rfq_item_id: 'item-1',
      seq: 1,
      description: 'Floor tile',
      requested_brand: 'Acme',
      requested_specs: { finish: 'matte', size: '600x600' },
      brand: 'Acme',
      model: 'A-60',
      specs: { finish: 'matte', size: '600x600' },
      quantity: 10,
      unit: 'box',
      unit_price_paise: 1000,
      gst_rate_bp: 1800,
      available: true,
      line_total_paise: 10000,
      brand_differs: false,
      specs_missing: false,
      missing_spec_keys: [],
      specs_differ: false,
      differing_spec_keys: [],
      quantity_rounded_up: false,
    }],
    can_select: true,
    selection_block_reason: null,
    ...overrides,
  };
}

function supplierRfq() {
  return {
    ...rfq(),
    shop_id: 'shop-1',
    shop_name: 'Tile House',
    business_role: 'owner',
    shop_has_gstin: true,
    can_send_quote: true,
    send_block_reason: null,
    my_quote: null,
  };
}

function enquiry() {
  return {
    id: 'enquiry-1',
    shop_id: 'shop-1',
    product_id: 'product-1',
    shop_name: 'Tile House',
    product_name: 'Floor tile',
    status: 'open',
    customer_id: 'customer-1',
    shop_unread: 0,
    customer_unread: 0,
    from_shop_user: false,
    business_role: null,
    can_change_status: true,
    can_reopen: false,
    active_enquiry_id: null,
    last_message_at: '2026-11-20T00:00:00.000Z',
  };
}

async function flush() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
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

async function press(label: string) {
  const button = [...container.querySelectorAll('button')]
    .find((item) => item.getAttribute('aria-label') === label);
  if (!button) throw new Error(`Missing button ${label}; DOM=${container.textContent}`);
  await testAct(async () => {
    button.click();
    await flush();
  });
}

beforeEach(() => {
  Object.assign(mockFlags, {
    products: true,
    product_rfq: true,
    product_enquiries: true,
    oorva_brand: true,
    oorva_rfq_ux: true,
  });
  mockWidth.width = 390;
  mockRouter.push.mockReset();
  mockRouter.replace.mockReset();
  mockSelectSupplierQuote.mockReset().mockResolvedValue({ enquiry_id: 'enquiry-1' });
  mockGetRfq.mockReset().mockResolvedValue(rfq());
  mockCompareRfqQuotes.mockReset().mockResolvedValue([quote()]);
  mockGetSupplierRfq.mockReset().mockResolvedValue(supplierRfq());
  mockGetProductEnquiry.mockReset().mockResolvedValue(enquiry());
  mockListProductEnquiryMessages.mockReset().mockResolvedValue([{
    id: 'message-1',
    sender_id: 'shop-1',
    from_shop: true,
    body: 'We can help with your request.',
    created_at: '2026-11-20T00:00:00.000Z',
  }]);
  mockListProductCategories.mockReset().mockResolvedValue([{
    id: 'category-1',
    name: 'Tiles',
    attribute_schema: { properties: {} },
  }]);
});

afterEach(async () => {
  await unmount();
});

describe('O19C RFQ and enquiry composition', () => {
  it('uses the four exact extracted hosts for their flagged composition variants', async () => {
    const hosts = [
      [EnquiryDetailScreen, 'Enquiry details'],
      [RfqDetailScreen, 'Supplier comparison'],
      [RfqMerchantDetailScreen, 'Supplier quotation'],
      [RfqNewScreen, 'Request details'],
    ] as const;

    for (const [Host, expected] of hosts) {
      await mount(Host);
      expect(container.textContent).toContain(expected);
      await unmount();
    }
  });

  it('stacks comparison on mobile and uses columns on wide screens', async () => {
    await mount(RfqDetailScreen);
    expect(container.querySelector('[aria-label="Supplier comparison, stacked"]')).not.toBeNull();
    expect(container.textContent).toContain('Tax is shown as quoted');
    expect(container.textContent).toContain('Choose this supplier');

    await unmount();
    mockWidth.width = 900;
    await mount(RfqDetailScreen);
    expect(container.querySelector('[aria-label="Supplier comparison, columns"]')).not.toBeNull();
  });

  it('continues a selected quote in its enquiry without opening checkout', async () => {
    await mount(RfqDetailScreen);
    await press('Choose this supplier');

    expect(mockSelectSupplierQuote).toHaveBeenCalledWith('quote-1');
    expect(mockRouter.replace).toHaveBeenCalledWith('/enquiry/enquiry-1');
    expect(mockRouter.replace.mock.calls.some(([path]) => String(path).includes('checkout'))).toBe(false);
  });

  it('keeps current, expired, and partial quote terms explicit before any selection', () => {
    const nowMs = Date.parse('2026-11-24T10:00:00.000Z');
    const liveOptions = {
      rfqStatus: 'open' as const,
      rfqExpiresAt: '2026-11-24T10:10:00.000Z',
      nowMs,
      enquiriesEnabled: true,
    };
    const current = buildComparePresentation([quote({
      valid_until: '2026-11-24T10:05:00.000Z',
    })], liveOptions);
    expect(current.selectableQuoteIds).toEqual(['quote-1']);
    expect(rfqQuoteValidityWarning('2026-11-24T10:05:00.000Z', nowMs)).toBeNull();

    const expired = buildComparePresentation([quote({
      valid_until: '2026-11-24T09:59:59.999Z',
    })], liveOptions);
    expect(expired.selectableQuoteIds).toEqual([]);
    expect(rfqQuoteValidityWarning('2026-11-24T09:59:59.999Z', nowMs)).toContain('validity has ended');

    const partial = buildComparePresentation([quote({
      complete: false,
      unavailable_count: 1,
      delivery_terms_missing: true,
      items: [{ ...quote().items[0]!, available: false, specs_missing: true, missing_spec_keys: ['size'] }],
    })], liveOptions);
    expect(partial.warnings['quote-1']).toEqual(expect.arrayContaining([
      'Coverage: 0/1 requested items',
      'Unavailable: Floor tile',
      'Missing specifications: Floor tile (size)',
      'Delivery timing or terms not stated',
    ]));
    expect(partial.selectableQuoteIds).toEqual(['quote-1']);
  });

  it('preserves the legacy request form when the leaf or its parent is off', async () => {
    mockFlags.oorva_rfq_ux = false;
    await mount(RfqNewScreen);
    expect(container.textContent).toContain('Request title');
    expect(container.textContent).not.toContain('Request details');
    expect(container.querySelector('button[aria-label="Send request"]')).not.toBeNull();

    await unmount();
    await mount(RfqDetailScreen);
    expect(container.textContent).toContain('Requested items');
    expect(container.textContent).not.toContain('Tax is shown as quoted');
    expect(container.querySelector('button[aria-label="Cancel request"]')).not.toBeNull();

    await unmount();
    mockFlags.oorva_rfq_ux = true;
    mockFlags.oorva_brand = false;
    await mount(RfqNewScreen);
    expect(container.textContent).toContain('Request title');
    expect(container.textContent).not.toContain('Request details');
    expect(container.querySelector('button[aria-label="Send request"]')).not.toBeNull();
  });
});
