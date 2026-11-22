import { bytesToHex } from './hex';
import { describe, expect, it } from 'vitest';
import type { HexFormat, HexOptions } from './hex';

const HELLO = new TextEncoder().encode('Hello');

describe('bytesToHex (hex-ascii.md §5 «Байты → hex»)', () => {
  it('without options: plain lowercase digits', () => {
    expect(bytesToHex(HELLO)).toBe('48656c6c6f');
    expect(bytesToHex(new Uint8Array([0, 15, 255]))).toBe('000fff');
    expect(bytesToHex(new Uint8Array())).toBe('');
  });

  it.each<[HexFormat, string]>([
    ['plain', '48656c6c6f'],
    ['spaced', '48 65 6c 6c 6f'],
    ['colons', '48:65:6c:6c:6f'],
    ['commas', '48, 65, 6c, 6c, 6f'],
    ['c', '0x48, 0x65, 0x6c, 0x6c, 0x6f'],
    ['escaped', '\\x48\\x65\\x6c\\x6c\\x6f'],
  ])('%s: the table’s example', (format, expected) => {
    expect(bytesToHex(HELLO, { format })).toBe(expected);
  });

  it('uppercase changes the digits, never the 0x or \\x prefix', () => {
    const bytes = new Uint8Array([0x4f, 0xab]);
    expect(bytesToHex(bytes, { uppercase: true })).toBe('4FAB');
    expect(bytesToHex(bytes, { format: 'c', uppercase: true })).toBe('0x4F, 0xAB');
    expect(bytesToHex(bytes, { format: 'escaped', uppercase: true })).toBe('\\x4F\\xAB');
  });

  it('wraps after bytesPerLine bytes: the line break replaces the separator, commas keep theirs', () => {
    const bytes = Uint8Array.from({ length: 10 }, (_, i) => i);
    expect(bytesToHex(bytes, { format: 'spaced', bytesPerLine: 8 })).toBe('00 01 02 03 04 05 06 07\n08 09');
    expect(bytesToHex(bytes, { format: 'commas', bytesPerLine: 8 })).toBe('00, 01, 02, 03, 04, 05, 06, 07,\n08, 09');
    expect(bytesToHex(bytes.subarray(0, 8), { format: 'plain', bytesPerLine: 8 })).toBe('0001020304050607');
  });
});

// The function before the byte table, kept as the oracle: the new one must give the same text for every input.
const ORACLE_LAYOUT: Record<HexFormat, { prefix: string; between: string; lineEnd: string }> = {
  plain: { prefix: '', between: '', lineEnd: '\n' },
  spaced: { prefix: '', between: ' ', lineEnd: '\n' },
  colons: { prefix: '', between: ':', lineEnd: '\n' },
  commas: { prefix: '', between: ', ', lineEnd: ',\n' },
  c: { prefix: '0x', between: ', ', lineEnd: ',\n' },
  escaped: { prefix: '\\x', between: '', lineEnd: '\n' },
};
const ORACLE_DIGITS = Array.from({ length: 256 }, (_, b) => b.toString(16).padStart(2, '0'));
const oracle = (bytes: Uint8Array, options: Partial<HexOptions> = {}): string => {
  const { format = 'plain', uppercase = false, bytesPerLine = 0 } = options;
  const { prefix, between, lineEnd } = ORACLE_LAYOUT[format];
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    if (i > 0) parts.push(bytesPerLine > 0 && i % bytesPerLine === 0 ? lineEnd : between);
    const digits = ORACLE_DIGITS[bytes[i]!]!;
    parts.push(prefix, uppercase ? digits.toUpperCase() : digits);
  }
  return parts.join('');
};

describe('bytesToHex by table: the same text as before (properties)', () => {
  const formats: HexFormat[] = ['plain', 'spaced', 'colons', 'commas', 'c', 'escaped'];
  const widths: HexOptions['bytesPerLine'][] = [0, 8, 16, 32];

  it('every format × case × line width on 20,000 random arrays, views into larger buffers included', () => {
    let x = 0x2545f491;
    const next = (n: number) => {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      return (x >>> 0) % n;
    };
    for (let round = 0; round < 20_000; round++) {
      const length = next(round % 50 === 0 ? 300 : 70);
      const whole = Uint8Array.from({ length: length + 2 }, () => next(256));
      const bytes = round % 3 === 0 ? whole.subarray(1, length + 1) : whole.slice(0, length);
      const options = { format: formats[round % 6]!, uppercase: round % 7 < 3, bytesPerLine: widths[round % 4]! };
      const actual = bytesToHex(bytes, options);
      const expected = oracle(bytes, options);
      if (actual !== expected)
        expect({ bytes: [...bytes], options, actual }).toEqual({ bytes: [...bytes], options, actual: expected });
    }
  });

  it('a megabyte of every byte value, each format and width', () => {
    const bytes = Uint8Array.from({ length: 1 << 20 }, (_, i) => (i * 7919) & 255);
    for (const format of formats)
      for (const bytesPerLine of widths)
        expect(bytesToHex(bytes, { format, bytesPerLine }) === oracle(bytes, { format, bytesPerLine })).toBe(true);
  });
});
