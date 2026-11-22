import type React from 'react';
import type { Category } from '../../../lib/types';
import type { CataloguePackage } from '../api';

const mockRuntime: {
  city: string;
  hookIndex: number;
  states: unknown[];
  load: ((guard: { isCurrent: () => boolean }) => Promise<void>) | null;
} = { city: 'City A', hookIndex: 0, states: [], load: null };

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
jest.mock('expo-router', () => ({ router: { navigate: jest.fn(), push: jest.fn() } }));
jest.mock('../../../components/ProviderCard', () => ({ ProviderCard: 'ProviderCard' }));
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
jest.mock('../api', () => ({ listCataloguePackages: jest.fn() }));
jest.mock('../../../lib/useEntityRefresh', () => ({
  useEntityRefresh: (load: (guard: { isCurrent: () => boolean }) => Promise<void>) => {
    mockRuntime.load = load;
    return { refreshing: false, refresh: () => load({ isCurrent: () => true }) };
  },
}));

const ReactRuntime = require('react') as typeof import('react');
const { listCataloguePackages } = require('../api') as { listCataloguePackages: jest.Mock };
const { ArchetypeCategory } = require('../ArchetypeCategory') as typeof import('../ArchetypeCategory');

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
  mockRuntime.hookIndex = 0;
  mockRuntime.states = [];
  mockRuntime.load = null;
  listCataloguePackages.mockReset();
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
