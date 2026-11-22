/**
 * A file's type from its first bytes (docs/tools/specs/image-convert.md §5.2) — never its name or `file.type`. The
 * rules are the WHATWG image type patterns, stricter where a text could pass for an image (BMP needs a known header
 * size, ICO a non-zero count, SVG a root `<svg>` element), plus AVIF; TIFF and HEIC are recognised and refused by name.
 */
import { looksLikeSvgText } from './svg';
import type { ImageKind, ImageType, SniffResult } from './types';

export const IMAGE_TYPES: Record<ImageKind, ImageType> = {
  png: { kind: 'png', name: 'PNG', mime: 'image/png', ext: 'png' },
  jpeg: { kind: 'jpeg', name: 'JPEG', mime: 'image/jpeg', ext: 'jpg' },
  gif: { kind: 'gif', name: 'GIF', mime: 'image/gif', ext: 'gif' },
  webp: { kind: 'webp', name: 'WebP', mime: 'image/webp', ext: 'webp' },
  bmp: { kind: 'bmp', name: 'BMP', mime: 'image/bmp', ext: 'bmp' },
  ico: { kind: 'ico', name: 'ICO', mime: 'image/x-icon', ext: 'ico' },
  avif: { kind: 'avif', name: 'AVIF', mime: 'image/avif', ext: 'avif' },
  svg: { kind: 'svg', name: 'SVG', mime: 'image/svg+xml', ext: 'svg' },
};

export const NOT_AN_IMAGE = 'Not an image this tool reads: PNG, JPEG, WebP, GIF, BMP, ICO, AVIF or SVG.';
export const notDecodable = (format: string): string =>
  `${format} images cannot be decoded by Chrome; this tool does not accept them.`;

const starts = (b: Uint8Array, at: number, bytes: readonly number[]): boolean =>
  b.length >= at + bytes.length && bytes.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, at: number, text: string): boolean =>
  b.length >= at + text.length && [...text].every((c, i) => b[at + i] === c.charCodeAt(0));
export const u16le = (b: Uint8Array, at: number): number => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
export const u32le = (b: Uint8Array, at: number): number => (u16le(b, at) | (u16le(b, at + 2) << 16)) >>> 0;
export const u16be = (b: Uint8Array, at: number): number => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
export const u32be = (b: Uint8Array, at: number): number => ((u16be(b, at) << 16) | u16be(b, at + 2)) >>> 0;

const BMP_HEADER_SIZES = new Set([12, 40, 52, 56, 64, 108, 124]);

/** ISO-BMFF `ftyp`: the major brand and the compatible ones, or null. */
export const ftypBrands = (b: Uint8Array): string[] | null => {
  if (!ascii(b, 4, 'ftyp')) return null;
  const size = Math.min(u32be(b, 0), b.length);
  if (size < 16) return null;
  const brand = (at: number) => String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);
  const brands = [brand(8)];
  for (let at = 16; at + 4 <= size; at += 4) brands.push(brand(at));
  return brands;
};

const AVIF_BRANDS = new Set(['avif', 'avis']);
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

const svgHead = (b: Uint8Array): boolean => {
  const head = b.subarray(0, 4096);
  const text = new TextDecoder('utf-8', { fatal: false }).decode(head);
  // A replacement character before the last three bytes means the head is not UTF-8.
  const bad = text.indexOf('\u{FFFD}');
  if (bad !== -1 && bad < text.length - 3) return false;
  return looksLikeSvgText(text);
};

export const sniffImage = (b: Uint8Array): SniffResult => {
  if ((starts(b, 0, [0, 0, 1, 0]) || starts(b, 0, [0, 0, 2, 0])) && u16le(b, 4) > 0)
    return { ok: true, type: IMAGE_TYPES.ico };
  if (ascii(b, 0, 'BM') && BMP_HEADER_SIZES.has(u32le(b, 14))) return { ok: true, type: IMAGE_TYPES.bmp };
  if (ascii(b, 0, 'GIF87a') || ascii(b, 0, 'GIF89a')) return { ok: true, type: IMAGE_TYPES.gif };
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBPVP')) return { ok: true, type: IMAGE_TYPES.webp };
  if (starts(b, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ok: true, type: IMAGE_TYPES.png };
  if (starts(b, 0, [0xff, 0xd8, 0xff])) return { ok: true, type: IMAGE_TYPES.jpeg };
  const brands = ftypBrands(b);
  if (brands) {
    const [major] = brands;
    if (AVIF_BRANDS.has(major!)) return { ok: true, type: IMAGE_TYPES.avif };
    if ((major === 'mif1' || major === 'msf1') && brands.some(x => AVIF_BRANDS.has(x)))
      return { ok: true, type: IMAGE_TYPES.avif };
    if (HEIF_BRANDS.has(major!)) return { ok: false, message: notDecodable('HEIC') };
  }
  if (starts(b, 0, [0x49, 0x49, 0x2a, 0x00]) || starts(b, 0, [0x4d, 0x4d, 0x00, 0x2a]))
    return { ok: false, message: notDecodable('TIFF') };
  if (svgHead(b)) return { ok: true, type: IMAGE_TYPES.svg };
  return { ok: false, message: NOT_AN_IMAGE };
};
