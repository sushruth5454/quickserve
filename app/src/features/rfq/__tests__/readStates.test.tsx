import React from 'react';

const mockRouter = { push: jest.fn(), replace: jest.fn() };
const mockListProductCategories = jest.fn();
const mockCreateRfq = jest.fn();
const mockListMySupplierRfqs = jest.fn();
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
  };
});
jest.doMock('react-native', () => ({ View: 'div' }));
jest.doMock('../../../components/ui', () => {
  const ReactModule = require('react') as typeof React;
  return {
    Button: ({ title, onPress, disabled, loading }: { title: string; onPress?: () => void; disabled?: boolean; loading?: boolean }) =>
      ReactModule.createElement('button', { type: 'button', 'aria-label': title, disabled: !!disabled || !!loading, onClick: onPress }, title),
    Card: ({ children }: { children: React.ReactNode }) => ReactModule.createElement('section', null, children),
    Chip: ({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) =>
      ReactModule.createElement('button', { type: 'button', 'aria-pressed': selected, onClick: onPress }, label),
    EmptyState: ({ title, message }: { title: string; message?: string }) =>
      ReactModule.createElement('section', { 'data-testid': 'empty' }, title, message),
    ErrorState: ({ title, message, onRetry }: { title?: string; message?: string | null; onRetry?: () => void }) =>
      ReactModule.createElement('section', { 'data-testid': 'error' }, title, message,
        onRetry ? ReactModule.createElement('button', { type: 'button', 'aria-label': 'Retry', onClick: onRetry }, 'Retry') : null),
    Header: ({ title }: { title: string }) => ReactModule.createElement('header', null, title),
    InlineAlert: ({ message }: { message?: string | null }) => message ? ReactModule.createElement('div', { role: 'alert' }, message) : null,
    Input: ({ label, value, onChangeText, disabled }: { label: string; value: string; onChangeText: (value: string) => void; disabled?: boolean }) => {
      mockInputChanges.set(label, onChangeText);
      return ReactModule.createElement('label', null, label, ReactModule.createElement('input', {
        'aria-label': label,
        value,
        disabled,
        onChange: (event: { currentTarget: { value: string } }) => onChangeText(event.currentTarget.value),
      }));
    },
    Screen: ({ children, header, footer }: { children: React.ReactNode; header?: React.ReactNode; footer?: React.ReactNode }) =>
      ReactModule.createElement('main', null, header, children, footer),
    Skeleton: () => ReactModule.createElement('div', { 'data-testid': 'skeleton' }, 'Loading'),
    Text: ({ children }: { children: React.ReactNode }) => ReactModule.createElement('span', null, children),
    TextArea: ({ label, value, onChangeText }: { label: string; value: string; onChangeText: (value: string) => void }) => {
      mockInputChanges.set(label, onChangeText);
      return ReactModule.createElement('label', null, label, ReactModule.createElement('textarea', {
        'aria-label': label,
        value,
        onChange: (event: { currentTarget: { value: string } }) => onChangeText(event.currentTarget.value),
      }));
    },
    useToast: () => jest.fn(),
  };
});
jest.doMock('../../shops/api', () => ({
  listProductCategories: (...args: unknown[]) => mockListProductCategories(...args),
  cleanSpecs: (value: unknown) => value,
}));
jest.doMock('../api', () => ({
  createRfq: (...args: unknown[]) => mockCreateRfq(...args),
  listMySupplierRfqs: (...args: unknown[]) => mockListMySupplierRfqs(...args),
}));
jest.doMock('../../shops/SpecFields', () => ({ SpecFields: () => React.createElement('div') }));
jest.doMock('../../shops/specs', () => ({ cleanSpecs: (value: unknown) => value }));
jest.doMock('../components', () => ({
  RfqFeatureUnavailable: () => React.createElement('div', null, 'Feature unavailable'),
  RfqStatusLabel: () => React.createElement('span'),
  useRfqFeatureFlags: () => ({ rfq: true, enquiries: true }),
}));
jest.doMock('../../../lib/locationContext', () => ({
  useSelectedLocation: () => ({ location: { city: 'Test City', area: 'Test Area', lat: 1, lng: 2 }, ready: true }),
}));
jest.doMock('../../../theme', () => ({ useTheme: () => ({ spacing: { xs: 4, sm: 8, md: 12 }, radii: { lg: 12 } }) }));

const RfqNewScreen = require('../../marketplaceScreens/RfqNewScreen').default as React.ComponentType;
const MerchantRfqsScreen = require('../../marketplaceScreens/MerchantRfqsScreen').default as React.ComponentType;
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
  mockListProductCategories.mockReset();
  mockCreateRfq.mockReset();
  mockListMySupplierRfqs.mockReset();
  mockCreateRfq.mockResolvedValue('rfq-1');
});

afterEach(async () => {
  if (root) await testAct(() => root?.unmount());
  container?.remove();
  root = undefined;
});

describe('RFQ read states', () => {
  it('MK-READ-RFQ-category-retry-draft preserves entered item values and blocks submit until category refresh succeeds', async () => {
    mockListProductCategories.mockRejectedValueOnce(new Error('category list unavailable')).mockResolvedValueOnce([
      { id: 'category-1', name: 'Tiles', slug: 'tiles', attribute_schema: { properties: {} } },
    ]);
    await mount(RfqNewScreen);
    const changeDescription = mockInputChanges.get('Description');
    if (!changeDescription) throw new Error('Description field was not rendered');
    await testAct(() => changeDescription('entered item description'));

    let actual: Record<string, unknown> = {
      error: container.querySelector('[data-testid="error"]')?.textContent ?? '',
      description: (container.querySelector('input[aria-label="Description"]') as HTMLInputElement | null)?.value ?? '',
      sendDisabled: (container.querySelector('button[aria-label="Send request"]') as HTMLButtonElement | null)?.disabled,
      createCalls: mockCreateRfq.mock.calls.length,
    };
    assertActual('Failed category lookup must keep the RFQ draft and disable unsafe submit', actual, (state) =>
      String(state.error).includes('category list unavailable') && state.description === 'entered item description'
      && state.sendDisabled === true && state.createCalls === 0);

    await press('Retry');
    actual = {
      error: container.querySelector('[data-testid="error"]')?.textContent ?? '',
      description: (container.querySelector('input[aria-label="Description"]') as HTMLInputElement | null)?.value ?? '',
      category: container.textContent?.includes('Tiles') ?? false,
      sendDisabled: (container.querySelector('button[aria-label="Send request"]') as HTMLButtonElement | null)?.disabled,
    };
    assertActual('Successful category retry must preserve entered items and refresh eligibility', actual, (state) =>
      !state.error && state.description === 'entered item description' && state.category === true && state.sendDisabled === false);
  });

  it('MK-READ-supplier-history-error offers retry instead of claiming no recent RFQs', async () => {
    mockListMySupplierRfqs.mockRejectedValueOnce(new Error('supplier RFQ history unavailable')).mockResolvedValueOnce([]);
    await mount(MerchantRfqsScreen);
    let actual: Record<string, unknown> = {
      error: container.querySelector('[data-testid="error"]')?.textContent ?? '',
      retry: !!container.querySelector('button[aria-label="Retry"]'),
      empty: container.querySelector('[data-testid="empty"]')?.textContent ?? '',
    };
    assertActual('Supplier history failure must not be interpreted as a successful empty list', actual, (state) =>
      String(state.error).includes('supplier RFQ history unavailable') && state.retry === true && !state.empty);

    await press('Retry');
    actual = {
      error: container.querySelector('[data-testid="error"]')?.textContent ?? '',
      empty: container.querySelector('[data-testid="empty"]')?.textContent ?? '',
      readCalls: mockListMySupplierRfqs.mock.calls.length,
    };
    assertActual('Successful empty supplier history should show its empty state', actual, (state) =>
      !state.error && String(state.empty).includes('No recent RFQs') && state.readCalls === 2);
  });
});
