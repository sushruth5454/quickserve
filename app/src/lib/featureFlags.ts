import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { getAppFeatures, type AdminFeatures } from './adminApi';
import { isFeatureOn } from './featureFlagModel';

export const DEFAULT_FEATURES: AdminFeatures = {
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

export function useAppFeatureFlags() {
  const [features, setFeatures] = useState<AdminFeatures>(DEFAULT_FEATURES);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void getAppFeatures()
        .then((next) => alive && setFeatures(next))
        .catch(() => undefined);
    };
    refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);
  return { ...features, isOn: (key: string) => isFeatureOn(features, key) };
}

export function useFeature(key: string): boolean {
  return useAppFeatureFlags().isOn(key);
}
