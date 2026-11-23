#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { exportSvg, renderSvg, solidBackgroundSvg } from './export.mjs';
import { inspectAssetPng, validateColorProfile, validatePng } from './validate.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const brandAssets = path.join(repoRoot, 'app', 'assets', 'brand');
const brandKitRoot = path.join(repoRoot, 'docs', 'design', 'oorva', 'brand-kit');
const suppliedExportManifestPath = path.join(brandKitRoot, 'handoff', 'supplied-export-manifest.json');
const SUPPLIED_D_SAMPLE = Object.freeze({
  path: 'app/assets/brand/logo-horizontal-light.png',
  sha256: 'e97e8b3dfe0b62adceb5deadcdfafa18d7756631119c5e969a69d5a87c446e7e',
});
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
const APPROVAL_STATES = new Set(['pending', 'approved']);
const RELEASE_BLOCKING_GATES = ['D02', 'D07a-platform', 'D07b'];

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

function expectedSafeAreaForAsset(filePath) {
  if (filePath === 'app/assets/brand/native/favicon.png') return 'favicon-10';
  if ([
    'app/assets/brand/native/android-icon-foreground.png',
    'app/assets/brand/native/android-icon-monochrome.png',
    'app/assets/brand/native/splash-icon.png',
    'app/assets/brand/native/splash-icon-dark.png',
  ].includes(filePath)) return 'symbol-circle-624';
  return undefined;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function toPillowInkBounds(bounds) {
  if (!bounds) return null;
  // The supplied manifest uses exclusive right/bottom endpoints; PNG inspection returns inclusive pixels.
  return [bounds.left, bounds.top, bounds.right + 1, bounds.bottom + 1];
}

function resolveSuppliedKitPath(relativePath, label) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new Error(`${label}: actual=${JSON.stringify(relativePath)} expected=bundle-relative path`);
  }
  const normalized = relativePath.replaceAll('\\', '/');
  if (!normalized.startsWith('bundle/') || normalized.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalized) || normalized.split('/').includes('..')) {
    throw new Error(`${label}: actual=${JSON.stringify(relativePath)} expected=relative bundle path without traversal`);
  }
  const resolved = path.resolve(brandKitRoot, ...normalized.split('/'));
  const relativeToKit = path.relative(brandKitRoot, resolved);
  if (relativeToKit === '..' || relativeToKit.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToKit)) {
    throw new Error(`${label}: actual=${JSON.stringify(relativePath)} resolved=${JSON.stringify(resolved)} expected=file below the supplied brand kit`);
  }
  return resolved;
}

async function loadSuppliedExportManifest() {
  const manifestBytes = await readRegularFile(suppliedExportManifestPath, 'supplied D export manifest');
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8'));
  } catch (error) {
    throw new Error(`supplied D export manifest JSON invalid: actual=${JSON.stringify(error.message)} expected=valid JSON object`);
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) ||
    manifest.schemaVersion !== 1 || manifest.stageId !== 'O01X' || manifest.status !== 'supplied-ready-D') {
    throw new Error(`supplied D export manifest identity invalid: actual=${JSON.stringify({
      schemaVersion: manifest?.schemaVersion,
      stageId: manifest?.stageId,
      status: manifest?.status,
    })} expected=${JSON.stringify({ schemaVersion: 1, stageId: 'O01X', status: 'supplied-ready-D' })}`);
  }
  const declaredProvenance = manifest.toolchain;
  const expectedProvenance = {
    renderer: 'Chromium SVG rasterization',
    version: '158.0.4370.33',
    pngEncoder: 'Pillow',
    systemFontsUsed: false,
  };
  const actualProvenance = Object.fromEntries(Object.keys(expectedProvenance)
    .map((key) => [key, declaredProvenance?.[key]]));
  if (JSON.stringify(actualProvenance) !== JSON.stringify(expectedProvenance) ||
    declaredProvenance?.note !== 'Outline-only inputs. These are supplied sealed exports, not a claim that the old forest-only resvg --check passes.') {
    throw new Error(`supplied D export provenance invalid: actual=${JSON.stringify(declaredProvenance)} expected=${JSON.stringify({
      ...expectedProvenance,
      note: 'Outline-only inputs. These are supplied sealed exports, not a claim that the old forest-only resvg --check passes.',
    })}`);
  }
  if (!Array.isArray(manifest.files)) {
    throw new Error(`supplied D export manifest files invalid: actual=${JSON.stringify(manifest.files)} expected=array`);
  }

  const pngEntries = manifest.files.filter((entry) => typeof entry?.file === 'string' && entry.file.toLowerCase().endsWith('.png'));
  if (pngEntries.length !== 56) {
    throw new Error(`supplied D PNG manifest count invalid: actual=${pngEntries.length} expected=56`);
  }
  const byTarget = new Map();
  for (const entry of pngEntries) {
    const target = typeof entry.target === 'string' ? entry.target.replaceAll('\\', '/') : '';
    if (!target.startsWith('app/assets/brand/') || entry.file.replaceAll('\\', '/') !== `bundle/${target}` ||
      !HASH_PATTERN.test(entry.sha256 ?? '') || !Number.isSafeInteger(entry.bytes) || entry.bytes < 45 ||
      byTarget.has(target)) {
      throw new Error(`supplied D PNG manifest entry invalid: actual=${JSON.stringify(entry)} expected=unique brand target, bundle path, SHA-256 and positive byte count`);
    }
    resolveSuppliedKitPath(entry.file, 'supplied D PNG path');
    byTarget.set(target, entry);
  }
  return { manifest, manifestBytes, provenance: expectedProvenance, byTarget };
}

async function verifySuppliedDProfile() {
  const supplied = await loadSuppliedExportManifest();
  const entry = supplied.byTarget.get(SUPPLIED_D_SAMPLE.path);
  assert.ok(entry, `supplied D profile fixture missing actual=${JSON.stringify([...supplied.byTarget.keys()])} expected=${SUPPLIED_D_SAMPLE.path}`);
  assert.equal(entry.sha256, SUPPLIED_D_SAMPLE.sha256, `supplied D profile fixture hash actual=${JSON.stringify(entry.sha256)} expected=${SUPPLIED_D_SAMPLE.sha256}`);
  assert.equal(entry.colourProfile, 'sRGB', `supplied D profile declaration actual=${JSON.stringify(entry.colourProfile)} expected="sRGB"`);

  const suppliedBytes = await readRegularFile(resolveSuppliedKitPath(entry.file, 'supplied D profile PNG'), 'supplied D profile PNG');
  assert.equal(suppliedBytes.length, entry.bytes, `supplied D profile byte length actual=${suppliedBytes.length} expected=${entry.bytes}`);
  assert.equal(sha256(suppliedBytes), entry.sha256, `supplied D profile SHA-256 actual=${sha256(suppliedBytes)} expected=${entry.sha256}`);
  const png = inspectAssetPng(suppliedBytes);
  validateColorProfile(png.profile, { kind: entry.colourProfile }, 'supplied D profile PNG');
  assert.deepEqual(
    { width: png.width, height: png.height },
    entry.canvas,
    `supplied D profile canvas actual=${JSON.stringify({ width: png.width, height: png.height })} expected=${JSON.stringify(entry.canvas)}`,
  );
  assert.equal(png.alpha.transparentPixels > 0, entry.alpha === 'transparent',
    `supplied D profile alpha actual=${JSON.stringify(png.alpha)} expected=${JSON.stringify(entry.alpha)}`);
  assert.deepEqual(
    toPillowInkBounds(png.alpha.bounds),
    entry.inkBounds,
    `supplied D profile Pillow ink bounds actual=${JSON.stringify(toPillowInkBounds(png.alpha.bounds))} expected=${JSON.stringify(entry.inkBounds)}`,
  );
  return {
    file: entry.target,
    sha256: entry.sha256,
    colorProfile: png.profile.kind,
    manifest: 'docs/design/oorva/brand-kit/handoff/supplied-export-manifest.json',
    manifestSha256: sha256(supplied.manifestBytes),
    provenance: supplied.provenance,
  };
}

function expectValue(errors, label, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(`${label}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  }
}

function expect(errors, label, condition, actual, expected) {
  if (!condition) errors.push(`${label}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

function validateManifestApprovalState(manifest) {
  const errors = [];
  const gates = [
    { approval: 'designSelection', flag: 'selected' },
    { approval: 'publicRights', flag: 'publiclyCleared' },
  ];
  const rootApprovals = manifest.approvals ?? {};

  for (const gate of gates) {
    const approval = rootApprovals[gate.approval];
    expect(errors, `manifest.approvals.${gate.approval} state`, APPROVAL_STATES.has(approval), approval, [...APPROVAL_STATES]);
    expectValue(errors, `manifest.${gate.flag}`, manifest[gate.flag], approval === 'approved');
  }

  for (const [index, entry] of (Array.isArray(manifest.files) ? manifest.files : []).entries()) {
    for (const gate of gates) {
      const approval = entry.approval?.[gate.approval];
      expectValue(errors, `manifest.files[${index}].approval.${gate.approval}`, approval, rootApprovals[gate.approval]);
      expect(errors, `manifest.files[${index}].approval.${gate.approval} state`, APPROVAL_STATES.has(approval), approval, [...APPROVAL_STATES]);
      expectValue(errors, `manifest.files[${index}].${gate.flag}`, entry[gate.flag], approval === 'approved');
    }
  }

  return {
    errors,
    state: {
      selected: rootApprovals.designSelection === 'approved',
      publiclyCleared: rootApprovals.publicRights === 'approved',
      designSelection: rootApprovals.designSelection,
      publicRights: rootApprovals.publicRights,
    },
  };
}

function resolveReleaseReadiness(gates, authorization = {}) {
  const pendingGates = RELEASE_BLOCKING_GATES.filter((gate) => gates[gate] !== 'APPROVED');
  const releaseGatesApproved = pendingGates.length === 0;
  return {
    productionReady: releaseGatesApproved && authorization.productionReady === true,
    publicLaunchAuthorized: releaseGatesApproved && authorization.publicLaunchAuthorized === true,
    nativeVerified: releaseGatesApproved && authorization.nativeVerified === true,
    oorvaBrandFeature: releaseGatesApproved && authorization.oorvaBrandFeature === true ? 'ON' : 'OFF',
    pendingGates,
  };
}

function runManifestStateSelftests() {
  const makeManifest = (designSelection, publicRights) => {
    const selected = designSelection === 'approved';
    const publiclyCleared = publicRights === 'approved';
    return {
      approvals: { designSelection, publicRights },
      selected,
      publiclyCleared,
      files: [{
        approval: { designSelection, publicRights },
        selected,
        publiclyCleared,
      }],
    };
  };
  const approved = validateManifestApprovalState(makeManifest('approved', 'approved'));
  assert.deepEqual(approved, {
    errors: [],
    state: {
      selected: true,
      publiclyCleared: true,
      designSelection: 'approved',
      publicRights: 'approved',
    },
  }, `approved D03b/D03c state actual=${JSON.stringify(approved)}`);

  const candidate = validateManifestApprovalState(makeManifest('pending', 'pending'));
  assert.deepEqual(candidate.errors, [], `pending candidate state actual=${JSON.stringify(candidate)}`);

  const selectedButNotPublic = validateManifestApprovalState(makeManifest('approved', 'pending'));
  assert.deepEqual(selectedButNotPublic, {
    errors: [],
    state: {
      selected: true,
      publiclyCleared: false,
      designSelection: 'approved',
      publicRights: 'pending',
    },
  }, `D03b-only approval state actual=${JSON.stringify(selectedButNotPublic)}`);

  const falseApprovalClaims = makeManifest('pending', 'pending');
  falseApprovalClaims.selected = true;
  falseApprovalClaims.publiclyCleared = true;
  falseApprovalClaims.files[0].publiclyCleared = true;
  const falseApprovalResult = validateManifestApprovalState(falseApprovalClaims);
  assert.ok(falseApprovalResult.errors.some((finding) => finding.startsWith('manifest.selected:')),
    `pending D03b must reject selected=true; actual=${JSON.stringify(falseApprovalResult.errors)}`);
  assert.ok(falseApprovalResult.errors.some((finding) => finding.startsWith('manifest.publiclyCleared:')),
    `pending D03c must reject publiclyCleared=true; actual=${JSON.stringify(falseApprovalResult.errors)}`);
  assert.ok(falseApprovalResult.errors.some((finding) => finding.startsWith('manifest.files[0].publiclyCleared:')),
    `pending D03c must reject publiclyCleared=true; actual=${JSON.stringify(falseApprovalResult.errors)}`);

  const unapprovedGate = makeManifest('unapproved', 'unapproved');
  unapprovedGate.selected = true;
  unapprovedGate.publiclyCleared = true;
  unapprovedGate.files[0].selected = true;
  unapprovedGate.files[0].publiclyCleared = true;
  unapprovedGate.files[0].approval.designSelection = 'unapproved';
  unapprovedGate.files[0].approval.publicRights = 'unapproved';
  const unapprovedResult = validateManifestApprovalState(unapprovedGate);
  assert.ok(unapprovedResult.errors.some((finding) => finding.includes('designSelection state')),
    `unknown/unapproved gate states must be rejected; actual=${JSON.stringify(unapprovedResult.errors)}`);
  assert.ok(unapprovedResult.errors.some((finding) => finding.includes('publicRights state')),
    `unknown/unapproved public-rights states must be rejected; actual=${JSON.stringify(unapprovedResult.errors)}`);

  const pendingReleaseGates = {
    D02: 'PENDING',
    'D07a-platform': 'PENDING',
    D07b: 'PENDING',
  };
  const releaseReadiness = resolveReleaseReadiness(pendingReleaseGates, {
    productionReady: true,
    publicLaunchAuthorized: true,
    nativeVerified: true,
    oorvaBrandFeature: true,
  });
  assert.deepEqual(releaseReadiness, {
    productionReady: false,
    publicLaunchAuthorized: false,
    nativeVerified: false,
    oorvaBrandFeature: 'OFF',
    pendingGates: RELEASE_BLOCKING_GATES,
  }, `pending D02/D07 gates must block all release/readiness claims; actual=${JSON.stringify(releaseReadiness)}`);

  return {
    approvedSelectedAndClearedAccepted: true,
    selectionOnlyStateAccepted: true,
    pendingClaimsRejected: true,
    pendingReleaseGatesBlocked: true,
  };
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
  const channels = Array.from(rgb).slice(0, 3);
  if (channels.length !== 3 || channels.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new Error(`RGB bytes are invalid: actual=${JSON.stringify(channels)} expected=three integers in [0,255]`);
  }
  return `#${channels.map((value) => value.toString(16).padStart(2, '0')).join('')}`.toLowerCase();
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
  if (!declared || !['sRGB', 'iCCP'].includes(declared.kind)) {
    errors.push(`${label} colorProfile: actual=${JSON.stringify(declared)} expected=sRGB or validated iCCP evidence`);
    return;
  }
  if (declared.kind === 'sRGB' && !Number.isInteger(declared.renderingIntent)) {
    errors.push(`${label} colorProfile.renderingIntent: actual=${JSON.stringify(declared.renderingIntent)} expected=integer sRGB rendering intent`);
    return;
  }
  try {
    validateColorProfile(png.profile, declared, label);
  } catch (error) {
    errors.push(error.message);
  }
}

function validateSuppliedExportRecord(record, definition, png, bytes, errors, label) {
  expectValue(errors, `${label} supplied byte count`, bytes.length, record.bytes);
  expectValue(errors, `${label} supplied dimensions`, { width: png.width, height: png.height }, record.canvas);
  expectValue(errors, `${label} supplied alpha mode`, definition.alpha, record.alpha);
  expectValue(errors, `${label} supplied color profile`, png.profile.kind, record.colourProfile);
  expectValue(errors, `${label} supplied Pillow ink bounds`, toPillowInkBounds(png.alpha.bounds), record.inkBounds);
  const expectedSafeCircle = definition.safeRule === 'centered-circle-624' ? 624 : null;
  expectValue(errors, `${label} supplied safe-circle diameter`, record.safeCircleDiameter, expectedSafeCircle);
}

async function runOorvaCheck() {
  const errors = [];
  const suppliedExportData = await loadSuppliedExportManifest();
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
  const approvalState = validateManifestApprovalState(manifest);
  errors.push(...approvalState.errors);
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
    const expectedBackgrounds = ['app/assets/brand/native/icon.png', 'app/assets/brand/native/android-icon-background.png'].includes(label)
      ? ['#173d39', '#006d77']
      : [];
    const actualBackground = typeof transform?.background === 'string' ? transform.background.toLowerCase() : transform?.background;
    expect(errors, `${label} transform.background`, expectedBackgrounds.length > 0
      ? expectedBackgrounds.includes(actualBackground)
      : actualBackground === undefined, actualBackground, expectedBackgrounds.length > 0 ? expectedBackgrounds : undefined);
    expectValue(errors, `${label} transform.safeArea`, transform?.safeArea, expectedSafeAreaForAsset(label));
    expectValue(errors, `${label} alpha mode`, entry.alpha, definition.alpha);
    expect(errors, `${label} export sha256 format`, typeof entry.export?.sha256 === 'string' && HASH_PATTERN.test(entry.export.sha256), entry.export?.sha256, '64 lowercase hexadecimal characters');
    expect(errors, `${label} source sha256 format`, typeof entry.source?.sha256 === 'string' && HASH_PATTERN.test(entry.source.sha256), entry.source?.sha256, '64 lowercase hexadecimal characters');
    expectValue(errors, `${label} source.kind`, entry.source?.kind, expectedSourceKind(label));
    expectValue(errors, `${label} license.status`, entry.license?.status, 'pending');
    expect(errors, `${label} license.reference`, typeof entry.license?.reference === 'string' &&
      entry.license.reference.trim().length > 0 && !/^<.*>$/.test(entry.license.reference.trim()), entry.license?.reference, 'non-empty provenance/license reference; independent of public-rights approval');

    let sourcePath = null;
    let sourceRelativePath = null;
    let sourceBytes;
    let sourceText;
    let outputBytes;
    try {
      if (expectedSourceKind(label) === 'solid-background') {
        const sourceColor = entry.source?.color?.toLowerCase();
        expect(errors, `${label} source.color`, expectedBackgrounds.includes(sourceColor) && sourceColor === actualBackground,
          sourceColor, { allowed: expectedBackgrounds, transformBackground: actualBackground });
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
    const suppliedRecord = suppliedExportData.byTarget.get(label);
    const isSuppliedExport = Boolean(suppliedRecord && outputHash === suppliedRecord.sha256);
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
    if (isSuppliedExport) {
      validateSuppliedExportRecord(suppliedRecord, definition, png, outputBytes, errors, label);
    }

    let deterministic = null;
    let renderingProvenance;
    if (isSuppliedExport) {
      renderingProvenance = {
        kind: 'supplied',
        manifest: 'docs/design/oorva/brand-kit/handoff/supplied-export-manifest.json',
        manifestSha256: sha256(suppliedExportData.manifestBytes),
        ...suppliedExportData.provenance,
      };
    } else {
      deterministic = false;
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
      renderingProvenance = {
        kind: 'generated',
        renderer: actualToolchain.renderer,
        version: actualToolchain.rendererVersion,
        loadSystemFonts: actualToolchain.loadSystemFonts,
      };
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
      renderingProvenance,
      safeZone,
      licenseStatus: entry.license?.status,
      approval: {
        designSelection: entry.approval?.designSelection,
        publicRights: entry.approval?.publicRights,
      },
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
    status: 'PASS_ASSET_AND_STATE',
    manifest: 'app/assets/brand/manifest.json',
    state: approvalState.state,
    toolchain: actualToolchain,
    fileCount: summaries.length,
    files: summaries,
    inspections20_32_48: inspections,
    visualDesignApproval: 'D03b/D03c metadata consistency checked; this does not verify owner approval or authorize release, native verification, or runtime activation',
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

  const dPaletteSource = svg(8, 8,
    '<rect x="1" y="1" width="2" height="2" fill="#006D77"/><rect x="5" y="1" width="2" height="2" fill="#E8B772"/>');
  const dPaletteOutput = inspectAssetPng(renderSvg(dPaletteSource, {
    mode: 'svg',
    canvas: { width: 8, height: 8 },
    density: 1,
    recolor: { '#006D77': '#80D4D4', '#E8B772': '#FFFFFF' },
    background: '#0C1B21',
  }));
  const dPixel = (x, y) => [...dPaletteOutput.rgba.subarray((y * dPaletteOutput.width + x) * 4, (y * dPaletteOutput.width + x) * 4 + 3)];
  assert.deepEqual(dPixel(0, 0), [12, 27, 33], `approved D dark background actual=${JSON.stringify(dPixel(0, 0))} expected=[12,27,33]`);
  assert.deepEqual(dPixel(1, 1), [128, 212, 212], `approved D dark-primary recolor actual=${JSON.stringify(dPixel(1, 1))} expected=[128,212,212]`);
  assert.deepEqual(dPixel(5, 1), [255, 255, 255], `approved D light-background recolor actual=${JSON.stringify(dPixel(5, 1))} expected=[255,255,255]`);
  assert.deepEqual(dPaletteOutput.profile, { kind: 'sRGB', renderingIntent: 0 },
    `approved D transform profile actual=${JSON.stringify(dPaletteOutput.profile)} expected=${JSON.stringify({ kind: 'sRGB', renderingIntent: 0 })}`);

  const dSolidBackground = inspectAssetPng(renderSvg(null, {
    mode: 'solid-background',
    canvas: { width: 8, height: 8 },
    density: 1,
    background: '#006D77',
  }));
  assert.deepEqual(
    { color: asHex(dSolidBackground.firstPixel), uniformColor: dSolidBackground.uniformColor, profile: dSolidBackground.profile },
    { color: '#006d77', uniformColor: true, profile: { kind: 'sRGB', renderingIntent: 0 } },
    `approved D solid background actual=${JSON.stringify({
      color: asHex(dSolidBackground.firstPixel),
      uniformColor: dSolidBackground.uniformColor,
      profile: dSolidBackground.profile,
    })}`,
  );

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

  const circleSource = svg(256, 256, '<circle cx="128" cy="128" r="111.4792" fill="#173D39"/>');
  const legacyCircleFit = inspectAssetPng(renderSvg(circleSource, {
    mode: 'svg',
    canvas: { width: 1024, height: 1024 },
    density: 'native',
    safeArea: 'symbol-624',
  }));
  const legacyCircleMetrics = countOutsideCenteredCircle(legacyCircleFit.rgba, legacyCircleFit.width, legacyCircleFit.height, 624);
  assert.ok(
    legacyCircleMetrics.outsidePixels > 0,
    `circle source must fail the legacy square fit actual=${JSON.stringify(legacyCircleMetrics)} expected=outsidePixels > 0`,
  );

  const circleTransform = {
    mode: 'svg',
    canvas: { width: 1024, height: 1024 },
    density: 'native',
    safeArea: 'symbol-circle-624',
  };
  const circleOutput = renderSvg(circleSource, circleTransform);
  const circleOutputRepeat = renderSvg(circleSource, circleTransform);
  assert.deepEqual(circleOutput, circleOutputRepeat, `symbol-circle-624 deterministic bytes actual=${sha256(circleOutput)} expected=${sha256(circleOutputRepeat)}`);
  const circlePng = inspectAssetPng(circleOutput);
  const circleMetrics = countOutsideCenteredCircle(circlePng.rgba, circlePng.width, circlePng.height, 624);
  let maxVisibleRadiusPx = 0;
  for (let y = 0; y < circlePng.height; y += 1) {
    for (let x = 0; x < circlePng.width; x += 1) {
      if (circlePng.rgba[(y * circlePng.width + x) * 4 + 3] === 0) continue;
      maxVisibleRadiusPx = Math.max(maxVisibleRadiusPx, Math.hypot(x + 0.5 - circlePng.width / 2, y + 0.5 - circlePng.height / 2));
    }
  }
  const circleInkBounds = alphaBounds(circlePng.rgba, circlePng.width, circlePng.height).bounds;
  const circleInkSize = circleInkBounds
    ? { width: circleInkBounds.right - circleInkBounds.left + 1, height: circleInkBounds.bottom - circleInkBounds.top + 1 }
    : { width: 0, height: 0 };
  const circleErrors = [];
  validateSafeZone(
    { path: 'app/assets/brand/native/android-icon-foreground.png', safeRule: 'centered-circle-624' },
    { safeZone: { rule: 'centered-circle-624' } },
    circlePng,
    circleErrors,
  );
  assert.deepEqual(
    { outsidePixels: circleMetrics.outsidePixels, safeZoneErrors: circleErrors.length, insideCircle: maxVisibleRadiusPx < 312 },
    { outsidePixels: 0, safeZoneErrors: 0, insideCircle: true },
    `symbol-circle-624 circle proof actual=${JSON.stringify({ outsidePixels: circleMetrics.outsidePixels, maxVisibleRadiusPx, safeZoneErrors: circleErrors })} expected=zero outside pixels and max radius < 312px`,
  );

  const calibrationSource = svg(256, 256, '<rect x="24" y="24" width="208" height="208" fill="#173D39"/>');
  const calibrationPng = inspectAssetPng(renderSvg(calibrationSource, circleTransform));
  const calibrationBounds = alphaBounds(calibrationPng.rgba, calibrationPng.width, calibrationPng.height).bounds;
  const calibrationInkSize = calibrationBounds
    ? { width: calibrationBounds.right - calibrationBounds.left + 1, height: calibrationBounds.bottom - calibrationBounds.top + 1 }
    : { width: 0, height: 0 };
  assert.deepEqual(
    calibrationInkSize,
    { width: 576, height: 576 },
    `symbol-circle-624 central 208-square mapping actual=${JSON.stringify(calibrationInkSize)} expected={width:576,height:576}`,
  );

  const legacySplashSource = svg(256, 256, '<rect x="24" y="23.75" width="208" height="208.5" fill="#173D39"/>');
  const legacySplashPng = inspectAssetPng(renderSvg(legacySplashSource, {
    mode: 'svg',
    canvas: { width: 1024, height: 1024 },
    density: 'native',
    safeArea: 'symbol-624',
  }));
  const legacySplashBounds = alphaBounds(legacySplashPng.rgba, legacySplashPng.width, legacySplashPng.height).bounds;
  const legacySplashInkSize = legacySplashBounds
    ? { width: legacySplashBounds.right - legacySplashBounds.left + 1, height: legacySplashBounds.bottom - legacySplashBounds.top + 1 }
    : { width: 0, height: 0 };
  assert.ok(
    legacySplashInkSize.width > 624 || legacySplashInkSize.height > 624,
    `splash source must fail the legacy square fit actual=${JSON.stringify(legacySplashInkSize)} expected=at least one dimension > 624`,
  );
  const splashOutput = renderSvg(legacySplashSource, circleTransform);
  const splashOutputRepeat = renderSvg(legacySplashSource, circleTransform);
  assert.deepEqual(splashOutput, splashOutputRepeat, `symbol-circle-624 splash deterministic bytes actual=${sha256(splashOutput)} expected=${sha256(splashOutputRepeat)}`);
  const splashPng = inspectAssetPng(splashOutput);
  const splashBounds = alphaBounds(splashPng.rgba, splashPng.width, splashPng.height).bounds;
  const splashInkSize = splashBounds
    ? { width: splashBounds.right - splashBounds.left + 1, height: splashBounds.bottom - splashBounds.top + 1 }
    : { width: 0, height: 0 };
  const splashErrors = [];
  validateSafeZone(
    { path: 'app/assets/brand/native/splash-icon.png', safeRule: 'ink-within-624-square' },
    { safeZone: { rule: 'ink-within-624-square' } },
    splashPng,
    splashErrors,
  );
  assert.deepEqual(
    { inkWithin624: splashInkSize.width <= 624 && splashInkSize.height <= 624, safeZoneErrors: splashErrors.length },
    { inkWithin624: true, safeZoneErrors: 0 },
    `symbol-circle-624 splash proof actual=${JSON.stringify({ inkSize: splashInkSize, safeZoneErrors: splashErrors })} expected=both dimensions <= 624 and no findings`,
  );

  const circleScaleRatio = 576 / 624;
  const predictedMaxRadiusPx = 334.4376 * circleScaleRatio;
  const predictedSplashInkSize = { width: 624 * circleScaleRatio, height: 626 * circleScaleRatio };
  assert.ok(
    predictedMaxRadiusPx < 312 && predictedSplashInkSize.width <= 624 && predictedSplashInkSize.height <= 624,
    `observed O01X bounds after 576/624 scale actual=${JSON.stringify({ circleScaleRatio, predictedMaxRadiusPx, predictedSplashInkSize })} expected=radius < 312 and both splash bounds <= 624`,
  );

  const circleCandidatePaths = [
    'app/assets/brand/native/android-icon-foreground.png',
    'app/assets/brand/native/android-icon-monochrome.png',
    'app/assets/brand/native/splash-icon.png',
    'app/assets/brand/native/splash-icon-dark.png',
  ];
  assert.deepEqual(
    circleCandidatePaths.map(expectedSafeAreaForAsset),
    Array(4).fill('symbol-circle-624'),
    `O01X circle-safe manifest tokens actual=${JSON.stringify(circleCandidatePaths.map(expectedSafeAreaForAsset))} expected=${JSON.stringify(Array(4).fill('symbol-circle-624'))}`,
  );
  assert.deepEqual(
    {
      favicon: expectedSafeAreaForAsset('app/assets/brand/native/favicon.png'),
      squareIcon: expectedSafeAreaForAsset('app/assets/brand/native/icon.png'),
    },
    { favicon: 'favicon-10', squareIcon: undefined },
    `unrelated manifest safe areas actual=${JSON.stringify({
      favicon: expectedSafeAreaForAsset('app/assets/brand/native/favicon.png'),
      squareIcon: expectedSafeAreaForAsset('app/assets/brand/native/icon.png'),
    })} expected=${JSON.stringify({ favicon: 'favicon-10', squareIcon: undefined })}`,
  );

  const circleSafeAreaFit = {
    token: 'symbol-circle-624',
    inkSizePx: 576,
    circleScaleRatio,
    predictedMaxRadiusPx,
    measuredMaxRadiusPx: maxVisibleRadiusPx,
    circleOutsidePixels: circleMetrics.outsidePixels,
    circleInkSize,
    splashInkSize,
    deterministic: true,
  };

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
    ['accent cannot be used as a solid background', () => renderSvg(null, {
      mode: 'solid-background',
      canvas: { width: 32, height: 32 },
      density: 1,
      background: '#E8B772',
    }), /approved solid background/],
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
    dPalette: {
      primary: '#006d77',
      backgroundLight: '#ffffff',
      accent: '#e8b772',
      darkPrimary: '#80d4d4',
      backgroundDark: '#0c1b21',
      recolorAndBackgroundPixels: true,
      sRgbProfile: dPaletteOutput.profile,
    },
    safeArea: 'symbol-624',
    circleSafeAreaFit,
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
  const manifestStateSelftest = runManifestStateSelftests();
  const suppliedDProfile = await verifySuppliedDProfile();

  const rawRendererPng = new Resvg(fixture, { font: { loadSystemFonts: false } }).render().asPng();
  const rawRendererProfile = inspectAssetPng(rawRendererPng).profile;
  assert.equal(rawRendererProfile.kind, 'NOT VERIFIED', `pinned raw Resvg output profile actual=${JSON.stringify(rawRendererProfile)} expected=untagged baseline`);
  assert.throws(() => validateColorProfile(rawRendererProfile, { kind: 'sRGB' }), /NOT VERIFIED/,
    `raw Resvg profile must not be accepted as tagged output actual=${JSON.stringify(rawRendererProfile)}`);

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
  assert.throws(() => validateColorProfile(inspected.profile, { kind: 'sRGB', renderingIntent: 1 }), /renderingIntent/,
    `mismatched sRGB intent must be rejected actual=${JSON.stringify(inspected.profile)} expectedIntent=1`);
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
  const assetIntegrityTamperRejected = true;
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
    manifestStateSelftest,
    assetIntegrityTamperRejected,
    suppliedDProfile,
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
