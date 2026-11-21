/**
 * The Lines tool's logic (docs/tools/specs/lines.md §5, §9): a text is cut into lines and passed through a fixed chain
 * of steps — Split, Trim, Filter, Remove blank lines, Duplicates, Order, Prefix and suffix, Number, Join — each enabled
 * step applied in that order to the array the previous one returned (§5.2). Pure: no React, no DOM, no chrome.
 * Randomness (Shuffle) comes only from @workspace/tools-shared/random.
 */
import { bufferedSource, cryptoRandom, randomIndex } from '@workspace/tools-shared/random';
import type { RandomSource } from '@workspace/tools-shared/random';

export type { RandomSource };

export interface SplitText {
  lines: string[];
  /** The text ended with a line break (§5.1). */
  trailingBreak: boolean;
}

const LF = 10;
const CR = 13;
const BREAK = /\r\n|\r|\n/;

/** §5.1: \r\n, \n and a lone \r end a line. U+2028, U+2029, VT, FF and NEL do not. */
export const splitLines = (text: string): SplitText => {
  if (text === '') return { lines: [], trailingBreak: false };
  const lines = text.split(BREAK);
  const last = text.charCodeAt(text.length - 1);
  const trailingBreak = last === LF || last === CR;
  if (trailingBreak) lines.pop();
  return { lines, trailingBreak };
};

/** \n between lines; a final \n when trailingBreak and at least one line. */
export const joinLines = (lines: readonly string[], trailingBreak: boolean): string =>
  lines.length === 0 ? '' : trailingBreak ? `${lines.join('\n')}\n` : lines.join('\n');

/** splitLines(text).lines.length without building the array (live or delayed, §12). */
export const countLines = (text: string): number => {
  if (text === '') return 0;
  let breaks = 0;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) breaks++;
  for (let i = text.indexOf('\r'); i !== -1; i = text.indexOf('\r', i + 1)) if (text.charCodeAt(i + 1) !== LF) breaks++;
  const last = text.charCodeAt(text.length - 1);
  return last === LF || last === CR ? breaks : breaks + 1;
};

export type SplitSeparator = { kind: 'whitespace' } | { kind: 'text'; text: string };
export type TrimMode = 'both' | 'start' | 'end';
export type BlankMode = 'all' | 'repeated';
export type DuplicateMode = 'remove' | 'duplicated' | 'unique' | 'count';
export type OrderKind = 'sort' | 'reverse' | 'shuffle';
export type SortKind = 'alphabetical' | 'natural' | 'numeric' | 'length' | 'codepoint';
export type NumberAfter = '. ' | ') ' | ': ' | ' ' | '\t';
export type NumberPad = 'none' | 'spaces' | 'zeros';

export interface TrimOptions {
  mode: TrimMode;
  collapse: boolean;
}
export interface FilterOptions {
  /** true: keep matching lines; false: remove them. */
  keep: boolean;
  text: string;
  matchCase: boolean;
}
export interface DuplicateOptions {
  mode: DuplicateMode;
  ignoreCase: boolean;
  ignoreWhitespace: boolean;
}
export interface SortOptions {
  kind: SortKind;
  descending: boolean;
  /** alphabetical and natural only. */
  uppercaseFirst: boolean;
}
export interface NumberOptions {
  start: 0 | 1;
  after: NumberAfter;
  pad: NumberPad;
}

export interface Pipeline {
  split: { enabled: boolean; separator: SplitSeparator };
  trim: { enabled: boolean } & TrimOptions;
  filter: { enabled: boolean } & FilterOptions;
  blank: { enabled: boolean; mode: BlankMode };
  duplicates: { enabled: boolean } & DuplicateOptions;
  order: { enabled: boolean; kind: OrderKind; sort: SortOptions };
  affix: { enabled: boolean; prefix: string; suffix: string };
  number: { enabled: boolean } & NumberOptions;
  /** The separator itself: ', ', ',', '; ', ' ', '\t', '|', '' or the custom text. */
  join: { enabled: boolean; separator: string };
}

/** Every step off, the defaults of §4 inside. */
export const DEFAULT_PIPELINE: Pipeline = {
  split: { enabled: false, separator: { kind: 'text', text: ',' } },
  trim: { enabled: false, mode: 'both', collapse: false },
  filter: { enabled: false, keep: true, text: '', matchCase: false },
  blank: { enabled: false, mode: 'all' },
  duplicates: { enabled: false, mode: 'remove', ignoreCase: false, ignoreWhitespace: false },
  order: { enabled: false, kind: 'sort', sort: { kind: 'alphabetical', descending: false, uppercaseFirst: false } },
  affix: { enabled: false, prefix: '', suffix: '' },
  number: { enabled: false, start: 1, after: '. ', pad: 'none' },
  join: { enabled: false, separator: ', ' },
};

export const LIMITS = {
  liveLines: 20_000,
  liveChars: 1_048_576,
  maxLines: 200_000,
  maxChars: 8_388_608,
} as const;

/** How long a large input waits after the last change before it is recomputed (§12). */
export const SETTLE_MS = 300;

/** Steps that report a change in the number of lines (§5.13). */
export type CountedStep = 'split' | 'filter' | 'blank' | 'duplicates';

export type PipelineResult =
  | {
      ok: true;
      text: string;
      linesIn: number;
      linesOut: number;
      /** Lines out minus lines in, for each enabled counted step. */
      deltas: Partial<Record<CountedStep, number>>;
    }
  | { ok: false; message: string }; // the limits of §6, checked in this order: characters, lines, lines after Split

const thousands = (n: number): string => n.toLocaleString('en-US');

// §5.3: JavaScript's \s, the set String.prototype.trim removes.
const isSpace = (c: number): boolean =>
  c === 0x20 ||
  (c >= 0x09 && c <= 0x0d) ||
  c === 0xa0 ||
  c === 0x1680 ||
  (c >= 0x2000 && c <= 0x200a) ||
  c === 0x2028 ||
  c === 0x2029 ||
  c === 0x202f ||
  c === 0x205f ||
  c === 0x3000 ||
  c === 0xfeff;

const SPACES = /\s+/g;

/**
 * The number of lines Split gives for `text` (§5.4), without building them: the line count plus every occurrence of a
 * text separator, or the runs of non-space characters for Whitespace. An empty separator changes nothing.
 */
export const countSplit = (text: string, separator: SplitSeparator): number => {
  if (separator.kind === 'whitespace') {
    let runs = 0;
    let inRun = false;
    for (let i = 0; i < text.length; i++) {
      const space = isSpace(text.charCodeAt(i));
      if (!space && !inRun) runs++;
      inRun = !space;
    }
    return runs;
  }
  const lines = countLines(text);
  const sep = separator.text;
  // A separator with a line break never matches inside a line.
  if (sep === '' || sep.includes('\n') || sep.includes('\r')) return lines;
  let found = 0;
  for (let i = text.indexOf(sep); i !== -1; i = text.indexOf(sep, i + sep.length)) found++;
  return lines + found;
};

// The steps, exported for the tests. Each returns a new array.

/** §5.4. */
export const splitOn = (lines: readonly string[], separator: SplitSeparator): string[] => {
  const out: string[] = [];
  if (separator.kind === 'whitespace') {
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed !== '') for (const piece of trimmed.split(SPACES)) out.push(piece);
    }
    return out;
  }
  if (separator.text === '') return lines.slice();
  for (const line of lines) for (const piece of line.split(separator.text)) out.push(piece);
  return out;
};

const collapseInner = (line: string): string => {
  let first = 0;
  while (first < line.length && isSpace(line.charCodeAt(first))) first++;
  if (first === line.length) return line;
  let last = line.length - 1;
  while (isSpace(line.charCodeAt(last))) last--;
  return line.slice(0, first) + line.slice(first, last + 1).replace(SPACES, ' ') + line.slice(last + 1);
};

/** §5.5. */
export const trimLines = (lines: readonly string[], options: TrimOptions): string[] =>
  lines.map(line => {
    const trimmed =
      options.mode === 'both' ? line.trim() : options.mode === 'start' ? line.trimStart() : line.trimEnd();
    return options.collapse ? collapseInner(trimmed) : trimmed;
  });

/** §5.3: case folding without a locale — closer to Unicode's full folding than toLowerCase alone. */
const fold = (text: string): string => text.toUpperCase().toLowerCase();

/** §5.6. */
export const filterLines = (lines: readonly string[], options: FilterOptions): string[] => {
  if (options.text === '') return lines.slice();
  const prepare = options.matchCase ? (s: string) => s.normalize('NFC') : (s: string) => fold(s).normalize('NFC');
  const needle = prepare(options.text);
  return lines.filter(line => prepare(line).includes(needle) === options.keep);
};

const isBlank = (line: string): boolean => {
  for (let i = 0; i < line.length; i++) if (!isSpace(line.charCodeAt(i))) return false;
  return true;
};

/** §5.7. */
export const removeBlankLines = (lines: readonly string[], mode: BlankMode): string[] => {
  if (mode === 'all') return lines.filter(line => !isBlank(line));
  const out: string[] = [];
  let previousBlank = false;
  for (const line of lines) {
    const blank = isBlank(line);
    if (!blank || !previousBlank) out.push(line);
    previousBlank = blank;
  }
  return out;
};

/** §5.8: whitespace, then case, then NFC. */
export const duplicateKey = (line: string, options: Omit<DuplicateOptions, 'mode'>): string => {
  let key = options.ignoreWhitespace ? line.replace(SPACES, ' ').trim() : line;
  if (options.ignoreCase) key = fold(key);
  return key.normalize('NFC');
};

/** §5.8: any line with the same key anywhere in the list is a duplicate; the first occurrence stands for its key. */
export const dedupeLines = (lines: readonly string[], options: DuplicateOptions): string[] => {
  const keys = lines.map(line => duplicateKey(line, options));
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  if (options.mode === 'unique') return lines.filter((_, i) => counts.get(keys[i]!) === 1);
  const seen = new Set<string>();
  const out: string[] = [];
  lines.forEach((line, i) => {
    const key = keys[i]!;
    if (seen.has(key)) return;
    seen.add(key);
    const count = counts.get(key)!;
    if (options.mode === 'remove') out.push(line);
    else if (options.mode === 'duplicated') {
      if (count > 1) out.push(line);
    } else out.push(`${count}\t${line}`);
  });
  return out;
};

const NUMBER = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/;

/** §5.9.3, or null when the line does not start with a number. */
export const leadingNumber = (line: string): number | null => {
  const match = NUMBER.exec(line);
  return match ? Number(match[1]) : null;
};

/** Code points: a surrogate pair is one, a lone surrogate one (§5.9.4). */
export const codePointLength = (line: string): number => {
  let n = line.length;
  for (let i = 0; i < line.length - 1; i++) {
    const c = line.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = line.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        n--;
        i++;
      }
    }
  }
  return n;
};

// §5.9.5: when both differing units are at or above U+D800, U+E000–U+FFFF move below the surrogates.
const shift = (unit: number): number => (unit >= 0xe000 ? unit - 0x800 : unit + 0x2000);

/** §5.9.5: Unicode code point order (UTF-8 byte order, `LC_ALL=C sort`); a prefix comes first. */
export const compareCodePoints = (a: string, b: string): number => {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    let x = a.charCodeAt(i);
    let y = b.charCodeAt(i);
    if (x === y) continue;
    if (x >= 0xd800 && y >= 0xd800) {
      x = shift(x);
      y = shift(y);
    }
    return x < y ? -1 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
};

/**
 * §5.9.2: the collation language is fixed to 'en' (CLDR root order), so the order does not depend on the browser's
 * language or the machine. One collator per set of options.
 */
export const COLLATION_LOCALE = 'en';
const collators = new Map<string, Intl.Collator>();
const collatorFor = (numeric: boolean, uppercaseFirst: boolean): Intl.Collator => {
  const id = `${numeric}:${uppercaseFirst}`;
  let collator = collators.get(id);
  if (!collator) {
    collator = new Intl.Collator(
      COLLATION_LOCALE,
      uppercaseFirst
        ? { usage: 'sort', sensitivity: 'variant', caseFirst: 'upper', numeric, ignorePunctuation: false }
        : { usage: 'sort', sensitivity: 'accent', numeric, ignorePunctuation: false },
    );
    collators.set(id, collator);
  }
  return collator;
};

/** Sorts by precomputed keys; stable (Array.prototype.sort), descending by the reversed comparison (§5.9.1). */
const byKeys = <K>(lines: readonly string[], keys: readonly K[], compare: (a: K, b: K) => number, desc: boolean) => {
  const order = lines.map((_, i) => i);
  order.sort(desc ? (i, j) => compare(keys[j]!, keys[i]!) : (i, j) => compare(keys[i]!, keys[j]!));
  return order.map(i => lines[i]!);
};

const compareNumbers = (x: number, y: number): number => (x < y ? -1 : x > y ? 1 : 0);

/** §5.9: stable; Descending reverses the comparison, not the result. */
export const sortLines = (lines: readonly string[], options: SortOptions): string[] => {
  const desc = options.descending;
  switch (options.kind) {
    case 'alphabetical':
    case 'natural': {
      const { compare } = collatorFor(options.kind === 'natural', options.uppercaseFirst);
      return lines.slice().sort(desc ? (a, b) => compare(b, a) : compare);
    }
    case 'codepoint':
      return lines.slice().sort(desc ? (a, b) => compareCodePoints(b, a) : compareCodePoints);
    case 'length':
      return byKeys(lines, lines.map(codePointLength), compareNumbers, desc);
    case 'numeric': {
      // Lines without a number go after all numbers, in input order, in either direction.
      const numbered: string[] = [];
      const values: number[] = [];
      const rest: string[] = [];
      for (const line of lines) {
        const value = leadingNumber(line);
        if (value === null) rest.push(line);
        else {
          numbered.push(line);
          values.push(value);
        }
      }
      return byKeys(numbered, values, compareNumbers, desc).concat(rest);
    }
  }
};

/** §5.9.6: Fisher–Yates from the end, j = randomIndex(i + 1). Every permutation equally likely. */
export const shuffleLines = (lines: readonly string[], source: RandomSource): string[] => {
  const out = lines.slice();
  for (let i = out.length - 1; i >= 1; i--) {
    const j = randomIndex(i + 1, source);
    const t = out[i]!;
    out[i] = out[j]!;
    out[j] = t;
  }
  return out;
};

/** §5.10. Both empty: no change. */
export const affixLines = (lines: readonly string[], prefix: string, suffix: string): string[] =>
  prefix === '' && suffix === '' ? lines.slice() : lines.map(line => prefix + line + suffix);

/** §5.11: every line, blank ones included; the width is that of the last number. */
export const numberLines = (lines: readonly string[], options: NumberOptions): string[] => {
  const width = String(options.start + lines.length - 1).length;
  return lines.map((line, i) => {
    const n = String(options.start + i);
    const padded =
      options.pad === 'none' ? n : options.pad === 'spaces' ? n.padStart(width, ' ') : n.padStart(width, '0');
    return padded + options.after + line;
  });
};

/** The text of the line-count limit (§6). */
const tooManyLines = (lead: string, n: number): string =>
  `${lead} ${thousands(n)} lines. This tool works with up to ${thousands(LIMITS.maxLines)} lines.`;
export const TOO_LARGE = 'Text is larger than 8 MB. This tool works with up to 8 MB.';

/** §5.2. `source` is used by Shuffle only; the default is bufferedSource(cryptoRandom). */
export const runPipeline = (text: string, pipeline: Pipeline, source?: RandomSource): PipelineResult => {
  if (text.length > LIMITS.maxChars) return { ok: false, message: TOO_LARGE };
  const linesIn = countLines(text);
  if (linesIn > LIMITS.maxLines) return { ok: false, message: tooManyLines('Text has', linesIn) };
  const p = pipeline;
  if (p.split.enabled) {
    const after = countSplit(text, p.split.separator);
    if (after > LIMITS.maxLines) return { ok: false, message: tooManyLines('Split gives', after) };
  }

  const split = splitLines(text);
  let lines = split.lines;
  const deltas: Partial<Record<CountedStep, number>> = {};
  const counted = (step: CountedStep, next: string[]): void => {
    deltas[step] = next.length - lines.length;
    lines = next;
  };

  if (p.split.enabled) counted('split', splitOn(lines, p.split.separator));
  if (p.trim.enabled) lines = trimLines(lines, p.trim);
  if (p.filter.enabled) counted('filter', filterLines(lines, p.filter));
  if (p.blank.enabled) counted('blank', removeBlankLines(lines, p.blank.mode));
  if (p.duplicates.enabled) counted('duplicates', dedupeLines(lines, p.duplicates));
  if (p.order.enabled) {
    if (p.order.kind === 'sort') lines = sortLines(lines, p.order.sort);
    else if (p.order.kind === 'reverse') lines = lines.slice().reverse();
    else lines = shuffleLines(lines, source ?? bufferedSource(cryptoRandom));
  }
  if (p.affix.enabled) lines = affixLines(lines, p.affix.prefix, p.affix.suffix);
  if (p.number.enabled) lines = numberLines(lines, p.number);

  if (p.join.enabled)
    return { ok: true, text: lines.join(p.join.separator), linesIn, linesOut: lines.length ? 1 : 0, deltas };
  return { ok: true, text: joinLines(lines, split.trailingBreak), linesIn, linesOut: lines.length, deltas };
};

/** §5.13 texts. */
export const summaryText = (linesIn: number, linesOut: number): string =>
  `${thousands(linesIn)} ${linesIn === 1 ? 'line' : 'lines'} in, ${thousands(linesOut)} out`;
export const deltaText = (delta: number): string =>
  delta > 0 ? `${thousands(delta)} added` : delta < 0 ? `${thousands(-delta)} removed` : 'no change';

/** §5.9.6: random bytes replayed from the start by every reader until reset. */
export interface ShuffleTape {
  reader: () => RandomSource;
  reset: () => void;
  /** A copy of the bytes the tape holds now — to replay them elsewhere (a worker, a history entry). */
  bytes: () => Uint8Array<ArrayBuffer>;
}

const TAPE_MIN = 4096;

/**
 * §5.9.6. A reader reads the tape from its start; past the end the tape grows from `source` to max(needed, twice its
 * length, 4096) bytes. `initial`: bytes to start with (a tape replayed in a worker or opened from History).
 */
export const createShuffleTape = (source: RandomSource = cryptoRandom, initial?: Uint8Array): ShuffleTape => {
  let tape: Uint8Array<ArrayBuffer> = initial ? new Uint8Array(initial) : new Uint8Array(0);
  const ensure = (needed: number): void => {
    if (needed <= tape.length) return;
    const next = new Uint8Array(Math.max(needed, 2 * tape.length, TAPE_MIN));
    next.set(tape);
    source(next.subarray(tape.length));
    tape = next;
  };
  return {
    reader: () => {
      let at = 0;
      return bytes => {
        ensure(at + bytes.length);
        bytes.set(tape.subarray(at, at + bytes.length));
        at += bytes.length;
      };
    },
    reset: () => {
      tape = new Uint8Array(0);
    },
    bytes: () => tape.slice(),
  };
};
