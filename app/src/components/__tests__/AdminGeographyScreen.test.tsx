import type React from 'react';
import type { GeographyTree } from '../../lib/geographyApi';

const mockRuntime = {
  slots: [] as Array<{ kind: string; value?: unknown; deps?: unknown[]; cleanup?: () => void }>,
  cursor: 0,
  pendingEffects: [] as number[],
  refreshLoad: undefined as ((guard: { isCurrent: () => boolean }) => Promise<void>) | undefined,
};

jest.mock('react', () => {
  const actual = jest.requireActual<typeof import('react')>('react');
  return {
    ...actual,
    useState(initial: unknown) {
      const index = mockRuntime.cursor++;
      let slot = mockRuntime.slots[index];
      if (!slot) {
        slot = { kind: 'state', value: initial };
        mockRuntime.slots[index] = slot;
      }
      return [
        slot.value,
        (next: unknown) => {
          slot!.value = typeof next === 'function'
            ? (next as (mockCurrent: unknown) => unknown)(slot!.value)
            : next;
        },
      ];
    },
    useRef(initial: unknown) {
      const index = mockRuntime.cursor++;
      let slot = mockRuntime.slots[index];
      if (!slot) {
        slot = { kind: 'ref', value: { current: initial } };
        mockRuntime.slots[index] = slot;
      }
      return slot.value;
    },
    useCallback(callback: (...args: never[]) => unknown) {
      mockRuntime.cursor++;
      return callback;
    },
    useEffect(effect: () => void | (() => void), deps?: unknown[]) {
      const index = mockRuntime.cursor++;
      let slot = mockRuntime.slots[index];
      if (!slot) {
        slot = { kind: 'effect', deps };
        mockRuntime.slots[index] = slot;
        mockRuntime.pendingEffects.push(index);
      }
      slot.value = effect;
    },
  };
});

jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('react-native', () => ({ Switch: 'Switch', View: 'View' }));
jest.mock('../../components/ui', () => ({
  Button: 'Button',
  Card: 'Card',
  Header: 'Header',
  InlineAlert: 'InlineAlert',
  Input: 'Input',
  ListItem: 'ListItem',
  Screen: 'Screen',
  Skeleton: 'Skeleton',
  Text: 'Text',
  useToast: () => jest.fn(),
}));
jest.mock('../../lib/useEntityRefresh', () => ({
  useEntityRefresh(load: (guard: { isCurrent: () => boolean }) => Promise<void>) {
    const ReactModule = require('react') as typeof import('react');
    mockRuntime.refreshLoad = load;
    ReactModule.useEffect(() => {
      void load({ isCurrent: () => true });
    }, []);
    return {
      refresh: () => load({ isCurrent: () => true }),
      refreshing: false,
    };
  },
}));
jest.mock('../../lib/locationContext', () => ({
  resolvePlace: jest.fn(),
  searchPlaces: jest.fn(),
}));
jest.mock('../../lib/places', () => {
  let token = 0;
  return { newPlacesSession: () => `session-${++token}` };
});
jest.mock('../../lib/geographyApi', () => ({
  listGeography: jest.fn(),
  upsertGeo: jest.fn(),
}));
jest.mock('../../theme', () => ({
  useTheme: () => ({ spacing: { sm: 8, md: 16 }, radii: { lg: 12 } }),
}));

const ReactRuntime = require('react') as typeof import('react');
const { resolvePlace, searchPlaces } = require('../../lib/locationContext') as {
  resolvePlace: jest.Mock;
  searchPlaces: jest.Mock;
};
const { listGeography, upsertGeo } = require('../../lib/geographyApi') as {
  listGeography: jest.Mock;
  upsertGeo: jest.Mock;
};
const { default: AdminGeographyScreen } = require('../../features/communicationScreens/AdminGeographyScreen') as typeof import('../../features/communicationScreens/AdminGeographyScreen');

function expectJson(actual: unknown, expected: unknown) {
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
}

function renderScreen() {
  mockRuntime.cursor = 0;
  return AdminGeographyScreen();
}

function runEffects() {
  for (const index of mockRuntime.pendingEffects.splice(0)) {
    const effect = mockRuntime.slots[index]?.value as (() => void | (() => void)) | undefined;
    const cleanup = effect?.();
    if (typeof cleanup === 'function') mockRuntime.slots[index]!.cleanup = cleanup;
  }
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

function findButton(tree: unknown, title: string) {
  return findElements(tree, 'Button').find((element) => element.props.title === title);
}

function findInput(tree: unknown, label: string) {
  return findElements(tree, 'Input').find((element) => element.props.label === label);
}

function invoke(element: React.ReactElement<Record<string, unknown>> | undefined, prop: string) {
  (element?.props[prop] as (() => void) | undefined)?.();
}

function changeText(element: React.ReactElement<Record<string, unknown>> | undefined, value: string) {
  (element?.props.onChangeText as ((text: string) => void) | undefined)?.(value);
}

function openArea(tree: unknown, city: string) {
  invoke(findButton(tree, `Add area to ${city}`), 'onPress');
  return renderScreen();
}

function setQuery(tree: unknown, query: string) {
  changeText(findInput(tree, 'Search places'), query);
  return renderScreen();
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function geographyTree(): GeographyTree {
  return {
    states: [{ id: 'state-1', name: 'State', active: true }],
    districts: [{ id: 'district-1', state_id: 'state-1', name: 'District', active: true }],
    cities: [
      { id: 'city-a', district_id: 'district-1', name: 'City A', lat: null, lng: null, active: true },
      { id: 'city-b', district_id: 'district-1', name: 'City B', lat: null, lng: null, active: true },
    ],
    areas: [],
  };
}

async function mountWithGeography() {
  listGeography.mockResolvedValue(geographyTree());
  renderScreen();
  runEffects();
  await settle();
  return renderScreen();
}

beforeEach(() => {
  mockRuntime.slots = [];
  mockRuntime.cursor = 0;
  mockRuntime.pendingEffects = [];
  mockRuntime.refreshLoad = undefined;
  resolvePlace.mockReset();
  searchPlaces.mockReset();
  listGeography.mockReset();
  upsertGeo.mockReset();
});

afterEach(() => {
  for (const slot of mockRuntime.slots) slot?.cleanup?.();
});

describe('AdminGeographyScreen', () => {
  it('CM_GEO_INITIAL_ERROR shows a retry state instead of retaining the initial skeleton', async () => {
    listGeography.mockRejectedValueOnce(new Error('geography unavailable')).mockResolvedValueOnce(geographyTree());
    const loading = renderScreen();
    runEffects();
    expectJson(findElements(loading, 'Skeleton').length, 1);
    await settle();
    const failed = renderScreen();
    expectJson(findElements(failed, 'Skeleton').length, 0);
    expectJson(findElements(failed, 'InlineAlert').map(({ props }) => props.message), ['geography unavailable']);

    invoke(findElements(failed, 'InlineAlert')[0], 'onAction');
    await settle();
    const retried = renderScreen();
    expectJson(findElements(retried, 'Skeleton').length, 0);
    expectJson(Boolean(findButton(retried, 'Add state')), true);
    expectJson(listGeography.mock.calls.length, 2);
  });

  it('CM_GEO_STALE_PLACE ignores City A resolve completion after opening City B', async () => {
    const tree = await mountWithGeography();
    openArea(tree, 'City A');
    let panel = setQuery(renderScreen(), 'Central Park');

    searchPlaces.mockResolvedValueOnce([{ placeId: 'place-a', title: 'Central Park', subtitle: 'City A' }]);
    invoke(findButton(panel, 'Search places'), 'onPress');
    await settle();
    panel = renderScreen();

    const pendingResolve = deferred<{ area: string; lat: number; lng: number }>();
    resolvePlace.mockReturnValueOnce(pendingResolve.promise);
    invoke(findElements(panel, 'ListItem')[0], 'onPress');
    openArea(renderScreen(), 'City B');
    pendingResolve.resolve({ area: 'City A Park', lat: 10.1, lng: 20.2 });
    await settle();

    const cityB = renderScreen();
    expectJson(findInput(cityB, 'Area name')?.props.value ?? null, null);
    expectJson(findButton(cityB, 'Save area')?.props.title ?? null, null);
  });

  it('CM_GEO_STALE_QUERY does not let an older search replace the newer query results', async () => {
    const tree = await mountWithGeography();
    openArea(tree, 'City A');
    let panel = setQuery(renderScreen(), 'Old query');
    const oldSearch = deferred<Array<{ placeId: string; title: string; subtitle: string }>>();
    searchPlaces.mockReturnValueOnce(oldSearch.promise);
    invoke(findButton(panel, 'Search places'), 'onPress');

    panel = setQuery(renderScreen(), 'New query');
    const newSearch = deferred<Array<{ placeId: string; title: string; subtitle: string }>>();
    searchPlaces.mockReturnValueOnce(newSearch.promise);
    invoke(findButton(panel, 'Search places'), 'onPress');
    newSearch.resolve([{ placeId: 'new', title: 'New Result', subtitle: 'City A' }]);
    await settle();
    oldSearch.resolve([{ placeId: 'old', title: 'Old Result', subtitle: 'City A' }]);
    await settle();

    const results = findElements(renderScreen(), 'ListItem').map(({ props }) => props.title);
    expectJson(results, ['New Result']);
  });

  it('CM_GEO_SAVE_PARENT_MATCH saves the resolved coordinates to their originating city', async () => {
    let panel = await mountWithGeography();
    panel = openArea(panel, 'City A');
    panel = setQuery(panel, 'North Park');
    searchPlaces.mockResolvedValueOnce([{ placeId: 'place-a', title: 'North Park', subtitle: 'City A' }]);
    invoke(findButton(panel, 'Search places'), 'onPress');
    await settle();
    panel = renderScreen();

    resolvePlace.mockResolvedValueOnce({ area: 'North Park', lat: 12.34567, lng: 76.54321 });
    invoke(findElements(panel, 'ListItem')[0], 'onPress');
    await settle();
    panel = renderScreen();
    expectJson(findInput(panel, 'Area name')?.props.value, 'North Park');

    const staleSave = findButton(panel, 'Save area');
    openArea(panel, 'City B');
    invoke(staleSave, 'onPress');
    await settle();
    expectJson(upsertGeo.mock.calls.length, 0);

    panel = openArea(renderScreen(), 'City A');
    panel = setQuery(panel, 'North Park');
    searchPlaces.mockResolvedValueOnce([{ placeId: 'place-a', title: 'North Park', subtitle: 'City A' }]);
    invoke(findButton(panel, 'Search places'), 'onPress');
    await settle();
    panel = renderScreen();
    resolvePlace.mockResolvedValueOnce({ area: 'North Park', lat: 12.34567, lng: 76.54321 });
    invoke(findElements(panel, 'ListItem')[0], 'onPress');
    await settle();
    panel = renderScreen();

    upsertGeo.mockResolvedValueOnce('area-a');
    listGeography.mockResolvedValue(geographyTree());
    invoke(findButton(panel, 'Save area'), 'onPress');
    await settle();

    expectJson(upsertGeo.mock.calls[0]?.[0], {
      kind: 'area',
      parentId: 'city-a',
      name: 'North Park',
      lat: 12.34567,
      lng: 76.54321,
      active: true,
    });
  });
});
