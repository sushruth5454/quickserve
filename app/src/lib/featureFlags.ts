import { useEffect, useState } from 'react';
import { getAppFeatures, type AdminFeatures } from './adminApi';

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
    void getAppFeatures()
      .then((next) => alive && setFeatures(next))
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);
  return features;
}
