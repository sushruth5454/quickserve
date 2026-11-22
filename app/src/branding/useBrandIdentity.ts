import { useAppearance } from './AppearanceProvider';
import { OORVA_BRANDING_CANDIDATE } from './defaults';
import {
  resolveBrandIdentity,
  type BrandContext,
  type BrandIdentityState,
  type ResolvedBrandIdentity,
} from './identity';

export function useBrandIdentity(context: BrandContext): ResolvedBrandIdentity {
  const appearance = useAppearance();
  const config = appearance.config;
  let published: BrandIdentityState['published'] = null;

  if (
    appearance.runtimeEnabled &&
    config &&
    config !== OORVA_BRANDING_CANDIDATE &&
    config.assets &&
    typeof config.assets === 'object'
  ) {
    published = {
      displayName: config.displayName,
      tagline: config.tagline,
      logoLight: config.assets.logoLight,
      logoDark: config.assets.logoDark,
      compactLight: config.assets.compactLight,
      compactDark: config.assets.compactDark,
    };
  }

  return resolveBrandIdentity(context, {
    brandOn: appearance.brandingEnabled,
    runtimeOn: appearance.runtimeEnabled,
    bundledIdentityReady: false,
    published,
  });
}
