import React from 'react';

const mockRouter = { replace: jest.fn() };
const mockAlert = jest.fn();
const mockGetRfq = jest.fn();
const mockCompareRfqQuotes = jest.fn();
const mockCancelRfq = jest.fn();
const mockSelectSupplierQuote = jest.fn();
const mockFeatureFlags = { rfq: false, enquiries: false };

const mockDom = new (require('jsdom').JSDOM)('<!doctype html><html><body></body></html>');
Object.defineProperty(globalThis, 'window', { configurable: true, value: mockDom.window });
Object.defineProperty(globalThis, 'document', { configurable: true, value: mockDom.window.document });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: mockDom.window.navigator });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.doMock('expo-router', () => {
  const ReactModule = require('react') as typeof React;
  return {
    router: mockRouter,
    useLocalSearchParams: () => ({ id: 'rfq-1' }),
    useFocusEffect(callback: () => void | (() => void)) {
      ReactModule.useEffect(() => callback(), [callback]);
    },
  };
});
jest.doMock('react-native', () => {
  const ReactModule = require('react') as typeof React;
  return {
    Alert: { alert: mockAlert },
    ScrollView: ({ children }: { children: React.ReactNode }) => ReactModule.createElement('div', null, children),
    View: ({ children }: { children: React.ReactNode }) => ReactModule.createElement('div', null, children),
  };
});
jest.doMock('../../../components/ui', () => {
  const ReactModule = require('react') as typeof React;
  return {
    Badge: ({ label }: { label: string }) => ReactModule.createElement('span', null, label),
    Button: ({ title, onPress, disabled, loading }: { title: string; onPress?: () => void; disabled?: boolean; loading?: boolean }) =>
      ReactModule.createElement('button', { type: 'button', 'aria-label': title, disabled: !!disabled || !!loading, onClick: onPress }, title),
    Card: ({ children }: { children: React.ReactNode }) => ReactModule.createElement('section', null, children),
    EmptyState: ({ title, message }: { title: string; message?: string }) =>
      ReactModule.createElement('section', { 'data-testid': 'empty' }, title, message),
    ErrorState: ({ message }: { message: string }) => ReactModule.createElement('section', { 'data-testid': 'error' }, message),
    Header: ({ title }: { title: string }) => ReactModule.createElement('header', null, title),
    InlineAlert: ({ message }: { message?: string | null }) => message ? ReactModule.createElement('div', { role: 'alert' }, message) : null,
    Screen: ({ children, header }: { children: React.ReactNode; header?: React.ReactNode }) =>
      ReactModule.createElement('main', null, header, children),
    Skeleton: () => ReactModule.createElement('div', { 'data-testid': 'skeleton' }, 'Loading'),
    Text: ({ children }: { children: React.ReactNode }) => ReactModule.createElement('span', null, children),
    useToast: () => jest.fn(),
  };
});
jest.doMock('../../../components/market/QuoteCompareTable', () => ({
  QuoteCompareTable: () => null,
}));
jest.doMock('../api', () => ({
  cancelRfq: (...args: unknown[]) => mockCancelRfq(...args),
  compareRfqQuotes: (...args: unknown[]) => mockCompareRfqQuotes(...args),
  getRfq: (...args: unknown[]) => mockGetRfq(...args),
  selectSupplierQuote: (...args: unknown[]) => mockSelectSupplierQuote(...args),
}));
jest.doMock('../components', () => ({
  RfqStatusLabel: ({ status }: { status: string }) => React.createElement('span', null, status),
  useRfqFeatureFlags: () => mockFeatureFlags,
}));
jest.doMock('../../../theme', () => ({
  useTheme: () => ({ spacing: { xs: 4, sm: 8, md: 12 }, radii: { lg: 12 }, colors: { border: '#ddd' } }),
}));

const RfqDetailScreen = require('../../marketplaceScreens/RfqDetailScreen').default as React.ComponentType;
const { createRoot } = require('react-dom/client') as { createRoot: (container: Element) => TestRoot };
const testAct = require('react').act as (callback: () => void | Promise<void>) => Promise<void>;

type TestRoot = { render: (element: React.ReactElement) => void; unmount: () => void };
type AlertButton = { text: string; onPress?: () => void };

let root: TestRoot | undefined;
let container: HTMLDivElement;

function rfq(status: 'open' | 'cancelled') {
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
    needs_delivery: false,
    needed_by: '2027-01-15',
    notes: '',
    status,
    expires_at: '2027-01-10T00:00:00.000Z',
    created_at: '2026-11-20T00:00:00.000Z',
    recipient_count: 1,
    items: [{ id: 'item-1', seq: 1, description: 'Floor tile', brand_pref: '', specs: {}, quantity: 10, unit: 'box' }],
  };
}

function quote(status: 'sent' | 'rejected') {
  return {
    quote_id: 'quote-1',
    shop_id: 'shop-1',
    shop_name: 'Tile Shop',
    version: 1,
    status,
    valid_until: '2027-01-10T00:00:00.000Z',
    delivery_charge_paise: 0,
    delivery_days: null,
    notes: '',
    subtotal_paise: 10000,
    gst_paise: 1800,
    total_paise: 11800,
    unavailable_count: 0,
    complete: true,
    arrives_after_needed_by: false,
    delivery_terms_missing: false,
    items: [],
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await testAct(async () => {
    root?.render(React.createElement(RfqDetailScreen));
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
  mockFeatureFlags.rfq = false;
  mockFeatureFlags.enquiries = false;
  mockGetRfq.mockReset();
  mockCompareRfqQuotes.mockReset();
  mockCancelRfq.mockReset().mockResolvedValue(undefined);
  mockSelectSupplierQuote.mockReset();
});

afterEach(async () => {
  if (root) await testAct(() => root?.unmount());
  container?.remove();
  root = undefined;
});

describe('RFQ cancellation', () => {
  it('MK-CANCEL-truthful-confirmation closes without promising supplier notification or payment', async () => {
    mockGetRfq.mockResolvedValueOnce(rfq('open')).mockResolvedValueOnce(rfq('cancelled'));
    mockCompareRfqQuotes.mockResolvedValueOnce([quote('sent')]).mockResolvedValueOnce([quote('rejected')]);
    await mount();

    const cancelButton = container.querySelector('button[aria-label="Cancel request"]') as HTMLButtonElement | null;
    const visibleText = container.textContent ?? '';
    const actualBeforeConfirm = {
      buttonExists: !!cancelButton,
      buttonDisabled: cancelButton?.disabled,
      requestedItemsBeforeCancel: visibleText.indexOf('Requested items') < visibleText.lastIndexOf('Cancel request'),
    };
    assertActual('An owner must retain contextual cancellation while RFQ capabilities are off', actualBeforeConfirm, (state) =>
      state.buttonExists === true && state.buttonDisabled === false && state.requestedItemsBeforeCancel === true);

    await press('Cancel request');
    const [, message, buttons] = mockAlert.mock.calls[0] as [string, string, AlertButton[]];
    const actualConfirmation = {
      message,
      unsupportedNotificationPromise: /suppliers will be told|notified|push notification/i.test(message),
      dismissLabel: buttons?.[0]?.text,
      confirmLabel: buttons?.[1]?.text,
    };
    assertActual('Confirmation must explain closure, quote outcome, and no payment without promising notification', actualConfirmation, (state) =>
      String(state.message).includes('closes your request')
      && String(state.message).includes('Outstanding quotes will not be selected')
      && String(state.message).includes('No payment will be taken')
      && state.unsupportedNotificationPromise === false
      && state.dismissLabel === 'Keep request'
      && state.confirmLabel === 'Cancel request');

    await testAct(async () => {
      buttons[1]?.onPress?.();
      await flush();
    });
    const actualAfterConfirm = {
      cancelCalls: mockCancelRfq.mock.calls,
      getRfqCalls: mockGetRfq.mock.calls,
      compareCalls: mockCompareRfqQuotes.mock.calls,
      displayedStatus: container.textContent?.includes('cancelled') ?? false,
      displayedRejectedQuote: container.textContent?.includes('rejected') ?? false,
      cancelButtonRemains: !!container.querySelector('button[aria-label="Cancel request"]'),
      selectCalls: mockSelectSupplierQuote.mock.calls.length,
    };
    assertActual('Confirm must cancel the same RFQ and await canonical status/quote reload', actualAfterConfirm, (state) =>
      JSON.stringify(state.cancelCalls) === JSON.stringify([['rfq-1']])
      && JSON.stringify(state.getRfqCalls) === JSON.stringify([['rfq-1'], ['rfq-1']])
      && JSON.stringify(state.compareCalls) === JSON.stringify([['rfq-1'], ['rfq-1']])
      && state.displayedStatus === true && state.displayedRejectedQuote === true
      && state.cancelButtonRemains === false && state.selectCalls === 0);
  });

  it('MK-CANCEL-dismiss-no-call does not mutate the RFQ when the owner keeps it', async () => {
    mockGetRfq.mockResolvedValue(rfq('open'));
    mockCompareRfqQuotes.mockResolvedValue([quote('sent')]);
    await mount();
    await press('Cancel request');
    const buttons = mockAlert.mock.calls[0]?.[2] as AlertButton[];
    buttons[0]?.onPress?.();

    const actual = {
      cancelCalls: mockCancelRfq.mock.calls.length,
      getRfqCalls: mockGetRfq.mock.calls.length,
      statusStillOpen: container.textContent?.includes('open') ?? false,
    };
    assertActual('Dismissal must make no cancellation call', actual, (state) =>
      state.cancelCalls === 0 && state.getRfqCalls === 1 && state.statusStillOpen === true);
  });

  it('MK-CANCEL-terminal-no-repeat hides cancellation after the request is terminal', async () => {
    mockGetRfq.mockResolvedValue(rfq('cancelled'));
    mockCompareRfqQuotes.mockResolvedValue([quote('rejected')]);
    await mount();

    const actual = {
      cancelButton: !!container.querySelector('button[aria-label="Cancel request"]'),
      alertCalls: mockAlert.mock.calls.length,
      cancelCalls: mockCancelRfq.mock.calls.length,
      terminalStatusVisible: container.textContent?.includes('cancelled') ?? false,
    };
    assertActual('Terminal RFQs must not offer a repeated pending cancellation', actual, (state) =>
      state.cancelButton === false && state.alertCalls === 0 && state.cancelCalls === 0 && state.terminalStatusVisible === true);
  });
});
