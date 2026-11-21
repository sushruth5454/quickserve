import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState, Platform } from 'react-native';
import { createRequestEpoch } from './entityInvalidation';

type RefreshGuard = { isCurrent: () => boolean };
type RefreshLoad = (guard: RefreshGuard) => Promise<void>;
type RefreshOptions = { contextKey: string; enabled: boolean; intervalMs: number | null };
type RefreshTrigger = 'explicit' | 'resume' | 'periodic';
type RefreshWaiter = { resolve: () => void; reject: (error: unknown) => void };

function isDocumentVisible(): boolean {
  return Platform.OS !== 'web' || typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

export function useEntityRefresh(
  load: RefreshLoad,
  options: RefreshOptions,
): { refresh: () => Promise<void>; refreshing: boolean } {
  const epochRef = useRef<ReturnType<typeof createRequestEpoch> | null>(null);
  if (!epochRef.current) epochRef.current = createRequestEpoch();

  const loadRef = useRef(load);
  loadRef.current = load;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const initiallyActive = AppState.currentState === 'active';
  const initiallyVisible = isDocumentVisible();
  const [focused, setFocused] = useState(false);
  const focusedRef = useRef(false);
  const [appActive, setAppActive] = useState(initiallyActive);
  const appActiveRef = useRef(initiallyActive);
  const [visible, setVisible] = useState(initiallyVisible);
  const visibleRef = useRef(initiallyVisible);
  const [refreshing, setRefreshing] = useState(false);

  const mountedRef = useRef(true);
  const runningRef = useRef(false);
  const runSequenceRef = useRef(0);
  const scheduledRef = useRef(false);
  const scheduleGenerationRef = useRef(0);
  const waitersRef = useRef<RefreshWaiter[]>([]);
  const activeWaitersRef = useRef<RefreshWaiter[] | null>(null);
  const previousOptionsRef = useRef({ contextKey: options.contextKey, enabled: options.enabled });

  const completeWaiters = useCallback((waiters: RefreshWaiter[], error?: unknown, reject = false) => {
    for (const waiter of waiters) {
      if (reject) waiter.reject(error);
      else waiter.resolve();
    }
  }, []);

  const isEligible = useCallback(
    () => optionsRef.current.enabled && focusedRef.current && appActiveRef.current && visibleRef.current,
    [],
  );

  const cancelScheduled = useCallback(() => {
    if (!scheduledRef.current) return;
    scheduledRef.current = false;
    scheduleGenerationRef.current += 1;
    completeWaiters(waitersRef.current.splice(0));
  }, [completeWaiters]);

  const invalidateCurrent = useCallback((clearSpinner: boolean) => {
    epochRef.current?.invalidate();
    runSequenceRef.current += 1;
    runningRef.current = false;
    if (activeWaitersRef.current) {
      completeWaiters(activeWaitersRef.current);
      activeWaitersRef.current = null;
    }
    if (clearSpinner && mountedRef.current) setRefreshing(false);
  }, [completeWaiters]);

  const pause = useCallback(() => {
    invalidateCurrent(true);
    cancelScheduled();
  }, [cancelScheduled, invalidateCurrent]);

  const queueRefresh = useCallback(
    (trigger: RefreshTrigger): Promise<void> => {
      if (!mountedRef.current || !isEligible()) return Promise.resolve();
      if (trigger === 'periodic' && (runningRef.current || scheduledRef.current)) return Promise.resolve();

      let promise = Promise.resolve();
      if (trigger === 'explicit') {
        promise = new Promise<void>((resolve, reject) => {
          let settled = false;
          waitersRef.current.push({
            resolve: () => {
              if (settled) return;
              settled = true;
              resolve();
            },
            reject: (error) => {
              if (settled) return;
              settled = true;
              reject(error);
            },
          });
        });
        epochRef.current?.invalidate();
        runSequenceRef.current += 1;
        runningRef.current = false;
        if (activeWaitersRef.current) {
          completeWaiters(activeWaitersRef.current);
          activeWaitersRef.current = null;
        }
      }

      if (!scheduledRef.current) {
        scheduledRef.current = true;
        const scheduleGeneration = ++scheduleGenerationRef.current;
        void Promise.resolve().then(async () => {
          if (!scheduledRef.current || scheduleGenerationRef.current !== scheduleGeneration) return;
          scheduledRef.current = false;
          const waiters = waitersRef.current.splice(0);
          if (!mountedRef.current || !isEligible()) {
            completeWaiters(waiters);
            return;
          }

          const token = epochRef.current!.begin(optionsRef.current.contextKey);
          const runSequence = ++runSequenceRef.current;
          runningRef.current = true;
          activeWaitersRef.current = waiters.length > 0 ? waiters : null;
          setRefreshing(true);
          const guard = { isCurrent: () => epochRef.current!.isCurrent(token) };

          try {
            await loadRef.current(guard);
            if (!guard.isCurrent()) {
              completeWaiters(waiters);
              return;
            }
            completeWaiters(waiters);
          } catch (error) {
            if (guard.isCurrent() && runSequenceRef.current === runSequence) {
              completeWaiters(waiters, error, true);
            } else {
              completeWaiters(waiters);
            }
          } finally {
            if (guard.isCurrent() && runSequenceRef.current === runSequence) {
              runningRef.current = false;
              if (activeWaitersRef.current === waiters) activeWaitersRef.current = null;
              if (mountedRef.current) setRefreshing(false);
            }
          }
        });
      }

      return promise;
    },
    [completeWaiters, isEligible],
  );

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      setFocused(true);
      void queueRefresh('resume');
      return () => {
        focusedRef.current = false;
        setFocused(false);
        pause();
      };
    }, [pause, queueRefresh]),
  );

  useLayoutEffect(() => {
    const previous = previousOptionsRef.current;
    const contextChanged = previous.contextKey !== options.contextKey;
    const enabledChanged = previous.enabled !== options.enabled;
    previousOptionsRef.current = { contextKey: options.contextKey, enabled: options.enabled };
    if (!contextChanged && !enabledChanged) return;

    if (!options.enabled) {
      pause();
      return;
    }

    invalidateCurrent(false);
    if (isEligible()) void queueRefresh('resume');
    else {
      cancelScheduled();
      if (mountedRef.current) setRefreshing(false);
    }
  }, [cancelScheduled, invalidateCurrent, isEligible, options.contextKey, options.enabled, pause, queueRefresh]);

  useEffect(() => {
    const synchronizeActiveState = (state: string | null | undefined) => {
      const nextActive = state === 'active';
      if (nextActive === appActiveRef.current) return;
      appActiveRef.current = nextActive;
      setAppActive(nextActive);
      if (nextActive) void queueRefresh('resume');
      else pause();
    };

    synchronizeActiveState(AppState.currentState);
    const subscription = AppState.addEventListener('change', synchronizeActiveState);
    return () => subscription.remove();
  }, [pause, queueRefresh]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const synchronizeVisibility = () => {
      const nextVisible = document.visibilityState !== 'hidden';
      if (nextVisible === visibleRef.current) return;
      visibleRef.current = nextVisible;
      setVisible(nextVisible);
      if (nextVisible) void queueRefresh('resume');
      else pause();
    };

    synchronizeVisibility();
    document.addEventListener('visibilitychange', synchronizeVisibility);
    return () => document.removeEventListener('visibilitychange', synchronizeVisibility);
  }, [pause, queueRefresh]);

  useEffect(() => {
    const intervalMs = options.intervalMs;
    if (
      !options.enabled
      || !focused
      || !appActive
      || !visible
      || intervalMs === null
      || !Number.isFinite(intervalMs)
      || intervalMs <= 0
    ) {
      return;
    }

    const interval = setInterval(() => {
      void queueRefresh('periodic');
    }, intervalMs);
    return () => clearInterval(interval);
  }, [appActive, focused, options.enabled, options.intervalMs, queueRefresh, visible]);

  useEffect(
    () => () => {
      mountedRef.current = false;
      invalidateCurrent(false);
      cancelScheduled();
    },
    [cancelScheduled, invalidateCurrent],
  );

  const refresh = useCallback(() => queueRefresh('explicit'), [queueRefresh]);
  return { refresh, refreshing };
}
