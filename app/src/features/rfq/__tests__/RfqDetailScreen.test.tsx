import React from 'react';

const mockRouter = { replace: jest.fn() };
const mockAlert = jest.fn();
const mockConfirm = jest.fn();
const mockGetRfq = jest.fn();
const mockCompareRfqQuotes = jest.fn();
const mockCancelRfq = jest.fn();
const mockSelectSupplierQuote = jest.fn();
const mockFeatureFlags = { rfq: false, enquiries: false };
const mockPlatform: { OS: string } = { OS: 'ios' };

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
    Platform: mockPlatform,
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
    ErrorState: ({ message, onRetry }: { message: string; onRetry?: () => void }) =>
      ReactModule.createElement('section', { 'data-testid': 'error' }, message,
        onRetry ? ReactModule.createElement('button', { type: 'button', 'aria-label': 'Retry', onClick: onRetry }, 'Retry') : null),
    Header: ({ title }: { title: string }) => ReactModule.createElement('header', null, title),
    InlineAlert: ({ message, actionLabel, onAction }: { message?: string | null; actionLabel?: string; onAction?: () => void }) =>
      message ? ReactModule.createElement('div', { role: 'alert' }, message,
        actionLabel && onAction ? ReactModule.createElement('button', { type: 'button', 'aria-label': actionLabel, onClick: onAction }, actionLabel) : null) : null,
    Screen: ({ children, header, onRefresh }: { children: React.ReactNode; header?: React.ReactNode; onRefresh?: () => void }) =>
      ReactModule.createElement('main', null, header, onRefresh
        ? ReactModule.createElement('button', { type: 'button', 'aria-label': 'Refresh', onClick: onRefresh }, 'Refresh')
        : null, children),
    Skeleton: () => ReactModule.createElement('div', { 'data-testid': 'skeleton' }, 'Loading'),
    Text: ({ children }: { children: React.ReactNode }) => ReactModule.createElement('span', null, children),
    useConfirm: () => mockConfirm,
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
    can_select: status === 'sent',
    selection_block_reason: status === 'sent' ? null : 'closed',
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
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
  mockPlatform.OS = 'ios';
  mockGetRfq.mockReset();
  mockCompareRfqQuotes.mockReset();
  mockCancelRfq.mockReset().mockResolvedValue(undefined);
  mockSelectSupplierQuote.mockReset();
  mockConfirm.mockReset();
});

afterEach(async () => {
  if (root) await testAct(() => root?.unmount());
  container?.remove();
  root = undefined;
});

describe('RFQ cancellation and read states', () => {
  it('MK-CANCEL-truthful-confirmation closes without promising supplier notification or payment', async () => {
    mockGetRfq.mockResolvedValueOnce(rfq('open')).mockResolvedValueOnce(rfq('cancelled'));
    mockCompareRfqQuotes.mockResolvedValueOnce([quote('sent')]).mockResolvedValueOnce([quote('rejected')]);
    await mount();

    const cancelButton = container.querySelector('button[aria-label="Cancel request"]') as HTMLButtonElement | null;
    const visibleText = container.textContent ?? '';
    const actualBeforeConfirm = {
      buttonExists: !!cancelButton,
      buttonDisabled: cancelButton?.disabled,
      requestContentBeforeCancel: visibleText.indexOf('Requested items') < visibleText.lastIndexOf('Cancel request'),
    };
    assertActual('An owner must retain contextual cancellation while RFQ capabilities are off', actualBeforeConfirm, (state) =>
      state.buttonExists === true && state.buttonDisabled === false && state.requestContentBeforeCancel === true);

    await press('Cancel request');
    const [, message, buttons] = mockAlert.mock.calls[0] as [string, string, AlertButton[]];
    const actualConfirmation = {
      message,
      unsupportedNotificationPromise: /suppliers will be told|notified|push notification/i.test(message),
      dismissLabel: buttons?.[0]?.text,
      confirmLabel: buttons?.[1]?.text,
    };
    assertActual('Native confirmation must describe closure and no payment without promising notification', actualConfirmation, (state) =>
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
    assertActual('Native dismissal must make no cancellation call', actual, (state) =>
      state.cancelCalls === 0 && state.getRfqCalls === 1 && state.statusStillOpen === true);
  });

  it('MK-CANCEL-terminal-no-repeat hides cancellation after the request is terminal', async () => {
    mockGetRfq.mockResolvedValue(rfq('cancelled'));
    mockCompareRfqQuotes.mockResolvedValue([quote('rejected')]);
    await mount();

    const actual = {
      cancelButton: !!container.querySelector('button[aria-label="Cancel request"]'),
      alertCalls: mockAlert.mock.calls.length,
      confirmCalls: mockConfirm.mock.calls.length,
      cancelCalls: mockCancelRfq.mock.calls.length,
      terminalStatusVisible: container.textContent?.includes('cancelled') ?? false,
    };
    assertActual('Terminal RFQs must not offer a repeated pending cancellation', actual, (state) =>
      state.cancelButton === false && state.alertCalls === 0 && state.confirmCalls === 0
      && state.cancelCalls === 0 && state.terminalStatusVisible === true);
  });

  it('MK-CANCEL-web-confirm-provider uses current cross-platform confirmation and respects dismissal', async () => {
    mockPlatform.OS = 'web';
    mockConfirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mockGetRfq.mockResolvedValueOnce(rfq('open')).mockResolvedValueOnce(rfq('cancelled'));
    mockCompareRfqQuotes.mockResolvedValueOnce([quote('sent')]).mockResolvedValueOnce([quote('rejected')]);
    await mount();

    await press('Cancel request');
    const actualAfterDismissal = {
      confirmOptions: mockConfirm.mock.calls[0]?.[0],
      cancelCalls: mockCancelRfq.mock.calls.length,
      nativeAlertCalls: mockAlert.mock.calls.length,
    };
    assertActual('Web cancellation must use ConfirmProvider and leave the RFQ unchanged on dismissal', actualAfterDismissal, (state) =>
      (state.confirmOptions as { title?: string; message?: string; confirmLabel?: string; cancelLabel?: string; destructive?: boolean }).title === 'Cancel request'
      && (state.confirmOptions as { message?: string }).message?.includes('Outstanding quotes will not be selected') === true
      && (state.confirmOptions as { message?: string }).message?.includes('No payment will be taken') === true
      && (state.confirmOptions as { confirmLabel?: string }).confirmLabel === 'Cancel request'
      && (state.confirmOptions as { cancelLabel?: string }).cancelLabel === 'Keep request'
      && (state.confirmOptions as { destructive?: boolean }).destructive === true
      && state.cancelCalls === 0 && state.nativeAlertCalls === 0);

    await press('Cancel request');
    const actualAfterConfirm = {
      confirmCalls: mockConfirm.mock.calls.length,
      cancelCalls: mockCancelRfq.mock.calls,
      displayedStatus: container.textContent?.includes('cancelled') ?? false,
      displayedRejectedQuote: container.textContent?.includes('rejected') ?? false,
      nativeAlertCalls: mockAlert.mock.calls.length,
    };
    assertActual('Web confirmation must invoke cancellation only after explicit acceptance', actualAfterConfirm, (state) =>
      state.confirmCalls === 2 && JSON.stringify(state.cancelCalls) === JSON.stringify([['rfq-1']])
      && state.displayedStatus === true && state.displayedRejectedQuote === true && state.nativeAlertCalls === 0);
  });

  it('MK-READ-RFQ-initial-failure offers retry without inventing an empty state', async () => {
    mockGetRfq.mockRejectedValueOnce(new Error('RFQ unavailable')).mockResolvedValueOnce(rfq('open'));
    mockCompareRfqQuotes.mockRejectedValueOnce(new Error('quote history unavailable')).mockResolvedValueOnce([quote('sent')]);
    await mount();

    let actual: Record<string, unknown> = {
      error: container.querySelector('[data-testid="error"]')?.textContent ?? '',
      retry: !!container.querySelector('button[aria-label="Retry"]'),
      empty: !!container.querySelector('[data-testid="empty"]'),
      cancelButton: !!container.querySelector('button[aria-label="Cancel request"]'),
    };
    assertActual('Failed initial reads must offer retry, not an empty or cancellable request', actual, (state) =>
      String(state.error).includes('RFQ unavailable') && state.retry === true && state.empty === false && state.cancelButton === false);

    await press('Retry');
    actual = {
      error: container.querySelector('[data-testid="error"]')?.textContent ?? '',
      requestVisible: container.textContent?.includes('Kitchen tiles') ?? false,
      cancelButton: !!container.querySelector('button[aria-label="Cancel request"]'),
    };
    assertActual('A successful retry must reveal the RFQ and its safe owner cancellation', actual, (state) =>
      !state.error && state.requestVisible === true && state.cancelButton === true);
  });

  it('MK-READ-RFQ-refresh-failure retains stale history and gates mutations until retry succeeds', async () => {
    mockFeatureFlags.rfq = true;
    mockFeatureFlags.enquiries = true;
    mockGetRfq.mockResolvedValueOnce(rfq('open')).mockRejectedValueOnce(new Error('RFQ refresh failed')).mockResolvedValueOnce(rfq('open'));
    mockCompareRfqQuotes.mockResolvedValue([quote('sent')]);
    await mount();
    await press('Refresh');

    let actual: Record<string, unknown> = {
      warning: container.querySelector('[role="alert"]')?.textContent ?? '',
      requestVisible: container.textContent?.includes('Kitchen tiles') ?? false,
      quoteVisible: container.textContent?.includes('Tile Shop') ?? false,
      cancelDisabled: (container.querySelector('button[aria-label="Cancel request"]') as HTMLButtonElement | null)?.disabled,
      selectDisabled: (container.querySelector('button[aria-label="Choose this supplier"]') as HTMLButtonElement | null)?.disabled,
    };
    assertActual('Failed refresh must retain labeled RFQ history and disable cancellation/selection', actual, (state) =>
      String(state.warning).includes('Refresh failed') && String(state.warning).includes('RFQ refresh failed')
      && state.requestVisible === true && state.quoteVisible === true
      && state.cancelDisabled === true && state.selectDisabled === true);

    await press('Retry');
    actual = {
      warning: container.querySelector('[role="alert"]')?.textContent ?? '',
      cancelDisabled: (container.querySelector('button[aria-label="Cancel request"]') as HTMLButtonElement | null)?.disabled,
      selectDisabled: (container.querySelector('button[aria-label="Choose this supplier"]') as HTMLButtonElement | null)?.disabled,
      getRfqCalls: mockGetRfq.mock.calls.length,
    };
    assertActual('Successful retry must clear the read error and restore eligible actions', actual, (state) =>
      !state.warning && state.cancelDisabled === false && state.selectDisabled === false && state.getRfqCalls === 3);
  });
});
