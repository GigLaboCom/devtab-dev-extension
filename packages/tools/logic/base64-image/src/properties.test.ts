// Promises the examples cannot cover, on generated inputs with a fixed seed: any image bytes go to every output form and
// back to the same bytes and type; the fast Base64 path answers exactly as the shared reader; the scans over a person's
// input stay linear on the worst inputs of a megabyte (bounded by shape, not by the machine's speed).
import { decodeBase64, decodeImageInput, describeImage, formatOutput, svgActiveIn, svgDimensions } from './index';
import { ascii, concat, makeFtyp, randomBytes, seeded, utf8 } from './testing/images';
import { bytesToBase64, parseBase64 } from '@workspace/tools-shared/base64';
import { GROWTH_BOUND, growth } from '@workspace/tools-shared/growth';
import { describe, expect, it } from 'vitest';
import type { LineLength, OutputForm } from './index';

const random = seeded(27);
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;

/** An image's head for each type the tool recognises, then arbitrary bytes: recognition reads only the head. */
const HEADS: ReadonlyArray<() => Uint8Array> = [
  () => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  () => Uint8Array.from([0xff, 0xd8, 0xff]),
  () => Uint8Array.from(ascii(pick(['GIF87a', 'GIF89a']))),
  () => concat(ascii('RIFF'), randomBytes(random, 4), ascii('WEBPVP8L')),
  () => makeFtyp(pick(['avif', 'avis'])),
  () => concat(ascii('BM'), randomBytes(random, 12), [40, 0, 0, 0]),
  () => Uint8Array.from([0, 0, pick([1, 2]), 0, 1, 0]),
];

const FORMS: ReadonlyArray<[OutputForm, LineLength]> = [
  ['dataUri', 0],
  ['base64', 0],
  ['base64', 64],
  ['base64', 76],
  ['img', 0],
  ['css', 0],
];

describe('round trips', () => {
  it('any image bytes → every output form → Decode gives the same bytes and type', () => {
    for (let n = 0; n < 300; n++) {
      const bytes =
        n % 8 === 7
          ? utf8(`<svg xmlns="http://www.w3.org/2000/svg" width="${n}" height="3"><!--${'x'.repeat(n)}--></svg>`)
          : concat(pick(HEADS)(), randomBytes(random, Math.floor(random() * 600)));
      const described = describeImage(bytes);
      expect(described.ok).toBe(true);
      if (!described.ok) continue;
      const base64 = bytesToBase64(bytes);
      for (const [form, lineLength] of FORMS) {
        const back = decodeImageInput(formatOutput(base64, described.image, form, lineLength));
        expect(back.ok, `${form}/${lineLength} of ${described.image.type.name}`).toBe(true);
        if (!back.ok || !back.image) continue;
        expect(back.image.bytes).toEqual(bytes);
        expect(back.image.type).toEqual(described.image.type);
      }
    }
  });
  it('a data URI with the body percent-encoded, URL-safe or unpadded gives the same bytes', () => {
    for (let n = 0; n < 100; n++) {
      const bytes = concat(HEADS[0]!(), randomBytes(random, Math.floor(random() * 300)));
      const b64 = bytesToBase64(bytes);
      const url = bytesToBase64(bytes, { alphabet: 'url', padding: false });
      for (const text of [
        `data:image/png;base64,${b64.replace(/[+/=]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
        `data:image/png;base64,${url}`,
        url,
        bytesToBase64(bytes, { lineLength: 64 }).replaceAll('\n', '\r\n'),
      ]) {
        const back = decodeImageInput(text);
        expect(back.ok && back.image?.bytes).toEqual(bytes);
      }
    }
  });
});

describe('the fast Base64 path', () => {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/-_= \n\t!.é';
  it('answers exactly as the shared reader: the same bytes, or the same error at the same place', () => {
    for (let n = 0; n < 3000; n++) {
      const length = Math.floor(random() * 40);
      const clean = n % 2 === 0;
      const text = Array.from({ length }, () => pick((clean ? ALPHABET.slice(0, 64) : ALPHABET).split(''))).join('');
      const padded = clean && n % 4 === 0 ? `${text}${'='.repeat((4 - (text.length % 4)) % 4)}` : text;
      expect(decodeBase64(padded), JSON.stringify(padded)).toEqual(parseBase64(padded));
    }
  });
});

describe('linear on the worst inputs (a megabyte each)', () => {
  /**
   * The shape of the cost, not milliseconds (`growth`): 1 MiB against sixteen inputs of 64 KiB, timed in turn — a
   * linear scan about 1, a quadratic one about 16, on a free machine or a loaded one.
   */
  const ratio = (make: (n: number) => string, run: (text: string) => unknown): number =>
    growth(run, make, 64 * 1024, { factor: 16 });
  it.each([
    ['many unclosed entity declarations', (n: number) => '<!ENTITY a '.repeat(n / 11)],
    ['many event-like words', (n: number) => ' on'.repeat(n / 3)],
    ['one huge root tag', (n: number) => `<svg ${'a'.repeat(n)}`],
    ['many unclosed quotes', (n: number) => ` href="x`.repeat(n / 8)],
    ['many url(', (n: number) => 'url('.repeat(n / 4)],
    ['a DOCTYPE that never ends', (n: number) => `<!DOCTYPE svg [${'['.repeat(n)}`],
  ])('%s', { timeout: 60_000 }, (_name, make) => {
    expect(ratio(make, text => [svgActiveIn(text), svgDimensions(text)])).toBeLessThan(GROWTH_BOUND);
  });
  it('Decode of a megabyte of Base64 with the error at its end', { timeout: 60_000 }, () => {
    expect(
      ratio(
        n => `${'A'.repeat(n)}!`,
        text => decodeImageInput(text),
      ),
    ).toBeLessThan(GROWTH_BOUND);
    expect(
      ratio(
        n => `<img src="${'A'.repeat(n)}`,
        text => decodeImageInput(text),
      ),
    ).toBeLessThan(GROWTH_BOUND);
  });
});
