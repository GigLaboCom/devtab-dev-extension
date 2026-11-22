import {
  HEAD_BYTES,
  MAX_FILE_BYTES,
  crc32,
  formatBytes,
  halvingSteps,
  icoDib,
  iconFiles,
  iconMarkup,
  inspectHead,
  inspectSvg,
  looksLikeSvgText,
  outputName,
  parseWhole,
  planSize,
  ratioText,
  readHeader,
  readIcoDirectory,
  sniffImage,
  svgActiveContent,
  svgSize,
  uniqueNames,
  writeIco,
  zipParts,
} from './logic';
import {
  APNG_8X4,
  AVIF_8X8,
  BMP_8X8,
  GIF_8X8,
  GIF_ANIMATED_8X4,
  HEIC_8X8,
  ICO_8X8,
  JPEG_8X8,
  JPEG_CMYK_8X8,
  PNG16_8X8,
  PNG_8X8,
  TIFF_8X8,
  WEBP_ALPHA_8X4,
  WEBP_ANIMATED_8X4,
  WEBP_LOSSLESS_8X4,
  WEBP_LOSSY_8X8,
  bytes,
} from './testing/fixtures';
import { concat, jpegHeader, pngChunk, pngHeader } from './testing/headers';
import { describe, expect, it } from 'vitest';
import type { ResizeOptions } from './logic';

const enc = (text: string) => new TextEncoder().encode(text);
const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0').toUpperCase()).join(' ');

const OPTIONS: ResizeOptions = { mode: 'original', width: 0, height: 0, percent: 100, fit: 'contain', enlarge: false };
const plan = (w: number, h: number, o: Partial<ResizeOptions>, vector = false) =>
  planSize({ width: w, height: h }, { ...OPTIONS, ...o }, vector);

describe('CRC-32 and the store-only .zip (§10, APPNOTE 6.3 §4.3)', () => {
  it('has the check value of CRC-32/ISO-HDLC', () => {
    expect(crc32(enc('123456789'))).toBe(0xcbf43926);
    expect(crc32(enc('hello'))).toBe(0x3610a686);
    expect(crc32(enc('lo'), crc32(enc('hel')))).toBe(0x3610a686);
  });

  it('writes a.txt = hello as 113 bytes with every header field', () => {
    const at = new Date(2026, 10, 22, 12, 0, 0);
    const zip = concat(...zipParts([{ name: 'a.txt', data: enc('hello') }], at));
    expect(zip.length).toBe(113);
    const v = new DataView(zip.buffer);
    // the local header
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(v.getUint16(4, true)).toBe(20);
    expect(v.getUint16(6, true)).toBe(0);
    expect(v.getUint16(8, true)).toBe(0);
    expect(v.getUint16(10, true)).toBe(12 << 11);
    expect(v.getUint16(12, true)).toBe(((2026 - 1980) << 9) | (11 << 5) | 22);
    expect(hex(zip.subarray(14, 18))).toBe('86 A6 10 36');
    expect(v.getUint32(18, true)).toBe(5);
    expect(v.getUint32(22, true)).toBe(5);
    expect(v.getUint16(26, true)).toBe(5);
    expect(v.getUint16(28, true)).toBe(0);
    expect(new TextDecoder().decode(zip.subarray(30, 40))).toBe('a.txthello');
    // the central directory entry at 40
    expect(v.getUint32(40, true)).toBe(0x02014b50);
    expect(v.getUint32(40 + 16, true)).toBe(0x3610a686);
    expect(v.getUint32(40 + 42, true)).toBe(0);
    expect(new TextDecoder().decode(zip.subarray(86, 91))).toBe('a.txt');
    // the end of the central directory at 91
    expect(v.getUint32(91, true)).toBe(0x06054b50);
    expect(v.getUint16(91 + 8, true)).toBe(1);
    expect(v.getUint16(91 + 10, true)).toBe(1);
    expect(v.getUint32(91 + 12, true)).toBe(51);
    expect(v.getUint32(91 + 16, true)).toBe(40);
  });

  it('flags a non-ASCII name as UTF-8 (bit 11) in both headers, and keeps the files’ bytes as parts', () => {
    const data = new Uint8Array([1, 2, 3]);
    const parts = zipParts([{ name: 'значок.png', data }], new Date(2026, 0, 1));
    expect(parts[1]).toBe(data);
    const zip = concat(...parts);
    const v = new DataView(zip.buffer);
    expect(v.getUint16(6, true)).toBe(0x0800);
    const central = 30 + enc('значок.png').length + 3;
    expect(v.getUint16(central + 8, true)).toBe(0x0800);
  });

  it('offsets each local header after the previous file', () => {
    const zip = concat(
      ...zipParts(
        [
          { name: 'a', data: new Uint8Array(10) },
          { name: 'bb', data: new Uint8Array(7) },
        ],
        new Date(2026, 0, 1),
      ),
    );
    const v = new DataView(zip.buffer);
    const centralStart = v.getUint32(zip.length - 22 + 16, true);
    expect(centralStart).toBe(31 + 10 + 32 + 7);
    expect(v.getUint32(centralStart + 42, true)).toBe(0);
    expect(v.getUint32(centralStart + 47 + 42, true)).toBe(41);
  });
});

describe('.ico (§5.7, §10)', () => {
  it('writes the directory of two PNG images byte by byte', () => {
    const a = new Uint8Array(100).fill(1);
    const b = new Uint8Array(200).fill(2);
    const ico = writeIco([
      { size: 32, data: b },
      { size: 16, data: a },
    ]);
    expect(ico.length).toBe(338);
    expect(hex(ico.subarray(0, 6))).toBe('00 00 01 00 02 00');
    expect(hex(ico.subarray(6, 22))).toBe('10 10 00 00 01 00 20 00 64 00 00 00 26 00 00 00');
    expect(hex(ico.subarray(22, 38))).toBe('20 20 00 00 01 00 20 00 C8 00 00 00 8A 00 00 00');
    expect(ico[38]).toBe(1);
    expect(ico[138]).toBe(2);
  });

  it('writes 256 as 0 and reads its own directory back', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
    const ico = writeIco([{ size: 256, data: png }]);
    expect(hex(ico.subarray(6, 8))).toBe('00 00');
    expect(readIcoDirectory(ico)).toEqual([{ size: 256, bytes: 9, offset: 22, png: true }]);
    expect(readIcoDirectory(new Uint8Array([0, 0, 2, 0, 1, 0]))).toBeNull();
  });

  it('refuses an empty list and sizes outside 1–256', () => {
    expect(() => writeIco([])).toThrow();
    expect(() => writeIco([{ size: 257, data: new Uint8Array(1) }])).toThrow();
  });

  it('writes a 1 × 1 DIB as 48 bytes: header, BGRA, mask', () => {
    const dib = icoDib(new Uint8Array([255, 0, 0, 255]), 1);
    expect(dib.length).toBe(48);
    const v = new DataView(dib.buffer);
    expect(v.getUint32(0, true)).toBe(40);
    expect(v.getInt32(4, true)).toBe(1);
    expect(v.getInt32(8, true)).toBe(2);
    expect(v.getUint16(12, true)).toBe(1);
    expect(v.getUint16(14, true)).toBe(32);
    expect(v.getUint32(16, true)).toBe(0);
    expect(v.getUint32(20, true)).toBe(8);
    expect(hex(dib.subarray(40, 44))).toBe('00 00 FF FF');
    expect(hex(dib.subarray(44, 48))).toBe('00 00 00 00');
  });

  it('writes rows bottom up and marks fully transparent pixels in the mask', () => {
    // 2 × 2: (0, 0) transparent, the rest opaque grey levels
    const rgba = new Uint8Array([0, 0, 0, 0, 10, 10, 10, 255, 20, 20, 20, 255, 30, 30, 30, 255]);
    const dib = icoDib(rgba, 2);
    // the first stored row is y = 1: pixels (0, 1) and (1, 1)
    expect(dib[40]).toBe(20);
    expect(dib[44]).toBe(30);
    // the top row (y = 0) is the second stored row
    expect(dib[48 + 3]).toBe(0);
    const mask = 40 + 16;
    expect(hex(dib.subarray(mask, mask + 4))).toBe('00 00 00 00');
    expect(hex(dib.subarray(mask + 4, mask + 8))).toBe('80 00 00 00');
  });
});

describe('types from the first bytes (§5.2)', () => {
  it.each([
    [PNG_8X8, 'png'],
    [GIF_8X8, 'gif'],
    [BMP_8X8, 'bmp'],
    [ICO_8X8, 'ico'],
    [AVIF_8X8, 'avif'],
    [WEBP_LOSSY_8X8, 'webp'],
    [JPEG_8X8, 'jpeg'],
    [JPEG_CMYK_8X8, 'jpeg'],
  ])('recognises a real file as %#', (b64, kind) => {
    const sniffed = sniffImage(bytes(b64));
    expect(sniffed.ok && sniffed.type.kind).toBe(kind);
  });

  it('names TIFF and HEIC, and refuses the rest', () => {
    expect(sniffImage(bytes(TIFF_8X8))).toEqual({
      ok: false,
      message: 'TIFF images cannot be decoded by Chrome; this tool does not accept them.',
    });
    expect(sniffImage(bytes(HEIC_8X8))).toEqual({
      ok: false,
      message: 'HEIC images cannot be decoded by Chrome; this tool does not accept them.',
    });
    for (const text of ['%PDF-1.7', 'hello', '', 'BM not a bitmap header'])
      expect(sniffImage(enc(text))).toEqual({
        ok: false,
        message: 'Not an image this tool reads: PNG, JPEG, WebP, GIF, BMP, ICO, AVIF or SVG.',
      });
  });

  it('recognises an SVG by its root element after a prolog, never by a mention of <svg', () => {
    expect(looksLikeSvgText('<svg xmlns="http://www.w3.org/2000/svg"/>')).toBe(true);
    expect(looksLikeSvgText('\u{FEFF}<?xml version="1.0"?>\n<!-- c --><!DOCTYPE svg [ <!ENTITY a "b"> ]>\n<svg>')).toBe(
      true,
    );
    expect(looksLikeSvgText('<html><svg></svg></html>')).toBe(false);
    expect(looksLikeSvgText('<svgfoo>')).toBe(false);
    expect(sniffImage(enc('<svg width="1" height="1"></svg>')).ok).toBe(true);
  });
});

describe('header facts (§5.2, §10)', () => {
  const head = (b64: string, kind: Parameters<typeof readHeader>[1]) => readHeader(bytes(b64), kind);

  it('reads the size of every format', () => {
    for (const [b64, kind] of [
      [PNG_8X8, 'png'],
      [GIF_8X8, 'gif'],
      [BMP_8X8, 'bmp'],
      [ICO_8X8, 'ico'],
      [AVIF_8X8, 'avif'],
      [WEBP_LOSSY_8X8, 'webp'],
      [JPEG_8X8, 'jpeg'],
      [JPEG_CMYK_8X8, 'jpeg'],
    ] as const)
      expect(head(b64, kind).size).toEqual({ width: 8, height: 8 });
    expect(head(WEBP_LOSSLESS_8X4, 'webp').size).toEqual({ width: 8, height: 4 });
    expect(head(WEBP_ALPHA_8X4, 'webp').size).toEqual({ width: 8, height: 4 });
    expect(readHeader(pngHeader(3, 2), 'png').size).toEqual({ width: 3, height: 2 });
  });

  it('says animated for APNG, a GIF of two frames and an animated WebP — not for still ones', () => {
    expect(head(APNG_8X4, 'png').animated).toBe(true);
    expect(head(GIF_ANIMATED_8X4, 'gif').animated).toBe(true);
    expect(head(WEBP_ANIMATED_8X4, 'webp').animated).toBe(true);
    expect(head(PNG_8X8, 'png').animated).toBe(false);
    expect(head(GIF_8X8, 'gif').animated).toBe(false);
    expect(head(WEBP_LOSSY_8X8, 'webp').animated).toBe(false);
  });

  it('says 16 bits, CMYK and possible transparency', () => {
    expect(head(PNG16_8X8, 'png').bitDepth16).toBe(true);
    expect(head(PNG_8X8, 'png').bitDepth16).toBe(false);
    expect(head(JPEG_CMYK_8X8, 'jpeg').cmyk).toBe(true);
    expect(head(JPEG_8X8, 'jpeg').cmyk).toBe(false);
    expect(head(WEBP_ALPHA_8X4, 'webp').mayHaveAlpha).toBe(true);
    expect(head(WEBP_LOSSY_8X8, 'webp').mayHaveAlpha).toBe(false);
    expect(readHeader(pngHeader(1, 1, 8, 2), 'png').mayHaveAlpha).toBe(false);
    expect(readHeader(pngHeader(1, 1, 8, 2, [pngChunk('tRNS', new Uint8Array(6))]), 'png').mayHaveAlpha).toBe(true);
    expect(readHeader(pngHeader(1, 1, 8, 6), 'png').mayHaveAlpha).toBe(true);
  });

  it('reads the EXIF orientation of a JPEG in both byte orders', () => {
    expect(readHeader(jpegHeader(40, 20, 3, 6, 'MM'), 'jpeg')).toMatchObject({
      orientation: 6,
      size: { width: 40, height: 20 },
    });
    expect(readHeader(jpegHeader(40, 20, 3, 8, 'II'), 'jpeg').orientation).toBe(8);
    expect(readHeader(jpegHeader(40, 20, 3), 'jpeg').orientation).toBe(1);
    expect(readHeader(jpegHeader(40, 20, 3, 9), 'jpeg').orientation).toBe(1);
    expect(readHeader(jpegHeader(40, 20, 4), 'jpeg').cmyk).toBe(true);
  });

  it('survives truncated and hostile headers without looping', () => {
    for (const kind of ['png', 'gif', 'webp', 'bmp', 'ico', 'avif', 'jpeg'] as const)
      for (const b64 of [PNG_8X8, GIF_8X8, JPEG_8X8, ICO_8X8])
        for (const cut of [0, 3, 9, 17, 30]) expect(() => readHeader(bytes(b64).subarray(0, cut), kind)).not.toThrow();
    // a chunk length that wraps round, and a JPEG segment of length 0
    const loop = pngHeader(1, 1, 8, 6, [new Uint8Array([0xff, 0xff, 0xff, 0xf4, 0x61, 0x62, 0x63, 0x64])]);
    expect(readHeader(loop, 'png').size).toEqual({ width: 1, height: 1 });
    expect(readHeader(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]), 'jpeg').size).toBeNull();
  });
});

describe('inspecting a source (§5.2, §6)', () => {
  it('refuses a header claiming 30,000 × 30,000 before decoding', () => {
    expect(inspectHead(pngHeader(30000, 30000), 40_000)).toMatchObject({
      ok: false,
      message:
        'The image says it is 30,000 × 30,000 pixels (900 megapixels), more than the 100 megapixels this tool decodes.',
    });
    expect(inspectHead(pngHeader(10000, 10000), 40_000).ok).toBe(true);
    expect(inspectHead(pngHeader(10000, 10001), 40_000).ok).toBe(false);
  });

  it('refuses a file over 256 MiB by its size, and a raster with no size in its header', () => {
    expect(inspectHead(pngHeader(1, 1), MAX_FILE_BYTES + 1)).toEqual({
      ok: false,
      message: 'The file is 268,435,457 bytes (256.0 MiB). This tool reads images up to 256 MiB.',
    });
    const noIspe = bytes(AVIF_8X8);
    const at = Buffer.from(noIspe).indexOf('ispe');
    noIspe.set(enc('xxxx'), at);
    expect(inspectHead(noIspe, noIspe.length)).toMatchObject({
      ok: false,
      message: 'The image’s size could not be read from its header, so it is not decoded.',
    });
  });

  it('turns the size of an EXIF-rotated JPEG upright and notes it', () => {
    expect(inspectHead(jpegHeader(40, 20, 3, 6), 1000)).toMatchObject({
      ok: true,
      size: { width: 20, height: 40 },
      notes: ['EXIF orientation 6: turned upright; the result carries no orientation.'],
    });
  });

  it('notes animation, 16 bits and CMYK', () => {
    expect(inspectHead(bytes(APNG_8X4), 400)).toMatchObject({
      notes: ['Animated image: only the first frame is converted.'],
    });
    expect(inspectHead(bytes(PNG16_8X8), 400)).toMatchObject({
      notes: ['16-bit PNG: converted to 8 bits per channel.'],
    });
    expect(inspectHead(bytes(JPEG_CMYK_8X8), 400)).toMatchObject({ notes: ['CMYK JPEG: converted to RGB.'] });
  });

  it('finds a JPEG’s SOF after a large APP segment within the head it reads', () => {
    const app = new Uint8Array(4 + 60_000);
    app.set([0xff, 0xe2, (60_002 >> 8) & 0xff, 60_002 & 0xff]);
    const file = concat(new Uint8Array([0xff, 0xd8]), app, jpegHeader(640, 480).subarray(2));
    expect(file.length).toBeLessThan(HEAD_BYTES);
    expect(readHeader(file, 'jpeg').size).toEqual({ width: 640, height: 480 });
  });
});

describe('SVG (§5.6, §10)', () => {
  it.each([
    ['<svg width="24" height="24" viewBox="0 0 24 24">', { width: 24, height: 24 }, 'attributes'],
    ['<svg viewBox="0 0 40 10">', { width: 40, height: 10 }, 'viewBox'],
    ['<svg xmlns="http://www.w3.org/2000/svg">', { width: 300, height: 150 }, 'default'],
    ['<svg width="10mm" height="1in">', { width: 38, height: 96 }, 'attributes'],
    ['<svg width="48" viewBox="0 0 24 12">', { width: 48, height: 24 }, 'attributes'],
    ['<svg width="100%" height="100%" viewBox="0,0,64,32">', { width: 64, height: 32 }, 'viewBox'],
    ["<svg height='20px' viewBox='0 0 30 10'>", { width: 60, height: 20 }, 'attributes'],
    ['<svg width="2em" height="0" viewBox="0 0 0 10">', { width: 300, height: 150 }, 'default'],
    ['<svg width="0.4" height="0.4">', { width: 1, height: 1 }, 'attributes'],
  ])('%s', (text, size, source) => {
    expect(svgSize(text)).toMatchObject({ size, source });
  });

  it('takes the root element’s attributes only', () => {
    expect(svgSize('<svg viewBox="0 0 8 4"><svg width="99" height="99"/></svg>').size).toEqual({ width: 8, height: 4 });
    expect(svgSize('<svg data-x="width=5" viewBox="0 0 8 4">').size).toEqual({ width: 8, height: 4 });
  });

  it('says when an SVG has active content, and when it cannot be rasterised', () => {
    expect(svgActiveContent('<svg><script>alert(1)</script></svg>')).toBe(true);
    expect(svgActiveContent('<svg onload="x()"></svg>')).toBe(true);
    expect(svgActiveContent('<svg><image href="https://example.com/a.png"/></svg>')).toBe(true);
    expect(svgActiveContent('<svg><style>@import url(a.css);</style></svg>')).toBe(true);
    expect(
      svgActiveContent('<svg><rect fill="url(#g)"/><use href="#a"/><image href="data:image/png;base64,AA"/></svg>'),
    ).toBe(false);
    expect(inspectSvg('<svg><foreignObject width="1" height="1"></foreignObject></svg>')).toEqual({
      ok: false,
      message: 'This SVG cannot be rasterised here: Chrome does not let a page read pixels drawn from a foreignObject.',
    });
    expect(inspectSvg('<svg viewBox="0 0 24 24"></svg>')).toEqual({
      ok: true,
      size: { width: 24, height: 24 },
      notes: ['This SVG has no width and height: its own size comes from its viewBox (24 × 24).'],
    });
    expect(inspectSvg('<svg></svg>')).toMatchObject({
      notes: [
        'This SVG has no size of its own: it is drawn at 300 × 150, as a browser would. Choose a size to draw it larger.',
      ],
    });
  });

  it('checks a megabyte of the worst input in one pass', () => {
    const worst = `<svg ${' on'.repeat(200_000)}${'a'.repeat(400_000)} href="${'x'.repeat(200_000)}`;
    const t0 = performance.now();
    svgActiveContent(worst);
    svgSize(worst);
    // A bound on the shape — a quadratic pass over a megabyte takes minutes — not on the machine's speed.
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});

describe('the size of a result (§5.5, §10)', () => {
  it('follows a width, a height, a percentage and the three fits', () => {
    expect(plan(4000, 3000, { mode: 'width', width: 1200 })).toMatchObject({ size: { width: 1200, height: 900 } });
    expect(plan(4000, 3000, { mode: 'height', height: 500 })).toMatchObject({ size: { width: 667, height: 500 } });
    expect(plan(4000, 3000, { mode: 'percent', percent: 25 })).toMatchObject({ size: { width: 1000, height: 750 } });
    const box = { mode: 'both', width: 1000, height: 1000 } as const;
    expect(plan(4000, 3000, { ...box, fit: 'contain' })).toMatchObject({
      size: { width: 1000, height: 750 },
      crop: null,
    });
    expect(plan(4000, 3000, { ...box, fit: 'cover' })).toMatchObject({
      size: { width: 1000, height: 1000 },
      crop: { x: 500, y: 0, width: 3000, height: 3000 },
    });
    expect(plan(4000, 3000, { ...box, fit: 'exact' })).toMatchObject({
      size: { width: 1000, height: 1000 },
      crop: null,
    });
    expect(plan(4000, 3000, {})).toMatchObject({ size: { width: 4000, height: 3000 }, enlarged: false });
  });

  it('never enlarges a raster silently', () => {
    expect(plan(800, 600, { mode: 'width', width: 1200 })).toEqual({
      ok: true,
      size: { width: 800, height: 600 },
      crop: null,
      enlarged: false,
      notEnlarged: true,
    });
    expect(plan(800, 600, { mode: 'width', width: 1200, enlarge: true })).toEqual({
      ok: true,
      size: { width: 1200, height: 900 },
      crop: null,
      enlarged: true,
      notEnlarged: false,
    });
    expect(plan(800, 600, { mode: 'both', width: 1000, height: 1000, fit: 'cover' })).toEqual({
      ok: true,
      size: { width: 600, height: 600 },
      crop: { x: 100, y: 0, width: 600, height: 600 },
      enlarged: false,
      notEnlarged: true,
    });
    expect(plan(800, 600, { mode: 'both', width: 400, height: 1000, fit: 'exact' })).toMatchObject({
      size: { width: 400, height: 600 },
      notEnlarged: true,
    });
    expect(plan(800, 600, { mode: 'percent', percent: 150 })).toMatchObject({
      size: { width: 800, height: 600 },
      notEnlarged: true,
    });
  });

  it('draws an SVG at any size: nothing is enlarged', () => {
    expect(plan(24, 24, { mode: 'width', width: 512 }, true)).toEqual({
      ok: true,
      size: { width: 512, height: 512 },
      crop: null,
      enlarged: false,
      notEnlarged: false,
    });
  });

  it('keeps at least one pixel, and stops at the canvas’s bounds', () => {
    expect(plan(1, 1, { mode: 'percent', percent: 1 })).toMatchObject({ size: { width: 1, height: 1 } });
    expect(plan(50000, 3000, { mode: 'percent', percent: 200, enlarge: true })).toEqual({
      ok: false,
      message:
        'The result would be 100,000 × 6,000 pixels, wider or taller than 65,535 pixels, the largest canvas Chrome makes.',
    });
    expect(plan(65535, 1, { mode: 'width', width: 65535 })).toMatchObject({ ok: true });
    expect(plan(10000, 10000, { mode: 'percent', percent: 101, enlarge: true })).toEqual({
      ok: false,
      message: 'The result would be 10,100 × 10,100 pixels, more than the 100 megapixels this tool makes.',
    });
  });

  it('halves down to the target, then one draw', () => {
    expect(halvingSteps({ width: 4096, height: 4096 }, { width: 16, height: 16 }).map(s => s.width)).toEqual([
      2048, 1024, 512, 256, 128, 64, 32, 16,
    ]);
    expect(halvingSteps({ width: 4000, height: 3000 }, { width: 1200, height: 900 })).toEqual([
      { width: 2000, height: 1500 },
    ]);
    expect(halvingSteps({ width: 100, height: 100 }, { width: 200, height: 200 })).toEqual([]);
  });

  it('reads whole numbers only', () => {
    expect(parseWhole(' 1200 ', 1, 65535)).toBe(1200);
    for (const text of ['', '0', '1.5', 'abc', '-3', '65536', '1e3']) expect(parseWhole(text, 1, 65535)).toBeNull();
  });
});

describe('icon sets (§5.8)', () => {
  it('lists the files of the chosen sets with the names convention expects', () => {
    expect(iconFiles(['favicon']).map(f => `${f.name}:${f.size}:${f.opaque}`)).toEqual([
      'favicon-16x16.png:16:false',
      'favicon-32x32.png:32:false',
      'apple-touch-icon.png:180:true',
    ]);
    expect(iconFiles(['pwa', 'extension']).map(f => f.name)).toEqual([
      'icon16.png',
      'icon32.png',
      'icon48.png',
      'icon128.png',
      'icon-192.png',
      'icon-512.png',
    ]);
  });

  it('writes the markup that names them', () => {
    expect(iconMarkup([16, 32], ['favicon'])).toBe(
      [
        '<link rel="icon" href="/favicon.ico" sizes="any">',
        '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">',
        '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">',
        '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
      ].join('\n'),
    );
    const manifest = iconMarkup([], ['extension', 'pwa']);
    expect(JSON.parse(`{${manifest.split('\n\n')[0]}}`)).toEqual({
      icons: { '16': 'icon16.png', '32': 'icon32.png', '48': 'icon48.png', '128': 'icon128.png' },
    });
    expect(JSON.parse(`{${manifest.split('\n\n')[1]}}`).icons[1]).toEqual({
      src: 'icon-512.png',
      sizes: '512x512',
      type: 'image/png',
    });
    expect(iconMarkup([], [])).toBe('');
  });
});

describe('names and numbers (§5.4, §5.10, §10)', () => {
  it('names results after their sources', () => {
    expect(outputName('screen.png', 'webp')).toBe('screen.webp');
    expect(outputName('a.b.JPG', 'png')).toBe('a.b.png');
    expect(outputName('  .  ', 'jpeg')).toBe('image.jpg');
    expect(outputName('re:port*?.png', 'png')).toBe('re_port__.png');
    expect(outputName('.hidden', 'png')).toBe('hidden.png');
  });

  it('numbers repeats', () => {
    expect(uniqueNames(['a.png', 'a.png', 'A.png', 'b.png'])).toEqual(['a.png', 'a (2).png', 'A (3).png', 'b.png']);
  });

  it('writes sizes and ratios', () => {
    expect(formatBytes(96432)).toBe('96,432 bytes (94.2 KiB)');
    expect(formatBytes(1023)).toBe('1,023 bytes');
    expect(formatBytes(1)).toBe('1 byte');
    expect(formatBytes(3214000)).toBe('3,214,000 bytes (3.1 MiB)');
    expect(ratioText(96432, 3214000)).toBe('3% of the original');
    expect(ratioText(5, 1000)).toBe('<1% of the original');
    expect(ratioText(1120, 1000)).toBe('112% of the original');
  });
});
