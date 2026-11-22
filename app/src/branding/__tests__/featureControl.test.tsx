jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('../../lib/adminApi', () => ({ getAppFeatures: jest.fn() }));
jest.mock('react-native', () => ({
  AppState: {
    currentState: 'background',
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAppFeatures } from '../../lib/adminApi';
import type { AppFeatures } from '../../lib/featureFlags';

type FeatureControlModule = typeof import('../FeatureFlagsProvider');

interface HookSlot {
  kind: 'state' | 'ref' | 'memo' | 'effect';
  value?: any;
  deps?: readonly unknown[];
  effect?: () => void | (() => void);
  cleanup?: () => void;
  hasRun?: boolean;
}

const mockHookHarness = (() => {
  const slots = new Map<string, HookSlot[]>();
  const cursors = new Map<string, number>();
  const effects = new Map<string, HookSlot[]>();
  const contexts: Array<{
    defaultValue: unknown;
    value: unknown;
    Provider: (props: { value: unknown; children?: unknown }) => unknown;
  }> = [];
  let currentComponent = '';

  function begin(component: string) {
    currentComponent = component;
    cursors.set(component, 0);
    if (!slots.has(component)) slots.set(component, []);
  }

  function nextSlot() {
    const componentSlots = slots.get(currentComponent)!;
    const index = cursors.get(currentComponent) ?? 0;
    cursors.set(currentComponent, index + 1);
    return { componentSlots, index };
  }

  function sameDeps(left: readonly unknown[] | undefined, right: readonly unknown[] | undefined): boolean {
    return !!left && !!right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  }

  return {
    begin,
    createContext(defaultValue: unknown) {
      const context = { defaultValue, value: defaultValue } as {
        defaultValue: unknown;
        value: unknown;
        Provider: (props: { value: unknown; children?: unknown }) => unknown;
      };
      context.Provider = (props) => {
        context.value = props.value;
        return props.children ?? null;
      };
      contexts.push(context);
      return context;
    },
    useState(initial: unknown) {
      const { componentSlots, index } = nextSlot();
      if (!componentSlots[index]) {
        componentSlots[index] = {
          kind: 'state',
          value: typeof initial === 'function' ? (initial as () => unknown)() : initial,
        };
      }
      const setValue = (next: unknown) => {
        const slot = componentSlots[index]!;
        slot.value = typeof next === 'function' ? (next as (previous: unknown) => unknown)(slot.value) : next;
      };
      return [componentSlots[index]!.value, setValue] as const;
    },
    useRef(initial: unknown) {
      const { componentSlots, index } = nextSlot();
      if (!componentSlots[index]) componentSlots[index] = { kind: 'ref', value: { current: initial } };
      return componentSlots[index]!.value;
    },
    useMemo(factory: () => unknown, deps: readonly unknown[]) {
      const { componentSlots, index } = nextSlot();
      const slot = componentSlots[index];
      if (!slot || !sameDeps(slot.deps, deps)) {
        componentSlots[index] = { kind: 'memo', deps, value: factory() };
      }
      return componentSlots[index]!.value;
    },
    useCallback(callback: (...args: any[]) => any, deps: readonly unknown[]) {
      return this.useMemo(() => callback, deps);
    },
    useEffect(effect: () => void | (() => void), deps: readonly unknown[]) {
      const { componentSlots, index } = nextSlot();
      const slot = componentSlots[index];
      if (!slot || !sameDeps(slot.deps, deps)) {
        const record: HookSlot = { kind: 'effect', deps, effect, hasRun: false };
        componentSlots[index] = record;
        const componentEffects = effects.get(currentComponent) ?? [];
        componentEffects.push(record);
        effects.set(currentComponent, componentEffects);
      }
    },
    useContext(context: { defaultValue: unknown; value: unknown }) {
      nextSlot();
      return context.value ?? context.defaultValue;
    },
    renderElement(element: { type: unknown; props: { value: unknown; children?: unknown } }) {
      const render = element.type as (props: { value: unknown; children?: unknown }) => unknown;
      return render(element.props);
    },
    runEffects(component: string) {
      for (const record of effects.get(component) ?? []) {
        if (record.hasRun) continue;
        record.hasRun = true;
        const cleanup = record.effect?.();
        if (typeof cleanup === 'function') record.cleanup = cleanup;
      }
    },
    cleanup() {
      for (const componentEffects of effects.values()) {
        for (const record of componentEffects) record.cleanup?.();
      }
    },
    reset() {
      this.cleanup();
      slots.clear();
      cursors.clear();
      effects.clear();
      for (const context of contexts) context.value = context.defaultValue;
    },
  };
})();

let featureControl: FeatureControlModule;
let DEFAULT_FEATURES: AppFeatures;
let acceptsFeatureControlSequence: FeatureControlModule['acceptsFeatureControlSequence'];
let featureControlAfterRefreshError: FeatureControlModule['featureControlAfterRefreshError'];
let featureFlagsView: FeatureControlModule['featureFlagsView'];
let getGuestRouteDisposition: FeatureControlModule['getGuestRouteDisposition'];
let hasFeatureControlDecision: FeatureControlModule['hasFeatureControlDecision'];
let parseAppearanceCache: FeatureControlModule['parseAppearanceCache'];
let parseFeatureResponse: FeatureControlModule['parseFeatureResponse'];
let parseFlagsCache: FeatureControlModule['parseFlagsCache'];
const getAppFeaturesMock = getAppFeatures as jest.MockedFunction<typeof getAppFeatures>;
const storageGetItem = AsyncStorage.getItem as jest.Mock;
const storageSetItem = AsyncStorage.setItem as jest.Mock;

beforeAll(() => {
  jest.doMock('react', () => {
    const actual = jest.requireActual('react');
    return {
      ...actual,
      createContext: (defaultValue: unknown) => mockHookHarness.createContext(defaultValue),
      useCallback: (callback: (...args: any[]) => any, deps: readonly unknown[]) =>
        mockHookHarness.useCallback(callback, deps),
      useContext: (context: { defaultValue: unknown; value: unknown }) => mockHookHarness.useContext(context),
      useEffect: (effect: () => void | (() => void), deps: readonly unknown[]) =>
        mockHookHarness.useEffect(effect, deps),
      useMemo: (factory: () => unknown, deps: readonly unknown[]) => mockHookHarness.useMemo(factory, deps),
      useRef: (initial: unknown) => mockHookHarness.useRef(initial),
      useState: (initial: unknown) => mockHookHarness.useState(initial),
    };
  });
  featureControl = require('../FeatureFlagsProvider') as FeatureControlModule;
  DEFAULT_FEATURES = featureControl.DEFAULT_FEATURES;
  acceptsFeatureControlSequence = featureControl.acceptsFeatureControlSequence;
  featureControlAfterRefreshError = featureControl.featureControlAfterRefreshError;
  featureFlagsView = featureControl.featureFlagsView;
  getGuestRouteDisposition = featureControl.getGuestRouteDisposition;
  hasFeatureControlDecision = featureControl.hasFeatureControlDecision;
  parseAppearanceCache = featureControl.parseAppearanceCache;
  parseFeatureResponse = featureControl.parseFeatureResponse;
  parseFlagsCache = featureControl.parseFlagsCache;
});

beforeEach(() => {
  mockHookHarness.reset();
  storageGetItem.mockReset().mockResolvedValue(null);
  storageSetItem.mockReset().mockResolvedValue(undefined);
  getAppFeaturesMock.mockReset().mockResolvedValue(makeFeatures());
});

afterEach(() => {
  mockHookHarness.cleanup();
});

function makeFeatures(overrides: Record<string, unknown> = {}): AppFeatures {
  return {
    ...featureControl.DEFAULT_FEATURES,
    guest_browse: false,
    oorva_brand: false,
    oorva_home_ux: false,
    ...overrides,
  } as AppFeatures;
}

function renderProvider() {
  mockHookHarness.begin('provider');
  const element = featureControl.FeatureFlagsProvider({ children: null });
  mockHookHarness.renderElement(element);
  return element.props.value as {
    features: AppFeatures;
    freshness: 'cache' | 'live' | 'fallback' | 'error';
    appearanceCandidate: unknown;
    refresh: () => Promise<void>;
    hydrationReady: boolean;
  };
}

function readControlState() {
  mockHookHarness.begin('control-state');
  const state = featureControl.useFeatureControlState();
  mockHookHarness.begin('hydration-state');
  const hydrationReady = featureControl.useFeatureControlHydrationReady();
  return { ...state, hydrationReady };
}

function guestDisposition(state: ReturnType<typeof readControlState>) {
  const isPotentialGuestEntryRoute = true;
  const canEnterAsGuest =
    featureControl.featureFlagsView(state.features).isOn('guest_browse') && isPotentialGuestEntryRoute;
  return featureControl.getGuestRouteDisposition({
    controlsReady: state.hydrationReady,
    restoreStatus: 'known-null',
    inAuthGroup: false,
    onPublicPage: false,
    potentialGuestEntryRoute: isPotentialGuestEntryRoute,
    canEnterAsGuest,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushProviderWork() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

async function mountProvider() {
  renderProvider();
  mockHookHarness.runEffects('provider');
  await flushProviderWork();
  return renderProvider();
}

describe('shared feature-control state', () => {
  it('hydrates cached guest controls offline and preserves archetypes after refresh failure', () => {
    const cached = makeFeatures({
      guest_browse: true,
      archetypes: { inspect_quote: false, fixed: true, time_based: true, proposal: false },
    });
    const hydrated = parseFlagsCache(JSON.stringify({ version: 1, features: cached }));
    expect(hydrated).toEqual(cached);

    const afterFailure = featureControlAfterRefreshError(
      { features: hydrated!, freshness: 'cache', appearanceCandidate: undefined },
      true,
    );
    const flags = featureFlagsView(afterFailure.features);

    expect(afterFailure.freshness).toBe('error');
    expect(flags.isOn('guest_browse')).toBe(true);
    expect(flags.archetypes).toEqual(cached.archetypes);
  });

  it('accepts valid OFF flags while passing an invalid appearance candidate through unchanged', () => {
    const candidate = { schemaVersion: 999, assets: ['missing://logo.png'] };
    const response = parseFeatureResponse({
      features: makeFeatures({ oorva_brand: false, oorva_home_ux: false }),
      appearanceCandidate: candidate,
    });

    expect(response?.appearanceCandidate).toEqual(candidate);
    expect(featureFlagsView(response!.features).isOn('oorva_brand')).toBe(false);
    expect(featureFlagsView(response!.features).isOn('oorva_home_ux')).toBe(false);
    expect(response?.features.archetypes).toEqual(DEFAULT_FEATURES.archetypes);
  });

  it('uses the exact legacy defaults when no valid cache is available', () => {
    const initial = {
      features: DEFAULT_FEATURES,
      freshness: 'fallback' as const,
      appearanceCandidate: undefined,
    };
    const fallback = featureControlAfterRefreshError(initial, false);

    expect(fallback.freshness).toBe('fallback');
    expect(fallback.features).toEqual(DEFAULT_FEATURES);
    expect(featureFlagsView(fallback.features).isOn('ai_assistant')).toBe(true);
    expect(featureFlagsView(fallback.features).isOn('guest_browse')).toBe(false);
    expect(fallback.features.archetypes).toEqual(DEFAULT_FEATURES.archetypes);
  });

  it('waits after a no-cache read for delayed live guest_browse ON, then enters the guest route', () => {
    const route = ['category', 'cleaning'];
    const isPotentialGuestEntryRoute = route[0] === 'category';
    const stillPendingAfterDeadline = hasFeatureControlDecision({
      hasValidSnapshot: false,
      cacheReadSettled: true,
      latestLiveFetchFailed: false,
    });

    expect(stillPendingAfterDeadline).toBe(false);
    expect(
      getGuestRouteDisposition({
        controlsReady: stillPendingAfterDeadline,
        restoreStatus: 'known-null',
        inAuthGroup: false,
        onPublicPage: false,
        potentialGuestEntryRoute: isPotentialGuestEntryRoute,
        canEnterAsGuest: false,
      }),
    ).toBe('wait');

    const liveFeatures = makeFeatures({ guest_browse: true });
    const liveGuestBrowse = featureFlagsView(liveFeatures).isOn('guest_browse');
    expect(liveGuestBrowse).toBe(true);
    expect(
      getGuestRouteDisposition({
        controlsReady: hasFeatureControlDecision({
          hasValidSnapshot: true,
          cacheReadSettled: true,
          latestLiveFetchFailed: false,
        }),
        restoreStatus: 'known-null',
        inAuthGroup: false,
        onPublicPage: false,
        potentialGuestEntryRoute: isPotentialGuestEntryRoute,
        canEnterAsGuest: liveGuestBrowse && isPotentialGuestEntryRoute,
      }),
    ).toBe('guest');
  });

  it('keeps a valid cached guest_browse OFF blocked', () => {
    const cachedGuestBrowse = featureFlagsView(makeFeatures({ guest_browse: false })).isOn('guest_browse');
    const controlsReady = hasFeatureControlDecision({
      hasValidSnapshot: true,
      cacheReadSettled: true,
      latestLiveFetchFailed: false,
    });

    expect(controlsReady).toBe(true);
    expect(cachedGuestBrowse).toBe(false);
    expect(
      getGuestRouteDisposition({
        controlsReady,
        restoreStatus: 'known-null',
        inAuthGroup: false,
        onPublicPage: false,
        potentialGuestEntryRoute: true,
        canEnterAsGuest: cachedGuestBrowse,
      }),
    ).toBe('redirect');
  });

  it('keeps a valid live guest_browse OFF blocked', () => {
    const liveGuestBrowse = featureFlagsView(makeFeatures({ guest_browse: false })).isOn('guest_browse');
    const controlsReady = hasFeatureControlDecision({
      hasValidSnapshot: true,
      cacheReadSettled: true,
      latestLiveFetchFailed: false,
    });

    expect(controlsReady).toBe(true);
    expect(liveGuestBrowse).toBe(false);
    expect(
      getGuestRouteDisposition({
        controlsReady,
        restoreStatus: 'known-null',
        inAuthGroup: false,
        onPublicPage: false,
        potentialGuestEntryRoute: true,
        canEnterAsGuest: liveGuestBrowse,
      }),
    ).toBe('redirect');
  });

  it('waits for cache settlement before failing closed after a live-fetch failure', () => {
    const stillPending = hasFeatureControlDecision({
      hasValidSnapshot: false,
      cacheReadSettled: false,
      latestLiveFetchFailed: true,
    });
    expect(stillPending).toBe(false);
    expect(
      getGuestRouteDisposition({
        controlsReady: stillPending,
        restoreStatus: 'known-null',
        inAuthGroup: false,
        onPublicPage: false,
        potentialGuestEntryRoute: true,
        canEnterAsGuest: false,
      }),
    ).toBe('wait');

    const failClosed = hasFeatureControlDecision({
      hasValidSnapshot: false,
      cacheReadSettled: true,
      latestLiveFetchFailed: true,
    });
    const fallbackGuestBrowse = featureFlagsView(DEFAULT_FEATURES).isOn('guest_browse');
    expect(failClosed).toBe(true);
    expect(fallbackGuestBrowse).toBe(false);
    expect(
      getGuestRouteDisposition({
        controlsReady: failClosed,
        restoreStatus: 'known-null',
        inAuthGroup: false,
        onPublicPage: false,
        potentialGuestEntryRoute: true,
        canEnterAsGuest: fallbackGuestBrowse,
      }),
    ).toBe('redirect');
  });

  it('fails closed once cache resolution confirms there is no valid guest snapshot', () => {
    const controlsReady = hasFeatureControlDecision({
      hasValidSnapshot: false,
      cacheReadSettled: true,
      latestLiveFetchFailed: true,
    });
    const guestBrowse = featureFlagsView(DEFAULT_FEATURES).isOn('guest_browse');

    expect(controlsReady).toBe(true);
    expect(guestBrowse).toBe(false);
    expect(
      getGuestRouteDisposition({
        controlsReady,
        restoreStatus: 'known-null',
        inAuthGroup: false,
        onPublicPage: false,
        potentialGuestEntryRoute: true,
        canEnterAsGuest: false,
      }),
    ).toBe('redirect');
  });

  it('keeps flag and appearance caches separate and ignores invalid cache encodings', () => {
    const features = makeFeatures({ guest_browse: true });
    expect(parseFlagsCache(JSON.stringify({ version: 1, features }))).toEqual(features);
    expect(parseAppearanceCache(JSON.stringify({ version: 1, candidate: { version: 99 } }))).toEqual({
      found: true,
      candidate: { version: 99 },
    });
    expect(parseFlagsCache('not-json')).toBeNull();
    expect(parseAppearanceCache('not-json')).toEqual({ found: false });
  });

  it('rejects stale request results after a newer response has settled', () => {
    expect(acceptsFeatureControlSequence(3, 2)).toBe(true);
    expect(acceptsFeatureControlSequence(2, 3)).toBe(false);
  });
});

describe('rendered FeatureFlagsProvider guest settlement', () => {
  it('holds a known-null guest route during an empty-cache live request, then enters on live ON', async () => {
    const liveResponse = deferred<AppFeatures>();
    getAppFeaturesMock.mockReturnValueOnce(liveResponse.promise);

    await mountProvider();
    expect(storageGetItem).toHaveBeenCalledTimes(2);
    expect(storageGetItem).toHaveReturnedTimes(2);
    expect(getAppFeaturesMock).toHaveBeenCalledTimes(1);

    const pending = readControlState();
    expect(pending.hydrationReady).toBe(false);
    expect(guestDisposition(pending)).toBe('wait');

    liveResponse.resolve(makeFeatures({ guest_browse: true }));
    await flushProviderWork();
    renderProvider();
    const settled = readControlState();

    expect(settled.hydrationReady).toBe(true);
    expect(settled.freshness).toBe('live');
    expect(guestDisposition(settled)).toBe('guest');
  });

  it('settles an empty-cache live OFF response as blocked', async () => {
    const liveResponse = deferred<AppFeatures>();
    getAppFeaturesMock.mockReturnValueOnce(liveResponse.promise);

    await mountProvider();
    const pending = readControlState();
    expect(pending.hydrationReady).toBe(false);
    expect(guestDisposition(pending)).toBe('wait');

    liveResponse.resolve(makeFeatures({ guest_browse: false }));
    await flushProviderWork();
    renderProvider();
    const settled = readControlState();

    expect(settled.hydrationReady).toBe(true);
    expect(settled.freshness).toBe('live');
    expect(guestDisposition(settled)).toBe('redirect');
  });

  it('settles an empty-cache live-fetch failure to fail-closed fallback', async () => {
    getAppFeaturesMock.mockRejectedValueOnce(new Error('offline'));

    await mountProvider();
    const settled = readControlState();

    expect(settled.hydrationReady).toBe(true);
    expect(settled.freshness).toBe('fallback');
    expect(settled.features.guest_browse).toBeUndefined();
    expect(guestDisposition(settled)).toBe('redirect');
  });
});
