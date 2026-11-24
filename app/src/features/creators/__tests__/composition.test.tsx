import type React from 'react';
import type { Catalogue, CatalogueCategory } from '../../catalogue/model';

const mockRuntime = {
  city: 'Hyderabad',
  states: [] as unknown[],
  hookIndex: 0,
  effects: [] as Array<() => void>,
  features: {
    creators_landing: true,
    oorva_creators_ux: true,
    oorva_brand: true,
  } as Record<string, unknown>,
};

jest.mock('react', () => {
  const actual = jest.requireActual<typeof import('react')>('react');
  return {
    ...actual,
    useCallback: (callback: (...args: never[]) => unknown) => callback,
    useEffect: (effect: () => void) => {
      mockRuntime.effects.push(effect);
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
jest.mock('../../../components/CategoryIcon', () => ({
  CategoryIcon: 'CategoryIcon',
  iconForCategory: (category: CatalogueCategory) => category.icon,
}));
jest.mock('../../../components/ui', () => ({
  Button: 'Button',
  Card: 'Card',
  EmptyState: 'EmptyState',
  ErrorState: 'ErrorState',
  Header: 'Header',
  InlineAlert: 'InlineAlert',
  Screen: 'Screen',
  Skeleton: 'Skeleton',
  Text: 'Text',
}));
jest.mock('../../catalogue/api', () => ({ getCatalogue: jest.fn() }));
jest.mock('../../../lib/featureFlags', () => {
  const { isFeatureOn } = jest.requireActual<typeof import('../../../lib/featureFlagModel')>(
    '../../../lib/featureFlagModel',
  );
  return {
    useAppFeatureFlags: () => ({
      isOn: (key: string) => isFeatureOn(mockRuntime.features, key),
    }),
  };
});
jest.mock('../../../lib/locationContext', () => ({
  useSelectedLocation: () => ({ location: { city: mockRuntime.city } }),
}));
jest.mock('../../../i18n', () => ({ useT: () => (key: string) => key }));
jest.mock('../../../theme', () => ({
  useTheme: () => ({
    spacing: { md: 16 },
    radii: { lg: 12, pill: 999 },
    colors: { primarySoft: '#eee', primaryText: '#111' },
  }),
}));

const ReactRuntime = require('react') as typeof import('react');
const { router } = require('expo-router') as { router: { push: jest.Mock; replace: jest.Mock } };
const { getCatalogue } = require('../../catalogue/api') as { getCatalogue: jest.Mock };
const { CreatorsScreen } = require('../CreatorsScreen') as typeof import('../CreatorsScreen');

function category(
  slug: string,
  name: string,
  vertical: string,
  archetype?: CatalogueCategory['archetype'],
): CatalogueCategory {
  return {
    id: `category-${slug}`,
    slug,
    name,
    icon: 'sparkles-outline',
    pricing_mode: 'quote',
    sort_order: 1,
    vertical,
    archetype,
  };
}

function catalogue(categories: CatalogueCategory[]): Catalogue {
  return {
    categories,
    verticals: [
      { slug: 'photo-video', label: 'Photo & video', categories: categories.filter(({ vertical }) => vertical === 'photo-video') },
      { slug: 'weddings-events', label: 'Weddings & events', categories: categories.filter(({ vertical }) => vertical === 'weddings-events') },
      { slug: 'home-repairs', label: 'Home repairs', categories: categories.filter(({ vertical }) => vertical === 'home-repairs') },
    ],
  };
}

function renderScreen() {
  mockRuntime.hookIndex = 0;
  mockRuntime.effects = [];
  return CreatorsScreen();
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

function textContent(node: unknown): string[] {
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(textContent);
  if (!ReactRuntime.isValidElement(node)) return [];
  return textContent((node as React.ReactElement<Record<string, unknown>>).props.children);
}

async function loadAndSettle() {
  mockRuntime.effects[0]?.();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  mockRuntime.city = 'Hyderabad';
  mockRuntime.features = {
    creators_landing: true,
    oorva_creators_ux: true,
    oorva_brand: true,
  };
  mockRuntime.states = [];
  mockRuntime.hookIndex = 0;
  mockRuntime.effects = [];
  getCatalogue.mockReset();
  router.push.mockReset();
  router.replace.mockReset();
});

describe('creator discovery composition', () => {
  it('keeps loading separate from error and successful empty', () => {
    getCatalogue.mockReturnValue(new Promise(() => undefined));
    const tree = renderScreen();

    expect(findElements(tree, 'Skeleton')).toHaveLength(2);
    expect(findElements(tree, 'ErrorState')).toHaveLength(0);
    expect(findElements(tree, 'EmptyState')).toHaveLength(0);
  });

  it('shows city-aware recovery only after a successful zero-category load', async () => {
    getCatalogue.mockResolvedValue(catalogue([]));
    renderScreen();
    await loadAndSettle();

    const tree = renderScreen();
    const empty = findElements(tree, 'EmptyState')[0];

    expect(empty?.props.title).toContain('Hyderabad');
    expect(empty?.props.actionLabel).toBe('Change location');
    expect(empty?.props.secondaryLabel).toBe('Browse services');
    expect(findElements(tree, 'ErrorState')).toHaveLength(0);
    expect(findElements(tree, 'Button')).toHaveLength(0);
    (empty?.props.onAction as (() => void) | undefined)?.();
    (empty?.props.onSecondary as (() => void) | undefined)?.();
    expect(router.push).toHaveBeenNthCalledWith(1, '/location');
    expect(router.push).toHaveBeenNthCalledWith(2, '/');
  });

  it('keeps catalogue failure as a retryable error instead of empty supply', async () => {
    getCatalogue.mockRejectedValue(new Error('catalogue unavailable'));
    renderScreen();
    await loadAndSettle();

    const tree = renderScreen();
    const error = findElements(tree, 'ErrorState')[0];

    expect(error).toBeTruthy();
    expect(typeof error?.props.onRetry).toBe('function');
    expect(findElements(tree, 'EmptyState')).toHaveLength(0);
    (error?.props.onRetry as (() => void) | undefined)?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(getCatalogue).toHaveBeenCalledTimes(2);
  });

  it('composes real category facts with a category-scoped brief handoff', async () => {
    const photography = category('photography', 'Photography', 'photo-video', 'proposal');
    const weddingFilms = category('wedding-films', 'Wedding films', 'weddings-events', 'proposal');
    const homeRepair = category('plumbing', 'Plumbing', 'home-repairs', 'proposal');
    getCatalogue.mockResolvedValue(catalogue([photography, weddingFilms, homeRepair]));
    renderScreen();
    await loadAndSettle();

    const tree = renderScreen();
    const categoryCard = findElements(tree, 'Card').find(
      (element) => element.props.accessibilityLabel === photography.name,
    );
    const brief = findElements(tree, 'Button').find(
      (element) => element.props.title === `Start a brief for ${photography.name}`,
    );
    const header = findElements(tree, 'Screen')[0]?.props.header as
      | React.ReactElement<Record<string, unknown>>
      | undefined;

    expect(header?.props.subtitle).toBe('Hyderabad');
    expect(categoryCard).toBeTruthy();
    expect(findElements(tree, 'Card').filter((element) => element.props.accessibilityLabel)).toHaveLength(2);
    expect(findElements(tree, 'Button').map((element) => element.props.title)).toEqual([
      `Start a brief for ${photography.name}`,
      `Start a brief for ${weddingFilms.name}`,
    ]);
    expect(textContent(tree).join(' ')).not.toMatch(/Plumbing|rating|followers|portfolio|verified|work photos/i);
    (categoryCard?.props.onPress as (() => void) | undefined)?.();
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/category/[slug]',
      params: { slug: photography.slug, name: photography.name },
    });
    (brief?.props.onPress as (() => void) | undefined)?.();
    expect(router.push).toHaveBeenLastCalledWith({
      pathname: '/request/new',
      params: { categoryId: photography.id, name: photography.name },
    });
    expect(findElements(tree, 'Text').map((element) => element.props.children)).toContain('creators.how');
  });

  it('preserves ordinary category drill-down when the creator presentation flag is off', async () => {
    mockRuntime.features.oorva_creators_ux = false;
    const photography = category('photography', 'Photography', 'photo-video', 'proposal');
    getCatalogue.mockResolvedValue(catalogue([photography]));
    renderScreen();
    await loadAndSettle();

    const tree = renderScreen();
    const categoryCard = findElements(tree, 'Card').find((element) => element.props.accessibilityLabel === photography.name);

    expect(findElements(tree, 'Button')).toHaveLength(0);
    (categoryCard?.props.onPress as (() => void) | undefined)?.();
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/category/[slug]',
      params: { slug: photography.slug, name: photography.name },
    });
  });

  it('fails closed under the Oorva brand parent without hiding ordinary categories', async () => {
    mockRuntime.features.oorva_brand = false;
    const photography = category('photography', 'Photography', 'photo-video', 'proposal');
    getCatalogue.mockResolvedValue(catalogue([photography]));
    renderScreen();
    await loadAndSettle();

    const tree = renderScreen();

    expect(findElements(tree, 'Button')).toHaveLength(0);
    const categoryCard = findElements(tree, 'Card').find((element) => element.props.accessibilityLabel === photography.name);
    expect(categoryCard).toBeTruthy();
  });

  it('preserves the existing Home fallback when the creators landing leaf is off', () => {
    mockRuntime.features.creators_landing = false;
    const tree = renderScreen();
    const home = findElements(tree, 'Button')[0];

    expect(getCatalogue).not.toHaveBeenCalled();
    expect(home?.props.title).toBe('tabs.home');
    (home?.props.onPress as (() => void) | undefined)?.();
    expect(router.replace).toHaveBeenCalledWith('/');
  });
});
