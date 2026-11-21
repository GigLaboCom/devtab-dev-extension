/**
 * Bytes as hex digits (docs/tools/specs/hex-ascii.md §5 «Байты → hex», §9). `bytesToHex(bytes)` with no options is
 * plain lowercase digits — how `hash` and `uuid` call it; `base64` shows bytes that are not UTF-8 as `spaced`.
 * `hexDump` and `parseHex` of the same specification come with the `hex-ascii` tool, which needs them.
 */

export type HexFormat = 'plain' | 'spaced' | 'colons' | 'commas' | 'c' | 'escaped';

export interface HexOptions {
  format: HexFormat;
  uppercase: boolean;
  /** 0 = no wrapping. */
  bytesPerLine: 0 | 8 | 16 | 32;
}

/** Per format: what goes before each byte, between bytes, and between lines (instead of the byte separator). */
const LAYOUT: Record<HexFormat, { prefix: string; between: string; lineEnd: string }> = {
  plain: { prefix: '', between: '', lineEnd: '\n' },
  spaced: { prefix: '', between: ' ', lineEnd: '\n' },
  colons: { prefix: '', between: ':', lineEnd: '\n' },
  commas: { prefix: '', between: ', ', lineEnd: ',\n' },
  c: { prefix: '0x', between: ', ', lineEnd: ',\n' },
  escaped: { prefix: '\\x', between: '', lineEnd: '\n' },
};

const DIGITS = Array.from({ length: 256 }, (_, b) => b.toString(16).padStart(2, '0'));

/** Each byte as two hex digits, laid out as the format says; the `0x` / `\x` prefix stays lowercase. */
export const bytesToHex = (bytes: Uint8Array, options: Partial<HexOptions> = {}): string => {
  const { format = 'plain', uppercase = false, bytesPerLine = 0 } = options;
  const { prefix, between, lineEnd } = LAYOUT[format];
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    if (i > 0) parts.push(bytesPerLine > 0 && i % bytesPerLine === 0 ? lineEnd : between);
    const digits = DIGITS[bytes[i]!]!;
    parts.push(prefix, uppercase ? digits.toUpperCase() : digits);
  }
  return parts.join('');
};
