#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { exportSvg, renderSvg, solidBackgroundSvg } from './export.mjs';
import { inspectAssetPng, validatePng } from './validate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const brandAssets = path.join(repoRoot, 'app', 'assets', 'brand');
const expectedFiles = [
  ...['light', 'dark'].flatMap((theme) => [
    { path: `app/assets/brand/logo-horizontal-${theme}.png`, width: 360, height: 100, density: 1, alpha: 'transparent', safeRule: 'quarter-symbol-clear-space' },
    { path: `app/assets/brand/logo-horizontal-${theme}@2x.png`, width: 720, height: 200, density: 2, alpha: 'transparent', safeRule: 'quarter-symbol-clear-space' },
    { path: `app/assets/brand/logo-horizontal-${theme}@3x.png`, width: 1080, height: 300, density: 3, alpha: 'transparent', safeRule: 'quarter-symbol-clear-space' },
  ]),
  ...['light', 'dark'].flatMap((theme) => [
    { path: `app/assets/brand/oorva-wordmark-${theme}.png`, width: 256, height: 64, density: 1, alpha: 'transparent', safeRule: 'quarter-symbol-clear-space' },
    { path: `app/assets/brand/oorva-wordmark-${theme}@2x.png`, width: 512, height: 128, density: 2, alpha: 'transparent', safeRule: 'quarter-symbol-clear-space' },
    { path: `app/assets/brand/oorva-wordmark-${theme}@3x.png`, width: 768, height: 192, density: 3, alpha: 'transparent', safeRule: 'quarter-symbol-clear-space' },
  ]),
  ...['light', 'dark'].flatMap((theme) => [
    { path: `app/assets/brand/logo-compact-${theme}.png`, width: 32, height: 32, density: 1, alpha: 'transparent', safeRule: 'central-208-square' },
    { path: `app/assets/brand/logo-compact-${theme}@2x.png`, width: 64, height: 64, density: 2, alpha: 'transparent', safeRule: 'central-208-square' },
    { path: `app/assets/brand/logo-compact-${theme}@3x.png`, width: 96, height: 96, density: 3, alpha: 'transparent', safeRule: 'central-208-square' },
  ]),
  { path: 'app/assets/brand/native/icon.png', width: 1024, height: 1024, density: 'native', alpha: 'opaque', safeRule: 'opaque-square-no-rounded-corners' },
  { path: 'app/assets/brand/native/android-icon-foreground.png', width: 1024, height: 1024, density: 'native', alpha: 'transparent', safeRule: 'centered-circle-624' },
  { path: 'app/assets/brand/native/android-icon-background.png', width: 1024, height: 1024, density: 'native', alpha: 'opaque', safeRule: 'flat-opaque-background' },
  { path: 'app/assets/brand/native/android-icon-monochrome.png', width: 1024, height: 1024, density: 'native', alpha: 'transparent', safeRule: 'centered-circle-624' },
  { path: 'app/assets/brand/native/splash-icon.png', width: 1024, height: 1024, density: 'native', alpha: 'transparent', safeRule: 'ink-within-624-square' },
  { path: 'app/assets/brand/native/splash-icon-dark.png', width: 1024, height: 1024, density: 'native', alpha: 'transparent', safeRule: 'ink-within-624-square' },
  { path: 'app/assets/brand/native/notification-icon.png', width: 96, height: 96, density: 'native', alpha: 'transparent', safeRule: 'white-on-transparent' },
  { path: 'app/assets/brand/native/favicon.png', width: 48, height: 48, density: 'native', alpha: 'transparent', safeRule: 'quarter-symbol-clear-space' },
];
const approvedSvgSources = new Set([
  'app/assets/brand/oorva-symbol.svg',
  'app/assets/brand/oorva-wordmark-light.svg',
  'app/assets/brand/oorva-wordmark-dark.svg',
  'app/assets/brand/logo-horizontal-light.svg',
  'app/assets/brand/logo-horizontal-dark.svg',
  'app/assets/brand/logo-stacked-light.svg',
  'app/assets/brand/logo-stacked-dark.svg',
  'app/assets/brand/logo-horizontal-mono-black.svg',
  'app/assets/brand/logo-horizontal-mono-ivory.svg',
]);
const approvedSvgViewBoxes = new Map([
  ['app/assets/brand/oorva-symbol.svg', [0, 0, 256, 256]],
  ['app/assets/brand/oorva-wordmark-light.svg', [0, 0, 1024, 256]],
  ['app/assets/brand/oorva-wordmark-dark.svg', [0, 0, 1024, 256]],
  ['app/assets/brand/logo-horizontal-light.svg', [0, 0, 1440, 400]],
  ['app/assets/brand/logo-horizontal-dark.svg', [0, 0, 1440, 400]],
  ['app/assets/brand/logo-stacked-light.svg', [0, 0, 720, 720]],
  ['app/assets/brand/logo-stacked-dark.svg', [0, 0, 720, 720]],
  ['app/assets/brand/logo-horizontal-mono-black.svg', [0, 0, 1440, 400]],
  ['app/assets/brand/logo-horizontal-mono-ivory.svg', [0, 0, 1440, 400]],
]);

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const PROFILE_KINDS = new Set(['sRGB', 'iCCP']);

function expectedRole(filePath) {
  if (filePath.includes('/logo-horizontal-')) return 'horizontal-lockup';
  if (filePath.includes('/oorva-wordmark-')) return 'wordmark';
  if (filePath.includes('/logo-compact-')) return 'compact-symbol';
  if (filePath.endsWith('/native/icon.png')) return 'ios-app-icon';
  if (filePath.endsWith('/native/android-icon-foreground.png')) return 'android-adaptive-foreground';
  if (filePath.endsWith('/native/android-icon-background.png')) return 'android-adaptive-background';
  if (filePath.endsWith('/native/android-icon-monochrome.png')) return 'android-monochrome';
  if (filePath.endsWith('/native/splash-icon.png')) return 'splash-icon-light';
  if (filePath.endsWith('/native/splash-icon-dark.png')) return 'splash-icon-dark';
  if (filePath.endsWith('/native/notification-icon.png')) return 'notification-small-icon';
  if (filePath.endsWith('/native/favicon.png')) return 'favicon';
  return 'unknown';
}

function expectedSourceKind(filePath) {
  return filePath.endsWith('/native/android-icon-background.png') ? 'solid-background' : 'svg';
}

function expectedSourcePath(filePath) {
  const horizontal = filePath.match(/logo-horizontal-(light|dark)(?:@(?:2|3)x)?\.png$/);
  if (horizontal) return `app/assets/brand/logo-horizontal-${horizontal[1]}.svg`;
  const wordmark = filePath.match(/oorva-wordmark-(light|dark)(?:@(?:2|3)x)?\.png$/);
  if (wordmark) return `app/assets/brand/oorva-wordmark-${wordmark[1]}.svg`;
  if (filePath.includes('/logo-compact-') || filePath.includes('/native/')) return 'app/assets/brand/oorva-symbol.svg';
  return null;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function expectValue(errors, label, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(`${label}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  }
}

function expect(errors, label, condition, actual, expected) {
  if (!condition) errors.push(`${label}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

function resolveBrandPath(relativePath, label) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new Error(`${label}: actual=${JSON.stringify(relativePath)} expected=non-empty app/assets/brand-relative path`);
  }
  const normalized = relativePath.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized) || normalized.split('/').includes('..')) {
    throw new Error(`${label}: actual=${JSON.stringify(relativePath)} expected=relative path without traversal`);
  }
  const resolved = path.resolve(repoRoot, ...normalized.split('/'));
  const relativeToBrand = path.relative(brandAssets, resolved);
  if (relativeToBrand === '' || relativeToBrand.startsWith(`..${path.sep}`) || relativeToBrand === '..' || path.isAbsolute(relativeToBrand)) {
    throw new Error(`${label}: actual=${JSON.stringify(relativePath)} resolved=${JSON.stringify(resolved)} expected=file below app/assets/brand`);
  }
  return resolved;
}

async function readRegularFile(filePath, label) {
  const stat = await lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label}: actual=${JSON.stringify({ isFile: stat.isFile(), isSymbolicLink: stat.isSymbolicLink() })} expected=regular non-symlink file`);
  }
  return readFile(filePath);
}

function asHex(rgb) {
  return `#${rgb.slice(0, 3).map((value) => value.toString(16).padStart(2, '0')).join('')}`.toLowerCase();
}

function countOutsideCentral208(rgba, width, height) {
  const insetX = width * (24 / 256);
  const insetY = height * (24 / 256);
  let visiblePixels = 0;
  let outsidePixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (rgba[(y * width + x) * 4 + 3] === 0) continue;
      visiblePixels += 1;
      if (x + 0.5 < insetX || x + 0.5 > width - insetX ||
        y + 0.5 < insetY || y + 0.5 > height - insetY) outsidePixels += 1;
    }
  }
  return { visiblePixels, outsidePixels, insetX, insetY };
}

function countOutsideCenteredCircle(rgba, width, height, diameter) {
  const radius = diameter / 2;
  const centerX = width / 2;
  const centerY = height / 2;
  let visiblePixels = 0;
  let outsidePixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (rgba[(y * width + x) * 4 + 3] === 0) continue;
      visiblePixels += 1;
      const dx = x + 0.5 - centerX;
      const dy = y + 0.5 - centerY;
      if (dx * dx + dy * dy > radius * radius) outsidePixels += 1;
    }
  }
  return { visiblePixels, outsidePixels, diameter, radius };
}

function alphaBounds(rgba, width, height) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  let visiblePixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (rgba[(y * width + x) * 4 + 3] === 0) continue;
      visiblePixels += 1;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return {
    visiblePixels,
    bounds: right < 0 ? null : { left, top, right, bottom },
  };
}

function validateSafeZone(definition, entry, png, errors) {
  const safeZone = entry.safeZone;
  expectValue(errors, `${definition.path} safeZone.rule`, safeZone?.rule, definition.safeRule);
  if (!png.alpha.bounds) {
    errors.push(`${definition.path} safe zone: actual=${JSON.stringify(png.alpha)} expected=non-empty visible ink`);
    return { rule: definition.safeRule, verified: false };
  }

  if (definition.safeRule === 'quarter-symbol-clear-space') {
    const diameter = safeZone?.symbolDiameterPx;
    const validDiameter = Number.isSafeInteger(diameter) && diameter > 0 && diameter <= Math.min(png.width, png.height);
    expect(errors, `${definition.path} safeZone.symbolDiameterPx`, validDiameter, diameter, `positive integer <= ${Math.min(png.width, png.height)}`);
    if (!validDiameter) return { rule: definition.safeRule, verified: false };
    const minimum = Math.ceil(diameter / 4);
    const bounds = png.alpha.bounds;
    const clearSpace = {
      left: bounds.left,
      top: bounds.top,
      right: png.width - 1 - bounds.right,
      bottom: png.height - 1 - bounds.bottom,
    };
    expect(errors, `${definition.path} clear-space`, Object.values(clearSpace).every((value) => value >= minimum), clearSpace, `each side >= ${minimum}px (one quarter of ${diameter}px symbol diameter)`);
    return { rule: definition.safeRule, symbolDiameterPx: diameter, minimumPx: minimum, measuredPx: clearSpace };
  }

  if (definition.safeRule === 'central-208-square') {
    const measured = countOutsideCentral208(png.rgba, png.width, png.height);
    expect(errors, `${definition.path} central-208 safe zone`, measured.visiblePixels > 0 && measured.outsidePixels === 0, measured, 'visiblePixels > 0 and outsidePixels = 0');
    return { rule: definition.safeRule, ...measured };
  }

  if (definition.safeRule === 'centered-circle-624') {
    const measured = countOutsideCenteredCircle(png.rgba, png.width, png.height, 624);
    expect(errors, `${definition.path} centered 624px circle`, measured.visiblePixels > 0 && measured.outsidePixels === 0, measured, 'visiblePixels > 0 and outsidePixels = 0');
    return { rule: definition.safeRule, ...measured };
  }

  if (definition.safeRule === 'ink-within-624-square') {
    const bounds = png.alpha.bounds;
    const inkSize = { width: bounds.right - bounds.left + 1, height: bounds.bottom - bounds.top + 1 };
    expect(errors, `${definition.path} 624px ink bound`, inkSize.width <= 624 && inkSize.height <= 624, inkSize, 'width <= 624 and height <= 624');
    return { rule: definition.safeRule, inkSize, bounds };
  }

  if (definition.safeRule === 'white-on-transparent') {
    let nonWhitePixels = 0;
    for (let offset = 0; offset < png.rgba.length; offset += 4) {
      if (png.rgba[offset + 3] > 0 &&
        (png.rgba[offset] !== 255 || png.rgba[offset + 1] !== 255 || png.rgba[offset + 2] !== 255)) {
        nonWhitePixels += 1;
      }
    }
    expect(errors, `${definition.path} white-only foreground`, nonWhitePixels === 0, { nonWhitePixels }, '0 non-white visible pixels');
    return { rule: definition.safeRule, nonWhitePixels, visiblePixels: png.alpha.opaquePixels + png.alpha.partialAlphaPixels };
  }

  if (definition.safeRule === 'opaque-square-no-rounded-corners') {
    const expectedColor = safeZone?.backgroundColor;
    const validColor = typeof expectedColor === 'string' && /^#[a-fA-F0-9]{6}$/.test(expectedColor);
    expect(errors, `${definition.path} safeZone.backgroundColor`, validColor, expectedColor, '#RRGGBB background color');
    if (!validColor) return { rule: definition.safeRule, verified: false };
    const target = expectedColor.toLowerCase();
    let borderMismatch = 0;
    for (let x = 0; x < png.width; x += 1) {
      for (const y of [0, png.height - 1]) {
        if (asHex(png.rgba.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4)) !== target) borderMismatch += 1;
      }
    }
    for (let y = 1; y < png.height - 1; y += 1) {
      for (const x of [0, png.width - 1]) {
        if (asHex(png.rgba.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4)) !== target) borderMismatch += 1;
      }
    }
    expect(errors, `${definition.path} full-bleed square border`, borderMismatch === 0, { borderMismatch, expectedColor: target }, '0 border pixels differ from backgroundColor');
    return { rule: definition.safeRule, borderMismatch, backgroundColor: target };
  }

  if (definition.safeRule === 'flat-opaque-background') {
    const expectedColor = safeZone?.backgroundColor;
    const validColor = typeof expectedColor === 'string' && /^#[a-fA-F0-9]{6}$/.test(expectedColor);
    expect(errors, `${definition.path} safeZone.backgroundColor`, validColor, expectedColor, '#RRGGBB background color');
    const actualColor = png.firstPixel ? asHex(png.firstPixel) : null;
    expect(errors, `${definition.path} flat background`, validColor && png.uniformColor && actualColor === expectedColor?.toLowerCase(), {
      uniformColor: png.uniformColor,
      actualColor,
    }, { uniformColor: true, color: expectedColor?.toLowerCase() });
    return { rule: definition.safeRule, uniformColor: png.uniformColor, color: actualColor };
  }

  errors.push(`${definition.path} safe-zone rule is unsupported: actual=${JSON.stringify(definition.safeRule)} expected=implemented A.4.1 rule`);
  return { rule: definition.safeRule, verified: false };
}

function validateProfile(entry, png, errors, label) {
  const declared = entry.colorProfile;
  if (!declared || !PROFILE_KINDS.has(declared.kind)) {
    errors.push(`${label} colorProfile: actual=${JSON.stringify(declared)} expected=sRGB or validated iCCP evidence`);
    return;
  }
  if (png.profile.kind === 'NOT VERIFIED') {
    errors.push(`${label} colorProfile NOT VERIFIED: actual=${JSON.stringify(png.profile)} expected=embedded sRGB or iCCP chunk`);
    return;
  }
  if (declared.kind !== png.profile.kind) {
    errors.push(`${label} colorProfile kind: actual=${JSON.stringify(png.profile.kind)} expected=${JSON.stringify(declared.kind)}`);
    return;
  }
  if (png.profile.kind === 'sRGB') {
    expectValue(errors, `${label} colorProfile.renderingIntent`, declared.renderingIntent, png.profile.renderingIntent);
  } else {
    expectValue(errors, `${label} colorProfile.name`, declared.name, png.profile.name);
    expectValue(errors, `${label} colorProfile.sha256`, declared.sha256, png.profile.sha256);
  }
}

async function runOorvaCheck() {
  const errors = [];
  const manifestPath = path.join(brandAssets, 'manifest.json');
  let manifestBytes;
  try {
    manifestBytes = await readRegularFile(manifestPath, 'O01X manifest');
  } catch (error) {
    throw new Error(`O01X manifest missing or unreadable: path=${JSON.stringify(manifestPath)} actual=${JSON.stringify(error.message)} expected=non-empty app/assets/brand/manifest.json`);
  }
  if (manifestBytes.length === 0) {
    throw new Error(`O01X manifest is empty: path=${JSON.stringify(manifestPath)} actualBytes=0 expectedBytes>0`);
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch (error) {
    throw new Error(`O01X manifest JSON invalid: actual=${JSON.stringify(error.message)} expected=valid JSON object`);
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`O01X manifest root invalid: actual=${JSON.stringify(manifest)} expected=JSON object`);
  }

  expectValue(errors, 'manifest.schemaVersion', manifest.schemaVersion, 1);
  expectValue(errors, 'manifest.stageId', manifest.stageId, 'O01X');
  expectValue(errors, 'manifest.status', manifest.status, 'candidate');
  expectValue(errors, 'manifest.selected', manifest.selected, false);
  expectValue(errors, 'manifest.publiclyCleared', manifest.publiclyCleared, false);
  expectValue(errors, 'manifest.approvals.designSelection', manifest.approvals?.designSelection, 'pending');
  expectValue(errors, 'manifest.approvals.publicRights', manifest.approvals?.publicRights, 'pending');
  expect(errors, 'manifest.files', Array.isArray(manifest.files) && manifest.files.length === expectedFiles.length, {
    isArray: Array.isArray(manifest.files),
    actualCount: Array.isArray(manifest.files) ? manifest.files.length : null,
  }, `exactly ${expectedFiles.length} allowlisted files`);

  const entries = Array.isArray(manifest.files) ? manifest.files : [];
  const expectedPaths = new Set(expectedFiles.map((file) => file.path));
  const seenPaths = new Set();
  for (const entry of entries) {
    const exportPath = entry?.export?.path;
    const entryPath = typeof exportPath === 'string' ? exportPath.replaceAll('\\', '/') : null;
    if (!entryPath || !expectedPaths.has(entryPath)) {
      errors.push(`manifest export path is not allowlisted: actual=${JSON.stringify(exportPath)} expected=${JSON.stringify([...expectedPaths])}`);
    } else if (seenPaths.has(entryPath)) {
      errors.push(`manifest file path is duplicated: actual=${JSON.stringify(entryPath)} expected=one entry`);
    } else {
      seenPaths.add(entryPath);
    }
  }
  for (const expectedPath of expectedPaths) {
    if (!seenPaths.has(expectedPath)) errors.push(`manifest file is missing: actual=${JSON.stringify([...seenPaths])} expectedIncludes=${JSON.stringify(expectedPath)}`);
  }

  const toolchain = manifest.toolchain;
  let packageData;
  let lockData;
  let exporterData;
  try {
    [packageData, lockData, exporterData] = await Promise.all([
      readFile(path.join(here, 'package.json'), 'utf8').then(JSON.parse),
      readRegularFile(path.join(here, 'package-lock.json'), 'brand package lock'),
      readRegularFile(path.join(here, 'export.mjs'), 'brand exporter'),
    ]);
  } catch (error) {
    throw new Error(`O37A pinned toolchain cannot be inspected: actual=${JSON.stringify(error.message)} expected=package.json, package-lock.json and export.mjs available`);
  }
  const lockJson = JSON.parse(lockData.toString('utf8'));
  const rendererVersion = packageData.dependencies?.['@resvg/resvg-js'];
  const lockedRendererVersion = lockJson.packages?.['node_modules/@resvg/resvg-js']?.version;
  const actualToolchain = {
    nodeMajor: Number(process.versions.node.split('.')[0]),
    renderer: '@resvg/resvg-js',
    rendererVersion,
    lockedRendererVersion,
    loadSystemFonts: false,
    exporterSha256: sha256(exporterData),
    packageLockSha256: sha256(lockData),
  };
  expectValue(errors, 'manifest.toolchain.nodeMajor', toolchain?.nodeMajor, 22);
  expectValue(errors, 'runtime.nodeMajor', actualToolchain.nodeMajor, 22);
  expectValue(errors, 'manifest.toolchain.renderer', toolchain?.renderer, actualToolchain.renderer);
  expectValue(errors, 'manifest.toolchain.rendererVersion', toolchain?.rendererVersion, rendererVersion);
  expectValue(errors, 'lockfile renderer version', lockedRendererVersion, rendererVersion);
  expectValue(errors, 'manifest.toolchain.loadSystemFonts', toolchain?.loadSystemFonts, false);
  expectValue(errors, 'manifest.toolchain.exporterSha256', toolchain?.exporterSha256, actualToolchain.exporterSha256);
  expectValue(errors, 'manifest.toolchain.packageLockSha256', toolchain?.packageLockSha256, actualToolchain.packageLockSha256);

  const summaries = [];
  const compact = new Map();
  const entryByPath = new Map(entries.filter((entry) => typeof entry?.export?.path === 'string')
    .map((entry) => [entry.export.path.replaceAll('\\', '/'), entry]));

  for (const definition of expectedFiles) {
    const label = definition.path;
    const entry = entryByPath.get(label);
    if (!entry) continue;
    expectValue(errors, `${label} role`, entry.export?.role, expectedRole(label));
    expectValue(errors, `${label} canvas.width`, entry.export?.canvas?.width, definition.width);
    expectValue(errors, `${label} canvas.height`, entry.export?.canvas?.height, definition.height);
    expectValue(errors, `${label} density`, entry.export?.density, definition.density);
    const transform = entry.export?.transform;
    const expectedMode = expectedSourceKind(label) === 'solid-background' ? 'solid-background' : 'svg';
    expectValue(errors, `${label} transform.mode`, transform?.mode, expectedMode);
    expectValue(errors, `${label} transform.canvas.width`, transform?.canvas?.width, definition.width);
    expectValue(errors, `${label} transform.canvas.height`, transform?.canvas?.height, definition.height);
    expectValue(errors, `${label} transform.density`, transform?.density, definition.density);
    const expectedBackground = ['app/assets/brand/native/icon.png', 'app/assets/brand/native/android-icon-background.png'].includes(label)
      ? '#173d39'
      : undefined;
    const actualBackground = typeof transform?.background === 'string' ? transform.background.toLowerCase() : transform?.background;
    expectValue(errors, `${label} transform.background`, actualBackground, expectedBackground);
    const symbolSafeAreaPaths = [
      'app/assets/brand/native/android-icon-foreground.png',
      'app/assets/brand/native/android-icon-monochrome.png',
      'app/assets/brand/native/splash-icon.png',
      'app/assets/brand/native/splash-icon-dark.png',
    ];
    const expectedSafeArea = label === 'app/assets/brand/native/favicon.png'
      ? 'favicon-10'
      : symbolSafeAreaPaths.includes(label) ? 'symbol-624' : undefined;
    expectValue(errors, `${label} transform.safeArea`, transform?.safeArea, expectedSafeArea);
    expectValue(errors, `${label} alpha mode`, entry.alpha, definition.alpha);
    expect(errors, `${label} export sha256 format`, typeof entry.export?.sha256 === 'string' && HASH_PATTERN.test(entry.export.sha256), entry.export?.sha256, '64 lowercase hexadecimal characters');
    expect(errors, `${label} source sha256 format`, typeof entry.source?.sha256 === 'string' && HASH_PATTERN.test(entry.source.sha256), entry.source?.sha256, '64 lowercase hexadecimal characters');
    expectValue(errors, `${label} source.kind`, entry.source?.kind, expectedSourceKind(label));
    expectValue(errors, `${label} approval.designSelection`, entry.approval?.designSelection, 'pending');
    expectValue(errors, `${label} approval.publicRights`, entry.approval?.publicRights, 'pending');
    expectValue(errors, `${label} selected`, entry.selected, false);
    expectValue(errors, `${label} publiclyCleared`, entry.publiclyCleared, false);
    expectValue(errors, `${label} license.status`, entry.license?.status, 'pending');
    expect(errors, `${label} license.reference`, typeof entry.license?.reference === 'string' &&
      entry.license.reference.trim().length > 0 && !/^<.*>$/.test(entry.license.reference.trim()), entry.license?.reference, 'non-empty provenance/license reference; clearance remains pending');

    let sourcePath = null;
    let sourceRelativePath = null;
    let sourceBytes;
    let sourceText;
    let outputBytes;
    try {
      if (expectedSourceKind(label) === 'solid-background') {
        expectValue(errors, `${label} source.color`, entry.source?.color?.toLowerCase(), '#173d39');
        sourceText = solidBackgroundSvg(entry.export.canvas, entry.source?.color);
        sourceBytes = Buffer.from(sourceText, 'utf8');
      } else {
        sourceRelativePath = typeof entry.source?.path === 'string' ? entry.source.path.replaceAll('\\', '/') : null;
        const expectedSource = expectedSourcePath(label);
        expectValue(errors, `${label} source.path`, sourceRelativePath, expectedSource);
        expect(errors, `${label} source allowlist`, Boolean(sourceRelativePath && approvedSvgSources.has(sourceRelativePath)), sourceRelativePath, [...approvedSvgSources]);
        sourcePath = resolveBrandPath(sourceRelativePath, `${label} source`);
        if (!sourcePath.toLowerCase().endsWith('.svg')) {
          throw new Error(`${label} source extension: actual=${JSON.stringify(entry.source?.path)} expected=.svg`);
        }
        sourceBytes = await readRegularFile(sourcePath, `${label} source`);
        sourceText = sourceBytes.toString('utf8');
      }
      outputBytes = await readRegularFile(path.join(repoRoot, ...label.split('/')), label);
    } catch (error) {
      errors.push(`${label} source/export files: actual=${JSON.stringify(error.message)} expected=approved regular SVG source or deterministic solid-background recipe, plus PNG below app/assets/brand`);
      continue;
    }

    const sourceHash = sha256(sourceBytes);
    const outputHash = sha256(outputBytes);
    expectValue(errors, `${label} source.sha256`, entry.source?.sha256, sourceHash);
    expectValue(errors, `${label} export.sha256`, entry.export?.sha256, outputHash);
    if (expectedSourceKind(label) === 'svg') {
      const hrefValues = [...sourceText.matchAll(/(?:xlink:)?href\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]);
      const cssUrlValues = [...sourceText.matchAll(/url\(\s*["']?([^)"']+)["']?\s*\)/gi)].map((match) => match[1].trim());
      const sourceSafety = {
        hasSvgRoot: /<svg\b/i.test(sourceText),
        usesTextOrFonts: /<(?:text|textPath|font)\b|font-family\s*=|@font-face/i.test(sourceText),
        usesEmbeddedOrRasterImage: /<(?:image|feImage|script|foreignObject)\b/i.test(sourceText),
        usesExternalXmlOrCss: /<!DOCTYPE\b|<!ENTITY\b|@import\b/i.test(sourceText),
        externalReferences: [
          ...hrefValues.filter((value) => !value.startsWith('#')),
          ...cssUrlValues.filter((value) => !value.startsWith('#')),
        ],
      };
      const viewBoxMatch = sourceText.match(/\bviewBox\s*=\s*(["'])([^"']+)\1/i);
      const actualViewBox = viewBoxMatch ? viewBoxMatch[2].trim().split(/[,\s]+/).map(Number) : null;
      expectValue(errors, `${label} source viewBox`, actualViewBox, approvedSvgViewBoxes.get(sourceRelativePath));
      expect(errors, `${label} source SVG safety`, sourceSafety.hasSvgRoot && !sourceSafety.usesTextOrFonts &&
        !sourceSafety.usesEmbeddedOrRasterImage && !sourceSafety.usesExternalXmlOrCss &&
        sourceSafety.externalReferences.length === 0, sourceSafety, {
        hasSvgRoot: true,
        usesTextOrFonts: false,
        usesEmbeddedOrRasterImage: false,
        usesExternalXmlOrCss: false,
        externalReferences: [],
      });
    }

    let png;
    try {
      png = inspectAssetPng(outputBytes);
    } catch (error) {
      errors.push(`${label} PNG inspection: actual=${JSON.stringify(error.message)} expected=valid 8-bit RGB/RGBA PNG`);
      continue;
    }
    expectValue(errors, `${label} dimensions`, { width: png.width, height: png.height }, { width: definition.width, height: definition.height });
    if (definition.alpha === 'transparent') {
      expect(errors, `${label} transparent alpha evidence`, png.colorType === 6 && png.alpha.transparentPixels > 0 &&
        (png.alpha.opaquePixels + png.alpha.partialAlphaPixels) > 0, {
        colorType: png.colorType,
        ...png.alpha,
      }, 'RGBA colorType=6 with transparent and visible pixels');
    } else {
      expect(errors, `${label} opaque alpha evidence`, png.alpha.transparentPixels === 0 && png.alpha.partialAlphaPixels === 0 &&
        png.alpha.opaquePixels === png.width * png.height, {
        colorType: png.colorType,
        ...png.alpha,
      }, 'all pixels alpha=255');
    }
    validateProfile(entry, png, errors, label);
    const safeZone = validateSafeZone(definition, entry, png, errors);

    let deterministic = false;
    try {
      const regenerated = renderSvg(expectedSourceKind(label) === 'solid-background' ? null : sourceText, transform);
      deterministic = regenerated.equals(outputBytes);
      expect(errors, `${label} deterministic source/export`, deterministic, {
        source: entry.source?.path ?? { kind: entry.source?.kind, color: entry.source?.color },
        transform,
        sourceSha256: sourceHash,
        renderedSha256: sha256(regenerated),
        exportedSha256: outputHash,
        renderedBytes: regenerated.length,
        exportedBytes: outputBytes.length,
      }, 'pinned Resvg regeneration from declared source+transform byte-for-byte equals PNG');
    } catch (error) {
      errors.push(`${label} deterministic render: actual=${JSON.stringify(error.message)} expected=successful pinned @resvg render`);
    }

    const summary = {
      export: label,
      role: expectedRole(label),
      source: entry.source?.path ?? { kind: entry.source?.kind, color: entry.source?.color },
      sourceSha256: sourceHash,
      sha256: outputHash,
      width: png.width,
      height: png.height,
      density: definition.density,
      alpha: { mode: definition.alpha, colorType: png.colorType, ...png.alpha },
      colorProfile: png.profile,
      deterministic,
      safeZone,
      licenseClearance: 'NOT VERIFIED; D03c remains pending',
      approval: { designSelection: 'pending', publicRights: 'pending' },
    };
    summaries.push(summary);
    if (label.includes('logo-compact-')) compact.set(label, { png, sourcePath: entry.source.path, sourceText, transform });
  }

  const inspections = [];
  for (const theme of ['light', 'dark']) {
    const basePath = `app/assets/brand/logo-compact-${theme}.png`;
    const triplePath = `app/assets/brand/logo-compact-${theme}@3x.png`;
    const base = compact.get(basePath);
    const triple = compact.get(triplePath);
    if (!base || !triple) {
      errors.push(`compact ${theme} size inspection NOT VERIFIED: actual=${JSON.stringify({ base: Boolean(base), triple: Boolean(triple) })} expected=1x 32px and 3x 96px exports`);
      continue;
    }
    for (const size of [20, 32, 48]) {
      let rendered;
      try {
        rendered = renderSvg(base.sourceText, {
          ...base.transform,
          canvas: { width: size, height: size },
          density: 1,
        });
      } catch (error) {
        errors.push(`compact ${theme} ${size}px source render NOT VERIFIED: actual=${JSON.stringify(error.message)} expected=pinned O37A transform render`);
        continue;
      }
      let inspectionPng;
      try {
        inspectionPng = inspectAssetPng(rendered);
      } catch (error) {
        errors.push(`compact ${theme} ${size}px render inspection: actual=${JSON.stringify(error.message)} expected=valid RGBA PNG`);
        continue;
      }
      expectValue(errors, `compact ${theme} ${size}px canvas`, { width: inspectionPng.width, height: inspectionPng.height }, { width: size, height: size });
      const metrics = alphaBounds(inspectionPng.rgba, inspectionPng.width, inspectionPng.height);
      const safe = countOutsideCentral208(inspectionPng.rgba, inspectionPng.width, inspectionPng.height);
      expect(errors, `compact ${theme} ${size}px inspection`, metrics.visiblePixels > 0 && safe.outsidePixels === 0, {
        visiblePixels: metrics.visiblePixels,
        bounds: metrics.bounds,
        outsideSafeZonePixels: safe.outsidePixels,
        inset: { x: safe.insetX, y: safe.insetY },
      }, 'visible ink > 0 and no ink outside central 208-square safe zone');
      inspections.push({
        theme,
        logicalPx: size,
        source: base.sourcePath,
        visiblePixels: metrics.visiblePixels,
        bounds: metrics.bounds,
        outsideSafeZonePixels: safe.outsidePixels,
        method: 'pinned-resvg-direct-vector-render',
      });
    }
  }

  if (errors.length > 0) {
    throw new Error(`O01X asset check failed with ${errors.length} finding(s):\n- ${errors.join('\n- ')}`);
  }
  return {
    stageId: 'O01X',
    status: 'PASS_CANDIDATE_ONLY',
    manifest: 'app/assets/brand/manifest.json',
    state: { selected: false, publiclyCleared: false, designSelection: 'pending', publicRights: 'pending' },
    toolchain: actualToolchain,
    fileCount: summaries.length,
    files: summaries,
    inspections20_32_48: inspections,
    visualDesignApproval: 'NOT VERIFIED by this machine check; D03b/D03c remain separate gates',
  };
}

function runTransformSelftests() {
  const svg = (width, height, contents) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${contents}</svg>`;
  const transformCases = [
    {
      name: 'horizontal-density-1',
      source: svg(1440, 400, '<rect width="1440" height="400" fill="#173D39"/>'),
      transform: { mode: 'svg', canvas: { width: 360, height: 100 }, density: 1 },
      canvas: { width: 360, height: 100 },
    },
    {
      name: 'wordmark-density-1',
      source: svg(1024, 256, '<rect width="1024" height="256" fill="#173D39"/>'),
      transform: { mode: 'svg', canvas: { width: 256, height: 64 }, density: 1 },
      canvas: { width: 256, height: 64 },
    },
    ...[32, 64, 96].map((size) => ({
      name: `symbol-${size}`,
      source: svg(256, 256, '<circle cx="128" cy="128" r="104" fill="#173D39"/>'),
      transform: { mode: 'svg', canvas: { width: size, height: size }, density: size / 32 },
      canvas: { width: size, height: size },
    })),
  ];

  for (const testCase of transformCases) {
    const first = renderSvg(testCase.source, testCase.transform);
    const second = renderSvg(testCase.source, testCase.transform);
    assert.deepEqual(first, second, `${testCase.name} deterministic bytes actual=${sha256(first)} expected=${sha256(second)}`);
    const actual = validatePng(first);
    assert.deepEqual(
      { width: actual.width, height: actual.height },
      testCase.canvas,
      `${testCase.name} fitted canvas actual=${JSON.stringify({ width: actual.width, height: actual.height })} expected=${JSON.stringify(testCase.canvas)}`,
    );
  }

  const composedSource = svg(32, 32, '<rect x="8" y="8" width="16" height="16" fill="#173D39"/>');
  const composedTransform = {
    mode: 'svg',
    canvas: { width: 32, height: 32 },
    density: 1,
    recolor: { '#173D39': '#F7F5EF' },
    background: '#173D39',
  };
  const composed = inspectAssetPng(renderSvg(composedSource, composedTransform));
  const corner = composed.rgba.subarray(0, 3);
  const centerOffset = (16 * composed.width + 16) * 4;
  const center = composed.rgba.subarray(centerOffset, centerOffset + 3);
  assert.deepEqual([...corner], [23, 61, 57], `background composition corner actual=${JSON.stringify([...corner])} expected=[23,61,57]`);
  assert.deepEqual([...center], [247, 245, 239], `palette recolor center actual=${JSON.stringify([...center])} expected=[247,245,239]`);
  assert.equal(composed.alpha.transparentPixels, 0, `background must make canvas opaque actual=${composed.alpha.transparentPixels} expected=0`);

  const transparent = inspectAssetPng(renderSvg(transformCases[3].source, transformCases[3].transform));
  assert.ok(transparent.alpha.transparentPixels > 0, `transparent symbol alpha actual=${transparent.alpha.transparentPixels} expected>0`);

  const solidBackground = inspectAssetPng(renderSvg(null, {
    mode: 'solid-background',
    canvas: { width: 1024, height: 1024 },
    density: 'native',
    background: '#173D39',
  }));
  assert.deepEqual(
    { width: solidBackground.width, height: solidBackground.height, transparentPixels: solidBackground.alpha.transparentPixels, uniformColor: solidBackground.uniformColor },
    { width: 1024, height: 1024, transparentPixels: 0, uniformColor: true },
    `solid native background actual=${JSON.stringify({ width: solidBackground.width, height: solidBackground.height, alpha: solidBackground.alpha, uniformColor: solidBackground.uniformColor })}`,
  );

  const safeFit = inspectAssetPng(renderSvg(svg(256, 256, '<circle cx="128" cy="128" r="100" fill="#173D39"/>'), {
    mode: 'svg',
    canvas: { width: 1024, height: 1024 },
    density: 'native',
    safeArea: 'symbol-624',
  }));
  const safeFitMetrics = countOutsideCenteredCircle(safeFit.rgba, safeFit.width, safeFit.height, 624);
  assert.deepEqual(
    { width: safeFit.width, height: safeFit.height, outsidePixels: safeFitMetrics.outsidePixels },
    { width: 1024, height: 1024, outsidePixels: 0 },
    `symbol-624 safe-area fit actual=${JSON.stringify({ width: safeFit.width, height: safeFit.height, outsidePixels: safeFitMetrics.outsidePixels })}`,
  );

  const faviconFit = inspectAssetPng(renderSvg(svg(256, 256, '<circle cx="128" cy="128" r="100" fill="#173D39"/>'), {
    mode: 'svg',
    canvas: { width: 48, height: 48 },
    density: 'native',
    safeArea: 'favicon-10',
  }));
  const faviconInk = alphaBounds(faviconFit.rgba, faviconFit.width, faviconFit.height);
  const faviconClearSpace = {
    left: faviconInk.bounds?.left,
    top: faviconInk.bounds?.top,
    right: faviconFit.width - 1 - (faviconInk.bounds?.right ?? faviconFit.width - 1),
    bottom: faviconFit.height - 1 - (faviconInk.bounds?.bottom ?? faviconFit.height - 1),
  };
  const faviconInkSize = faviconInk.bounds
    ? { width: faviconInk.bounds.right - faviconInk.bounds.left + 1, height: faviconInk.bounds.bottom - faviconInk.bounds.top + 1 }
    : { width: 0, height: 0 };
  const faviconEvidence = { bounds: faviconInk.bounds, visiblePixels: faviconInk.visiblePixels, clearSpace: faviconClearSpace, visibleSize: faviconInkSize };
  assert.ok(
    faviconInk.visiblePixels > 0 && Object.values(faviconClearSpace).every((margin) => margin >= 10) &&
      faviconInkSize.width >= 20 && faviconInkSize.height >= 20,
    `48px favicon safe-area and recognizability actual=${JSON.stringify(faviconEvidence)} expected=all margins >= 10px and visible width/height >= 20px`,
  );

  const invalidCases = [
    ['invalid aspect ratio', () => renderSvg(transformCases[0].source, { mode: 'svg', canvas: { width: 360, height: 99 }, density: 1 }), /aspect ratio/],
    ['invalid viewBox origin', () => renderSvg(svg(32, 32, '<rect width="32" height="32" fill="#173D39"/>').replace('viewBox="0 0 32 32"', 'viewBox="1 0 32 32"'), { mode: 'svg', canvas: { width: 32, height: 32 }, density: 1 }), /viewBox origin/],
    ['invalid density', () => renderSvg(transformCases[0].source, { mode: 'svg', canvas: { width: 360, height: 100 }, density: 4 }), /density/],
    ['unapproved recolor', () => renderSvg(composedSource, { ...composedTransform, recolor: { '#173D39': '#FF0000' } }), /palette/],
    ['unsupported transform key', () => renderSvg(composedSource, { ...composedTransform, blur: 2 }), /unknown transform/],
    ['unsupported safe area', () => renderSvg(composedSource, { ...composedTransform, safeArea: 'arbitrary-box' }), /safeArea/],
    ['external SVG source', () => renderSvg(svg(32, 32, '<image href="https://invalid.example/image.png"/>'), { mode: 'svg', canvas: { width: 32, height: 32 }, density: 1 }), /external|embedded|font/],
    ['system font SVG source', () => renderSvg(svg(32, 32, '<text x="0" y="16" font-family="Inter">x</text>'), { mode: 'svg', canvas: { width: 32, height: 32 }, density: 1 }), /external|embedded|font/],
  ];
  for (const [name, action, message] of invalidCases) {
    let caught;
    try {
      action();
    } catch (error) {
      caught = error;
    }
    assert.ok(caught instanceof Error, `${name} must reject actual=${JSON.stringify(caught)} expected=Error`);
    assert.match(caught.message, message, `${name} rejection actual=${JSON.stringify(caught.message)} expected=${JSON.stringify(message)}`);
  }
  return {
    fittedCanvases: transformCases.map(({ name, canvas }) => ({ name, ...canvas })),
    composed: true,
    solidBackground: true,
    safeArea: 'symbol-624',
    faviconFit: faviconEvidence,
    invalidCasesRejected: invalidCases.length,
  };
}

function runHexBorderSelftest() {
  const rgb = Buffer.from([0x17, 0x3d, 0x39]);
  const color = asHex(rgb);
  assert.equal(color, '#173d39', `RGB byte hex conversion actual=${JSON.stringify({ bytes: [...rgb], color })} expected="#173d39"`);

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect x="16" y="16" width="32" height="32" fill="#F7F5EF"/></svg>';
  const png = inspectAssetPng(renderSvg(svg, {
    mode: 'svg',
    canvas: { width: 64, height: 64 },
    density: 1,
    background: '#173D39',
  }));
  const errors = [];
  const border = validateSafeZone(
    { path: 'app/assets/brand/native/icon.png', safeRule: 'opaque-square-no-rounded-corners' },
    { safeZone: { rule: 'opaque-square-no-rounded-corners', backgroundColor: '#173D39' } },
    png,
    errors,
  );
  const actual = { color, borderMismatch: border.borderMismatch, findings: errors };
  assert.deepEqual(
    { color, borderMismatch: border.borderMismatch, findings: errors.length },
    { color: '#173d39', borderMismatch: 0, findings: 0 },
    `synthetic PNG border check actual=${JSON.stringify(actual)} expected=${JSON.stringify({ color: '#173d39', borderMismatch: 0, findings: [] })}`,
  );
  return { color, borderMismatch: border.borderMismatch, measuredCanvas: `${png.width}x${png.height}` };
}

export async function runSelftest() {
  const input = path.join(here, 'fixtures', 'export-selftest.svg');
  const fixture = await readFile(input, 'utf8');
  assert.match(fixture, /<path\b/, 'self-test fixture must contain outlined vector paths');
  assert.doesNotMatch(fixture, /<(?:text|font)\b|font-family\s*=|@font-face/i, 'self-test fixture must not use fonts');

  const rawRendererPng = new Resvg(fixture, { font: { loadSystemFonts: false } }).render().asPng();
  const rawRendererProfile = inspectAssetPng(rawRendererPng).profile;
  assert.equal(rawRendererProfile.kind, 'NOT VERIFIED', `pinned raw Resvg output profile actual=${JSON.stringify(rawRendererProfile)} expected=untagged baseline`);

  const first = renderSvg(fixture);
  const second = renderSvg(fixture);
  assert.deepEqual(first, second, 'identical outlined input must export byte-for-byte identically');
  assert.deepEqual(validatePng(first), { width: 64, height: 64, bytes: first.length });
  const inspected = inspectAssetPng(first);
  assert.deepEqual(
    { width: inspected.width, height: inspected.height, colorType: inspected.colorType, hasTransparentPixels: inspected.alpha.transparentPixels > 0, hasVisiblePixels: inspected.alpha.opaquePixels + inspected.alpha.partialAlphaPixels > 0 },
    { width: 64, height: 64, colorType: 6, hasTransparentPixels: true, hasVisiblePixels: true },
  );
  assert.deepEqual(
    inspected.profile,
    { kind: 'sRGB', renderingIntent: 0 },
    `exported fixture profile actual=${JSON.stringify(inspected.profile)} expected=${JSON.stringify({ kind: 'sRGB', renderingIntent: 0 })}`,
  );
  let chunkOffset = 8;
  let srgbCrcOffset = -1;
  while (chunkOffset + 12 <= first.length) {
    const chunkLength = first.readUInt32BE(chunkOffset);
    const chunkType = first.toString('ascii', chunkOffset + 4, chunkOffset + 8);
    if (chunkType === 'sRGB') {
      srgbCrcOffset = chunkOffset + 8 + chunkLength;
      break;
    }
    chunkOffset += 12 + chunkLength;
  }
  assert.ok(srgbCrcOffset >= 0, `exported fixture sRGB chunk offset actual=${srgbCrcOffset} expected>=0`);
  const corruptProfile = Buffer.from(first);
  corruptProfile[srgbCrcOffset] ^= 0x01;
  assert.throws(
    () => inspectAssetPng(corruptProfile),
    /CRC mismatch/,
    `corrupt sRGB CRC rejection actualOffset=${srgbCrcOffset} expected=CRC mismatch`,
  );
  const transforms = runTransformSelftests();
  const hexBorder = runHexBorderSelftest();

  const output = path.join(here, 'fixtures', `.export-selftest-${randomUUID()}.png`);
  const transformedOutput = path.join(here, 'fixtures', `.export-transform-selftest-${randomUUID()}.png`);
  const solidBackgroundOutput = path.join(here, 'fixtures', `.export-background-selftest-${randomUUID()}.png`);
  const fitTransform = JSON.stringify({ mode: 'svg', canvas: { width: 32, height: 32 }, density: 1 });
  const backgroundTransform = JSON.stringify({
    mode: 'solid-background',
    canvas: { width: 32, height: 32 },
    density: 'native',
    background: '#173D39',
  });
  const expectedSolidSourceHash = sha256(Buffer.from(solidBackgroundSvg({ width: 32, height: 32 }, '#173D39'), 'utf8'));
  try {
    await exportSvg({ input, output, mode: 'write' });
    await exportSvg({ input, output, mode: 'check' });
    await writeFile(output, Buffer.from('stale'));
    await assert.rejects(exportSvg({ input, output, mode: 'check' }), /Export is stale/);

    for (const [name, args, expectedOutput, expectedSourceHash] of [
      ['fitted CLI export', ['--write', '--input', input, '--output', transformedOutput, '--transform', fitTransform], transformedOutput, sha256(await readFile(input))],
      ['solid-background CLI export', ['--write', '--output', solidBackgroundOutput, '--transform', backgroundTransform], solidBackgroundOutput, expectedSolidSourceHash],
    ]) {
      const written = spawnSync(process.execPath, [path.join(here, 'export.mjs'), ...args], { cwd: here, encoding: 'utf8' });
      assert.equal(written.status, 0, `${name} write failed actual=${JSON.stringify({ status: written.status, stdout: written.stdout, stderr: written.stderr })} expected=status 0`);
      const writeReport = JSON.parse(String(written.stdout ?? '').trim());
      assert.equal(writeReport.sourceSha256, expectedSourceHash, `${name} source hash actual=${JSON.stringify(writeReport.sourceSha256)} expected=${JSON.stringify(expectedSourceHash)}`);
      const checkArgs = ['--check'];
      if (name === 'fitted CLI export') checkArgs.push('--input', input);
      checkArgs.push('--output', expectedOutput, '--transform', name === 'fitted CLI export' ? fitTransform : backgroundTransform);
      const checked = spawnSync(process.execPath, [path.join(here, 'export.mjs'), ...checkArgs], { cwd: here, encoding: 'utf8' });
      assert.equal(checked.status, 0, `${name} check failed actual=${JSON.stringify({ status: checked.status, stdout: checked.stdout, stderr: checked.stderr })} expected=status 0`);
      const checkReport = JSON.parse(String(checked.stdout ?? '').trim());
      assert.deepEqual(
        { sourceSha256: checkReport.sourceSha256, sha256: checkReport.sha256 },
        { sourceSha256: expectedSourceHash, sha256: writeReport.sha256 },
        `${name} check report actual=${JSON.stringify({ sourceSha256: checkReport.sourceSha256, sha256: checkReport.sha256 })}`,
      );
    }

    const fittedMetadata = validatePng(await readFile(transformedOutput), { width: 32, height: 32 });
    const solidMetadata = inspectAssetPng(await readFile(solidBackgroundOutput));
    assert.deepEqual({ width: fittedMetadata.width, height: fittedMetadata.height }, { width: 32, height: 32 });
    assert.deepEqual(
      { width: solidMetadata.width, height: solidMetadata.height, transparentPixels: solidMetadata.alpha.transparentPixels, uniformColor: solidMetadata.uniformColor },
      { width: 32, height: 32, transparentPixels: 0, uniformColor: true },
    );
  } finally {
    await unlink(output).catch(() => undefined);
    await unlink(transformedOutput).catch(() => undefined);
    await unlink(solidBackgroundOutput).catch(() => undefined);
  }
  return {
    fixture: 'export-selftest.svg',
    width: 64,
    height: 64,
    deterministic: true,
    writeCheck: true,
    rawRendererProfile: rawRendererProfile.kind,
    pngProfile: 'sRGB',
    profileCrcVerified: true,
    transformSelftest: transforms,
    hexBorderSelftest: hexBorder,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || !['--selftest', '--check-oorva'].includes(process.argv[2])) {
    console.error('usage: node asset-tests.mjs --selftest | --check-oorva');
    process.exitCode = 2;
  } else if (process.argv[2] === '--check-oorva') {
    runOorvaCheck()
      .then((result) => console.log(JSON.stringify(result)))
      .catch((error) => {
        console.error(`brand asset check: ${error.message}`);
        process.exitCode = 1;
      });
  } else {
    runSelftest()
      .then((result) => console.log(JSON.stringify(result)))
      .catch((error) => {
        console.error(`brand selftest: ${error.message}`);
        process.exitCode = 1;
      });
  }
}
