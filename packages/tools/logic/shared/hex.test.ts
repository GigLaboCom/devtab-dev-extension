import { bytesToHex } from './hex';
import { describe, expect, it } from 'vitest';
import type { HexFormat } from './hex';

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
