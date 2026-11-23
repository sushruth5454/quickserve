import {
  OORVA_BRANDING_CANDIDATE,
  OORVA_SELECTED_BRAND_EXPORTS,
} from './defaults';

export type BrandContext =
  | 'login' | 'auth' | 'home' | 'account' | 'providerShare' | 'protectedInvite'
  | 'ai' | 'assistant' | 'support' | 'byo' | 'recurring' | 'rfq'
  | 'nearoReceipt' | 'receiptChrome' | 'quoteFunding' | 'paymentOverlay'
  | 'statusTimeline' | 'nearoCheckout' | 'checkoutPage' | 'gatewayDescription'
  | 'onboardingAgreement';

export type BrandAssetReference = string | number | null;

export type BrandIdentityState = {
  brandOn: boolean;
  runtimeOn: boolean;
  bundledIdentityReady: boolean;
  published: {
    schemaVersion?: number;
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
  logoLight: BrandAssetReference;
  logoDark: BrandAssetReference;
  compactLight: BrandAssetReference;
  compactDark: BrandAssetReference;
  source: 'legacy' | 'bundled' | 'published';
};

const LEGACY_NAME_BY_CONTEXT: Record<BrandContext, 'QuickServe' | 'Nearo'> = {
  login: 'QuickServe',
  auth: 'QuickServe',
  home: 'QuickServe',
  account: 'QuickServe',
  providerShare: 'QuickServe',
  protectedInvite: 'QuickServe',
  ai: 'QuickServe',
  assistant: 'QuickServe',
  support: 'QuickServe',
  byo: 'QuickServe',
  recurring: 'Nearo',
  rfq: 'Nearo',
  nearoReceipt: 'Nearo',
  receiptChrome: 'Nearo',
  quoteFunding: 'Nearo',
  paymentOverlay: 'QuickServe',
  statusTimeline: 'QuickServe',
  nearoCheckout: 'Nearo',
  checkoutPage: 'Nearo',
  gatewayDescription: 'Nearo',
  onboardingAgreement: 'QuickServe',
};

function legacyIdentity(context: BrandContext): ResolvedBrandIdentity {
  return {
    displayName: LEGACY_NAME_BY_CONTEXT[context] ?? 'QuickServe',
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
    (value.schemaVersion === undefined || value.schemaVersion === 1) &&
    typeof value.displayName === 'string' &&
    value.displayName.trim().length > 0 &&
    typeof value.tagline === 'string' &&
    isAsset(value.logoLight) &&
    isAsset(value.logoDark) &&
    isAsset(value.compactLight) &&
    isAsset(value.compactDark)
  );
}

function hasBundledAssets(): boolean {
  return (Object.values(OORVA_SELECTED_BRAND_EXPORTS) as unknown[]).every(
    (asset) =>
      asset !== null &&
      asset !== undefined &&
      (typeof asset !== 'string' || asset.trim().length > 0),
  );
}

function bundledIdentity(): ResolvedBrandIdentity | null {
  const assets = OORVA_SELECTED_BRAND_EXPORTS;
  if (!hasBundledAssets()) return null;

  const { displayName, tagline } = OORVA_BRANDING_CANDIDATE;
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
  const legacy = legacyIdentity(context);
  if (state?.brandOn !== true || legacy.displayName === 'Nearo') return legacy;

  if (state.runtimeOn === true && isValidPublishedIdentity(state.published)) {
    const { displayName, tagline, logoLight, logoDark, compactLight, compactDark } =
      state.published;
    return {
      displayName,
      tagline,
      logoLight,
      logoDark,
      compactLight,
      compactDark,
      source: 'published',
    };
  }

  if (state.bundledIdentityReady === true) {
    const bundled = bundledIdentity();
    if (bundled) return bundled;
  }
  return legacy;
}
