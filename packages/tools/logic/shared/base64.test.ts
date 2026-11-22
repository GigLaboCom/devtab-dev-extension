import { base64Engine, bytesToBase64, parseBase64 } from './base64';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Base64Options, ParseBase64Result } from './base64';

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

describe('parseBase64: a lone surrogate (base64.md §15)', () => {
  it.each([
    ['Zm9v\uD800', 'invalid character U+D800', 4],
    ['Zm9v\uDFFF', 'invalid character U+DFFF', 4],
    ['\uDBFFZm9v', 'invalid character U+DBFF', 0],
  ])('%j: %s, not in quotes', (input, message, offset) => {
    expect(errorOf(input)).toEqual({ message, offset, line: 1, column: offset + 1 });
  });

  it('a surrogate pair is still one character in quotes', () => {
    expect(errorOf('Zm9v😀').message).toBe('invalid character "😀"');
  });
});

// The module before the tables, kept as the oracle: every answer of parseBase64 and bytesToBase64 must equal these,
// character for character, on both paths — with the platform's toBase64 / fromBase64 where the runtime has them, and
// with them hidden. Only `describe` differs from the original: it names a lone surrogate (base64.md §15).
const ORACLE_STANDARD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const ORACLE_URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const oracleEncode = (
  bytes: Uint8Array,
  { alphabet = 'standard', padding = true, lineLength = 0 }: Partial<Base64Options> = {},
): string => {
  const table = alphabet === 'url' ? ORACLE_URL : ORACLE_STANDARD;
  const out: string[] = [];
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out.push(table[n >> 18]!, table[(n >> 12) & 63]!, table[(n >> 6) & 63]!, table[n & 63]!);
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out.push(table[n >> 18]!, table[(n >> 12) & 63]!);
    if (padding) out.push('==');
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out.push(table[n >> 18]!, table[(n >> 12) & 63]!, table[(n >> 6) & 63]!);
    if (padding) out.push('=');
  }
  const encoded = out.join('');
  if (lineLength === 0 || encoded.length <= lineLength) return encoded;
  const lines: string[] = [];
  for (let at = 0; at < encoded.length; at += lineLength) lines.push(encoded.slice(at, at + lineLength));
  return lines.join('\n');
};
const ORACLE_WHITESPACE = new Set(['\t', '\n', '\f', '\r', ' ']);
const ORACLE_VALUE = new Map<string, number>([
  ...[...ORACLE_STANDARD].map((c, i) => [c, i] as const),
  ['-', 62],
  ['_', 63],
]);
const oracleDescribe = (char: string): string =>
  /^[\p{White_Space}\p{Cc}\p{Cf}\p{Cs}]$/u.test(char)
    ? `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`
    : `"${char}"`;
const oraclePosition = (input: string, offset: number) => {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < input.length; i++)
    if (input[i] === '\n') {
      line++;
      lineStart = i + 1;
    }
  return { line, column: offset - lineStart + 1 };
};
const oracleParse = (input: string): ParseBase64Result => {
  const fail = (offset: number, message: string): ParseBase64Result => ({
    ok: false,
    error: { message, offset, ...oraclePosition(input, offset) },
  });
  const chars: string[] = [];
  const offsets: number[] = [];
  let offset = 0;
  for (const char of input) {
    if (!ORACLE_WHITESPACE.has(char)) {
      chars.push(char);
      offsets.push(offset);
    }
    offset += char.length;
  }
  let length = chars.length;
  if (length % 4 === 0) {
    if (chars[length - 1] === '=') length--;
    if (chars[length - 1] === '=') length--;
  }
  for (let i = 0; i < length; i++) {
    const char = chars[i]!;
    if (ORACLE_VALUE.has(char)) continue;
    return fail(offsets[i]!, char === '=' ? 'misplaced padding "="' : `invalid character ${oracleDescribe(char)}`);
  }
  if (length % 4 === 1) return fail(offsets[length - 1]!, 'one character too many at the end');
  const bytes = new Uint8Array(Math.floor((length * 6) / 8));
  let buffer = 0;
  let bits = 0;
  let at = 0;
  for (let i = 0; i < length; i++) {
    buffer = ((buffer << 6) | ORACLE_VALUE.get(chars[i]!)!) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[at++] = (buffer >> bits) & 0xff;
    }
  }
  return { ok: true, bytes };
};

/** Deterministic randomness (xorshift32), so a failure names an input that can be run again. */
const randomOf = (seed: number) => {
  let x = seed >>> 0 || 1;
  const next = () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 2 ** 32;
  };
  const int = (n: number) => Math.floor(next() * n);
  const bytes = (n: number) => Uint8Array.from({ length: n }, () => int(256));
  return { next, int, bytes, pick: <T>(items: readonly T[]): T => items[int(items.length)]! };
};

const OPTIONS: Base64Options[] = [];
for (const alphabet of ['standard', 'url'] as const)
  for (const padding of [true, false])
    for (const lineLength of [0, 64, 76] as const) OPTIONS.push({ alphabet, padding, lineLength });

/** What bends an input: characters outside the alphabets, the other alphabet, `=`, every kind of whitespace. */
const NOISE = [
  '!',
  'é',
  '😀',
  '=',
  '==',
  ' ',
  '\n',
  '\r\n',
  '\t',
  '\f',
  ' ',
  '\uD800',
  '\uDC00',
  '-',
  '_',
  '+',
  '/',
  '.',
  '\0',
];

/** Valid Base64 of either alphabet (wrapped, padded or not), then often bent by one to three edits. */
const inputOf = (random: ReturnType<typeof randomOf>): string => {
  let input = oracleEncode(random.bytes(random.int(64)), random.pick(OPTIONS));
  if (random.next() < 0.15) input = input.replace(/[A-Za-z]/, random.pick(['-', '_', '+', '/']));
  const edits = random.next() < 0.3 ? 0 : 1 + random.int(3);
  for (let e = 0; e < edits; e++) {
    const at = random.int(input.length + 1);
    const kind = random.int(3);
    if (kind === 0) input = input.slice(0, at) + random.pick(NOISE) + input.slice(at);
    else if (kind === 1) input = input.slice(0, at) + input.slice(at + 1);
    else input = input.slice(0, at) + random.pick(NOISE) + input.slice(at + 1);
  }
  return input;
};

const equalBytes = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

type Platform = Record<string, unknown>;
const hidePlatform = () => {
  const target = Uint8Array as unknown as Platform;
  const proto = Uint8Array.prototype as unknown as Platform;
  const from = Object.getOwnPropertyDescriptor(target, 'fromBase64');
  const to = Object.getOwnPropertyDescriptor(proto, 'toBase64');
  delete target.fromBase64;
  delete proto.toBase64;
  return () => {
    if (from) Object.defineProperty(target, 'fromBase64', from);
    if (to) Object.defineProperty(proto, 'toBase64', to);
  };
};
const platformPresent = () =>
  typeof (Uint8Array as unknown as Platform).fromBase64 === 'function' &&
  typeof (Uint8Array.prototype as unknown as Platform).toBase64 === 'function';
const PLATFORM = platformPresent();
const ENGINE = base64Engine();

describe.each([
  [`as the runtime has it (encode: ${ENGINE.encode}, decode: ${ENGINE.decode})`, false],
  ['with toBase64 / fromBase64 hidden (encode: tables, decode: tables)', true],
])('Base64 %s — the same answers as the module before', (_, hidden) => {
  let restore = () => {};
  beforeAll(() => {
    if (hidden) restore = hidePlatform();
  });
  afterAll(() => restore());

  it('the built-ins are there or hidden as the title says', () => {
    expect(platformPresent()).toBe(hidden ? false : PLATFORM);
    expect(base64Engine()).toEqual(hidden ? { encode: 'tables', decode: 'tables' } : ENGINE);
  });

  it('60,000 inputs, valid and broken: the same bytes, or the same refusal at the same place', () => {
    const random = randomOf(hidden ? 0x5eed : 0x5eee);
    let refused = 0;
    for (let n = 0; n < 60_000; n++) {
      const input = inputOf(random);
      const actual = parseBase64(input);
      const expected = oracleParse(input);
      if (!expected.ok) refused++;
      if (actual.ok !== expected.ok || (!actual.ok && JSON.stringify(actual) !== JSON.stringify(expected)))
        expect({ input, actual }).toEqual({ input, actual: expected });
      if (actual.ok && expected.ok) {
        // An array of its own, exact size: callers hand `bytes.buffer` on (a transfer, a Blob).
        if (actual.bytes.byteOffset !== 0 || actual.bytes.buffer.byteLength !== actual.bytes.length)
          expect({ input, size: actual.bytes.buffer.byteLength }).toEqual({ input, size: actual.bytes.length });
        if (!equalBytes(actual.bytes, expected.bytes))
          expect({ input, bytes: [...actual.bytes] }).toEqual({ input, bytes: [...expected.bytes] });
      }
    }
    expect(refused).toBeGreaterThan(15_000);
    expect(refused).toBeLessThan(50_000);
  });

  it('24,000 encodings, every alphabet, padding and line length: the same text', () => {
    const random = randomOf(hidden ? 0xc0de : 0xc0df);
    for (let n = 0; n < 24_000; n++) {
      const options = OPTIONS[n % OPTIONS.length]!;
      const bytes = random.bytes(random.int(n % 100 === 0 ? 2_000 : 200));
      const actual = bytesToBase64(bytes, options);
      const expected = oracleEncode(bytes, options);
      if (actual !== expected)
        expect({ options, bytes: [...bytes], actual }).toEqual({ options, bytes: [...bytes], actual: expected });
    }
  });

  it('every shape of padding and whitespace around the last group', () => {
    const bodies = ['', 'Q', 'QR', 'QUI', 'QUJD', 'QUJDRA', 'QUJDREU', 'QU-_', 'QU+/', 'QU+_'];
    const tails = ['', '=', '==', '===', ' =', '= =', '=\n=', '=  ', '=A', ' = = ', '\t\f\r\n'];
    for (const body of bodies)
      for (const tail of tails)
        for (const lead of ['', ' ', '\n']) {
          const input = lead + body + tail;
          expect([input, parseBase64(input)]).toEqual([input, oracleParse(input)]);
        }
  });

  it('a megabyte, wrapped or not, both alphabets, and one bad character at its end', () => {
    const bytes = randomOf(42).bytes(1024 * 1024 + 2);
    for (const options of OPTIONS) {
      const encoded = bytesToBase64(bytes, options);
      expect(encoded === oracleEncode(bytes, options)).toBe(true);
      const back = parseBase64(encoded);
      expect(back.ok && equalBytes(back.bytes, bytes)).toBe(true);
    }
    const broken = `${bytesToBase64(bytes)}!`;
    expect(parseBase64(broken)).toEqual(oracleParse(broken));
  });
});
