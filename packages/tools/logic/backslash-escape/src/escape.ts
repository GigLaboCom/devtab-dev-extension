/**
 * Escape (docs/tools/specs/backslash-escape.md §5, «Escape»): text to the contents of a string literal. One walk over the
 * text, shared by every dialect; what differs — which characters a dialect writes as escapes and how — is the dialect's
 * rules below, picked once per call. Printable ASCII other than the backslash and the quote is copied in runs.
 */
import { hex } from './text';
import type { Dialect, EscapeOptions, Quote } from './types';

interface EscapeRules {
  /** Which quote the result is escaped for and wrapped in, from the one chosen (§4: JSON and C have only "). */
  quotes: readonly Quote[];
  /**
   * The escape of a code point below U+00A0 or of U+2028 / U+2029, or null to keep it as is. `next` is the code unit
   * after it (-1 at the end): JavaScript's `\0` must not be followed by a digit.
   */
  special: (cp: number, next: number) => string | null;
  /** A code point above U+007F under Escape non-ASCII, when `special` keeps it. */
  nonAscii: (cp: number) => string;
  /** An unpaired surrogate. */
  loneSurrogate: (unit: number, nonAscii: boolean) => string;
}

// Tables, not formatting per character: Escape non-ASCII of 5 Mi of Cyrillic writes millions of escapes.
const HEX2 = Array.from({ length: 256 }, (_, n) => hex(n, 2));
const OCTAL3 = Array.from({ length: 256 }, (_, n) => `\\${n.toString(8).padStart(3, '0')}`);

const u4 = (unit: number): string => `\\u${HEX2[unit >> 8]}${HEX2[unit & 0xff]}`;
const x2 = (n: number): string => `\\x${HEX2[n]}`;
const octal3 = (n: number): string => OCTAL3[n]!;

/** The UTF-8 bytes of a code point (not a surrogate), each as a C octal escape. */
const utf8Octal = (cp: number): string => {
  if (cp < 0x80) return OCTAL3[cp]!;
  if (cp < 0x800) return OCTAL3[0xc0 | (cp >> 6)]! + OCTAL3[0x80 | (cp & 0x3f)]!;
  if (cp < 0x10000)
    return OCTAL3[0xe0 | (cp >> 12)]! + OCTAL3[0x80 | ((cp >> 6) & 0x3f)]! + OCTAL3[0x80 | (cp & 0x3f)]!;
  return (
    OCTAL3[0xf0 | (cp >> 18)]! +
    OCTAL3[0x80 | ((cp >> 12) & 0x3f)]! +
    OCTAL3[0x80 | ((cp >> 6) & 0x3f)]! +
    OCTAL3[0x80 | (cp & 0x3f)]!
  );
};

/** \u escapes of a code point, a surrogate pair above U+FFFF (JSON, JavaScript). */
const utf16Escapes = (cp: number): string =>
  cp > 0xffff ? u4(0xd800 + ((cp - 0x10000) >> 10)) + u4(0xdc00 + ((cp - 0x10000) & 0x3ff)) : u4(cp);

const isLineSeparator = (cp: number): boolean => cp === 0x2028 || cp === 0x2029;

const JSON_SHORT: Readonly<Record<number, string>> = { 8: '\\b', 9: '\\t', 10: '\\n', 12: '\\f', 13: '\\r' };
const JS_SHORT: Readonly<Record<number, string>> = { ...JSON_SHORT, 11: '\\v' };
const PYTHON_SHORT: Readonly<Record<number, string>> = { 9: '\\t', 10: '\\n', 13: '\\r' };
const C_SHORT: Readonly<Record<number, string>> = { ...JS_SHORT, 7: '\\a' };

const RULES: Readonly<Record<Dialect, EscapeRules>> = {
  // Exactly JSON.stringify(text).slice(1, -1): \uXXXX for the controls without a short form, nothing else escaped.
  json: {
    quotes: ['"'],
    special: cp => (cp < 0x20 ? (JSON_SHORT[cp] ?? u4(cp)) : null),
    nonAscii: utf16Escapes,
    loneSurrogate: u4,
  },
  // Short forms where they exist; \0 becomes \x00 before a digit (it would read as octal); no octal is written.
  js: {
    quotes: ['"', "'", '`'],
    special: (cp, next) => {
      if (cp === 0) return next >= 0x30 && next <= 0x39 ? '\\x00' : '\\0';
      if (cp < 0x20) return JS_SHORT[cp] ?? x2(cp);
      if (cp >= 0x7f && cp <= 0x9f) return x2(cp);
      return isLineSeparator(cp) ? u4(cp) : null;
    },
    nonAscii: utf16Escapes,
    loneSurrogate: u4,
  },
  // As repr(): of the short forms only \t \n \r; as ascii() under Escape non-ASCII.
  python: {
    quotes: ['"', "'"],
    special: cp => {
      if (cp < 0x20) return PYTHON_SHORT[cp] ?? x2(cp);
      if (cp >= 0x7f && cp <= 0x9f) return x2(cp);
      return isLineSeparator(cp) ? u4(cp) : null;
    },
    nonAscii: cp => (cp <= 0xff ? x2(cp) : cp <= 0xffff ? u4(cp) : `\\U${hex(cp, 8)}`),
    loneSurrogate: u4,
  },
  // Short forms, other controls always three octal digits (\x is greedy in C); non-ASCII as UTF-8 bytes; an unpaired
  // surrogate has no UTF-8, so it becomes U+FFFD.
  c: {
    quotes: ['"'],
    special: cp => (cp < 0x20 ? (C_SHORT[cp] ?? octal3(cp)) : cp === 0x7f ? octal3(cp) : null),
    nonAscii: utf8Octal,
    loneSurrogate: (_unit, nonAscii) => (nonAscii ? '\\357\\277\\275' : '�'),
  },
};

/** The quotes a dialect knows (§4): JSON and C only ", JavaScript ", ' and `, Python " and '. */
export const quotesFor = (dialect: Dialect): readonly Quote[] => RULES[dialect].quotes;

/** The quote the dialect actually uses for the chosen one: " when the dialect does not have it. */
export const quoteFor = (dialect: Dialect, quote: Quote): Quote =>
  RULES[dialect].quotes.includes(quote) ? quote : '"';

/** Text to the contents of a string literal of the dialect (§5). Escape has no errors; any text is taken. */
export const escapeString = (text: string, options: EscapeOptions): string => {
  const rules = RULES[options.dialect];
  const quote = quoteFor(options.dialect, options.quote);
  const quoteUnit = quote.charCodeAt(0);
  const template = quote === '`';
  const { nonAscii } = options;
  const n = text.length;
  let out = '';
  let run = 0;
  for (let i = 0; i < n; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0x20 && unit < 0x7f) {
      let escaped: string | null = null;
      if (unit === 0x5c) escaped = '\\\\';
      else if (unit === quoteUnit) escaped = `\\${quote}`;
      else if (template && unit === 0x24 && text.charCodeAt(i + 1) === 0x7b) escaped = '\\$';
      if (escaped !== null) {
        out += text.slice(run, i) + escaped;
        run = i + 1;
      }
      continue;
    }
    let cp = unit;
    let width = 1;
    let lone = false;
    if (unit >= 0xd800 && unit <= 0xdfff) {
      const next = text.charCodeAt(i + 1);
      if (unit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
        cp = 0x10000 + ((unit - 0xd800) << 10) + (next - 0xdc00);
        width = 2;
      } else lone = true;
    }
    let escaped: string | null;
    if (lone) escaped = rules.loneSurrogate(unit, nonAscii);
    else {
      escaped =
        cp < 0xa0 || isLineSeparator(cp) ? rules.special(cp, i + width < n ? text.charCodeAt(i + width) : -1) : null;
      if (escaped === null && nonAscii && cp > 0x7f) escaped = rules.nonAscii(cp);
    }
    if (escaped !== null) {
      out += text.slice(run, i) + escaped;
      run = i + width;
    }
    i += width - 1;
  }
  out += text.slice(run);
  return options.withQuotes ? quote + out + quote : out;
};
