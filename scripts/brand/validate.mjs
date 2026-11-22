#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = new Uint32Array(256);
for (let value = 0; value < CRC_TABLE.length; value += 1) {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  CRC_TABLE[value] = crc >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

export function inspectAssetPng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 45 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`asset PNG is incomplete: bytes=${Buffer.isBuffer(buffer) ? buffer.length : 'NOT A BUFFER'}`);
  }

  let offset = 8;
  let header;
  let sawEnd = false;
  const idat = [];
  const chunks = [];
  let profile = { kind: 'NOT VERIFIED', reason: 'PNG has no sRGB or iCCP chunk' };
  let sawSrgb = false;
  let sawIccp = false;

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > buffer.length) {
      throw new Error(`PNG chunk ${type} exceeds file length: chunkEnd=${chunkEnd} bytes=${buffer.length}`);
    }

    const data = buffer.subarray(dataStart, dataEnd);
    const actualCrc = buffer.readUInt32BE(dataEnd);
    const expectedCrc = crc32(buffer.subarray(offset + 4, dataEnd));
    if (actualCrc !== expectedCrc) {
      throw new Error(`PNG chunk ${type} CRC mismatch: actual=${actualCrc} expected=${expectedCrc}`);
    }
    chunks.push(type);

    if (!header) {
      if (type !== 'IHDR' || length !== 13) {
        throw new Error(`PNG must begin with a 13-byte IHDR chunk: actualType=${type} actualLength=${length}`);
      }
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
      if (header.width < 1 || header.height < 1) {
        throw new Error(`PNG dimensions must be positive: actual=${header.width}x${header.height}`);
      }
      if (header.width * header.height > 1_048_576) {
        throw new Error(`Asset PNG exceeds the 1024-square A.4.1 limit: actual=${header.width}x${header.height}`);
      }
      if (header.bitDepth !== 8 || ![2, 6].includes(header.colorType) ||
        header.compression !== 0 || header.filter !== 0 || header.interlace !== 0) {
        throw new Error(`Unsupported asset PNG encoding: actual=${JSON.stringify(header)} expected=8-bit RGB/RGBA, non-interlaced`);
      }
    } else if (type === 'IHDR') {
      throw new Error('PNG contains a duplicate IHDR chunk');
    }

    if (type === 'IDAT') idat.push(data);
    if (type === 'sRGB') {
      if (sawSrgb || sawIccp) throw new Error(`PNG has duplicate/conflicting color profile chunks: actual=${JSON.stringify(chunks)}`);
      if (length !== 1 || data[0] > 3) {
        throw new Error(`PNG sRGB chunk is invalid: actual=${data.toString('hex')}`);
      }
      sawSrgb = true;
      profile = { kind: 'sRGB', renderingIntent: data[0] };
    }
    if (type === 'iCCP') {
      if (sawSrgb || sawIccp) throw new Error(`PNG has duplicate/conflicting color profile chunks: actual=${JSON.stringify(chunks)}`);
      const separator = data.indexOf(0);
      if (separator < 1 || separator > 79 || separator + 2 > data.length || data[separator + 1] !== 0) {
        throw new Error(`PNG iCCP chunk is invalid: nameLength=${separator} bytes=${data.length}`);
      }
      const name = data.toString('latin1', 0, separator);
      const icc = inflateSync(data.subarray(separator + 2), { maxOutputLength: 16 * 1024 * 1024 });
      const declaredLength = icc.length >= 4 ? icc.readUInt32BE(0) : 0;
      const signature = icc.length >= 40 ? icc.toString('ascii', 36, 40) : '';
      const colorSpace = icc.length >= 20 ? icc.toString('ascii', 16, 20) : '';
      if (icc.length < 128 || declaredLength !== icc.length || signature !== 'acsp' || colorSpace !== 'RGB ') {
        throw new Error(`PNG ICC profile is invalid: ${JSON.stringify({ name, bytes: icc.length, declaredLength, signature, colorSpace })}`);
      }
      profile = {
        kind: 'iCCP',
        name,
        sha256: createHash('sha256').update(icc).digest('hex'),
      };
      sawIccp = true;
    }

    offset = chunkEnd;
    if (type === 'IEND') {
      if (length !== 0 || offset !== buffer.length) {
        throw new Error(`PNG IEND must be empty and end the file: length=${length} end=${offset} bytes=${buffer.length}`);
      }
      sawEnd = true;
      break;
    }
  }

  if (!header || !sawEnd || idat.length === 0) {
    throw new Error(`PNG is missing required chunks: header=${Boolean(header)} IDAT=${idat.length} IEND=${sawEnd}`);
  }

  const channels = header.colorType === 6 ? 4 : 3;
  const bytesPerRow = header.width * channels;
  const expectedInflatedLength = header.height * (bytesPerRow + 1);
  const inflated = inflateSync(Buffer.concat(idat), { maxOutputLength: expectedInflatedLength });
  if (inflated.length !== expectedInflatedLength) {
    throw new Error(`PNG decoded byte count mismatch: actual=${inflated.length} expected=${expectedInflatedLength} dimensions=${header.width}x${header.height}`);
  }

  const pixels = Buffer.alloc(header.height * bytesPerRow);
  let transparentPixels = 0;
  let partialAlphaPixels = 0;
  let opaquePixels = 0;
  let minX = header.width;
  let minY = header.height;
  let maxX = -1;
  let maxY = -1;
  let firstPixel;
  let uniformColor = true;

  for (let y = 0; y < header.height; y += 1) {
    const sourceRow = y * (bytesPerRow + 1);
    const filterType = inflated[sourceRow];
    if (filterType > 4) throw new Error(`PNG row filter is invalid: row=${y} filter=${filterType}`);
    const targetRow = y * bytesPerRow;
    for (let index = 0; index < bytesPerRow; index += 1) {
      const left = index >= channels ? pixels[targetRow + index - channels] : 0;
      const above = y > 0 ? pixels[targetRow - bytesPerRow + index] : 0;
      const upperLeft = y > 0 && index >= channels ? pixels[targetRow - bytesPerRow + index - channels] : 0;
      let predictor = 0;
      if (filterType === 1) predictor = left;
      else if (filterType === 2) predictor = above;
      else if (filterType === 3) predictor = Math.floor((left + above) / 2);
      else if (filterType === 4) predictor = paeth(left, above, upperLeft);
      pixels[targetRow + index] = (inflated[sourceRow + 1 + index] + predictor) & 0xff;
    }

    for (let x = 0; x < header.width; x += 1) {
      const pixelOffset = targetRow + x * channels;
      const alpha = channels === 4 ? pixels[pixelOffset + 3] : 255;
      if (alpha === 0) transparentPixels += 1;
      else {
        if (alpha < 255) partialAlphaPixels += 1;
        else opaquePixels += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }

      const color = [
        pixels[pixelOffset],
        pixels[pixelOffset + 1],
        pixels[pixelOffset + 2],
        alpha,
      ];
      if (!firstPixel) firstPixel = color;
      else if (color.some((value, component) => value !== firstPixel[component])) uniformColor = false;
    }
  }

  const rgba = Buffer.alloc(header.width * header.height * 4);
  for (let pixel = 0; pixel < header.width * header.height; pixel += 1) {
    const source = pixel * channels;
    const target = pixel * 4;
    rgba[target] = pixels[source];
    rgba[target + 1] = pixels[source + 1];
    rgba[target + 2] = pixels[source + 2];
    rgba[target + 3] = channels === 4 ? pixels[source + 3] : 255;
  }

  return {
    width: header.width,
    height: header.height,
    bytes: buffer.length,
    bitDepth: header.bitDepth,
    colorType: header.colorType,
    chunks,
    alpha: {
      transparentPixels,
      partialAlphaPixels,
      opaquePixels,
      bounds: maxX < 0 ? null : { left: minX, top: minY, right: maxX, bottom: maxY },
    },
    profile,
    firstPixel,
    uniformColor,
    rgba,
  };
}

export function inspectPng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 45 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('File is not a complete PNG');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let sawHeader = false;
  let sawEnd = false;

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > buffer.length) throw new Error(`PNG chunk ${type} exceeds file length`);

    if (!sawHeader) {
      if (type !== 'IHDR' || length !== 13) throw new Error('PNG must begin with a 13-byte IHDR chunk');
      width = buffer.readUInt32BE(offset + 8);
      height = buffer.readUInt32BE(offset + 12);
      if (width < 1 || height < 1) throw new Error('PNG dimensions must be positive');
      sawHeader = true;
    }

    offset = end;
    if (type === 'IEND') {
      if (length !== 0 || offset !== buffer.length) throw new Error('PNG IEND must be empty and end the file');
      sawEnd = true;
      break;
    }
  }

  if (!sawHeader || !sawEnd) throw new Error('PNG is missing IHDR or IEND');
  return { width, height, bytes: buffer.length };
}

export function validatePng(buffer, expected = {}) {
  const metadata = inspectPng(buffer);
  for (const dimension of ['width', 'height']) {
    if (expected[dimension] !== undefined && metadata[dimension] !== expected[dimension]) {
      throw new Error(`PNG ${dimension} is ${metadata[dimension]}, expected ${expected[dimension]}`);
    }
  }
  return metadata;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--file' || arg === '--width' || arg === '--height') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      const key = arg.slice(2);
      options[key] = key === 'file' ? value : Number(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.file) throw new Error('--file is required');
  for (const dimension of ['width', 'height']) {
    if (options[dimension] !== undefined && (!Number.isSafeInteger(options[dimension]) || options[dimension] < 1)) {
      throw new Error(`--${dimension} must be a positive integer`);
    }
  }
  return options;
}

async function main(argv) {
  const options = parseArgs(argv);
  const metadata = validatePng(await readFile(options.file), options);
  console.log(JSON.stringify({ file: options.file, ...metadata }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`brand validate: ${error.message}`);
    process.exitCode = 1;
  });
}
