jest.mock('react-native-reanimated', () => ({
  Easing: { bezier: jest.fn(() => jest.fn()) },
}));

import invalidAppearance from '../fixtures/appearance-invalid.json';
import validAppearance from '../fixtures/appearance-valid.json';
import { OORVA_BRANDING_CANDIDATE } from '../defaults';
import { getContrastFailures } from '../colorContract';
import { validateAppearanceV1 } from '../validation';
import { darkPalette, lightPalette } from '../../theme/tokens';
import { contrastRatio } from '../../theme/contrast';

type ThemeMode = 'light' | 'dark';

function copyValidAppearance(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(validAppearance)) as Record<string, unknown>;
}

function copyColorOverrides(
  appearance: Record<string, unknown>,
  mode: ThemeMode,
): Record<string, unknown> {
  return appearance[mode] as Record<string, unknown>;
}

describe('O02 strict appearance color contract', () => {
  it('reproduces the unread and pressed-destructive contrast defects from PF-F09', () => {
    expect(contrastRatio('#FFFFFF', lightPalette.danger)).toBeCloseTo(3.7574, 3);
    expect(contrastRatio('#FFFFFF', darkPalette.danger)).toBeCloseTo(2.7861, 3);
    expect(contrastRatio('#FFFFFF', darkPalette.dangerText)).toBeCloseTo(1.9412, 3);
    expect(contrastRatio(lightPalette.onPrimary, lightPalette.primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(darkPalette.onPrimary, darkPalette.primary)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the correct primary and segment-thumb semantics in both legacy themes', () => {
    expect(lightPalette.primary).toBe('#1F4FD1');
    expect(lightPalette.onPrimary).toBe('#FFFFFF');
    expect(lightPalette.segmentThumb).toBe('#FFFFFF');
    expect(darkPalette.primary).toBe('#2A62EA');
    expect(darkPalette.onPrimary).toBe('#FFFFFF');
    expect(darkPalette.segmentThumb).toBe('#2A3550');
  });

  it('uses the owner-approved D role mappings for the candidate palette', () => {
    expect(OORVA_BRANDING_CANDIDATE).toMatchObject({
      defaultTheme: 'system',
      light: {
        primary: '#006D77',
        primaryPressed: '#00515B',
        primarySoft: '#E4F2F1',
        primaryText: '#005B63',
        onPrimary: '#FFFFFF',
        bg: '#FFFFFF',
        secondary: '#526983',
        accent: '#E8B772',
        onAccent: '#3D2B0D',
      },
      dark: {
        primary: '#80D4D4',
        primaryPressed: '#A0E4E2',
        primarySoft: '#163D44',
        primaryText: '#9BE1E0',
        onPrimary: '#003B42',
        bg: '#0C1B21',
        accent: '#F1C482',
        onAccent: '#3D2B0D',
      },
    });

    for (const mode of ['light', 'dark'] as const) {
      expect(getContrastFailures(OORVA_BRANDING_CANDIDATE[mode])).toEqual([]);
    }
    expect(contrastRatio('#FFFFFF', '#006D77')).toBeCloseTo(6.08, 2);
    expect(contrastRatio('#FFFFFF', '#00515B')).toBeCloseTo(9.02, 2);
  });

  it('adds the exact legacy on-danger and pressed-danger roles in both themes', () => {
    expect({ onDanger: lightPalette.onDanger, dangerPressed: lightPalette.dangerPressed }).toEqual({
      onDanger: '#FFFFFF',
      dangerPressed: '#B42318',
    });
    expect({ onDanger: darkPalette.onDanger, dangerPressed: darkPalette.dangerPressed }).toEqual({
      onDanger: '#FFFFFF',
      dangerPressed: '#B42318',
    });
  });

  it('keeps every listed normal-text pair AA compliant for both legacy themes', () => {
    for (const palette of [lightPalette, darkPalette]) {
      const failures = getContrastFailures(palette);
      expect(failures).toEqual([]);
    }
  });

  it('accepts the fixed valid appearance and Oorva candidate', () => {
    expect(validAppearance.light).toEqual(OORVA_BRANDING_CANDIDATE.light);
    expect(validAppearance.dark).toEqual(OORVA_BRANDING_CANDIDATE.dark);
    expect(validateAppearanceV1(validAppearance)).toMatchObject({ valid: true, errors: [] });
    expect(validateAppearanceV1(OORVA_BRANDING_CANDIDATE)).toMatchObject({ valid: true, errors: [] });
  });

  it('rejects the fixed unsafe appearance fixture with both contrast failures', () => {
    const result = validateAppearanceV1(invalidAppearance);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('light: onDanger/dangerStrong');
    expect(result.errors.join('\n')).toContain('dark: onDanger/dangerStrong');
    expect(result.errors.join('\n')).toContain('dark: onDanger/dangerPressed');
  });

  it('fails closed when a required actual-use pair is missing', () => {
    expect(getContrastFailures({})).toContain(
      'text/bg for body text on page does not have string colors for a required actual-use pair',
    );
  });

  it('independently rejects unread-count fill that fails AA', () => {
    const appearance = copyValidAppearance();
    copyColorOverrides(appearance, 'light').dangerStrong = '#F04438';

    const result = validateAppearanceV1(appearance);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('onDanger/dangerStrong');
  });

  it('independently rejects dark unread-count fill that fails AA', () => {
    const appearance = copyValidAppearance();
    copyColorOverrides(appearance, 'dark').dangerStrong = '#F97066';

    const result = validateAppearanceV1(appearance);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('dark: onDanger/dangerStrong');
  });

  it('independently rejects the unsafe dark destructive pressed pair', () => {
    const appearance = copyValidAppearance();
    copyColorOverrides(appearance, 'dark').dangerPressed = '#FDA29B';

    const result = validateAppearanceV1(appearance);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('onDanger/dangerPressed');
  });

  it('rejects a contrast-breaking selected-count and assistant-send fill', () => {
    const appearance = copyValidAppearance();
    copyColorOverrides(appearance, 'light').primary = '#FFFFFF';

    const result = validateAppearanceV1(appearance);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('onPrimary/primary');
  });

  it('rejects unknown fields in the strict appearance object', () => {
    const appearance = copyValidAppearance();
    appearance['unexpected'] = true;

    const result = validateAppearanceV1(appearance);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('unexpected');
  });

  it('rejects an unknown contrast-breaking color override', () => {
    const appearance = copyValidAppearance();
    copyColorOverrides(appearance, 'light').unexpected = '#FFFFFF';

    const result = validateAppearanceV1(appearance);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('light.unexpected is not an allowed color token');
  });

  it('rejects unsafe URLs, unsupported fonts, and non-hex color values', () => {
    const urlAppearance = copyValidAppearance();
    (urlAppearance['assets'] as Record<string, unknown>).logoLight = 'https://example.invalid/logo.png';
    const fontAppearance = copyValidAppearance();
    fontAppearance['headingFont'] = 'manrope';
    const colorAppearance = copyValidAppearance();
    copyColorOverrides(colorAppearance, 'light').dangerPressed = 'rgba(0,0,0,1)';

    expect(validateAppearanceV1(urlAppearance).valid).toBe(false);
    expect(validateAppearanceV1(fontAppearance).valid).toBe(false);
    const colorResult = validateAppearanceV1(colorAppearance);
    expect(colorResult.valid).toBe(false);
    expect(colorResult.errors).toContain('light.dangerPressed must be a six-digit hex color');
  });

  it('rejects invalid schema versions, unsafe display text, and payloads over 32 KiB', () => {
    const schemaAppearance = copyValidAppearance();
    schemaAppearance['schemaVersion'] = 2;
    const textAppearance = copyValidAppearance();
    textAppearance['displayName'] = '<script>alert(1)</script>';
    const oversizedAppearance = copyValidAppearance();
    oversizedAppearance['extra'] = 'x'.repeat(33_000);

    expect(validateAppearanceV1(schemaAppearance).valid).toBe(false);
    expect(validateAppearanceV1(textAppearance).valid).toBe(false);
    const oversizedResult = validateAppearanceV1(oversizedAppearance);
    expect(oversizedResult.valid).toBe(false);
    expect(oversizedResult.errors.join('\n')).toContain('32 KiB');
  });

  it('rejects malformed asset IDs, excess promotions, and out-of-range motion', () => {
    const badAsset = copyValidAppearance();
    (badAsset['assets'] as Record<string, unknown>).logoDark = 'not-an-asset-id';
    const tooManyPromotions = copyValidAppearance();
    (tooManyPromotions['assets'] as Record<string, unknown>).promotional = Array.from(
      { length: 7 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    );
    const invalidMotion = copyValidAppearance();
    (invalidMotion['motion'] as Record<string, unknown>).launchDurationMs = 1801;

    expect(validateAppearanceV1(badAsset).valid).toBe(false);
    expect(validateAppearanceV1(tooManyPromotions).valid).toBe(false);
    expect(validateAppearanceV1(invalidMotion).valid).toBe(false);
  });
});
