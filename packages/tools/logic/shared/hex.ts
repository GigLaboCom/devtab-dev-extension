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

/** Per byte, its two digits as two char codes in one entry (high digit first), lower and upper case. */
const pairsOf = (digits: string): Uint16Array =>
  Uint16Array.from({ length: 256 }, (_, b) => (digits.charCodeAt(b >> 4) << 8) | digits.charCodeAt(b & 15));
let pairsCache: { lower: Uint16Array; upper: Uint16Array } | null = null;

const codesOf = (text: string): Uint8Array => Uint8Array.from(text, c => c.charCodeAt(0));

/** ASCII bytes to a string in one call (ASCII reads the same in latin1). */
let latin1: { decode: (bytes: Uint8Array) => string } | null = null;

/**
 * Each byte as two hex digits, laid out as the format says; the `0x` / `\x` prefix stays lowercase. Written as ASCII
 * into one byte array and read as text once — no string per byte.
 */
export const bytesToHex = (bytes: Uint8Array, options: Partial<HexOptions> = {}): string => {
  const { format = 'plain', uppercase = false, bytesPerLine = 0 } = options;
  const n = bytes.length;
  if (n === 0) return '';
  const layout = LAYOUT[format];
  const prefix = codesOf(layout.prefix);
  const between = codesOf(layout.between);
  const lineEnd = codesOf(layout.lineEnd);
  pairsCache ??= { lower: pairsOf('0123456789abcdef'), upper: pairsOf('0123456789ABCDEF') };
  const pairs = uppercase ? pairsCache.upper : pairsCache.lower;
  const lineBreaks = bytesPerLine > 0 ? Math.floor((n - 1) / bytesPerLine) : 0;
  const out = new Uint8Array(
    n * (prefix.length + 2) + (n - 1 - lineBreaks) * between.length + lineBreaks * lineEnd.length,
  );
  let at = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const separator = bytesPerLine > 0 && i % bytesPerLine === 0 ? lineEnd : between;
      for (let k = 0; k < separator.length; k++) out[at++] = separator[k]!;
    }
    for (let k = 0; k < prefix.length; k++) out[at++] = prefix[k]!;
    const pair = pairs[bytes[i]!]!;
    out[at] = pair >> 8;
    out[at + 1] = pair & 255;
    at += 2;
  }
  return (latin1 ??= new TextDecoder('latin1')).decode(out);
};
