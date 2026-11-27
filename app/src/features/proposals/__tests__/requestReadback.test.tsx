import React from 'react';

const mockApi = {
  getServiceRequest: jest.fn(),
  listRequestProposals: jest.fn(),
  cancelServiceRequest: jest.fn(),
};
const mockProposalApi = {
  getProposalViewState: jest.fn(),
  isActiveProposalBookingStatus: (status: string | null) => [
    'pending_payment', 'confirmed', 'accepted', 'en_route', 'in_progress',
    'delivery_pending', 'completion_requested', 'disputed',
  ].includes(status ?? ''),
};
const mockRouter = { back: jest.fn(), canGoBack: jest.fn(() => true), push: jest.fn(), replace: jest.fn() };
const mockConfirm = jest.fn(async () => true);
const mockToast = jest.fn();

jest.mock('expo-router', () => ({
  router: mockRouter,
  useLocalSearchParams: () => ({ id: 'request-1' }),
}));
jest.mock('../../../lib/api', () => mockApi);
jest.mock('../api', () => mockProposalApi);
jest.mock('../../../lib/auth', () => ({ useAuth: () => ({ userId: 'customer-1' }) }));
jest.mock('../../../lib/money', () => ({ formatINR: (value: number) => `₹${value}` }));
jest.mock('../../../lib/proposalStatus', () => ({ proposalStatus: () => ({ label: 'Accepted' }) }));
jest.mock('../../../components/market/QuoteCompareTable', () => {
  const ReactRuntime = require('react') as typeof React;
  return { QuoteCompareTable: () => ReactRuntime.createElement('div') };
});
jest.mock('../../serviceLifecycle/useFocusedServiceRefresh', () => {
  const ReactRuntime = require('react') as typeof React;
  return {
    useFocusedServiceRefresh(load: (guard: { isCurrent: () => boolean }) => Promise<void>, options: { contextKey: string }) {
      ReactRuntime.useEffect(() => {
        void load({ isCurrent: () => true });
      }, [load, options.contextKey]);
      return {
        refresh: ReactRuntime.useCallback(() => load({ isCurrent: () => true }), [load]),
        refreshing: false,
      };
    },
  };
}, { virtual: true });
jest.mock('react-native', () => ({ View: 'div' }));
jest.mock('../../../components/ui', () => {
  const ReactRuntime = require('react') as typeof React;
  const element = (name: string) => ({
    children,
    title,
    message,
    onPress,
    disabled,
    loading,
  }: {
    children?: React.ReactNode;
    title?: string;
    message?: string;
    onPress?: () => void;
    disabled?: boolean;
    loading?: boolean;
  }) => name === 'Button'
    ? ReactRuntime.createElement('button', { onClick: onPress, disabled: disabled || loading }, title)
    : ReactRuntime.createElement('div', null, title, message, children);
  return {
    Button: element('Button'),
    Card: element('Card'),
    EmptyState: element('EmptyState'),
    ErrorState: element('ErrorState'),
    Header: element('Header'),
    InlineAlert: element('InlineAlert'),
    Screen: ({ header, children }: { header?: React.ReactNode; children?: React.ReactNode }) =>
      ReactRuntime.createElement(ReactRuntime.Fragment, null, header, children),
    Section: element('Section'),
    Skeleton: () => ReactRuntime.createElement('div', null, 'Loading'),
    Text: element('Text'),
    useConfirm: () => mockConfirm,
    useToast: () => mockToast,
  };
});

const ReactRuntime = require('react') as typeof React;
const { JSDOM } = require('jsdom') as typeof import('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>');
Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
Object.defineProperty(globalThis, 'document', { configurable: true, value: dom.window.document });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const testAct = ReactRuntime.act as (callback: () => void | Promise<void>) => Promise<void>;
type TestRoot = { render: (element: React.ReactElement) => void; unmount: () => void };
let root: TestRoot | undefined;
let container: HTMLDivElement;

const request = (status: 'closed' | 'open') => ({
  id: 'request-1',
  status,
  expires_at: '2040-04-13T18:00:00.000Z',
  event_start: '2040-04-14T04:30:00.000Z',
  event_end: '2040-04-14T08:30:00.000Z',
  city: 'Pune',
  area: 'Central',
  categories: { name: 'Photography' },
  intake: {},
});

const proposal = () => ({
  id: 'proposal-1',
  request_id: 'request-1',
  provider_id: 'provider-1',
  version: 1,
  created_at: '2040-04-01T10:00:00.000Z',
  status: 'accepted',
  total: 100_000,
  valid_until: '2040-04-13T18:00:00.000Z',
  note: null,
  deliverables: [],
  proposal_items: [],
  proposal_schedule: [],
  providers: { profiles: { full_name: 'Provider' } },
});

function viewState(bookingStatus: string) {
  return {
    proposal_id: 'proposal-1',
    viewer_role: 'customer',
    request_status: 'closed',
    request_expires_at: '2040-04-13T18:00:00.000Z',
    current_booking_id: 'booking-1',
    current_booking_status: bookingStatus,
    current_booking_created_at: '2040-04-14T04:35:00.000Z',
    payment_hold_expires_at: '2040-04-14T05:05:00.000Z',
    delivery_status: 'not_applicable',
    can_accept: false,
    can_withdraw: false,
    can_send_new: false,
    can_message: true,
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function mount() {
  const { createRoot } = require('react-dom/client') as { createRoot: (node: Element) => TestRoot };
  const RequestDetailScreen = require('../../serviceScreens/RequestDetailScreen').default as
    typeof import('../../serviceScreens/RequestDetailScreen').default;
  await testAct(async () => {
    container = document.createElement('div');
    root = createRoot(container);
    root.render(ReactRuntime.createElement(RequestDetailScreen));
    await flush();
  });
}

async function clickButton(label: string) {
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent === label);
  if (!button) throw new Error(`Missing button ${label}; rendered=${container.textContent}`);
  await testAct(async () => {
    button.click();
    await flush();
  });
}

beforeEach(() => {
  mockApi.getServiceRequest.mockReset();
  mockApi.listRequestProposals.mockReset();
  mockApi.cancelServiceRequest.mockReset();
  mockProposalApi.getProposalViewState.mockReset();
  mockRouter.push.mockReset();
  mockConfirm.mockReset().mockResolvedValue(true);
  mockToast.mockReset();
});

afterEach(async () => {
  if (root) {
    await testAct(async () => {
      root?.unmount();
      await flush();
    });
  }
  root = undefined;
});

afterAll(() => dom.window.close());

describe('request booking hold readback', () => {
  it('manageActiveHoldInsteadOfRequestCancel', async () => {
    mockApi.getServiceRequest.mockResolvedValue(request('closed'));
    mockApi.listRequestProposals.mockResolvedValue([proposal()]);
    mockProposalApi.getProposalViewState.mockResolvedValue(viewState('pending_payment'));

    await mount();

    expect(container.textContent).toContain('Continue/Manage booking');
    expect(container.textContent).not.toContain('Cancel request');
    await clickButton('Continue/Manage booking');

    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/booking/[id]',
      params: { id: 'booking-1' },
    });
    expect(mockApi.cancelServiceRequest).not.toHaveBeenCalled();
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('keeps request cancellation available for closed requests with only cancelled booking history', async () => {
    mockApi.getServiceRequest.mockResolvedValue(request('closed'));
    mockApi.listRequestProposals.mockResolvedValue([proposal()]);
    mockProposalApi.getProposalViewState.mockResolvedValue(viewState('cancelled'));
    mockApi.cancelServiceRequest.mockResolvedValue(undefined);

    await mount();
    await clickButton('Cancel request');

    expect(mockApi.cancelServiceRequest).toHaveBeenCalledWith('request-1');
  });
});
