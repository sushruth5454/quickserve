import type React from 'react';
import type { ProviderDetail } from '../../../lib/apiTypes';
import type { PublicProfile } from '../../../lib/onboarding/types';

const mockRuntime: {
  id: string;
  category: string | undefined;
  hookIndex: number;
  states: unknown[];
  load: ((guard: { isCurrent: () => boolean }) => Promise<void>) | null;
  lastRefresh: Promise<void> | null;
} = { id: 'provider-a', category: undefined, hookIndex: 0, states: [], load: null, lastRefresh: null };

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
  useLocalSearchParams: () => ({ id: mockRuntime.id, category: mockRuntime.category }),
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

function detail(providerId: string, name: string, paused: boolean, serviceId: string): ProviderDetail {
  return {
    provider: {
      id: providerId,
      city: 'Hyderabad',
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

function elements(node: unknown, type: string): Array<React.ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.flatMap((child) => elements(child, type));
  if (!ReactRuntime.isValidElement(node)) return [];
  const element = node as React.ReactElement<Record<string, unknown>>;
  return [
    ...(element.type === type ? [element] : []),
    ...elements(element.props.children, type),
  ];
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  mockRuntime.id = 'provider-a';
  mockRuntime.category = undefined;
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
