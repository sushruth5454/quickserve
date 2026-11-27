import type React from 'react';
import type { ProviderDetail } from '../../../lib/apiTypes';
import type { PublicProfile } from '../../../lib/onboarding/types';

const mockRuntime: {
  id: string;
  category: string | undefined;
  preview: boolean;
  features: Record<string, boolean>;
  hookIndex: number;
  states: unknown[];
  load: ((guard: { isCurrent: () => boolean }) => Promise<void>) | null;
  lastRefresh: Promise<void> | null;
} = {
  id: 'provider-a',
  category: undefined,
  preview: false,
  features: {},
  hookIndex: 0,
  states: [],
  load: null,
  lastRefresh: null,
};

jest.mock('react', () => {
  const actual = jest.requireActual<typeof import('react')>('react');
  return {
    ...actual,
    useCallback: (callback: unknown) => {
      mockRuntime.hookIndex++;
      return callback;
    },
    useEffect: () => { mockRuntime.hookIndex++; },
    useMemo: (factory: () => unknown) => {
      mockRuntime.hookIndex++;
      return factory();
    },
    useRef: (initial: unknown) => {
      const index = mockRuntime.hookIndex++;
      if (!(index in mockRuntime.states)) mockRuntime.states[index] = { current: initial };
      return mockRuntime.states[index];
    },
    useState: (initial: unknown) => {
      const index = mockRuntime.hookIndex++;
      if (!(index in mockRuntime.states)) mockRuntime.states[index] = initial;
      return [
        mockRuntime.states[index],
        (next: unknown) => {
          mockRuntime.states[index] = typeof next === 'function'
            ? (next as (mockPreviousValue: unknown) => unknown)(mockRuntime.states[index])
            : next;
        },
      ];
    },
  };
});

jest.mock('react-native', () => ({ Share: { share: jest.fn() }, View: 'View' }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
jest.mock('expo-linking', () => ({ createURL: () => 'quickserve://provider' }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), canGoBack: () => true, push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({
    id: mockRuntime.id,
    category: mockRuntime.category,
    preview: mockRuntime.preview ? '1' : undefined,
  }),
}));
jest.mock('../../../components/ui', () => ({
  Card: 'Card',
  ErrorState: 'ErrorState',
  IconButton: 'IconButton',
  InlineAlert: 'InlineAlert',
  Screen: 'Screen',
  Skeleton: 'Skeleton',
  Text: 'Text',
}));
jest.mock('../../../components/market/PriceFooter', () => ({ PriceFooter: 'PriceFooter' }));
jest.mock('../../../lib/api', () => ({
  getProviderDetail: jest.fn(),
  listLiveCities: jest.fn(),
}));
jest.mock('../../../lib/locationContext', () => ({
  useSelectedLocation: () => ({ location: { city: 'Hyderabad' }, setLocation: jest.fn() }),
}));
jest.mock('../../../lib/haptics', () => ({ haptics: { tap: jest.fn() } }));
jest.mock('../../../lib/onboarding', () => ({ onboardingApi: { getPublicProfile: jest.fn() } }));
jest.mock('../../../lib/featureFlags', () => ({
  useAppFeatureFlags: () => ({ isOn: (key: string) => mockRuntime.features[key] === true }),
}));
jest.mock('../../../lib/onboarding/availability', () => ({
  summarizeHours: () => [],
  todayLabel: () => null,
}));
jest.mock('../../../theme', () => ({ useTheme: () => ({ spacing: { md: 16, lg: 24 }, radii: { lg: 16 } }) }));
jest.mock('../ProviderProfileCallouts', () => ({ ProviderProfileCallouts: 'ProviderProfileCallouts' }));
jest.mock('../ProviderProfileHero', () => ({ ProviderProfileHero: 'ProviderProfileHero' }));
jest.mock('../ProviderProfileOverview', () => ({ ProviderProfileOverview: 'ProviderProfileOverview' }));
jest.mock('../ProviderPortfolioSection', () => ({ ProviderPortfolioSection: 'ProviderPortfolioSection' }));
jest.mock('../ProviderReviewsSection', () => ({ ProviderReviewsSection: 'ProviderReviewsSection' }));
jest.mock('../ProviderServicesSection', () => ({ ProviderServicesSection: 'ProviderServicesSection' }));
jest.mock('../../../lib/useEntityRefresh', () => ({
  useEntityRefresh: (load: (guard: { isCurrent: () => boolean }) => Promise<void>) => {
    mockRuntime.load = load;
    return {
      refreshing: false,
      refresh: () => {
        mockRuntime.lastRefresh = load({ isCurrent: () => true });
        return mockRuntime.lastRefresh;
      },
    };
  },
}));

const ReactRuntime = require('react') as typeof import('react');
const { getProviderDetail } = require('../../../lib/api') as { getProviderDetail: jest.Mock };
const { onboardingApi } = require('../../../lib/onboarding') as {
  onboardingApi: { getPublicProfile: jest.Mock };
};
const ProviderDetailScreen = require('../ProviderProfileScreen').default as typeof import('../ProviderProfileScreen').default;
const PROFILE_SECTION_TYPES = [
  'ProviderProfileHero',
  'ProviderProfileCallouts',
  'ProviderServicesSection',
  'ProviderPortfolioSection',
  'ProviderProfileOverview',
  'ProviderReviewsSection',
];

function detail(providerId: string, name: string, paused: boolean, serviceId: string, city = 'Hyderabad'): ProviderDetail {
  return {
    provider: {
      id: providerId,
      city,
      rating_avg: 4.8,
      rating_count: 7,
      years_experience: 5,
      paused,
      profiles: { full_name: name, avatar_url: null },
    } as unknown as ProviderDetail['provider'],
    services: [{
      id: serviceId,
      category_id: `category-${serviceId}`,
      categories: { id: `category-${serviceId}`, name: 'Repair', slug: 'repair', archetype: 'inspect_quote' },
      visit_fee: 100,
      labour_rate: 200,
      rate_unit: 'hour',
      skill_level: 'skilled',
      service_packages: [],
    } as unknown as ProviderDetail['services'][number]],
    reviews: [],
  };
}

function publicProfile(): PublicProfile {
  return {
    id: 'provider',
    base_area: null,
    city: 'Hyderabad',
    service_radius_km: 10,
    paused: false,
    live: true,
    member_since: '2025-01-01',
    badges: { id_verified: true, payout_verified: true, police_verified: false },
    credentials: [],
    specialisations: [],
    hours: [],
    on_leave_until: null,
    portfolio: [],
    links: [],
    review_themes: [],
  } as PublicProfile;
}

function renderProfile() {
  mockRuntime.hookIndex = 0;
  return ProviderDetailScreen();
}

async function loadProfile(provider = detail('provider-a', 'Provider A', false, 'service-a')) {
  getProviderDetail.mockResolvedValue(provider);
  onboardingApi.getPublicProfile.mockResolvedValue(publicProfile());
  renderProfile();
  await mockRuntime.load!({ isCurrent: () => true });
  return renderProfile();
}

function elements(node: unknown, type: string): Array<React.ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.flatMap((child) => elements(child, type));
  if (!ReactRuntime.isValidElement(node)) return [];
  const element = node as React.ReactElement<Record<string, unknown>>;
  return [
    ...(element.type === type ? [element] : []),
    ...elements(element.props.children, type),
  ];
}

function profileSectionOrder(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(profileSectionOrder);
  if (!ReactRuntime.isValidElement(node)) return [];
  const element = node as React.ReactElement<Record<string, unknown>>;
  const name = PROFILE_SECTION_TYPES.find((type) => element.type === type);
  return [...(name ? [name] : []), ...profileSectionOrder(element.props.children)];
}

function screenFooter(tree: unknown): React.ReactElement<Record<string, unknown>> | undefined {
  const screen = elements(tree, 'Screen')[0];
  return elements(screen?.props.footer, 'PriceFooter')[0];
}

function textContent(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (!ReactRuntime.isValidElement(node)) return '';
  return textContent((node as React.ReactElement<Record<string, unknown>>).props.children);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  mockRuntime.id = 'provider-a';
  mockRuntime.category = undefined;
  mockRuntime.preview = false;
  mockRuntime.features = { oorva_brand: false, oorva_catalogue_ux: false };
  mockRuntime.hookIndex = 0;
  mockRuntime.states = [];
  mockRuntime.load = null;
  mockRuntime.lastRefresh = null;
  getProviderDetail.mockReset();
  onboardingApi.getPublicProfile.mockReset();
});

describe('ProviderProfileScreen freshness', () => {
  it('MK-FRESH-paused-unknown keeps booking disabled when temporal availability fails', async () => {
    getProviderDetail.mockResolvedValue(detail('provider-a', 'Provider A', true, 'service-a'));
    onboardingApi.getPublicProfile.mockRejectedValue(new Error('availability unavailable'));
    renderProfile();
    await mockRuntime.load!({ isCurrent: () => true });

    let tree = renderProfile();
    let footer = elements(elements(tree, 'Screen')[0]?.props.footer, 'PriceFooter')[0];
    expect((footer?.props.cta as { disabled: boolean }).disabled).toBe(true);
    const alert = elements(tree, 'InlineAlert')[0];
    expect(alert?.props.message).toContain('availability unavailable');

    onboardingApi.getPublicProfile.mockResolvedValue(publicProfile());
    (alert?.props.onAction as () => void)();
    await mockRuntime.lastRefresh;
    tree = renderProfile();
    footer = elements(elements(tree, 'Screen')[0]?.props.footer, 'PriceFooter')[0];
    expect(elements(tree, 'InlineAlert')).toHaveLength(0);
    expect((footer?.props.cta as { disabled: boolean }).disabled).toBe(true);

    getProviderDetail.mockResolvedValue(detail('provider-a', 'Provider A', false, 'service-a'));
    onboardingApi.getPublicProfile.mockRejectedValue(new Error('availability still unknown'));
    await mockRuntime.load!({ isCurrent: () => true });
    tree = renderProfile();
    footer = elements(elements(tree, 'Screen')[0]?.props.footer, 'PriceFooter')[0];
    expect((footer?.props.cta as { disabled: boolean }).disabled).toBe(true);
    expect(elements(tree, 'InlineAlert').map((item) => item.props.message)).toContain('availability still unknown');
  });

  it('MK-FRESH-profile-context ignores a slower provider response after route context changes', async () => {
    const providerA = deferred<ProviderDetail>();
    const providerB = deferred<ProviderDetail>();
    getProviderDetail.mockImplementation((id: string) => id === 'provider-a' ? providerA.promise : providerB.promise);
    onboardingApi.getPublicProfile.mockResolvedValue(publicProfile());

    renderProfile();
    let activeA = true;
    const pendingA = mockRuntime.load!({ isCurrent: () => activeA });

    mockRuntime.id = 'provider-b';
    renderProfile();
    activeA = false;
    const pendingB = mockRuntime.load!({ isCurrent: () => true });
    providerB.resolve(detail('provider-b', 'Provider B', false, 'service-b'));
    await pendingB;
    providerA.resolve(detail('provider-a', 'Provider A', false, 'service-a'));
    await pendingA;

    const tree = renderProfile();
    const hero = elements(tree, 'ProviderProfileHero')[0];
    const services = elements(tree, 'ProviderServicesSection')[0];
    expect((hero?.props.provider as ProviderDetail['provider']).id).toBe('provider-b');
    expect((services?.props.service as ProviderDetail['services'][number]).id).toBe('service-b');
  });
});

describe('ProviderProfileScreen composition', () => {
  it('MK-PROFILE-Oorva-order shows the service choice before secondary profile sections', async () => {
    mockRuntime.features = { oorva_brand: true, oorva_catalogue_ux: true };
    const tree = await loadProfile();
    const hero = elements(tree, 'ProviderProfileHero')[0];
    const services = elements(tree, 'ProviderServicesSection')[0];
    const portfolio = elements(tree, 'ProviderPortfolioSection')[0];
    const overview = elements(tree, 'ProviderProfileOverview')[0];
    const reviews = elements(tree, 'ProviderReviewsSection')[0];
    const footer = screenFooter(tree);

    expect(profileSectionOrder(elements(tree, 'Screen')[0]?.props.children)).toEqual([
      'ProviderProfileHero',
      'ProviderProfileCallouts',
      'ProviderServicesSection',
      'ProviderPortfolioSection',
      'ProviderProfileOverview',
      'ProviderReviewsSection',
    ]);
    expect(hero?.props.compact).toBe(true);
    expect((hero?.props.provider as ProviderDetail['provider']).id).toBe('provider-a');
    expect((services?.props.service as ProviderDetail['services'][number]).id).toBe('service-a');
    expect(portfolio?.props.pub).toEqual(publicProfile());
    expect((overview?.props.provider as ProviderDetail['provider']).id).toBe('provider-a');
    expect(reviews?.props.reviews).toEqual([]);
    expect(footer?.props.cta).toMatchObject({ title: 'Book Provider', disabled: false });
    expect(footer?.props.caption).toBe('Repair · visit fee');
  });

  it('MK-PROFILE-leaf-off-invariants retains legacy order and identical paused/preview behavior', async () => {
    mockRuntime.features = { oorva_brand: true, oorva_catalogue_ux: false };
    const tree = await loadProfile(detail('provider-a', 'Provider A', true, 'service-a'));
    const legacyOrder = [
      'ProviderProfileHero',
      'ProviderProfileCallouts',
      'ProviderProfileOverview',
      'ProviderServicesSection',
      'ProviderPortfolioSection',
      'ProviderReviewsSection',
    ];
    const legacyFooter = screenFooter(tree);
    expect(profileSectionOrder(elements(tree, 'Screen')[0]?.props.children)).toEqual(legacyOrder);
    expect(elements(tree, 'ProviderProfileHero')[0]?.props.compact).toBe(false);
    expect(legacyFooter?.props.cta).toMatchObject({ title: 'Book Provider', disabled: true });

    mockRuntime.features = { oorva_brand: true, oorva_catalogue_ux: true };
    const enabledTree = renderProfile();
    const enabledFooter = screenFooter(enabledTree);
    expect(profileSectionOrder(elements(enabledTree, 'Screen')[0]?.props.children)).toEqual([
      'ProviderProfileHero',
      'ProviderProfileCallouts',
      'ProviderServicesSection',
      'ProviderPortfolioSection',
      'ProviderProfileOverview',
      'ProviderReviewsSection',
    ]);
    expect(elements(enabledTree, 'ProviderProfileHero')[0]?.props.compact).toBe(true);
    expect(enabledFooter?.props.cta).toMatchObject({
      title: (legacyFooter?.props.cta as { title: string }).title,
      disabled: (legacyFooter?.props.cta as { disabled: boolean }).disabled,
    });
    expect(enabledFooter?.props.caption).toBe(legacyFooter?.props.caption);
    expect((elements(enabledTree, 'ProviderServicesSection')[0]?.props.canSelectPackages)).toBe(
      elements(tree, 'ProviderServicesSection')[0]?.props.canSelectPackages,
    );

    mockRuntime.features = { oorva_brand: false, oorva_catalogue_ux: true };
    const parentOffTree = renderProfile();
    expect(profileSectionOrder(elements(parentOffTree, 'Screen')[0]?.props.children)).toEqual(legacyOrder);
    expect(elements(parentOffTree, 'ProviderProfileHero')[0]?.props.compact).toBe(false);

    mockRuntime.features = { oorva_brand: true, oorva_catalogue_ux: false };
    mockRuntime.preview = true;
    const legacyPreview = renderProfile();
    expect(screenFooter(legacyPreview)).toBeUndefined();
    expect(elements(legacyPreview, 'ProviderProfileCallouts')[0]?.props.isPreview).toBe(true);
    expect(elements(legacyPreview, 'ProviderServicesSection')[0]?.props.canSelectPackages).toBe(false);

    mockRuntime.features = { oorva_brand: true, oorva_catalogue_ux: true };
    const enabledPreview = renderProfile();
    expect(screenFooter(enabledPreview)).toBeUndefined();
    expect(elements(enabledPreview, 'ProviderProfileCallouts')[0]?.props.isPreview).toBe(true);
    expect(elements(enabledPreview, 'ProviderServicesSection')[0]?.props.canSelectPackages).toBe(false);
  });

  it('MK-PROFILE-long-content keeps the active footer action and city-switch reason available', async () => {
    mockRuntime.features = { oorva_brand: true, oorva_catalogue_ux: true };
    const longName = `LongProvider${'Name'.repeat(60)}`;
    const tree = await loadProfile(detail('provider-a', longName, false, 'service-a', 'Pune'));
    const footer = screenFooter(tree);
    const above = footer?.props.above;

    expect(footer?.props.cta).toMatchObject({ title: 'Switch to Pune', disabled: false });
    expect(textContent(above)).toContain(`${longName} works in Pune.`);
    expect(textContent(above)).toContain('Your location is Hyderabad');
  });
});
