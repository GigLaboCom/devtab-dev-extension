/**
 * Percent-encoding and decoding of text (docs/tools/specs/url.md §5 «Кодирование», «Декодирование»): the bytes are
 * UTF-8 (a lone surrogate becomes U+FFFD); hex digits upper case (RFC 3986 §2.1). What stays as is depends on the
 * style: `component` — RFC 3986 «unreserved» (§2.3), space `%20`; `form` — the URL Standard's
 * application/x-www-form-urlencoded set (§1.3, §5.2), space `+`, as URLSearchParams; `whole` — ECMA-262 encodeURI's
 * set plus `[`, `]` and an existing `%XX`. Decoding is the URL Standard's percent-decode (§1.3) once, then UTF-8 decode
 * without BOM (WHATWG Encoding §6): invalid bytes become U+FFFD, a leading BOM is kept; `+` is a space only when asked.
 */

export type EncodeStyle = 'component' | 'form' | 'whole';

export interface DecodeOptions {
  plusAsSpace: boolean;
}

export interface DecodeResult {
  text: string;
  /** `%` not followed by two hex digits, left as is. */
  malformed: number;
  /** Some bytes were not UTF-8 and became U+FFFD. */
  invalidUtf8: boolean;
}

const HEX = '0123456789ABCDEF';
const escapeByte = (b: number): string => `%${HEX[b >> 4]}${HEX[b & 15]}`;

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const KEPT: Readonly<Record<EncodeStyle, string>> = {
  component: `${ALNUM}-._~`,
  form: `${ALNUM}*-._`,
  whole: `${ALNUM}-_.!~*'();/?:@&=+$,#[]`,
};

/** For each style, what each byte becomes: itself or `%XX`. */
const TABLES = Object.fromEntries(
  (Object.keys(KEPT) as EncodeStyle[]).map(style => {
    const table: string[] = [];
    for (let b = 0; b < 256; b++)
      table.push(KEPT[style].includes(String.fromCharCode(b)) ? String.fromCharCode(b) : escapeByte(b));
    if (style === 'form') table[0x20] = '+';
    return [style, table];
  }),
) as Record<EncodeStyle, string[]>;

const isHexByte = (b: number | undefined): boolean =>
  b !== undefined && ((b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x46) || (b >= 0x61 && b <= 0x66));

const utf8 = new TextEncoder();

/** For each style, per byte: the char code it stays as, or 0 when it becomes `%XX`. */
const KEPT_CODES = Object.fromEntries(
  (Object.keys(TABLES) as EncodeStyle[]).map(style => [
    style,
    Uint8Array.from(TABLES[style], to => (to.length === 1 ? to.charCodeAt(0) : 0)),
  ]),
) as Record<EncodeStyle, Uint8Array>;
const HEX_CODES = Uint8Array.from(HEX, c => c.charCodeAt(0));
const PERCENT = 0x25;
/** The output is ASCII only, which reads the same in latin1. */
const ascii = new TextDecoder('latin1');

/**
 * Percent-encodes `text` as UTF-8 in the given style (§5 «Кодирование»). Never throws, a lone surrogate included.
 * Written as ASCII into one byte array (at most three bytes per byte) and read as text once — no string per byte.
 */
export const encodeUrl = (text: string, style: EncodeStyle): string => {
  const bytes = utf8.encode(text);
  const kept = KEPT_CODES[style];
  const whole = style === 'whole';
  const out = new Uint8Array(bytes.length * 3);
  let at = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    const to = kept[b]!;
    if (to !== 0) out[at++] = to;
    // Whole URL keeps an escape that is already there: `%` and two hex digits, in either case.
    else if (whole && b === PERCENT && isHexByte(bytes[i + 1]) && isHexByte(bytes[i + 2])) out[at++] = PERCENT;
    else {
      out[at] = PERCENT;
      out[at + 1] = HEX_CODES[b >> 4]!;
      out[at + 2] = HEX_CODES[b & 15]!;
      at += 3;
    }
  }
  return ascii.decode(out.subarray(0, at));
};

const hexValue = (b: number): number => (b <= 0x39 ? b - 0x30 : (b | 0x20) - 0x57);
const lenient = new TextDecoder('utf-8', { ignoreBOM: true });
const strict = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });

/** Percent-decodes `text` once and reads the bytes as UTF-8 (§5 «Декодирование»). Never throws. */
export const decodeUrl = (text: string, options: DecodeOptions): DecodeResult => {
  const source = options.plusAsSpace ? text.replaceAll('+', ' ') : text;
  const bytes = utf8.encode(source);
  const out = new Uint8Array(bytes.length);
  let n = 0;
  let malformed = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b === 0x25) {
      const hi = bytes[i + 1];
      const lo = bytes[i + 2];
      if (isHexByte(hi) && isHexByte(lo)) {
        out[n++] = (hexValue(hi!) << 4) | hexValue(lo!);
        i += 2;
        continue;
      }
      malformed++;
    }
    out[n++] = b;
  }
  const decoded = out.subarray(0, n);
  try {
    return { text: strict.decode(decoded), malformed, invalidUtf8: false };
  } catch {
    return { text: lenient.decode(decoded), malformed, invalidUtf8: true };
  }
};
