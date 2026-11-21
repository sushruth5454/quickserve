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

import React, { useState } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Image, useColorScheme } from 'react-native';
import validAppearance from '../fixtures/appearance-valid.json';
import type { AppFeatures } from '../FeatureFlagsProvider';
import { useFeatureControlState } from '../FeatureFlagsProvider';
import { AppearanceProvider, useAppearance } from '../AppearanceProvider';
import { validateAppearanceCandidate } from '../api';
import { OORVA_BRANDING_CANDIDATE } from '../defaults';
import { ThemeProvider, useTheme, type Theme } from '../../theme/ThemeProvider';
import { getContrastFailures } from '../colorContract';
import { darkPalette, lightPalette } from '../../theme/tokens';

const controls = useFeatureControlState as jest.MockedFunction<typeof useFeatureControlState>;
const prefetch = Image.prefetch as jest.MockedFunction<typeof Image.prefetch>;
const colorScheme = useColorScheme as jest.MockedFunction<typeof useColorScheme>;

type Observation = {
  theme: Theme;
  config: ReturnType<typeof useAppearance>['config'];
  brandingEnabled: boolean;
  runtimeEnabled: boolean;
  guestBrowseEnabled: boolean;
  draft: string;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  mountId: number;
};

let observation: Observation | null = null;
let nextMountId = 0;

function makeFeatures(overrides: Record<string, unknown> = {}): AppFeatures {
  return {
    ai_assistant: true,
    urgent_requests: true,
    fixed_asap: true,
    guest_browse: false,
    oorva_brand: false,
    branding_runtime: false,
    archetypes: {
      inspect_quote: true,
      fixed: true,
      time_based: true,
      proposal: true,
    },
    ...overrides,
  } as AppFeatures;
}

function copyAppearance(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...(JSON.parse(JSON.stringify(validAppearance)) as Record<string, unknown>), ...overrides };
}

function AppProbe({ manropeReady = false }: { manropeReady?: boolean }) {
  const theme = useTheme();
  const appearance = useAppearance();
  const controlsState = useFeatureControlState();
  const [draft, setDraft] = useState('untouched');
  const [mountId] = useState(() => ++nextMountId);
  observation = {
    theme,
    config: appearance.config,
    brandingEnabled: appearance.brandingEnabled,
    runtimeEnabled: appearance.runtimeEnabled,
    guestBrowseEnabled: controlsState.features.guest_browse === true,
    draft,
    setDraft,
    mountId,
  };
  return null;
}

function tree(manropeReady = false) {
  return (
    <AppearanceProvider>
      <ThemeProvider manropeReady={manropeReady}>
        <AppProbe />
      </ThemeProvider>
    </AppearanceProvider>
  );
}

async function settleEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('O05A atomic appearance integration', () => {
  let renderer: TestRenderer.ReactTestRenderer | null = null;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://quickserve.example.test';
    controls.mockReturnValue({
      features: makeFeatures(),
      freshness: 'live',
      appearanceCandidate: undefined,
      refresh: jest.fn().mockResolvedValue(undefined),
    });
    prefetch.mockReset().mockResolvedValue(true);
    colorScheme.mockReturnValue(null);
    observation = null;
    nextMountId = 0;
  });

  afterEach(() => {
    if (renderer) {
      act(() => renderer?.unmount());
      renderer = null;
    }
  });

  it('UI-CACHE-01 publishes a fully preloaded theme in one immutable swap', async () => {
    let finishPreload!: (available: boolean) => void;
    prefetch.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finishPreload = resolve;
        }),
    );
    const candidate = copyAppearance();
    (candidate.assets as Record<string, unknown>).logoLight = '00000000-0000-4000-8000-000000000001';
    controls.mockReturnValue({
      features: makeFeatures({ oorva_brand: true, branding_runtime: true }),
      freshness: 'live',
      appearanceCandidate: candidate,
      refresh: jest.fn().mockResolvedValue(undefined),
    });

    await act(async () => {
      renderer = TestRenderer.create(tree());
    });
    expect(observation?.theme.colors.primary).toBe(OORVA_BRANDING_CANDIDATE.light.primary);

    await act(async () => {
      finishPreload(true);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(observation?.theme.colors.primary).toBe((candidate.light as Record<string, string>).primary);
    expect(observation?.theme.colors.bg).toBe((candidate.light as Record<string, string>).bg);
    expect(Object.isFrozen(observation?.theme)).toBe(true);
    expect(Object.isFrozen(observation?.theme.colors)).toBe(true);

    const publishedTheme = observation?.theme;
    await act(async () => {
      renderer?.update(tree());
    });
    expect(observation?.theme).toBe(publishedTheme);
  });

  it('UI-CACHE-02 keeps legacy identity on parent OFF and falls back for compatibility responses', async () => {
    expect(getContrastFailures(lightPalette)).toEqual([]);
    expect(getContrastFailures(darkPalette)).toEqual([]);
    const candidate = copyAppearance();
    await act(async () => {
      renderer = TestRenderer.create(<AppProbe />);
    });
    expect(observation?.config).toBeNull();
    expect(observation?.theme.colors.primary).toBe('#1F4FD1');
    act(() => renderer?.unmount());

    controls.mockReturnValue({
      features: makeFeatures({ oorva_brand: false, branding_runtime: true }),
      freshness: 'fallback',
      appearanceCandidate: candidate,
      refresh: jest.fn().mockResolvedValue(undefined),
    });

    await act(async () => {
      renderer = TestRenderer.create(tree());
    });
    expect(observation?.brandingEnabled).toBe(false);
    expect(observation?.runtimeEnabled).toBe(false);
    expect(observation?.config).toBeNull();
    expect(observation?.theme.colors.primary).toBe('#1F4FD1');
    expect(prefetch).not.toHaveBeenCalled();

    controls.mockReturnValue({
      features: makeFeatures(),
      freshness: 'fallback',
      appearanceCandidate: undefined,
      refresh: jest.fn().mockResolvedValue(undefined),
    });
    await act(async () => {
      renderer?.update(tree());
    });
    expect(observation?.theme.colors.primary).toBe('#1F4FD1');
    expect(observation?.config).toBeNull();

    controls.mockReturnValue({
      features: makeFeatures({ oorva_brand: true, branding_runtime: true }),
      freshness: 'cache',
      appearanceCandidate: undefined,
      refresh: jest.fn().mockResolvedValue(undefined),
    });
    await act(async () => {
      renderer?.update(tree());
    });
    expect(observation?.config).toBe(OORVA_BRANDING_CANDIDATE);
    expect(observation?.theme.colors.primary).toBe(OORVA_BRANDING_CANDIDATE.light.primary);
    expect(prefetch).not.toHaveBeenCalled();
    expect(observation?.guestBrowseEnabled).toBe(false);
  });

  it('UI-CACHE-03 rejects unknown schema and treats a failed logo preload as bundled fallback', async () => {
    const unknownSchema = copyAppearance({ schemaVersion: 2 });
    expect(validateAppearanceCandidate(unknownSchema)).toBeNull();
    controls.mockReturnValue({
      features: makeFeatures({ oorva_brand: true, branding_runtime: true }),
      freshness: 'live',
      appearanceCandidate: unknownSchema,
      refresh: jest.fn().mockResolvedValue(undefined),
    });
    await act(async () => {
      renderer = TestRenderer.create(tree());
    });
    expect(observation?.theme.colors.primary).toBe(OORVA_BRANDING_CANDIDATE.light.primary);
    expect(prefetch).not.toHaveBeenCalled();

    const candidate = copyAppearance();
    (candidate.assets as Record<string, unknown>).logoDark = '00000000-0000-4000-8000-000000000002';
    prefetch.mockRejectedValue(new Error('asset unavailable'));
    controls.mockReturnValue({
      features: makeFeatures({ oorva_brand: true, branding_runtime: true }),
      freshness: 'live',
      appearanceCandidate: candidate,
      refresh: jest.fn().mockResolvedValue(undefined),
    });
    await act(async () => {
      observation?.setDraft('dirty after failed logo');
      renderer?.update(tree());
    });
    await settleEffects();
    expect(observation?.theme.colors.primary).toBe(OORVA_BRANDING_CANDIDATE.light.primary);
    expect(observation?.brandingEnabled).toBe(true);
    expect(observation?.guestBrowseEnabled).toBe(false);
    expect(observation?.draft).toBe('dirty after failed logo');
  });

  it('UI-CACHE-04 respects OS-first theme selection, preserves dirty drafts, and falls back from Manrope', async () => {
    const candidate = copyAppearance({
      defaultTheme: 'light',
      headingFont: 'manrope',
    });
    controls.mockReturnValue({
      features: makeFeatures({ oorva_brand: true, branding_runtime: true }),
      freshness: 'live',
      appearanceCandidate: candidate,
      refresh: jest.fn().mockResolvedValue(undefined),
    });
    colorScheme.mockReturnValue('dark');

    await act(async () => {
      renderer = TestRenderer.create(tree(false));
    });
    await settleEffects();
    expect(observation?.theme.dark).toBe(true);
    expect(observation?.theme.typography.title1.fontFamily).toBe('Inter_700Bold');
    expect(observation?.theme.typography.body.fontFamily).toBe('Inter_400Regular');

    await act(async () => {
      observation?.setDraft('unsaved form value');
      renderer?.update(tree(true));
    });
    expect(observation?.theme.typography.title1.fontFamily).toBe('Manrope_700Bold');
    expect(observation?.draft).toBe('unsaved form value');
    expect(observation?.mountId).toBe(1);

    colorScheme.mockReturnValue('light');
    await act(async () => {
      renderer?.update(tree(true));
    });
    expect(observation?.theme.dark).toBe(false);
    expect(observation?.draft).toBe('unsaved form value');
    expect(observation?.mountId).toBe(1);

    colorScheme.mockReturnValue(null);
    const darkDefault = copyAppearance({ defaultTheme: 'dark', headingFont: 'manrope' });
    controls.mockReturnValue({
      features: makeFeatures({ oorva_brand: true, branding_runtime: true }),
      freshness: 'live',
      appearanceCandidate: darkDefault,
      refresh: jest.fn().mockResolvedValue(undefined),
    });
    await act(async () => {
      renderer?.update(tree(true));
    });
    await settleEffects();
    expect(observation?.theme.dark).toBe(true);
    expect(observation?.draft).toBe('unsaved form value');
    expect(observation?.mountId).toBe(1);
  });
});
