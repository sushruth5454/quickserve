const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

export const BRANDING_PNG_HARD_LIMITS = {
  maxBytes: 2 * 1024 * 1024,
  minDimension: 32,
  maxDimension: 4096,
  maxPixels: 16_777_216,
} as const;

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const BIT_DEPTHS: Record<number, readonly number[]> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

export interface PngLimits {
  maxBytes: number;
  minDimension: number;
  maxDimension: number;
  maxPixels: number;
}

export interface ValidatedPng {
  bytes: Uint8Array;
  width: number;
  height: number;
}

export class PngValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PngValidationError";
  }
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]
  ) >>> 0;
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value >>> 24;
  bytes[offset + 1] = value >>> 16;
  bytes[offset + 2] = value >>> 8;
  bytes[offset + 3] = value;
}

function crcByte(crc: number, byte: number): number {
  crc ^= byte;
  for (let bit = 0; bit < 8; bit++) {
    crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return crc >>> 0;
}

function crc32(type: Uint8Array, data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of type) crc = crcByte(crc, byte);
  for (const byte of data) crc = crcByte(crc, byte);
  return (crc ^ 0xffffffff) >>> 0;
}

function isAsciiLetter(byte: number): boolean {
  return (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122);
}

function ceilDiv(value: number, divisor: number): number {
  return Math.floor((value + divisor - 1) / divisor);
}

function getPassDimensions(width: number, height: number, pass: typeof ADAM7[number]): [number, number] {
  const [xStart, yStart, xStep, yStep] = pass;
  return [
    width <= xStart ? 0 : ceilDiv(width - xStart, xStep),
    height <= yStart ? 0 : ceilDiv(height - yStart, yStep),
  ];
}

interface ImagePass {
  width: number;
  height: number;
  rowBytes: number;
  bytesPerPixel: number;
}

function imagePasses(width: number, height: number, bitDepth: number, colorType: number, interlace: number): ImagePass[] {
  const bitsPerPixel = CHANNELS[colorType] * bitDepth;
  const geometry = interlace === 0 ? [[0, 0, 1, 1] as const] : ADAM7;
  const passes: ImagePass[] = [];
  for (const pass of geometry) {
    const [passWidth, passHeight] = getPassDimensions(width, height, pass);
    if (passWidth === 0 || passHeight === 0) continue;
    passes.push({
      width: passWidth,
      height: passHeight,
      rowBytes: ceilDiv(passWidth * bitsPerPixel, 8),
      bytesPerPixel: Math.max(1, ceilDiv(bitsPerPixel, 8)),
    });
  }
  return passes;
}

function paeth(left: number, up: number, upperLeft: number): number {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

function unfilterRow(row: Uint8Array, previous: Uint8Array, bytesPerPixel: number, filter: number): void {
  for (let index = 0; index < row.length; index++) {
    const left = index >= bytesPerPixel ? row[index - bytesPerPixel] : 0;
    const up = previous[index] ?? 0;
    const upperLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel] ?? 0 : 0;
    let predictor = 0;
    if (filter === 1) predictor = left;
    else if (filter === 2) predictor = up;
    else if (filter === 3) predictor = Math.floor((left + up) / 2);
    else if (filter === 4) predictor = paeth(left, up, upperLeft);
    row[index] = (row[index] + predictor) & 0xff;
  }
}

function validatePaletteRow(row: Uint8Array, width: number, bitDepth: number, paletteEntries: number): void {
  if (bitDepth === 8) {
    for (let x = 0; x < width; x++) {
      if (row[x] >= paletteEntries) throw new PngValidationError("PNG palette index is out of range");
    }
    return;
  }
  const samplesPerByte = 8 / bitDepth;
  const mask = (1 << bitDepth) - 1;
  for (let x = 0; x < width; x++) {
    const shift = 8 - bitDepth * ((x % samplesPerByte) + 1);
    const paletteIndex = (row[Math.floor(x / samplesPerByte)] >>> shift) & mask;
    if (paletteIndex >= paletteEntries) throw new PngValidationError("PNG palette index is out of range");
  }
}

async function validateImageData(
  compressed: Uint8Array,
  passes: ImagePass[],
  bitDepth: number,
  colorType: number,
  paletteEntries: number,
): Promise<void> {
  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(compressed);
      controller.close();
    },
  });
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = input.pipeThrough(new DecompressionStream("deflate")).getReader();
  } catch {
    throw new PngValidationError("PNG image data is not a valid zlib stream");
  }

  const expectedBytes = passes.reduce((sum, pass) => sum + pass.height * (pass.rowBytes + 1), 0);
  let totalBytes = 0;
  let passIndex = 0;
  let rowIndex = 0;
  let rowOffset = 0;
  let filter = 0;
  let row = new Uint8Array(passes[0].rowBytes);
  let previous = new Uint8Array(passes[0].rowBytes);

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      let sourceOffset = 0;
      while (sourceOffset < value.length) {
        if (totalBytes >= expectedBytes || passIndex >= passes.length) {
          throw new PngValidationError("PNG image data has trailing decoded bytes");
        }
        const pass = passes[passIndex];
        const rowLength = pass.rowBytes + 1;
        const count = Math.min(rowLength - rowOffset, value.length - sourceOffset);
        if (rowOffset === 0) {
          filter = value[sourceOffset];
          if (filter > 4) throw new PngValidationError("PNG scanline uses an invalid filter");
        }
        const dataStart = Math.max(rowOffset, 1);
        const dataEnd = Math.min(rowOffset + count, rowLength);
        const dataLength = Math.max(0, dataEnd - dataStart);
        if (dataLength > 0) {
          const from = sourceOffset + dataStart - rowOffset;
          row.set(value.subarray(from, from + dataLength), dataStart - 1);
        }
        sourceOffset += count;
        rowOffset += count;
        totalBytes += count;

        if (rowOffset === rowLength) {
          unfilterRow(row, previous, pass.bytesPerPixel, filter);
          if (colorType === 3) validatePaletteRow(row, pass.width, bitDepth, paletteEntries);
          previous = row.slice();
          rowOffset = 0;
          rowIndex++;
          if (rowIndex === pass.height) {
            passIndex++;
            rowIndex = 0;
            if (passIndex < passes.length) {
              row = new Uint8Array(passes[passIndex].rowBytes);
              previous = new Uint8Array(passes[passIndex].rowBytes);
            }
          }
        }
      }
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof PngValidationError) throw error;
    throw new PngValidationError("PNG image data is incomplete or corrupt");
  } finally {
    reader.releaseLock();
  }
  if (totalBytes !== expectedBytes || passIndex !== passes.length || rowOffset !== 0) {
    throw new PngValidationError("PNG image data is truncated");
  }
}

function makeChunk(name: string, data: Uint8Array): Uint8Array {
  const type = new TextEncoder().encode(name);
  const chunk = new Uint8Array(12 + data.length);
  writeUint32(chunk, 0, data.length);
  chunk.set(type, 4);
  chunk.set(data, 8);
  writeUint32(chunk, 8 + data.length, crc32(type, data));
  return chunk;
}

function concatenate(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export async function validateAndStripPng(
  input: Uint8Array,
  limits: PngLimits = BRANDING_PNG_HARD_LIMITS,
): Promise<ValidatedPng> {
  if (!(input instanceof Uint8Array)) throw new PngValidationError("PNG body must be bytes");
  if (input.length < PNG_SIGNATURE.length + 25) throw new PngValidationError("PNG is truncated");
  if (input.length > limits.maxBytes || input.length > BRANDING_PNG_HARD_LIMITS.maxBytes) {
    throw new PngValidationError("PNG exceeds the upload size limit");
  }
  if (!PNG_SIGNATURE.every((byte, index) => input[index] === byte)) {
    throw new PngValidationError("PNG signature is invalid");
  }

  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = -1;
  let paletteEntries = 0;
  let palette: Uint8Array | undefined;
  let transparency: Uint8Array | undefined;
  let header: Uint8Array | undefined;
  let seenPalette = false;
  let seenTransparency = false;
  let seenImageData = false;
  let imageDataEnded = false;
  let seenEnd = false;
  let compressedLength = 0;
  const imageChunks: Uint8Array[] = [];

  while (offset < input.length) {
    if (input.length - offset < 12) throw new PngValidationError("PNG chunk header is truncated");
    const chunkLength = readUint32(input, offset);
    if (chunkLength > input.length - offset - 12) throw new PngValidationError("PNG chunk data is truncated");
    const typeBytes = input.subarray(offset + 4, offset + 8);
    if (!typeBytes.every(isAsciiLetter) || typeBytes[2] >= 97) {
      throw new PngValidationError("PNG chunk type is invalid");
    }
    const type = String.fromCharCode(...typeBytes);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLength;
    const data = input.subarray(dataStart, dataEnd);
    if (crc32(typeBytes, data) !== readUint32(input, dataEnd)) {
      throw new PngValidationError("PNG chunk CRC is invalid");
    }
    offset = dataEnd + 4;

    if (seenEnd) throw new PngValidationError("PNG has data after IEND");
    if (!header && type !== "IHDR") throw new PngValidationError("IHDR must be the first PNG chunk");
    if (type === "acTL" || type === "fcTL" || type === "fdAT") {
      throw new PngValidationError("Animated PNG is not supported");
    }
    if (seenImageData && type !== "IDAT" && type !== "IEND") imageDataEnded = true;

    if (type === "IHDR") {
      if (header || chunkLength !== 13) throw new PngValidationError("PNG IHDR is invalid");
      width = readUint32(data, 0);
      height = readUint32(data, 4);
      bitDepth = data[8];
      colorType = data[9];
      if (
        width < limits.minDimension ||
        height < limits.minDimension ||
        width > limits.maxDimension ||
        height > limits.maxDimension ||
        width > BRANDING_PNG_HARD_LIMITS.maxDimension ||
        height > BRANDING_PNG_HARD_LIMITS.maxDimension ||
        width * height > limits.maxPixels ||
        width * height > BRANDING_PNG_HARD_LIMITS.maxPixels
      ) {
        throw new PngValidationError("PNG dimensions exceed the allowed limits");
      }
      if (!BIT_DEPTHS[colorType]?.includes(bitDepth)) {
        throw new PngValidationError("PNG color type or bit depth is unsupported");
      }
      if (data[10] !== 0 || data[11] !== 0 || data[12] > 1) {
        throw new PngValidationError("PNG compression, filter, or interlace method is invalid");
      }
      interlace = data[12];
      header = data.slice();
    } else if (type === "PLTE") {
      if (!header || seenPalette || seenImageData || chunkLength === 0 || chunkLength > 768 || chunkLength % 3 !== 0) {
        throw new PngValidationError("PNG palette is invalid");
      }
      if (seenTransparency) throw new PngValidationError("PNG palette must precede transparency data");
      if (colorType === 0 || colorType === 4) throw new PngValidationError("PNG palette is not allowed for this color type");
      paletteEntries = chunkLength / 3;
      if (colorType === 3 && paletteEntries > 2 ** bitDepth) throw new PngValidationError("PNG palette is too large");
      seenPalette = true;
      palette = data.slice();
    } else if (type === "tRNS") {
      if (!header || seenTransparency || seenImageData) throw new PngValidationError("PNG transparency chunk is invalid");
      if (colorType === 0) {
        const sample = chunkLength === 2 ? (data[0] << 8) | data[1] : -1;
        if (chunkLength !== 2 || (bitDepth < 16 && sample > 2 ** bitDepth - 1)) {
          throw new PngValidationError("PNG grayscale transparency is invalid");
        }
      } else if (colorType === 2) {
        if (chunkLength !== 6) throw new PngValidationError("PNG truecolor transparency is invalid");
        const maxSample = bitDepth === 8 ? 0xff : 0xffff;
        for (let sample = 0; sample < 3; sample++) {
          const value = (data[sample * 2] << 8) | data[sample * 2 + 1];
          if (value > maxSample) throw new PngValidationError("PNG truecolor transparency sample is invalid");
        }
      } else if (colorType === 3) {
        if (!seenPalette || chunkLength === 0 || chunkLength > paletteEntries) {
          throw new PngValidationError("PNG palette transparency is invalid");
        }
      } else {
        throw new PngValidationError("PNG transparency is not valid for this color type");
      }
      seenTransparency = true;
      transparency = data.slice();
    } else if (type === "IDAT") {
      if (!header || imageDataEnded || (colorType === 3 && !seenPalette)) {
        throw new PngValidationError("PNG image data is out of order");
      }
      seenImageData = true;
      compressedLength += chunkLength;
      if (compressedLength > BRANDING_PNG_HARD_LIMITS.maxBytes) {
        throw new PngValidationError("PNG compressed image data is too large");
      }
      imageChunks.push(data.slice());
    } else if (type === "IEND") {
      if (!header || !seenImageData || chunkLength !== 0) throw new PngValidationError("PNG IEND is invalid");
      seenEnd = true;
    } else if ((typeBytes[0] & 0x20) === 0) {
      throw new PngValidationError(`Unsupported critical PNG chunk: ${type}`);
    }
  }

  if (!header || !seenImageData || !seenEnd || offset !== input.length) {
    throw new PngValidationError("PNG is missing a required chunk");
  }
  if (colorType === 3 && !seenPalette) throw new PngValidationError("Indexed PNG requires a palette");

  const compressed = concatenate(imageChunks);
  const passes = imagePasses(width, height, bitDepth, colorType, interlace);
  await validateImageData(compressed, passes, bitDepth, colorType, paletteEntries);

  const cleanBytes = concatenate([
    PNG_SIGNATURE,
    makeChunk("IHDR", header),
    ...(palette ? [makeChunk("PLTE", palette)] : []),
    ...(transparency ? [makeChunk("tRNS", transparency)] : []),
    makeChunk("IDAT", compressed),
    makeChunk("IEND", new Uint8Array()),
  ]);
  if (cleanBytes.length > limits.maxBytes || cleanBytes.length > BRANDING_PNG_HARD_LIMITS.maxBytes) {
    throw new PngValidationError("PNG exceeds the upload size limit after metadata removal");
  }
  return { bytes: cleanBytes, width, height };
}
