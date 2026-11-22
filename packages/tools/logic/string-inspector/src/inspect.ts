/**
 * The work over the whole text (docs/tools/specs/string-inspector.md §5.1, §5.5): the summary, the warnings and what
 * the four normalisation forms would change. Graphemes and words come from `Intl.Segmenter` with the locale `en`, so
 * the answer does not depend on the browser's language — but it does depend on the engine's Unicode data and its word
 * rules: Chrome 159 (Unicode 17) and Node 22.20 (Unicode 16, ICU 77.1) differ, and the tool reports what the browser
 * makes of the text (spec §15). Every pass is linear; the expressions have no nested repetition.
 */
import {
  MIXABLE_TESTS,
  LOOKALIKE_CLASS,
  hasPictographic,
  invisibleKindOf,
  isEmojiPart,
  lookalikeOf,
  markerOf,
} from './kinds.ts';
import { MAX_MARK_RUN } from './limits.ts';

export interface Summary {
  graphemes: number;
  codePoints: number;
  utf16Units: number;
  utf8Bytes: number;
  utf16Bytes: number;
  words: number;
  lines: number;
  /** `Not checked` when a run of combining marks is longer than MAX_MARK_RUN (spec §15). */
  normalization: 'NFC and NFD' | 'NFC' | 'NFD' | 'Neither' | 'Not checked';
}

export interface Warnings {
  /** Markers in the order they first appear, with how many times. */
  invisible: Array<{ marker: string; count: number }>;
  /** The markers of the bidirectional controls, in the order they first appear, without repeats. */
  bidi: string[];
  /** Words (segments that are word-like) with letters of two or more of Latin, Cyrillic, Greek, Armenian. */
  mixedScripts: Array<{ word: string; index: number; scripts: string[] }>;
  lookalikes: Array<{ char: string; ascii: string; count: number }>;
  loneSurrogates: number;
  /**
   * Code points with no character behind them in the engine's Unicode data — private use (Co), unassigned and
   * noncharacters (Cn) — in the order they first appear. Not in §5.5 of the draft; spec §15.
   */
  privateOrUnassigned: Array<{ codePoint: number; count: number }>;
}

export type NormalizationForm = 'NFC' | 'NFD' | 'NFKC' | 'NFKD';

/** What one normalisation form makes of the text: whether it changes it, and its size after. */
export interface FormResult {
  form: NormalizationForm;
  changes: boolean;
  codePoints: number;
  utf8Bytes: number;
}

export interface Inspection {
  summary: Summary;
  warnings: Warnings;
  /** null when the text was not normalised (`Not checked`). */
  forms: FormResult[] | null;
}

const GRAPHEMES = new Intl.Segmenter('en', { granularity: 'grapheme' });
const WORDS = new Intl.Segmenter('en', { granularity: 'word' });

/** Code points and UTF-8 bytes in one pass; a lone surrogate is one code point and 3 bytes (U+FFFD, as TextEncoder). */
export const measure = (text: string): { codePoints: number; utf8Bytes: number } => {
  let codePoints = 0;
  let utf8Bytes = 0;
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    codePoints++;
    if (c < 0x80) utf8Bytes += 1;
    else if (c < 0x800) utf8Bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < n) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        utf8Bytes += 4;
        i++;
      } else utf8Bytes += 3;
    } else utf8Bytes += 3;
  }
  return { codePoints, utf8Bytes };
};

/** `0` for an empty text, otherwise line breaks + 1; a line break is `\r\n`, `\n` or `\r` (§5.1). */
export const countLines = (text: string): number => {
  if (text === '') return 0;
  let lines = 1;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) lines++;
  for (let i = text.indexOf('\r'); i !== -1; i = text.indexOf('\r', i + 1)) if (text.charCodeAt(i + 1) !== 10) lines++;
  return lines;
};

/** Extended grapheme clusters (UAX #29 §3) as the engine segments them. */
export const countGraphemes = (text: string): number => {
  let n = 0;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for (const _ of GRAPHEMES.segment(text)) n++;
  return n;
};

const NON_ASCII = /[^\0-\x7f]/;

/** The word-like segments (UAX #29 §4, the engine's rules) and, in the same pass, the words that mix scripts. */
const wordPass = (text: string): { words: number; mixedScripts: Warnings['mixedScripts'] } => {
  let words = 0;
  const mixedScripts: Warnings['mixedScripts'] = [];
  for (const s of WORDS.segment(text)) {
    if (!s.isWordLike) continue;
    words++;
    if (!NON_ASCII.test(s.segment)) continue;
    const scripts = MIXABLE_TESTS.filter(([, test]) => test.test(s.segment)).map(([name]) => name);
    if (scripts.length > 1) mixedScripts.push({ word: s.segment, index: s.index, scripts });
  }
  return { words, mixedScripts };
};

const normalizationOf = (text: string, nfc: string, nfd: string): Summary['normalization'] => {
  const isNfc = text === nfc;
  const isNfd = text === nfd;
  return isNfc && isNfd ? 'NFC and NFD' : isNfc ? 'NFC' : isNfd ? 'NFD' : 'Neither';
};

/**
 * One pass over the code points that can be invisible, look like ASCII or have no character behind them: everything
 * else is skipped by the expression. U+0020 and `\n` are never flagged; a lone surrogate is `\p{Cs}` under `u`.
 */
const SCAN = new RegExp(
  `(?![\\n ])[\\p{Cc}\\p{Cf}\\p{Zs}\\p{Zl}\\p{Zp}\\p{Cs}\\u034F\\u115F\\u1160\\u180E\\u2800\\u3164\\uFFA0\\uFFFC\\uFE00-\\uFE0F\\u{E0000}-\\u{E007F}\\u{E0100}-\\u{E01EF}]|${LOOKALIKE_CLASS}|[\\p{Co}\\p{Cn}]`,
  'gu',
);

/** Counts in the order of first appearance. */
class Tally<K> {
  readonly counts = new Map<K, number>();
  add(key: K): void {
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }
}

const scan = (text: string): Omit<Warnings, 'mixedScripts'> => {
  const invisible = new Tally<string>();
  const bidi = new Set<string>();
  const lookalikes = new Tally<string>();
  const unusual = new Tally<number>();
  let loneSurrogates = 0;
  // The grapheme around a ZWJ, VS1–VS16 or tag character: is it an emoji? Kept for the next one in the same grapheme.
  let segments: ReturnType<Intl.Segmenter['segment']> | null = null;
  let grapheme = { from: -1, to: -1, emoji: false };
  SCAN.lastIndex = 0;
  for (let m = SCAN.exec(text); m !== null; m = SCAN.exec(text)) {
    const at = m.index;
    const cp = text.codePointAt(at)!;
    const kind = invisibleKindOf(cp);
    if (kind !== null) {
      if (isEmojiPart(cp)) {
        if (at < grapheme.from || at >= grapheme.to) {
          segments ??= GRAPHEMES.segment(text);
          const g = segments.containing(at)!;
          grapheme = { from: g.index, to: g.index + g.segment.length, emoji: hasPictographic(g.segment) };
        }
        if (grapheme.emoji) continue;
      }
      const marker = markerOf(cp);
      invisible.add(marker);
      if (kind === 'bidi') bidi.add(marker);
      if (kind === 'surrogate') loneSurrogates++;
      continue;
    }
    const ascii = lookalikeOf(cp);
    if (ascii !== null) {
      lookalikes.add(m[0]);
      continue;
    }
    // What is left of the expression's matches: private use or unassigned (`[\p{Co}\p{Cn}]`).
    unusual.add(cp);
  }
  return {
    invisible: [...invisible.counts].map(([marker, count]) => ({ marker, count })),
    bidi: [...bidi],
    lookalikes: [...lookalikes.counts].map(([char, count]) => ({
      char,
      ascii: lookalikeOf(char.codePointAt(0)!)!,
      count,
    })),
    loneSurrogates,
    privateOrUnassigned: [...unusual.counts].map(([codePoint, count]) => ({ codePoint, count })),
  };
};

const FORMS: readonly NormalizationForm[] = ['NFC', 'NFD', 'NFKC', 'NFKD'];

/**
 * The longest run of combining marks (`\p{M}`), in code points. Normalising puts a run's marks in canonical order with
 * an insertion sort (ICU, in Chrome and Node alike): its time grows with the square of the run — 64 Ki marks take
 * 1.5 s per form in Chrome 159. Real text keeps runs under 30 (UAX #15, Stream-Safe Text Format).
 */
export const longestMarkRun = (text: string): number => {
  let longest = 0;
  const runs = /\p{M}+/gu;
  for (let m = runs.exec(text); m !== null; m = runs.exec(text)) {
    if (m[0].length <= longest) continue;
    longest = Math.max(longest, m[0].length > MAX_MARK_RUN ? [...m[0]].length : m[0].length);
  }
  return longest;
};

const normalizedForms = (text: string): Array<readonly [NormalizationForm, string]> | null =>
  longestMarkRun(text) > MAX_MARK_RUN ? null : FORMS.map(form => [form, text.normalize(form)] as const);

/**
 * Everything over the whole text at once — each segmentation and normalisation runs once. A run of more than
 * MAX_MARK_RUN combining marks is not normalised (`Not checked`, no forms): it would hold the tool for seconds.
 */
export const inspect = (text: string): Inspection => {
  const { codePoints, utf8Bytes } = measure(text);
  const normalized = normalizedForms(text);
  const { words, mixedScripts } = wordPass(text);
  const summary: Summary = {
    graphemes: countGraphemes(text),
    codePoints,
    utf16Units: text.length,
    utf8Bytes,
    utf16Bytes: text.length * 2,
    words,
    lines: countLines(text),
    normalization: normalized ? normalizationOf(text, normalized[0][1], normalized[1][1]) : 'Not checked',
  };
  const forms =
    normalized?.map(([form, value]) =>
      value === text ? { form, changes: false, codePoints, utf8Bytes } : { form, changes: true, ...measure(value) },
    ) ?? null;
  return { summary, warnings: { ...scan(text), mixedScripts }, forms };
};

/** The summary of §5.1. */
export const summarize = (text: string): Summary => inspect(text).summary;

/** The warnings of §5.5, over the whole text. */
export const warnings = (text: string): Warnings => ({ ...scan(text), mixedScripts: wordPass(text).mixedScripts });

/** What NFC, NFD, NFKC and NFKD would make of the text (spec §15: shown under the summary); null — not checked. */
export const normalizationForms = (text: string): FormResult[] | null => inspect(text).forms;

/**
 * The Unicode version of the engine's data, found by characters each version added: `17.0 or later`, `16.0`, …, or
 * `older than 14.0`. Chrome 159 answers `17.0 or later`, Node 22.20 `16.0`.
 */
export const unicodeVersion = (): string => {
  const assigned = (cp: number): boolean => !/^\p{Cn}$/u.test(String.fromCodePoint(cp));
  const probes: Array<[string, number]> = [
    ['17.0', 0x20c1], // SAUDI RIYAL SIGN
    ['16.0', 0x1c89], // CYRILLIC CAPITAL LETTER TJE
    ['15.1', 0x2ffc], // IDEOGRAPHIC DESCRIPTION CHARACTER SURROUND FROM RIGHT
    ['15.0', 0x1fae8], // SHAKING FACE
    ['14.0', 0x1fae0], // MELTING FACE
  ];
  const found = probes.findIndex(([, cp]) => assigned(cp));
  if (found === -1) return 'older than 14.0';
  return found === 0 ? `${probes[0][0]} or later` : probes[found][0];
};
