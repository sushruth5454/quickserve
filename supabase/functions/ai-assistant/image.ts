// Diagnosis photos: format sniffing and metadata stripping, done server-side before the image is stored or sent to the
// model, so GPS location, device/owner details, timestamps and embedded thumbnails never leave the customer's phone
// for good. Only JPEG and PNG are accepted (the app converts camera/library picks to JPEG).

export type ImageMime = "image/jpeg" | "image/png";

export class ImageFormatError extends Error {}

export function sniffImage(b: Uint8Array): ImageMime | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length > 8 && png.every((v, i) => b[i] === v)) return "image/png";
  return null;
}

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const startsWith = (b: Uint8Array, prefix: Uint8Array) => b.length >= prefix.length && prefix.every((v, i) => b[i] === v);
const EXIF = ascii("Exif\0\0");
const ICC = ascii("ICC_PROFILE\0");

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** EXIF Orientation (tag 0x0112 in IFD0), 1-8, or null. `app1` is the APP1 payload starting with "Exif\0\0". */
export function readExifOrientation(app1: Uint8Array): number | null {
  if (!startsWith(app1, EXIF)) return null;
  const t = app1.subarray(6);
  if (t.length < 8) return null;
  const le = t[0] === 0x49 && t[1] === 0x49;
  if (!le && !(t[0] === 0x4d && t[1] === 0x4d)) return null;
  const u16 = (o: number) => (le ? t[o]! | (t[o + 1]! << 8) : (t[o]! << 8) | t[o + 1]!);
  const u32 = (o: number) => (le ? (t[o]! | (t[o + 1]! << 8) | (t[o + 2]! << 16)) + t[o + 3]! * 2 ** 24 : t[o]! * 2 ** 24 + ((t[o + 1]! << 16) | (t[o + 2]! << 8) | t[o + 3]!));
  const ifd = u32(4);
  if (ifd + 2 > t.length) return null;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > t.length) break;
    if (u16(e) === 0x0112) {
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : null;
    }
  }
  return null;
}

/** A complete APP1 segment holding only the Orientation tag (big-endian TIFF). */
export function orientationSegment(orientation: number): Uint8Array {
  const body = concat([
    EXIF,
    Uint8Array.of(0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8), // "MM", 42, IFD0 at offset 8
    Uint8Array.of(0, 1), // one entry
    Uint8Array.of(0x01, 0x12, 0x00, 0x03, 0, 0, 0, 1, 0, orientation, 0, 0), // Orientation, SHORT, count 1, value
    Uint8Array.of(0, 0, 0, 0), // no next IFD
  ]);
  const len = body.length + 2;
  return concat([Uint8Array.of(0xff, 0xe1, len >> 8, len & 0xff), body]);
}

function stripJpeg(b: Uint8Array): { bytes: Uint8Array; removed: string[] } {
  const kept: Uint8Array[] = [];
  const removed: string[] = [];
  let orientation: number | null = null;
  let pos = 2;
  let sawScan = false;
  let ended = false;
  while (pos < b.length) {
    if (b[pos] !== 0xff) throw new ImageFormatError("Corrupt JPEG marker.");
    while (b[pos + 1] === 0xff) pos++; // fill bytes
    const m = b[pos + 1];
    if (m == null) throw new ImageFormatError("Truncated JPEG.");
    if (m === 0xd9) {
      kept.push(Uint8Array.of(0xff, 0xd9));
      pos += 2;
      ended = true;
      break;
    }
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) {
      kept.push(b.subarray(pos, pos + 2));
      pos += 2;
      continue;
    }
    if (pos + 4 > b.length) throw new ImageFormatError("Truncated JPEG segment.");
    const len = (b[pos + 2]! << 8) | b[pos + 3]!;
    if (len < 2 || pos + 2 + len > b.length) throw new ImageFormatError("Corrupt JPEG segment length.");
    const seg = b.subarray(pos, pos + 2 + len);
    const data = b.subarray(pos + 4, pos + 2 + len);
    if (m === 0xe1) {
      orientation = readExifOrientation(data) ?? orientation;
      removed.push(startsWith(data, EXIF) ? "EXIF" : "APP1");
    } else if (m === 0xe2 && startsWith(data, ICC)) {
      kept.push(seg); // colour profile: no personal data, needed to render colours correctly
    } else if (m >= 0xe2 && m <= 0xef && m !== 0xee) {
      removed.push(`APP${m - 0xe0}`);
    } else if (m === 0xfe) {
      removed.push("COM");
    } else {
      kept.push(seg); // APP0 (JFIF), APP14 (Adobe colour transform), tables, frame and scan headers
    }
    pos += 2 + len;
    if (m === 0xda) {
      // Entropy-coded data runs until the next real marker (0xFF followed by anything except 0x00 stuffing,
      // restart markers or fill bytes). Walking it, instead of searching for the last FFD9, means bytes after the
      // real end-of-image (motion-photo video, maker trailers) can never be mistaken for image data.
      sawScan = true;
      const start = pos;
      while (pos < b.length) {
        if (b[pos] === 0xff) {
          const nx = b[pos + 1];
          if (nx === 0x00 || (nx != null && nx >= 0xd0 && nx <= 0xd7)) {
            pos += 2;
            continue;
          }
          if (nx === 0xff) {
            pos++;
            continue;
          }
          break;
        }
        pos++;
      }
      kept.push(b.subarray(start, pos));
    }
  }
  if (!sawScan) throw new ImageFormatError("JPEG has no image data.");
  if (!ended) kept.push(Uint8Array.of(0xff, 0xd9)); // truncated after the scan: close it so decoders accept it
  if (pos < b.length) removed.push("trailer");
  if (orientation && orientation !== 1) {
    const firstIsApp0 = kept[0] && kept[0][1] === 0xe0;
    kept.splice(firstIsApp0 ? 1 : 0, 0, orientationSegment(orientation));
  }
  return { bytes: concat([Uint8Array.of(0xff, 0xd8), ...kept]), removed };
}

const PNG_DROP = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME"]);

function stripPng(b: Uint8Array): { bytes: Uint8Array; removed: string[] } {
  const kept: Uint8Array[] = [b.subarray(0, 8)];
  const removed: string[] = [];
  let pos = 8;
  let ended = false;
  while (pos + 12 <= b.length) {
    const len = b[pos]! * 2 ** 24 + ((b[pos + 1]! << 16) | (b[pos + 2]! << 8) | b[pos + 3]!);
    const type = String.fromCharCode(b[pos + 4]!, b[pos + 5]!, b[pos + 6]!, b[pos + 7]!);
    const total = 12 + len;
    if (pos + total > b.length) throw new ImageFormatError("Corrupt PNG chunk.");
    if (PNG_DROP.has(type)) removed.push(type);
    else kept.push(b.subarray(pos, pos + total));
    pos += total;
    if (type === "IEND") {
      ended = true;
      break;
    }
  }
  if (!ended) throw new ImageFormatError("PNG has no end chunk.");
  if (pos < b.length) removed.push("trailer");
  return { bytes: concat(kept), removed };
}

/** Removes location/device/text metadata. Throws ImageFormatError for corrupt files. */
export function stripImageMetadata(b: Uint8Array, mime: ImageMime): { bytes: Uint8Array; removed: string[] } {
  return mime === "image/jpeg" ? stripJpeg(b) : stripPng(b);
}
