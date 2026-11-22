/**
 * What an image is, from its first bytes only (docs/tools/specs/base64-image.md §5 «Принимаемые типы и распознавание»):
 * the WHATWG MIME Sniffing «image type pattern matching» (§6.1) plus AVIF and SVG, in the specification's order. Never
 * the file's name, never the type the system reports, never the type a data: URI declares — a renamed file is
 * recognised by what it holds, or refused by name when Chrome cannot show it (TIFF, HEIC).
 *
 * Stricter than the bare patterns where a pattern alone takes text for an image (§15): BMP needs a known header size
 * after `BM`, ICO / CUR at least one entry, SVG its root element to be `<svg>` (after the XML declaration, comments, a
 * DOCTYPE and processing instructions) — "BMW…", a zero-filled file or an HTML page with an inline `<svg>` are not
 * images. An ISO-BMFF file of brand `mif1` / `msf1` is AVIF when it lists `avif` among its compatible brands, HEIF
 * otherwise.
 */

export type ImageMime =
  | 'image/png'
  | 'image/jpeg'
  | 'image/gif'
  | 'image/webp'
  | 'image/avif'
  | 'image/bmp'
  | 'image/x-icon'
  | 'image/svg+xml';

export interface ImageType {
  mime: ImageMime;
  /** 'PNG', 'JPEG', … */
  name: string;
  /** 'png', 'jpg', … */
  ext: string;
}

export type SniffResult = { ok: true; type: ImageType } | { ok: false; message: string };

export const IMAGE_TYPES: Readonly<Record<ImageMime, ImageType>> = {
  'image/x-icon': { mime: 'image/x-icon', name: 'ICO', ext: 'ico' },
  'image/bmp': { mime: 'image/bmp', name: 'BMP', ext: 'bmp' },
  'image/gif': { mime: 'image/gif', name: 'GIF', ext: 'gif' },
  'image/webp': { mime: 'image/webp', name: 'WebP', ext: 'webp' },
  'image/png': { mime: 'image/png', name: 'PNG', ext: 'png' },
  'image/jpeg': { mime: 'image/jpeg', name: 'JPEG', ext: 'jpg' },
  'image/avif': { mime: 'image/avif', name: 'AVIF', ext: 'avif' },
  'image/svg+xml': { mime: 'image/svg+xml', name: 'SVG', ext: 'svg' },
};

export const NOT_AN_IMAGE = 'not an image this tool recognises (PNG, JPEG, GIF, WebP, AVIF, BMP, ICO, SVG)';
export const unsupported = (format: string): string =>
  `${format} images cannot be shown by Chrome; this tool does not accept them.`;

/** How far into the file an SVG's root element is looked for. */
export const SVG_SNIFF_BYTES = 4096;

const at = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean =>
  bytes.length >= offset + signature.length && signature.every((b, i) => bytes[offset + i] === b);

const ascii = (text: string): number[] => Array.from(text, c => c.charCodeAt(0));

const u32be = (b: Uint8Array, i: number): number =>
  ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
const u32le = (b: Uint8Array, i: number): number =>
  (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;

/** Header sizes of the BMP versions (core, info, v2, v3, OS/2 2, v4, v5). */
const BMP_HEADERS = new Set([12, 40, 52, 56, 64, 108, 124]);

const isIco = (b: Uint8Array): boolean =>
  (at(b, [0, 0, 1, 0]) || at(b, [0, 0, 2, 0])) && b.length >= 6 && (b[4]! | (b[5]! << 8)) > 0;

const isBmp = (b: Uint8Array): boolean => at(b, [0x42, 0x4d]) && b.length >= 18 && BMP_HEADERS.has(u32le(b, 14));

/** The ISO-BMFF `ftyp` box: the major brand and the compatible ones (AVIF, HEIF). */
const brands = (b: Uint8Array): { major: string; compatible: string[] } | null => {
  if (!at(b, ascii('ftyp'), 4) || b.length < 12) return null;
  const text = (i: number) => String.fromCharCode(b[i]!, b[i + 1]!, b[i + 2]!, b[i + 3]!);
  const size = Math.min(u32be(b, 0), b.length, 4096);
  const compatible: string[] = [];
  for (let i = 16; i + 4 <= size; i += 4) compatible.push(text(i));
  return { major: text(8), compatible };
};

const AVIF_BRANDS = new Set(['avif', 'avis']);
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1']);

const isoBrand = (b: Uint8Array): 'avif' | 'heif' | null => {
  const found = brands(b);
  if (!found) return null;
  if (AVIF_BRANDS.has(found.major)) return 'avif';
  if (found.major === 'mif1' || found.major === 'msf1')
    return found.compatible.some(c => AVIF_BRANDS.has(c)) ? 'avif' : 'heif';
  return HEIF_BRANDS.has(found.major) ? 'heif' : null;
};

const isWhite = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';

/**
 * Where the root element of XML text starts: after white space, the XML declaration, processing instructions, comments
 * and a DOCTYPE (with its internal subset), or -1 when the text ends before one. Linear; never expands an entity.
 */
export const rootElementStart = (text: string): number => {
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (;;) {
    while (i < text.length && isWhite(text[i]!)) i++;
    if (text[i] !== '<') return -1;
    if (text.startsWith('<?', i)) {
      const end = text.indexOf('?>', i + 2);
      if (end < 0) return -1;
      i = end + 2;
    } else if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      if (end < 0) return -1;
      i = end + 3;
    } else if (text.startsWith('<!', i)) {
      // A DOCTYPE: up to its `>`, skipping a bracketed internal subset and quoted literals.
      let j = i + 2;
      let depth = 0;
      let quote = '';
      for (; j < text.length; j++) {
        const c = text[j]!;
        if (quote) {
          if (c === quote) quote = '';
        } else if (c === '"' || c === "'") quote = c;
        else if (c === '[') depth++;
        else if (c === ']') depth = Math.max(0, depth - 1);
        else if (c === '>' && depth === 0) break;
      }
      if (j >= text.length) return -1;
      i = j + 1;
    } else return i;
  }
};

/** Is the root element `svg` (followed by white space, `>` or `/`)? */
export const startsWithSvgRoot = (text: string): boolean => {
  const i = rootElementStart(text);
  if (i < 0 || !text.startsWith('<svg', i)) return false;
  const next = text[i + 4];
  return next !== undefined && (isWhite(next) || next === '>' || next === '/');
};

const isSvg = (b: Uint8Array): boolean => {
  const head = b.subarray(0, SVG_SNIFF_BYTES);
  let text: string;
  try {
    // A character cut at the window's end is not an error (stream).
    text = new TextDecoder('utf-8', { fatal: true }).decode(head, { stream: true });
  } catch {
    return false;
  }
  return startsWithSvgRoot(text);
};

/** The image type of these bytes, in the specification's order, or why they are refused. */
export const sniffImage = (bytes: Uint8Array): SniffResult => {
  const ok = (mime: ImageMime): SniffResult => ({ ok: true, type: IMAGE_TYPES[mime] });
  if (isIco(bytes)) return ok('image/x-icon');
  if (isBmp(bytes)) return ok('image/bmp');
  if (at(bytes, ascii('GIF87a')) || at(bytes, ascii('GIF89a'))) return ok('image/gif');
  if (at(bytes, ascii('RIFF')) && at(bytes, ascii('WEBPVP'), 8)) return ok('image/webp');
  if (at(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return ok('image/png');
  if (at(bytes, [0xff, 0xd8, 0xff])) return ok('image/jpeg');
  const iso = isoBrand(bytes);
  if (iso === 'avif') return ok('image/avif');
  if (isSvg(bytes)) return ok('image/svg+xml');
  if (at(bytes, [0x49, 0x49, 0x2a, 0x00]) || at(bytes, [0x4d, 0x4d, 0x00, 0x2a]))
    return { ok: false, message: unsupported('TIFF') };
  if (iso === 'heif') return { ok: false, message: unsupported('HEIC') };
  return { ok: false, message: NOT_AN_IMAGE };
};
