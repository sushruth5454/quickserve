import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { listCategories, listMyServices } from '../../lib/api';
import { onboardingApi, type CategorySkill, type DocumentType, type OnboardingState } from '../../lib/onboarding';
import type { Category, ProviderService } from '../../lib/types';

export interface OnboardingData {
  state: OnboardingState;
  categories: (Category & { requires_docs?: string[]; recommended_docs?: string[] })[];
  services: ProviderService[];
  skills: CategorySkill[];
  docTypes: DocumentType[];
}

/** Loads everything the onboarding/profile screens need and refreshes on focus. */
export function useOnboardingData() {
  const [data, setData] = useState<OnboardingData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [state, categories, catalog] = await Promise.all([onboardingApi.getOnboarding(), listCategories(), onboardingApi.getCatalog()]);
      const services = state.provider ? await listMyServices(true) : [];
      setData({ state, categories, services, skills: catalog.skills, docTypes: catalog.docTypes });
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return { data, error, reload };
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
