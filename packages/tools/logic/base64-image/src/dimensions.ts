/**
 * An image's size in pixels from its header, without decoding it (docs/tools/specs/base64-image.md §5 «Размеры»). Bounded
 * reads: a truncated header is unknown (null), never an exception; the JPEG marker walk moves forward only and stops at
 * the first frame header or at the scan. AVIF's is its first `ispe` property; without one the component reads it from
 * the loaded preview. The size is what the file claims — the component decides from it whether a preview may be decoded at all.
 */
import { svgDimensions, svgText } from './svg';
import type { ImageMime } from './sniff';
import type { Dimensions } from './svg';

const u16be = (b: Uint8Array, i: number): number => (b[i]! << 8) | b[i + 1]!;
const u16le = (b: Uint8Array, i: number): number => b[i]! | (b[i + 1]! << 8);
const u24le = (b: Uint8Array, i: number): number => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const u32be = (b: Uint8Array, i: number): number =>
  ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
const u32le = (b: Uint8Array, i: number): number =>
  (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;
const i32le = (b: Uint8Array, i: number): number => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24);

const sized = (width: number, height: number): Dimensions | null =>
  width > 0 && height > 0 ? { width, height } : null;

const png = (b: Uint8Array): Dimensions | null =>
  b.length >= 24 && u32be(b, 12) === 0x49484452 /* IHDR */ ? sized(u32be(b, 16), u32be(b, 20)) : null;

const gif = (b: Uint8Array): Dimensions | null => (b.length >= 10 ? sized(u16le(b, 6), u16le(b, 8)) : null);

const bmp = (b: Uint8Array): Dimensions | null => {
  if (b.length < 26) return null;
  if (u32le(b, 14) === 12) return sized(u16le(b, 18), u16le(b, 20));
  return sized(Math.abs(i32le(b, 18)), Math.abs(i32le(b, 22)));
};

const ico = (b: Uint8Array): Dimensions | null => (b.length >= 8 ? { width: b[6] || 256, height: b[7] || 256 } : null);

const webp = (b: Uint8Array): Dimensions | null => {
  const chunk = String.fromCharCode(...b.subarray(12, 16));
  if (chunk === 'VP8 ' && b.length >= 30) return sized(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
  if (chunk === 'VP8L' && b.length >= 25) {
    const [b0, b1, b2, b3] = [b[21]!, b[22]!, b[23]!, b[24]!];
    return { width: (b0 | ((b1 & 0x3f) << 8)) + 1, height: ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10)) + 1 };
  }
  if (chunk === 'VP8X' && b.length >= 30) return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  return null;
};

/** Start-of-frame markers: C0–CF except C4 (DHT), C8 (JPG) and CC (DAC). */
const isSof = (m: number): boolean => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

const jpeg = (b: Uint8Array): Dimensions | null => {
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    // Fill bytes before a marker.
    while (i + 1 < b.length && b[i + 1] === 0xff) i++;
    const marker = b[i + 1]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda || i + 4 > b.length) return null;
    const length = u16be(b, i + 2);
    if (length < 2) return null;
    if (isSof(marker)) return i + 9 <= b.length ? sized(u16be(b, i + 7), u16be(b, i + 5)) : null;
    i += 2 + length;
  }
  return null;
};

/**
 * AVIF: the first `ispe` (image spatial extent) property — the primary image's size in files of one image (§15; the
 * specification leaves AVIF unknown until the preview loads). Looked for in the first 64 KiB only.
 */
const avif = (b: Uint8Array): Dimensions | null => {
  const end = Math.min(b.length, 65_536) - 16;
  for (let i = 4; i <= end; i++)
    if (b[i] === 0x69 && b[i + 1] === 0x73 && b[i + 2] === 0x70 && b[i + 3] === 0x65 && u32be(b, i - 4) === 20)
      return sized(u32be(b, i + 8), u32be(b, i + 12));
  return null;
};

const READERS: Readonly<Record<ImageMime, (bytes: Uint8Array) => Dimensions | null>> = {
  'image/png': png,
  'image/gif': gif,
  'image/bmp': bmp,
  'image/x-icon': ico,
  'image/webp': webp,
  'image/jpeg': jpeg,
  'image/svg+xml': bytes => svgDimensions(svgText(bytes)),
  'image/avif': avif,
};

/** The size the header gives, or null: unknown, truncated, or not in the header (an AVIF without `ispe`). */
export const imageDimensions = (bytes: Uint8Array, mime: ImageMime): Dimensions | null => READERS[mime](bytes);
