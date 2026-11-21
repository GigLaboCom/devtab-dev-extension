/**
 * The Password Generator's logic (docs/tools/specs/password.md §5, §9): passwords of random characters with "at least
 * one of each chosen set", passphrases of EFF words, and the entropy of the settings. Pure: no React, no DOM, no
 * chrome, no logging. The only randomness is the `source` parameter — `cryptoRandom` of @workspace/tools-shared/random
 * by default — and every index comes from its `randomIndex` (rejection sampling, no modulo bias). The tool has no
 * `detect` (§7): it takes no input.
 */
import { bufferedSource, cryptoRandom, log2BigInt, randomIndex } from '@workspace/tools-shared/random';
import type { RandomSource } from '@workspace/tools-shared/random';

export type CharSet = 'upper' | 'lower' | 'digits' | 'symbols';
export type Separator = '-' | ' ' | '.' | '_';

/** The sets in their fixed order (§5.3); the order makes test values repeatable. */
export const CHAR_SETS: readonly CharSet[] = ['upper', 'lower', 'digits', 'symbols'];
export const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
export const DIGITS = '0123456789';
/** The 32 ASCII characters that are neither letters, digits nor the space, ascending (§5.3). */
export const DEFAULT_SYMBOLS = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';
/** Removed from every set by "Avoid look-alike characters". */
export const LOOK_ALIKE = '0O1Il|';
export const SEPARATORS: readonly Separator[] = ['-', ' ', '.', '_'];
export const LIMITS = {
  length: { min: 4, max: 128 },
  words: { min: 3, max: 20 },
  count: { min: 1, max: 20 },
} as const;
/** Candidates thrown away in a row before generation gives up (§5.4). */
export const MAX_REJECTED = 10_000;
/** The size of the EFF Large Wordlist (§5.6). */
export const WORD_LIST_SIZE = 7776;

export interface CharOptions {
  length: number;
  sets: Record<CharSet, boolean>;
  /** As typed in the field. */
  symbols: string;
  avoidLookAlike: boolean;
}

export interface WordOptions {
  words: number;
  separator: Separator;
  capitalize: boolean;
}

export type Settings =
  { mode: 'chars'; chars: CharOptions; count: number } | { mode: 'words'; words: WordOptions; count: number };

export type FieldError = {
  /** 'random' and 'generation' are not tied to a field: shown above the result. */
  field: 'length' | 'symbols' | 'sets' | 'words' | 'count' | 'random' | 'generation';
  message: string;
};

/** The texts of §6, word for word. */
export const MESSAGES = {
  length: `Length must be a whole number from ${LIMITS.length.min} to ${LIMITS.length.max}.`,
  words: `Words must be a whole number from ${LIMITS.words.min} to ${LIMITS.words.max}.`,
  count: `How many must be a whole number from ${LIMITS.count.min} to ${LIMITS.count.max}.`,
  symbolsEmpty: 'Add at least one symbol or turn Symbols off.',
  symbolsInvalid: (char: string): string => `Only ASCII punctuation can be used here. Remove "${char}".`,
  symbolsLookAlike: 'All symbols are excluded as look-alikes. Add others or turn Avoid look-alike characters off.',
  sets: 'Choose at least one character set.',
  random: 'Could not get random numbers from the browser.',
  generation: 'Could not generate a password with these settings. Try a longer length.',
} as const;

export const DEFAULT_CHAR_OPTIONS: CharOptions = {
  length: 20,
  sets: { upper: true, lower: true, digits: true, symbols: true },
  symbols: DEFAULT_SYMBOLS,
  avoidLookAlike: false,
};
export const DEFAULT_WORD_OPTIONS: WordOptions = { words: 6, separator: '-', capitalize: false };
export const DEFAULT_SETTINGS: Settings = { mode: 'chars', chars: DEFAULT_CHAR_OPTIONS, count: 1 };

const BASE_SETS: Record<Exclude<CharSet, 'symbols'>, string> = {
  upper: UPPERCASE,
  lower: LOWERCASE,
  digits: DIGITS,
};

const within = (value: number, limit: { min: number; max: number }): boolean =>
  Number.isInteger(value) && value >= limit.min && value <= limit.max;

/**
 * A number field's text as a whole decimal number (§3): digits only, otherwise NaN — so an empty field, a fraction, a
 * sign or an exponent is an error at the field, never a guess.
 */
export const parseWholeNumber = (text: string): number => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : NaN);

/** The Symbols field as a set: only the 32 characters of §5.3, repeats dropped (the first stays), in typed order. */
const symbolSet = (typed: string): { ok: true; set: string } | { ok: false; error: FieldError } => {
  if (typed === '') return { ok: false, error: { field: 'symbols', message: MESSAGES.symbolsEmpty } };
  let set = '';
  // By code point, so an emoji is reported whole, not as half of a surrogate pair.
  for (const char of typed) {
    if (!DEFAULT_SYMBOLS.includes(char))
      return { ok: false, error: { field: 'symbols', message: MESSAGES.symbolsInvalid(char) } };
    if (!set.includes(char)) set += char;
  }
  return { ok: true, set };
};

/** The enabled sets after exclusion, in the order of §5.3, or the first problem. */
export const charSets = (options: CharOptions): { ok: true; sets: string[] } | { ok: false; error: FieldError } => {
  const strip = (set: string): string =>
    options.avoidLookAlike ? [...set].filter(c => !LOOK_ALIKE.includes(c)).join('') : set;
  const sets: string[] = [];
  for (const name of CHAR_SETS) {
    if (!options.sets[name]) continue;
    if (name === 'symbols') {
      const typed = symbolSet(options.symbols);
      if (!typed.ok) return typed;
      const kept = strip(typed.set);
      if (kept === '') return { ok: false, error: { field: 'symbols', message: MESSAGES.symbolsLookAlike } };
      sets.push(kept);
    } else sets.push(strip(BASE_SETS[name]));
  }
  if (sets.length === 0) return { ok: false, error: { field: 'sets', message: MESSAGES.sets } };
  return { ok: true, sets };
};

/**
 * N: the strings of length `length` over the sets' union that contain every set (inclusion–exclusion, §5.5), exactly
 * in BigInt — up to ~840 bits at length 128.
 */
export const validCount = (sizes: readonly number[], length: number): bigint => {
  const total = sizes.reduce((a, b) => a + b, 0);
  let n = 0n;
  for (let mask = 0; mask < 1 << sizes.length; mask++) {
    let removed = 0;
    let odd = false;
    sizes.forEach((size, i) => {
      if (mask & (1 << i)) {
        removed += size;
        odd = !odd;
      }
    });
    const term = BigInt(total - removed) ** BigInt(length);
    n += odd ? -term : term;
  }
  return n;
};

/** Entropy of the settings in bits (§5.5), unrounded; NaN when the options are not valid. */
export const charEntropy = (options: CharOptions): number => {
  const found = charSets(options);
  if (!found.ok || !within(options.length, LIMITS.length)) return NaN;
  return log2BigInt(
    validCount(
      found.sets.map(s => s.length),
      options.length,
    ),
  );
};

/** W · log2 7776 (§5.5); capitalizing and the separator are not random and add nothing. NaN when not valid. */
export const wordEntropy = (options: WordOptions): number =>
  within(options.words, LIMITS.words) ? options.words * Math.log2(WORD_LIST_SIZE) : NaN;

export type Generated =
  /** summary: the text in brackets (§8). */
  | { ok: true; values: string[]; entropyBits: number; summary: string }
  /** Every invalid field at once. */
  | { ok: false; errors: FieldError[] };

export type Strength = { ok: true; entropyBits: number; summary: string } | { ok: false; errors: FieldError[] };

const plural = (n: number, one: string, many: string): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/**
 * Checks every parameter and collects every problem (§9); when all are valid, the entropy of the settings and the text
 * in brackets of §8. No randomness is drawn here.
 */
export const strength = (settings: Settings): Strength => {
  const errors: FieldError[] = [];
  let ok: { entropyBits: number; summary: string } | undefined;
  if (settings.mode === 'chars') {
    const { chars } = settings;
    const lengthOk = within(chars.length, LIMITS.length);
    if (!lengthOk) errors.push({ field: 'length', message: MESSAGES.length });
    const found = charSets(chars);
    if (!found.ok) errors.push(found.error);
    if (lengthOk && found.ok) {
      const size = found.sets.reduce((a, s) => a + s.length, 0);
      ok = {
        entropyBits: charEntropy(chars),
        summary:
          `${plural(chars.length, 'character', 'characters')} from a set of ${size.toLocaleString('en-US')}` +
          (found.sets.length > 1 ? ', at least one of each chosen set' : ''),
      };
    }
  } else {
    const { words } = settings;
    if (!within(words.words, LIMITS.words)) errors.push({ field: 'words', message: MESSAGES.words });
    else
      ok = {
        entropyBits: wordEntropy(words),
        summary: `${plural(words.words, 'word', 'words')} from a list of ${WORD_LIST_SIZE.toLocaleString('en-US')}`,
      };
  }
  if (!within(settings.count, LIMITS.count)) errors.push({ field: 'count', message: MESSAGES.count });
  return errors.length > 0 || !ok ? { ok: false, errors } : { ok: true, ...ok };
};

/** One password: whole candidates until one has every set (§5.4), or undefined after MAX_REJECTED rejections. */
const charPassword = (sets: readonly string[], length: number, source: RandomSource): string | undefined => {
  const alphabet = sets.join('');
  for (let rejected = 0; rejected < MAX_REJECTED; rejected++) {
    let candidate = '';
    for (let i = 0; i < length; i++) candidate += alphabet[randomIndex(alphabet.length, source)];
    if (sets.every(set => [...set].some(c => candidate.includes(c)))) return candidate;
  }
  return undefined;
};

const passphrase = (words: readonly string[], options: WordOptions, source: RandomSource): string =>
  Array.from({ length: options.words }, () => {
    // Independent picks, repeats allowed: the entropy formula counts exactly these (§5.6).
    const word = words[randomIndex(words.length, source)]!;
    return options.capitalize ? word.charAt(0).toUpperCase() + word.slice(1) : word;
  }).join(options.separator);

/**
 * `words` is the EFF list (loaded lazily by the component); required for mode 'words'. Checks every parameter first
 * and draws randomness only when all are valid. The source is read through `bufferedSource` (the same bytes in the
 * same order, fewer calls). A failing source is the error `random`; MAX_REJECTED candidates in a row, `generation`.
 */
export const generate = (
  settings: Settings,
  words?: readonly string[],
  source: RandomSource = cryptoRandom,
): Generated => {
  const checked = strength(settings);
  if (!checked.ok) return checked;
  if (settings.mode === 'words' && (!words || words.length === 0))
    throw new TypeError('generate: the word list is required for mode "words"');
  const buffered = bufferedSource(source);
  const values: string[] = [];
  try {
    if (settings.mode === 'chars') {
      const found = charSets(settings.chars);
      if (!found.ok) return { ok: false, errors: [found.error] };
      for (let i = 0; i < settings.count; i++) {
        const value = charPassword(found.sets, settings.chars.length, buffered);
        if (value === undefined) return { ok: false, errors: [{ field: 'generation', message: MESSAGES.generation }] };
        values.push(value);
      }
    } else for (let i = 0; i < settings.count; i++) values.push(passphrase(words!, settings.words, buffered));
  } catch {
    return { ok: false, errors: [{ field: 'random', message: MESSAGES.random }] };
  }
  return { ok: true, values, entropyBits: checked.entropyBits, summary: checked.summary };
};

/** The strength line of §8: the entropy rounded down, so it never overstates, and where it comes from. */
export const strengthLine = (entropyBits: number, summary: string): string =>
  `${Math.floor(entropyBits)} bits of entropy (${summary})`;

/** The small print under the strength line (§8), with the same number. */
export const strengthNote = (entropyBits: number): string =>
  `Entropy of these settings, not of a single password: someone who knows the settings needs up to 2^${Math.floor(entropyBits)} guesses.`;

/** The EFF Large Wordlist, loaded on first use: a chunk of its own, not part of the tool's (§5.6). */
export const loadWordList = async (): Promise<readonly string[]> =>
  (await import('./eff-large-wordlist')).EFF_LARGE_WORDLIST;
