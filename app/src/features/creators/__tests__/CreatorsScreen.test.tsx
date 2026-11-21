import type React from 'react';
import type { Catalogue, CatalogueCategory } from '../../catalogue/model';

const mockRuntime = {
  enabled: true,
  city: 'Hyderabad',
  states: [] as unknown[],
  hookIndex: 0,
  effects: [] as Array<() => void>,
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
jest.mock('../../../lib/featureFlags', () => ({
  useAppFeatureFlags: () => ({ isOn: () => mockRuntime.enabled }),
}));
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

function category(slug: string, vertical: string): CatalogueCategory {
  return {
    id: `id-${slug}`,
    slug,
    name: slug,
    icon: 'sparkles-outline',
    pricing_mode: 'quote',
    sort_order: 1,
    vertical,
  };
}

function catalogue(categories: CatalogueCategory[]): Catalogue {
  return {
    categories,
    verticals: [
      { slug: 'photo-video', label: 'Photo & video', categories: categories.filter(({ vertical }) => vertical === 'photo-video') },
      { slug: 'weddings-events', label: 'Weddings & events', categories: categories.filter(({ vertical }) => vertical === 'weddings-events') },
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

async function loadAndSettle() {
  mockRuntime.effects[0]?.();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  mockRuntime.enabled = true;
  mockRuntime.city = 'Hyderabad';
  mockRuntime.states = [];
  mockRuntime.hookIndex = 0;
  mockRuntime.effects = [];
  getCatalogue.mockReset();
  router.push.mockReset();
  router.replace.mockReset();
});

describe('CreatorsScreen', () => {
  it('MK-CREATORS-empty-city-recovery renders city-aware recovery after a successful empty load', async () => {
    getCatalogue.mockResolvedValue(catalogue([]));
    renderScreen();
    await loadAndSettle();

    const tree = renderScreen();
    const empty = findElements(tree, 'EmptyState')[0];

    expect(empty?.props.title).toContain('Hyderabad');
    expect(empty?.props.message).toBeTruthy();
    expect(empty?.props.actionLabel).toBe('Change location');
    expect(empty?.props.secondaryLabel).toBe('Browse services');
    expect(findElements(tree, 'CategoryIcon')).toHaveLength(0);
    (empty?.props.onAction as (() => void) | undefined)?.();
    expect(router.push).toHaveBeenCalledWith('/location');
    (empty?.props.onSecondary as (() => void) | undefined)?.();
    expect(router.push).toHaveBeenCalledWith('/');
    expect(findElements(tree, 'Card')).toHaveLength(1);
  });

  it('MK-CREATORS-error-not-empty keeps loading, error, and retry separate from successful empty', async () => {
    getCatalogue.mockRejectedValue(new Error('catalogue unavailable'));
    const loading = renderScreen();
    expect(findElements(loading, 'Skeleton')).toHaveLength(2);
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

  it('MK-CREATORS-off-fallback retains the home fallback without loading creator data', () => {
    mockRuntime.enabled = false;
    const tree = renderScreen();
    const home = findElements(tree, 'Button')[0];

    expect(getCatalogue).not.toHaveBeenCalled();
    expect(home?.props.title).toBe('tabs.home');
    (home?.props.onPress as (() => void) | undefined)?.();
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it('MK-CREATORS-category-drilldown keeps ordinary category navigation available', async () => {
    const photography = category('photography', 'photo-video');
    getCatalogue.mockResolvedValue(catalogue([photography]));
    renderScreen();
    await loadAndSettle();

    const tree = renderScreen();
    const card = findElements(tree, 'Card').find((element) => element.props.accessibilityLabel === photography.name);

    expect(card).toBeTruthy();
    (card?.props.onPress as (() => void) | undefined)?.();
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/category/[slug]',
      params: { slug: photography.slug, name: photography.name },
    });
  });
});
