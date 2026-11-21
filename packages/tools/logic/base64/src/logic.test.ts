import { detectBase64 } from './detect';
import { DATA_URL_MESSAGE, LIVE_INPUT, MAX_INPUT, decodeText, defaultPadding, encodeText } from './logic';
import { describe, expect, it } from 'vitest';
import type { Base64Options, DecodeResult } from './logic';

const STANDARD: Base64Options = { alphabet: 'standard', padding: true, lineLength: 0 };
const URL_SAFE: Base64Options = { alphabet: 'url', padding: false, lineLength: 0 };
const enc = (text: string, options: Partial<Base64Options> = {}) => encodeText(text, { ...STANDARD, ...options });
const text = (input: string): string => {
  const result = decodeText(input);
  if (!result.ok || result.kind !== 'text') throw new Error(`not text: ${JSON.stringify(result)}`);
  return result.text;
};
const error = (input: string) => {
  const result = decodeText(input);
  if (result.ok) throw new Error(`no error: ${JSON.stringify(result)}`);
  return result.error;
};

// docs/tools/specs/base64.md §10, row by row, then what §5 and §6 state that §10 does not show.
describe('encode (§10)', () => {
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
  ])('standard: %j → %j (RFC 4648 §10, Buffer)', (input, expected) => {
    expect(enc(input)).toBe(expected);
  });

  it.each([
    ['😀', '8J-YgA'],
    ['ÿþ?>', 'w7_Dvj8-'],
    ['subjects?_d', 'c3ViamVjdHM_X2Q'],
  ])('URL-safe without padding: %j → %j', (input, expected) => {
    expect(encodeText(input, URL_SAFE)).toBe(expected);
  });

  it('URL-safe with padding: "?>" → "Pz4="', () => {
    expect(encodeText('?>', { ...URL_SAFE, padding: true })).toBe('Pz4=');
  });

  it('a newline is one byte 0a: "a\\nb" → "YQpi"', () => {
    expect(enc('a\nb')).toBe('YQpi');
  });

  it('spaces at the edges are data: " x " → "IHgg"', () => {
    expect(enc(' x ')).toBe('IHgg');
  });

  it('a lone surrogate becomes U+FFFD: "\\uD800" → "77+9"', () => {
    expect(enc('\uD800')).toBe('77+9');
  });

  it('60 × "a", line length 64: 64 characters, \\n, 16 more', () => {
    const lines = enc('a'.repeat(60), { lineLength: 64 }).split('\n');
    expect(lines.map(l => l.length)).toEqual([64, 16]);
    expect(lines[0]).toBe('YWFh'.repeat(16));
    expect(lines[1]).toBe('YWFhYWFhYWFhYWFh');
  });

  it('60 × "a", line length 76: 76 characters, \\n, "YWFh"', () => {
    expect(enc('a'.repeat(60), { lineLength: 76 })).toBe(`${'YWFh'.repeat(19)}\nYWFh`);
  });
});

describe('decode (§10)', () => {
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
  ])('%j → %j', (input, expected) => {
    expect(text(input)).toBe(expected);
  });

  it('bytes that are not UTF-8 are shown as hex: "/w==" → ff, 1 byte', () => {
    expect(decodeText('/w==')).toEqual({ ok: true, kind: 'hex', text: 'ff', byteCount: 1 });
  });

  it('"//79" → ff fe fd, 3 bytes', () => {
    expect(decodeText('//79')).toEqual({ ok: true, kind: 'hex', text: 'ff fe fd', byteCount: 3 });
  });

  it('a byte order mark stays in the text: "77u/YQ==" → "\\uFEFFa", bom', () => {
    expect(decodeText('77u/YQ==')).toEqual({ ok: true, kind: 'text', text: '\uFEFFa', bom: true });
  });

  it.each([
    ['Zm9vY', 'one character too many at the end', 4, 1, 5],
    ['Zm9v!', 'invalid character "!"', 4, 1, 5],
    ['Zm=9v', 'misplaced padding "="', 2, 1, 3],
    ['Zg=', 'misplaced padding "="', 2, 1, 3],
    ['Zg===', 'misplaced padding "="', 2, 1, 3],
    ['====', 'misplaced padding "="', 0, 1, 1],
    ['Zm9v\n😀', 'invalid character "😀"', 5, 2, 1],
    ['Zm9v\u00A0YmFy', 'invalid character U+00A0', 4, 1, 5],
  ])('%j: %s at offset %i (line %i, column %i)', (input, message, offset, line, column) => {
    expect(error(input)).toEqual({ message, offset, line, column });
  });

  it('a data URL is an error with no place', () => {
    expect(error('data:image/png;base64,iVBO')).toEqual({ message: 'This is a data URL. Open it in Base64 Image.' });
  });

  it('only whitespace is empty text, no error', () => {
    expect(decodeText('   \n ')).toEqual({ ok: true, kind: 'text', text: '', bom: false });
  });
});

describe('RFC 4648 §10 test vectors, both ways and in both alphabets', () => {
  const vectors: Array<[string, string]> = [
    ['', ''],
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='],
    ['fooba', 'Zm9vYmE='],
    ['foobar', 'Zm9vYmFy'],
  ];
  it.each(vectors)('%j ⇄ %j', (plain, base64) => {
    expect(enc(plain)).toBe(base64);
    expect(encodeText(plain, { ...URL_SAFE, padding: true })).toBe(base64);
    expect(encodeText(plain, URL_SAFE)).toBe(base64.replace(/=+$/, ''));
    expect(text(base64)).toBe(plain);
    expect(text(base64.replace(/=+$/, ''))).toBe(plain);
  });
});

describe('what §5 and §6 state beyond §10', () => {
  it('§4: padding is on for the standard alphabet, off for URL-safe', () => {
    expect(defaultPadding('standard')).toBe(true);
    expect(defaultPadding('url')).toBe(false);
  });

  it('§6: only spaces encode as data, "   " → "ICAg"; empty input with wrapping is empty', () => {
    expect(enc('   ')).toBe('ICAg');
    expect(enc('', { lineLength: 64 })).toBe('');
  });

  it('§5.3 off: no "=" at all, in either alphabet', () => {
    expect(enc('f', { padding: false })).toBe('Zg');
    expect(enc('fo', { padding: false })).toBe('Zm8');
  });

  it('§5.4: "=" counts toward the line; a result of exactly N characters has no newline; never a trailing one', () => {
    expect(enc('a'.repeat(48), { lineLength: 64 })).toBe('YWFh'.repeat(16));
    const padded = enc('a'.repeat(47), { lineLength: 64 });
    expect(padded).toHaveLength(64);
    expect(padded.endsWith('YWE=')).toBe(true);
    const wrapped = enc('a'.repeat(49), { lineLength: 64 });
    expect(wrapped.split('\n')).toEqual(['YWFh'.repeat(16), 'YQ==']);
    expect(enc('a'.repeat(57), { lineLength: 76 })).toBe('YWFh'.repeat(19));
    expect(enc('a'.repeat(200), { lineLength: 76 }).endsWith('\n')).toBe(false);
  });

  it('§5.4 with URL-safe and no padding: the lines are cut the same way', () => {
    const out = encodeText('?'.repeat(49), { alphabet: 'url', padding: false, lineLength: 64 });
    expect(out).toBe(`${'Pz8_'.repeat(16)}\nPw`);
  });

  it('§5 decoding 1: TAB and FF are skipped like spaces and newlines', () => {
    expect(text('\tZm9v\fYmFy\t')).toBe('foobar');
  });

  it('§5 decoding 1: other whitespace and invisible characters are invalid, named by code point', () => {
    expect(error('Zm9v\u000BYmFy')).toEqual({ message: 'invalid character U+000B', offset: 4, line: 1, column: 5 });
    expect(error('Zm9v\u200BYmFy')).toEqual({ message: 'invalid character U+200B', offset: 4, line: 1, column: 5 });
    expect(error('Zm9v\u0000')).toEqual({ message: 'invalid character U+0000', offset: 4, line: 1, column: 5 });
    expect(error('\u3000Zm9v')).toEqual({ message: 'invalid character U+3000', offset: 0, line: 1, column: 1 });
  });

  it('§5 decoding 4: the alphabets may be mixed, "+" and "-" are 62, "/" and "_" are 63', () => {
    const mixed = decodeText('+-/_');
    const standard = decodeText('++//');
    expect(mixed).toEqual(standard);
    expect(mixed).toEqual({ ok: true, kind: 'hex', text: 'fb ef ff', byteCount: 3 });
    expect(text('8J-YgA==')).toBe('😀');
  });

  it('§5 decoding 5: the leftover bits are not checked, "QQ==" and "QR==" both give "A"', () => {
    expect(text('QQ==')).toBe('A');
    expect(text('QR')).toBe('A');
  });

  it('§5 decoding 3: the place of the extra character counts whitespace before it', () => {
    expect(error('Zm9v Y')).toEqual({ message: 'one character too many at the end', offset: 5, line: 1, column: 6 });
    expect(error('Zm9v\r\nY')).toEqual({ message: 'one character too many at the end', offset: 6, line: 2, column: 1 });
  });

  it('§5 decoding 4 before 3: an invalid character is named even when the length leaves one over', () => {
    // "Zm9v!" is 5 characters (remainder 1); §6 and §10 name the "!", not the length.
    expect(error('Zm9v!').message).toBe('invalid character "!"');
  });

  it('§5 decoding 2: one or two "=" come off only when the length divides by 4', () => {
    expect(error('Zm9vYg=').message).toBe('misplaced padding "="');
    expect(error('Zm9vY===')).toEqual({ message: 'misplaced padding "="', offset: 5, line: 1, column: 6 });
    expect(text('Zm9vYg= =')).toBe('foob');
  });

  it('§5 decoding 8: "data:" after leading whitespace, in any case, is the data URL error', () => {
    expect(error(' \n DATA:text/plain;base64,aGk=')).toEqual({ message: DATA_URL_MESSAGE });
    expect(error('Data:,hi')).toEqual({ message: DATA_URL_MESSAGE });
    expect(error('Zm9vdata:').message).toBe('invalid character ":"');
  });

  it('§5 decoding 6: strict UTF-8 — an overlong form, a surrogate, a cut sequence go to hex', () => {
    // c0 af (overlong "/"), ed a0 80 (U+D800), e2 82 (cut "€")
    const hex = (input: string): DecodeResult => decodeText(input);
    expect(hex('wK8=')).toEqual({ ok: true, kind: 'hex', text: 'c0 af', byteCount: 2 });
    expect(hex('7aCA')).toEqual({ ok: true, kind: 'hex', text: 'ed a0 80', byteCount: 3 });
    expect(hex('4oI=')).toEqual({ ok: true, kind: 'hex', text: 'e2 82', byteCount: 2 });
    expect(text('4oKs')).toBe('€');
  });

  it('§5 decoding 6: a byte order mark later in the text is not a leading one', () => {
    expect(decodeText('Ye+7vw==')).toEqual({ ok: true, kind: 'text', text: 'a\uFEFF', bom: false });
  });

  it('round trip: any text encodes and decodes back, in both alphabets and with wrapping', () => {
    const samples = [
      '',
      'a',
      'ab',
      'abc',
      'Привет, мир',
      '😀 👍🏽 家族',
      'tab\tand\nnewline',
      '\uFEFFbom',
      'x'.repeat(1000),
    ];
    for (const sample of samples)
      for (const alphabet of ['standard', 'url'] as const)
        for (const padding of [true, false])
          for (const lineLength of [0, 64, 76] as const)
            expect(text(encodeText(sample, { alphabet, padding, lineLength }))).toBe(sample);
  });

  it('§12: the limits', () => {
    expect(LIVE_INPUT).toBe(262_144);
    expect(MAX_INPUT).toBe(5_242_880);
  });
});

describe('detectBase64 (§7)', () => {
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  it.each(['SGVsbG8sIFdvcmxkIQ==', 'aGVsbG8gd29ybGQ', 'eyJhbGciOiJIUzI1NiJ9'])('yes: %j', input => {
    expect(detectBase64(input)).toBe(true);
  });

  it.each([
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.x',
    'username',
    'password',
    'HelloWorld',
    'camelCaseName1',
    'deadbeef',
    '1700000000',
    '550e8400-e29b-41d4-a716-446655440000',
    PNG,
    'Hello world',
    '/usr/local/bin',
    '0x1F',
    'QUJDRA',
  ])('no: %j', input => {
    expect(detectBase64(input)).toBe(false);
  });

  it('rule 1: 8 to 65 536 characters after trimming the edges', () => {
    expect(detectBase64('  SGVsbG8sIFdvcmxkIQ==\n')).toBe(true);
    expect(detectBase64('MTIzNDU2')).toBe(true); // 8: "123456"
    expect(detectBase64('YWJjZGVm')).toBe(false); // 8, but no digit and no + / _ - = (rule 4)
    expect(detectBase64('YWJjZGU')).toBe(false); // 7: "abcde"
    const big = encodeText(`${'a, '.repeat(16_383)}???`, STANDARD); // 65 536 characters, ends in "Pz8/"
    expect(big).toHaveLength(65_536);
    expect(detectBase64(big)).toBe(true);
    expect(detectBase64(`${big}QQ==`)).toBe(false);
  });

  it('rule 2: no whitespace inside', () => {
    expect(detectBase64('SGVsbG8s IFdvcmxkIQ==')).toBe(false);
    expect(detectBase64('SGVsbG8s\nIFdvcmxkIQ==')).toBe(false);
  });

  it('rule 6: control characters other than TAB, LF, CR, and U+FFFD say no', () => {
    expect(detectBase64(encodeText('line one\r\n\tline two', STANDARD))).toBe(true);
    expect(detectBase64(encodeText('nul \u0000 inside', STANDARD))).toBe(false);
    expect(detectBase64(encodeText('esc \u001b[0m', STANDARD))).toBe(false);
    expect(detectBase64(encodeText('c1 \u0085 control', STANDARD))).toBe(false);
    expect(detectBase64(encodeText('a \uFFFD replaced', STANDARD))).toBe(false);
  });

  it('a data URL is not Base64 for detection', () => {
    expect(detectBase64('data:text/plain;base64,aGVsbG8=')).toBe(false);
  });
});
