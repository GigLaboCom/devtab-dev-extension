import {
  ACTIVE_SVG_NOTE,
  ADDRESS,
  INPUT_TOO_LARGE,
  MAX_IMAGE_BYTES,
  MAX_INPUT_CHARS,
  NO_COMMA,
  NO_SRC,
  NOT_AN_IMAGE,
  base64Length,
  declaredMismatch,
  decodeImageInput,
  describeImage,
  detectBase64Image,
  encodeImage,
  fileTooLarge,
  formatOutput,
  formatSize,
  imageDimensions,
  imageTypeOf,
  parseImageInput,
  previewRefusal,
  sniffImage,
  svgHasActiveContent,
  toDataUri,
  truncatedNote,
} from './index';
import {
  SAMPLE_BMP,
  SAMPLE_GIF,
  SAMPLE_JPEG,
  SAMPLE_PNG,
  SAMPLE_SVG,
  VIEWBOX_SVG,
  ascii,
  concat,
  fromBase64,
  makeBmpHeader,
  makeFtyp,
  makeGifHeader,
  makePng,
  toBase64,
  utf8,
} from './testing/images';
import { bytesToBase64 } from '@workspace/tools-shared/base64';
import { GROWTH_BOUND, growth } from '@workspace/tools-shared/growth';
import { describe, expect, it } from 'vitest';
import type { DecodeImageResult, DecodedImage } from './index';

const png = fromBase64(SAMPLE_PNG);
const described = (bytes: Uint8Array): DecodedImage => {
  const r = describeImage(bytes);
  if (!r.ok) throw new Error(r.message);
  return r.image;
};
const decoded = (text: string): DecodedImage => {
  const r = decodeImageInput(text);
  if (!r.ok) throw new Error(r.error.message);
  if (!r.image) throw new Error('empty');
  return r.image;
};
const failed = (text: string): DecodeImageResult & { ok: false } => {
  const r = decodeImageInput(text);
  if (r.ok) throw new Error('decoded');
  return r;
};
const facts = (image: DecodedImage) => ({
  name: image.type.name,
  dimensions: image.dimensions,
  size: image.bytes.length,
  base64Length: base64Length(image.bytes.length),
});

// docs/tools/specs/base64-image.md §10, row by row (the row's number in the comment).
describe('§10 examples', () => {
  const image = described(png);
  it('1: sample.png, Encode, Base64 — 104 characters', () => {
    const out = formatOutput(bytesToBase64(png), image, 'base64', 0);
    expect(out).toBe(SAMPLE_PNG);
    expect(out).toHaveLength(104);
  });
  it('2: sample.png, Encode, Data URI', () => {
    expect(formatOutput(bytesToBase64(png), image, 'dataUri', 0)).toBe(`data:image/png;base64,${SAMPLE_PNG}`);
  });
  it('3: sample.png, Encode, HTML <img>', () => {
    expect(formatOutput(bytesToBase64(png), image, 'img', 0)).toBe(
      `<img src="data:image/png;base64,${SAMPLE_PNG}" width="3" height="2" alt="">`,
    );
  });
  it('4: sample.png, Encode, CSS url()', () => {
    expect(formatOutput(bytesToBase64(png), image, 'css', 0)).toBe(`url("data:image/png;base64,${SAMPLE_PNG}")`);
  });
  it('5: sample.png, Encode, Base64, Line length 76', () => {
    expect(formatOutput(bytesToBase64(png), image, 'base64', 76)).toBe(
      `${SAMPLE_PNG.slice(0, 76)}\nAEfPB3vT+rJCAAAAAElFTkSuQmCC`,
    );
  });
  it('6: sample.png facts — PNG, 3 × 2, 78 bytes, Base64 length 104', () => {
    expect(facts(image)).toEqual({ name: 'PNG', dimensions: { width: 3, height: 2 }, size: 78, base64Length: 104 });
    expect(formatSize(78)).toBe('78 bytes');
    expect(image.type).toEqual({ mime: 'image/png', name: 'PNG', ext: 'png' });
  });
  it('7: sample.gif / sample.bmp / sample.jpeg facts — 63 / 78 / 877 bytes, all 3 × 2', () => {
    expect(facts(described(fromBase64(SAMPLE_GIF)))).toMatchObject({ name: 'GIF', size: 63 });
    expect(facts(described(fromBase64(SAMPLE_BMP)))).toMatchObject({ name: 'BMP', size: 78 });
    expect(facts(described(fromBase64(SAMPLE_JPEG)))).toMatchObject({ name: 'JPEG', size: 877 });
    for (const b64 of [SAMPLE_GIF, SAMPLE_BMP, SAMPLE_JPEG])
      expect(described(fromBase64(b64)).dimensions).toEqual({ width: 3, height: 2 });
  });
  it('8: sample.svg facts — SVG, 24 × 16 from its attributes, 131 bytes', () => {
    expect(facts(described(utf8(SAMPLE_SVG)))).toMatchObject({
      name: 'SVG',
      dimensions: { width: 24, height: 16 },
      size: 131,
    });
  });
  it('9: viewbox.svg (with <?xml …?>) facts — SVG, 100 × 50 from its viewBox', () => {
    expect(facts(described(utf8(VIEWBOX_SVG)))).toMatchObject({ name: 'SVG', dimensions: { width: 100, height: 50 } });
  });
  it('10: SVG width="100%" height="100%" — Dimensions unknown', () => {
    const svg = utf8('<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"/>');
    expect(described(svg).dimensions).toBeNull();
  });
  it('11: WebP (VP8L) — 1 × 1, 34 bytes', () => {
    const image = decoded('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==');
    expect(facts(image)).toMatchObject({ name: 'WebP', dimensions: { width: 1, height: 1 }, size: 34 });
  });
  it('12: WebP with a VP8X header — 1920 × 1080', () => {
    expect(decoded('UklGRhYAAABXRUJQVlA4WAoAAAAAAAAAfwcANwQA').dimensions).toEqual({ width: 1920, height: 1080 });
  });
  it('13: a JPEG header with SOF0 — 800 × 600', () => {
    const image = decoded('/9j/4AAESkb/wAARCAJYAyADASIAAhEBAxEB');
    expect(image.type.name).toBe('JPEG');
    expect(image.dimensions).toEqual({ width: 800, height: 600 });
  });
  it('14: an AVIF header — AVIF, dimensions unknown from the header', () => {
    const image = decoded('AAAAHGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZg==');
    expect(image.type).toEqual({ mime: 'image/avif', name: 'AVIF', ext: 'avif' });
    expect(image.dimensions).toBeNull();
  });
  it('15: an ICO header — 256 × 256 (zero is 256)', () => {
    const image = decoded('AAABAAEAAAAAAAEAIAA=');
    expect(image.type.name).toBe('ICO');
    expect(image.dimensions).toEqual({ width: 256, height: 256 });
  });
  it('16: sample.png bare / in data:image/png;base64, / in DATA:IMAGE/PNG; BASE64, — PNG, 3 × 2, 78 bytes', () => {
    for (const text of [SAMPLE_PNG, `data:image/png;base64,${SAMPLE_PNG}`, `DATA:IMAGE/PNG; BASE64,${SAMPLE_PNG}`]) {
      const image = decoded(text);
      expect(facts(image)).toMatchObject({ name: 'PNG', dimensions: { width: 3, height: 2 }, size: 78 });
      expect(declaredMismatch(image)).toBeNull();
    }
  });
  it('17: the same with + as %2B in the body of the data: URI — PNG, 3 × 2', () => {
    expect(SAMPLE_PNG).toContain('+');
    const image = decoded(`data:image/png;base64,${SAMPLE_PNG.replaceAll('+', '%2B')}`);
    expect(image.bytes).toEqual(png);
    expect(image.dimensions).toEqual({ width: 3, height: 2 });
  });
  it('18: the same wrapped at 76 / in the URL-safe alphabet — PNG, 3 × 2', () => {
    const wrapped = SAMPLE_PNG.match(/.{1,76}/g)!.join('\n');
    const urlSafe = SAMPLE_PNG.replaceAll('+', '-').replaceAll('/', '_');
    expect(decoded(wrapped).bytes).toEqual(png);
    expect(decoded(urlSafe).bytes).toEqual(png);
    expect(decoded(urlSafe.replace(/=+$/, '')).bytes).toEqual(png);
  });
  it('19: data:image/jpeg;base64, + Base64 of a PNG — PNG, a warning', () => {
    const image = decoded(`data:image/jpeg;base64,${SAMPLE_PNG}`);
    expect(image.type.name).toBe('PNG');
    expect(image.declaredMime).toBe('image/jpeg');
    expect(declaredMismatch(image)).toBe('Declared image/jpeg, but the bytes are PNG.');
  });
  it('20: data:;base64, + Base64 of a PNG — PNG, no warning', () => {
    const image = decoded(`data:;base64,${SAMPLE_PNG}`);
    expect(image.declaredMime).toBeNull();
    expect(declaredMismatch(image)).toBeNull();
  });
  it('21: a percent-encoded SVG data: URI — SVG, 2 × 3, 62 bytes', () => {
    const image = decoded(
      'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%222%22 height=%223%22/%3E',
    );
    expect(facts(image)).toMatchObject({ name: 'SVG', dimensions: { width: 2, height: 3 }, size: 62 });
  });
  it('22: Base64 of a TIFF — the TIFF message', () => {
    for (const head of [ascii('MM\0*'), ascii('II*\0')])
      expect(failed(toBase64(concat(head, [0, 0, 0, 8, 0, 0]))).error).toEqual({
        message: 'TIFF images cannot be shown by Chrome; this tool does not accept them.',
      });
  });
  it('23: an ftypheic header — the HEIC message', () => {
    expect(failed(toBase64(makeFtyp('heic', ['mif1', 'heic']))).error.message).toBe(
      'HEIC images cannot be shown by Chrome; this tool does not accept them.',
    );
  });
  it('24: JVBERi0xLjcK (PDF), aGVsbG8= (hello) — not an image this tool recognises (…)', () => {
    expect(failed('JVBERi0xLjcK').error).toEqual({ message: NOT_AN_IMAGE });
    expect(failed('aGVsbG8=').error).toEqual({ message: NOT_AN_IMAGE });
    expect(NOT_AN_IMAGE).toBe('not an image this tool recognises (PNG, JPEG, GIF, WebP, AVIF, BMP, ICO, SVG)');
  });
  it('25: iVBO!w0K / data:image/png;base64,iVBO!w0K — invalid character "!", offset 4 / 26', () => {
    expect(failed('iVBO!w0K').error).toEqual({ message: 'invalid character "!"', offset: 4, line: 1, column: 5 });
    expect(failed('data:image/png;base64,iVBO!w0K').error).toEqual({
      message: 'invalid character "!"',
      offset: 26,
      line: 1,
      column: 27,
    });
  });
  it('26: data:image/png;base64 — a data URI needs a comma before the data', () => {
    expect(failed('data:image/png;base64').error).toEqual({ message: NO_COMMA });
    expect(NO_COMMA).toBe('a data URI needs a comma before the data');
  });
  it('27: data:image/png;base64, and "  \\n " — the empty state', () => {
    expect(decodeImageInput('data:image/png;base64,')).toMatchObject({ ok: true, image: null });
    expect(decodeImageInput('  \n ')).toMatchObject({ ok: true, image: null });
    expect(decodeImageInput('')).toMatchObject({ ok: true, image: null });
  });
  it('28: formatSize of 78 / 1,023 / 1,024 / 1,269,328 / 10,485,760 bytes', () => {
    expect([78, 1023, 1024, 1269328, 10485760].map(formatSize)).toEqual([
      '78 bytes',
      '1,023 bytes',
      '1,024 bytes (1.0 KiB)',
      '1,269,328 bytes (1.2 MiB)',
      '10,485,760 bytes (10.0 MiB)',
    ]);
  });
  // Rows 29–36 (the preview through blob:, data: blocked, the hostile SVG, the Blob's type, createImageBitmap, a
  // revoked URL, a truncated PNG, Save) are Chrome's: scripts/e2e-tools/base64-image.mjs, in the built extension.
  // What the logic gives them — the recognised type for the Blob, the truncated PNG's facts — is here:
  it('29–36: what the preview rows take from the logic — the Blob type is the recognised one; a truncated PNG keeps its facts', () => {
    const svgAsPng = decoded(`data:image/png;base64,${toBase64(utf8(SAMPLE_SVG))}`);
    expect(svgAsPng.type.mime).toBe('image/svg+xml');
    const truncated = decoded(toBase64(png.subarray(0, 40)));
    expect(facts(truncated)).toMatchObject({ name: 'PNG', dimensions: { width: 3, height: 2 }, size: 40 });
    expect(imageTypeOf('image/png')?.ext).toBe('png');
    expect(imageTypeOf('text/html')).toBeNull();
  });
});

describe('§7 detectBase64Image', () => {
  it.each([
    'data:image/png;base64,iVBORw0KGgo',
    'DATA:IMAGE/SVG+XML,%3Csvg',
    'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFN',
    '/9j/4AAESkb/wAARCAJYAyADASIAAhEBAxEB',
    'R0lGODdhAwACAKIAAAAAAAAA',
    'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==',
    'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcv',
  ])('yes: %s', text => expect(detectBase64Image(text)).toBe(true));
  it.each([
    'SGVsbG8sIFdvcmxkIQ==',
    'data:text/plain,hi',
    'iVBOR',
    'https://example.com/a.png',
    '<svg xmlns="http://www.w3.org/2000/svg"/>',
  ])('no: %s', text => expect(detectBase64Image(text)).toBe(false));
  it('takes white space at the ends and inside, and refuses a text past the input limit', () => {
    expect(detectBase64Image(`  \n${SAMPLE_PNG.match(/.{1,20}/g)!.join('\n')}\n`)).toBe(true);
    expect(detectBase64Image(`iVBORw0KGgo${'A'.repeat(MAX_INPUT_CHARS)}`)).toBe(false);
    expect(detectBase64Image('iVBORw0KGgo AAAA!')).toBe(false);
  });
  it('a megabyte of the worst input is one pass', { timeout: 60_000 }, () => {
    const worst = (n: number) => `iVBORw0KGgo${'A '.repeat(n / 2)}!`;
    expect(detectBase64Image(worst(1024 * 1024))).toBe(false);
    // The shape of the cost (`growth`): a megabyte against eight inputs of 128 Ki — linear about 1, quadratic about 8.
    expect(growth(detectBase64Image, worst, 128 * 1024)).toBeLessThan(GROWTH_BOUND);
  });
});

describe('§5 recognition by the first bytes', () => {
  it('follows the table, in its order, by the bytes and never by a name', () => {
    expect(sniffImage(fromBase64(SAMPLE_PNG))).toMatchObject({ ok: true, type: { mime: 'image/png' } });
    expect(sniffImage(concat([0, 0, 2, 0, 1, 0], new Uint8Array(16)))).toMatchObject({ type: { name: 'ICO' } });
    expect(sniffImage(concat(ascii('RIFF'), [0, 0, 0, 0], ascii('WEBPVP8 ')))).toMatchObject({
      type: { name: 'WebP' },
    });
    expect(sniffImage(concat([0xff, 0xd8, 0xff], new Uint8Array(4)))).toMatchObject({ type: { ext: 'jpg' } });
    expect(sniffImage(makeFtyp('avis'))).toMatchObject({ type: { name: 'AVIF' } });
  });
  it('is stricter than the bare patterns where they take text for an image (§15)', () => {
    expect(sniffImage(utf8('BMW is a car, not a bitmap.'))).toEqual({ ok: false, message: NOT_AN_IMAGE });
    expect(sniffImage(new Uint8Array(64))).toEqual({ ok: false, message: NOT_AN_IMAGE });
    expect(sniffImage(utf8('<!doctype html><html><body><svg width="1" height="1"></svg></body></html>'))).toEqual({
      ok: false,
      message: NOT_AN_IMAGE,
    });
    expect(sniffImage(makeBmpHeader(3, 2))).toMatchObject({ ok: true, type: { name: 'BMP' } });
  });
  it('an SVG root after a BOM, white space, a declaration, comments, a DOCTYPE with a subset; <svg/> too', () => {
    const svg = '﻿ \n<?xml version="1.0"?><!-- a > b --><!DOCTYPE svg [ <!ENTITY a "]>"> ]><svg/>';
    expect(sniffImage(utf8(svg))).toMatchObject({ ok: true, type: { name: 'SVG' } });
    expect(sniffImage(utf8('<svgx/>')).ok).toBe(false);
    expect(sniffImage(utf8(`${' '.repeat(4096)}<svg/>`)).ok).toBe(false);
    expect(sniffImage(concat(utf8('<svg>'), [0xff, 0xfe])).ok).toBe(false);
  });
  it('AVIF in a mif1 container by its compatible brands; HEIF otherwise', () => {
    expect(sniffImage(makeFtyp('mif1', ['avif', 'miaf']))).toMatchObject({ ok: true, type: { name: 'AVIF' } });
    expect(sniffImage(makeFtyp('mif1', ['heic'])).ok).toBe(false);
    for (const brand of ['heic', 'heix', 'hevc'])
      expect(sniffImage(makeFtyp(brand))).toEqual({
        ok: false,
        message: 'HEIC images cannot be shown by Chrome; this tool does not accept them.',
      });
  });
  it('a renamed file is what its bytes are: "photo.png" holding HEIC, "logo.png" holding JPEG, a "PNG" of text', () => {
    expect(describeImage(makeFtyp('heic', ['mif1']))).toEqual({
      ok: false,
      message: 'HEIC images cannot be shown by Chrome; this tool does not accept them.',
    });
    expect(describeImage(fromBase64(SAMPLE_JPEG))).toMatchObject({ ok: true, image: { type: { name: 'JPEG' } } });
    expect(describeImage(utf8('Hello, this is text in a file named image.png'))).toEqual({
      ok: false,
      message: NOT_AN_IMAGE,
    });
    expect(describeImage(new Uint8Array(0))).toEqual({ ok: false, message: NOT_AN_IMAGE });
  });
  it('a polyglot is what its first bytes say: a GIF that is also JavaScript is a GIF; HTML before PNG bytes is not', () => {
    const gifJs = concat(ascii('GIF89a/*'), [1, 0, 1, 0], ascii('*/=1;alert(1)//'), [0x3b]);
    expect(describeImage(gifJs)).toMatchObject({ ok: true, image: { type: { name: 'GIF' } } });
    expect(describeImage(concat(utf8('<html><script>x</script>'), png)).ok).toBe(false);
  });
});

describe('§5 dimensions from the header', () => {
  it('PNG IHDR, as claimed — 50,000 × 50,000 is read, not decoded', () => {
    expect(imageDimensions(makePng(1, 1, [0, 0, 0], { width: 50_000, height: 50_000 }), 'image/png')).toEqual({
      width: 50_000,
      height: 50_000,
    });
    expect(imageDimensions(png.subarray(0, 20), 'image/png')).toBeNull();
  });
  it('GIF logical screen, BMP core and info headers (height by its absolute value), ICO entries', () => {
    expect(imageDimensions(makeGifHeader(640, 480), 'image/gif')).toEqual({ width: 640, height: 480 });
    expect(imageDimensions(makeBmpHeader(7, 5, true), 'image/bmp')).toEqual({ width: 7, height: 5 });
    expect(imageDimensions(makeBmpHeader(7, -5), 'image/bmp')).toEqual({ width: 7, height: 5 });
    expect(imageDimensions(Uint8Array.from([0, 0, 1, 0, 1, 0, 16, 32]), 'image/x-icon')).toEqual({
      width: 16,
      height: 32,
    });
  });
  it('WebP lossy (VP8 ) 14-bit sizes', () => {
    const head = concat(ascii('RIFF'), [0, 0, 0, 0], ascii('WEBPVP8 '), new Uint8Array(10), [0x80, 0x02, 0xe0, 0x01]);
    expect(imageDimensions(head, 'image/webp')).toEqual({ width: 640, height: 480 });
  });
  it('JPEG: skips markers and fill bytes, stops at the scan, a truncated header is unknown', () => {
    const sof = [0xff, 0xc2, 0, 17, 8, 0x01, 0x00, 0x02, 0x00];
    const jpeg = concat([0xff, 0xd8], [0xff, 0xe1, 0, 4, 0, 0], [0xff, 0xff], sof);
    expect(imageDimensions(jpeg, 'image/jpeg')).toEqual({ width: 512, height: 256 });
    expect(imageDimensions(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2]), 'image/jpeg')).toBeNull();
    expect(imageDimensions(Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8]), 'image/jpeg')).toBeNull();
    // C4 is a table, not a frame.
    expect(imageDimensions(Uint8Array.from([0xff, 0xd8, 0xff, 0xc4, 0, 2]), 'image/jpeg')).toBeNull();
  });
  it('SVG: numbers with px, unknown with other units, the viewBox otherwise, separated by commas too', () => {
    const dims = (attrs: string) => imageDimensions(utf8(`<svg ${attrs}/>`), 'image/svg+xml');
    expect(dims('width="10px" height="20.4"')).toEqual({ width: 10, height: 20 });
    expect(dims('width="10em" height="20" viewBox="0,0,30,40"')).toEqual({ width: 30, height: 40 });
    expect(dims("width='5' height='6'")).toEqual({ width: 5, height: 6 });
    expect(dims('viewBox="0 0 -1 4"')).toBeNull();
    expect(dims('')).toBeNull();
  });
});

describe('§5 forms of the output', () => {
  it('<img> without width and height when the size is unknown; Base64 wrapped at 64', () => {
    const avif = described(fromBase64('AAAAHGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZg=='));
    expect(formatOutput('AAAA', avif, 'img', 0)).toBe('<img src="data:image/avif;base64,AAAA" alt="">');
    const long = bytesToBase64(new Uint8Array(100));
    expect(
      formatOutput(long, avif, 'base64', 64)
        .split('\n')
        .map(l => l.length),
    ).toEqual([64, 64, 8]);
  });
  it('wraps only the bare Base64: the data URI, <img> and url() keep one line whatever Line length says', () => {
    const image = described(png);
    for (const form of ['dataUri', 'img', 'css'] as const)
      expect(formatOutput(SAMPLE_PNG, image, form, 64)).not.toContain('\n');
  });
});

describe('§5 Decode: reading the input', () => {
  it('a data: URI with parameters, spaces before base64, tabs and line breaks inside', () => {
    const wrapped = SAMPLE_PNG.match(/.{1,30}/g)!.join('\r\n');
    for (const text of [
      `data:image/png;name=logo.png;base64,${SAMPLE_PNG}`,
      `data:image/png;charset=utf-8;  base64,${SAMPLE_PNG}`,
      `data:image/png;\n  base64,\n${wrapped}`,
      `\tdata:image/png;base64,${SAMPLE_PNG}  \n`,
      `Data:Image/PNG;Base64,${SAMPLE_PNG}`,
    ]) {
      const image = decoded(text);
      expect(image.bytes).toEqual(png);
      expect(image.declaredMime).toBe('image/png');
    }
  });
  it('a body that is not Base64 keeps its tabs and line breaks, as Chrome’s data: loader does', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"\twidth="2"\nheight="3"/>';
    const image = decoded(`data:image/svg+xml,${svg}`);
    expect(image.bytes).toEqual(utf8(svg));
    expect(image.dimensions).toEqual({ width: 2, height: 3 });
    expect(decoded(`data:image/png;base64 ,${SAMPLE_PNG}`).bytes).toEqual(png);
  });
  it('a percent-encoded data: URI of a PNG (no ;base64) keeps every byte', () => {
    const escaped = Array.from(png, b => `%${b.toString(16).padStart(2, '0')}`).join('');
    expect(decoded(`data:image/png,${escaped}`).bytes).toEqual(png);
  });
  it('a CSS url(…) and an <img src> pasted whole, quoted or not, with a property before it', () => {
    const uri = `data:image/png;base64,${SAMPLE_PNG}`;
    for (const [text, shape] of [
      [`url("${uri}")`, 'css'],
      [`url('${uri}')`, 'css'],
      [`url(${uri})`, 'css'],
      [`background-image: url( "${uri}" );`, 'css'],
      [`<img src="${uri}" width="3" height="2" alt="">`, 'img'],
      [`<IMG alt='' SRC='${uri}'>`, 'img'],
      [`<img src=${SAMPLE_PNG}>`, 'img'],
      [uri, 'data-uri'],
      [SAMPLE_PNG, 'base64'],
    ] as const) {
      const r = decodeImageInput(text);
      expect(r).toMatchObject({ ok: true, shape });
      if (r.ok) expect(r.image?.bytes).toEqual(png);
    }
    expect(failed('<img alt="logo">').error).toEqual({ message: NO_SRC });
  });
  it('an error inside a wrapper is placed in the input as typed', () => {
    expect(failed('  url("data:image/png;base64,iVBO!w0K")').error).toMatchObject({ offset: 33, column: 34 });
    expect(failed('<img src="iVBO!w0K">').error).toMatchObject({ offset: 14 });
    expect(failed('\n\n  iVBO!w0K').error).toMatchObject({ offset: 8, line: 3, column: 7 });
  });
  it('an error in a body with percent-escapes has no place', () => {
    expect(failed('data:image/png;base64,iV%42O!w0K').error).toEqual({ message: 'invalid character "!"' });
  });
  it('an address is refused in words, never fetched', () => {
    for (const text of [
      'https://example.com/a.png',
      'http://example.com/a.png',
      '//example.com/a.png',
      'url(https://example.com/a.png)',
      '<img src="https://example.com/a.png" alt="">',
      'blob:chrome-extension://abc/123',
      'file:///tmp/a.png',
      '//localhost/a.png',
      '//cdn/img',
      'url(//example.com/a.png)',
      '<img src="//example.com:8080/a.png?x=1#y">',
    ])
      expect(failed(text).error).toEqual({ message: ADDRESS });
  });
  it('bare Base64 that starts with // is Base64, not an address (bytes ff f…)', () => {
    for (const [text, bytes] of [
      ['//79', [0xff, 0xfe, 0xfd]],
      ['//8=', [0xff, 0xff]],
      ['  //79\n//79  ', [0xff, 0xfe, 0xfd, 0xff, 0xfe, 0xfd]],
      ['url(//79)', [0xff, 0xfe, 0xfd]],
      ['<img src="//79">', [0xff, 0xfe, 0xfd]],
    ] as const) {
      const read = parseImageInput(text);
      expect(read.ok && [...read.bytes], text).toEqual(bytes);
    }
    // Decoded, and then refused for what the bytes are — never as an address.
    expect(failed('//79').error).toEqual({ message: NOT_AN_IMAGE });
    expect(failed(`//${bytesToBase64(png).slice(2)}`).error.message).not.toBe(ADDRESS);
  });
  it('the Base64 errors of the shared reader, with their places', () => {
    expect(failed('iVBORw0KG').error.message).toBe('one character too many at the end');
    expect(failed('iVBO=w0K').error.message).toBe('misplaced padding "="');
    expect(failed('iVBO w0Ké').error).toMatchObject({ message: 'invalid character "é"', offset: 8 });
  });
  it('declared aliases are not a mismatch; another type is', () => {
    const jpeg = toBase64(fromBase64(SAMPLE_JPEG));
    expect(declaredMismatch(decoded(`data:image/jpg;base64,${jpeg}`))).toBeNull();
    expect(declaredMismatch(decoded(`data:IMAGE/JPEG;base64,${jpeg}`))).toBeNull();
    expect(declaredMismatch(decoded(`data:image/png;base64,${jpeg}`))).toBe(
      'Declared image/png, but the bytes are JPEG.',
    );
    expect(declaredMismatch(decoded(`data:text/plain;base64,${SAMPLE_PNG}`))).toBe(
      'Declared text/plain, but the bytes are PNG.',
    );
  });
});

describe('§5 active SVG content', () => {
  const active = (svg: string) => svgHasActiveContent(utf8(svg));
  it.each([
    '<svg><script>alert(1)</script></svg>',
    '<svg onload="alert(1)"/>',
    '<svg><a xlink:href="https://example.com/">x</a></svg>',
    '<svg><image href="//example.com/a.png"/></svg>',
    '<svg><rect style="fill:url(http://example.com/a.svg#p)"/></svg>',
    '<svg><style>@import "x.css";</style></svg>',
    '<svg><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject></svg>',
    '<svg><use href="/assets/sprite.svg#a"/></svg>',
    '<svg><image href="chrome-extension://abc/icons/icon-16.png"/></svg>',
    '<svg><a href="javascript:alert(1)">x</a></svg>',
    '<svg><a><set attributeName="href" to="https://example.com"/></a></svg>',
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "https://example.com/x">]><svg>&x;</svg>',
  ])('active: %s', svg => expect(active(svg)).toBe(true));
  it.each([
    SAMPLE_SVG,
    '<svg><use href="#a"/><rect fill="url(#g)"/></svg>',
    '<svg><image href="data:image/png;base64,AAAA"/></svg>',
    '<svg xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="#b"/></svg>',
    '<svg><text>on load = nothing; see https://example.com in a sentence</text></svg>',
  ])('not active: %s', svg => expect(active(svg)).toBe(false));
  it('the note says what the specification says, and only SVG carries the flag', () => {
    expect(ACTIVE_SVG_NOTE).toBe(
      'This SVG contains scripts or external references. They do not run here, but may run if you open the saved file in a browser.',
    );
    expect(described(utf8('<svg onload="x()"/>')).svgActiveContent).toBe(true);
    expect(described(concat(png, utf8('<script>'))).svgActiveContent).toBe(false);
  });
});

describe('§6 messages and limits', () => {
  it('a file over 10 MiB, before reading it', () => {
    expect(MAX_IMAGE_BYTES).toBe(10_485_760);
    expect(fileTooLarge(54_525_952)).toBe(
      'The image is 54,525,952 bytes (52.0 MiB). This tool works with images up to 10 MiB.',
    );
  });
  it('Decode input over 14 Mi characters; a long output', () => {
    expect(MAX_INPUT_CHARS).toBe(14_680_064);
    expect(INPUT_TOO_LARGE).toBe('Input is larger than 14 MB of Base64 (about 10 MiB of image).');
    expect(truncatedNote(13_981_016)).toBe('Showing the first 65,536 of 13,981,016 characters. Copy copies all.');
  });
  it('formatSize: one byte, and the unit follows the rounded value', () => {
    expect(formatSize(1)).toBe('1 byte');
    expect(formatSize(0)).toBe('0 bytes');
    expect(formatSize(1_048_575)).toBe('1,048,575 bytes (1.0 MiB)');
    expect(formatSize(54_525_952)).toBe('54,525,952 bytes (52.0 MiB)');
  });
});

describe('additions to the specification (§15)', () => {
  it('AVIF: the size of its first ispe property, when the file has one', () => {
    const ispe = concat([0, 0, 0, 20], ascii('ispe'), [0, 0, 0, 0], [0, 0, 7, 128], [0, 0, 4, 56]);
    expect(imageDimensions(concat(makeFtyp('avif', ['mif1']), ispe), 'image/avif')).toEqual({
      width: 1920,
      height: 1080,
    });
  });
  it('previewRefusal: above 100 megapixels claimed, in words; unknown sizes are not refused', () => {
    expect(previewRefusal({ width: 10_000, height: 10_000 })).toBeNull();
    expect(previewRefusal({ width: 10_000, height: 10_001 })).toBe(
      'No preview: the image says it is 10,000 × 10,001 pixels, more than the 100 megapixels a preview may decode.',
    );
    expect(previewRefusal(null)).toBeNull();
  });
  it('encodeImage gives the image and its padded standard Base64; toDataUri the recognised type', () => {
    expect(encodeImage(png)).toMatchObject({ ok: true, base64: SAMPLE_PNG, image: { type: { name: 'PNG' } } });
    expect(encodeImage(utf8('hello'))).toEqual({ ok: false, message: NOT_AN_IMAGE });
    expect(toDataUri(decoded(`data:image/jpeg;name=a;base64,${SAMPLE_PNG}`))).toBe(
      `data:image/png;base64,${SAMPLE_PNG}`,
    );
  });
});
