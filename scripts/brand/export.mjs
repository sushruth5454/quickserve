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
const SYMBOL_CIRCLE_SAFE_INK_SIZE = 576;
const SAFE_AREA_RULES = Object.freeze({
  'symbol-624': { canvasSize: 1024, inkSize: SYMBOL_NATIVE_SAFE_SIZE },
  'symbol-circle-624': { canvasSize: 1024, inkSize: SYMBOL_CIRCLE_SAFE_INK_SIZE },
  'favicon-10': { canvasSize: 48, inkSize: 28 },
});
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const SRGB_CHROMATICITIES = [31270, 32900, 64000, 33000, 30000, 60000, 15000, 6000];

function pngCrc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function embedSrgbProfile(png) {
  if (!Buffer.isBuffer(png) || png.length < 45 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`Resvg output is not a complete PNG: actualBytes=${Buffer.isBuffer(png) ? png.length : 'NOT A BUFFER'}`);
  }

  let offset = 8;
  let ihdrEnd = null;
  let hasSrgb = false;
  let hasIccp = false;
  let gamma = null;
  let chromaticities = null;
  let sawEnd = false;

  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > png.length) throw new Error(`Resvg PNG chunk exceeds buffer: type=${type} end=${chunkEnd} bytes=${png.length}`);

    const data = png.subarray(dataStart, dataEnd);
    const actualCrc = png.readUInt32BE(dataEnd);
    const expectedCrc = pngCrc32(png.subarray(offset + 4, dataEnd));
    if (actualCrc !== expectedCrc) {
      throw new Error(`Resvg PNG chunk CRC is invalid: type=${type} actual=${actualCrc} expected=${expectedCrc}`);
    }

    if (offset === 8) {
      if (type !== 'IHDR' || length !== 13) throw new Error(`Resvg PNG must start with IHDR: actualType=${type} actualLength=${length}`);
      ihdrEnd = chunkEnd;
    } else if (type === 'IHDR') {
      throw new Error('Resvg PNG contains duplicate IHDR');
    }

    if (type === 'sRGB') {
      if (length !== 1 || data[0] > 3) throw new Error(`Resvg sRGB chunk is invalid: actual=${data.toString('hex')}`);
      hasSrgb = true;
    } else if (type === 'iCCP') {
      hasIccp = true;
    } else if (type === 'gAMA') {
      if (length !== 4) throw new Error(`Resvg gAMA chunk is invalid: actualLength=${length} expected=4`);
      gamma = data.readUInt32BE(0);
    } else if (type === 'cHRM') {
      if (length !== 32) throw new Error(`Resvg cHRM chunk is invalid: actualLength=${length} expected=32`);
      chromaticities = Array.from({ length: 8 }, (_, index) => data.readUInt32BE(index * 4));
    }

    offset = chunkEnd;
    if (type === 'IEND') {
      if (length !== 0 || offset !== png.length) throw new Error(`Resvg IEND is invalid: actualLength=${length} end=${offset} bytes=${png.length}`);
      sawEnd = true;
      break;
    }
  }

  if (ihdrEnd === null || !sawEnd) throw new Error(`Resvg PNG is incomplete: ihdrEnd=${ihdrEnd} IEND=${sawEnd}`);
  if (hasSrgb && hasIccp) throw new Error('Resvg PNG contains conflicting sRGB and iCCP profiles');
  if (hasSrgb || hasIccp) return png;
  if (gamma !== null && gamma !== 45455) {
    throw new Error(`Resvg PNG gamma is not sRGB: actual=${gamma} expected=45455`);
  }
  if (chromaticities !== null && chromaticities.some((value, index) => value !== SRGB_CHROMATICITIES[index])) {
    throw new Error(`Resvg PNG chromaticities are not sRGB: actual=${JSON.stringify(chromaticities)} expected=${JSON.stringify(SRGB_CHROMATICITIES)}`);
  }

  const chunk = Buffer.alloc(13);
  chunk.writeUInt32BE(1, 0);
  chunk.write('sRGB', 4, 4, 'ascii');
  chunk[8] = 0;
  chunk.writeUInt32BE(pngCrc32(chunk.subarray(4, 9)), 9);
  return Buffer.concat([png.subarray(0, ihdrEnd), chunk, png.subarray(ihdrEnd)]);
}

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
    const fitRule = Object.hasOwn(SAFE_AREA_RULES, transform.safeArea) ? SAFE_AREA_RULES[transform.safeArea] : null;
    if (!fitRule) {
      throw new Error(`transform safeArea is unsupported: actual=${JSON.stringify(transform.safeArea)} expected=${JSON.stringify(Object.keys(SAFE_AREA_RULES))}`);
    }
    if (viewBox.width !== SYMBOL_VIEWBOX_SIZE || viewBox.height !== SYMBOL_VIEWBOX_SIZE ||
      canvas.width !== fitRule.canvasSize || canvas.height !== fitRule.canvasSize || transform.density !== 'native' ||
      transform.background !== undefined) {
      throw new Error(`${transform.safeArea} fit has incompatible source or canvas: actual=${JSON.stringify({ viewBox, canvas, density: transform.density, background: transform.background })} expected=viewBox 0 0 256 256, canvas ${fitRule.canvasSize}x${fitRule.canvasSize}, density native, no background`);
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

function fitSymbolSafeArea(svgSource, canvas, safeInkSize) {
  const scale = safeInkSize / SYMBOL_INK_SAFEBOX_SIZE;
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
  if (transform.safeArea) result = fitSymbolSafeArea(result, transform.canvas, SAFE_AREA_RULES[transform.safeArea].inkSize);
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
    const rawPng = new Resvg(svgSource, {
      font: { loadSystemFonts: false },
    }).render().asPng();
    return embedSrgbProfile(rawPng);
  }

  const normalized = validateTransform(svgSource, transform);
  const preparedSvg = normalized.mode === 'solid-background'
    ? solidBackgroundSvg(normalized.canvas, normalized.background)
    : composeSvg(svgSource, normalized);
  const rawPng = new Resvg(preparedSvg, {
    fitTo: { mode: 'width', value: normalized.canvas.width },
    font: { loadSystemFonts: false },
  }).render().asPng();
  const png = embedSrgbProfile(rawPng);
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
