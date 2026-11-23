import { base64urlDecode, base64urlEncode } from './base64url';
import { describe, expect, it } from 'vitest';

const bytes = (...values: number[]) => new Uint8Array(values);

describe('base64url', () => {
  it('encodes without padding, with - and _ (RFC 4648 §5 vectors)', () => {
    const text = (s: string) => base64urlEncode(new TextEncoder().encode(s));
    expect(['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar'].map(text)).toEqual([
      '',
      'Zg',
      'Zm8',
      'Zm9v',
      'Zm9vYg',
      'Zm9vYmE',
      'Zm9vYmFy',
    ]);
    expect(base64urlEncode(bytes(0xfb, 0xff, 0xbf))).toBe('-_-_');
  });

  it('decodes what it encodes, for every length up to 70 bytes', () => {
    for (let n = 0; n <= 70; n += 1) {
      const data = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 0xff);
      expect(base64urlDecode(base64urlEncode(data))).toEqual(data);
    }
  });

  it('decodes the URL-safe alphabet', () => {
    expect(base64urlDecode('-_-_')).toEqual(bytes(0xfb, 0xff, 0xbf));
    expect(base64urlDecode('Zm9vYmFy')).toEqual(new TextEncoder().encode('foobar'));
    expect(base64urlDecode('')).toEqual(bytes());
  });

  it.each([
    ['padding', 'Zg=='],
    ['one padding character', 'Zm8='],
    ['+ of plain base64', 'a+b0'],
    ['/ of plain base64', 'a/b0'],
    ['a space', 'Zm9v Zg'],
    ['a line break', 'Zm9v\nZg'],
    ['a length of 1 modulo 4', 'Zm9vY'],
    ['a letter outside ASCII', 'Zm9vé'],
    ['a dot', 'Zm.v'],
  ])('refuses %s', (_name, text) => {
    expect(base64urlDecode(text)).toBeUndefined();
  });

  it('refuses what is not a string', () => {
    expect(base64urlDecode(undefined as unknown as string)).toBeUndefined();
    expect(base64urlDecode(42 as unknown as string)).toBeUndefined();
  });
});
