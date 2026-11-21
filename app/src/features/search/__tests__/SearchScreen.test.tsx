import type React from 'react';
import type { Catalogue } from '../../catalogue/model';
import type { SearchProduct, ShopResult } from '../../shops/api';
import type { SearchResponse } from '../api';

const mockRuntime = {
  enabled: true,
  sportsOn: false,
  productsOn: true,
  city: 'Hyderabad',
  states: [] as unknown[],
  hookIndex: 0,
  effects: [] as Array<{
    index: number;
    effect: () => void | (() => void);
    deps?: readonly unknown[];
  }>,
  effectDeps: [] as Array<readonly unknown[] | undefined>,
  cleanups: [] as Array<void | (() => void)>,
  memo: [] as Array<{ deps: readonly unknown[]; value: unknown } | undefined>,
};

jest.mock('react', () => {
  const actual = jest.requireActual<typeof import('react')>('react');
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
      const index = mockRuntime.hookIndex++;
      const previous = mockRuntime.effectDeps[index];
      if (!deps || !previous || deps.some((value, position) => !Object.is(value, previous[position]))) {
        mockRuntime.effects.push({ index, effect, deps });
      }
    },
    useMemo: (factory: () => unknown, deps: readonly unknown[]) => {
      const index = mockRuntime.hookIndex++;
      const previous = mockRuntime.memo[index];
      if (previous && deps.length === previous.deps.length && deps.every((value, position) => Object.is(value, previous.deps[position]))) {
        return previous.value;
      }
      const value = factory();
      mockRuntime.memo[index] = { deps, value };
      return value;
    },
    useState: (initial: unknown) => {
      const index = mockRuntime.hookIndex++;
      if (mockRuntime.states[index] === undefined) mockRuntime.states[index] = initial;
      return [
        mockRuntime.states[index],
        (next: unknown) => {
          mockRuntime.states[index] = typeof next === 'function'
            ? (next as (mockCurrent: unknown) => unknown)(mockRuntime.states[index])
            : next;
        },
      ];
    },
  };
});

jest.mock('react-native', () => ({ View: 'View' }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock('../../../components/market/ChipRow', () => ({ ChipRow: 'ChipRow' }));
jest.mock('../../../components/market/ListingCard', () => ({ ListingCard: 'ListingCard' }));
jest.mock('../../../components/market/SearchField', () => ({ SearchField: 'SearchField' }));
jest.mock('../../../components/ui', () => ({
  Button: 'Button',
  EmptyState: 'EmptyState',
  Header: 'Header',
  InlineAlert: 'InlineAlert',
  Screen: 'Screen',
  Section: 'Section',
  Skeleton: 'Skeleton',
}));
jest.mock('../../shops/api', () => ({ signedProductImage: jest.fn() }));
jest.mock('../../shops/components', () => ({ ShopProductCard: 'ShopProductCard' }));
jest.mock('../../../i18n', () => ({ useT: () => (key: string) => key }));
jest.mock('../../../lib/featureFlags', () => ({
  useAppFeatureFlags: () => ({
    isOn: (key: string) => {
      if (key === 'unified_search') return mockRuntime.enabled;
      if (key === 'sports') return mockRuntime.sportsOn;
      if (key === 'products') return mockRuntime.productsOn;
      return false;
    },
  }),
}));
jest.mock('../../../lib/locationContext', () => ({
  useSelectedLocation: () => ({
    location: { city: mockRuntime.city },
    coords: { lat: null, lng: null },
  }),
}));
jest.mock('../../../theme', () => ({
  useTheme: () => ({ spacing: { md: 16 }, radii: { lg: 12 } }),
}));
jest.mock('../api', () => ({ searchEverything: jest.fn() }));

const ReactRuntime = require('react') as typeof import('react');
const { router } = require('expo-router') as { router: { push: jest.Mock; replace: jest.Mock } };
const { searchEverything } = require('../api') as { searchEverything: jest.Mock };
const { signedProductImage } = require('../../shops/api') as { signedProductImage: jest.Mock };
const { SearchScreen } = require('../SearchScreen') as typeof import('../SearchScreen');

function product(overrides: Partial<SearchProduct> = {}): SearchProduct {
  return {
    id: 'product-cement',
    shop_id: 'shop-1',
    category_id: 'category-1',
    category_slug: 'building-materials',
    category_name: 'Building materials',
    name: 'Cement bag',
    brand: 'BuildCo',
    model: 'OPC',
    description: 'Cement',
    specs: {},
    unit: 'box',
    indicative_price_paise: 0,
    price_updated_at: '2026-11-20T00:00:00.000Z',
    in_stock: false,
    active: true,
    image_paths: ['product-images/cement.jpg'],
    shop_name: 'Build shop',
    city: 'Hyderabad',
    area: 'Madhapur',
    distance_km: null,
    ...overrides,
  };
}

function response(products: SearchProduct[], overrides: Partial<SearchResponse['raw']> = {}): SearchResponse {
  return {
    raw: {
      catalogue: null,
      activities: [],
      products,
      shops: [],
      ...overrides,
    },
    errors: { services: false, shops: false, sports: false, creators: false },
  };
}

function renderScreen() {
  mockRuntime.hookIndex = 0;
  mockRuntime.effects = [];
  return SearchScreen();
}

function findElements(node: unknown, type: string): Array<React.ReactElement<Record<string, unknown>>> {
  if (Array.isArray(node)) return node.flatMap((child) => findElements(child, type));
  if (!ReactRuntime.isValidElement(node)) return [];
  const element = node as React.ReactElement<Record<string, unknown>>;
  return [
    ...(element.type === type ? [element] : []),
    ...findElements(element.props.children, type),
  ];
}

async function drainMicrotasks() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

async function flushEffects() {
  const effects = mockRuntime.effects.splice(0);
  for (const { index, effect, deps } of effects) {
    mockRuntime.cleanups[index]?.();
    mockRuntime.effectDeps[index] = deps;
    mockRuntime.cleanups[index] = effect();
  }
  await drainMicrotasks();
}

async function loadProducts(query: string, result: SearchResponse) {
  mockRuntime.states[0] = query;
  mockRuntime.states[1] = query;
  searchEverything.mockResolvedValue(result);
  renderScreen();
  await flushEffects();
  renderScreen();
  await flushEffects();
  return renderScreen();
}

beforeEach(() => {
  jest.useFakeTimers();
  mockRuntime.enabled = true;
  mockRuntime.sportsOn = false;
  mockRuntime.productsOn = true;
  mockRuntime.city = 'Hyderabad';
  mockRuntime.states = [];
  mockRuntime.hookIndex = 0;
  mockRuntime.effects = [];
  mockRuntime.effectDeps = [];
  mockRuntime.cleanups = [];
  mockRuntime.memo = [];
  searchEverything.mockReset();
  signedProductImage.mockReset();
  signedProductImage.mockResolvedValue('https://signed.example/cement.jpg');
  router.push.mockReset();
  router.replace.mockReset();
});

afterEach(() => {
  mockRuntime.cleanups.forEach((cleanup) => cleanup?.());
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('SearchScreen product results', () => {
  it('MK-SEARCH-product-price-stock-contract reuses the full SearchProduct for its existing card', async () => {
    const boxProduct = product();
    const askProduct = product({
      id: 'product-sand',
      name: 'Cement sand',
      unit: 'sqft',
      indicative_price_paise: null,
      in_stock: true,
      image_paths: [],
    });
    const catalogue = {
      categories: [{ id: 'category-result', slug: 'cement-repair', name: 'Cement repair', vertical: 'home-repairs' }],
      verticals: [],
    } as unknown as Catalogue;
    const shop: ShopResult = {
      id: 'shop-result',
      name: 'Cement outlet',
      description: '',
      city: 'Hyderabad',
      area: 'Madhapur',
      offers_delivery: false,
      offers_pickup: true,
      distance_km: null,
      category_slugs: [],
    };
    const tree = await loadProducts('cement', response([boxProduct, askProduct], {
      catalogue,
      activities: [{ id: 'activity-result', slug: 'cement-tennis', name: 'Cement tennis' }],
      shops: [shop],
    }));
    const cards = findElements(tree, 'ShopProductCard');

    expect(cards.map(({ props }) => props.product)).toEqual([boxProduct, askProduct]);
    expect((cards[0]?.props.product as SearchProduct).id).toBe(boxProduct.id);
    expect((cards[0]?.props.product as SearchProduct).indicative_price_paise).toBe(0);
    expect((cards[0]?.props.product as SearchProduct).unit).toBe('box');
    expect((cards[0]?.props.product as SearchProduct).price_updated_at).toBe(boxProduct.price_updated_at);
    expect((cards[0]?.props.product as SearchProduct).in_stock).toBe(false);
    expect((cards[1]?.props.product as SearchProduct).indicative_price_paise).toBeNull();
    expect((cards[1]?.props.product as SearchProduct).unit).toBe('sqft');
    expect((cards[0]?.props.product as SearchProduct).in_stock).toBe(false);
    expect(findElements(tree, 'ListingCard').map(({ props }) => props.variant).sort()).toEqual([
      'provider',
      'shop',
      'venue',
    ]);
    (cards[0]?.props.onPress as (() => void) | undefined)?.();
    expect(router.push).toHaveBeenCalledWith({ pathname: '/product/[id]', params: { id: boxProduct.id } });
  });

  it('MK-SEARCH-product-image-fallback keeps the row when signing fails', async () => {
    signedProductImage.mockRejectedValue(new Error('signing unavailable'));
    const tree = await loadProducts('cement', response([product()]));
    const cards = findElements(tree, 'ShopProductCard');

    expect(cards).toHaveLength(1);
    expect(cards[0]?.props.imageUrl).toBeNull();
    expect(signedProductImage).toHaveBeenCalledWith('product-images/cement.jpg');
  });

  it('MK-SEARCH-product-query-cleanup hides old results and ignores old image completions', async () => {
    let resolveOldImage: ((url: string) => void) | undefined;
    const oldImage = new Promise<string>((resolve) => {
      resolveOldImage = resolve;
    });
    const firstProduct = product({ id: 'product-alpha', name: 'Alpha cement', image_paths: ['alpha.jpg'] });
    const nextProduct = product({ id: 'product-beta', name: 'Beta cement', image_paths: ['beta.jpg'] });
    signedProductImage.mockImplementation((path: string) => (
      path === 'alpha.jpg' ? oldImage : Promise.resolve('https://signed.example/beta.jpg')
    ));

    let tree = await loadProducts('alpha', response([firstProduct]));
    expect(findElements(tree, 'ShopProductCard')[0]?.props.product).toEqual(firstProduct);
    searchEverything.mockImplementation((query: string) => Promise.resolve(
      response([query === 'alpha' ? firstProduct : nextProduct]),
    ));

    const field = findElements(tree, 'SearchField')[0];
    (field?.props.onChangeText as ((value: string) => void) | undefined)?.('beta');
    tree = renderScreen();
    expect(findElements(tree, 'ShopProductCard')).toHaveLength(0);

    await flushEffects();
    jest.advanceTimersByTime(300);
    renderScreen();
    await flushEffects();
    tree = renderScreen();
    await flushEffects();
    tree = renderScreen();
    await flushEffects();
    tree = renderScreen();

    const cards = findElements(tree, 'ShopProductCard');
    expect(cards).toHaveLength(1);
    expect(cards[0]?.props.product).toEqual(nextProduct);
    expect(cards[0]?.props.imageUrl).toBe('https://signed.example/beta.jpg');

    resolveOldImage?.('https://signed.example/alpha.jpg');
    await drainMicrotasks();
    tree = renderScreen();
    expect(findElements(tree, 'ShopProductCard')[0]?.props.product).toEqual(nextProduct);
    expect(findElements(tree, 'ShopProductCard')[0]?.props.imageUrl).toBe('https://signed.example/beta.jpg');
  });

  it('does not render cached products or request them while the products flag is off', async () => {
    mockRuntime.productsOn = false;
    const tree = await loadProducts('cement', response([product()]));

    expect(searchEverything).toHaveBeenCalledWith('cement', expect.objectContaining({ productsOn: false }));
    expect(findElements(tree, 'ShopProductCard')).toHaveLength(0);
    expect(signedProductImage).not.toHaveBeenCalled();
  });
});
