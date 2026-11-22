/**
 * Test images (docs/tools/specs/base64-image.md §10): the specification's samples — a 3 × 2 picture of six flat colours,
 * invented — as Base64, and small encoders that make more in the tests (PNG with stored deflate blocks, BMP, GIF
 * headers, SVG text). Test code only: nothing here is exported by the package.
 */

/** `sample.png` (3 × 2, 78 bytes): red, green, blue / white, black, grey. */
export const SAMPLE_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAFUlEQVR4nGP4z8DAAMH//4PohoYGAEfPB3vT+rJCAAAAAElFTkSuQmCC';
/** `sample.gif` (3 × 2, 63 bytes), the same picture. */
export const SAMPLE_GIF = 'R0lGODdhAwACAKIAAAAAAAAA//8AAICAgAD/AP///wAAAAAAACH5BAQAAAAALAAAAAADAAIAAAMEKBQFkwA7';
/** `sample.bmp` (3 × 2, 78 bytes, top-down: height −2). */
export const SAMPLE_BMP =
  'Qk1OAAAAAAAAADYAAAAoAAAAAwAAAP7///8BABgAAAAAABIAAAAAAAAAAAAAAAAAAAAAAAAAAAD/AP8A/wAAAAAA////AAAAgICAAAAA';
/** `sample.jpeg` (3 × 2, 877 bytes), the same picture through a JPEG encoder. */
export const SAMPLE_JPEG =
  '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAA6ADAAQAAAABAAAAAgAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAgADAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A5jWPBPgzUPGXjd7/AEDT7lrbxX4mtIjLaxOY7az1i7t7eFNynbHDDGkUaD5URVVQFAAq/wDCu/h9/wBCxpf/AIBQf/EV2N7/AMjh49/7HPxd/wCn6+or+0PDz/kQZf8A9eaX/pET5/FfxZ+r/M//2Q==';
/** `sample.svg` (24 × 16 by its attributes, 131 bytes). */
export const SAMPLE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="16" viewBox="0 0 24 16"><rect width="24" height="16" fill="#08f"/></svg>';
/** `viewbox.svg` (100 × 50 by its viewBox, an XML declaration first). */
export const VIEWBOX_SVG =
  '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><circle cx="50" cy="25" r="20"/></svg>';

export const fromBase64 = (b64: string): Uint8Array => Uint8Array.from(Buffer.from(b64, 'base64'));
export const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
export const concat = (...parts: ArrayLike<number>[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
export const ascii = (text: string): number[] => Array.from(text, c => c.charCodeAt(0));

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const be32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le32 = (n: number): number[] => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const le16 = (n: number): number[] => [n & 255, (n >>> 8) & 255];

const pngChunk = (type: string, data: Uint8Array): Uint8Array => {
  const typed = concat(ascii(type), data);
  return concat(be32(data.length), typed, be32(crc32(typed)));
};

/** zlib with stored (uncompressed) blocks: what a PNG's IDAT needs, no compressor. */
const zlibStored = (raw: Uint8Array): Uint8Array => {
  const parts: ArrayLike<number>[] = [[0x78, 0x01]];
  for (let at = 0; at < raw.length || at === 0; at += 65535) {
    const block = raw.subarray(at, Math.min(at + 65535, raw.length));
    const last = at + 65535 >= raw.length ? 1 : 0;
    parts.push([last, ...le16(block.length), ...le16(~block.length & 0xffff)], block);
    if (raw.length === 0) break;
  }
  let a = 1;
  let b = 0;
  for (const x of raw) {
    a = (a + x) % 65521;
    b = (b + a) % 65521;
  }
  parts.push(be32(((b << 16) | a) >>> 0));
  return concat(...parts);
};

/** An 8-bit RGB PNG of `width` × `height` filled with one colour; `claim` writes other dimensions into IHDR. */
export const makePng = (
  width: number,
  height: number,
  rgb: [number, number, number] = [255, 0, 0],
  claim?: { width: number; height: number },
): Uint8Array => {
  const row = [0, ...Array.from({ length: width }, () => rgb).flat()];
  const raw = Uint8Array.from(Array.from({ length: height }, () => row).flat());
  const ihdr = concat(be32(claim?.width ?? width), be32(claim?.height ?? height), [8, 2, 0, 0, 0]);
  return concat(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlibStored(raw)),
    pngChunk('IEND', new Uint8Array(0)),
  );
};

/** A 24-bit BMP header of the given size (header size 40, or 12 for the core header) and no pixels. */
export const makeBmpHeader = (width: number, height: number, core = false): Uint8Array =>
  core
    ? concat(ascii('BM'), le32(26), le32(0), le32(26), le32(12), le16(width), le16(height), le16(1), le16(24))
    : concat(ascii('BM'), le32(54), le32(0), le32(54), le32(40), le32(width), le32(height), le16(1), le16(24));

/** A GIF header (logical screen of the given size) and a trailer. */
export const makeGifHeader = (width: number, height: number): Uint8Array =>
  concat(ascii('GIF89a'), le16(width), le16(height), [0, 0, 0, 0x3b]);

/** An ISO-BMFF `ftyp` box with a major brand and compatible ones (AVIF, HEIF). */
export const makeFtyp = (major: string, compatible: string[] = []): Uint8Array =>
  concat(be32(16 + compatible.length * 4), ascii('ftyp'), ascii(major), be32(0), ...compatible.map(ascii));

/** A seeded generator (mulberry32) for the property tests: the same inputs every run. */
export const seeded = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const randomBytes = (random: () => number, n: number): Uint8Array =>
  Uint8Array.from({ length: n }, () => Math.floor(random() * 256));
