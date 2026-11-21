import React from 'react';
import { AppState, Platform } from 'react-native';
const mockDom = new (require('jsdom').JSDOM)('<!doctype html><html><body></body></html>');
Object.defineProperty(globalThis, 'window', { configurable: true, value: mockDom.window });
Object.defineProperty(globalThis, 'document', { configurable: true, value: mockDom.window.document });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: mockDom.window.navigator });
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type FocusEntry = { focus: () => void; blur: () => void };
const mockFocusManager = {
  focused: false,
  entries: new Set<FocusEntry>(),
  setFocused(next: boolean) {
    if (this.focused === next) return;
    this.focused = next;
    for (const entry of [...this.entries]) {
      if (next) entry.focus();
      else entry.blur();
    }
  },
};

jest.doMock('expo-router', () => {
  const ReactModule = require('react') as typeof React;
  return {
    useFocusEffect(callback: () => void | (() => void)) {
      const callbackRef = ReactModule.useRef(callback);
      callbackRef.current = callback;
      ReactModule.useEffect(() => {
        let cleanup: (() => void) | undefined;
        const entry: FocusEntry = {
          focus: () => {
            cleanup?.();
            const result = callbackRef.current();
            cleanup = typeof result === 'function' ? result : undefined;
          },
          blur: () => {
            cleanup?.();
            cleanup = undefined;
          },
        };
        mockFocusManager.entries.add(entry);
        if (mockFocusManager.focused) entry.focus();
        return () => {
          entry.blur();
          mockFocusManager.entries.delete(entry);
        };
      }, []);
    },
  };
});

const { useEntityRefresh } = require('../useEntityRefresh') as typeof import('../useEntityRefresh');
const { createRoot } = require('react-dom/client') as {
  createRoot: (container: Element) => TestRoot;
};
const testAct = require('react').act as (callback: () => void | Promise<void>) => Promise<void>;

type HookLoad = Parameters<typeof useEntityRefresh>[0];
type HookOptions = Parameters<typeof useEntityRefresh>[1];
type HookResult = ReturnType<typeof useEntityRefresh>;
type TestRoot = {
  render: (element: React.ReactElement) => void;
  unmount: () => void;
};

let mockResult: HookResult | undefined;
let mockAppState = 'active';
const mockAppStateListeners = new Set<(state: string) => void>();
let mockRoot: TestRoot | undefined;
const mockIntervals = new Set<ReturnType<typeof setInterval>>();

function HookHarness({ load, options }: { load: HookLoad; options: HookOptions }) {
  mockResult = useEntityRefresh(load, options);
  return null;
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

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function mount(load: HookLoad, options: HookOptions) {
  await testAct(async () => {
    mockRoot = createRoot(document.createElement('div'));
    mockRoot.render(React.createElement(HookHarness, { load, options }));
    await flushMicrotasks();
  });
}

async function focus(next: boolean) {
  await testAct(async () => {
    mockFocusManager.setFocused(next);
    await flushMicrotasks();
  });
}

async function setAppState(state: string) {
  await testAct(async () => {
    mockAppState = state;
    for (const listener of [...mockAppStateListeners]) listener(state);
    await flushMicrotasks();
  });
}

async function setVisibility(state: 'visible' | 'hidden') {
  await testAct(async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
    document.dispatchEvent(new window.Event('visibilitychange'));
    await flushMicrotasks();
  });
}

function render(load: HookLoad, options: HookOptions) {
  mockRoot!.render(React.createElement(HookHarness, { load, options }));
}

const platformOsDescriptor = Object.getOwnPropertyDescriptor(Platform, 'OS');
const appStateDescriptor = Object.getOwnPropertyDescriptor(AppState, 'currentState');

beforeEach(() => {
  jest.useFakeTimers();
  mockIntervals.clear();
  const scheduleInterval = globalThis.setInterval.bind(globalThis);
  const cancelInterval = globalThis.clearInterval.bind(globalThis);
  jest.spyOn(globalThis, 'setInterval').mockImplementation((handler, timeout, ...args) => {
    const interval = scheduleInterval(handler, timeout, ...args);
    mockIntervals.add(interval);
    return interval;
  });
  jest.spyOn(globalThis, 'clearInterval').mockImplementation((interval) => {
    if (interval !== null && interval !== undefined) {
      mockIntervals.delete(interval as ReturnType<typeof setInterval>);
    }
    cancelInterval(interval);
  });
  mockFocusManager.focused = false;
  mockFocusManager.entries.clear();
  mockAppState = 'active';
  mockAppStateListeners.clear();
  mockResult = undefined;
  mockRoot = undefined;
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  Object.defineProperty(AppState, 'currentState', { configurable: true, get: () => mockAppState });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((eventName, listener) => {
    if (eventName === 'change') {
      const callback = listener as (state: string) => void;
      mockAppStateListeners.add(callback);
      return { remove: () => mockAppStateListeners.delete(callback) };
    }
    return { remove: jest.fn() };
  }) as typeof AppState.addEventListener);
});

afterEach(async () => {
  if (mockRoot) {
    await testAct(async () => {
      mockRoot!.unmount();
      await flushMicrotasks();
    });
  }
  mockRoot = undefined;
  mockFocusManager.setFocused(false);
  mockAppStateListeners.clear();
  jest.clearAllTimers();
  jest.restoreAllMocks();
  jest.useRealTimers();
  mockIntervals.clear();
  if (platformOsDescriptor) Object.defineProperty(Platform, 'OS', platformOsDescriptor);
  else delete (Platform as { OS?: string }).OS;
  if (appStateDescriptor) Object.defineProperty(AppState, 'currentState', appStateDescriptor);
  else delete (AppState as { currentState?: string }).currentState;
});

afterAll(() => mockDom.window.close());

describe('useEntityRefresh', () => {
  it('resolves disabled manual refreshes without loading and resumes when enabled', async () => {
    mockFocusManager.focused = true;
    const guards: Array<{ isCurrent: () => boolean }> = [];
    const load: HookLoad = async (guard) => {
      guards.push(guard);
    };

    await mount(load, { contextKey: 'project:actor:entity:scope', enabled: false, intervalMs: 1_000 });
    await mockResult!.refresh();
    expect(guards).toHaveLength(0);
    expect(mockIntervals.size).toBe(0);

    await testAct(async () => {
      render(load, { contextKey: 'project:actor:entity:scope', enabled: true, intervalMs: 1_000 });
      await flushMicrotasks();
    });
    expect(guards).toHaveLength(1);
    expect(mockIntervals.size).toBe(1);

    await testAct(async () => {
      render(load, { contextKey: 'project:actor:entity:scope', enabled: false, intervalMs: 1_000 });
      await flushMicrotasks();
    });
    expect(guards[0]!.isCurrent()).toBe(false);
    await mockResult!.refresh();
    expect(guards).toHaveLength(1);
    expect(mockIntervals.size).toBe(0);
  });

  it('resumes only when focused, active and visible; pauses reads and its interval on each loss', async () => {
    mockAppState = 'background';
    Object.defineProperty(AppState, 'currentState', { configurable: true, get: () => mockAppState });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    const guards: Array<{ isCurrent: () => boolean }> = [];
    const load: HookLoad = async (guard) => {
      guards.push(guard);
    };

    await mount(load, { contextKey: 'project:actor:entity:scope', enabled: true, intervalMs: 60_000 });
    await mockResult!.refresh();
    expect(guards).toHaveLength(0);

    await setAppState('active');
    await setVisibility('visible');
    expect(guards).toHaveLength(0);

    await focus(true);
    expect(guards).toHaveLength(1);
    expect(mockIntervals.size).toBe(1);

    await setVisibility('hidden');
    expect(guards[0]!.isCurrent()).toBe(false);
    expect(mockIntervals.size).toBe(0);
    await mockResult!.refresh();
    expect(guards).toHaveLength(1);

    await setVisibility('visible');
    expect(guards).toHaveLength(2);
    await setAppState('background');
    expect(guards[1]!.isCurrent()).toBe(false);
    expect(mockIntervals.size).toBe(0);
    await mockResult!.refresh();
    expect(guards).toHaveLength(2);

    await setAppState('active');
    expect(guards).toHaveLength(3);
    await focus(false);
    expect(guards[2]!.isCurrent()).toBe(false);
    expect(mockIntervals.size).toBe(0);
  });

  it('uses one interval and skips periodic refresh while the current read is pending', async () => {
    mockFocusManager.focused = true;
    const firstRead = deferred<void>();
    let calls = 0;
    const load: HookLoad = () => {
      calls += 1;
      return calls === 1 ? firstRead.promise : Promise.resolve();
    };

    await mount(load, { contextKey: 'project:actor:entity:scope', enabled: true, intervalMs: 1_000 });
    expect(calls).toBe(1);
    expect(mockResult!.refreshing).toBe(true);
    expect(mockIntervals.size).toBe(1);

    await testAct(async () => {
      jest.advanceTimersByTime(5_000);
      await flushMicrotasks();
    });
    expect(calls).toBe(1);
    expect(mockIntervals.size).toBe(1);

    await testAct(async () => {
      firstRead.resolve();
      await flushMicrotasks();
    });
    await testAct(async () => {
      jest.advanceTimersByTime(1_000);
      await flushMicrotasks();
    });
    expect(calls).toBe(2);
    expect(mockIntervals.size).toBe(1);

    await focus(false);
    expect(mockIntervals.size).toBe(0);
  });

  it('invalidates the active request and clears its interval on unmount', async () => {
    mockFocusManager.focused = true;
    const read = deferred<void>();
    let activeGuard: { isCurrent: () => boolean } | undefined;
    const load: HookLoad = (guard) => {
      activeGuard = guard;
      return read.promise;
    };

    await mount(load, { contextKey: 'project:actor:entity:scope', enabled: true, intervalMs: 1_000 });
    expect(activeGuard?.isCurrent()).toBe(true);
    expect(mockIntervals.size).toBe(1);

    await testAct(async () => {
      mockRoot!.unmount();
      mockRoot = undefined;
      await flushMicrotasks();
    });
    expect(activeGuard?.isCurrent()).toBe(false);
    expect(mockIntervals.size).toBe(0);
    read.resolve();
    await flushMicrotasks();
  });

  it('starts the new actor/entity read without waiting for an obsolete request or stale error', async () => {
    mockFocusManager.focused = true;
    const firstA = deferred<void>();
    const secondA = deferred<void>();
    const readA = [firstA, secondA];
    const guardsA: Array<{ isCurrent: () => boolean }> = [];
    let callsA = 0;
    const snapshots: string[] = [];
    const loadA: HookLoad = async (guard) => {
      guardsA.push(guard);
      await readA[callsA++]!.promise;
      if (guard.isCurrent()) snapshots.push('actor-a');
    };
    const draft = { value: 'unsaved text' };

    await mount(loadA, { contextKey: 'project:actor-a:entity-1:scope-a', enabled: true, intervalMs: null });
    let oldRefresh!: Promise<void>;
    await testAct(async () => {
      oldRefresh = mockResult!.refresh();
      await flushMicrotasks();
    });
    expect(callsA).toBe(2);
    expect(guardsA[0]!.isCurrent()).toBe(false);

    const readB = deferred<void>();
    let guardB: { isCurrent: () => boolean } | undefined;
    const loadB: HookLoad = async (guard) => {
      guardB = guard;
      await readB.promise;
      if (guard.isCurrent()) snapshots.push('actor-b');
    };
    await testAct(async () => {
      render(loadB, { contextKey: 'project:actor-b:entity-1:scope-a', enabled: true, intervalMs: null });
      await flushMicrotasks();
    });
    await expect(oldRefresh).resolves.toBeUndefined();
    expect(guardsA[1]!.isCurrent()).toBe(false);
    expect(guardB?.isCurrent()).toBe(true);

    await testAct(async () => {
      readB.resolve();
      await flushMicrotasks();
    });
    await testAct(async () => {
      secondA.reject(new Error('stale actor read failed'));
      firstA.reject(new Error('superseded actor read failed'));
      await flushMicrotasks();
    });
    expect(snapshots).toEqual(['actor-b']);
    expect(draft.value).toBe('unsaved text');
  });

  it('coalesces same-turn explicit refreshes and lets only the newest run clear refreshing', async () => {
    mockFocusManager.focused = true;
    const obsoleteRead = deferred<void>();
    const latestRead = deferred<void>();
    let calls = 0;
    const load: HookLoad = () => {
      calls += 1;
      return calls === 1 ? obsoleteRead.promise : latestRead.promise;
    };

    await mount(load, { contextKey: 'project:actor:entity:scope', enabled: true, intervalMs: null });
    let firstRefresh!: Promise<void>;
    let secondRefresh!: Promise<void>;
    await testAct(async () => {
      firstRefresh = mockResult!.refresh();
      secondRefresh = mockResult!.refresh();
      await flushMicrotasks();
    });
    expect(calls).toBe(2);
    expect(mockResult!.refreshing).toBe(true);

    await testAct(async () => {
      obsoleteRead.resolve();
      await flushMicrotasks();
    });
    expect(mockResult!.refreshing).toBe(true);

    await testAct(async () => {
      latestRead.resolve();
      await Promise.all([firstRefresh, secondRefresh]);
      await flushMicrotasks();
    });
    expect(mockResult!.refreshing).toBe(false);
  });
});
