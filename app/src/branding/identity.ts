import { OORVA_BRANDING_CANDIDATE } from './defaults';

export type BrandContext =
  | 'auth' | 'home' | 'account' | 'providerShare' | 'protectedInvite'
  | 'assistant' | 'support' | 'recurring' | 'rfq' | 'receiptChrome'
  | 'quoteFunding' | 'paymentOverlay' | 'statusTimeline'
  | 'checkoutPage' | 'gatewayDescription' | 'onboardingAgreement';

export type BrandIdentityState = {
  brandOn: boolean;
  runtimeOn: boolean;
  bundledIdentityReady: boolean;
  published: {
    displayName: string;
    tagline: string;
    logoLight: string | null;
    logoDark: string | null;
    compactLight: string | null;
    compactDark: string | null;
  } | null;
};

export type ResolvedBrandIdentity = {
  displayName: string;
  tagline: string | null;
  logoLight: string | null;
  logoDark: string | null;
  compactLight: string | null;
  compactDark: string | null;
  source: 'legacy' | 'bundled' | 'published';
};

const LEGACY_NAME_BY_CONTEXT: Record<BrandContext, 'QuickServe' | 'Nearo'> = {
  auth: 'QuickServe',
  home: 'QuickServe',
  account: 'QuickServe',
  providerShare: 'QuickServe',
  protectedInvite: 'QuickServe',
  assistant: 'QuickServe',
  support: 'QuickServe',
  recurring: 'Nearo',
  rfq: 'Nearo',
  receiptChrome: 'Nearo',
  quoteFunding: 'Nearo',
  paymentOverlay: 'QuickServe',
  statusTimeline: 'QuickServe',
  checkoutPage: 'QuickServe',
  gatewayDescription: 'Nearo',
  onboardingAgreement: 'QuickServe',
};

function legacyIdentity(context: BrandContext): ResolvedBrandIdentity {
  return {
    displayName: LEGACY_NAME_BY_CONTEXT[context],
    tagline: null,
    logoLight: null,
    logoDark: null,
    compactLight: null,
    compactDark: null,
    source: 'legacy',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAsset(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.trim().length > 0);
}

function isValidPublishedIdentity(
  value: unknown,
): value is NonNullable<BrandIdentityState['published']> {
  if (!isRecord(value)) return false;
  return (
    typeof value.displayName === 'string' &&
    value.displayName.trim().length > 0 &&
    typeof value.tagline === 'string' &&
    isAsset(value.logoLight) &&
    isAsset(value.logoDark) &&
    isAsset(value.compactLight) &&
    isAsset(value.compactDark)
  );
}

function bundledIdentity(): ResolvedBrandIdentity {
  const { displayName, tagline, assets } = OORVA_BRANDING_CANDIDATE;
  return {
    displayName,
    tagline,
    logoLight: assets.logoLight,
    logoDark: assets.logoDark,
    compactLight: assets.compactLight,
    compactDark: assets.compactDark,
    source: 'bundled',
  };
}

export function resolveBrandIdentity(
  context: BrandContext,
  state: BrandIdentityState,
): ResolvedBrandIdentity {
  if (state?.brandOn !== true) return legacyIdentity(context);

  if (state.runtimeOn === true && isValidPublishedIdentity(state.published)) {
    return { ...state.published, source: 'published' };
  }

  if (state.bundledIdentityReady === true) return bundledIdentity();
  return legacyIdentity(context);
}
