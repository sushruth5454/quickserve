// Deterministic tests for photo handling: only JPEG/PNG accepted; GPS/EXIF/XMP/comments/text chunks and trailers are
// removed; the colour profile, image data and orientation survive; corrupt files are rejected.
import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { ImageFormatError, orientationSegment, readExifOrientation, sniffImage, stripImageMetadata } from "./image.ts";

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const seg = (marker: number, payload: Uint8Array) => cat(Uint8Array.of(0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff), payload);
const has = (hay: Uint8Array, needle: Uint8Array) => {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
};

/** Little-endian EXIF with Orientation=6 plus a GPS-looking ASCII value (stand-in for real GPS IFD data). */
function exifApp1(orientation: number): Uint8Array {
  const tiff = cat(
    ascii("II"),
    Uint8Array.of(0x2a, 0, 8, 0, 0, 0), // IFD0 at 8
    Uint8Array.of(2, 0), // 2 entries
    Uint8Array.of(0x12, 0x01, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0), // Orientation
    Uint8Array.of(0x25, 0x88, 4, 0, 1, 0, 0, 0, 0, 0, 0, 0), // GPSInfo pointer (value unused here)
    Uint8Array.of(0, 0, 0, 0),
    ascii("GPS 16.5062N 80.6480E Pixel 9 owner Ramesh"),
  );
  return seg(0xe1, cat(ascii("Exif\0\0"), tiff));
}

const SOI = Uint8Array.of(0xff, 0xd8);
const EOI = Uint8Array.of(0xff, 0xd9);
const app0 = seg(0xe0, cat(ascii("JFIF\0"), Uint8Array.of(1, 1, 0, 0, 1, 0, 1, 0, 0)));
const icc = seg(0xe2, cat(ascii("ICC_PROFILE\0"), Uint8Array.of(1, 1, 9, 9, 9)));
const xmp = seg(0xe1, ascii("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>photoshop:City Vijayawada</x:xmpmeta>"));
const iptc = seg(0xed, ascii("Photoshop 3.0\0 caption"));
const comment = seg(0xfe, ascii("shot at 12 MG Road"));
const dqt = seg(0xdb, Uint8Array.of(0, 1, 2, 3, 4));
const sof = seg(0xc0, Uint8Array.of(8, 0, 16, 0, 16, 1, 1, 0x11, 0));
const scan = cat(seg(0xda, Uint8Array.of(1, 1, 0, 0, 0x3f, 0)), Uint8Array.of(0x12, 0x34, 0xff, 0x00, 0x56)); // entropy data with stuffed 0xFF00
// Motion-photo style trailer that itself contains FF D9 bytes: must still be dropped entirely.
const trailer = cat(ascii("ftypmp42 motion-photo"), Uint8Array.of(0xff, 0xd9), ascii("-video-with-gps"));

Deno.test("sniff: JPEG and PNG only", () => {
  assertEquals(sniffImage(cat(SOI, Uint8Array.of(0xff, 0xe0))), "image/jpeg");
  assertEquals(sniffImage(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0)), "image/png");
  assertEquals(sniffImage(ascii("GIF89a......")), null);
  assertEquals(sniffImage(ascii("RIFF....WEBPVP8 ")), null);
  assertEquals(sniffImage(new Uint8Array()), null);
});

Deno.test("JPEG: GPS/EXIF/XMP/IPTC/comment and post-EOI trailer removed; ICC, tables, scan data kept; orientation preserved", () => {
  const input = cat(SOI, app0, exifApp1(6), icc, xmp, iptc, comment, dqt, sof, scan, EOI, trailer);
  const { bytes, removed } = stripImageMetadata(input, "image/jpeg");
  for (const secret of ["GPS 16.5062N", "Ramesh", "Vijayawada", "MG Road", "caption", "motion-photo", "video-with-gps"]) assert(!has(bytes, ascii(secret)), `${secret} leaked`);
  assertEquals(removed, ["EXIF", "APP1", "APP13", "COM", "trailer"]);
  for (const kept of [app0, icc, dqt, sof, scan]) assert(has(bytes, kept));
  assertEquals([...bytes.subarray(0, 2)], [0xff, 0xd8]);
  assertEquals([...bytes.subarray(-2)], [0xff, 0xd9]);
  // Minimal orientation-only EXIF, placed right after JFIF.
  const app1At = 2 + app0.length;
  assertEquals([bytes[app1At], bytes[app1At + 1]], [0xff, 0xe1]);
  assertEquals(readExifOrientation(bytes.subarray(app1At + 4, app1At + 4 + 32)), 6);
});

Deno.test("JPEG: upright photos get no EXIF at all; orientation segment round-trips", () => {
  const { bytes } = stripImageMetadata(cat(SOI, exifApp1(1), dqt, sof, scan, EOI), "image/jpeg");
  assert(!has(bytes, ascii("Exif")));
  for (let o = 1; o <= 8; o++) assertEquals(readExifOrientation(orientationSegment(o).subarray(4)), o);
});

Deno.test("JPEG: corrupt files are rejected", () => {
  assertThrows(() => stripImageMetadata(cat(SOI, Uint8Array.of(0xff, 0xe1, 0xff, 0xff, 1, 2)), "image/jpeg"), ImageFormatError);
  assertThrows(() => stripImageMetadata(cat(SOI, app0, dqt), "image/jpeg"), ImageFormatError); // no image data
  assertThrows(() => stripImageMetadata(cat(SOI, Uint8Array.of(0x00, 0x00)), "image/jpeg"), ImageFormatError);
});

const chunk = (type: string, data: Uint8Array) => {
  const len = data.length;
  return cat(Uint8Array.of(len >>> 24, (len >> 16) & 255, (len >> 8) & 255, len & 255), ascii(type), data, Uint8Array.of(0, 0, 0, 0));
};
const PNG_SIG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

Deno.test("PNG: text/EXIF/time chunks and trailer removed; image chunks kept", () => {
  const ihdr = chunk("IHDR", new Uint8Array(13));
  const idat = chunk("IDAT", Uint8Array.of(9, 8, 7));
  const input = cat(
    PNG_SIG,
    ihdr,
    chunk("tEXt", ascii("Author\0Ramesh")),
    chunk("eXIf", ascii("GPS 16.5N")),
    chunk("iTXt", ascii("Location\0Benz Circle")),
    chunk("tIME", new Uint8Array(7)),
    idat,
    chunk("IEND", new Uint8Array()),
    ascii("junk"),
  );
  const { bytes, removed } = stripImageMetadata(input, "image/png");
  assertEquals(removed, ["tEXt", "eXIf", "iTXt", "tIME", "trailer"]);
  for (const secret of ["Ramesh", "GPS", "Benz"]) assert(!has(bytes, ascii(secret)));
  assert(has(bytes, ihdr) && has(bytes, idat));
  assertThrows(() => stripImageMetadata(cat(PNG_SIG, ihdr), "image/png"), ImageFormatError); // no IEND
});
