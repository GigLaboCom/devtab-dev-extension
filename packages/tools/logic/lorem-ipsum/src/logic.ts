/**
 * The Lorem Ipsum tool's logic (docs/tools/specs/lorem-ipsum.md §5, §9): placeholder text of a given number of words,
 * sentences or paragraphs, made of the 63 words of the classic paragraph, as plain text or `<p>` paragraphs. Pure: no
 * React, no DOM, no chrome, no logging. The tool has no `detect` (§7): a generator takes no text to recognise.
 *
 * Randomness: only the `source` parameter, and every choice is `randomIndex` of @workspace/tools-shared/random
 * (rejection sampling over 32-bit big-endian draws, so no modulo bias for 62, 63, 10, 4 or any other size). The page
 * passes a replay source (`createReplaySource`) whose new bytes come from `cryptoRandom`; tests pass a predictable one.
 *
 * The order the source is consumed (the same source and settings give the same text; every draw is 4 bytes, plus 4 more
 * for each draw thrown away by the rejection):
 *   - a word: `RI(63)` when there is no previous word, otherwise `RI(62)`, shifted up by one at or above the previous
 *     word's index, so a word never follows itself; the previous word carries across sentences and paragraphs;
 *   - a sentence: its length `5 + RI(10)`, then its words in order, then — only when the length is 9 or more — the place
 *     of its comma `3 + RI(length − 6)` (after that word, counted from 1);
 *   - a paragraph: its number of sentences `3 + RI(4)`, then its sentences in order;
 *   - Words: the words in order; Sentences: the sentences in order; Paragraphs: the paragraphs in order;
 *   - the classic opening (§5.4) consumes nothing: its words and its sentence are fixed; the first paragraph still draws
 *     its number of sentences first, and the classic sentence is one of them.
 * Nothing else is drawn, and the format does not change the draws (HTML is the same text in tags).
 */
import { cryptoRandom, randomIndex } from '@workspace/tools-shared/random';
import type { RandomSource } from '@workspace/tools-shared/random';

export type LoremUnit = 'words' | 'sentences' | 'paragraphs';
export type LoremFormat = 'plain' | 'html';

export interface LoremSettings {
  unit: LoremUnit;
  count: number;
  startWithLorem: boolean;
  format: LoremFormat;
}

export interface LoremResult {
  text: string;
  words: number;
  characters: number;
}

/**
 * The classic paragraph of §5.1, one line, no line break at the end: 445 bytes of ASCII, SHA-256
 * 2d8c2f6d978ca21712b5f6de36c9d31fa8e96a4fa5d8ff8b0188dfb9e7c171bb. A garbled passage of Cicero's "De finibus bonorum
 * et malorum" (1.32–33, 45 BC), public domain, as set on Letraset sheets since the 1960s; taken from the specification.
 */
export const CLASSIC_PARAGRAPH =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.';

/** The 63 words of §5.1: every `/[a-z]+/` of the paragraph in lower case, each once, in the order they first appear. */
export const WORDS: readonly string[] = Object.freeze([...new Set(CLASSIC_PARAGRAPH.toLowerCase().match(/[a-z]+/g))]);

/** The largest Count of each unit (§4). */
export const MAX_WORDS = 10_000;
export const MAX_SENTENCES = 1_000;
export const MAX_PARAGRAPHS = 100;
export const LIMITS: Readonly<Record<LoremUnit, number>> = Object.freeze({
  words: MAX_WORDS,
  sentences: MAX_SENTENCES,
  paragraphs: MAX_PARAGRAPHS,
});

/** The state the page opens in (§4): three paragraphs, the classic opening, plain text. */
export const DEFAULT_SETTINGS: LoremSettings = Object.freeze({
  unit: 'paragraphs',
  count: 3,
  startWithLorem: true,
  format: 'plain',
});

/** The order of the Unit and Format toggles, and their words (§4, §8). */
export const UNITS: readonly LoremUnit[] = ['words', 'sentences', 'paragraphs'];
export const UNIT_LABELS: Readonly<Record<LoremUnit, string>> = {
  words: 'Words',
  sentences: 'Sentences',
  paragraphs: 'Paragraphs',
};
export const FORMATS: readonly LoremFormat[] = ['plain', 'html'];
export const FORMAT_LABELS: Readonly<Record<LoremFormat, string>> = { plain: 'Plain text', html: 'HTML' };

/** The words of the classic opening (§5.4): the first eight words of the dictionary. */
const CLASSIC_WORDS = 8;
/** The classic first sentence (§5.4). */
export const CLASSIC_SENTENCE = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.';

const thousands = (n: number): string => n.toLocaleString('en-US');

/** The message under Count (§6), with the unit's limit. */
export const countMessage = (unit: LoremUnit): string => `Enter a whole number from 1 to ${thousands(LIMITS[unit])}.`;

/** The message when the source throws (§6). */
export const RANDOM_FAILED = 'Could not get random numbers from the browser.';

/** Parses the Count field: a whole number from 1 to the unit's limit, or null. Spaces at the ends are trimmed (§6). */
export const parseCount = (text: string, unit: LoremUnit): number | null => {
  const t = text.trim();
  if (!/^[0-9]{1,6}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= LIMITS[unit] ? n : null;
};

/**
 * The Count after a change of Unit (§4): kept if it fits the new unit, otherwise the new unit's limit; a field that is
 * not a whole number stays as typed (its message follows the new unit).
 */
export const countForUnit = (text: string, unit: LoremUnit): string => {
  const t = text.trim();
  if (!/^[0-9]{1,6}$/.test(t)) return text;
  return Number(t) > LIMITS[unit] ? String(LIMITS[unit]) : text;
};

/** The status line under the result (§3, §8): `142 words · 958 characters`. */
export const statusLine = (result: Pick<LoremResult, 'words' | 'characters'>): string =>
  `${thousands(result.words)} ${result.words === 1 ? 'word' : 'words'} · ${thousands(result.characters)} ${
    result.characters === 1 ? 'character' : 'characters'
  }`;

const capitalize = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/** One generation's state: the source and the previous word's index (−1: none yet). */
interface Drawer {
  source: RandomSource;
  prev: number;
  words: number;
}

/** §5.2, a word: never the previous one, the others equally likely. */
const drawWord = (d: Drawer): string => {
  let i: number;
  if (d.prev < 0) i = randomIndex(WORDS.length, d.source);
  else {
    i = randomIndex(WORDS.length - 1, d.source);
    if (i >= d.prev) i += 1;
  }
  d.prev = i;
  d.words += 1;
  return WORDS[i]!;
};

/** §5.2, a sentence: 5–14 words, a comma after the 3rd…(len − 4)th when there are 9 or more, a capital, a full stop. */
const drawSentence = (d: Drawer): string => {
  const len = 5 + randomIndex(10, d.source);
  const words: string[] = [];
  for (let k = 0; k < len; k++) words.push(drawWord(d));
  if (len >= 9) {
    const after = 3 + randomIndex(len - 6, d.source);
    words[after - 1] += ',';
  }
  words[0] = capitalize(words[0]!);
  return `${words.join(' ')}.`;
};

/** The classic first sentence: no draw; the previous word is `elit` (7). */
const classicSentence = (d: Drawer): string => {
  d.prev = CLASSIC_WORDS - 1;
  d.words += CLASSIC_WORDS;
  return CLASSIC_SENTENCE;
};

/** §5.2, a paragraph: 3–6 sentences, the number drawn before them; the first may be the classic one. */
const drawParagraph = (d: Drawer, classic: boolean): string => {
  const n = 3 + randomIndex(4, d.source);
  const sentences: string[] = [];
  for (let k = 0; k < n; k++) sentences.push(classic && k === 0 ? classicSentence(d) : drawSentence(d));
  return sentences.join(' ');
};

/** The paragraphs of a generation, before the format (§5.3, §5.4). */
const paragraphsOf = (settings: LoremSettings, d: Drawer): string[] => {
  const { unit, count, startWithLorem } = settings;
  if (unit === 'words') {
    const words: string[] = [];
    const classic = startWithLorem ? Math.min(count, CLASSIC_WORDS) : 0;
    for (let k = 0; k < classic; k++) words.push(WORDS[k]!);
    if (classic > 0) {
      d.prev = classic - 1;
      d.words += classic;
    }
    while (words.length < count) words.push(drawWord(d));
    words[0] = capitalize(words[0]!);
    return [words.join(' ')];
  }
  if (unit === 'sentences') {
    const sentences: string[] = [];
    for (let k = 0; k < count; k++) sentences.push(startWithLorem && k === 0 ? classicSentence(d) : drawSentence(d));
    return [sentences.join(' ')];
  }
  const paragraphs: string[] = [];
  for (let k = 0; k < count; k++) paragraphs.push(drawParagraph(d, startWithLorem && k === 0));
  return paragraphs;
};

/**
 * §5.2–5.5. Plain text: paragraphs joined by a blank line; HTML: each paragraph in `<p>…</p>`, joined by a line break
 * (Words and Sentences are one paragraph); no line break at the end. The text is only `a–z`, `A–Z`, space, `,` and `.`
 * (and the tags), so nothing needs escaping. Throws only if `source` throws. `count` is taken as given: the page parses
 * it first (`parseCount`); a count under 1 gives an empty text.
 */
export const generate = (settings: LoremSettings, source: RandomSource): LoremResult => {
  const d: Drawer = { source, prev: -1, words: 0 };
  const count = Math.max(0, Math.floor(settings.count));
  const paragraphs = count === 0 ? [] : paragraphsOf({ ...settings, count }, d);
  const text = settings.format === 'html' ? paragraphs.map(p => `<p>${p}</p>`).join('\n') : paragraphs.join('\n\n');
  return { text, words: d.words, characters: text.length };
};

/** The bytes a replay source asks `fill` for at a time. */
const REPLAY_BLOCK = 4096;

/**
 * §5.6: a record of a source's bytes. Every `reader()` is a source that reads the record from its start; bytes past
 * the end are taken from `fill` (in blocks of 4,096) and kept, so the next reader gives them again. `reset()` forgets
 * the record: the next reader gives new bytes. `fill` defaults to `cryptoRandom`. The record lives in memory only.
 */
export const createReplaySource = (
  fill: RandomSource = cryptoRandom,
): { reader: () => RandomSource; reset: () => void } => {
  let record = new Uint8Array(0);
  let length = 0;
  const ensure = (end: number): void => {
    if (end <= length) return;
    const need = Math.ceil((end - length) / REPLAY_BLOCK) * REPLAY_BLOCK;
    const block = new Uint8Array(need);
    fill(block);
    if (length + need > record.length) {
      const grown = new Uint8Array(Math.max(length + need, record.length * 2));
      grown.set(record.subarray(0, length));
      record = grown;
    }
    record.set(block, length);
    length += need;
  };
  return {
    reader: () => {
      let at = 0;
      return bytes => {
        ensure(at + bytes.length);
        bytes.set(record.subarray(at, at + bytes.length));
        at += bytes.length;
      };
    },
    reset: () => {
      record = new Uint8Array(0);
      length = 0;
    },
  };
};
