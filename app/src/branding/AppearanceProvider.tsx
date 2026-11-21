import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useFeatureControlState } from './FeatureFlagsProvider';
import { validateAppearanceCandidate, preloadAppearanceAssets } from './api';
import { OORVA_BRANDING_CANDIDATE } from './defaults';
import type { BrandingV1 } from './types';

export interface AppearanceState {
  brandingEnabled: boolean;
  runtimeEnabled: boolean;
  config: BrandingV1 | null;
  refresh: () => Promise<void>;
}

const noRefresh = async () => undefined;
const DEFAULT_APPEARANCE_STATE: AppearanceState = {
  brandingEnabled: false,
  runtimeEnabled: false,
  config: null,
  refresh: noRefresh,
};

const AppearanceContext = createContext<AppearanceState>(DEFAULT_APPEARANCE_STATE);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const { features, appearanceCandidate, refresh } = useFeatureControlState();
  const brandingEnabled = features.oorva_brand === true;
  const runtimeEnabled = brandingEnabled && features.branding_runtime === true;
  const candidate = useMemo(
    () => validateAppearanceCandidate(appearanceCandidate),
    [appearanceCandidate],
  );
  const candidateKey = candidate ? JSON.stringify(candidate) : '';
  const [preloaded, setPreloaded] = useState<{ key: string; config: BrandingV1 | null } | null>(
    null,
  );

  useEffect(() => {
    if (!runtimeEnabled || !candidate || !candidateKey) {
      setPreloaded(null);
      return;
    }
    if (preloaded?.key === candidateKey) return;

    let active = true;
    void preloadAppearanceAssets(candidate).then((ready) => {
      if (active) setPreloaded({ key: candidateKey, config: ready ? candidate : null });
    });
    return () => {
      active = false;
    };
  }, [runtimeEnabled, candidate, candidateKey, preloaded]);

  const config = useMemo(() => {
    if (!brandingEnabled) return null;
    if (!runtimeEnabled || !candidate) return OORVA_BRANDING_CANDIDATE;
    if (preloaded?.key === candidateKey) return preloaded.config ?? OORVA_BRANDING_CANDIDATE;
    return preloaded?.config ?? OORVA_BRANDING_CANDIDATE;
  }, [brandingEnabled, runtimeEnabled, candidate, candidateKey, preloaded]);

  const value = useMemo<AppearanceState>(
    () => ({ brandingEnabled, runtimeEnabled, config, refresh }),
    [brandingEnabled, runtimeEnabled, config, refresh],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceState {
  return useContext(AppearanceContext);
}
