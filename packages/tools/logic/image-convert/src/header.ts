/**
 * What a file's header says without decoding a pixel (docs/tools/specs/image-convert.md §5.2): its size — the bound on
 * pixels is checked against it before anything is decoded — and the facts the page notes: animation, possible
 * transparency, 16 bits, CMYK, EXIF orientation, the images of an ICO. Only the head of the file is read (HEAD_BYTES);
 * every walk is bounded by it and moves forward, so a hostile header cannot make it loop.
 */
import { ftypBrands, u16be, u16le, u32be, u32le } from './sniff';
import type { HeaderFacts, ImageKind, Size } from './types';

const ascii = (b: Uint8Array, at: number, text: string): boolean =>
  b.length >= at + text.length && [...text].every((c, i) => b[at + i] === c.charCodeAt(0));
const indexOfAscii = (b: Uint8Array, text: string, from = 0): number => {
  const first = text.charCodeAt(0);
  for (let i = b.indexOf(first, from); i !== -1 && i + text.length <= b.length; i = b.indexOf(first, i + 1))
    if (ascii(b, i, text)) return i;
  return -1;
};

const facts = (partial: Partial<HeaderFacts>): HeaderFacts => ({
  size: null,
  animated: false,
  mayHaveAlpha: false,
  bitDepth16: false,
  cmyk: false,
  orientation: 1,
  icoImages: 0,
  ...partial,
});

const sized = (width: number, height: number): Size | null =>
  width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height) ? { width, height } : null;

const png = (b: Uint8Array): HeaderFacts => {
  const size = b.length >= 24 ? sized(u32be(b, 16), u32be(b, 20)) : null;
  const depth = b[24] ?? 0;
  const colour = b[25] ?? 0;
  let animated = false;
  let alpha = colour === 4 || colour === 6;
  // Chunks up to the first IDAT: acTL (APNG) must come before it, tRNS too.
  for (let at = 8; at + 8 <= b.length;) {
    const length = u32be(b, at);
    if (ascii(b, at + 4, 'IDAT') || ascii(b, at + 4, 'IEND')) break;
    if (ascii(b, at + 4, 'acTL')) animated = true;
    if (ascii(b, at + 4, 'tRNS')) alpha = true;
    const next = at + 12 + length;
    if (next <= at) break;
    at = next;
  }
  return facts({ size, animated, mayHaveAlpha: alpha, bitDepth16: depth === 16 });
};

const gif = (b: Uint8Array): HeaderFacts => {
  const size = b.length >= 10 ? sized(u16le(b, 6), u16le(b, 8)) : null;
  let at = 13;
  const flags = b[10] ?? 0;
  if (flags & 0x80) at += 3 * (1 << ((flags & 7) + 1));
  let frames = 0;
  let alpha = false;
  const skipSubBlocks = (from: number): number => {
    let i = from;
    while (i < b.length && b[i] !== 0) i += b[i]! + 1;
    return i + 1;
  };
  while (at < b.length && frames < 2) {
    const block = b[at];
    if (block === 0x21) {
      if (b[at + 1] === 0xf9 && ((b[at + 3] ?? 0) & 1) === 1) alpha = true;
      at = skipSubBlocks(at + 2);
    } else if (block === 0x2c) {
      frames++;
      const local = b[at + 9] ?? 0;
      at += 10;
      if (local & 0x80) at += 3 * (1 << ((local & 7) + 1));
      at = skipSubBlocks(at + 1);
    } else break;
  }
  return facts({ size, animated: frames >= 2, mayHaveAlpha: alpha });
};

const webp = (b: Uint8Array): HeaderFacts => {
  if (ascii(b, 12, 'VP8 ')) return facts({ size: sized(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff) });
  if (ascii(b, 12, 'VP8L')) {
    const bits = u32le(b, 21);
    return facts({
      size: sized((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1),
      mayHaveAlpha: ((bits >>> 28) & 1) === 1,
    });
  }
  if (ascii(b, 12, 'VP8X')) {
    const flags = b[20] ?? 0;
    const w = ((b[24] ?? 0) | ((b[25] ?? 0) << 8) | ((b[26] ?? 0) << 16)) + 1;
    const h = ((b[27] ?? 0) | ((b[28] ?? 0) << 8) | ((b[29] ?? 0) << 16)) + 1;
    return facts({ size: sized(w, h), animated: (flags & 0x02) !== 0, mayHaveAlpha: (flags & 0x10) !== 0 });
  }
  return facts({});
};

const bmp = (b: Uint8Array): HeaderFacts => {
  const header = u32le(b, 14);
  if (header === 12) return facts({ size: sized(u16le(b, 18), u16le(b, 20)) });
  const height = u32le(b, 22) | 0;
  return facts({ size: sized(u32le(b, 18) | 0, Math.abs(height)), mayHaveAlpha: u16le(b, 28) === 32 });
};

const ico = (b: Uint8Array): HeaderFacts => {
  const count = u16le(b, 4);
  let best: Size | null = null;
  for (let i = 0; i < count && 6 + i * 16 + 16 <= b.length; i++) {
    const at = 6 + i * 16;
    const w = b[at] || 256;
    const h = b[at + 1] || 256;
    if (!best || w * h > best.width * best.height) best = { width: w, height: h };
  }
  return facts({ size: best, mayHaveAlpha: true, icoImages: count });
};

const avif = (b: Uint8Array): HeaderFacts => {
  // The first `ispe` property: size, 'ispe', version and flags, width, height.
  const at = indexOfAscii(b, 'ispe');
  const size = at >= 4 && at + 16 <= b.length ? sized(u32be(b, at + 8), u32be(b, at + 12)) : null;
  return facts({ size, mayHaveAlpha: indexOfAscii(b, 'auxC') !== -1, animated: (ftypBrands(b) ?? [])[0] === 'avis' });
};

/** EXIF orientation from a TIFF structure (the body of an APP1 `Exif\0\0` segment), 1 when absent or unreadable. */
const exifOrientation = (b: Uint8Array, start: number, end: number): number => {
  const little = ascii(b, start, 'II');
  if (!little && !ascii(b, start, 'MM')) return 1;
  const u16 = (at: number) => (little ? u16le(b, at) : u16be(b, at));
  const u32 = (at: number) => (little ? u32le(b, at) : u32be(b, at));
  if (u16(start + 2) !== 42) return 1;
  const ifd = start + u32(start + 4);
  if (ifd + 2 > end) return 1;
  const entries = u16(ifd);
  for (let i = 0; i < entries; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) break;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
};

const jpeg = (b: Uint8Array): HeaderFacts => {
  let size: Size | null = null;
  let cmyk = false;
  let orientation = 1;
  let at = 2;
  while (at + 4 <= b.length) {
    if (b[at] !== 0xff) break;
    let marker = b[at + 1]!;
    // Fill bytes: any number of 0xFF before a marker.
    while (marker === 0xff && at + 2 < b.length) {
      at++;
      marker = b[at + 1]!;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break;
    const length = u16be(b, at + 2);
    if (length < 2) break;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof && at + 10 <= b.length) {
      size = sized(u16be(b, at + 7), u16be(b, at + 5));
      cmyk = b[at + 9] === 4;
      break;
    }
    if (marker === 0xe1 && ascii(b, at + 4, 'Exif\0\0'))
      orientation = exifOrientation(b, at + 10, Math.min(b.length, at + 2 + length));
    at += 2 + length;
  }
  return facts({ size, cmyk, orientation });
};

const READERS: Record<ImageKind, (head: Uint8Array) => HeaderFacts> = {
  png,
  gif,
  webp,
  bmp,
  ico,
  avif,
  jpeg,
  // An SVG's size is read from its text (svg.ts); as a drawing it may leave anything transparent.
  svg: () => facts({ mayHaveAlpha: true }),
};

export const readHeader = (head: Uint8Array, kind: ImageKind): HeaderFacts => READERS[kind](head);

/** The size a picture shows at once its EXIF orientation is applied (5–8 turn it a quarter). */
export const orientedSize = (size: Size, orientation: number): Size =>
  orientation >= 5 ? { width: size.height, height: size.width } : size;
