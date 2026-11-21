import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { getAppFeatures, type AdminFeatures } from '../lib/adminApi';
import { isFeatureOn } from '../lib/featureFlagModel';

export type AppFeatures = AdminFeatures;
export type FeatureControlFreshness = 'cache' | 'live' | 'fallback' | 'error';

export interface FeatureControlDataState {
  features: AppFeatures;
  freshness: FeatureControlFreshness;
  appearanceCandidate: unknown;
}

export const DEFAULT_FEATURES: AppFeatures = {
  ai_assistant: true,
  urgent_requests: true,
  fixed_asap: true,
  archetypes: {
    inspect_quote: true,
    fixed: true,
    time_based: true,
    proposal: true,
  },
};

interface FeatureControlSnapshot {
  features: AppFeatures;
  freshness: FeatureControlFreshness;
  appearanceCandidate: unknown;
  refresh: () => Promise<void>;
  hydrationReady: boolean;
}

export interface ParsedFeatureResponse {
  features: AppFeatures;
  appearanceCandidate?: unknown;
  hasAppearanceCandidate: boolean;
}

const CACHE_VERSION = 1;
const CACHE_HYDRATION_DEADLINE_MS = 250;
const FOREGROUND_REFRESH_MS = 60_000;
const PROJECT_NAMESPACE = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'demo')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '') || 'demo';
const FLAGS_CACHE_KEY = `quickserve:${PROJECT_NAMESPACE}:feature-flags:v${CACHE_VERSION}`;
const APPEARANCE_CACHE_KEY = `quickserve:${PROJECT_NAMESPACE}:appearance:v${CACHE_VERSION}`;

const FeatureControlContext = createContext<FeatureControlSnapshot | null>(null);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBooleanRecord(value: unknown): value is Record<string, boolean> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'boolean');
}

function isAppFeatures(value: unknown): value is AppFeatures {
  if (!isRecord(value) || !isBooleanRecord(value.archetypes)) return false;
  return Object.entries(value).every(([key, item]) =>
    key === 'archetypes' ? isBooleanRecord(item) : typeof item === 'boolean' || isBooleanRecord(item),
  );
}

export function parseFeatureResponse(value: unknown): ParsedFeatureResponse | null {
  if (!isRecord(value)) return null;

  const hasAppearanceCandidate = Object.prototype.hasOwnProperty.call(value, 'appearanceCandidate');
  const appearanceCandidate = hasAppearanceCandidate ? value.appearanceCandidate : undefined;
  const featureValue = Object.prototype.hasOwnProperty.call(value, 'features')
    ? value.features
    : hasAppearanceCandidate
      ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'appearanceCandidate'))
      : value;

  if (!isAppFeatures(featureValue)) return null;
  return { features: featureValue, appearanceCandidate, hasAppearanceCandidate };
}

export function parseFlagsCache(value: string | null): AppFeatures | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || parsed.version !== CACHE_VERSION || !isAppFeatures(parsed.features)) return null;
    return parsed.features;
  } catch {
    return null;
  }
}

export function parseAppearanceCache(value: string | null): { found: boolean; candidate?: unknown } {
  if (!value) return { found: false };
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || parsed.version !== CACHE_VERSION) return { found: false };
    return { found: true, candidate: parsed.candidate };
  } catch {
    return { found: false };
  }
}

export function acceptsFeatureControlSequence(sequence: number, latestSettledSequence: number): boolean {
  return sequence >= latestSettledSequence;
}

export function featureControlAfterRefreshError(
  current: FeatureControlDataState,
  hasValidFeatures: boolean,
): FeatureControlDataState {
  return { ...current, freshness: hasValidFeatures ? 'error' : 'fallback' };
}

export function featureFlagsView(features: AppFeatures) {
  return { ...features, isOn: (key: string) => isFeatureOn(features, key) };
}

function persistCache(key: string, value: unknown): void {
  try {
    void AsyncStorage.setItem(key, JSON.stringify(value)).catch(() => undefined);
  } catch {
    // Cache serialization is best-effort and must not affect accepted flags.
  }
}

export function FeatureFlagsProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<Omit<FeatureControlSnapshot, 'refresh' | 'hydrationReady'>>({
    features: DEFAULT_FEATURES,
    freshness: 'fallback',
    appearanceCandidate: undefined,
  });
  const [hydrationReady, setHydrationReady] = useState(false);
  const requestSequence = useRef(0);
  const latestSettledSequence = useRef(0);
  const latestSuccessfulSequence = useRef(0);
  const latestAppearanceSequence = useRef(0);
  const latestErrorSequence = useRef(0);
  const hasValidFeatures = useRef(false);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    try {
      const response = parseFeatureResponse(await getAppFeatures());
      if (!mounted.current) return;
      if (!response) throw new Error('Invalid app feature response');
      if (!acceptsFeatureControlSequence(sequence, latestSettledSequence.current)) return;

      latestSettledSequence.current = sequence;
      latestSuccessfulSequence.current = sequence;
      hasValidFeatures.current = true;
      setSnapshot((current) => ({
        features: response.features,
        freshness: 'live',
        appearanceCandidate: response.hasAppearanceCandidate
          ? response.appearanceCandidate
          : current.appearanceCandidate,
      }));
      persistCache(FLAGS_CACHE_KEY, { version: CACHE_VERSION, features: response.features });
      if (response.hasAppearanceCandidate) {
        latestAppearanceSequence.current = sequence;
        persistCache(APPEARANCE_CACHE_KEY, {
          version: CACHE_VERSION,
          candidate: response.appearanceCandidate,
        });
      }
    } catch {
      if (!mounted.current) return;
      if (!acceptsFeatureControlSequence(sequence, latestSettledSequence.current)) return;
      latestSettledSequence.current = sequence;
      latestErrorSequence.current = sequence;
      setSnapshot((current) => featureControlAfterRefreshError(current, hasValidFeatures.current));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    let activeTimer: ReturnType<typeof setInterval> | null = null;
    let refreshStarted = false;
    let cacheDeadline: ReturnType<typeof setTimeout>;

    const finishLocalHydration = () => {
      if (!mounted.current) return;
      setHydrationReady(true);
      if (!refreshStarted) {
        refreshStarted = true;
        void refresh();
      }
    };

    const hydrateCache = async () => {
      const [flagsValue, appearanceValue] = await Promise.all([
        AsyncStorage.getItem(FLAGS_CACHE_KEY).catch(() => null),
        AsyncStorage.getItem(APPEARANCE_CACHE_KEY).catch(() => null),
      ]);
      if (!mounted.current) return;

      const cachedFeatures = parseFlagsCache(flagsValue);
      const cachedAppearance = parseAppearanceCache(appearanceValue);
      if (cachedFeatures && latestSuccessfulSequence.current === 0) {
        hasValidFeatures.current = true;
        setSnapshot((current) => ({
          features: cachedFeatures,
          freshness: latestErrorSequence.current > 0 ? 'error' : 'cache',
          appearanceCandidate:
            cachedAppearance.found && latestAppearanceSequence.current === 0
              ? cachedAppearance.candidate
              : current.appearanceCandidate,
        }));
      } else if (cachedAppearance.found && latestAppearanceSequence.current === 0) {
        setSnapshot((current) => ({
          ...current,
          appearanceCandidate: cachedAppearance.candidate,
        }));
      }

      clearTimeout(cacheDeadline);
      finishLocalHydration();
    };

    cacheDeadline = setTimeout(finishLocalHydration, CACHE_HYDRATION_DEADLINE_MS);
    void hydrateCache().catch(() => {
      if (!mounted.current) return;
      clearTimeout(cacheDeadline);
      finishLocalHydration();
    });

    const startForegroundTimer = () => {
      if (activeTimer) return;
      activeTimer = setInterval(() => void refresh(), FOREGROUND_REFRESH_MS);
    };
    const stopForegroundTimer = () => {
      if (!activeTimer) return;
      clearInterval(activeTimer);
      activeTimer = null;
    };

    if (AppState.currentState === 'active') startForegroundTimer();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refresh();
        startForegroundTimer();
      } else {
        stopForegroundTimer();
      }
    });

    return () => {
      mounted.current = false;
      clearTimeout(cacheDeadline);
      stopForegroundTimer();
      subscription.remove();
    };
  }, [refresh]);

  const contextValue = useMemo<FeatureControlSnapshot>(
    () => ({ ...snapshot, refresh, hydrationReady }),
    [snapshot, refresh, hydrationReady],
  );

  return <FeatureControlContext.Provider value={contextValue}>{children}</FeatureControlContext.Provider>;
}

function useFeatureControlContext(): FeatureControlSnapshot {
  const context = useContext(FeatureControlContext);
  if (!context) throw new Error('Feature control hooks must be used inside FeatureFlagsProvider');
  return context;
}

export function useFeatureControlState(): {
  features: AppFeatures;
  freshness: 'cache' | 'live' | 'fallback' | 'error';
  appearanceCandidate: unknown;
  refresh: () => Promise<void>;
} {
  const { features, freshness, appearanceCandidate, refresh } = useFeatureControlContext();
  return { features, freshness, appearanceCandidate, refresh };
}

export function useFeatureControlHydrationReady(): boolean {
  return useFeatureControlContext().hydrationReady;
}

export function useAppFeatureFlags() {
  const { features } = useFeatureControlState();
  return useMemo(() => featureFlagsView(features), [features]);
}

export function useFeature(key: string): boolean {
  return useAppFeatureFlags().isOn(key);
}
