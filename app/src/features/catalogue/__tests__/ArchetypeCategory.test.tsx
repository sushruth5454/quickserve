import type React from 'react';
import type { Category } from '../../../lib/types';
import type { CataloguePackage } from '../api';

const mockRuntime: {
  city: string;
  slug: string;
  name: string;
  hookIndex: number;
  states: unknown[];
  load: ((guard: { isCurrent: () => boolean }) => Promise<void>) | null;
} = { city: 'City A', slug: 'cleaning', name: 'Cleaning', hookIndex: 0, states: [], load: null };

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

jest.mock('react-native', () => ({ View: 'View' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('../../../components/market/ListingCard', () => ({ ListingCard: 'ListingCard' }));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView' },
  FadeInDown: { delay: jest.fn().mockReturnThis(), duration: jest.fn().mockReturnThis() },
}));
jest.mock('expo-router', () => ({
  router: { navigate: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({ slug: mockRuntime.slug, name: mockRuntime.name }),
}));
jest.mock('../../../components/ProviderCard', () => ({ ProviderCard: 'ProviderCard' }));
jest.mock('../../../lib/haptics', () => ({ haptics: { select: jest.fn() } }));
jest.mock('../../../lib/featureFlags', () => ({
  useAppFeatureFlags: () => ({ isOn: () => false }),
}));
jest.mock('../../../i18n', () => ({ useT: () => (key: string) => key }));
jest.mock('../../../components/ui', () => ({
  Button: 'Button',
  Card: 'Card',
  EmptyState: 'EmptyState',
  ErrorState: 'ErrorState',
  Header: 'Header',
  Screen: 'Screen',
  Section: 'Section',
  Skeleton: 'Skeleton',
  SkeletonProviderCard: 'SkeletonProviderCard',
  Text: 'Text',
}));
jest.mock('../../../lib/api', () => ({ searchProviders: jest.fn() }));
jest.mock('../../../lib/locationContext', () => ({
  useSelectedLocation: () => ({
    location: { city: mockRuntime.city },
    coords: { lat: 10, lng: mockRuntime.city === 'City A' ? 20 : 30 },
  }),
}));
jest.mock('../../../theme', () => ({
  useTheme: () => ({ spacing: { md: 16, lg: 24 }, radii: { lg: 16 } }),
}));
jest.mock('../../booking/packages/PackageCard', () => ({ PackageCard: 'PackageCard' }));
jest.mock('../../booking/packages/packageModel', () => ({ canPayInstantly: () => true }));
jest.mock('../api', () => ({
  getCatalogueCategory: jest.fn(),
  listCataloguePackages: jest.fn(),
}));
jest.mock('../../../lib/useEntityRefresh', () => ({
  useEntityRefresh: (load: (guard: { isCurrent: () => boolean }) => Promise<void>) => {
    mockRuntime.load = load;
    return { refreshing: false, refresh: () => load({ isCurrent: () => true }) };
  },
}));

const ReactRuntime = require('react') as typeof import('react');
const { getCatalogueCategory, listCataloguePackages } = require('../api') as {
  getCatalogueCategory: jest.Mock;
  listCataloguePackages: jest.Mock;
};
const { ArchetypeCategory } = require('../ArchetypeCategory') as typeof import('../ArchetypeCategory');
const { default: CategoryDetailScreen } = require('../../marketplaceScreens/CategoryDetailScreen') as {
  default: () => React.ReactElement<{ header: React.ReactElement<{ title: string }> }>;
};

function category(): Category {
  return {
    id: 'category-fixed',
    slug: 'cleaning',
    name: 'Cleaning',
    archetype: 'fixed',
  } as Category;
}

function packageFor(providerName: string): CataloguePackage {
  return {
    package: { id: `package-${providerName}`, active: true, price_type: 'fixed', price: 500, price_min: null, sort_order: 1 },
    providerName,
    providerServiceId: `service-${providerName}`,
    providerId: `provider-${providerName}`,
    city: mockRuntime.city,
    providerOnline: true,
    providerPaused: false,
    rating: 5,
    ratingCount: 1,
  } as unknown as CataloguePackage;
}

function renderCategory() {
  mockRuntime.hookIndex = 0;
  return ArchetypeCategory({ category: category() });
}

function renderCategoryDetailScreen() {
  mockRuntime.hookIndex = 0;
  return CategoryDetailScreen();
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
  mockRuntime.city = 'City A';
  mockRuntime.slug = 'cleaning';
  mockRuntime.name = 'Cleaning';
  mockRuntime.hookIndex = 0;
  mockRuntime.states = [];
  mockRuntime.load = null;
  getCatalogueCategory.mockReset();
  getCatalogueCategory.mockResolvedValue(null);
  listCataloguePackages.mockReset();
});

describe('CategoryDetailScreen route host', () => {
  it('MK-S40-host-uses-route-slug-and-city-for-category-loads', async () => {
    mockRuntime.slug = 'route-cleaning';
    mockRuntime.name = 'Route cleaning';

    const screen = renderCategoryDetailScreen();
    await mockRuntime.load!({ isCurrent: () => true });

    const actual = {
      title: screen.props.header.props.title,
      categoryCalls: getCatalogueCategory.mock.calls,
    };
    const expected = {
      title: 'Route cleaning',
      categoryCalls: [['route-cleaning', 'City A']],
    };
    expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
  });
});

describe('ArchetypeCategory freshness', () => {
  it('MK-FRESH-city-race never displays a slower prior-city package result', async () => {
    const cityA = deferred<CataloguePackage[]>();
    const cityB = deferred<CataloguePackage[]>();
    listCataloguePackages.mockImplementation((slug: string, city: string) =>
      city === 'City A' ? cityA.promise : cityB.promise);

    renderCategory();
    let activeA = true;
    const pendingA = mockRuntime.load!({ isCurrent: () => activeA });

    mockRuntime.city = 'City B';
    renderCategory();
    activeA = false;
    const pendingB = mockRuntime.load!({ isCurrent: () => true });
    cityB.resolve([packageFor('City B Provider')]);
    await pendingB;
    cityA.resolve([packageFor('City A Provider')]);
    await pendingA;

    const cards = elements(renderCategory(), 'PackageCard');
    expect(cards.map((card) => card.props.providerName)).toEqual(['City B Provider']);
  });
});
