import React from 'react';

const mockApi = {
  getProposal: jest.fn(),
  withdrawProposal: jest.fn(),
  getServiceRequest: jest.fn(),
  listRequestProposals: jest.fn(),
  cancelServiceRequest: jest.fn(),
};
const mockProposalApi = {
  getProposalViewState: jest.fn(),
  getProposalFeePreview: jest.fn(),
  getCreatorProposalConfig: jest.fn(),
  acceptProposalWithFeePreview: jest.fn(),
  proposalWithDeliveryDate: jest.fn(() => null),
};

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), canGoBack: jest.fn(() => true), push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ id: 'proposal-1' }),
}));
jest.mock('../../../lib/api', () => mockApi);
jest.mock('../api', () => mockProposalApi);
jest.mock('../../../lib/auth', () => ({ useAuth: () => ({ userId: 'customer-1' }) }));
jest.mock('../../../lib/locationContext', () => ({ useSelectedLocation: () => ({ location: { addressId: 'address-1' } }) }));
jest.mock('../../../lib/payments', () => ({ usePayment: () => jest.fn(async () => 'paid') }));
jest.mock('../../../lib/proposalStatus', () => ({
  deliverableLabel: (value: string) => value,
  dueRuleLabel: (value: string) => value,
  proposalStatus: () => ({ label: 'Sent' }),
  proposalWithDeliveryDate: () => null,
}));
jest.mock('../../../lib/money', () => ({ formatINR: (value: number) => `₹${value}` }));
jest.mock('../../../components/market/QuoteCompareTable', () => ({ QuoteCompareTable: 'div' }));
jest.mock('../RequestQuestionThread', () => ({ RequestQuestionThread: 'div' }));
jest.mock('../../serviceLifecycle/useFocusedServiceRefresh', () => {
  const ReactRuntime = require('react') as typeof React;
  return {
    useFocusedServiceRefresh(load: (guard: { isCurrent: () => boolean }) => Promise<void>, options: { contextKey: string }) {
      ReactRuntime.useEffect(() => {
        void load({ isCurrent: () => true });
      }, [load, options.contextKey]);
      return {
        refresh: ReactRuntime.useCallback(
          () => load({ isCurrent: () => true }),
          [load],
        ),
        refreshing: false,
      };
    },
  };
}, { virtual: true });
jest.mock('react-native', () => ({ Pressable: 'div', View: 'div' }));
jest.mock('../../../components/ui', () => {
  const ReactRuntime = require('react') as typeof React;
  const element = (name: string) => ({ children, title, message, onPress, onRetry, disabled, loading }: {
    children?: React.ReactNode;
    title?: string;
    message?: string;
    onPress?: () => void;
    onRetry?: () => void;
    disabled?: boolean;
    loading?: boolean;
  }) => {
    if (name === 'ErrorState') {
      return ReactRuntime.createElement(
        'div',
        null,
        ReactRuntime.createElement('span', null, message),
        ReactRuntime.createElement('button', { onClick: onRetry }, 'Retry'),
      );
    }
    if (name === 'Button') {
      return ReactRuntime.createElement(
        'button',
        { onClick: onPress, disabled: disabled || loading },
        title,
      );
    }
    return ReactRuntime.createElement('div', null, title, message, children);
  };
  return {
    Button: element('Button'),
    Card: element('Card'),
    EmptyState: element('EmptyState'),
    ErrorState: element('ErrorState'),
    Header: element('Header'),
    InlineAlert: element('InlineAlert'),
    Screen: ({ header, footer, children }: { header?: React.ReactNode; footer?: React.ReactNode; children?: React.ReactNode }) =>
      ReactRuntime.createElement(ReactRuntime.Fragment, null, header, children, footer),
    Section: element('Section'),
    Skeleton: () => ReactRuntime.createElement('div', null, 'Loading'),
    Text: element('Text'),
    TextArea: element('textarea'),
    useConfirm: () => jest.fn(async () => true),
    useToast: () => jest.fn(),
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

function proposal() {
  return {
    id: 'proposal-1',
    request_id: 'request-1',
    provider_id: 'provider-1',
    status: 'sent',
    total: 100_000,
    valid_until: '2027-01-15T12:00:00.000Z',
    note: null,
    deliverables: [],
    proposal_items: [],
    proposal_schedule: [],
    providers: { profiles: { full_name: 'Provider' } },
  };
}

function viewState(viewerRole: 'customer' | 'owner') {
  return {
    viewer_role: viewerRole,
    can_accept: viewerRole === 'customer',
    can_withdraw: false,
    can_send_new: false,
    can_message: false,
    current_booking_id: null,
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function mount(element: React.ReactElement) {
  const { createRoot } = require('react-dom/client') as { createRoot: (node: Element) => TestRoot };
  await testAct(async () => {
    container = document.createElement('div');
    root = createRoot(container);
    root.render(element);
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
  mockApi.getProposal.mockReset();
  mockApi.withdrawProposal.mockReset();
  mockApi.getServiceRequest.mockReset();
  mockApi.listRequestProposals.mockReset();
  mockApi.cancelServiceRequest.mockReset();
  mockProposalApi.getProposalViewState.mockReset();
  mockProposalApi.getProposalFeePreview.mockReset();
  mockProposalApi.getCreatorProposalConfig.mockReset();
  mockProposalApi.acceptProposalWithFeePreview.mockReset();
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

describe('service detail readback', () => {
  it('retryClearsErrorAndFee after the first proposal read fails', async () => {
    mockApi.getProposal.mockRejectedValueOnce(new Error('Temporary proposal read failure')).mockResolvedValue(proposal());
    mockProposalApi.getProposalViewState.mockResolvedValue(viewState('customer'));
    mockProposalApi.getProposalFeePreview.mockResolvedValue({ platform_fee: 2_900, total_today: 25_000 });

    const ProposalDetailScreen = require('../../serviceScreens/ProposalDetailScreen').default as
      typeof import('../../serviceScreens/ProposalDetailScreen').default;
    await mount(ReactRuntime.createElement(ProposalDetailScreen));
    expect(container.textContent).toContain('Temporary proposal read failure');

    await clickButton('Retry');

    expect(container.textContent).not.toContain('Temporary proposal read failure');
    expect(container.textContent).toContain('Platform fee');
    expect(mockProposalApi.getProposalFeePreview).toHaveBeenCalledTimes(1);
  });

  it('reloads provider proposal configuration when retrying the full read', async () => {
    mockApi.getProposal.mockRejectedValueOnce(new Error('Temporary proposal read failure')).mockResolvedValue(proposal());
    mockProposalApi.getProposalViewState.mockResolvedValue(viewState('owner'));
    mockProposalApi.getCreatorProposalConfig.mockResolvedValue({ defaultRevisions: 4, maxAdvanceBp: 2_500 });

    const ProposalDetailScreen = require('../../serviceScreens/ProposalDetailScreen').default as
      typeof import('../../serviceScreens/ProposalDetailScreen').default;
    await mount(ReactRuntime.createElement(ProposalDetailScreen));
    await clickButton('Retry');

    expect(mockProposalApi.getCreatorProposalConfig).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Revisions included: 4');
  });

  it('renders an unavailable state when an authorized request read returns null', async () => {
    mockApi.getServiceRequest.mockResolvedValue(null);
    mockApi.listRequestProposals.mockResolvedValue([]);

    const RequestDetailScreen = require('../../serviceScreens/RequestDetailScreen').default as
      typeof import('../../serviceScreens/RequestDetailScreen').default;
    await mount(ReactRuntime.createElement(RequestDetailScreen));

    expect(container.textContent).toContain('Request unavailable');
    expect(container.textContent).not.toContain('Loading');
  });
});
