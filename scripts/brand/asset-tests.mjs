#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { exportSvg, renderSvg } from './export.mjs';
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
    expectValue(errors, `${label} alpha mode`, entry.alpha, definition.alpha);
    expect(errors, `${label} export sha256 format`, typeof entry.export?.sha256 === 'string' && HASH_PATTERN.test(entry.export.sha256), entry.export?.sha256, '64 lowercase hexadecimal characters');
    expect(errors, `${label} source sha256 format`, typeof entry.source?.sha256 === 'string' && HASH_PATTERN.test(entry.source.sha256), entry.source?.sha256, '64 lowercase hexadecimal characters');
    expectValue(errors, `${label} approval.designSelection`, entry.approval?.designSelection, 'pending');
    expectValue(errors, `${label} approval.publicRights`, entry.approval?.publicRights, 'pending');
    expectValue(errors, `${label} selected`, entry.selected, false);
    expectValue(errors, `${label} publiclyCleared`, entry.publiclyCleared, false);
    expectValue(errors, `${label} license.status`, entry.license?.status, 'pending');
    expect(errors, `${label} license.reference`, typeof entry.license?.reference === 'string' &&
      entry.license.reference.trim().length > 0 && !/^<.*>$/.test(entry.license.reference.trim()), entry.license?.reference, 'non-empty provenance/license reference; clearance remains pending');

    let sourcePath;
    let sourceBytes;
    let outputBytes;
    try {
      sourcePath = resolveBrandPath(entry.source?.path, `${label} source`);
      if (!sourcePath.toLowerCase().endsWith('.svg')) {
        throw new Error(`${label} source extension: actual=${JSON.stringify(entry.source?.path)} expected=.svg`);
      }
      [sourceBytes, outputBytes] = await Promise.all([
        readRegularFile(sourcePath, `${label} source`),
        readRegularFile(path.join(repoRoot, ...label.split('/')), label),
      ]);
    } catch (error) {
      errors.push(`${label} files: actual=${JSON.stringify(error.message)} expected=present regular source SVG and PNG below app/assets/brand`);
      continue;
    }

    const sourceHash = sha256(sourceBytes);
    const outputHash = sha256(outputBytes);
    expectValue(errors, `${label} source.sha256`, entry.source?.sha256, sourceHash);
    expectValue(errors, `${label} export.sha256`, entry.export?.sha256, outputHash);
    const sourceText = sourceBytes.toString('utf8');
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
    expect(errors, `${label} source SVG safety`, sourceSafety.hasSvgRoot && !sourceSafety.usesTextOrFonts &&
      !sourceSafety.usesEmbeddedOrRasterImage && !sourceSafety.usesExternalXmlOrCss &&
      sourceSafety.externalReferences.length === 0, sourceSafety, {
      hasSvgRoot: true,
      usesTextOrFonts: false,
      usesEmbeddedOrRasterImage: false,
      usesExternalXmlOrCss: false,
      externalReferences: [],
    });

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
      const regenerated = renderSvg(sourceText);
      deterministic = regenerated.equals(outputBytes);
      expect(errors, `${label} deterministic source/export`, deterministic, {
        source: entry.source?.path,
        sourceSha256: sourceHash,
        renderedSha256: sha256(regenerated),
        exportedSha256: outputHash,
        renderedBytes: regenerated.length,
        exportedBytes: outputBytes.length,
      }, 'renderSvg(source) byte-for-byte equals exported PNG');
    } catch (error) {
      errors.push(`${label} deterministic render: actual=${JSON.stringify(error.message)} expected=successful pinned @resvg render`);
    }

    const summary = {
      export: label,
      role: expectedRole(label),
      source: entry.source?.path,
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
    if (label.includes('logo-compact-')) compact.set(label, { png, sourcePath: entry.source.path, sourceText });
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
        rendered = new Resvg(base.sourceText, {
          fitTo: { mode: 'width', value: size },
          font: { loadSystemFonts: false },
        }).render().asPng();
      } catch (error) {
        errors.push(`compact ${theme} ${size}px source render NOT VERIFIED: actual=${JSON.stringify(error.message)} expected=pinned @resvg render`);
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

export async function runSelftest() {
  const input = path.join(here, 'fixtures', 'export-selftest.svg');
  const fixture = await readFile(input, 'utf8');
  assert.match(fixture, /<path\b/, 'self-test fixture must contain outlined vector paths');
  assert.doesNotMatch(fixture, /<(?:text|font)\b|font-family\s*=|@font-face/i, 'self-test fixture must not use fonts');

  const first = renderSvg(fixture);
  const second = renderSvg(fixture);
  assert.deepEqual(first, second, 'identical outlined input must export byte-for-byte identically');
  assert.deepEqual(validatePng(first), { width: 64, height: 64, bytes: first.length });
  const inspected = inspectAssetPng(first);
  assert.deepEqual(
    { width: inspected.width, height: inspected.height, colorType: inspected.colorType, hasTransparentPixels: inspected.alpha.transparentPixels > 0, hasVisiblePixels: inspected.alpha.opaquePixels + inspected.alpha.partialAlphaPixels > 0 },
    { width: 64, height: 64, colorType: 6, hasTransparentPixels: true, hasVisiblePixels: true },
  );

  const output = path.join(here, 'fixtures', `.export-selftest-${randomUUID()}.png`);
  try {
    await exportSvg({ input, output, mode: 'write' });
    await exportSvg({ input, output, mode: 'check' });
    await writeFile(output, Buffer.from('stale'));
    await assert.rejects(exportSvg({ input, output, mode: 'check' }), /Export is stale/);
  } finally {
    await unlink(output).catch(() => undefined);
  }
  return { fixture: 'export-selftest.svg', width: 64, height: 64, deterministic: true, writeCheck: true };
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
