/**
 * The Random String tool's logic (docs/tools/specs/random-string.md §5, §9): strings of independent, uniformly chosen
 * characters of an alphabet (a preset or the person's own), or random bytes written in hex or Base64; a batch of them;
 * the entropy of the settings. Pure: no React, no DOM, no chrome, no logging. The only randomness is the `source`
 * parameter — `cryptoRandom` of @workspace/tools-shared/random by default, read through its `bufferedSource` — and every
 * character index comes from its `randomIndex` (rejection sampling over 32-bit draws: no modulo bias for an alphabet of
 * any size). Bytes are written by the shared `hex` and `base64` modules. The tool has no `detect` (§7): it takes no
 * input.
 *
 * The order a batch consumes its source (so the same source and settings give the same strings): the strings in order;
 * in Characters, each string's characters left to right, each character one 4-byte big-endian draw of `randomIndex`
 * (a draw at or above the largest multiple of the alphabet's size is thrown away and the next 4 bytes are drawn); in
 * Bytes, each string's bytes in order, taken as the source gave them. Reading goes through `bufferedSource`: the source
 * is asked for 4,096 bytes at a time, and what is left of the last block is not used.
 */
import { bytesToBase64 } from '@workspace/tools-shared/base64';
import { bytesToHex } from '@workspace/tools-shared/hex';
import { bufferedSource, cryptoRandom, randomIndex } from '@workspace/tools-shared/random';
import type { RandomSource } from '@workspace/tools-shared/random';

export type Preset =
  'alnum' | 'lower-digits' | 'letters' | 'digits' | 'hex' | 'HEX' | 'base64url' | 'crockford' | 'custom';
export type Encoding = 'hex' | 'HEX' | 'base64' | 'base64url';
export type Mode = 'chars' | 'bytes';

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';

/** The preset alphabets, their characters in the fixed order of §5.2 (the tests' values depend on it). */
export const PRESETS: Readonly<Record<Exclude<Preset, 'custom'>, string>> = {
  alnum: UPPER + LOWER + DIGITS,
  'lower-digits': LOWER + DIGITS,
  letters: UPPER + LOWER,
  digits: DIGITS,
  hex: `${DIGITS}abcdef`,
  HEX: `${DIGITS}ABCDEF`,
  base64url: `${UPPER}${LOWER}${DIGITS}-_`,
  crockford: '0123456789ABCDEFGHJKMNPQRSTVWXYZ',
};

/** The order of the Alphabet list (§4, §5.2). */
export const PRESET_ORDER: readonly Preset[] = [
  'alnum',
  'lower-digits',
  'letters',
  'digits',
  'hex',
  'HEX',
  'base64url',
  'crockford',
  'custom',
];

/** The names of §5.2, word for word. */
export const PRESET_LABELS: Readonly<Record<Preset, string>> = {
  alnum: 'Letters and digits',
  'lower-digits': 'Lowercase letters and digits',
  letters: 'Letters',
  digits: 'Digits',
  hex: 'Hex, lowercase',
  HEX: 'Hex, uppercase',
  base64url: 'Base64url alphabet',
  crockford: 'Crockford Base32',
  custom: 'Custom',
};

export const ENCODING_ORDER: readonly Encoding[] = ['hex', 'HEX', 'base64', 'base64url'];

/** The names of §4, word for word. */
export const ENCODING_LABELS: Readonly<Record<Encoding, string>> = {
  hex: 'Hex (lowercase)',
  HEX: 'Hex (uppercase)',
  base64: 'Base64',
  base64url: 'Base64url',
};

export const LIMITS = { length: 1024, bytes: 1024, count: 10_000, total: 1_000_000, alphabet: 1024 } as const;

/** At or under this many characters (or bytes) a batch is made on every change; above, 300 ms after the last (§12). */
export const LIVE_TOTAL = 100_000;
/** The wait before a batch over `LIVE_TOTAL` is made after a change (§12). */
export const SETTLE_MS = 300;

export type Settings =
  | { mode: 'chars'; preset: Preset; custom: string; length: number; count: number }
  | { mode: 'bytes'; bytes: number; encoding: Encoding; count: number };

/** The page as it opens (§4): 10 strings of 32 characters, Letters and digits; Bytes: 32 bytes, Hex (lowercase). */
export const DEFAULTS = {
  mode: 'chars',
  preset: 'alnum',
  custom: '',
  length: 32,
  bytes: 32,
  encoding: 'hex',
  count: 10,
} as const satisfies {
  mode: Mode;
  preset: Preset;
  custom: string;
  length: number;
  bytes: number;
  encoding: Encoding;
  count: number;
};

export type FieldError = {
  field: 'custom' | 'length' | 'bytes' | 'count' | 'total' | 'random';
  message: string;
};

const thousands = (n: number): string => n.toLocaleString('en-US');

/** A character of the alphabet named in a message: invisible and combining ones by their code points. */
const named = (symbol: string): string =>
  /[\p{M}\p{C}]/u.test(symbol)
    ? [...symbol].map(c => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`).join(' ')
    : `"${symbol}"`;

/** The texts of §6, word for word (and the few this implementation adds, §15 of the specification). */
export const MESSAGES = {
  length: `Length must be a whole number from 1 to ${thousands(LIMITS.length)}.`,
  bytes: `Bytes must be a whole number from 1 to ${thousands(LIMITS.bytes)}.`,
  count: `How many must be a whole number from 1 to ${thousands(LIMITS.count)}.`,
  totalChars: `Too much at once: length × how many must be at most ${thousands(LIMITS.total)}.`,
  totalBytes: `Too much at once: bytes × how many must be at most ${thousands(LIMITS.total)}.`,
  customEmpty: 'Type the characters to use.',
  customTwo: 'The alphabet needs at least 2 different characters.',
  customSpace: 'Remove spaces and line breaks from the alphabet.',
  customMany: `The alphabet can have at most ${thousands(LIMITS.alphabet)} characters.`,
  customHalf: (symbol: string): string => `Remove ${named(symbol)} from the alphabet: it is not a whole character.`,
  customJoins: (symbol: string): string =>
    `Remove ${named(symbol)} from the alphabet: it joins the character next to it.`,
  random: 'Could not get random numbers from the browser.',
} as const;

/**
 * A number field's text as a whole decimal number (§3): digits only, otherwise NaN — so an empty field, a fraction, a
 * sign or an exponent is an error at the field, never a guess.
 */
export const parseWholeNumber = (text: string): number => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : NaN);

const within = (value: number, max: number): boolean => Number.isInteger(value) && value >= 1 && value <= max;

let segmenter: Intl.Segmenter | undefined;
/** The grapheme clusters of `text`, as the browser's own segmenter finds them (§3). */
const graphemes = (text: string): string[] => {
  segmenter ??= new Intl.Segmenter('en', { granularity: 'grapheme' });
  return Array.from(segmenter.segment(text), s => s.segment);
};
/** How many grapheme clusters `text` has. */
const graphemeCount = (text: string): number => {
  segmenter ??= new Intl.Segmenter('en', { granularity: 'grapheme' });
  const segments = segmenter.segment(text)[Symbol.iterator]();
  let n = 0;
  while (!segments.next().done) n++;
  return n;
};

/**
 * Does `symbol` stay one character next to any other? A string is a row of the alphabet's characters, so one that
 * merges with its neighbour — a lone combining mark or skin tone (joins the one before), a lone regional indicator
 * (pairs into a flag), a conjoining Hangul jamo, a character that ends in a virama or a zero-width joiner after an
 * emoji, a prepended concatenation mark (joins the one after) — would make a string show fewer characters than its
 * length and two different rows read the same. Checked with the segmenter itself: after a letter and after Hangul
 * syllables of both shapes, before a letter, and twice in a row. Printable ASCII never merges.
 */
const standsAlone = (symbol: string): boolean =>
  /^[!-~]$/.test(symbol) ||
  (graphemeCount(`a${symbol}`) === 2 &&
    graphemeCount(`가${symbol}`) === 2 &&
    graphemeCount(`각${symbol}`) === 2 &&
    graphemeCount(`${symbol}a`) === 2 &&
    graphemeCount(symbol + symbol) === 2);

/**
 * Grapheme clusters of `text`, first occurrence kept, or why they can't be an alphabet (§3, §6). Clusters compare by
 * code points, without Unicode normalisation: `e` + U+0301 and `é` are two characters. A character outside the Basic
 * Multilingual Plane (two UTF-16 units) is one character.
 */
export const parseAlphabet = (text: string): { ok: true; symbols: string[] } | { ok: false; error: FieldError } => {
  const fail = (message: string) => ({ ok: false as const, error: { field: 'custom' as const, message } });
  if (text === '') return fail(MESSAGES.customEmpty);
  if (/\s/u.test(text)) return fail(MESSAGES.customSpace);
  const seen = new Set<string>();
  const symbols: string[] = [];
  for (const symbol of graphemes(text)) {
    if (seen.has(symbol)) continue;
    if (/\p{Cs}/u.test(symbol)) return fail(MESSAGES.customHalf(symbol));
    if (!standsAlone(symbol)) return fail(MESSAGES.customJoins(symbol));
    seen.add(symbol);
    symbols.push(symbol);
    if (symbols.length > LIMITS.alphabet) return fail(MESSAGES.customMany);
  }
  if (symbols.length < 2) return fail(MESSAGES.customTwo);
  return { ok: true, symbols };
};

/** The characters strings are made of, or why not (a preset is always valid). */
export const alphabetOf = (
  preset: Preset,
  custom: string,
): { ok: true; symbols: string[] } | { ok: false; error: FieldError } =>
  preset === 'custom' ? parseAlphabet(custom) : { ok: true, symbols: [...PRESETS[preset]] };

/**
 * Entropy of one string in bits, unrounded (§5.4): Characters — length × log2 of the alphabet's size; Bytes — 8 per
 * byte. A property of the settings, not of a string. NaN when the settings are not valid.
 */
export const entropyPerString = (settings: Settings): number => {
  const checked = check(settings);
  return checked.ok ? checked.entropyBits : NaN;
};

/**
 * The entropy shown (§5.4): whole bits, rounded down — exactly. For an alphabet of `size` and `length` characters it is
 * ⌊log2(size^length)⌋, the bit length of size^length less one, computed in BigInt (size^length has up to 10,240 bits;
 * a double holds neither it nor, at an integer boundary, its logarithm to the last bit).
 */
export const wholeBits = (settings: Settings): number => {
  if (settings.mode === 'bytes') return 8 * settings.bytes;
  const alphabet = alphabetOf(settings.preset, settings.custom);
  if (!alphabet.ok) return NaN;
  const size = BigInt(alphabet.symbols.length);
  return (size ** BigInt(settings.length)).toString(2).length - 1;
};

/** The entropy line of §8: `190 bits of entropy per string`. */
export const entropyLine = (bits: number): string =>
  `${thousands(bits)} ${bits === 1 ? 'bit' : 'bits'} of entropy per string`;

/** What the screen reader hears for a new batch (§8): `10 strings generated`, `1 string generated`. */
export const generatedLine = (count: number): string =>
  `${thousands(count)} ${count === 1 ? 'string' : 'strings'} generated`;

export type Checked =
  { ok: true; entropyBits: number; symbols: string[] | null; total: number } | { ok: false; errors: FieldError[] };

/**
 * Checks every parameter and collects every problem (§6: each under its field); when all are valid, the entropy and the
 * alphabet (null in Bytes). `total` is length (or bytes) × how many. No randomness is drawn here.
 */
export const check = (settings: Settings): Checked => {
  const errors: FieldError[] = [];
  const countOk = within(settings.count, LIMITS.count);
  if (settings.mode === 'chars') {
    const alphabet = alphabetOf(settings.preset, settings.custom);
    if (!alphabet.ok) errors.push(alphabet.error);
    const lengthOk = within(settings.length, LIMITS.length);
    if (!lengthOk) errors.push({ field: 'length', message: MESSAGES.length });
    if (!countOk) errors.push({ field: 'count', message: MESSAGES.count });
    const total = settings.length * settings.count;
    if (lengthOk && countOk && total > LIMITS.total) errors.push({ field: 'total', message: MESSAGES.totalChars });
    if (errors.length > 0 || !alphabet.ok) return { ok: false, errors };
    return {
      ok: true,
      entropyBits: settings.length * Math.log2(alphabet.symbols.length),
      symbols: alphabet.symbols,
      total,
    };
  }
  const bytesOk = within(settings.bytes, LIMITS.bytes);
  if (!bytesOk) errors.push({ field: 'bytes', message: MESSAGES.bytes });
  if (!countOk) errors.push({ field: 'count', message: MESSAGES.count });
  const total = settings.bytes * settings.count;
  if (bytesOk && countOk && total > LIMITS.total) errors.push({ field: 'total', message: MESSAGES.totalBytes });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, entropyBits: 8 * settings.bytes, symbols: null, total };
};

/** Bytes written as §5.3 says: hex — two digits a byte; Base64 — RFC 4648 §4, padded; Base64url — §5, unpadded. */
export const encodeBytes = (bytes: Uint8Array, encoding: Encoding): string =>
  encoding === 'hex' || encoding === 'HEX'
    ? bytesToHex(bytes, { uppercase: encoding === 'HEX' })
    : bytesToBase64(bytes, encoding === 'base64' ? {} : { alphabet: 'url', padding: false });

/** The length of one written string of `n` bytes (§5.3): hex 2n; Base64 4·⌈n/3⌉; Base64url ⌈4n/3⌉. */
export const encodedLength = (n: number, encoding: Encoding): number =>
  encoding === 'hex' || encoding === 'HEX'
    ? 2 * n
    : encoding === 'base64'
      ? 4 * Math.ceil(n / 3)
      : Math.ceil((4 * n) / 3);

export type Generated =
  /** `bytes` (Bytes mode only): every string's bytes as the source gave them, one after another — `count × bytes`. */
  | { ok: true; values: string[]; entropyBits: number; bytes?: Uint8Array }
  /** Every invalid field at once. */
  | { ok: false; errors: FieldError[] };

/**
 * A batch (§5): checks every parameter first and draws randomness only when all are valid; a failing source is the
 * error `random`. The order the source is consumed in is in this module's header.
 */
export const generate = (settings: Settings, source: RandomSource = cryptoRandom): Generated => {
  const checked = check(settings);
  if (!checked.ok) return checked;
  const buffered = bufferedSource(source);
  const values: string[] = new Array<string>(settings.count);
  try {
    if (settings.mode === 'chars') {
      const symbols = checked.symbols!;
      const size = symbols.length;
      const row = new Array<string>(settings.length);
      for (let s = 0; s < settings.count; s++) {
        for (let i = 0; i < settings.length; i++) row[i] = symbols[randomIndex(size, buffered)]!;
        values[s] = row.join('');
      }
      return { ok: true, values, entropyBits: checked.entropyBits };
    }
    const all = new Uint8Array(checked.total);
    buffered(all);
    for (let s = 0; s < settings.count; s++)
      values[s] = encodeBytes(all.subarray(s * settings.bytes, (s + 1) * settings.bytes), settings.encoding);
    return { ok: true, values, entropyBits: checked.entropyBits, bytes: all };
  } catch {
    return { ok: false, errors: [{ field: 'random', message: MESSAGES.random }] };
  }
};

/**
 * Do `values` read as a batch of `settings` — the right number of strings, each the right length and of the alphabet
 * only? For an entry opened from the history, which comes from storage or a file and is checked, never trusted.
 */
export const fitsSettings = (values: readonly string[], settings: Settings): boolean => {
  const checked = check(settings);
  if (!checked.ok || values.length !== settings.count) return false;
  if (settings.mode === 'bytes') {
    const length = encodedLength(settings.bytes, settings.encoding);
    return values.every(v => v.length === length);
  }
  const symbols = new Set(checked.symbols);
  return values.every(v => {
    const parts = settings.preset === 'custom' ? graphemes(v) : [...v];
    return parts.length === settings.length && parts.every(c => symbols.has(c));
  });
};
