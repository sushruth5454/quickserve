import type { ColorOverrideKey } from './colorContract';

export type ThemeMode = 'system' | 'light' | 'dark';

export interface BrandingAssetsV1 {
  logoLight: string | null;
  logoDark: string | null;
  compactLight: string | null;
  compactDark: string | null;
  promotional: string[];
}

export interface BrandingV1 {
  schemaVersion: 1;
  displayName: string;
  tagline: string;
  defaultTheme: ThemeMode;
  headingFont: 'manrope' | 'inter';
  assets: BrandingAssetsV1;
  light: Partial<Record<ColorOverrideKey, string>>;
  dark: Partial<Record<ColorOverrideKey, string>>;
  motion: {
    launchDurationMs: number;
  };
}

export interface PublicFeatures {
  [key: string]: boolean | Record<string, boolean>;
  archetypes: Record<string, boolean>;
}

export interface BrandingSnapshot {
  generation: string;
  publishedVersionId: string | null;
  config: BrandingV1 | null;
  flags: PublicFeatures;
}
