/** Profile completeness (display score + tips). The server's _provider_onboarding_checks() is authoritative for submit. */
import type { Check, CheckKey, OnboardingState } from './types';

export const STEP_KEYS = ['basics', 'services', 'area', 'hours', 'portfolio', 'payouts', 'review'] as const;
export type StepKey = (typeof STEP_KEYS)[number];

const WEIGHTS: Record<CheckKey, number> = {
  photo: 15,
  name: 5,
  bio: 10,
  languages: 5,
  services: 15,
  specialisations: 10,
  area: 10,
  hours: 10,
  portfolio: 10,
  payout: 10,
};

const STEP_OF: Record<CheckKey, StepKey> = {
  name: 'basics',
  photo: 'basics',
  bio: 'basics',
  languages: 'basics',
  services: 'services',
  specialisations: 'services',
  area: 'area',
  hours: 'hours',
  portfolio: 'portfolio',
  payout: 'payouts',
};

/** Neutral, factual tips (no promised outcomes). */
const TIPS: Record<CheckKey, string> = {
  photo: 'Add a clear photo of your face. Customers see it before they book.',
  name: 'Add your name as customers should see it.',
  bio: 'Write a short bio (at least 30 characters) about your experience and the work you do best.',
  languages: 'Add the languages you speak so customers know how to talk to you.',
  services: 'Add at least one service with your visit fee and labour rate.',
  specialisations: 'Pick your specialisations for each service so customers know exactly what you handle.',
  area: 'Set your base location and how far you travel.',
  hours: 'Set your working hours so customers only book times you are available.',
  portfolio: 'Add at least 3 photos of your past work so customers can see its quality.',
  payout: 'Add your bank account so we can send your earnings.',
};

export interface Completeness {
  score: number;
  requiredDone: boolean;
  missingRequired: CheckKey[];
  tips: { key: CheckKey; step: StepKey; text: string; required: boolean }[];
}

export function completeness(checks: Check[]): Completeness {
  let score = 0;
  for (const c of checks) if (c.ok) score += WEIGHTS[c.key] ?? 0;
  const missing = checks.filter((c) => !c.ok);
  const missingRequired = missing.filter((c) => c.required).map((c) => c.key);
  const tips = missing
    .sort((a, b) => Number(b.required) - Number(a.required) || (WEIGHTS[b.key] ?? 0) - (WEIGHTS[a.key] ?? 0))
    .map((c) => ({ key: c.key, step: STEP_OF[c.key], text: TIPS[c.key], required: c.required }));
  return { score: Math.min(100, score), requiredDone: missingRequired.length === 0, missingRequired, tips };
}

export function stepDone(step: StepKey, state: OnboardingState): boolean {
  const ok = (k: CheckKey) => state.checks.find((c) => c.key === k)?.ok ?? false;
  switch (step) {
    case 'basics':
      return ok('name') && ok('photo') && ok('bio') && ok('languages');
    case 'services':
      return ok('services');
    case 'area':
      return ok('area');
    case 'hours':
      return ok('hours');
    case 'portfolio':
      return true; // optional step
    case 'payouts':
      return state.provider?.razorpay_account_id != null
        || (!!state.payout
          && (state.payout.razorpay_account_id != null
            || state.payout.fund_account_id != null
            || state.payout.last_error === 'gateway_unavailable'));
    case 'review':
      return !!state.provider?.submitted_at;
  }
}

/** Where a returning provider resumes: the first required step that is not done, else the furthest visited step. */
export function resumeStep(state: OnboardingState): number {
  if (!state.provider) return 0;
  if (state.provider.submitted_at) return STEP_KEYS.indexOf('review');
  const firstMissing = STEP_KEYS.findIndex((s) => s !== 'portfolio' && s !== 'payouts' && s !== 'review' && !stepDone(s, state));
  if (firstMissing >= 0) return firstMissing;
  return Math.min(Math.max(state.provider.onboarding_step, 4), STEP_KEYS.length - 1);
}
