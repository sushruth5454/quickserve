import { msUntilProviderDateBoundary, useOnboardingData } from '../useOnboardingData';

let mockUserId: string | null = 'owner-a';
let mockAuthLoading = false;
let mockRestoreStatus: 'session' | 'pending' | 'error' | 'known-null' = 'session';
let mockAppStateListener: ((state: string) => void) | null = null;
let mockCurrentHarness: HookHarness | null = null;
const mockRetryRestore = jest.fn();
let mockGetOnboarding: jest.Mock;
let mockGetCatalog: jest.Mock;
let mockListCategories: jest.Mock;
let mockListMyServices: jest.Mock;

interface HookSlot {
  value?: unknown;
  dependencies?: readonly unknown[];
  cleanup?: (() => void) | void;
}

interface PendingEffect {
  index: number;
  callback: () => void | (() => void);
  dependencies: readonly unknown[];
}

function sameDependencies(a: readonly unknown[] | undefined, b: readonly unknown[] | undefined): boolean {
  return !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
}

class HookHarness {
  private slots: HookSlot[] = [];
  private cursor = 0;
  private pendingEffects: PendingEffect[] = [];
  private focusCallback: (() => void | (() => void)) | null = null;
  private activeFocusCallback: (() => void | (() => void)) | null = null;
  private activeFocusCleanup: (() => void) | null = null;
  private focused = true;
  private enabled: boolean;
  result: ReturnType<typeof useOnboardingData> | null = null;

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  useState<T>(initial: T): [T, (next: T | ((current: T) => T)) => void] {
    const index = this.cursor++;
    if (!this.slots[index]) this.slots[index] = { value: initial };
    const slot = this.slots[index]!;
    return [
      slot.value as T,
      (next) => {
        slot.value = typeof next === 'function' ? (next as (current: T) => T)(slot.value as T) : next;
      },
    ];
  }

  useRef<T>(initial: T): { current: T } {
    const index = this.cursor++;
    if (!this.slots[index]) this.slots[index] = { value: { current: initial } };
    return this.slots[index]!.value as { current: T };
  }

  useCallback<T extends (...args: never[]) => unknown>(callback: T, dependencies: readonly unknown[]): T {
    const index = this.cursor++;
    const slot = this.slots[index];
    if (!slot || !sameDependencies(slot.dependencies, dependencies)) {
      this.slots[index] = { value: callback, dependencies };
      return callback;
    }
    return slot.value as T;
  }

  useEffect(callback: () => void | (() => void), dependencies: readonly unknown[]): void {
    const index = this.cursor++;
    const slot = this.slots[index];
    if (!slot || !sameDependencies(slot.dependencies, dependencies)) {
      this.pendingEffects.push({ index, callback, dependencies });
    }
  }

  captureFocus(callback: () => void | (() => void)): void {
    this.focusCallback = callback;
  }

  render(enabled = this.enabled): ReturnType<typeof useOnboardingData> {
    this.enabled = enabled;
    this.result = this.invokeHook();
    this.flushEffects();
    this.syncFocus();
    this.result = this.invokeHook();
    return this.result;
  }

  setFocused(focused: boolean): void {
    this.focused = focused;
    this.syncFocus();
  }

  unmount(): void {
    this.setFocused(false);
    for (const slot of [...this.slots].reverse()) slot.cleanup?.();
    this.slots = [];
    this.result = null;
  }

  private invokeHook(): ReturnType<typeof useOnboardingData> {
    this.cursor = 0;
    this.pendingEffects = [];
    mockCurrentHarness = this;
    try {
      return useOnboardingData({ enabled: this.enabled });
    } finally {
      mockCurrentHarness = null;
    }
  }

  private flushEffects(): void {
    for (const effect of this.pendingEffects) {
      const previous = this.slots[effect.index];
      previous?.cleanup?.();
      const cleanup = effect.callback();
      this.slots[effect.index] = { dependencies: effect.dependencies, cleanup };
    }
  }

  private syncFocus(): void {
    if (!this.focused) {
      this.activeFocusCleanup?.();
      this.activeFocusCleanup = null;
      this.activeFocusCallback = null;
      return;
    }
    if (this.focusCallback === this.activeFocusCallback || !this.focusCallback) return;
    this.activeFocusCleanup?.();
    this.activeFocusCallback = this.focusCallback;
    const cleanup = this.focusCallback();
    this.activeFocusCleanup = typeof cleanup === 'function' ? cleanup : null;
  }
}

jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return {
    ...actual,
    useState: (initial: unknown) => mockCurrentHarness!.useState(initial),
    useRef: (initial: unknown) => mockCurrentHarness!.useRef(initial),
    useCallback: (callback: (...args: never[]) => unknown, dependencies: readonly unknown[]) =>
      mockCurrentHarness!.useCallback(callback, dependencies),
    useEffect: (callback: () => void | (() => void), dependencies: readonly unknown[]) =>
      mockCurrentHarness!.useEffect(callback, dependencies),
  };
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => mockCurrentHarness?.captureFocus(callback),
}));

jest.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: jest.fn((_event: string, listener: (state: string) => void) => {
      mockAppStateListener = listener;
      return { remove: jest.fn() };
    }),
  },
}));

jest.mock('../../../lib/api', () => ({
  listCategories: (...args: unknown[]) => mockListCategories(...args),
  listMyServices: (...args: unknown[]) => mockListMyServices(...args),
}));

jest.mock('../../../lib/auth', () => ({
  useAuth: () => ({
    userId: mockUserId,
    loading: mockAuthLoading,
    restoreStatus: mockRestoreStatus,
    restoreError: null,
    retryRestore: mockRetryRestore,
  }),
}));

jest.mock('../../../lib/onboarding', () => ({
  onboardingApi: {
    getOnboarding: (...args: unknown[]) => mockGetOnboarding(...args),
    getCatalog: (...args: unknown[]) => mockGetCatalog(...args),
  },
}));

const emptyState = (ownerId: string | null = null) => ({
  provider: ownerId ? { id: ownerId, timezone: 'Asia/Kolkata' } : null,
  profile: null,
  payout: null,
  documents: [],
  availability: [],
  time_off: [],
  portfolio: [],
  checks: [],
  go_live: { state: 'draft', reasons: [], paused: false },
  terms_version: 'v1',
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function mount(harnessRef: { current: HookHarness | null }, enabled = true) {
  harnessRef.current = new HookHarness(enabled);
  harnessRef.current.render();
  await flushPromises();
  harnessRef.current.render();
}

describe('owner onboarding read state', () => {
  beforeEach(() => {
    jest.useRealTimers();
    mockUserId = 'owner-a';
    mockAuthLoading = false;
    mockRestoreStatus = 'session';
    mockAppStateListener = null;
    mockCurrentHarness = null;
    mockGetOnboarding = jest.fn().mockResolvedValue(emptyState(null));
    mockGetCatalog = jest.fn().mockResolvedValue({ skills: [], docTypes: [] });
    mockListCategories = jest.fn().mockResolvedValue([]);
    mockListMyServices = jest.fn().mockResolvedValue([]);
  });

  it('ID-LOAD-INITIAL-ERROR distinguishes initial failure from a successful empty result', async () => {
    const harnessRef = { current: null as HookHarness | null };
    mockGetOnboarding.mockRejectedValueOnce(new Error('offline'));
    await mount(harnessRef);
    expect(harnessRef.current?.result?.readState.status).toBe('error');
    expect(harnessRef.current?.result?.data).toBeNull();
    expect(harnessRef.current?.result?.error).toContain('offline');
    harnessRef.current?.unmount();

    await mount(harnessRef);
    expect(harnessRef.current?.result?.readState.status).toBe('ready');
    expect(harnessRef.current?.result?.error).toBeNull();
    expect(harnessRef.current?.result?.data?.state.provider).toBeNull();
    expect(harnessRef.current?.result?.data?.services).toEqual([]);
    harnessRef.current?.unmount();
  });

  it('ID-LOAD-STALE preserves zero-valued data and ID-SAVE-READBACK-ERROR distinguishes failed readback', async () => {
    const harnessRef = { current: null as HookHarness | null };
    const service = { id: 'service-1', visit_fee: 0 } as never;
    mockGetOnboarding.mockResolvedValue(emptyState('owner-a'));
    mockListMyServices.mockResolvedValue([service]);
    await mount(harnessRef);
    expect(harnessRef.current?.result?.readState.status).toBe('ready');
    expect(harnessRef.current?.result?.data?.services[0]?.visit_fee).toBe(0);

    mockGetOnboarding.mockRejectedValueOnce(new Error('temporary read failure'));
    const refresh = harnessRef.current!.result!.reload({ afterMutation: true });
    await expect(refresh).rejects.toThrow('temporary read failure');
    harnessRef.current?.render();
    expect(harnessRef.current?.result?.readState.status).toBe('stale');
    expect(harnessRef.current?.result?.readState.stale).toBe(true);
    expect(harnessRef.current?.result?.readState.afterMutation).toBe(true);
    expect(harnessRef.current?.result?.error).toContain('Saved, but the latest provider status could not be refreshed.');
    expect(harnessRef.current?.result?.data?.services[0]?.visit_fee).toBe(0);
    harnessRef.current?.unmount();
  });

  it('ID-LOAD-UID-RACE ignores a late response from the previous authenticated UID', async () => {
    const harnessRef = { current: null as HookHarness | null };
    const oldRequest = deferred<ReturnType<typeof emptyState>>();
    mockGetOnboarding.mockImplementationOnce(() => oldRequest.promise);
    await mount(harnessRef);

    mockUserId = 'owner-b';
    mockGetOnboarding.mockResolvedValue(emptyState('owner-b'));
    harnessRef.current?.render();
    await flushPromises();
    harnessRef.current?.render();
    expect(harnessRef.current?.result?.data?.state.provider?.id).toBe('owner-b');

    oldRequest.resolve(emptyState('owner-a'));
    await flushPromises();
    harnessRef.current?.render();
    expect(harnessRef.current?.result?.data?.state.provider?.id).toBe('owner-b');
    harnessRef.current?.unmount();
  });

  it('coalesces overlapping refreshes into one sequential owner read', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T04:00:00.000Z'));
    const harnessRef = { current: null as HookHarness | null };
    const pending = deferred<ReturnType<typeof emptyState>>();
    mockGetOnboarding.mockImplementationOnce(() => pending.promise);
    await mount(harnessRef);

    jest.advanceTimersByTime(120_000);
    await flushPromises();
    expect(mockGetOnboarding).toHaveBeenCalledTimes(1);

    pending.resolve(emptyState(null));
    await flushPromises();
    harnessRef.current?.render();
    expect(mockGetOnboarding).toHaveBeenCalledTimes(2);
    harnessRef.current?.unmount();
    jest.useRealTimers();
  });

  it('disables owner reads and disposes the focused interval when disabled', async () => {
    jest.useFakeTimers();
    const harnessRef = { current: null as HookHarness | null };
    await mount(harnessRef, false);
    expect(harnessRef.current?.result?.readState.status).toBe('idle');
    expect(mockGetOnboarding).not.toHaveBeenCalled();

    harnessRef.current?.render(true);
    await flushPromises();
    harnessRef.current?.render();
    expect(mockGetOnboarding).toHaveBeenCalledTimes(1);

    harnessRef.current?.render(false);
    expect(harnessRef.current?.result?.data).toBeNull();
    jest.advanceTimersByTime(120_000);
    await flushPromises();
    expect(mockGetOnboarding).toHaveBeenCalledTimes(1);
    harnessRef.current?.unmount();
    jest.useRealTimers();
  });

  it('ID-READINESS-INVALIDATION polls only while focused and active and refreshes on resume and focus', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T04:00:00.000Z'));
    const harnessRef = { current: null as HookHarness | null };
    mockGetOnboarding.mockResolvedValue(emptyState(null));
    await mount(harnessRef);
    expect(mockGetOnboarding).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(60_000);
    await flushPromises();
    expect(mockGetOnboarding).toHaveBeenCalledTimes(2);

    mockAppStateListener?.('background');
    jest.advanceTimersByTime(120_000);
    await flushPromises();
    expect(mockGetOnboarding).toHaveBeenCalledTimes(2);

    mockAppStateListener?.('active');
    await flushPromises();
    expect(mockGetOnboarding).toHaveBeenCalledTimes(3);

    harnessRef.current?.setFocused(false);
    harnessRef.current?.render();
    jest.advanceTimersByTime(120_000);
    await flushPromises();
    expect(mockGetOnboarding).toHaveBeenCalledTimes(3);

    harnessRef.current?.setFocused(true);
    harnessRef.current?.render();
    await flushPromises();
    expect(mockGetOnboarding).toHaveBeenCalledTimes(4);
    harnessRef.current?.unmount();
    jest.useRealTimers();
  });

  it('schedules a read at the provider-local date boundary', async () => {
    expect(msUntilProviderDateBoundary('Asia/Kolkata', Date.parse('2026-01-01T18:29:30.000Z'))).toBe(30_000);
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T18:29:30.000Z'));
    const harnessRef = { current: null as HookHarness | null };
    mockGetOnboarding.mockResolvedValue(emptyState(null));
    await mount(harnessRef);

    jest.advanceTimersByTime(30_000);
    await flushPromises();
    expect(mockGetOnboarding).toHaveBeenCalledTimes(2);
    harnessRef.current?.unmount();
    jest.useRealTimers();
  });
});
