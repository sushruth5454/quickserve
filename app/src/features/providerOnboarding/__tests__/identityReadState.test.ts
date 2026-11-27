import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { msUntilProviderDateBoundary, useOnboardingData } from '../useOnboardingData';

let mockUserId: string | null = 'owner-a';
let mockAuthLoading = false;
let mockRestoreStatus: 'session' | 'pending' | 'error' | 'known-null' = 'session';
let mockFocused = true;
let mockAppStateListener: ((state: string) => void) | null = null;
const mockRetryRestore = jest.fn();
let mockGetOnboarding: jest.Mock;
let mockGetCatalog: jest.Mock;
let mockListCategories: jest.Mock;
let mockListMyServices: jest.Mock;

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const ReactRuntime = require('react') as typeof React;
    ReactRuntime.useEffect(() => {
      if (!mockFocused) return;
      return callback();
    }, [callback, mockFocused]);
  },
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

let latest: ReturnType<typeof useOnboardingData> | null = null;
function Harness({ revision = 0, enabled = true }: { revision?: number; enabled?: boolean }) {
  latest = useOnboardingData({ enabled });
  return <>{revision}</>;
}

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

async function mount(rendererRef: { current: ReactTestRenderer | null }, props = {}) {
  await act(async () => {
    rendererRef.current = create(<Harness {...props} />);
    await flushPromises();
  });
}

describe('owner onboarding read state', () => {
  beforeEach(() => {
    jest.useRealTimers();
    mockUserId = 'owner-a';
    mockAuthLoading = false;
    mockRestoreStatus = 'session';
    mockFocused = true;
    mockAppStateListener = null;
    latest = null;
    mockGetOnboarding = jest.fn().mockResolvedValue(emptyState(null));
    mockGetCatalog = jest.fn().mockResolvedValue({ skills: [], docTypes: [] });
    mockListCategories = jest.fn().mockResolvedValue([]);
    mockListMyServices = jest.fn().mockResolvedValue([]);
  });

  it('ID-LOAD-INITIAL-ERROR distinguishes initial failure from a successful empty result', async () => {
    const rendererRef = { current: null as ReactTestRenderer | null };
    mockGetOnboarding.mockRejectedValueOnce(new Error('offline'));
    await mount(rendererRef);
    expect(latest?.readState.status).toBe('error');
    expect(latest?.data).toBeNull();
    expect(latest?.error).toContain('offline');
    await act(async () => rendererRef.current?.unmount());

    await mount(rendererRef);
    expect(latest?.readState.status).toBe('ready');
    expect(latest?.error).toBeNull();
    expect(latest?.data?.state.provider).toBeNull();
    expect(latest?.data?.services).toEqual([]);
    await act(async () => rendererRef.current?.unmount());
  });

  it('ID-LOAD-STALE preserves zero-valued data and ID-SAVE-READBACK-ERROR distinguishes failed readback', async () => {
    const rendererRef = { current: null as ReactTestRenderer | null };
    const service = { id: 'service-1', visit_fee: 0 } as never;
    mockGetOnboarding.mockResolvedValue(emptyState('owner-a'));
    mockListMyServices.mockResolvedValue([service]);
    await mount(rendererRef);
    expect(latest?.readState.status).toBe('ready');
    expect(latest?.data?.services[0]?.visit_fee).toBe(0);

    mockGetOnboarding.mockRejectedValueOnce(new Error('temporary read failure'));
    let refresh: Promise<boolean> | undefined;
    await act(async () => {
      refresh = latest?.reload({ afterMutation: true });
      await refresh?.catch(() => false);
    });
    await expect(refresh).rejects.toThrow('temporary read failure');
    expect(latest?.readState.status).toBe('stale');
    expect(latest?.readState.stale).toBe(true);
    expect(latest?.readState.afterMutation).toBe(true);
    expect(latest?.error).toContain('Saved, but the latest provider status could not be refreshed.');
    expect(latest?.data?.services[0]?.visit_fee).toBe(0);
    await act(async () => rendererRef.current?.unmount());
  });

  it('ID-LOAD-UID-RACE ignores a late response from the previous authenticated UID', async () => {
    const rendererRef = { current: null as ReactTestRenderer | null };
    const oldRequest = deferred<ReturnType<typeof emptyState>>();
    mockGetOnboarding.mockImplementationOnce(() => oldRequest.promise);
    await mount(rendererRef);

    mockUserId = 'owner-b';
    mockGetOnboarding.mockResolvedValue(emptyState('owner-b'));
    await act(async () => {
      rendererRef.current?.update(<Harness revision={1} />);
      await flushPromises();
    });
    expect(latest?.data?.state.provider?.id).toBe('owner-b');

    oldRequest.resolve(emptyState('owner-a'));
    await act(async () => flushPromises());
    expect(latest?.data?.state.provider?.id).toBe('owner-b');
    await act(async () => rendererRef.current?.unmount());
  });

  it('coalesces overlapping refreshes into one sequential owner read', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T04:00:00.000Z'));
    const rendererRef = { current: null as ReactTestRenderer | null };
    const pending = deferred<ReturnType<typeof emptyState>>();
    mockGetOnboarding.mockImplementationOnce(() => pending.promise);
    await mount(rendererRef);

    await act(async () => {
      jest.advanceTimersByTime(120_000);
      await flushPromises();
    });
    expect(mockGetOnboarding).toHaveBeenCalledTimes(1);

    pending.resolve(emptyState(null));
    await act(async () => flushPromises());
    expect(mockGetOnboarding).toHaveBeenCalledTimes(2);
    await act(async () => rendererRef.current?.unmount());
    jest.useRealTimers();
  });

  it('disables owner reads and disposes the focused interval when disabled', async () => {
    jest.useFakeTimers();
    const rendererRef = { current: null as ReactTestRenderer | null };
    await mount(rendererRef, { enabled: false });
    expect(latest?.readState.status).toBe('idle');
    expect(mockGetOnboarding).not.toHaveBeenCalled();

    await act(async () => {
      rendererRef.current?.update(<Harness revision={1} enabled />);
      await flushPromises();
    });
    expect(mockGetOnboarding).toHaveBeenCalledTimes(1);

    await act(async () => {
      rendererRef.current?.update(<Harness revision={2} enabled={false} />);
      await flushPromises();
    });
    expect(latest?.data).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(120_000);
      await flushPromises();
    });
    expect(mockGetOnboarding).toHaveBeenCalledTimes(1);
    await act(async () => rendererRef.current?.unmount());
    jest.useRealTimers();
  });

  it('ID-READINESS-INVALIDATION polls only while focused and active and refreshes on resume and focus', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T04:00:00.000Z'));
    const rendererRef = { current: null as ReactTestRenderer | null };
    mockGetOnboarding.mockResolvedValue(emptyState(null));
    await mount(rendererRef);
    expect(mockGetOnboarding).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(60_000);
      await flushPromises();
    });
    expect(mockGetOnboarding).toHaveBeenCalledTimes(2);

    mockAppStateListener?.('background');
    await act(async () => {
      jest.advanceTimersByTime(120_000);
      await flushPromises();
    });
    expect(mockGetOnboarding).toHaveBeenCalledTimes(2);

    mockAppStateListener?.('active');
    await act(async () => flushPromises());
    expect(mockGetOnboarding).toHaveBeenCalledTimes(3);

    mockFocused = false;
    await act(async () => {
      rendererRef.current?.update(<Harness revision={2} />);
      await flushPromises();
    });
    await act(async () => {
      jest.advanceTimersByTime(120_000);
      await flushPromises();
    });
    expect(mockGetOnboarding).toHaveBeenCalledTimes(3);

    mockFocused = true;
    await act(async () => {
      rendererRef.current?.update(<Harness revision={3} />);
      await flushPromises();
    });
    expect(mockGetOnboarding).toHaveBeenCalledTimes(4);
    await act(async () => rendererRef.current?.unmount());
    jest.useRealTimers();
  });

  it('schedules a read at the provider-local date boundary', async () => {
    expect(msUntilProviderDateBoundary('Asia/Kolkata', Date.parse('2026-01-01T18:29:30.000Z'))).toBe(30_000);
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T18:29:30.000Z'));
    const rendererRef = { current: null as ReactTestRenderer | null };
    mockGetOnboarding.mockResolvedValue(emptyState(null));
    await mount(rendererRef);

    await act(async () => {
      jest.advanceTimersByTime(30_000);
      await flushPromises();
    });
    expect(mockGetOnboarding).toHaveBeenCalledTimes(2);
    await act(async () => rendererRef.current?.unmount());
    jest.useRealTimers();
  });
});
