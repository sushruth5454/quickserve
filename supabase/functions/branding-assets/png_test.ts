import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { deflateSync } from "node:zlib";
import { PngValidationError, validateAndStripPng } from "./png.ts";

const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  return crc >>> 0;
});

function crc32(type: Uint8Array, data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of type) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function write32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value >>> 24;
  target[offset + 1] = value >>> 16;
  target[offset + 2] = value >>> 8;
  target[offset + 3] = value;
}

function join(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function chunk(name: string, data: Uint8Array): Uint8Array {
  const type = new TextEncoder().encode(name);
  const result = new Uint8Array(data.length + 12);
  write32(result, 0, data.length);
  result.set(type, 4);
  result.set(data, 8);
  write32(result, 8 + data.length, crc32(type, data));
  return result;
}

function rawImage(
  width: number,
  height: number,
  bitDepth = 8,
  colorType = 6,
  interlace = 0,
  firstRowByte?: number,
): Uint8Array {
  const passes = interlace === 0
    ? [[0, 0, 1, 1] as const]
    : [
      [0, 0, 8, 8],
      [4, 0, 8, 8],
      [0, 4, 4, 8],
      [2, 0, 4, 4],
      [0, 2, 2, 4],
      [1, 0, 2, 2],
      [0, 1, 1, 2],
    ];
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  const rawRows: Uint8Array[] = [];
  for (const [xStart, yStart, xStep, yStep] of passes) {
    const passWidth = width <= xStart ? 0 : Math.ceil((width - xStart) / xStep);
    const passHeight = height <= yStart ? 0 : Math.ceil((height - yStart) / yStep);
    if (passWidth === 0 || passHeight === 0) continue;
    const rowBytes = Math.ceil(passWidth * channels * bitDepth / 8);
    for (let y = 0; y < passHeight; y++) {
      const row = new Uint8Array(rowBytes + 1);
      if (firstRowByte !== undefined && rawRows.length === 0 && rowBytes > 0) row[1] = firstRowByte;
      rawRows.push(row);
    }
  }
  return join(rawRows);
}

interface FixtureOptions {
  width?: number;
  height?: number;
  bitDepth?: number;
  colorType?: number;
  interlace?: number;
  raw?: Uint8Array;
  beforeData?: Array<[string, Uint8Array]>;
  afterData?: Array<[string, Uint8Array]>;
  palette?: Uint8Array;
  transparency?: Uint8Array;
  animated?: boolean;
}

function png(options: FixtureOptions = {}): Uint8Array {
  const width = options.width ?? 32;
  const height = options.height ?? 32;
  const bitDepth = options.bitDepth ?? 8;
  const colorType = options.colorType ?? 6;
  const interlace = options.interlace ?? 0;
  const ihdr = new Uint8Array(13);
  write32(ihdr, 0, width);
  write32(ihdr, 4, height);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  ihdr[12] = interlace;
  const chunks = [chunk("IHDR", ihdr)];
  if (options.palette) chunks.push(chunk("PLTE", options.palette));
  if (options.transparency) chunks.push(chunk("tRNS", options.transparency));
  for (const [name, data] of options.beforeData ?? []) chunks.push(chunk(name, data));
  if (options.animated) chunks.push(chunk("acTL", new Uint8Array(8)));
  const raw = options.raw ?? rawImage(width, height, bitDepth, colorType, interlace);
  chunks.push(chunk("IDAT", new Uint8Array(deflateSync(raw))));
  for (const [name, data] of options.afterData ?? []) chunks.push(chunk(name, data));
  chunks.push(chunk("IEND", new Uint8Array()));
  return join([signature, ...chunks]);
}

function chunkNames(bytes: Uint8Array): string[] {
  const names: string[] = [];
  let offset = signature.length;
  while (offset < bytes.length) {
    const length = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
    names.push(String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)));
    offset += length + 12;
  }
  return names;
}

Deno.test("PNG parser validates complete static RGBA and Adam7 image streams", async () => {
  for (const interlace of [0, 1]) {
    const result = await validateAndStripPng(png({ interlace }));
    assertEquals([result.width, result.height], [32, 32]);
    assertEquals(chunkNames(result.bytes), ["IHDR", "IDAT", "IEND"]);
  }
});

Deno.test("PNG parser preserves transparency while stripping text and ancillary metadata", async () => {
  const result = await validateAndStripPng(png({
    colorType: 3,
    bitDepth: 2,
    palette: new Uint8Array([0, 0, 0, 255, 255, 255]),
    transparency: new Uint8Array([0, 255]),
    beforeData: [["tEXt", new TextEncoder().encode("Comment\0private metadata")]],
    afterData: [["pHYs", new Uint8Array(9)]],
  }));
  assertEquals(chunkNames(result.bytes), ["IHDR", "PLTE", "tRNS", "IDAT", "IEND"]);
  assertEquals(new TextDecoder().decode(result.bytes).includes("private metadata"), false);
  assertEquals([result.width, result.height], [32, 32]);
});

Deno.test("PNG parser rejects CRC errors, truncated containers, trailing bytes, and short image streams", async () => {
  const valid = png();
  const badCrc = valid.slice();
  badCrc[29] ^= 1;
  await assertRejects(() => validateAndStripPng(badCrc), PngValidationError, "CRC");
  await assertRejects(
    () => validateAndStripPng(valid.subarray(0, valid.length - 4)),
    PngValidationError,
    "truncated",
  );
  await assertRejects(() => validateAndStripPng(join([valid, new Uint8Array([0])])), PngValidationError);
  await assertRejects(() => validateAndStripPng(png({ raw: new Uint8Array([0]) })), PngValidationError, "truncated");
});

Deno.test("PNG parser rejects invalid filters, palette indexes, ordering, and unknown critical chunks", async () => {
  const badFilter = rawImage(32, 32);
  badFilter[0] = 5;
  await assertRejects(
    () => validateAndStripPng(png({ raw: badFilter })),
    PngValidationError,
    "filter",
  );
  await assertRejects(
    () => validateAndStripPng(png({
      bitDepth: 1,
      colorType: 3,
      palette: new Uint8Array([0, 0, 0]),
      raw: rawImage(32, 32, 1, 3, 0, 0x80),
    })),
    PngValidationError,
    "palette index",
  );

  const header = png().subarray(16, 29);
  const idatData = new Uint8Array(deflateSync(rawImage(32, 32)));
  await assertRejects(
    () => validateAndStripPng(join([
      signature,
      chunk("IHDR", header),
      chunk("IDAT", idatData),
      chunk("tEXt", new TextEncoder().encode("x\0y")),
      chunk("IDAT", idatData),
      chunk("IEND", new Uint8Array()),
    ])),
    PngValidationError,
    "out of order",
  );
  await assertRejects(
    () => validateAndStripPng(png({ beforeData: [["ABCD", new Uint8Array()]] })),
    PngValidationError,
    "critical",
  );
});

Deno.test("PNG parser rejects animation, invalid headers, and soft or hard dimension ceilings", async () => {
  await assertRejects(() => validateAndStripPng(png({ animated: true })), PngValidationError, "Animated");
  await assertRejects(() => validateAndStripPng(new Uint8Array(80)), PngValidationError, "signature");
  await assertRejects(() => validateAndStripPng(png({ width: 4097, height: 32 })), PngValidationError, "dimensions");
  await assertRejects(
    () => validateAndStripPng(png({ width: 33, height: 32 }), {
      maxBytes: 2 * 1024 * 1024,
      minDimension: 32,
      maxDimension: 4096,
      maxPixels: 1024,
    }),
    PngValidationError,
    "dimensions",
  );
});
