import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { en } from './en';
import { te } from './te';

export type Language = 'en' | 'te';
export type TranslationKey = keyof typeof en;
type TranslationVars = Record<string, string | number>;
type Translator = (key: TranslationKey, vars?: TranslationVars) => string;

const LANGUAGE_STORAGE_KEY = 'quickserve.lang.v1';

interface LanguageContextValue {
  language: Language;
  languagePickerEnabled: boolean;
  setLanguage: (language: Language) => Promise<void>;
  t: Translator;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function isLanguage(value: string | null): value is Language {
  return value === 'en' || value === 'te';
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { userId } = useAuth();
  const [selectedLanguage, setSelectedLanguage] = useState<Language>('en');
  const [hasLocalPreference, setHasLocalPreference] = useState(false);
  const [languagePickerEnabled, setLanguagePickerEnabled] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const syncedUserId = useRef<string | null>(null);

  const refreshFeatureFlag = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('get_app_features');
      const enabled = !error && (data as Record<string, unknown> | null)?.telugu_language === true;
      setLanguagePickerEnabled(enabled);
    } catch {
      setLanguagePickerEnabled(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(LANGUAGE_STORAGE_KEY)
      .catch(() => null)
      .then((stored) => {
        if (!active) return;
        if (isLanguage(stored)) {
          setSelectedLanguage(stored);
          setHasLocalPreference(true);
        }
        setStorageReady(true);
      });

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshFeatureFlag();
    });
    void refreshFeatureFlag();
    return () => {
      active = false;
      subscription.remove();
    };
  }, [refreshFeatureFlag]);

  useEffect(() => {
    if (!userId) {
      syncedUserId.current = null;
      return;
    }
    if (!storageReady || !languagePickerEnabled || syncedUserId.current === userId) return;

    let active = true;
    syncedUserId.current = userId;
    void (async () => {
      if (!active) return;
      if (hasLocalPreference) {
        await supabase.rpc('set_preferred_language', { p_language: selectedLanguage });
        return;
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('preferred_language')
        .eq('id', userId)
        .maybeSingle<{ preferred_language: string }>();
      if (!active || error || !data || !isLanguage(data.preferred_language)) return;

      setSelectedLanguage(data.preferred_language);
      setHasLocalPreference(true);
      await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, data.preferred_language).catch(() => undefined);
    })().catch(() => undefined);
    return () => {
      active = false;
    };
  }, [userId, storageReady, languagePickerEnabled, hasLocalPreference, selectedLanguage]);

  const language: Language = languagePickerEnabled ? selectedLanguage : 'en';
  const setLanguage = useCallback(
    async (next: Language) => {
      if (!languagePickerEnabled) return;
      setSelectedLanguage(next);
      setHasLocalPreference(true);
      if (userId) syncedUserId.current = userId;
      await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, next);
      if (userId) {
        const { error } = await supabase.rpc('set_preferred_language', { p_language: next });
        if (error) throw error;
      }
    },
    [languagePickerEnabled, userId],
  );
  const t = useCallback<Translator>(
    (key, vars) => {
      const template = language === 'te' ? te[key] ?? en[key] : en[key];
      return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
        const value = vars?.[name];
        return value === undefined ? placeholder : String(value);
      });
    },
    [language],
  );
  const value = useMemo(
    () => ({ language, languagePickerEnabled, setLanguage, t }),
    [language, languagePickerEnabled, setLanguage, t],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used inside LanguageProvider');
  return context;
}

export function useT() {
  return useLanguage().t;
}
