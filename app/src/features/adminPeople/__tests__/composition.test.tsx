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
let mockFlags: Record<string, unknown> = {};

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
jest.doMock('../../../lib/featureFlags', () => {
  const { isFeatureOn } = jest.requireActual<typeof import('../../../lib/featureFlagModel')>(
    '../../../lib/featureFlagModel',
  );
  return {
    useAppFeatureFlags: () => ({
      isOn: (key: string) => isFeatureOn(mockFlags, key),
    }),
  };
});
jest.doMock('../../../lib/phone', () => ({ formatPhone: (phone: string) => phone }));
jest.doMock('../../../theme', () => ({
  useTheme: () => ({ spacing: { xs: 4, sm: 8, md: 12 }, radii: { lg: 12 } }),
}));

const ReactRuntime = require('react') as typeof React;
const testAct = require('react').act as (callback: () => void | Promise<void>) => Promise<void>;
const { createRoot } = require('react-dom/client') as { createRoot: (container: Element) => TestRoot };
const AdminPeopleScreen = require('../../identityScreens/AdminPeopleScreen').default as React.ComponentType;
const AdminDocumentsScreen = require('../../identityScreens/AdminDocumentsScreen').default as React.ComponentType;

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

async function unmountCurrent() {
  if (root) await testAct(() => root?.unmount());
  container?.remove();
  root = undefined;
}

async function click(target: HTMLButtonElement) {
  await testAct(async () => {
    target.click();
    await flush();
  });
}

function button(label: string, parent: ParentNode = container): HTMLButtonElement {
  const match = [...parent.querySelectorAll('button')].find((item) => item.getAttribute('aria-label') === label);
  if (!match) throw new Error(`Missing button ${label}; DOM=${parent.textContent}`);
  return match as HTMLButtonElement;
}

function cardFor(name: string): HTMLElement {
  const match = [...container.querySelectorAll('section')].find((item) => item.textContent?.includes(name));
  if (!match) throw new Error(`Missing card ${name}; DOM=${container.textContent}`);
  return match as HTMLElement;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockInputChanges.clear();
  mockFlags = { oorva_brand: true, oorva_admin_ops_ux: true };
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
  await unmountCurrent();
});

describe('ID-T18 admin composition', () => {
  it('ID-QUEUE-FIRST places People search and review queue before the secondary Audit log', async () => {
    mockListProviders.mockResolvedValue([provider()]);
    await mount(AdminPeopleScreen);

    const search = container.querySelector('input[aria-label="Search"]');
    const filter = button('Review');
    const queueRow = cardFor('Provider One');
    const audit = button('Audit log');

    expect(search).not.toBeNull();
    expect(search!.compareDocumentPosition(filter) & 4).toBe(4);
    expect(filter.compareDocumentPosition(queueRow) & 4).toBe(4);
    expect(queueRow.compareDocumentPosition(audit) & 4).toBe(4);
  });

  it('ID-STATE-AXES keeps review, payout, readiness, availability, and stored reason independent', async () => {
    mockListProviders.mockResolvedValue([provider('approved', {
      kyc_status: 'verified',
      suspended: true,
      paused: true,
      go_live: {
        state: 'action_needed',
        reasons: [{ code: 'doc_missing', severity: 'action', detail: 'Upload the missing licence.' }],
        paused: true,
      },
    })]);
    await mount(AdminPeopleScreen);

    const row = cardFor('Provider One');
    expect(row.textContent).toContain('Admin review: approved');
    expect(row.textContent).toContain('Payout: account set up · verification verified');
    expect(row.textContent).toContain('Go-live readiness: action needed · Upload the missing licence.');
    expect(row.textContent).toContain('Availability: admin suspension on · provider pause on · online preference off');
    expect(row.textContent).toContain('Stored review note: Please update the provider profile.');
    expect([...row.querySelectorAll('button')].map((item) => item.getAttribute('aria-label'))).not.toContain('Approve');
    expect(button('Reject', row)).toBeTruthy();
    expect(button('Ask for changes', row)).toBeTruthy();
  });

  it('ID-DOC-CONTEXT-FIRST reviews one scoped credential with a private preview and confirmation', async () => {
    const scoped = documentItem();
    const general = documentItem({
      document_id: 'document-general',
      provider_name: 'General Provider',
      category_id: null,
      category_name: null,
      file_path: 'provider-2/general.pdf',
    });
    mockListDocumentQueue.mockResolvedValueOnce([scoped, general]).mockResolvedValueOnce([general]);
    mockConfirm.mockResolvedValue(true);
    await mount(AdminDocumentsScreen);

    const scopedCard = cardFor('Document Provider');
    const providerIndex = scopedCard.textContent?.indexOf('Document Provider') ?? -1;
    const categoryIndex = scopedCard.textContent?.indexOf('Category: Electrical') ?? -1;
    const typeIndex = scopedCard.textContent?.indexOf('Credential type: Trade licence') ?? -1;
    expect(container.textContent).toContain('Pending review queue · one credential per action');
    expect(providerIndex).toBeGreaterThanOrEqual(0);
    expect(categoryIndex).toBeGreaterThan(providerIndex);
    expect(typeIndex).toBeGreaterThan(categoryIndex);
    expect(scopedCard.textContent).toContain('Current expiry: 2027-12-01');
    expect(scopedCard.querySelector('input[aria-label="Expiry date (YYYY-MM-DD)"]')).not.toBeNull();
    expect(scopedCard.querySelector('input[aria-label="Reason (required to reject; at least 5 characters)"]')).not.toBeNull();
    expect(button('View private document', scopedCard)).toBeTruthy();
    expect(cardFor('General Provider').textContent).toContain('General credential');

    await click(button('View private document', scopedCard));
    expect(mockCreateSignedUrl).toHaveBeenCalledWith('provider-1/private.pdf');
    expect(mockOpenUrl).toHaveBeenCalledWith('https://private.example.test/signed');
    expect(container.textContent).not.toContain('https://private.example.test/signed');

    await click(button('Approve', scopedCard));
    expect(mockConfirm.mock.calls[0]?.[0].message).toContain('Category: Electrical');
    expect(mockConfirm.mock.calls[0]?.[0].message).toContain('Document Provider');
    expect(mockReviewDocument).toHaveBeenCalledTimes(1);
    expect(mockReviewDocument).toHaveBeenCalledWith('document-1', true, null, '2027-12-01');
    expect(container.textContent).not.toContain('Document Provider');
    expect(container.textContent).toContain('General Provider');
    expect(container.querySelectorAll('button[aria-label="Approve"]')).toHaveLength(1);
  });

  it('ID-ADMIN-FLAG-PARENTS keeps corrected legacy actions when the leaf or parent is off', async () => {
    const assertLegacyComposition = async () => {
      mockListProviders.mockResolvedValue([provider('approved')]);
      await mount(AdminPeopleScreen);
      const search = container.querySelector('input[aria-label="Search"]');
      const audit = button('Audit log');
      expect(search).not.toBeNull();
      expect(audit.compareDocumentPosition(search!) & 4).toBe(4);
      const peopleRow = cardFor('Provider One');
      expect([...peopleRow.querySelectorAll('button')].map((item) => item.getAttribute('aria-label'))).not.toContain('Approve');
      expect(button('Reject', peopleRow)).toBeTruthy();
      await unmountCurrent();

      mockListDocumentQueue.mockResolvedValue([documentItem({
        category_id: null,
        category_name: null,
      })]);
      await mount(AdminDocumentsScreen);
      const documentRow = cardFor('Document Provider');
      expect(container.textContent).not.toContain('Pending review queue');
      expect(documentRow.textContent).toContain('Scope: General (all categories)');
      expect(button('View document', documentRow)).toBeTruthy();
      expect(button('Approve', documentRow)).toBeTruthy();
      mockConfirm.mockResolvedValue(false);
      await click(button('Approve', documentRow));
      expect(mockConfirm).toHaveBeenCalledTimes(1);
      expect(mockReviewDocument).not.toHaveBeenCalled();
      await unmountCurrent();
    };

    mockFlags = { oorva_brand: false, oorva_admin_ops_ux: true };
    await assertLegacyComposition();

    mockFlags = { oorva_brand: true, oorva_admin_ops_ux: false };
    mockConfirm.mockReset().mockResolvedValue(false);
    await assertLegacyComposition();
  });
});
