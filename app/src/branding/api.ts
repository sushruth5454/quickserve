import { Image } from 'react-native';
import { validateAppearanceV1 } from './validation';
import type { BrandingV1 } from './types';

const ASSET_ID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const BUNDLED_HEADING_FONTS = new Set<BrandingV1['headingFont']>(['inter', 'manrope']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBundledHeadingFont(value: unknown): value is BrandingV1['headingFont'] {
  return typeof value === 'string' && BUNDLED_HEADING_FONTS.has(value as BrandingV1['headingFont']);
}

export function validateAppearanceCandidate(value: unknown): BrandingV1 | null {
  try {
    if (!isRecord(value)) return null;
    const headingFont = value.headingFont;
    if (!isBundledHeadingFont(headingFont)) return null;

    // O02 predates these local Manrope faces; retain all its checks except this now-bundled value.
    const validationInput =
      headingFont === 'manrope' ? { ...value, headingFont: 'inter' } : value;
    const result = validateAppearanceV1(validationInput);
    if (!result.valid || !result.value) return null;
    return { ...result.value, headingFont };
  } catch {
    return null;
  }
}

function getBrandingAssetUrl(assetId: string): string | null {
  if (!ASSET_ID_PATTERN.test(assetId)) return null;
  const projectUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!projectUrl) return null;

  try {
    const endpoint = new URL('/functions/v1/branding-assets', projectUrl);
    endpoint.searchParams.set('asset_id', assetId);
    return endpoint.toString();
  } catch {
    return null;
  }
}

export async function preloadAppearanceAssets(appearance: BrandingV1): Promise<boolean> {
  const assetIds = [
    appearance.assets.logoLight,
    appearance.assets.logoDark,
    appearance.assets.compactLight,
    appearance.assets.compactDark,
  ].filter((assetId): assetId is string => assetId !== null);
  if (assetIds.length === 0) return true;

  const assetUrls = assetIds.map(getBrandingAssetUrl);
  if (assetUrls.some((assetUrl) => assetUrl === null)) return false;

  try {
    const results = await Promise.all(assetUrls.map((assetUrl) => Image.prefetch(assetUrl!)));
    return results.every(Boolean);
  } catch {
    return false;
  }
}
