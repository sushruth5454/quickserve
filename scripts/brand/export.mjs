#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { validatePng } from './validate.mjs';

const APPROVED_COLORS = new Set(['#173d39', '#f7f5ef', '#000000', '#ffffff']);
const TRANSFORM_KEYS = new Set(['mode', 'canvas', 'density', 'recolor', 'background', 'safeArea']);
const SYMBOL_VIEWBOX_SIZE = 256;
const SYMBOL_INK_SAFEBOX_SIZE = 208;
const SYMBOL_NATIVE_SAFE_SIZE = 624;

function assertSelfContainedSvg(svgSource) {
  const invalidElements = /<(?:text|textPath|font|image|feImage|script|foreignObject)\b|font-family\s*=|@font-face|<!DOCTYPE\b|<!ENTITY\b|@import\b/i.test(svgSource);
  const hrefs = [...svgSource.matchAll(/(?:xlink:)?href\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]);
  const urls = [...svgSource.matchAll(/url\(\s*["']?([^)"']+)["']?\s*\)/gi)].map((match) => match[1].trim());
  const externalReferences = [
    ...hrefs.filter((value) => !value.startsWith('#')),
    ...urls.filter((value) => !value.startsWith('#')),
  ];
  if (invalidElements || externalReferences.length > 0) {
    throw new Error(`transformed SVG must be outlined and self-contained with no font or external resources: actual=${JSON.stringify({ invalidElements, externalReferences })} expected=no text/font/image/script/external references`);
  }
}

function normalizeColor(color, label) {
  if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) {
    throw new Error(`${label} must be a six-digit hex color: actual=${JSON.stringify(color)} expected=#RRGGBB`);
  }
  const normalized = color.toLowerCase();
  if (!APPROVED_COLORS.has(normalized)) {
    throw new Error(`${label} is outside the approved Oorva palette: actual=${JSON.stringify(color)} expected=${JSON.stringify([...APPROVED_COLORS])}`);
  }
  return normalized;
}

function validateCanvas(canvas) {
  if (!canvas || typeof canvas !== 'object' || Array.isArray(canvas) ||
    !Number.isSafeInteger(canvas.width) || !Number.isSafeInteger(canvas.height) ||
    canvas.width < 1 || canvas.height < 1 || canvas.width > 1080 || canvas.height > 1080 ||
    canvas.width * canvas.height > 1_048_576) {
    throw new Error(`transform canvas is invalid or exceeds A.4.1 bounds: actual=${JSON.stringify(canvas)} expected=positive integer width/height <=1080 and area <=1048576`);
  }
  const extra = Object.keys(canvas).filter((key) => !['width', 'height'].includes(key));
  if (extra.length > 0) throw new Error(`unknown canvas fields: actual=${JSON.stringify(extra)} expected=width,height only`);
  return { width: canvas.width, height: canvas.height };
}

function validateDensity(density) {
  if (![1, 2, 3, 'native'].includes(density)) {
    throw new Error(`transform density is invalid: actual=${JSON.stringify(density)} expected=1, 2, 3, or "native"`);
  }
}

function parseViewBox(svgSource) {
  const match = svgSource.match(/\bviewBox\s*=\s*(["'])([^"']+)\1/i);
  if (!match) throw new Error('transformed SVG requires an explicit viewBox: actual=missing expected="minX minY width height"');
  const values = match[2].trim().split(/[,\s]+/).map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value)) || values[2] <= 0 || values[3] <= 0) {
    throw new Error(`transformed SVG viewBox is invalid: actual=${JSON.stringify(match[2])} expected=four finite values with positive width and height`);
  }
  if (values[0] !== 0 || values[1] !== 0) {
    throw new Error(`transformed SVG viewBox origin is invalid: actual=${JSON.stringify(values.slice(0, 2))} expected=[0,0]`);
  }
  return { x: values[0], y: values[1], width: values[2], height: values[3] };
}

function validateTransform(svgSource, transform) {
  if (!transform || typeof transform !== 'object' || Array.isArray(transform)) {
    throw new Error(`transform must be a JSON object: actual=${JSON.stringify(transform)} expected=manifest-described transform object`);
  }
  const unknown = Object.keys(transform).filter((key) => !TRANSFORM_KEYS.has(key));
  if (unknown.length > 0) throw new Error(`unknown transform keys: actual=${JSON.stringify(unknown)} expected=${JSON.stringify([...TRANSFORM_KEYS])}`);
  if (!['svg', 'solid-background'].includes(transform.mode)) {
    throw new Error(`transform mode is invalid: actual=${JSON.stringify(transform.mode)} expected=svg or solid-background`);
  }
  const canvas = validateCanvas(transform.canvas);
  validateDensity(transform.density);

  if (transform.mode === 'solid-background') {
    if (svgSource !== null) throw new Error(`solid-background mode must not receive SVG geometry: actual=SVG source supplied expected=null`);
    if (transform.recolor !== undefined) throw new Error(`solid-background mode cannot recolor geometry: actual=${JSON.stringify(transform.recolor)} expected=omitted`);
    if (transform.safeArea !== undefined) throw new Error(`solid-background mode cannot declare a symbol safe area: actual=${JSON.stringify(transform.safeArea)} expected=omitted`);
    const background = normalizeColor(transform.background, 'solid-background color');
    if (background !== '#173d39') {
      throw new Error(`solid-background mode is restricted to the approved forest background: actual=${JSON.stringify(transform.background)} expected="#173D39"`);
    }
    return { mode: transform.mode, canvas, density: transform.density, background };
  }

  if (typeof svgSource !== 'string' || svgSource.trim() === '') {
    throw new TypeError(`SVG source must be a non-empty string for mode svg: actual=${JSON.stringify(svgSource)}`);
  }
  assertSelfContainedSvg(svgSource);
  const viewBox = parseViewBox(svgSource);
  const sourceRatio = viewBox.width / viewBox.height;
  const targetRatio = canvas.width / canvas.height;
  if (Math.abs(sourceRatio - targetRatio) > 1e-8) {
    throw new Error(`transform canvas aspect ratio differs from source viewBox: actual=${JSON.stringify({ source: sourceRatio, target: targetRatio, viewBox, canvas })} expected=matching aspect ratios`);
  }

  let safeArea;
  if (transform.safeArea !== undefined) {
    if (transform.safeArea !== 'symbol-624') {
      throw new Error(`transform safeArea is unsupported: actual=${JSON.stringify(transform.safeArea)} expected="symbol-624"`);
    }
    if (viewBox.width !== SYMBOL_VIEWBOX_SIZE || viewBox.height !== SYMBOL_VIEWBOX_SIZE ||
      canvas.width !== 1024 || canvas.height !== 1024 || transform.density !== 'native' ||
      transform.background !== undefined) {
      throw new Error(`symbol-624 fit is restricted to transparent 1024-square native symbol outputs: actual=${JSON.stringify({ viewBox, canvas, density: transform.density, background: transform.background })} expected=viewBox 0 0 256 256, canvas 1024x1024, density native, no background`);
    }
    safeArea = transform.safeArea;
  }

  let background;
  if (transform.background !== undefined) background = normalizeColor(transform.background, 'transform background');

  let recolor;
  if (transform.recolor !== undefined) {
    if (!transform.recolor || typeof transform.recolor !== 'object' || Array.isArray(transform.recolor)) {
      throw new Error(`transform recolor must be a color map: actual=${JSON.stringify(transform.recolor)} expected={ "#RRGGBB": "#RRGGBB" }`);
    }
    const recolorEntries = Object.entries(transform.recolor);
    if (recolorEntries.length === 0 || recolorEntries.length > APPROVED_COLORS.size) {
      throw new Error(`transform recolor size is invalid: actual=${recolorEntries.length} expected=1..${APPROVED_COLORS.size}`);
    }
    recolor = new Map();
    for (const [source, target] of recolorEntries) {
      const sourceColor = normalizeColor(source, 'recolor source');
      const targetColor = normalizeColor(target, `recolor target for ${source}`);
      if (sourceColor === targetColor || recolor.has(sourceColor)) {
        throw new Error(`transform recolor is redundant or duplicated: actual=${JSON.stringify({ sourceColor, targetColor })} expected=distinct approved source/target colors`);
      }
      recolor.set(sourceColor, targetColor);
    }
  }
  return { mode: transform.mode, canvas, density: transform.density, recolor, background, safeArea };
}

export function solidBackgroundSvg(canvas, color) {
  const size = validateCanvas(canvas);
  const background = normalizeColor(color, 'solid-background color');
  if (background !== '#173d39') throw new Error(`solid background is not approved: actual=${JSON.stringify(color)} expected="#173D39"`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} ${size.height}"><rect x="0" y="0" width="${size.width}" height="${size.height}" fill="${background}"/></svg>`;
}

function recolorSvg(svgSource, recolor) {
  if (!recolor) return svgSource;
  const counts = new Map([...recolor.keys()].map((color) => [color, 0]));
  const replace = (value) => {
    const key = value.toLowerCase();
    if (!recolor.has(key)) return value;
    counts.set(key, counts.get(key) + 1);
    return recolor.get(key);
  };
  let result = svgSource.replace(/\b(fill|stroke|stop-color)\s*=\s*(["'])(#[0-9a-f]{6})\2/gi, (whole, _property, _quote, color) => {
    const replacement = replace(color);
    return whole.replace(color, replacement);
  });
  result = result.replace(/\bstyle\s*=\s*(["'])(.*?)\1/gi, (whole, quote, style) => {
    const recoloredStyle = style.replace(/((?:^|;)\s*(?:fill|stroke|stop-color)\s*:\s*)(#[0-9a-f]{6})(?=\s*(?:;|$))/gi, (_declaration, prefix, color) => `${prefix}${replace(color)}`);
    return `style=${quote}${recoloredStyle}${quote}`;
  });
  const unused = [...counts].filter(([, count]) => count === 0).map(([color]) => color);
  if (unused.length > 0) {
    throw new Error(`recolor source colors are not used by fill/stroke/stop-color: actual=${JSON.stringify(unused)} expected=each declared source color used at least once`);
  }
  return result;
}

function fitSymbolSafeArea(svgSource, canvas) {
  const scale = SYMBOL_NATIVE_SAFE_SIZE / SYMBOL_INK_SAFEBOX_SIZE;
  const viewWidth = canvas.width / scale;
  const viewHeight = canvas.height / scale;
  const originX = SYMBOL_VIEWBOX_SIZE / 2 - viewWidth / 2;
  const originY = SYMBOL_VIEWBOX_SIZE / 2 - viewHeight / 2;
  const number = (value) => Number(value.toFixed(12)).toString();
  const viewBox = `${number(originX)} ${number(originY)} ${number(viewWidth)} ${number(viewHeight)}`;
  return svgSource.replace(/\bviewBox\s*=\s*(["'])([^"']+)\1/i, (_whole, quote) => `viewBox=${quote}${viewBox}${quote}`);
}

function composeSvg(svgSource, transform) {
  let result = recolorSvg(svgSource, transform.recolor);
  if (transform.safeArea === 'symbol-624') result = fitSymbolSafeArea(result, transform.canvas);
  if (transform.background !== undefined) {
    const opening = /<svg\b[^>]*>/i.exec(result);
    if (!opening || opening[0].endsWith('/>')) {
      throw new Error(`background composition requires a non-self-closing svg root: actual=${JSON.stringify(opening?.[0] ?? 'missing')} expected=<svg>...</svg>`);
    }
    const rect = `<rect x="0" y="0" width="100%" height="100%" fill="${transform.background}"/>`;
    const insertion = opening.index + opening[0].length;
    result = `${result.slice(0, insertion)}${rect}${result.slice(insertion)}`;
  }
  return result;
}

export function renderSvg(svgSource, transform) {
  if (transform === undefined) {
    if (typeof svgSource !== 'string' || svgSource.trim() === '') {
      throw new TypeError('SVG source must be a non-empty string');
    }
    return new Resvg(svgSource, {
      font: { loadSystemFonts: false },
    }).render().asPng();
  }

  const normalized = validateTransform(svgSource, transform);
  const preparedSvg = normalized.mode === 'solid-background'
    ? solidBackgroundSvg(normalized.canvas, normalized.background)
    : composeSvg(svgSource, normalized);
  const png = new Resvg(preparedSvg, {
    fitTo: { mode: 'width', value: normalized.canvas.width },
    font: { loadSystemFonts: false },
  }).render().asPng();
  validatePng(png, normalized.canvas);
  return png;
}

function parseArgs(argv) {
  const options = { mode: null, input: null, output: null, transform: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--write' || arg === '--check') {
      if (options.mode) throw new Error('Choose exactly one of --write or --check');
      options.mode = arg.slice(2);
    } else if (arg === '--input' || arg === '--output' || arg === '--transform') {
      const value = argv[index + 1];
      if (!value || (arg !== '--transform' && value.startsWith('--'))) throw new Error(`${arg} requires ${arg === '--transform' ? 'JSON' : 'a path'}`);
      if (arg === '--transform') {
        if (options.transform !== undefined) throw new Error('Use exactly one --transform JSON value');
        try {
          options.transform = JSON.parse(value);
        } catch (error) {
          throw new Error(`--transform must be valid JSON: actual=${JSON.stringify(error.message)}`);
        }
      } else {
        options[arg.slice(2)] = value;
      }
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.mode) throw new Error('Use --write or --check');
  if (!options.output) throw new Error('--output is required');
  if (!options.input && options.transform?.mode !== 'solid-background') throw new Error('--input is required unless transform mode is solid-background');
  if (options.input && options.transform?.mode === 'solid-background') throw new Error('--input must be omitted for solid-background transforms');
  return options;
}

export async function exportSvg({ input, output, mode, transform }) {
  if (!['write', 'check'].includes(mode)) throw new Error('Mode must be "write" or "check"');
  if (!output) throw new Error('An output path is required');
  const solidBackground = transform?.mode === 'solid-background';
  if (solidBackground && input) throw new Error('Solid-background transforms must not have an input SVG');
  if (!solidBackground && !input) throw new Error('An input SVG is required unless using solid-background mode');
  const sourceBytes = input
    ? await readFile(input)
    : Buffer.from(solidBackgroundSvg(transform.canvas, transform.background), 'utf8');
  const svgSource = input ? sourceBytes.toString('utf8') : null;
  const png = renderSvg(svgSource, transform);

  if (mode === 'write') {
    await mkdir(path.dirname(path.resolve(output)), { recursive: true });
    await writeFile(output, png);
  } else {
    let existing;
    try {
      existing = await readFile(output);
    } catch (error) {
      if (error?.code === 'ENOENT') throw new Error(`Expected export is missing: ${output}`);
      throw error;
    }
    if (!existing.equals(png)) throw new Error(`Export is stale: ${output}`);
  }

  const result = {
    mode,
    output,
    bytes: png.length,
    sha256: createHash('sha256').update(png).digest('hex'),
  };
  if (transform !== undefined) {
    result.sourceSha256 = createHash('sha256').update(sourceBytes).digest('hex');
    result.canvas = transform.canvas;
    result.density = transform.density;
  }
  return result;
}

async function main(argv) {
  const result = await exportSvg(parseArgs(argv));
  console.log(JSON.stringify(result));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`brand export: ${error.message}`);
    process.exitCode = 1;
  });
}
