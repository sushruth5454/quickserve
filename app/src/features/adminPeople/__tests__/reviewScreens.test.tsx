import type React from 'react';
import type { AdminDocumentQueueItem, AdminDocumentType, AdminProvider } from '../../../lib/adminApi';

const mockRouter = { push: jest.fn() };
const mockListProviders = jest.fn();
const mockSetProviderReview = jest.fn();
const mockSetProviderSuspended = jest.fn();
const mockListDocumentQueue = jest.fn();
const mockListDocumentTypes = jest.fn();
const mockReviewDocument = jest.fn();
const mockCreateSignedUrl = jest.fn();
const mockOpenUrl = jest.fn();
const mockConfirm = jest.fn();
const mockToast = jest.fn();
const mockInputChanges = new Map<string, (value: string) => void>();

const mockDom = new (require('jsdom').JSDOM)('<!doctype html><html><body></body></html>');
Object.defineProperty(globalThis, 'window', { configurable: true, value: mockDom.window });
Object.defineProperty(globalThis, 'document', { configurable: true, value: mockDom.window.document });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: mockDom.window.navigator });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.doMock('expo-router', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
  return {
    router: mockRouter,
    useFocusEffect(callback: () => void | (() => void)) {
      ReactModule.useEffect(() => {
        const cleanup = callback();
        return typeof cleanup === 'function' ? cleanup : undefined;
      }, [callback]);
    },
  };
});
jest.doMock('react-native', () => ({ View: 'div', Linking: { openURL: mockOpenUrl } }));
jest.doMock('../../../components/ui', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react');
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
    EmptyState: ({ title, message }: { title: string; message?: string }) =>
      ReactModule.createElement('section', { 'data-testid': 'empty' }, title, message),
    ErrorState: ({ message, onRetry }: { message: string; onRetry?: () => void }) =>
      ReactModule.createElement('section', { 'data-testid': 'error' }, message,
        onRetry ? ReactModule.createElement('button', { type: 'button', 'aria-label': 'Retry', onClick: onRetry }, 'Retry') : null),
    Header: ({ title, subtitle }: { title: string; subtitle?: string }) =>
      ReactModule.createElement('header', null, title, subtitle),
    InlineAlert: ({ message }: { message?: string | null }) => message
      ? ReactModule.createElement('div', { role: 'alert' }, message)
      : null,
    Input: ({ label, value, onChangeText }: {
      label: string;
      value: string;
      onChangeText: (value: string) => void;
    }) => {
      mockInputChanges.set(label, onChangeText);
      return ReactModule.createElement('label', null, label,
        ReactModule.createElement('input', { 'aria-label': label, value, onChange: () => undefined }));
    },
    Screen: ({ children, header }: { children: React.ReactNode; header?: React.ReactNode }) =>
      ReactModule.createElement('main', null, header, children),
    SegmentedControl: ({ options, value, onChange }: {
      options: Array<{ value: string; label: string }>;
      value: string;
      onChange: (value: string) => void;
    }) => ReactModule.createElement('nav', null, ...options.map((option) => ReactModule.createElement('button', {
      key: option.value,
      type: 'button',
      'aria-label': option.label,
      'aria-pressed': value === option.value,
      onClick: () => onChange(option.value),
    }, option.label))),
    Skeleton: () => ReactModule.createElement('div', { 'data-testid': 'skeleton' }, 'Loading'),
    Text: ({ children }: { children: React.ReactNode }) => ReactModule.createElement('span', null, children),
    useConfirm: () => mockConfirm,
    useToast: () => mockToast,
  };
});
jest.doMock('../../../lib/adminApi', () => ({
  listProviders: (...args: unknown[]) => mockListProviders(...args),
  setProviderReview: (...args: unknown[]) => mockSetProviderReview(...args),
  setProviderSuspended: (...args: unknown[]) => mockSetProviderSuspended(...args),
  listDocumentQueue: (...args: unknown[]) => mockListDocumentQueue(...args),
  listDocumentTypes: (...args: unknown[]) => mockListDocumentTypes(...args),
  reviewDocument: (...args: unknown[]) => mockReviewDocument(...args),
  createProviderDocumentSignedUrl: (...args: unknown[]) => mockCreateSignedUrl(...args),
}));
jest.doMock('../../../lib/phone', () => ({ formatPhone: (phone: string) => phone }));
jest.doMock('../../../lib/featureFlags', () => ({
  useAppFeatureFlags: () => ({ isOn: () => false }),
}));
jest.doMock('../../../theme', () => ({ useTheme: () => ({ spacing: { xs: 4, sm: 8, md: 12 }, radii: { lg: 12 } }) }));

const ReactRuntime = require('react') as typeof React;
const testAct = require('react').act as (callback: () => void | Promise<void>) => Promise<void>;
const { createRoot } = require('react-dom/client') as { createRoot: (container: Element) => TestRoot };
const AdminPeopleScreen = require('../../identityScreens/AdminPeopleScreen').default as React.ComponentType;
const AdminDocumentsScreen = require('../../identityScreens/AdminDocumentsScreen').default as React.ComponentType;
const mockLinking = require('react-native').Linking as { openURL: jest.Mock };

type TestRoot = { render: (element: React.ReactElement) => void; unmount: () => void };
let root: TestRoot | undefined;
let container: HTMLDivElement;

function provider(status: AdminProvider['admin_review_status'] = 'pending', overrides: Partial<AdminProvider> = {}): AdminProvider {
  return {
    id: 'provider-1',
    full_name: 'Provider One',
    phone: '+15551234567',
    city: 'Test City',
    kyc_status: 'pending',
    admin_review_status: status,
    has_payout_account: true,
    suspended: false,
    paused: false,
    is_online: false,
    rating_avg: 0,
    rating_count: 0,
    jobs_completed: 0,
    is_creator: false,
    categories: ['Electrical'],
    submitted_at: '2026-11-20T10:00:00.000Z',
    created_at: '2026-11-20T10:00:00.000Z',
    go_live: { state: 'under_review', reasons: [{ code: 'payout_pending', severity: 'wait', detail: 'Payout verification is pending.' }], paused: false },
    review_note: 'Please update the provider profile.',
    ...overrides,
  };
}

function documentItem(overrides: Partial<AdminDocumentQueueItem> = {}): AdminDocumentQueueItem {
  return {
    document_id: 'document-1',
    provider_id: 'provider-1',
    provider_name: 'Document Provider',
    doc_type: 'trade_licence',
    category_id: 'category-1',
    category_name: 'Electrical',
    file_path: 'provider-1/private.pdf',
    expires_on: '2027-12-01',
    created_at: '2026-11-20T10:00:00.000Z',
    ...overrides,
  };
}

const documentTypes: AdminDocumentType[] = [{ code: 'trade_licence', label: 'Trade licence', has_expiry: true }];

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
    root?.render(ReactRuntime.createElement(Component));
    await flush();
  });
}

function button(label: string, parent: ParentNode = container): HTMLButtonElement {
  const match = [...parent.querySelectorAll('button')].find((item) => item.getAttribute('aria-label') === label);
  if (!match) throw new Error(`Missing button ${label}; DOM=${parent.textContent}`);
  return match as HTMLButtonElement;
}

async function click(target: HTMLButtonElement) {
  await testAct(async () => {
    target.click();
    await flush();
  });
}

function cardFor(name: string): HTMLElement {
  const match = [...container.querySelectorAll('section')].find((item) => item.textContent?.includes(name));
  if (!match) throw new Error(`Missing card ${name}; DOM=${container.textContent}`);
  return match as HTMLElement;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockInputChanges.clear();
  mockConfirm.mockResolvedValue(false);
  mockListProviders.mockResolvedValue([]);
  mockSetProviderReview.mockResolvedValue(undefined);
  mockSetProviderSuspended.mockResolvedValue(undefined);
  mockListDocumentQueue.mockResolvedValue([]);
  mockListDocumentTypes.mockResolvedValue(documentTypes);
  mockReviewDocument.mockResolvedValue(undefined);
  mockCreateSignedUrl.mockResolvedValue('https://private.example.test/signed');
  mockOpenUrl.mockResolvedValue(undefined);
});

afterEach(async () => {
  if (root) await testAct(() => root?.unmount());
  container?.remove();
  root = undefined;
});

describe('ID-T11 admin review screens', () => {
  it('ID-REVIEW-CONFIRM-CANCEL requires reason, confirms, prevents duplicate prompts, and reads back the new state', async () => {
    mockListProviders
      .mockResolvedValueOnce([provider('pending')])
      .mockResolvedValueOnce([provider('approved', { review_note: null })]);
    await mount(AdminPeopleScreen);
    expect(container.textContent).toContain('Stored review note: Please update the provider profile.');
    expect(container.textContent).toContain('Payout: account set up · verification pending');
    expect(container.textContent).toContain('Go-live readiness: under review');
    expect(container.textContent).toContain('Availability: admin suspension off · provider pause off');
    expect(container.textContent).not.toContain('All 1');

    const pendingApprove = button('Approve');
    const pendingConfirm = deferred<boolean>();
    mockConfirm.mockReturnValueOnce(pendingConfirm.promise);
    await testAct(async () => {
      pendingApprove.click();
      pendingApprove.click();
      await flush();
    });
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockSetProviderReview).not.toHaveBeenCalled();
    pendingConfirm.resolve(false);
    await testAct(async () => { await flush(); });
    expect(mockSetProviderReview).not.toHaveBeenCalled();

    await testAct(async () => {
      mockInputChanges.get('Reason (required for Reject or Ask for changes)')?.('Needs a corrected licence');
    });
    mockConfirm.mockResolvedValueOnce(false);
    await click(button('Reject'));
    expect(mockSetProviderReview).not.toHaveBeenCalled();

    mockConfirm.mockResolvedValueOnce(true);
    await click(button('Approve'));
    expect(mockConfirm.mock.calls[mockConfirm.mock.calls.length - 1]?.[0].message).toContain('Payout verification and go-live readiness are separate');
    expect(mockSetProviderReview).toHaveBeenCalledWith('provider-1', 'approved', null);
    expect(mockListProviders).toHaveBeenCalledTimes(2);
    expect(button('Reject')).toBeTruthy();
    expect(button('Ask for changes')).toBeTruthy();
    expect(container.querySelectorAll('button[aria-label="Approve"]').length).toBe(0);
  });

  it('ID-SEARCH-RACE ignores older search and filter responses and has no filtered global counts', async () => {
    const allInitial = deferred<AdminProvider[]>();
    const allSearch = deferred<AdminProvider[]>();
    const pendingSearch = deferred<AdminProvider[]>();
    mockListProviders.mockImplementation((filter: string, search: string | null) => {
      if (filter === 'all' && search === null) return allInitial.promise;
      if (filter === 'all' && search === 'new') return allSearch.promise;
      if (filter === 'pending' && search === 'new') return pendingSearch.promise;
      return Promise.resolve([]);
    });
    await mount(AdminPeopleScreen);
    expect(container.querySelector('[data-testid="skeleton"]')).toBeTruthy();

    await testAct(async () => { mockInputChanges.get('Search')?.('new'); await flush(); });
    await click(button('Review'));
    expect(mockListProviders.mock.calls).toEqual([
      ['all', null],
      ['all', 'new'],
      ['pending', 'new'],
    ]);

    pendingSearch.resolve([provider('pending', { full_name: 'Latest Pending Provider' })]);
    await testAct(async () => { await flush(); });
    allInitial.resolve([provider('approved', { full_name: 'Stale Initial Provider' })]);
    allSearch.resolve([provider('rejected', { full_name: 'Stale Search Provider' })]);
    await testAct(async () => { await flush(); });

    expect(container.textContent).toContain('Latest Pending Provider');
    expect(container.textContent).not.toContain('Stale Initial Provider');
    expect(container.textContent).not.toContain('Stale Search Provider');
    expect(button('All').textContent).toBe('All');
    expect(button('Review').textContent).toBe('Review');
  });

  it('ID-EMPTY-RETRY keeps loading, error, and empty states distinct', async () => {
    mockListProviders.mockRejectedValueOnce(new Error('provider list unavailable')).mockResolvedValueOnce([]);
    await mount(AdminPeopleScreen);
    expect(container.querySelector('[data-testid="error"]')?.textContent).toContain('provider list unavailable');
    expect(container.querySelector('[data-testid="empty"]')).toBeNull();

    await click(button('Retry'));
    expect(container.querySelector('[data-testid="error"]')).toBeNull();
    expect(container.querySelector('[data-testid="empty"]')?.textContent).toContain('No providers found');
  });

  it('ID-DOCUMENT-SCOPE labels category and general documents and preserves signed private preview', async () => {
    const scoped = documentItem();
    const general = documentItem({
      document_id: 'document-general',
      provider_name: 'General Provider',
      category_id: null,
      category_name: 'General',
      file_path: 'provider-2/general.pdf',
    });
    mockListDocumentQueue.mockResolvedValue([scoped, general]);
    await mount(AdminDocumentsScreen);
    expect(container.textContent).toContain('Scope: Category: Electrical');
    expect(container.textContent).toContain('Scope: General (all categories)');

    const scopedCard = cardFor('Document Provider');
    await click(button('View document', scopedCard));
    expect(mockCreateSignedUrl).toHaveBeenCalledWith('provider-1/private.pdf');
    expect(mockLinking.openURL).toHaveBeenCalledWith('https://private.example.test/signed');

    await click(button('Approve', scopedCard));
    expect(mockConfirm.mock.calls[0]?.[0].message).toContain('Category: Electrical');
    expect(mockReviewDocument).not.toHaveBeenCalled();
    await click(button('Approve', cardFor('General Provider')));
    expect(mockConfirm.mock.calls[1]?.[0].message).toContain('General (all categories)');
  });

  it('ID-DOCUMENT-STALE rereads the pending queue after a stale server rejection', async () => {
    mockListDocumentQueue.mockResolvedValueOnce([documentItem()]).mockResolvedValueOnce([]);
    mockReviewDocument.mockRejectedValueOnce(new Error('document is not pending review'));
    mockConfirm.mockResolvedValue(true);
    await mount(AdminDocumentsScreen);
    await testAct(async () => {
      mockInputChanges.get('Reason (required to reject; at least 5 characters)')?.('Already reviewed');
    });
    await click(button('Reject', cardFor('Document Provider')));

    expect(mockReviewDocument).toHaveBeenCalledTimes(1);
    expect(mockListDocumentQueue).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain('Document Provider');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('document is not pending review');
  });

  it('ID-DOCUMENT-READBACK removes a pending document after the confirmed review succeeds', async () => {
    mockListDocumentQueue.mockResolvedValueOnce([documentItem()]).mockResolvedValueOnce([]);
    mockConfirm.mockResolvedValue(true);
    await mount(AdminDocumentsScreen);
    await click(button('Approve', cardFor('Document Provider')));

    expect(mockReviewDocument).toHaveBeenCalledWith('document-1', true, null, '2027-12-01');
    expect(mockListDocumentQueue).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain('Document Provider');
    expect(container.querySelector('[data-testid="empty"]')?.textContent).toContain('No provider documents waiting for review');
  });
});
