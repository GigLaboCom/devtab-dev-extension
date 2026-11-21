import { bytesToBase64, parseBase64 } from './base64';
import { describe, expect, it } from 'vitest';

const utf8 = (text: string) => new TextEncoder().encode(text);
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const decoded = (input: string) => {
  const result = parseBase64(input);
  if (!result.ok) throw new Error(`not decoded: ${result.error.message}`);
  return result.bytes;
};
const errorOf = (input: string) => {
  const result = parseBase64(input);
  if (result.ok) throw new Error('decoded');
  return result.error;
};

describe('bytesToBase64 (base64.md §5 «Кодирование», §10)', () => {
  it.each([
    ['', ''],
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='],
    ['fooba', 'Zm9vYmE='],
    ['foobar', 'Zm9vYmFy'],
    ['Hello, World!', 'SGVsbG8sIFdvcmxkIQ=='],
    ['Привет', '0J/RgNC40LLQtdGC'],
    ['😀', '8J+YgA=='],
    ['a\nb', 'YQpi'],
    [' x ', 'IHgg'],
  ])('%j → %s (RFC 4648 §10, Buffer)', (input, expected) => {
    expect(bytesToBase64(utf8(input))).toBe(expected);
  });

  it('URL-safe, with and without padding', () => {
    expect(bytesToBase64(utf8('😀'), { alphabet: 'url', padding: false })).toBe('8J-YgA');
    expect(bytesToBase64(utf8('ÿþ?>'), { alphabet: 'url', padding: false })).toBe('w7_Dvj8-');
    expect(bytesToBase64(utf8('subjects?_d'), { alphabet: 'url', padding: false })).toBe('c3ViamVjdHM_X2Q');
    expect(bytesToBase64(utf8('?>'), { alphabet: 'url', padding: true })).toBe('Pz4=');
  });

  it('a lone surrogate is U+FFFD (TextEncoder) — the bytes the tool hands in', () => {
    expect(bytesToBase64(utf8('\uD800'))).toBe('77+9');
  });

  it('wraps at 64 and 76 characters, the last line shorter, no line break at the end', () => {
    const sixty = utf8('a'.repeat(60));
    expect(
      bytesToBase64(sixty, { lineLength: 64 })
        .split('\n')
        .map(l => l.length),
    ).toEqual([64, 16]);
    expect(bytesToBase64(sixty, { lineLength: 64 }).split('\n')[1]).toBe('YWFhYWFhYWFhYWFh');
    expect(bytesToBase64(sixty, { lineLength: 76 }).split('\n')).toEqual([expect.any(String), 'YWFh']);
    expect(bytesToBase64(sixty, { lineLength: 76 }).split('\n')[0]).toHaveLength(76);
  });
});

describe('parseBase64 (base64.md §5 «Декодирование», §10)', () => {
  it.each([
    ['Zm9vYmFy', 'foobar'],
    ['Zm9vYg==', 'foob'],
    ['Zm9vYg', 'foob'],
    ['Zm9v\nYmFy', 'foobar'],
    [' Zm9 vYg== ', 'foob'],
    ['Zm9vYmFy\r\n', 'foobar'],
    ['8J-YgA', '😀'],
    ['8J+YgA==', '😀'],
    ['0J/RgNC40LLQtdGC', 'Привет'],
    ['QR==', 'A'],
    ['   \n ', ''],
  ])('%j → %j', (input, expected) => {
    expect(text(decoded(input))).toBe(expected);
  });

  it('gives the bytes as they are: not UTF-8, a byte order mark', () => {
    expect(Array.from(decoded('/w=='))).toEqual([0xff]);
    expect(Array.from(decoded('//79'))).toEqual([0xff, 0xfe, 0xfd]);
    expect(Array.from(decoded('77u/YQ=='))).toEqual([0xef, 0xbb, 0xbf, 0x61]);
  });

  it.each([
    ['Zm9vY', 'one character too many at the end', 4, 1, 5],
    ['Zm9v!', 'invalid character "!"', 4, 1, 5],
    ['Zm=9v', 'misplaced padding "="', 2, 1, 3],
    ['Zg=', 'misplaced padding "="', 2, 1, 3],
    ['Zg===', 'misplaced padding "="', 2, 1, 3],
    ['====', 'misplaced padding "="', 0, 1, 1],
    ['Zm9v\n😀', 'invalid character "😀"', 5, 2, 1],
    ['Zm9v YmFy', 'invalid character U+00A0', 4, 1, 5],
  ])('%j: %s at offset %i (line %i, column %i)', (input, message, offset, line, column) => {
    expect(errorOf(input)).toEqual({ message, offset, line, column });
  });

  it('round-trips every byte value in both alphabets, padded or not', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    for (const alphabet of ['standard', 'url'] as const)
      for (const padding of [true, false])
        for (let n = 0; n <= 5; n++) {
          const bytes = all.subarray(250 - n * 40, 256);
          expect(decoded(bytesToBase64(bytes, { alphabet, padding, lineLength: 64 }))).toEqual(bytes);
        }
  });
});
