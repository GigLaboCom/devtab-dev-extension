/**
 * Unescape (docs/tools/specs/backslash-escape.md §5, «Unescape»; §6): the contents of a string literal back to text. Our
 * own reader — the person's text is never evaluated. One walk shared by the dialects: plain runs are copied up to the
 * next backslash (found with indexOf), and the dialect's reader takes the escape that starts there. JSON, JavaScript and
 * Python decode to text; C decodes to bytes, which are read as UTF-8 at the end.
 */
import { quotesFor } from './escape';
import {
  countLoneSurrogates,
  hexAt,
  hexDigit,
  isDecimalDigit,
  isOctalDigit,
  isSurrogate,
  lineBreakAt,
  positionOf,
} from './text';
import { DIALECTS, DIALECT_NAMES } from './types';
import type { Dialect, UnescapeOptions, UnescapeResult } from './types';

interface Failure {
  message: string;
  offset: number;
}

/** What the text dialects write into while reading. */
class TextOut {
  text = '';
  fail: Failure | null = null;
  /** Python: the unknown escapes kept with their backslash, distinct, in order. */
  readonly kept: string[] = [];
  private readonly keptSeen = new Set<string>();
  /** Python: surrogate code points, from escapes and unpaired in the plain text, in order. */
  surrogates = 0;
  firstSurrogate: number | null = null;

  keep(sequence: string): void {
    this.text += sequence;
    if (this.keptSeen.has(sequence)) return;
    this.keptSeen.add(sequence);
    this.kept.push(sequence);
  }

  surrogate(unit: number): void {
    if (this.firstSurrogate === null) this.firstSurrogate = unit;
    this.surrogates++;
  }
}

/** What C writes into: bytes, read as UTF-8 at the end. Plain text goes in as its own UTF-8. */
class ByteOut {
  fail: Failure | null = null;
  private bytes: Uint8Array;
  private length = 0;
  private static readonly encoder = new TextEncoder();

  constructor(sizeHint: number) {
    this.bytes = new Uint8Array(Math.max(16, sizeHint));
  }

  private room(n: number): void {
    if (this.length + n <= this.bytes.length) return;
    const grown = new Uint8Array(Math.max(this.bytes.length * 2, this.length + n));
    grown.set(this.bytes.subarray(0, this.length));
    this.bytes = grown;
  }

  byte(b: number): void {
    this.room(1);
    this.bytes[this.length++] = b;
  }

  /** Plain text, or a code point's UTF-8 (an unpaired surrogate in plain text becomes U+FFFD's bytes). */
  text(s: string): void {
    this.room(s.length * 3);
    this.length += ByteOut.encoder.encodeInto(s, this.bytes.subarray(this.length)).written;
  }

  /** The bytes as UTF-8 without checking (§5, «Байты в C»): U+FFFD where they are not UTF-8; a BOM is kept. */
  decode(): { text: string; invalid: boolean } {
    const bytes = this.bytes.subarray(0, this.length);
    try {
      return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes), invalid: false };
    } catch {
      return { text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes), invalid: true };
    }
  }
}

type Reader<Out> = (text: string, at: number, end: number, out: Out) => number;

// The messages of §5 (after "Line L, column C: ").
const LONE_BACKSLASH = 'lone backslash at the end';
const U4 = '\\u needs exactly 4 hex digits';
const X2 = '\\x needs exactly 2 hex digits';
const X_ANY = '\\x needs hex digits';
const X_BYTE = '\\x value is larger than FF (one byte)';
const OCTAL_BYTE = 'octal escape is larger than 377 (one byte)';
const OCTAL_JS = 'octal escapes and \\8, \\9 are not allowed in JavaScript strict mode';
const BRACES = '\\u{…} needs hex digits and a closing brace';
const ABOVE = 'code point above 10FFFF';
const U8 = '\\U needs exactly 8 hex digits';
const NAMED = 'named escapes \\N{…} are not supported';
const JSON_LINE_BREAK = 'a backslash before a line break is not allowed in JSON';

const CONTROL: Readonly<Record<string, string>> = {
  a: '\x07',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
};

/**
 * Which escapes have a meaning of their own in each dialect, by the character after the backslash — for the hint of §5
 * item 4. JavaScript's identity escapes (`\a` → `a`) and Python's kept unknown escapes are not a meaning; neither is
 * `\N`, which Python has but this tool refuses.
 */
const MEANINGFUL: Readonly<Record<Dialect, string>> = {
  json: '"\\/bfnrtu',
  js: '"\'\\bfnrtv0xu',
  python: '"\'\\abfnrtv01234567xuU',
  c: '"\'?\\abfnrtv01234567xuU',
};

const fail = (out: { fail: Failure | null }, message: string, offset: number): number => {
  out.fail = { message, offset };
  return -1;
};

/** `unknown escape "\q" in JSON.` and, when other dialects read it, which (§5 item 4). */
const unknownEscape = (text: string, at: number, dialect: Dialect): string => {
  const ch = String.fromCodePoint(text.codePointAt(at + 1)!);
  const others = DIALECTS.filter(d => d !== dialect && MEANINGFUL[d].includes(ch));
  const hint = others.length ? ` It is an escape in ${others.map(d => DIALECT_NAMES[d]).join(', ')}.` : '';
  return `unknown escape "\\${ch}" in ${DIALECT_NAMES[dialect]}.${hint}`;
};

const readJson: Reader<TextOut> = (text, at, end, out) => {
  const ch = text[at + 1]!;
  switch (ch) {
    case '"':
    case '\\':
    case '/':
      out.text += ch;
      return at + 2;
    case 'b':
    case 'f':
    case 'n':
    case 'r':
    case 't':
      out.text += CONTROL[ch];
      return at + 2;
    case 'u': {
      const unit = hexAt(text, at + 2, 4, end);
      if (unit < 0) return fail(out, U4, at);
      out.text += String.fromCharCode(unit);
      return at + 6;
    }
  }
  if (lineBreakAt(text, at + 1, end, false)) return fail(out, JSON_LINE_BREAK, at);
  return fail(out, unknownEscape(text, at, 'json'), at);
};

const readJs: Reader<TextOut> = (text, at, end, out) => {
  const ch = text[at + 1]!;
  switch (ch) {
    case '"':
    case "'":
    case '\\':
      out.text += ch;
      return at + 2;
    case 'b':
    case 'f':
    case 'n':
    case 'r':
    case 't':
    case 'v':
      out.text += CONTROL[ch];
      return at + 2;
    case '0':
      if (at + 2 < end && isDecimalDigit(text.charCodeAt(at + 2))) return fail(out, OCTAL_JS, at);
      out.text += '\0';
      return at + 2;
    case '1':
    case '2':
    case '3':
    case '4':
    case '5':
    case '6':
    case '7':
    case '8':
    case '9':
      return fail(out, OCTAL_JS, at);
    case 'x': {
      const value = hexAt(text, at + 2, 2, end);
      if (value < 0) return fail(out, X2, at);
      out.text += String.fromCharCode(value);
      return at + 4;
    }
    case 'u': {
      if (at + 2 < end && text.charCodeAt(at + 2) === 0x7b) {
        let i = at + 3;
        let value = 0;
        while (i < end) {
          const digit = hexDigit(text.charCodeAt(i));
          if (digit < 0) break;
          if (value <= 0x10ffff) value = value * 16 + digit;
          i++;
        }
        if (i === at + 3 || i >= end || text.charCodeAt(i) !== 0x7d) return fail(out, BRACES, at);
        if (value > 0x10ffff) return fail(out, ABOVE, at);
        out.text += String.fromCodePoint(value);
        return i + 1;
      }
      const unit = hexAt(text, at + 2, 4, end);
      if (unit < 0) return fail(out, U4, at);
      out.text += String.fromCharCode(unit);
      return at + 6;
    }
  }
  const lineBreak = lineBreakAt(text, at + 1, end, true);
  if (lineBreak) return at + 1 + lineBreak;
  // Any other character stands for itself (ECMA-262, NonEscapeCharacter).
  out.text += ch;
  return at + 2;
};

const readPython: Reader<TextOut> = (text, at, end, out) => {
  const ch = text[at + 1]!;
  switch (ch) {
    case '"':
    case "'":
    case '\\':
      out.text += ch;
      return at + 2;
    case 'a':
    case 'b':
    case 'f':
    case 'n':
    case 'r':
    case 't':
    case 'v':
      out.text += CONTROL[ch];
      return at + 2;
    case '0':
    case '1':
    case '2':
    case '3':
    case '4':
    case '5':
    case '6':
    case '7': {
      let i = at + 1;
      let value = 0;
      while (i < end && i < at + 4 && isOctalDigit(text.charCodeAt(i))) value = value * 8 + text.charCodeAt(i++) - 0x30;
      out.text += String.fromCharCode(value);
      return i;
    }
    case 'x': {
      const value = hexAt(text, at + 2, 2, end);
      if (value < 0) return fail(out, X2, at);
      out.text += String.fromCharCode(value);
      return at + 4;
    }
    case 'u': {
      const unit = hexAt(text, at + 2, 4, end);
      if (unit < 0) return fail(out, U4, at);
      if (isSurrogate(unit)) out.surrogate(unit);
      out.text += String.fromCharCode(unit);
      return at + 6;
    }
    case 'U': {
      const cp = hexAt(text, at + 2, 8, end);
      if (cp < 0) return fail(out, U8, at);
      if (cp > 0x10ffff) return fail(out, ABOVE, at);
      if (isSurrogate(cp)) out.surrogate(cp);
      out.text += String.fromCodePoint(cp);
      return at + 10;
    }
    case 'N':
      return fail(out, NAMED, at);
  }
  const lineBreak = lineBreakAt(text, at + 1, end, false);
  if (lineBreak) return at + 1 + lineBreak;
  // Python keeps an unknown escape with its backslash (since 3.12 with a warning).
  const sequence = `\\${String.fromCodePoint(text.codePointAt(at + 1)!)}`;
  out.keep(sequence);
  return at + sequence.length;
};

/** C11 §6.4.3: no universal character name below U+00A0 other than $, @ and `, and none for a surrogate. */
const validUniversalName = (cp: number): boolean =>
  !isSurrogate(cp) && (cp >= 0xa0 || cp === 0x24 || cp === 0x40 || cp === 0x60);

const C_BYTE: Readonly<Record<string, number>> = {
  '"': 0x22,
  "'": 0x27,
  '?': 0x3f,
  '\\': 0x5c,
  a: 0x07,
  b: 0x08,
  f: 0x0c,
  n: 0x0a,
  r: 0x0d,
  t: 0x09,
  v: 0x0b,
};

const readC: Reader<ByteOut> = (text, at, end, out) => {
  const ch = text[at + 1]!;
  const single = C_BYTE[ch];
  if (single !== undefined) {
    out.byte(single);
    return at + 2;
  }
  if (isOctalDigit(text.charCodeAt(at + 1))) {
    let i = at + 1;
    let value = 0;
    while (i < end && i < at + 4 && isOctalDigit(text.charCodeAt(i))) value = value * 8 + text.charCodeAt(i++) - 0x30;
    if (value > 0xff) return fail(out, OCTAL_BYTE, at);
    out.byte(value);
    return i;
  }
  if (ch === 'x') {
    // As many hex digits as there are (C11 §6.4.4.4): "\x41B" is one escape.
    let i = at + 2;
    let value = 0;
    while (i < end) {
      const digit = hexDigit(text.charCodeAt(i));
      if (digit < 0) break;
      if (value <= 0xff) value = value * 16 + digit;
      i++;
    }
    if (i === at + 2) return fail(out, X_ANY, at);
    if (value > 0xff) return fail(out, X_BYTE, at);
    out.byte(value);
    return i;
  }
  if (ch === 'u' || ch === 'U') {
    const digits = ch === 'u' ? 4 : 8;
    const cp = hexAt(text, at + 2, digits, end);
    if (cp < 0) return fail(out, ch === 'u' ? U4 : U8, at);
    if (cp > 0x10ffff) return fail(out, ABOVE, at);
    if (!validUniversalName(cp))
      return fail(out, `${text.slice(at, at + 2 + digits)} is not a valid universal character name`, at);
    out.text(String.fromCodePoint(cp));
    return at + 2 + digits;
  }
  const lineBreak = lineBreakAt(text, at + 1, end, false);
  if (lineBreak) return at + 1 + lineBreak;
  return fail(out, unknownEscape(text, at, 'c'), at);
};

const ANY_SURROGATE = /[\uD800-\uDFFF]/;

/** Python: the unpaired surrogates of a plain run (a pair in the run is one code point). */
const countPlainSurrogates = (run: string, out: TextOut): void => {
  if (!ANY_SURROGATE.test(run)) return;
  for (let i = 0; i < run.length; i++) {
    const unit = run.charCodeAt(i);
    if (!isSurrogate(unit)) continue;
    const next = run.charCodeAt(i + 1);
    if (unit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) i++;
    else out.surrogate(unit);
  }
};

/** Walks [from, to): plain runs to `plain`, each escape to the reader. Returns the failure, or null. */
const walk = <Out extends { fail: Failure | null }>(
  text: string,
  from: number,
  to: number,
  read: Reader<Out>,
  out: Out,
  plain: (run: string) => void,
): Failure | null => {
  let pos = from;
  while (pos < to) {
    let backslash = text.indexOf('\\', pos);
    if (backslash === -1 || backslash >= to) backslash = to;
    if (backslash > pos) plain(text.slice(pos, backslash));
    if (backslash >= to) break;
    if (backslash + 1 >= to) return { message: LONE_BACKSLASH, offset: backslash };
    pos = read(text, backslash, to, out);
    if (pos < 0) return out.fail;
  }
  return null;
};

interface Decoded {
  text: string;
  keptUnknown: string[];
  loneSurrogates: number;
  firstLoneSurrogate: number | null;
  invalidUtf8: boolean;
}

type DialectReader = (text: string, from: number, to: number) => Decoded | Failure;

/** JSON and JavaScript: the text as decoded, unpaired surrogates counted in it (escapes of a pair make one character). */
const textReader =
  (read: Reader<TextOut>): DialectReader =>
  (text, from, to) => {
    const out = new TextOut();
    const failure = walk(text, from, to, read, out, run => (out.text += run));
    if (failure) return failure;
    const lone = countLoneSurrogates(out.text);
    return {
      text: out.text,
      keptUnknown: [],
      loneSurrogates: lone.count,
      firstLoneSurrogate: lone.first,
      invalidUtf8: false,
    };
  };

const READERS: Readonly<Record<Dialect, DialectReader>> = {
  json: textReader(readJson),
  js: textReader(readJs),
  // Python's strings are code points: '😀' is two surrogates, not one character, so they are counted as the
  // escapes make them (checked with Python 3.14: len 2, not equal to '\U0001f600').
  python: (text, from, to) => {
    const out = new TextOut();
    const failure = walk(text, from, to, readPython, out, run => {
      out.text += run;
      countPlainSurrogates(run, out);
    });
    if (failure) return failure;
    return {
      text: out.text,
      keptUnknown: out.kept,
      loneSurrogates: out.surrogates,
      firstLoneSurrogate: out.firstSurrogate,
      invalidUtf8: false,
    };
  },
  c: (text, from, to) => {
    // Every code unit is at most 3 bytes of UTF-8, and no escape gives more bytes than it has characters.
    const out = new ByteOut(3 * (to - from));
    const failure = walk(text, from, to, readC, out, run => out.text(run));
    if (failure) return failure;
    const decoded = out.decode();
    return {
      text: decoded.text,
      keptUnknown: [],
      loneSurrogates: 0,
      firstLoneSurrogate: null,
      invalidUtf8: decoded.invalid,
    };
  },
};

/** The quotes a dialect accepts around its text, for the With quotes error (§5): `" or '`. */
const listQuotes = (quotes: readonly string[]): string =>
  quotes.length === 1 ? quotes[0]! : `${quotes.slice(0, -1).join(', ')} or ${quotes.at(-1)}`;

/** The contents of a string literal of the dialect back to text (§5, §6). Our own reader; nothing is evaluated. */
export const unescapeString = (text: string, options: UnescapeOptions): UnescapeResult => {
  const failed = (message: string, offset: number): UnescapeResult => ({
    ok: false,
    error: { message, offset, ...positionOf(text, offset) },
  });
  let from = 0;
  let to = text.length;
  if (options.withQuotes) {
    const quotes = quotesFor(options.dialect);
    const start = text.length - text.trimStart().length;
    const end = text.trimEnd().length;
    const quote = text[start];
    if (
      end - start < 2 ||
      quote === undefined ||
      !(quotes as readonly string[]).includes(quote) ||
      text[end - 1] !== quote
    )
      return failed(`Expected text in ${listQuotes(quotes)} quotes`, Math.min(start, text.length));
    from = start + 1;
    to = end - 1;
  }
  const decoded = READERS[options.dialect](text, from, to);
  if ('message' in decoded) return failed(decoded.message, decoded.offset);
  return { ok: true, ...decoded };
};
