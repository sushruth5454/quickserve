/** Provider onboarding facade: real Supabase backend or the in-memory demo mirror (same rule as lib/api.ts). */
import { isDemoMode } from '../config';
import { demoOnboardingApi } from '../demo/demoOnboarding';
import { supabaseOnboardingApi } from './supabaseOnboarding';
import type { OnboardingApi } from './types';

export * from './types';
export const onboardingApi: OnboardingApi = isDemoMode ? demoOnboardingApi : supabaseOnboardingApi;
