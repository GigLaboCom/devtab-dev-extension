/**
 * The Case Converter tool's logic (docs/tools/specs/case.md §5, §9): a line split into words, the words joined back in
 * eleven forms, and the whole line in lower and upper case. Every line of a text is converted on its own and the line
 * breaks stay where they were (§5.1).
 *
 * Case mapping is `String.prototype.toLowerCase` / `toUpperCase` only — the Unicode default case algorithms, the same
 * for every locale (§5.3): no `toLocale…Case`, no `Intl`, nothing read from the machine or the browser's language, so
 * Node and Chrome under any locale give the same answers (a test runs the module under a Turkish ICU locale). The
 * character classes are the engine's `\p{…}` (§5.2).
 *
 * Every pass is linear: one regular expression without nested repetition finds the chunks, then one walk over each
 * chunk's code points finds the case boundaries. Size limits are the component's: these functions take any input.
 */

export type CaseForm =
  | 'camel'
  | 'pascal'
  | 'snake'
  | 'constant'
  | 'kebab'
  | 'upperKebab'
  | 'train'
  | 'dot'
  | 'path'
  | 'title'
  | 'sentence'
  | 'lower'
  | 'upper';

export interface CaseFormInfo {
  id: CaseForm;
  /** The name shown in the interface, §4. */
  label: string;
}

/** The 13 forms in interface order, §4: the forms for names in code first, then the forms for text. */
export const CASE_FORMS: readonly CaseFormInfo[] = [
  { id: 'camel', label: 'camelCase' },
  { id: 'pascal', label: 'PascalCase' },
  { id: 'snake', label: 'snake_case' },
  { id: 'constant', label: 'CONSTANT_CASE' },
  { id: 'kebab', label: 'kebab-case' },
  { id: 'upperKebab', label: 'UPPER-KEBAB-CASE' },
  { id: 'train', label: 'Train-Case' },
  { id: 'dot', label: 'dot.case' },
  { id: 'path', label: 'path/case' },
  { id: 'title', label: 'Title Case' },
  { id: 'sentence', label: 'Sentence case' },
  { id: 'lower', label: 'lower case' },
  { id: 'upper', label: 'UPPER CASE' },
];

/** Lowercase short words that Title Case keeps lowercase inside a line, §5.4.1. */
export const TITLE_SHORT_WORDS: ReadonlySet<string> = new Set([
  // articles
  'a',
  'an',
  'the',
  // conjunctions
  'and',
  'but',
  'or',
  'nor',
  'for',
  'so',
  'yet',
  // prepositions of up to three letters, and via, vs
  'as',
  'at',
  'by',
  'in',
  'of',
  'off',
  'on',
  'per',
  'to',
  'up',
  'via',
  'vs',
]);

/** Up to this many UTF-16 code units every edit recomputes all forms; above it, SETTLE_MS after the last edit (§12). */
export const LIVE_INPUT = 64 * 1024;
/** Above this many UTF-16 code units the tool refuses (§12); exactly this many is still converted. */
export const MAX_INPUT = 512 * 1024;
/** How long a large input waits after the last edit (§12). */
export const SETTLE_MS = 300;

/**
 * What a code point is to the word rules of §5.2. Plain numbers rather than an enum: the module stays erasable syntax,
 * so Node runs the file as it is (the locale test does).
 */
const Kind = {
  /** Not a word character: a separator. */
  Other: 0,
  /** `\p{Lu}` or `\p{Lt}`. */
  Upper: 1,
  /** `\p{Ll}`. */
  Lower: 2,
  /** `\p{Lo}` or `\p{Lm}`: a letter without case. */
  Caseless: 3,
  /** `\p{N}`, `²` and `½` included. */
  Digit: 4,
  /** `\p{M}`: joins the letter before it and is skipped when the rules look at a neighbour. */
  Mark: 5,
  /** U+0027 or U+2019. */
  Apostrophe: 6,
} as const;
type Kind = (typeof Kind)[keyof typeof Kind];

const UPPER = /^[\p{Lu}\p{Lt}]$/u;
const LOWER = /^\p{Ll}$/u;
const CASELESS = /^[\p{Lo}\p{Lm}]$/u;
const MARK = /^\p{M}$/u;
const DIGIT = /^\p{N}$/u;

/** Non-ASCII code points seen so far: a text repeats its letters, and a regular expression per character is slow. */
const kinds = new Map<number, Kind>();

const kindOf = (cp: number): Kind => {
  if (cp < 0x80) {
    if (cp >= 0x61 && cp <= 0x7a) return Kind.Lower;
    if (cp >= 0x41 && cp <= 0x5a) return Kind.Upper;
    if (cp >= 0x30 && cp <= 0x39) return Kind.Digit;
    return cp === 0x27 ? Kind.Apostrophe : Kind.Other;
  }
  if (cp === 0x2019) return Kind.Apostrophe;
  const known = kinds.get(cp);
  if (known !== undefined) return known;
  const ch = String.fromCodePoint(cp);
  const kind = UPPER.test(ch)
    ? Kind.Upper
    : LOWER.test(ch)
      ? Kind.Lower
      : CASELESS.test(ch)
        ? Kind.Caseless
        : MARK.test(ch)
          ? Kind.Mark
          : DIGIT.test(ch)
            ? Kind.Digit
            : Kind.Other;
  if (kinds.size < 65_536) kinds.set(cp, kind);
  return kind;
};

/**
 * §5.2 step 1: a chunk is a run of word characters (`\p{L}`, `\p{M}`, `\p{N}`), with an apostrophe inside only between
 * two of them. No nested repetition: each apostrophe is followed by at least one word character, so a position is
 * tried once — linear on any input.
 */
const CHUNK = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}\p{N}]+)*/gu;

/** §5.2 step 2: where a chunk splits by case. Code points, not UTF-16 units: a letter outside the BMP is one. */
const splitChunk = (chunk: string, words: string[]): void => {
  const cps: number[] = [];
  const at: number[] = [];
  for (let i = 0; i < chunk.length;) {
    const cp = chunk.codePointAt(i)!;
    cps.push(cp);
    at.push(i);
    i += cp > 0xffff ? 2 : 1;
  }
  const kind = cps.map(kindOf);
  let start = 0;
  // The kind of the last code point that is not a mark, before the current one (Other: none yet).
  let previous: Kind = Kind.Other;
  for (let i = 0; i < kind.length; i++) {
    const k = kind[i]!;
    if (k === Kind.Mark) continue;
    if (k === Kind.Upper) {
      let boundary = false;
      if (previous === Kind.Lower || previous === Kind.Caseless || previous === Kind.Digit) boundary = true;
      else if (previous === Kind.Upper) {
        // The end of an acronym: the next code point that is not a mark is a lowercase letter.
        let j = i + 1;
        while (j < kind.length && kind[j] === Kind.Mark) j++;
        boundary = j < kind.length && kind[j] === Kind.Lower;
      }
      // After an apostrophe (`O'Neil`) or at the start there is none.
      if (boundary) {
        words.push(chunk.slice(at[start]!, at[i]!));
        start = i;
      }
    }
    previous = k;
  }
  words.push(chunk.slice(at[start]!));
};

/** §5.2: the words of one line (no line breaks inside), apostrophes kept. */
export const splitWords = (line: string): string[] => {
  const words: string[] = [];
  for (const m of line.matchAll(CHUNK)) splitChunk(m[0], words);
  return words;
};

const lower = (word: string): string => word.toLowerCase();
const upper = (word: string): string => word.toUpperCase();

/**
 * §5.3 "with a capital": the first code point through toUpperCase, the rest through toLowerCase. The rest is taken from
 * the whole word in lower case, so the final sigma sees the letters before it (`ΟΣ` → `Ος`, not `Οσ`); the first code
 * point's lower case is always the start of the word's (only the final sigma depends on context, and it never starts
 * a word).
 */
const capital = (word: string): string => {
  const first = String.fromCodePoint(word.codePointAt(0)!);
  const all = word.toLowerCase();
  const head = first.toLowerCase();
  const rest = all.startsWith(head) ? all.slice(head.length) : word.slice(first.length).toLowerCase();
  return first.toUpperCase() + rest;
};

const APOSTROPHES = /['’]/g;
const bare = (word: string): string =>
  word.includes("'") || word.includes('’') ? word.replace(APOSTROPHES, '') : word;

/** §5.3: at least two letters, all of them uppercase (`\p{Lu}`, `\p{Lt}`); digits and marks may be there too. */
const isAcronym = (word: string): boolean => {
  let letters = 0;
  for (const ch of word) {
    const k = kindOf(ch.codePointAt(0)!);
    if (k === Kind.Upper) letters++;
    else if (k === Kind.Lower || k === Kind.Caseless) return false;
  }
  return letters >= 2;
};

const HAS_LOWER = /\p{Ll}/u;

/** The word forms of §5.4, from the words of one line. */
type WordForm = Exclude<CaseForm, 'lower' | 'upper'>;

const JOINED: Record<
  Exclude<WordForm, 'camel' | 'title' | 'sentence'>,
  { word: (w: string) => string; joiner: string }
> = {
  pascal: { word: capital, joiner: '' },
  snake: { word: lower, joiner: '_' },
  constant: { word: upper, joiner: '_' },
  kebab: { word: lower, joiner: '-' },
  upperKebab: { word: upper, joiner: '-' },
  train: { word: capital, joiner: '-' },
  dot: { word: lower, joiner: '.' },
  path: { word: lower, joiner: '/' },
};

const fromWords = (words: readonly string[], form: WordForm, line: string): string => {
  if (words.length === 0) return '';
  if (form === 'title' || form === 'sentence') {
    // Rule 1 of §5.4.1: an acronym stays as it was, unless the whole line is in upper case (a shout is not kept).
    const keepAcronyms = HAS_LOWER.test(line);
    const last = words.length - 1;
    return words
      .map((w, i) => {
        if (keepAcronyms && isAcronym(w)) return w;
        if (form === 'sentence') return i === 0 ? capital(w) : lower(w);
        if (i > 0 && i < last && TITLE_SHORT_WORDS.has(lower(w))) return lower(w);
        return capital(w);
      })
      .join(' ');
  }
  // Forms 1–9: apostrophes go (§5.4), acronyms become words.
  if (form === 'camel') return words.map((w, i) => (i === 0 ? lower(bare(w)) : capital(bare(w)))).join('');
  const { word, joiner } = JOINED[form];
  return words.map(w => word(bare(w))).join(joiner);
};

/** One line in one form, §5.3–5.5. */
export const convertLine = (line: string, form: CaseForm): string => {
  if (form === 'lower') return line.toLowerCase();
  if (form === 'upper') return line.toUpperCase();
  return fromWords(splitWords(line), form, line);
};

/** The line breaks of §5.1: `\r\n` is one. The capturing group keeps them in the split, at odd indexes. */
const LINE_BREAK = /(\r\n|\n|\r)/;

/** Every line separately, line breaks kept as they are, §5.1. */
export const convertCase = (text: string, form: CaseForm): string =>
  text
    .split(LINE_BREAK)
    .map((part, i) => (i % 2 === 1 ? part : convertLine(part, form)))
    .join('');

/** All 13 forms at once, for the page: each line is split into words once. */
export const convertAll = (text: string): Record<CaseForm, string> => {
  const parts = text.split(LINE_BREAK);
  const out = Object.fromEntries(CASE_FORMS.map(f => [f.id, [] as string[]])) as Record<CaseForm, string[]>;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (i % 2 === 1) {
      for (const f of CASE_FORMS) out[f.id].push(part);
      continue;
    }
    const words = splitWords(part);
    for (const f of CASE_FORMS)
      out[f.id].push(
        f.id === 'lower' ? part.toLowerCase() : f.id === 'upper' ? part.toUpperCase() : fromWords(words, f.id, part),
      );
  }
  return Object.fromEntries(CASE_FORMS.map(f => [f.id, out[f.id].join('')])) as Record<CaseForm, string>;
};
