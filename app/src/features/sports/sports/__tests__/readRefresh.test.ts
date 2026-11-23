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

const { useSportsReadRefresh } = require('../../useSportsReadRefresh') as typeof import('../../useSportsReadRefresh');
const { createRoot } = require('react-dom/client') as {
  createRoot: (container: Element) => TestRoot;
};
const testAct = require('react').act as (callback: () => void | Promise<void>) => Promise<void>;

type HookLoad = Parameters<typeof useSportsReadRefresh>[0];
type HookOptions = Parameters<typeof useSportsReadRefresh>[1];
type HookResult = ReturnType<typeof useSportsReadRefresh>;
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
  mockResult = useSportsReadRefresh(load, options);
  return null;
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
    if (interval !== null && interval !== undefined) mockIntervals.delete(interval as ReturnType<typeof setInterval>);
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

describe('SP-ONE-TIMER and SP-BLUR-CLEANUP', () => {
  it('runs one focused interval and ignores the prior focus generation after blur', async () => {
    const guards: Array<{ isCurrent: () => boolean }> = [];
    const load: HookLoad = async (guard) => {
      guards.push(guard);
    };

    await mount(load, { contextKey: 'venue:resource:date', enabled: true, intervalMs: 30_000 });
    expect(mockIntervals.size).toBe(0);
    await focus(true);
    expect(guards).toHaveLength(1);
    expect(mockIntervals.size).toBe(1);

    await testAct(async () => {
      jest.advanceTimersByTime(30_000);
      await flushMicrotasks();
    });
    expect(guards).toHaveLength(2);
    expect(mockIntervals.size).toBe(1);

    await focus(false);
    expect(mockIntervals.size).toBe(0);
    expect(guards[0]!.isCurrent()).toBe(false);
  });
});

describe('SP-FOREGROUND and SP-OBSOLETE-RESPONSE', () => {
  it('refreshes immediately on foreground and invalidates reads when context changes', async () => {
    const guards: Array<{ isCurrent: () => boolean }> = [];
    const load: HookLoad = async (guard) => {
      guards.push(guard);
    };

    await mount(load, { contextKey: 'booking:a', enabled: true, intervalMs: 60_000 });
    await focus(true);
    expect(guards).toHaveLength(1);

    await setAppState('background');
    expect(guards[0]!.isCurrent()).toBe(false);
    expect(mockIntervals.size).toBe(0);
    await setAppState('active');
    expect(guards).toHaveLength(2);
    expect(mockIntervals.size).toBe(1);

    await setVisibility('hidden');
    expect(guards[1]!.isCurrent()).toBe(false);
    expect(mockIntervals.size).toBe(0);
    await setVisibility('visible');
    expect(guards).toHaveLength(3);

    await testAct(async () => {
      render(load, { contextKey: 'booking:b', enabled: true, intervalMs: 60_000 });
      await flushMicrotasks();
    });
    expect(guards[2]!.isCurrent()).toBe(false);
    expect(guards).toHaveLength(4);
    expect(mockIntervals.size).toBe(1);
  });
});

describe('SP-UNMOUNT-CLEANUP', () => {
  it('invalidates an outstanding read when the focused host unmounts', async () => {
    const guards: Array<{ isCurrent: () => boolean }> = [];
    const load: HookLoad = async (guard) => {
      guards.push(guard);
      await new Promise<void>(() => {});
    };

    await mount(load, { contextKey: 'booking:a', enabled: true, intervalMs: 60_000 });
    await focus(true);
    expect(guards).toHaveLength(1);

    await testAct(async () => {
      mockRoot!.unmount();
      mockRoot = undefined;
      await flushMicrotasks();
    });
    expect(guards[0]!.isCurrent()).toBe(false);
    expect(mockIntervals.size).toBe(0);
  });
});
