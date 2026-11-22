import type React from 'react';
import type { ProviderServiceWithProvider } from '../../../lib/api';
import type { ServicePackage } from '../../../lib/types';

type MockEffect = {
  deps: readonly unknown[] | undefined;
  cleanup: (() => void) | undefined;
};

const mockRuntime: {
  params: Record<string, string | undefined>;
  location: {
    addressId: string | null;
    city: string;
    line1: string | null;
    lat: number;
    lng: number;
    label: string | null;
  };
  recurringEnabled: boolean;
  archetypes: Record<string, boolean>;
  hookIndex: number;
  states: unknown[];
  pendingEffects: Array<{ index: number; effect: () => void | (() => void); deps: readonly unknown[] | undefined }>;
  effects: MockEffect[];
} = {
  params: {},
  location: { addressId: null, city: 'City A', line1: null, lat: 10, lng: 20, label: null },
  recurringEnabled: true,
  archetypes: { fixed: true, time_based: true },
  hookIndex: 0,
  states: [],
  pendingEffects: [],
  effects: [],
};

jest.mock('react', () => {
  const actual = jest.requireActual<typeof import('react')>('react');
  return {
    ...actual,
    useMemo: (factory: () => unknown) => {
      mockRuntime.hookIndex++;
      return factory();
    },
    useState: (initial: unknown) => {
      const index = mockRuntime.hookIndex++;
      if (!(index in mockRuntime.states)) mockRuntime.states[index] = initial;
      return [
        mockRuntime.states[index],
        (next: unknown) => {
          mockRuntime.states[index] = typeof next === 'function'
            ? (next as (previous: unknown) => unknown)(mockRuntime.states[index])
            : next;
        },
      ];
    },
    useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
      mockRuntime.pendingEffects.push({ index: mockRuntime.hookIndex++, effect, deps });
    },
  };
});

jest.mock('react-native', () => ({
  Pressable: 'Pressable',
  TextInput: 'TextInput',
  View: 'View',
}));
jest.mock('expo-router', () => ({
  router: {
    back: jest.fn(),
    canGoBack: () => true,
    push: jest.fn(),
    replace: jest.fn(),
  },
  useLocalSearchParams: () => mockRuntime.params,
}));
jest.mock('../../../components/market/BookingStepLayout', () => ({ BookingStepLayout: 'BookingStepLayout' }));
jest.mock('../../../components/market/PriceFooter', () => ({ PriceFooter: 'PriceFooter' }));
jest.mock('../../../components/ui', () => ({
  Button: 'Button',
  Card: 'Card',
  ErrorState: 'ErrorState',
  Header: 'Header',
  InlineAlert: 'InlineAlert',
  Screen: 'Screen',
  Skeleton: 'Skeleton',
  Text: 'Text',
  TextArea: 'TextArea',
  useToast: () => jest.fn(),
}));
jest.mock('../../../i18n', () => ({ useT: () => (value: string) => value }));
jest.mock('../../../lib/api', () => ({ getProviderService: jest.fn() }));
jest.mock('../../../lib/fixedBooking', () => ({ listFixedPackages: jest.fn() }));
jest.mock('../../../lib/featureFlags', () => ({
  useAppFeatureFlags: () => ({
    archetypes: mockRuntime.archetypes,
    isOn: () => false,
  }),
  useFeature: () => mockRuntime.recurringEnabled,
}));
jest.mock('../../../lib/locationContext', () => ({
  useSelectedLocation: () => ({ location: mockRuntime.location }),
}));
jest.mock('../../../lib/money', () => ({ formatINR: (value: number) => `₹${value}` }));
jest.mock('../../../lib/schedule', () => ({
  istDateKey: (date: Date) => date.toISOString().slice(0, 10),
  nextDays: () => Array.from({ length: 31 }, (_, index) => ({
    date: new Date(Date.UTC(2027, 0, index + 1)),
  })),
  WINDOW_START_HOURS: [8, 9],
}));
jest.mock('../../../theme', () => ({
  useTheme: () => ({
    spacing: { xs: 4, sm: 8, md: 16, lg: 24 },
    radii: { md: 8, lg: 16 },
    colors: { border: '#ccc', text: '#111', primary: '#00f', primaryText: '#fff' },
  }),
}));
jest.mock('../../booking/book/model', () => ({ getBookingStepKeys: () => null }));
jest.mock('../api', () => ({
  createRecurringPlan: jest.fn(),
  quoteRecurringPlan: jest.fn(),
}));
jest.mock('../customerPresentation', () => ({
  getRecurringEndDateOptions: () => ({ monthLabel: 'January 2027', dates: [] }),
  getRecurringQuoteSummary: (quote: Record<string, unknown>) => ({
    perVisitPaise: quote.per_visit_paise,
    visitsTotal: quote.visits_total,
    discountPaise: quote.discount_paise,
    platformFeePaise: quote.platform_fee_paise,
    gstPaise: quote.gst_paise,
    totalPaisePerCycle: quote.total_paise_per_cycle,
    billingFrequency: quote.billing_frequency,
    firstDates: quote.first_dates,
    acceptanceMode: quote.acceptance_mode,
    paymentDueHoursBefore: null,
    billingGraceHours: null,
    paymentReleaseCutoffMinutesBeforeVisit: null,
  }),
  recurringFourWeekEstimate: () => null,
  visibleBillingFrequencies: () => ['per_visit'],
}));

const ReactRuntime = require('react') as typeof React;
const { getProviderService } = require('../../../lib/api') as { getProviderService: jest.Mock };
const { listFixedPackages } = require('../../../lib/fixedBooking') as { listFixedPackages: jest.Mock };
const { createRecurringPlan, quoteRecurringPlan } = require('../api') as {
  createRecurringPlan: jest.Mock;
  quoteRecurringPlan: jest.Mock;
};
const NewRecurringPlanScreen = require('../../serviceScreens/RecurringNewDetailScreen').default as
  typeof import('../../serviceScreens/RecurringNewDetailScreen').default;

const quoteResult = {
  per_visit_paise: 10_000,
  visits_in_first_cycle: 1,
  visits_total: 1,
  discount_bp: 0,
  discount_paise: 0,
  platform_fee_paise: 500,
  gst_paise: 0,
  total_paise_per_cycle: 10_500,
  billing_frequency: 'per_visit',
  first_dates: ['2027-01-02'],
  acceptance_mode: 'occurrence',
};

function service(
  id: string,
  archetype: 'fixed' | 'time_based' = 'fixed',
  recurrenceAllowed = true,
): ProviderServiceWithProvider {
  return {
    id,
    provider_id: `provider-${id}`,
    category_id: `category-${id}`,
    visit_fee: 0,
    labour_rate: 600,
    rate_unit: 'hour',
    skill_level: 'skilled',
    active: true,
    categories: {
      name: `Category ${id}`,
      slug: `category-${id}`,
      archetype,
      recurrence_allowed: recurrenceAllowed,
      allowed_frequencies: ['weekly'],
    },
    service_packages: [],
    providers: { rating_avg: 5, rating_count: 1, profiles: { full_name: `Provider ${id}` } },
  } as unknown as ProviderServiceWithProvider;
}

function servicePackage(
  id: string,
  serviceId: string,
  values: Partial<ServicePackage> = {},
): ServicePackage {
  return {
    id,
    provider_service_id: serviceId,
    package_template_id: null,
    title: `Package ${id}`,
    description: '',
    price_type: 'fixed',
    price: 1000,
    price_min: 1000,
    price_max: 1000,
    unit: 'job',
    qty_min: 1,
    qty_max: 1,
    duration_min: 60,
    inclusions: [],
    exclusions: [],
    deliverables: [],
    turnaround_days: null,
    revisions_included: 0,
    raw_files_included: false,
    usage_rights: {},
    travel_included_km: 0,
    active: true,
    sort_order: 0,
    created_at: '2027-01-01T00:00:00.000Z',
    updated_at: '2027-01-01T00:00:00.000Z',
    ...values,
  };
}

function renderScreen() {
  mockRuntime.hookIndex = 0;
  mockRuntime.pendingEffects = [];
  const tree = NewRecurringPlanScreen();
  for (const pending of mockRuntime.pendingEffects) {
    const previous = mockRuntime.effects[pending.index];
    const changed = !previous ||
      !pending.deps ||
      !previous.deps ||
      pending.deps.length !== previous.deps.length ||
      pending.deps.some((value, index) => !Object.is(value, previous.deps?.[index]));
    if (!changed) continue;
    previous?.cleanup?.();
    const cleanup = pending.effect();
    mockRuntime.effects[pending.index] = {
      deps: pending.deps,
      cleanup: typeof cleanup === 'function' ? cleanup : undefined,
    };
  }
  return tree;
}

function elements(node: unknown, type: string): Array<React.ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.flatMap((child) => elements(child, type));
  if (!ReactRuntime.isValidElement(node)) return [];
  const element = node as React.ReactElement<Record<string, unknown>>;
  return [
    ...(element.type === type ? [element] : []),
    ...elements(element.props.children, type),
    ...elements(element.props.footer, type),
    ...elements(element.props.above, type),
  ];
}

function textContent(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join(' ');
  if (!ReactRuntime.isValidElement(node)) return '';
  return textContent((node as React.ReactElement<Record<string, unknown>>).props.children);
}

function sendButton(tree: unknown) {
  return elements(tree, 'Button').find((element) =>
    String(element.props.title ?? '').startsWith('Send request to '),
  );
}

function button(tree: unknown, title: string) {
  return elements(tree, 'Button').find((element) => element.props.title === title);
}

function packageCard(tree: unknown, packageTitle: string) {
  return elements(tree, 'Pressable').find((element) => textContent(element).includes(packageTitle));
}

function assertState(condition: boolean, label: string, actual: unknown) {
  if (!condition) throw new Error(`${label}: ${JSON.stringify(actual)}`);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function settle(rounds = 5) {
  for (let index = 0; index < rounds; index++) {
    await Promise.resolve();
    renderScreen();
  }
}

async function readyScreen(
  params: Record<string, string | undefined>,
  packages: ServicePackage[],
  archetype: 'fixed' | 'time_based' = 'fixed',
) {
  mockRuntime.params = { providerServiceId: 'service-a', description: 'Please call on arrival', ...params };
  getProviderService.mockResolvedValue(service('service-a', archetype));
  listFixedPackages.mockResolvedValue(packages);
  renderScreen();
  await settle();
  return renderScreen();
}

async function requestQuote(tree: unknown) {
  const weekday = button(tree, 'Mon');
  assertState(!!weekday, 'weekly choice exists', { title: weekday?.props.title });
  (weekday!.props.onPress as () => void)();
  renderScreen();
  await jest.advanceTimersByTimeAsync(350);
  await settle();
  return renderScreen();
}

beforeEach(() => {
  for (const effect of mockRuntime.effects) effect.cleanup?.();
  mockRuntime.params = {};
  mockRuntime.location = {
    addressId: 'address-a',
    city: 'City A',
    line1: '10 Main Street',
    lat: 10,
    lng: 20,
    label: 'Home',
  };
  mockRuntime.recurringEnabled = true;
  mockRuntime.archetypes = { fixed: true, time_based: true };
  mockRuntime.hookIndex = 0;
  mockRuntime.states = [];
  mockRuntime.pendingEffects = [];
  mockRuntime.effects = [];
  getProviderService.mockReset();
  listFixedPackages.mockReset();
  createRecurringPlan.mockReset().mockResolvedValue('plan-a');
  quoteRecurringPlan.mockReset().mockResolvedValue(quoteResult);
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('recurring creation readiness', () => {
  it('SV-RECURRING-ROUTE-01 loads fixed packages without a hint and filters foreign-service packages', async () => {
    const ownPackage = servicePackage('package-a', 'service-a', {
      title: 'Own package',
      qty_min: 2,
      qty_max: 5,
    });
    const foreignPackage = servicePackage('package-foreign', 'service-other', { title: 'Foreign package' });
    let tree = await readyScreen({}, [ownPackage, foreignPackage]);
    tree = await requestQuote(tree);
    const input = quoteRecurringPlan.mock.calls[0]?.[0];
    const buttonDisabled = sendButton(tree)?.props.disabled;
    const actual = {
      packageLoadCalls: listFixedPackages.mock.calls,
      visiblePackageTitles: elements(tree, 'Text').map((item) => textContent(item)).filter(Boolean),
      input,
      buttonDisabled,
    };
    assertState(
      listFixedPackages.mock.calls.some(([serviceId]) => serviceId === 'service-a') &&
        actual.visiblePackageTitles.some((title) => title.includes('Own package')) &&
        !actual.visiblePackageTitles.some((title) => title.includes('Foreign package')) &&
        input?.archetype === 'fixed' &&
        input?.package_id === 'package-a' &&
        input?.package_qty === 2 &&
        buttonDisabled === false,
      'no-hint fixed service quotes only its owned package at the server minimum quantity',
      actual,
    );
  });

  it('SV-RECURRING-ROUTE-01 uses the loaded category rather than a forged route archetype', async () => {
    const ownPackage = servicePackage('package-a', 'service-a', { title: 'Fixed package' });
    let tree = await readyScreen({ archetype: 'time_based' }, [ownPackage]);
    tree = await requestQuote(tree);
    const actual = {
      packageLoadCalls: listFixedPackages.mock.calls,
      visibleFixedSection: elements(tree, 'Text').some((item) => textContent(item).includes('Package and quantity')),
      quoteInput: quoteRecurringPlan.mock.calls[0]?.[0],
    };
    assertState(
      actual.packageLoadCalls.some(([serviceId]) => serviceId === 'service-a') &&
        actual.visibleFixedSection &&
        actual.quoteInput?.archetype === 'fixed',
      'route archetype cannot override the loaded fixed category',
      actual,
    );
  });

  it.each([
    ['clamps below the package minimum', '0', 2],
    ['clamps above the package maximum', '99', 5],
    ['preserves a valid requested quantity', '3', 3],
    ['preserves valid fractional package quantity', '2.5', 2.5],
  ])('%s', async (_label, packageQty, expectedQuantity) => {
    const ownPackage = servicePackage('package-a', 'service-a', {
      qty_min: 2,
      qty_max: 5,
    });
    let tree = await readyScreen({ packageId: 'package-a', packageQty: String(packageQty) }, [ownPackage]);
    tree = await requestQuote(tree);
    const actual = {
      requestedQuantity: packageQty,
      expectedQuantity,
      quoteInput: quoteRecurringPlan.mock.calls[0]?.[0],
      requestDisabled: sendButton(tree)?.props.disabled,
    };
    assertState(
      actual.quoteInput?.package_qty === expectedQuantity && actual.requestDisabled === false,
      'requested package quantity remains within server package bounds',
      actual,
    );
  });

  it('rejects a package hint that belongs to another service', async () => {
    const ownPackage = servicePackage('package-a', 'service-a', { title: 'Owned package' });
    const foreignPackage = servicePackage('package-foreign', 'service-other', { title: 'Foreign package' });
    const tree = await readyScreen({ packageId: 'package-foreign' }, [ownPackage, foreignPackage]);
    const actual = {
      packages: elements(tree, 'Text').map((item) => textContent(item)).filter(Boolean),
      requestDisabled: sendButton(tree)?.props.disabled,
      packageCalls: listFixedPackages.mock.calls,
      quoteCalls: quoteRecurringPlan.mock.calls,
    };
    assertState(
      !actual.packages.some((title) => title.includes('Foreign package')) &&
        actual.requestDisabled === true &&
        actual.quoteCalls.length === 0,
      'foreign package hint cannot become a quote or send selection',
      actual,
    );
  });

  it('surfaces explicit service load failures', async () => {
    getProviderService.mockRejectedValue(new Error('Service load unavailable.'));
    mockRuntime.params = { providerServiceId: 'service-load-error' };
    renderScreen();
    await settle();
    const tree = renderScreen();
    const actual = {
      loadErrors: elements(tree, 'ErrorState').map((item) => item.props.message),
      packageCalls: listFixedPackages.mock.calls,
      quoteCalls: quoteRecurringPlan.mock.calls,
    };
    assertState(
      actual.loadErrors.includes('Service load unavailable.') &&
        actual.packageCalls.length === 0 &&
        actual.quoteCalls.length === 0,
      'service load failure is visible and cannot start package or quote work',
      actual,
    );
  });

  it('SV-RECURRING-ADDRESS-02 invalidates readiness when address eligibility changes', async () => {
    const ownPackage = servicePackage('package-a', 'service-a');
    let tree = await readyScreen({}, [ownPackage]);
    await requestQuote(tree);
    mockRuntime.location = {
      ...mockRuntime.location,
      addressId: 'address-unsupported',
      city: 'Unsupported City',
      line1: '20 New Street',
    };
    quoteRecurringPlan.mockImplementation((input: { address_id: string }) =>
      input.address_id === 'address-a'
        ? Promise.resolve(quoteResult)
        : Promise.reject(new Error('This service is not available in the selected city.')),
    );
    tree = renderScreen();
    const disabledBeforeFreshQuote = sendButton(tree)?.props.disabled;
    await jest.advanceTimersByTimeAsync(350);
    await settle();
    tree = renderScreen();
    const actual = {
      quoteAddresses: quoteRecurringPlan.mock.calls.map(([input]) => input.address_id),
      disabledBeforeFreshQuote,
      disabledAfterUnsupportedQuote: sendButton(tree)?.props.disabled,
      quoteErrorVisible: elements(tree, 'InlineAlert').some((item) =>
        item.props.title === 'Could not get a quote' &&
        String(item.props.message ?? '').includes('selected city'),
      ),
      quoteCalls: quoteRecurringPlan.mock.calls.length,
    };
    await (sendButton(tree)?.props.onPress as (() => Promise<void>) | undefined)?.();
    actual.quoteCalls = quoteRecurringPlan.mock.calls.length;
    assertState(
      actual.quoteAddresses.includes('address-unsupported') &&
        actual.disabledBeforeFreshQuote === true &&
        actual.disabledAfterUnsupportedQuote === true &&
        actual.quoteErrorVisible &&
        createRecurringPlan.mock.calls.length === 0,
      'unsupported address cannot reuse the previous quote or submit readiness',
      { ...actual, createCalls: createRecurringPlan.mock.calls },
    );
  });

  it('surfaces explicit recurring send failures', async () => {
    const ownPackage = servicePackage('package-a', 'service-a');
    let tree = await readyScreen({}, [ownPackage]);
    tree = await requestQuote(tree);
    createRecurringPlan.mockRejectedValue(new Error('Plan send unavailable.'));
    const action = sendButton(tree);
    assertState(!!action, 'send action exists after a current quote', {
      sendTitle: action?.props.title,
      disabled: action?.props.disabled,
    });
    await (action!.props.onPress as () => Promise<void>)();
    await settle();
    tree = renderScreen();
    const actual = {
      sendErrors: elements(tree, 'InlineAlert')
        .filter((item) => item.props.title === 'Could not send request')
        .map((item) => item.props.message),
      createCalls: createRecurringPlan.mock.calls,
    };
    assertState(
      actual.sendErrors.includes('Plan send unavailable.') &&
        actual.createCalls.length === 1,
      'send failure is visible without losing the current quote context',
      actual,
    );
  });

  it('staleResponseIgnored does not restore an address quote after the address changes', async () => {
    const oldQuote = deferred<typeof quoteResult>();
    const freshQuote = deferred<typeof quoteResult>();
    quoteRecurringPlan.mockImplementation((input: { address_id: string }) =>
      input.address_id === 'address-a' ? oldQuote.promise : freshQuote.promise,
    );
    const ownPackage = servicePackage('package-a', 'service-a');
    let tree = await readyScreen({}, [ownPackage]);
    const weekday = button(tree, 'Mon');
    (weekday!.props.onPress as () => void)();
    tree = renderScreen();
    await jest.advanceTimersByTimeAsync(350);
    mockRuntime.location = {
      ...mockRuntime.location,
      addressId: 'address-b',
      city: 'City B',
      line1: '20 Main Street',
    };
    tree = renderScreen();
    await jest.advanceTimersByTimeAsync(350);
    oldQuote.resolve(quoteResult);
    await settle();
    tree = renderScreen();
    const actual = {
      quoteAddresses: quoteRecurringPlan.mock.calls.map(([input]) => input.address_id),
      requestDisabled: sendButton(tree)?.props.disabled,
      visiblePrice: elements(tree, 'Text').some((item) => textContent(item).includes('per visit')),
      createCalls: createRecurringPlan.mock.calls,
    };
    await (sendButton(tree)?.props.onPress as (() => Promise<void>) | undefined)?.();
    assertState(
      actual.quoteAddresses.includes('address-a') &&
        actual.quoteAddresses.includes('address-b') &&
        actual.requestDisabled === true &&
        !actual.visiblePrice &&
        createRecurringPlan.mock.calls.length === 0,
      'old address quote cannot enable send after eligibility context changes',
      { ...actual, createCalls: createRecurringPlan.mock.calls },
    );
  });

  it('staleResponseIgnored ignores a quote that resolves after the selected package changes', async () => {
    const packageAQuote = deferred<typeof quoteResult>();
    const packageBQuote = deferred<typeof quoteResult>();
    const packageA = servicePackage('package-a', 'service-a', { title: 'Package A' });
    const packageB = servicePackage('package-b', 'service-a', { title: 'Package B', price: 2500, price_min: 2500, price_max: 2500 });
    quoteRecurringPlan.mockImplementation((input: { package_id: string }) =>
      input.package_id === 'package-a' ? packageAQuote.promise : packageBQuote.promise,
    );
    let tree = await readyScreen({}, [packageA, packageB]);
    const weekday = button(tree, 'Mon');
    (weekday!.props.onPress as () => void)();
    tree = renderScreen();
    await jest.advanceTimersByTimeAsync(350);
    const secondPackage = packageCard(tree, 'Package B');
    assertState(!!secondPackage, 'second owned package is selectable', { packageBVisible: !!secondPackage });
    (secondPackage!.props.onPress as () => void)();
    tree = renderScreen();
    await jest.advanceTimersByTimeAsync(350);
    packageAQuote.resolve(quoteResult);
    await settle();
    tree = renderScreen();
    const staleState = {
      quoteInputs: quoteRecurringPlan.mock.calls.map(([input]) => ({
        provider_service_id: input.provider_service_id,
        package_id: input.package_id,
        address_id: input.address_id,
      })),
      requestDisabled: sendButton(tree)?.props.disabled,
    };
    assertState(staleState.requestDisabled === true, 'prior package quote cannot enable send', staleState);
    packageBQuote.resolve({ ...quoteResult, per_visit_paise: 25_000, total_paise_per_cycle: 25_500 });
    await settle();
    tree = renderScreen();
    const action = sendButton(tree);
    if (action?.props.disabled === false) {
      await (action.props.onPress as () => Promise<void>)();
    }
    const actual = {
      staleState,
      currentRequestDisabled: action?.props.disabled,
      createCalls: createRecurringPlan.mock.calls,
    };
    assertState(
      actual.currentRequestDisabled === false &&
        actual.createCalls.length === 1 &&
        actual.createCalls[0]?.[0]?.provider_service_id === 'service-a' &&
        actual.createCalls[0]?.[0]?.package_id === 'package-b',
      'only the fresh package quote can enable send and submit its service/package context',
      actual,
    );
  });

  it('staleResponseIgnored ignores a prior service response after the route changes', async () => {
    const serviceA = deferred<ProviderServiceWithProvider>();
    getProviderService.mockImplementation((id: string) =>
      id === 'service-a' ? serviceA.promise : Promise.resolve(service(id)),
    );
    listFixedPackages.mockImplementation((id: string) =>
      Promise.resolve([servicePackage(`package-${id}`, id, { title: `Package ${id}` })]),
    );
    mockRuntime.params = { providerServiceId: 'service-a', description: 'Please call on arrival' };
    renderScreen();
    mockRuntime.params = { providerServiceId: 'service-b', description: 'Please call on arrival' };
    renderScreen();
    await settle();
    serviceA.resolve(service('service-a'));
    await settle();
    const tree = renderScreen();
    const actual = {
      serviceCalls: getProviderService.mock.calls,
      packageCalls: listFixedPackages.mock.calls,
      displayedText: elements(tree, 'Text').map((item) => textContent(item)).filter(Boolean),
    };
    assertState(
      actual.packageCalls.every(([id]) => id !== 'service-a') &&
        actual.packageCalls.some(([id]) => id === 'service-b') &&
        actual.displayedText.some((value) => value.includes('Package service-b')) &&
        !actual.displayedText.some((value) => value.includes('Package service-a')),
      'stale service load cannot choose packages or price context for another route',
      actual,
    );
  });

  it('staleResponseIgnored ignores a package response after the route changes', async () => {
    const packageA = deferred<ServicePackage[]>();
    getProviderService.mockImplementation((id: string) => Promise.resolve(service(id)));
    listFixedPackages.mockImplementation((id: string) =>
      id === 'service-a' ? packageA.promise : Promise.resolve([
        servicePackage('package-service-b', 'service-b', { title: 'Package service-b' }),
      ]),
    );
    mockRuntime.params = { providerServiceId: 'service-a', description: 'Please call on arrival' };
    renderScreen();
    await settle();
    mockRuntime.params = { providerServiceId: 'service-b', description: 'Please call on arrival' };
    renderScreen();
    await settle();
    packageA.resolve([servicePackage('package-service-a', 'service-a', { title: 'Package service-a' })]);
    await settle();
    const tree = renderScreen();
    const actual = {
      packageCalls: listFixedPackages.mock.calls,
      displayedText: elements(tree, 'Text').map((item) => textContent(item)).filter(Boolean),
      requestDisabled: sendButton(tree)?.props.disabled,
    };
    assertState(
      actual.packageCalls.some(([id]) => id === 'service-b') &&
        actual.displayedText.some((value) => value.includes('Package service-b')) &&
        !actual.displayedText.some((value) => value.includes('Package service-a')) &&
        actual.requestDisabled === true,
      'stale package result cannot supply another route package or quote context',
      actual,
    );
  });

  it.each([
    ['recurring flag', 'recurring'],
    ['archetype flag', 'archetype'],
    ['category eligibility', 'category'],
  ])('keeps new request controls unavailable when %s is off', async (_label, offSwitch) => {
    if (offSwitch === 'recurring') mockRuntime.recurringEnabled = false;
    if (offSwitch === 'archetype') mockRuntime.archetypes.fixed = false;
    const serviceRow = service('service-a', 'fixed', offSwitch !== 'category');
    getProviderService.mockResolvedValue(serviceRow);
    const ownPackage = servicePackage('package-a', 'service-a');
    listFixedPackages.mockResolvedValue([ownPackage]);
    mockRuntime.params = { providerServiceId: 'service-a', description: 'Please call on arrival' };
    renderScreen();
    await settle();
    const tree = renderScreen();
    const actual = {
      disabledMessage: elements(tree, 'ErrorState').map((item) => item.props.message),
      requestButtons: elements(tree, 'Button').map((item) => item.props.title),
      quoteCalls: quoteRecurringPlan.mock.calls,
      createCalls: createRecurringPlan.mock.calls,
    };
    assertState(
      actual.disabledMessage.includes('This service is not accepting repeat-plan requests right now.') &&
        actual.requestButtons.length === 0 &&
        actual.quoteCalls.length === 0 &&
        actual.createCalls.length === 0,
      'OFF blocks quote and send controls on the new-plan screen',
      actual,
    );
  });
});
