import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { listCategories, listMyServices } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { onboardingApi, type CategorySkill, type DocumentType, type OnboardingState } from '../../lib/onboarding';
import type { Category, ProviderService } from '../../lib/types';

export interface OnboardingData {
  state: OnboardingState;
  categories: (Category & { requires_docs?: string[]; recommended_docs?: string[] })[];
  services: ProviderService[];
  skills: CategorySkill[];
  docTypes: DocumentType[];
}

export type OnboardingReadStatus = 'idle' | 'loading' | 'ready' | 'refreshing' | 'error' | 'stale';

export interface OnboardingReadState {
  status: OnboardingReadStatus;
  error: string | null;
  stale: boolean;
  refreshing: boolean;
  afterMutation: boolean;
}

export interface UseOnboardingDataOptions {
  enabled?: boolean;
}

export class OnboardingReadError extends Error {
  constructor(
    message: string,
    readonly afterMutation: boolean,
  ) {
    super(message);
    this.name = 'OnboardingReadError';
  }
}

const OWNER_REFRESH_INTERVAL_MS = 60_000;
const MAX_PROVIDER_DAY_MS = 26 * 60 * 60 * 1000;

function providerDateKey(timeZone: string, timestamp: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function msUntilProviderDateBoundary(timeZone: string, now = Date.now()): number {
  try {
    const today = providerDateKey(timeZone, now);
    let low = 0;
    let high = 60_000;
    while (high < MAX_PROVIDER_DAY_MS && providerDateKey(timeZone, now + high) === today) {
      low = high;
      high = Math.min(high * 2, MAX_PROVIDER_DAY_MS);
    }
    if (providerDateKey(timeZone, now + high) === today) return OWNER_REFRESH_INTERVAL_MS;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (providerDateKey(timeZone, now + middle) === today) low = middle;
      else high = middle;
    }
    return Math.max(1, high);
  } catch {
    return OWNER_REFRESH_INTERVAL_MS;
  }
}

/** Loads the signed-in owner's onboarding data and refreshes only while its screen is focused and active. */
export function useOnboardingData(options: UseOnboardingDataOptions = {}) {
  const enabled = options.enabled ?? true;
  const auth = useAuth();
  const userId = auth.userId;
  const scopeKey = `${enabled ? 'enabled' : 'disabled'}:${userId ?? 'signed-out'}:${auth.loading ? 'loading' : auth.restoreStatus}`;
  const [dataRecord, setDataRecord] = useState<{ ownerId: string; value: OnboardingData } | null>(null);
  const [snapshot, setSnapshot] = useState<{ scopeKey: string; value: OnboardingReadState }>({
    scopeKey: '',
    value: { status: 'idle', error: null, stale: false, refreshing: false, afterMutation: false },
  });
  const dataRef = useRef(dataRecord);
  const scopeKeyRef = useRef(scopeKey);
  const userIdRef = useRef(userId);
  const enabledRef = useRef(enabled);
  const focusedRef = useRef(false);
  const activeRef = useRef(AppState.currentState === 'active');
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const inFlightRef = useRef<{ ownerId: string; promise: Promise<boolean> } | null>(null);
  const queuedRefreshRef = useRef(false);
  const queuedAfterMutationRef = useRef(false);

  scopeKeyRef.current = scopeKey;
  userIdRef.current = userId;
  enabledRef.current = enabled;
  dataRef.current = dataRecord;

  const setOwnedData = useCallback((ownerId: string, value: OnboardingData) => {
    const record = { ownerId, value };
    dataRef.current = record;
    setDataRecord(record);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      inFlightRef.current = null;
      queuedRefreshRef.current = false;
      queuedAfterMutationRef.current = false;
    };
  }, []);

  useEffect(() => {
    generationRef.current += 1;
    inFlightRef.current = null;
    queuedRefreshRef.current = false;
    queuedAfterMutationRef.current = false;
    dataRef.current = null;
    setDataRecord(null);
    const initialStatus: OnboardingReadStatus = !enabled
      ? 'idle'
      : auth.loading || userId
        ? 'loading'
        : auth.restoreStatus === 'error' || auth.restoreStatus === 'known-null'
          ? 'error'
          : 'loading';
    const authError = auth.restoreStatus === 'error'
      ? auth.restoreError instanceof Error
        ? auth.restoreError.message
        : 'Could not verify your sign-in. Try again.'
      : auth.restoreStatus === 'known-null'
        ? 'Sign in to view your provider profile.'
        : null;
    setSnapshot({
      scopeKey,
      value: {
        status: initialStatus,
        error: authError,
        stale: false,
        refreshing: false,
        afterMutation: false,
      },
    });
    return () => {
      generationRef.current += 1;
      inFlightRef.current = null;
      queuedRefreshRef.current = false;
      queuedAfterMutationRef.current = false;
    };
  }, [scopeKey, enabled, userId, auth.loading, auth.restoreStatus, auth.restoreError]);

  const reload = useCallback(
    (readOptions: { afterMutation?: boolean } = {}): Promise<boolean> => {
      const ownerId = userId;
      if (!enabled) return Promise.resolve(false);
      if (!enabledRef.current || userIdRef.current !== ownerId || scopeKeyRef.current !== scopeKey) return Promise.resolve(false);
      if (!ownerId || auth.loading || auth.restoreStatus !== 'session') {
        if (!ownerId && auth.restoreStatus === 'error') void auth.retryRestore().catch(() => undefined);
        const message = !ownerId
          ? auth.restoreStatus === 'error'
            ? auth.restoreError instanceof Error
              ? auth.restoreError.message
              : 'Could not verify your sign-in. Try again.'
            : 'Sign in to view your provider profile.'
          : 'Your sign-in is still being restored. Try again shortly.';
        const afterMutation = readOptions.afterMutation ?? false;
        const failure = new OnboardingReadError(message, afterMutation);
        setSnapshot({
          scopeKey,
          value: {
            status: dataRef.current?.ownerId === ownerId ? 'stale' : 'error',
            error: failure.message,
            stale: dataRef.current?.ownerId === ownerId,
            refreshing: false,
            afterMutation,
          },
        });
        return Promise.reject(failure);
      }
      if (!focusedRef.current || !activeRef.current) return Promise.resolve(false);

      const existing = inFlightRef.current;
      if (existing?.ownerId === ownerId) {
        queuedRefreshRef.current = true;
        queuedAfterMutationRef.current ||= readOptions.afterMutation ?? false;
        return existing.promise;
      }

      const currentScope = () =>
        mountedRef.current &&
        enabledRef.current &&
        userIdRef.current === ownerId &&
        scopeKeyRef.current === scopeKey &&
        focusedRef.current &&
        activeRef.current;

      const run = async (): Promise<boolean> => {
        let success = false;
        let afterMutation = readOptions.afterMutation ?? false;
        let failureMessage = '';
        while (true) {
          queuedRefreshRef.current = false;
          queuedAfterMutationRef.current = false;
          const generation = ++generationRef.current;
          const hasOwnerData = dataRef.current?.ownerId === ownerId;
          setSnapshot({
            scopeKey,
            value: {
              status: hasOwnerData ? 'refreshing' : 'loading',
              error: null,
              stale: false,
              refreshing: hasOwnerData,
              afterMutation,
            },
          });
          try {
            const [state, categories, catalog] = await Promise.all([
              onboardingApi.getOnboarding(),
              listCategories(),
              onboardingApi.getCatalog(),
            ]);
            if (state.provider && state.provider.id !== ownerId) {
              throw new Error('Provider profile did not match the signed-in account.');
            }
            const services = state.provider ? await listMyServices(true) : [];
            if (
              !currentScope() ||
              generation !== generationRef.current
            ) {
              return false;
            }
            setOwnedData(ownerId, {
              state,
              categories,
              services,
              skills: catalog.skills,
              docTypes: catalog.docTypes,
            });
            setSnapshot({
              scopeKey,
              value: { status: 'ready', error: null, stale: false, refreshing: false, afterMutation: false },
            });
            success = true;
          } catch (error) {
            if (
              !currentScope() ||
              generation !== generationRef.current
            ) {
              return false;
            }
            const originalMessage = error instanceof Error ? error.message : 'Could not load your provider profile.';
            failureMessage = afterMutation
              ? `Saved, but the latest provider status could not be refreshed. Retry to see current details. ${originalMessage}`
              : `Provider status could not be refreshed. Displayed information may be out of date. ${originalMessage}`;
            const hasData = dataRef.current?.ownerId === ownerId;
            setSnapshot({
              scopeKey,
              value: {
                status: hasData ? 'stale' : 'error',
                error: failureMessage,
                stale: hasData,
                refreshing: false,
                afterMutation,
              },
            });
            success = false;
          }

          if (!queuedRefreshRef.current || !currentScope()) break;
          afterMutation = queuedAfterMutationRef.current;
        }

        if (!success) throw new OnboardingReadError(failureMessage, afterMutation);
        return true;
      };

      const promise = run();
      const request = { ownerId, promise };
      inFlightRef.current = request;
      void promise.finally(() => {
        if (inFlightRef.current === request) inFlightRef.current = null;
      }).catch(() => undefined);
      return promise;
    },
    [auth.loading, auth.restoreError, auth.restoreStatus, auth.retryRestore, enabled, scopeKey, setOwnedData, userId],
  );

  const timeZone = dataRecord?.ownerId === userId ? dataRecord.value.state.provider?.timezone || 'Asia/Kolkata' : 'Asia/Kolkata';
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      focusedRef.current = true;
      let interval: ReturnType<typeof setInterval> | null = null;
      let dateBoundary: ReturnType<typeof setTimeout> | null = null;

      const stopTimers = () => {
        if (interval) clearInterval(interval);
        if (dateBoundary) clearTimeout(dateBoundary);
        interval = null;
        dateBoundary = null;
      };
      const scheduleDateBoundary = () => {
        if (!focusedRef.current || !activeRef.current || dateBoundary) return;
        dateBoundary = setTimeout(() => {
          dateBoundary = null;
          if (!focusedRef.current || !activeRef.current) return;
          void reload().catch(() => undefined);
          scheduleDateBoundary();
        }, msUntilProviderDateBoundary(timeZone));
      };
      const startTimers = () => {
        if (
          !focusedRef.current ||
          !activeRef.current ||
          !userId ||
          auth.loading ||
          auth.restoreStatus !== 'session'
        ) return;
        if (!interval) {
          interval = setInterval(() => {
            if (focusedRef.current && activeRef.current) void reload().catch(() => undefined);
          }, OWNER_REFRESH_INTERVAL_MS);
        }
        scheduleDateBoundary();
      };
      const resume = () => {
        activeRef.current = true;
        startTimers();
        if (userId && !auth.loading && auth.restoreStatus === 'session') void reload().catch(() => undefined);
      };
      const pause = () => {
        activeRef.current = false;
        stopTimers();
        generationRef.current += 1;
        inFlightRef.current = null;
        queuedRefreshRef.current = false;
        queuedAfterMutationRef.current = false;
      };
      const onAppState = (state: string) => {
        if (state === 'active') resume();
        else pause();
      };

      if (AppState.currentState === 'active') resume();
      else pause();
      const subscription = AppState.addEventListener('change', onAppState);
      return () => {
        focusedRef.current = false;
        stopTimers();
        subscription.remove();
        generationRef.current += 1;
        inFlightRef.current = null;
        queuedRefreshRef.current = false;
        queuedAfterMutationRef.current = false;
      };
    }, [auth.loading, auth.restoreStatus, enabled, reload, timeZone, userId]),
  );

  const currentData = enabled && userId && dataRecord?.ownerId === userId ? dataRecord.value : null;
  const currentReadState: OnboardingReadState = !enabled
    ? { status: 'idle', error: null, stale: false, refreshing: false, afterMutation: false }
    : snapshot.scopeKey === scopeKey
      ? snapshot.value
      : {
          status: auth.loading || userId ? 'loading' : 'error',
          error: !userId && auth.restoreStatus === 'known-null' ? 'Sign in to view your provider profile.' : null,
          stale: false,
          refreshing: false,
          afterMutation: false,
        };
  const error = currentReadState.error;

  return {
    data: currentData,
    error,
    reload,
    readState: currentReadState,
  };
}

/**
 * Local draft autosave for free-text fields (never for PAN or bank details). Restores once on mount when a draft
 * exists, then saves on every change (debounced). Call clear() after a successful server save.
 */
export function useDraft<T>(key: string, value: T, restore: (draft: T) => void) {
  const restored = useRef(false);
  const storageKey = `quickserve.draft.${key}`;
  useEffect(() => {
    AsyncStorage.getItem(storageKey)
      .then((raw) => {
        if (raw && !restored.current) restore(JSON.parse(raw) as T);
      })
      .catch(() => undefined)
      .finally(() => {
        restored.current = true;
      });
    // Restore only once.
  }, [storageKey]);
  useEffect(() => {
    if (!restored.current) return;
    const t = setTimeout(() => {
      void AsyncStorage.setItem(storageKey, JSON.stringify(value)).catch(() => undefined);
    }, 400);
    return () => clearTimeout(t);
  }, [storageKey, value]);
  return {
    clear: () => AsyncStorage.removeItem(storageKey).catch(() => undefined),
  };
}
