import { validateAppearanceV1 } from '../../branding/validation';
import type { ColorOverrideKey } from '../../branding/colorContract';
import { OORVA_BRANDING_CANDIDATE } from '../../branding/defaults';
import type { BrandingV1 } from '../../branding/types';

export const BRANDING_EDIT_FLAGS = ['oorva_brand', 'branding_runtime', 'branding_editor'] as const;
export const BRANDING_ENTRY_PARENT_FLAGS = ['oorva_brand', 'branding_runtime'] as const;
export const PREVIEW_URL_TTL_MS = 4 * 60 * 1000;

export const EDITABLE_COLOR_KEYS = [
  'primary',
  'primaryPressed',
  'primarySoft',
  'primaryText',
  'onPrimary',
  'secondary',
  'accent',
  'onAccent',
  'text',
  'textSecondary',
  'muted',
  'bg',
  'surface',
  'surfaceAlt',
  'border',
  'borderStrong',
  'success',
  'successText',
  'warning',
  'warningText',
  'danger',
  'dangerText',
] as const satisfies readonly ColorOverrideKey[];

const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const GENERATION_PATTERN = /^\d+$/;

export interface BrandingDraft {
  config: BrandingV1;
  launchDurationMs: string;
}

export interface BrandingVersion {
  id: string;
  versionNumber: string;
  createdAt: string;
  published: boolean;
  current: boolean;
}

export interface BrandingSnapshot {
  generation: string;
  publishedVersionId: string | null;
  config: BrandingV1 | null;
  flags: Record<string, unknown>;
}

export interface SignedAssetPreview {
  assetId: string;
  url: string;
  expiresAt: string;
}

export interface DraftValidation {
  config: BrandingV1 | null;
  errors: string[];
}

function validateReadableConfig(value: unknown): BrandingV1 | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const compatible = raw.headingFont === 'manrope' ? { ...raw, headingFont: 'inter' } : value;
  const result = validateAppearanceV1(compatible);
  return result.valid ? result.value ?? null : null;
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function isBrandingSettingsVisible(flags: Record<string, unknown>): boolean {
  return BRANDING_ENTRY_PARENT_FLAGS.every((key) => flags[key] === true);
}

export function isBrandingEditorEnabled(flags: Record<string, unknown>): boolean {
  return BRANDING_EDIT_FLAGS.every((key) => flags[key] === true);
}

export function areDraftsEqual(left: BrandingDraft | null, right: BrandingDraft | null): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function cloneBrandingConfig(config: BrandingV1): BrandingV1 {
  return {
    ...config,
    assets: { ...config.assets, promotional: [...config.assets.promotional] },
    light: { ...config.light },
    dark: { ...config.dark },
    motion: { ...config.motion },
  };
}

export function draftFromConfig(config: BrandingV1): BrandingDraft {
  const normalized = cloneBrandingConfig(config);
  if (normalized.headingFont !== 'inter') normalized.headingFont = 'inter';
  return {
    config: normalized,
    launchDurationMs: String(normalized.motion.launchDurationMs),
  };
}

export function defaultBrandingDraft(): BrandingDraft {
  return draftFromConfig(OORVA_BRANDING_CANDIDATE);
}

export function cloneBrandingDraft(draft: BrandingDraft): BrandingDraft {
  return { config: cloneBrandingConfig(draft.config), launchDurationMs: draft.launchDurationMs };
}

export function validateBrandingDraft(draft: BrandingDraft): DraftValidation {
  const durationText = draft.launchDurationMs.trim();
  const durationIsValid = /^\d+$/.test(durationText);
  const candidate: BrandingV1 = {
    ...cloneBrandingConfig(draft.config),
    motion: {
      ...draft.config.motion,
      launchDurationMs: durationIsValid ? Number(durationText) : Number.NaN,
    },
  };
  const result = validateAppearanceV1(candidate);
  const errors = [...result.errors];
  if (!durationIsValid && !errors.some((error) => error.startsWith('motion.launchDurationMs'))) {
    errors.push('motion.launchDurationMs must be a whole number from 0 to 1800');
  }
  return { config: result.valid ? result.value ?? null : null, errors };
}

export function previewConfig(draft: BrandingDraft): BrandingV1 {
  const parsedDuration = /^\d+$/.test(draft.launchDurationMs.trim()) ? Number(draft.launchDurationMs) : 0;
  return {
    ...cloneBrandingConfig(draft.config),
    motion: { ...draft.config.motion, launchDurationMs: parsedDuration },
  };
}

export function brandingAssetIds(config: BrandingV1 | null): string[] {
  if (!config) return [];
  return [
    ...new Set(
      [
        config.assets.logoLight,
        config.assets.logoDark,
        config.assets.compactLight,
        config.assets.compactDark,
        ...config.assets.promotional,
      ]
        .filter((value): value is string => isUuid(value))
        .map((value) => value.toLowerCase()),
    ),
  ];
}

export function parseBrandingVersions(value: unknown): BrandingVersion[] {
  if (!Array.isArray(value)) throw new Error('Branding history response is invalid.');
  return value.map((row) => {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) {
      throw new Error('Branding history response is invalid.');
    }
    const item = row as Record<string, unknown>;
    const versionNumber = String(item.version_number ?? '');
    if (
      !isUuid(item.id) ||
      !GENERATION_PATTERN.test(versionNumber) ||
      typeof item.created_at !== 'string' ||
      typeof item.published !== 'boolean' ||
      typeof item.is_current !== 'boolean'
    ) {
      throw new Error('Branding history response is invalid.');
    }
    return {
      id: item.id,
      versionNumber,
      createdAt: item.created_at,
      published: item.published,
      current: item.is_current,
    };
  });
}

export function parseBrandingSnapshot(value: unknown): BrandingSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Branding status response is invalid.');
  }
  const item = value as Record<string, unknown>;
  const generation = String(item.generation ?? '');
  const flags = item.flags;
  if (
    !GENERATION_PATTERN.test(generation) ||
    (item.publishedVersionId !== null && !isUuid(item.publishedVersionId)) ||
    typeof flags !== 'object' ||
    flags === null ||
    Array.isArray(flags)
  ) {
    throw new Error('Branding status response is invalid.');
  }
  let config: BrandingV1 | null = null;
  if (item.config !== null) {
    config = validateReadableConfig(item.config);
    if (!config) throw new Error('Published branding configuration is invalid.');
  }
  return {
    generation,
    publishedVersionId: isUuid(item.publishedVersionId) ? item.publishedVersionId : null,
    config,
    flags: flags as Record<string, unknown>,
  };
}

export function parseBrandingVersionDetail(value: unknown): BrandingV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Branding version response is invalid.');
  }
  const config = validateReadableConfig((value as Record<string, unknown>).config);
  if (!config) throw new Error('Branding version configuration is invalid.');
  return config;
}

export function parseSignedAssetPreview(
  value: unknown,
  expectedAssetId: string,
  projectUrl: string,
  now = Date.now(),
): SignedAssetPreview | null {
  if (!isUuid(expectedAssetId) || typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const assetId = expectedAssetId.toLowerCase();
  const item = value as Record<string, unknown>;
  if (
    typeof item.assetId !== 'string' ||
    item.assetId.toLowerCase() !== assetId ||
    typeof item.url !== 'string' ||
    typeof item.expiresAt !== 'string'
  ) return null;

  let project: URL;
  let signed: URL;
  try {
    project = new URL(projectUrl);
    signed = new URL(item.url, project);
  } catch {
    return null;
  }
  const expectedPath = `/storage/v1/object/sign/branding-assets/branding/${assetId}.png`;
  const expiresAt = Date.parse(item.expiresAt);
  const remaining = expiresAt - now;
  if (
    signed.origin !== project.origin ||
    signed.username !== '' ||
    signed.password !== '' ||
    signed.pathname !== expectedPath ||
    signed.searchParams.get('token') === null ||
    [...signed.searchParams.keys()].some((key) => key !== 'token') ||
    !Number.isFinite(expiresAt) ||
    remaining <= 1_000 ||
    remaining > PREVIEW_URL_TTL_MS + 5_000
  ) return null;
  return { assetId, url: signed.toString(), expiresAt: item.expiresAt };
}

export function isPreviewUrlFresh(preview: SignedAssetPreview | null, now = Date.now()): boolean {
  return preview !== null && Date.parse(preview.expiresAt) - now > 1_000;
}
