import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
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

export interface PreloadedAppearance {
  key: string;
  config: BrandingV1 | null;
}

export function resolveAppearanceConfig(input: {
  brandingEnabled: boolean;
  runtimeFlag: boolean;
  candidate: BrandingV1 | null;
  candidateKey: string;
  preloaded: PreloadedAppearance | null;
}): BrandingV1 | null {
  if (!input.brandingEnabled) return null;
  if (!input.runtimeFlag || !input.candidate) return OORVA_BRANDING_CANDIDATE;
  if (input.preloaded?.key === input.candidateKey) {
    return input.preloaded.config ?? OORVA_BRANDING_CANDIDATE;
  }
  return input.preloaded?.config ?? OORVA_BRANDING_CANDIDATE;
}

export function createAppearanceProviderElement(
  value: AppearanceState,
  children: ReactNode,
): ReactElement {
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const { features, appearanceCandidate, refresh } = useFeatureControlState();
  const brandingEnabled = features.oorva_brand === true;
  const runtimeFlag = features.branding_runtime === true;
  const runtimeEnabled = brandingEnabled && runtimeFlag;
  const candidate = useMemo(
    () => validateAppearanceCandidate(appearanceCandidate),
    [appearanceCandidate],
  );
  const candidateKey = candidate ? JSON.stringify(candidate) : '';
  const [preloaded, setPreloaded] = useState<PreloadedAppearance | null>(null);

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
    return resolveAppearanceConfig({
      brandingEnabled,
      runtimeFlag,
      candidate,
      candidateKey,
      preloaded,
    });
  }, [brandingEnabled, runtimeFlag, candidate, candidateKey, preloaded]);

  const value = useMemo<AppearanceState>(
    () => ({ brandingEnabled, runtimeEnabled, config, refresh }),
    [brandingEnabled, runtimeEnabled, config, refresh],
  );

  return createAppearanceProviderElement(value, children);
}

export function useAppearance(): AppearanceState {
  return useContext(AppearanceContext);
}
