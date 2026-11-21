jest.mock('react-native-reanimated', () => ({
  Easing: { bezier: jest.fn(() => jest.fn()) },
}));

jest.mock('react-native', () => {
  const native = jest.requireActual('react-native');
  return {
    ...native,
    Image: Object.assign(native.Image, { prefetch: jest.fn() }),
    useColorScheme: jest.fn(() => null),
  };
});

jest.mock('../FeatureFlagsProvider', () => ({
  useFeatureControlState: jest.fn(),
}));

import React from 'react';
import { Image } from 'react-native';
import validAppearance from '../fixtures/appearance-valid.json';
import {
  createAppearanceProviderElement,
  resolveAppearanceConfig,
  type AppearanceState,
} from '../AppearanceProvider';
import { preloadAppearanceAssets, validateAppearanceCandidate } from '../api';
import { OORVA_BRANDING_CANDIDATE } from '../defaults';
import { getContrastFailures } from '../colorContract';
import { darkPalette, lightPalette } from '../../theme/tokens';
import { createThemeSnapshot, resolveDarkTheme } from '../../theme/ThemeProvider';
import type { BrandingV1 } from '../types';

const prefetch = Image.prefetch as jest.MockedFunction<typeof Image.prefetch>;

function copyAppearance(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...(JSON.parse(JSON.stringify(validAppearance)) as Record<string, unknown>), ...overrides };
}

function getAppearance(value: unknown = validAppearance): BrandingV1 {
  const appearance = validateAppearanceCandidate(value);
  if (!appearance) throw new Error(`expected valid appearance, received ${JSON.stringify(value)}`);
  return appearance;
}

function appearanceState(overrides: Partial<AppearanceState> = {}): AppearanceState {
  return {
    brandingEnabled: false,
    runtimeEnabled: false,
    config: null,
    refresh: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function DirtyDraft(_props: { draft: { value: string } }): null {
  return null;
}

describe('O05A atomic appearance integration', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://quickserve.example.test';
    prefetch.mockReset().mockResolvedValue(true);
  });

  it('UI-CACHE-01 publishes a complete immutable appearance only after preload', async () => {
    let finishPreload!: (available: boolean) => void;
    prefetch.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finishPreload = resolve;
        }),
    );
    const candidateData = copyAppearance();
    (candidateData.assets as Record<string, unknown>).logoLight =
      '00000000-0000-4000-8000-000000000001';
    const candidate = getAppearance(candidateData);
    const candidateKey = JSON.stringify(candidate);
    const input = {
      brandingEnabled: true,
      runtimeFlag: true,
      candidate,
      candidateKey,
    };
    const loadingConfig = resolveAppearanceConfig({ ...input, preloaded: null });
    const preload = preloadAppearanceAssets(candidate);

    expect(loadingConfig).toBe(OORVA_BRANDING_CANDIDATE);
    finishPreload(true);
    await expect(preload).resolves.toBe(true);

    const publishedConfig = resolveAppearanceConfig({
      ...input,
      preloaded: { key: candidateKey, config: candidate },
    });
    const theme = createThemeSnapshot(false, publishedConfig, false);
    expect(publishedConfig).toBe(candidate);
    expect(theme.colors.primary).toBe(candidate.light.primary);
    expect(theme.colors.bg).toBe(candidate.light.bg);
    expect(Object.isFrozen(theme)).toBe(true);
    expect(Object.isFrozen(theme.colors)).toBe(true);
    expect(
      resolveAppearanceConfig({
        ...input,
        preloaded: { key: candidateKey, config: candidate },
      }),
    ).toBe(publishedConfig);

    const nextCandidate = getAppearance(copyAppearance({ tagline: 'Next appearance' }));
    expect(
      resolveAppearanceConfig({
        brandingEnabled: true,
        runtimeFlag: true,
        candidate: nextCandidate,
        candidateKey: JSON.stringify(nextCandidate),
        preloaded: { key: candidateKey, config: candidate },
      }),
    ).toBe(candidate);
  });

  it('UI-CACHE-02 keeps legacy identity on parent OFF and uses bundled appearance for compatibility fallback', () => {
    expect(getContrastFailures(lightPalette)).toEqual([]);
    expect(getContrastFailures(darkPalette)).toEqual([]);

    const candidate = getAppearance();
    expect(
      resolveAppearanceConfig({
        brandingEnabled: false,
        runtimeFlag: true,
        candidate,
        candidateKey: 'candidate',
        preloaded: { key: 'candidate', config: candidate },
      }),
    ).toBeNull();
    expect(
      resolveAppearanceConfig({
        brandingEnabled: true,
        runtimeFlag: false,
        candidate,
        candidateKey: 'candidate',
        preloaded: null,
      }),
    ).toBe(OORVA_BRANDING_CANDIDATE);
    expect(
      resolveAppearanceConfig({
        brandingEnabled: true,
        runtimeFlag: true,
        candidate: null,
        candidateKey: '',
        preloaded: null,
      }),
    ).toBe(OORVA_BRANDING_CANDIDATE);
    expect(createThemeSnapshot(false, null, false).colors.primary).toBe(lightPalette.primary);
    expect(prefetch).not.toHaveBeenCalled();
  });

  it('UI-CACHE-03 rejects unknown schema and bad logos without touching OFF controls or dirty children', async () => {
    const unknownSchema = copyAppearance({ schemaVersion: 2 });
    expect(validateAppearanceCandidate(unknownSchema)).toBeNull();

    const badLogo = copyAppearance();
    (badLogo.assets as Record<string, unknown>).logoDark = 'not-an-asset-id';
    expect(validateAppearanceCandidate(badLogo)).toBeNull();
    expect(prefetch).not.toHaveBeenCalled();

    const unavailableLogo = copyAppearance();
    (unavailableLogo.assets as Record<string, unknown>).logoDark =
      '00000000-0000-4000-8000-000000000002';
    prefetch.mockRejectedValue(new Error('asset unavailable'));
    const candidate = getAppearance(unavailableLogo);
    await expect(preloadAppearanceAssets(candidate)).resolves.toBe(false);
    expect(
      resolveAppearanceConfig({
        brandingEnabled: true,
        runtimeFlag: true,
        candidate,
        candidateKey: JSON.stringify(candidate),
        preloaded: { key: JSON.stringify(candidate), config: null },
      }),
    ).toBe(OORVA_BRANDING_CANDIDATE);

    const features = { guest_browse: false, oorva_brand: false };
    const dirtyDraft = { value: 'unsaved form value' };
    const child = React.createElement(DirtyDraft, { draft: dirtyDraft });
    const before = createAppearanceProviderElement(appearanceState(), child);
    const after = createAppearanceProviderElement(
      appearanceState({ brandingEnabled: true, config: candidate }),
      child,
    );
    expect(features.guest_browse).toBe(false);
    expect(features.oorva_brand).toBe(false);
    expect(before.type).toBe(after.type);
    expect(before.key).toBeNull();
    expect(after.key).toBeNull();
    expect(after.props.children).toBe(child);
    expect((after.props.children as React.ReactElement<{ draft: typeof dirtyDraft }>).props.draft).toBe(
      dirtyDraft,
    );
  });

  it('UI-CACHE-04 respects OS-first theme selection and falls back from unavailable Manrope', () => {
    const candidate = getAppearance(copyAppearance({ defaultTheme: 'light', headingFont: 'manrope' }));
    expect(resolveDarkTheme('dark', candidate)).toBe(true);
    expect(resolveDarkTheme('light', { ...candidate, defaultTheme: 'dark' })).toBe(false);
    expect(resolveDarkTheme(null, { ...candidate, defaultTheme: 'dark' })).toBe(true);
    expect(resolveDarkTheme(null, candidate)).toBe(false);

    const interFallback = createThemeSnapshot(true, candidate, false);
    const manropeReady = createThemeSnapshot(true, candidate, true);
    expect(interFallback.typography.title1.fontFamily).toBe('Inter_700Bold');
    expect(interFallback.typography.body.fontFamily).toBe('Inter_400Regular');
    expect(manropeReady.typography.title1.fontFamily).toBe('Manrope_700Bold');
    expect(manropeReady.typography.title2.fontFamily).toBe('Manrope_600SemiBold');
    expect(manropeReady.typography.body.fontFamily).toBe('Inter_400Regular');
  });
});
