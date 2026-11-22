import type React from 'react';
import type { Catalogue } from '../../catalogue/model';

const mockRuntime: {
  city: string;
  hookIndex: number;
  states: unknown[];
  load: ((guard: { isCurrent: () => boolean }) => Promise<void>) | null;
  lastRefresh: Promise<void> | null;
} = { city: 'City A', hookIndex: 0, states: [], load: null, lastRefresh: null };

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

jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  TextInput: 'TextInput',
  View: 'View',
  useWindowDimensions: () => ({ width: 390 }),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('../../../components/CategoryIcon', () => ({
  CategoryIcon: 'CategoryIcon',
  iconForCategory: () => 'construct-outline',
}));
jest.mock('../../../components/market/ChipRow', () => ({ ChipRow: 'ChipRow' }));
jest.mock('../../../components/market/PillarCard', () => ({ PillarCard: 'PillarCard' }));
jest.mock('../../../components/market/SearchField', () => ({ SearchField: 'SearchField' }));
jest.mock('../../../components/market/TrustStrip', () => ({ TrustStrip: 'TrustStrip' }));
jest.mock('../../../components/market/pillars', () => ({ visiblePillars: () => [] }));
jest.mock('../../../components/NotServedCard', () => ({ NotServedCard: 'NotServedCard' }));
jest.mock('../../../components/TopRatedCard', () => ({ TopRatedCard: 'TopRatedCard' }));
jest.mock('../../../components/status', () => ({
  StatusPill: 'StatusPill',
  activeStatuses: ['confirmed'],
  nextStepCopy: {},
}));
jest.mock('../../../components/StatusTimeline', () => ({ ProgressBar: 'ProgressBar' }));
jest.mock('../../../components/ui', () => ({
  Card: 'Card',
  EmptyState: 'EmptyState',
  ErrorState: 'ErrorState',
  IconButton: 'IconButton',
  InlineAlert: 'InlineAlert',
  Screen: 'Screen',
  Section: 'Section',
  Skeleton: 'Skeleton',
  Text: 'Text',
}));
jest.mock('../../../i18n', () => ({ useT: () => (key: string) => key }));
jest.mock('../../../lib/api', () => ({
  listMyBookings: jest.fn(),
  listTopRated: jest.fn(),
}));
jest.mock('../../../lib/config', () => ({ aiAssistantEnabled: false }));
jest.mock('../../../lib/locationContext', () => ({
  useSelectedLocation: () => ({ location: { city: mockRuntime.city, area: mockRuntime.city, source: 'area' } }),
}));
jest.mock('../../../lib/locationModel', () => ({ needsLocationPrompt: () => false }));
jest.mock('../../../lib/unreadContext', () => ({ useUnread: () => ({ total: () => 0, notifications: 0 }) }));
jest.mock('../../../theme', () => ({
  useTheme: () => ({
    spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, section: 24 },
    radii: { md: 12, lg: 16, pill: 999 },
    colors: { bg: '#fff', text: '#111', muted: '#666', surface: '#fff', surfaceAlt: '#eee', primary: '#123', primarySoft: '#def', primaryText: '#123', onPrimary: '#fff', border: '#ccc', borderStrong: '#aaa', subtle: '#888', textSecondary: '#444' },
    typography: { body: {} },
    shadows: { sm: {} },
    dark: false,
  }),
}));
jest.mock('../../catalogue/api', () => ({ getCatalogue: jest.fn() }));
jest.mock('../../catalogue/CatalogueSections', () => ({ CatalogueSections: 'CatalogueSections' }));
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
const { listMyBookings, listTopRated } = require('../../../lib/api') as {
  listMyBookings: jest.Mock;
  listTopRated: jest.Mock;
};
const { getCatalogue } = require('../../catalogue/api') as { getCatalogue: jest.Mock };
const { HomeV2 } = require('../HomeV2') as typeof import('../HomeV2');

function catalogue(slug: string): Catalogue {
  return {
    categories: [{ id: slug, slug, name: slug, icon: 'construct', pricing_mode: 'quote', sort_order: 1, vertical: 'home-repairs', archetype: 'inspect_quote' }],
    verticals: [],
  } as Catalogue;
}

function renderHome() {
  mockRuntime.hookIndex = 0;
  return HomeV2({ flags: { isOn: () => false } });
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
  mockRuntime.lastRefresh = null;
  getCatalogue.mockReset();
  listTopRated.mockReset();
  listMyBookings.mockReset();
});

describe('HomeV2 freshness', () => {
  it('MK-FRESH-home-independent-results keeps catalogue and work errors independently retryable', async () => {
    getCatalogue.mockResolvedValue(catalogue('city-a-service'));
    listTopRated.mockRejectedValue(new Error('ratings unavailable'));
    listMyBookings.mockRejectedValue(new Error('bookings unavailable'));
    renderHome();
    await mockRuntime.load!({ isCurrent: () => true });

    let tree = renderHome();
    expect(elements(tree, 'ChipRow')).toHaveLength(1);
    expect(elements(tree, 'ErrorState')).toHaveLength(0);
    const alerts = elements(tree, 'InlineAlert');
    expect(alerts).toHaveLength(2);
    expect(alerts.map((alert) => alert.props.message)).toEqual(
      expect.arrayContaining(['ratings unavailable', 'bookings unavailable']),
    );

    getCatalogue.mockResolvedValue(catalogue('city-a-service'));
    listTopRated.mockResolvedValue([]);
    listMyBookings.mockResolvedValue([]);
    (alerts[0]!.props.onAction as () => void)();
    await mockRuntime.lastRefresh;
    tree = renderHome();
    expect(elements(tree, 'InlineAlert')).toHaveLength(0);
  });

  it('MK-FRESH-home-scope-cleanup ignores a slower prior-city result', async () => {
    const cityA = deferred<Catalogue>();
    const cityB = deferred<Catalogue>();
    getCatalogue.mockImplementation((city: string) => city === 'City A' ? cityA.promise : cityB.promise);
    listTopRated.mockResolvedValue([]);
    listMyBookings.mockResolvedValue([]);

    renderHome();
    let activeA = true;
    const pendingA = mockRuntime.load!({ isCurrent: () => activeA });

    mockRuntime.city = 'City B';
    renderHome();
    activeA = false;
    const pendingB = mockRuntime.load!({ isCurrent: () => true });
    cityB.resolve(catalogue('city-b-service'));
    await pendingB;
    cityA.resolve(catalogue('city-a-service'));
    await pendingA;

    const rows = elements(renderHome(), 'ChipRow');
    expect((rows[0]?.props.options as Array<{ value: string }>).map(({ value }) => value)).toEqual(['city-b-service']);
  });
});
