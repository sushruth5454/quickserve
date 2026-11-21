import { COLOR_OVERRIDE_KEYS, getContrastFailures } from './colorContract';
import { OORVA_BRANDING_CANDIDATE } from './defaults';
import type { BrandingV1, ThemeMode } from './types';

export const MAX_APPEARANCE_BYTES = 32 * 1024;
/** Manrope is schema-supported but cannot be selected until its bundled face exists. */
export const BUNDLED_HEADING_FONTS = ['inter'] as const;

export interface AppearanceValidationResult {
  valid: boolean;
  value?: BrandingV1;
  errors: string[];
}

const ROOT_KEYS = [
  'schemaVersion',
  'displayName',
  'tagline',
  'defaultTheme',
  'headingFont',
  'assets',
  'light',
  'dark',
  'motion',
];
const ASSET_KEYS = ['logoLight', 'logoDark', 'compactLight', 'compactDark', 'promotional'];
const MOTION_KEYS = ['launchDurationMs'];
const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];
const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const UNSAFE_TEXT_PATTERN = /[<>\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]|\b(?:https?|javascript|data):|www\./i;
const COLOR_OVERRIDE_KEY_SET = new Set<string>(COLOR_OVERRIDE_KEYS);

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function checkExactKeys(
  value: unknown,
  path: string,
  expectedKeys: readonly string[],
  errors: string[],
): value is Record<string, unknown> {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }

  for (const key of expectedKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      errors.push(`${path}.${key} is required`);
    }
  }
  for (const key of Object.keys(value)) {
    if (!expectedKeys.includes(key)) errors.push(`${path}.${key} is not allowed`);
  }
  return true;
}

function checkColorOverrides(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }

  for (const [key, color] of Object.entries(value)) {
    if (!COLOR_OVERRIDE_KEY_SET.has(key)) {
      errors.push(`${path}.${key} is not an allowed color token`);
      continue;
    }
    if (typeof color !== 'string' || !HEX_COLOR_PATTERN.test(color)) {
      errors.push(`${path}.${key} must be a six-digit hex color`);
    }
  }
}

function checkPlainText(
  value: unknown,
  path: string,
  minLength: number,
  maxLength: number,
  errors: string[],
): void {
  if (typeof value !== 'string') {
    errors.push(`${path} must be text`);
    return;
  }

  const length = Array.from(value).length;
  if (length < minLength || length > maxLength) {
    errors.push(`${path} must contain ${minLength}..${maxLength} characters`);
  }
  if (value !== value.trim() || UNSAFE_TEXT_PATTERN.test(value)) {
    errors.push(`${path} contains unsafe text`);
  }
}

function checkAssetId(value: unknown, path: string, errors: string[]): void {
  if (value !== null && (typeof value !== 'string' || !UUID_PATTERN.test(value))) {
    errors.push(`${path} must be null or an asset UUID`);
  }
}

function validateAssets(value: unknown, errors: string[]): void {
  if (!checkExactKeys(value, 'assets', ASSET_KEYS, errors)) return;
  for (const key of ASSET_KEYS.slice(0, 4)) checkAssetId(value[key], `assets.${key}`, errors);

  const promotional = value.promotional;
  if (!Array.isArray(promotional)) {
    errors.push('assets.promotional must be an array');
    return;
  }
  if (promotional.length > 6) errors.push('assets.promotional must contain at most 6 asset UUIDs');
  promotional.forEach((assetId, index) => checkAssetId(assetId, `assets.promotional[${index}]`, errors));
}

function validateMotion(value: unknown, errors: string[]): void {
  if (!checkExactKeys(value, 'motion', MOTION_KEYS, errors)) return;

  const duration = value.launchDurationMs;
  if (typeof duration !== 'number' || !Number.isInteger(duration) || duration < 0 || duration > 1800) {
    errors.push('motion.launchDurationMs must be an integer from 0 to 1800');
  }
}

function validateColors(value: unknown, mode: 'light' | 'dark', errors: string[]): void {
  checkColorOverrides(value, mode, errors);
  if (!isRecord(value)) return;

  const candidateColors = OORVA_BRANDING_CANDIDATE[mode] as Record<string, string>;
  const resolvedColors = { ...candidateColors, ...value };
  for (const failure of getContrastFailures(resolvedColors)) errors.push(`${mode}: ${failure}`);
}

export function validateAppearanceV1(input: unknown): AppearanceValidationResult {
  const errors: string[] = [];
  if (!isRecord(input)) return { valid: false, errors: ['appearance must be an object'] };

  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(input);
  } catch {
    return { valid: false, errors: ['appearance must be JSON serializable'] };
  }
  if (typeof serialized !== 'string') {
    return { valid: false, errors: ['appearance must be JSON serializable'] };
  }
  if (utf8ByteLength(serialized) > MAX_APPEARANCE_BYTES) {
    return { valid: false, errors: ['appearance exceeds the 32 KiB limit'] };
  }

  checkExactKeys(input, 'appearance', ROOT_KEYS, errors);
  validateAssets(input.assets, errors);
  validateColors(input.light, 'light', errors);
  validateColors(input.dark, 'dark', errors);
  validateMotion(input.motion, errors);

  if (input.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  checkPlainText(input.displayName, 'displayName', 2, 32, errors);
  checkPlainText(input.tagline, 'tagline', 0, 80, errors);
  if (typeof input.defaultTheme !== 'string' || !THEME_MODES.includes(input.defaultTheme as ThemeMode)) {
    errors.push('defaultTheme must be system, light, or dark');
  }
  if (input.headingFont !== 'manrope' && input.headingFont !== 'inter') {
    errors.push('headingFont must be manrope or inter');
  } else if (!(BUNDLED_HEADING_FONTS as readonly string[]).includes(input.headingFont)) {
    errors.push(`headingFont ${input.headingFont} is not bundled`);
  }

  try {
    const parsed = JSON.parse(serialized) as BrandingV1;
    if (errors.length > 0) return { valid: false, errors };
    return { valid: true, value: parsed, errors: [] };
  } catch {
    return { valid: false, errors: ['appearance must be valid JSON data'] };
  }
}
