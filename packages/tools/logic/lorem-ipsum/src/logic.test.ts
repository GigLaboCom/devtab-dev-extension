import {
  CLASSIC_PARAGRAPH,
  CLASSIC_SENTENCE,
  DEFAULT_SETTINGS,
  LIMITS,
  RANDOM_FAILED,
  WORDS,
  countForUnit,
  countMessage,
  createReplaySource,
  generate,
  parseCount,
  statusLine,
} from './logic';
import { cryptoRandom, randomIndex } from '@workspace/tools-shared/random';
import { describe, expect, it } from 'vitest';
import { createCipheriv, createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LoremFormat, LoremResult, LoremSettings, LoremUnit } from './logic';
import type { RandomSource } from '@workspace/tools-shared/random';

// The test sources (§10, as in password.md §10). `counter`: the bytes 0, 1, 2, … mod 256, counting on across calls.
// `list(…)`: the given bytes in a loop. `aesStream`: a deterministic stream of good bytes — AES-128 in counter mode over
// zeros, keyed by a seed — in which every byte value occurs; the same seed gives the same stream.
const counter = (): RandomSource => {
  let c = 0;
  return bytes => {
    for (let i = 0; i < bytes.length; i++) bytes[i] = c++ & 0xff;
  };
};
const list = (values: number[]): RandomSource => {
  let c = 0;
  return out => {
    for (let i = 0; i < out.length; i++) out[i] = values[c++ % values.length]!;
  };
};
const aesStream = (seed: string): RandomSource => {
  const key = createHash('sha256').update(seed).digest();
  const cipher = createCipheriv('aes-128-ctr', key.subarray(0, 16), key.subarray(16, 32));
  return bytes => bytes.set(cipher.update(new Uint8Array(bytes.length)));
};
/** A source that records the size of every request it answers. */
const recorded = (inner: RandomSource) => {
  const calls: number[] = [];
  const source: RandomSource = bytes => {
    inner(bytes);
    calls.push(bytes.length);
  };
  return { source, calls };
};

const settings = (over: Partial<LoremSettings> = {}): LoremSettings => ({ ...DEFAULT_SETTINGS, ...over });
const run = (over: Partial<LoremSettings>, source: RandomSource = counter()): LoremResult =>
  generate(settings(over), source);
const text = (over: Partial<LoremSettings>, source?: RandomSource): string => run(over, source).text;
const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

describe('§5.1: the dictionary and the data file', () => {
  it('the classic paragraph: 445 bytes of ASCII, one line, the SHA-256 of the specification', () => {
    expect(Buffer.byteLength(CLASSIC_PARAGRAPH, 'utf8')).toBe(445);
    expect(CLASSIC_PARAGRAPH.length).toBe(445);
    expect(CLASSIC_PARAGRAPH).not.toMatch(/\n/);
    expect(CLASSIC_PARAGRAPH).toMatch(/^[\x20-\x7e]+$/);
    expect(sha256(CLASSIC_PARAGRAPH)).toBe('2d8c2f6d978ca21712b5f6de36c9d31fa8e96a4fa5d8ff8b0188dfb9e7c171bb');
  });

  it('63 words, first lorem, last laborum, in the order of §5.1', () => {
    expect(WORDS).toHaveLength(63);
    expect(WORDS[0]).toBe('lorem');
    expect(WORDS[62]).toBe('laborum');
    expect(WORDS.join(' ')).toBe(
      'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore ' +
        'et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ' +
        'ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum eu fugiat ' +
        'nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt ' +
        'mollit anim id est laborum',
    );
    expect(new Set(WORDS).size).toBe(63);
    expect(Object.isFrozen(WORDS)).toBe(true);
  });

  it('the classic sentence is the paragraph’s first eight words with its comma', () => {
    expect(CLASSIC_SENTENCE).toBe('Lorem ipsum dolor sit amet, consectetur adipiscing elit.');
    expect(CLASSIC_PARAGRAPH.startsWith(CLASSIC_SENTENCE.slice(0, -1))).toBe(true);
    expect(CLASSIC_SENTENCE.toLowerCase().match(/[a-z]+/g)).toEqual(WORDS.slice(0, 8));
  });
});

describe('§10: the examples, word for word', () => {
  it('counter, Words 1: Lorem; 1 word, 5 characters', () => {
    const r = run({ unit: 'words', count: 1 });
    expect(r).toEqual({ text: 'Lorem', words: 1, characters: 5 });
    expect(statusLine(r)).toBe('1 word · 5 characters');
  });

  it('counter, Words 5 / 8 / 12', () => {
    expect(text({ unit: 'words', count: 5 })).toBe('Lorem ipsum dolor sit amet');
    expect(text({ unit: 'words', count: 8 })).toBe('Lorem ipsum dolor sit amet consectetur adipiscing elit');
    expect(text({ unit: 'words', count: 12 })).toBe(
      'Lorem ipsum dolor sit amet consectetur adipiscing elit veniam consectetur proident aute',
    );
  });

  it('counter, Words 5, without the opening', () => {
    expect(text({ unit: 'words', count: 5, startWithLorem: false })).toBe('Laboris consectetur proident aute enim');
  });

  it('list([0]), Words 4, without the opening: a word never follows itself', () => {
    expect(text({ unit: 'words', count: 4, startWithLorem: false }, list([0]))).toBe('Lorem ipsum lorem ipsum');
  });

  it('counter, Sentences 1: the classic sentence; 8 words, 56 characters', () => {
    expect(run({ unit: 'sentences', count: 1 })).toEqual({ text: CLASSIC_SENTENCE, words: 8, characters: 56 });
  });

  it('counter, Sentences 2, with and without the opening', () => {
    expect(text({ unit: 'sentences', count: 2 })).toBe(
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Consectetur proident aute enim sit cupidatat.',
    );
    expect(text({ unit: 'sentences', count: 2, startWithLorem: false })).toBe(
      'Proident non aute enim sit cupidatat. Magna ipsum sint ea et laborum nulla aliquip.',
    );
  });

  it('list([0]), Sentences 1, without the opening: five words, no comma', () => {
    expect(text({ unit: 'sentences', count: 1, startWithLorem: false }, list([0]))).toBe(
      'Lorem ipsum lorem ipsum lorem.',
    );
  });

  it('list([FF FF FF FF 00 00 00 09]), Sentences 1: RI(10) rejects FF FF FF FF, RI(8) accepts it — 14 words, comma after the 10th', () => {
    expect(
      text({ unit: 'sentences', count: 1, startWithLorem: false }, list([0xff, 0xff, 0xff, 0xff, 0, 0, 0, 9])),
    ).toBe('Do eiusmod do eiusmod do eiusmod do eiusmod do eiusmod, do eiusmod do eiusmod.');
  });

  it('counter, Paragraphs 1: six sentences; 52 words, 326 characters', () => {
    const r = run({ unit: 'paragraphs', count: 1 });
    expect(
      r.text.startsWith(
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Proident aute enim sit cupidatat consequat magna ipsum, sint ea et laborum.',
      ),
    ).toBe(true);
    expect(r.text.match(/\./g)).toHaveLength(6);
    expect(r.words).toBe(52);
    expect(r.characters).toBe(326);
  });

  it('counter, Paragraphs 2: the first as above, a blank line, the second; 106 words, 690 characters', () => {
    const one = text({ unit: 'paragraphs', count: 1 });
    const r = run({ unit: 'paragraphs', count: 2 });
    const [first, second, ...rest] = r.text.split('\n\n');
    expect(rest).toEqual([]);
    expect(first).toBe(one);
    expect(second!.startsWith('Ullamco do officia voluptate quis elit, culpa in minim')).toBe(true);
    expect(r.words).toBe(106);
    expect(r.characters).toBe(690);
  });

  it('counter, Paragraphs 2, HTML: the same paragraphs in <p>…</p>, one per line; 106 words, 703 characters', () => {
    const plain = text({ unit: 'paragraphs', count: 2 });
    const r = run({ unit: 'paragraphs', count: 2, format: 'html' });
    expect(r.text).toBe(
      plain
        .split('\n\n')
        .map(p => `<p>${p}</p>`)
        .join('\n'),
    );
    expect(r.words).toBe(106);
    expect(r.characters).toBe(703);
  });

  it('counter, Words 3, HTML: one <p>', () => {
    expect(text({ unit: 'words', count: 3, format: 'html' })).toBe('<p>Lorem ipsum dolor</p>');
  });

  it('replay(counter), Paragraphs 2 then 3: the text for 3 begins with the text for 2', () => {
    const replay = createReplaySource(counter());
    const two = text({ unit: 'paragraphs', count: 2 }, replay.reader());
    const three = text({ unit: 'paragraphs', count: 3 }, replay.reader());
    expect(three.startsWith(`${two}\n\n`)).toBe(true);
    expect(three.split('\n\n')).toHaveLength(3);
  });

  it('replay(counter), Words 5 and 7 without the opening: the text for 7 begins with the text for 5', () => {
    const replay = createReplaySource(counter());
    const five = text({ unit: 'words', count: 5, startWithLorem: false }, replay.reader());
    const seven = text({ unit: 'words', count: 7, startWithLorem: false }, replay.reader());
    expect(seven.startsWith(`${five} `)).toBe(true);
    expect(seven.split(' ')).toHaveLength(7);
  });

  it('cryptoRandom, 2,000 times, Sentences 1 without the opening: 5–14 words; a comma iff ≥ 9, after the 3rd…(len − 4)th; no word twice in a row', () => {
    for (let k = 0; k < 2000; k++) {
      const r = run({ unit: 'sentences', count: 1, startWithLorem: false }, cryptoRandom);
      const words = r.text.slice(0, -1).split(' ');
      expect(words.length).toBeGreaterThanOrEqual(5);
      expect(words.length).toBeLessThanOrEqual(14);
      expect(r.words).toBe(words.length);
      const commas = words.flatMap((w, i) => (w.endsWith(',') ? [i + 1] : []));
      if (words.length >= 9) {
        expect(commas).toHaveLength(1);
        expect(commas[0]).toBeGreaterThanOrEqual(3);
        expect(commas[0]).toBeLessThanOrEqual(words.length - 4);
      } else expect(commas).toEqual([]);
      const bare = words.map(w => w.replace(',', '').toLowerCase());
      for (let i = 1; i < bare.length; i++) expect(bare[i]).not.toBe(bare[i - 1]);
    }
  });

  it('cryptoRandom, the limits: Words 10,000 / Sentences 1,000 / Paragraphs 100 — about 65,600 / 63,900 / 28,800 characters', () => {
    // The means (corrected from the specification's 65,400 / 64,200 / 28,000): a word of the dictionary averages
    // 350 / 63 = 5.56 letters; a sentence 9.5 words, 8.5 spaces, a full stop and a comma 6 times in 10 — 63.9
    // characters; a paragraph 4.5 sentences. So 10,000 × 5.56 + 9,999 = 65,555; 1,000 × 63.9 + 999 = 63,877;
    // 100 × (4.5 × 63.9 + 3.5) + 198 = 28,843. The spread (one standard deviation) is about 0.3 %, 0.9 % and 2.8 %; the
    // bounds are 2 %, 4 % and 12 % — over four deviations each, a false failure well under 1 in 10,000 runs.
    const words = run({ unit: 'words', count: LIMITS.words }, cryptoRandom);
    const sentences = run({ unit: 'sentences', count: LIMITS.sentences }, cryptoRandom);
    const paragraphs = run({ unit: 'paragraphs', count: LIMITS.paragraphs }, cryptoRandom);
    expect(WORDS.join('').length).toBe(350);
    expect(words.words).toBe(10_000);
    expect(Math.abs(words.characters / 65_555 - 1)).toBeLessThan(0.02);
    expect(Math.abs(sentences.characters / 63_877 - 1)).toBeLessThan(0.04);
    expect(Math.abs(paragraphs.characters / 28_843 - 1)).toBeLessThan(0.12);
  });

  it('parseCount, Paragraphs: abc, 0, 101, 2.5, 1e3, empty → null; " 5 ", 100 → 5, 100', () => {
    for (const bad of ['abc', '0', '101', '2.5', '1e3', '', '-3', '+5', '0x10', '5 5', '١٢'])
      expect(parseCount(bad, 'paragraphs')).toBeNull();
    expect(parseCount(' 5 ', 'paragraphs')).toBe(5);
    expect(parseCount('\t5\n', 'paragraphs')).toBe(5);
    expect(parseCount('100', 'paragraphs')).toBe(100);
    expect(parseCount('007', 'paragraphs')).toBe(7);
  });

  it('the source throws: generate throws; the page’s message is the one of §6', () => {
    const failing: RandomSource = () => {
      throw new DOMException('no entropy', 'QuotaExceededError');
    };
    expect(() => run({ startWithLorem: false, unit: 'words', count: 1 }, failing)).toThrow('no entropy');
    expect(() => run({}, failing)).toThrow('no entropy');
    expect(RANDOM_FAILED).toBe('Could not get random numbers from the browser.');
  });
});

describe('§4, §6: Count, its limits and the change of Unit', () => {
  it('the limits: 10,000 words, 1,000 sentences, 100 paragraphs — each accepted, one more refused', () => {
    expect(LIMITS).toEqual({ words: 10_000, sentences: 1_000, paragraphs: 100 });
    for (const unit of ['words', 'sentences', 'paragraphs'] as const) {
      expect(parseCount('1', unit)).toBe(1);
      expect(parseCount(String(LIMITS[unit]), unit)).toBe(LIMITS[unit]);
      expect(parseCount(String(LIMITS[unit] + 1), unit)).toBeNull();
      expect(parseCount('0', unit)).toBeNull();
    }
    expect(parseCount('10,000', 'words')).toBeNull();
    expect(parseCount('99999999999999999999', 'words')).toBeNull();
  });

  it('the message names the unit’s limit', () => {
    expect(countMessage('paragraphs')).toBe('Enter a whole number from 1 to 100.');
    expect(countMessage('sentences')).toBe('Enter a whole number from 1 to 1,000.');
    expect(countMessage('words')).toBe('Enter a whole number from 1 to 10,000.');
  });

  it('a change of Unit keeps Count when it fits, else takes the new limit (500 words → 100 paragraphs)', () => {
    expect(countForUnit('500', 'paragraphs')).toBe('100');
    expect(countForUnit('500', 'sentences')).toBe('500');
    expect(countForUnit('5000', 'sentences')).toBe('1000');
    expect(countForUnit('3', 'words')).toBe('3');
    expect(countForUnit('abc', 'paragraphs')).toBe('abc');
    expect(countForUnit('', 'paragraphs')).toBe('');
  });

  it('the status line: thousands with a comma, singular for one', () => {
    expect(statusLine({ words: 142, characters: 958 })).toBe('142 words · 958 characters');
    expect(statusLine({ words: 10_000, characters: 65_432 })).toBe('10,000 words · 65,432 characters');
    expect(statusLine({ words: 1, characters: 1 })).toBe('1 word · 1 character');
  });

  it('the state the page opens in: three paragraphs, the classic opening, plain text', () => {
    expect(DEFAULT_SETTINGS).toEqual({ unit: 'paragraphs', count: 3, startWithLorem: true, format: 'plain' });
  });
});

describe('§5.2: randomness — only randomIndex of the shared module, in the documented order', () => {
  it('every request to the source is one 4-byte draw (randomIndex’s), and the opening draws nothing', () => {
    for (const unit of ['words', 'sentences', 'paragraphs'] as const)
      for (const startWithLorem of [true, false]) {
        const { source, calls } = recorded(aesStream(`draws-${unit}-${startWithLorem}`));
        generate(settings({ unit, count: 12, startWithLorem }), source);
        expect(calls.length).toBeGreaterThan(0);
        expect(calls.every(n => n === 4)).toBe(true);
      }
    const { source, calls } = recorded(counter());
    generate(settings({ unit: 'words', count: 8 }), source);
    generate(settings({ unit: 'sentences', count: 1 }), source);
    expect(calls).toEqual([]);
  });

  it('the order: Sentences 1 draws its length, its words, then its comma — as many draws as §5.2 says', () => {
    // A source of 32-bit values: v0 = 4 → len 9, then nine words, then the comma's place, then nothing more.
    const values = [4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2];
    const bytes = values.flatMap(v => [0, 0, 0, v]);
    const { source, calls } = recorded(list(bytes));
    const r = generate(settings({ unit: 'sentences', count: 1, startWithLorem: false }), source);
    expect(calls).toHaveLength(values.length);
    // Words: RI(63) = 0 → lorem; then RI(62) = 0, shifted past lorem → ipsum; then lorem again, and so on.
    expect(r.text).toBe('Lorem ipsum lorem ipsum lorem, ipsum lorem ipsum lorem.');
  });

  it('the order: a paragraph draws its number of sentences before them, also with the classic opening', () => {
    // 3 + RI(4) with v = 0 → 3 sentences; the classic one is the first; two more of length 5 + 0 = 5.
    const { source, calls } = recorded(list([0, 0, 0, 0]));
    const r = generate(settings({ unit: 'paragraphs', count: 1 }), source);
    expect(r.text).toBe(`${CLASSIC_SENTENCE} Lorem ipsum lorem ipsum lorem. Ipsum lorem ipsum lorem ipsum.`);
    expect(calls).toHaveLength(1 + 2 * (1 + 5));
  });

  it('the same source and settings give the same text; another seed another text', () => {
    for (const unit of ['words', 'sentences', 'paragraphs'] as const) {
      const s = settings({ unit, count: 40, startWithLorem: false });
      expect(generate(s, aesStream('same')).text).toBe(generate(s, aesStream('same')).text);
      expect(generate(s, aesStream('same')).text).not.toBe(generate(s, aesStream('other')).text);
    }
  });

  it('the format does not change the draws: HTML is the plain text in tags', () => {
    for (const unit of ['words', 'sentences', 'paragraphs'] as const) {
      const plain = text({ unit, count: 9 }, aesStream('fmt'));
      const html = text({ unit, count: 9, format: 'html' }, aesStream('fmt'));
      expect(html).toBe(
        plain
          .split('\n\n')
          .map(p => `<p>${p}</p>`)
          .join('\n'),
      );
    }
  });

  it('the logic’s sources use no Math.random, no console and no debug logger, and draw only through randomIndex', () => {
    const root = dirname(fileURLToPath(import.meta.url));
    const files = readdirSync(root)
      .filter(f => /\.ts$/.test(f) && !/\.test\.ts$/.test(f))
      .map(f => join(root, f));
    expect(files.length).toBe(2);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/Math\.random|console\.|createDebug|getRandomValues/);
    }
    const logic = readFileSync(join(root, 'logic.ts'), 'utf8');
    expect(logic).toMatch(/from '@workspace\/tools-shared\/random'/);
  });
});

/*
 * No modulo bias (§5.2). A word after another is `RI(62)`, shifted past the previous word; a sentence's length is
 * `5 + RI(10)`; a paragraph's number of sentences `3 + RI(4)`. The classic mistake is `byte % n`: for 62 and 10, which
 * do not divide 256, some values come out 1/256 more often. The tests recover each raw draw from the text (the index of a
 * word among the 62 others, the length − 5, the number of sentences − 3), count them, and compare with the uniform
 * expectation by Pearson's χ² with n − 1 degrees of freedom. The threshold is the χ² value an honest generator exceeds
 * with probability 10⁻⁶. Over the deterministic AES stream the counts are the same every run, so the test cannot fail
 * falsely; the same stream through `byte % n` is asserted far over the threshold, so the test does catch the mistake.
 */
/** By the number of values n: the χ²(n − 1) value exceeded with probability 10⁻⁶ (checked by the survival function). */
const CRITICAL: Record<number, number> = { 4: 30.66, 10: 44.81, 62: 128.52 };
/** χ²(62) exceeded with probability 10⁻⁶: the 63 first words. */
const CRITICAL_63 = 129.95;

const lnGamma = (z: number): number => {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  const y = z - 1;
  let x = c[0]!;
  for (let i = 1; i < 9; i++) x += c[i]! / (y + i);
  const t = y + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (y + 0.5) * Math.log(t) - t + Math.log(x);
};
/** P(χ²(df) > x): the regularized upper incomplete gamma Q(df/2, x/2). */
const chiSquareSurvival = (x: number, df: number): number => {
  const a = df / 2;
  const z = x / 2;
  const front = Math.exp(-z + a * Math.log(z) - lnGamma(a));
  if (z < a + 1) {
    let term = 1 / a;
    let sum = term;
    for (let n = 1; n < 10_000 && Math.abs(term) > Math.abs(sum) * 1e-16; n++) sum += term *= z / (a + n);
    return 1 - sum * front;
  }
  let b = z + 1 - a;
  let c = 1e300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 10_000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = 1 / (an * d + b);
    c = b + an / c;
    h *= d * c;
    if (Math.abs(d * c - 1) < 1e-16) break;
  }
  return front * h;
};
const chiSquare = (counts: readonly number[]): number => {
  const total = counts.reduce((a, b) => a + b, 0);
  const expected = total / counts.length;
  return counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
};
const INDEX = new Map(WORDS.map((w, i) => [w, i]));
/** The raw RI(62) draws behind a text of Words: each word's index among the 62 that are not the previous one. */
const wordDraws = (t: string, counts: number[]): void => {
  const words = t.toLowerCase().split(' ');
  for (let k = 1; k < words.length; k++) {
    const prev = INDEX.get(words[k - 1]!)!;
    const i = INDEX.get(words[k]!)!;
    counts[i > prev ? i - 1 : i]!++;
  }
};
/** The classic mistake over the same kind of stream: one byte a draw, `byte % n`. */
const moduloCounts = (n: number, total: number, source: RandomSource): number[] => {
  const counts = Array<number>(n).fill(0);
  const block = new Uint8Array(65_536);
  for (let made = 0; made < total; made += block.length) {
    source(block);
    const take = Math.min(block.length, total - made);
    for (let i = 0; i < take; i++) counts[block[i]! % n]!++;
  }
  return counts;
};

describe('§5.2: no modulo bias — χ² of the raw draws recovered from the text', () => {
  it('the thresholds are the χ² values exceeded with probability 10⁻⁶', () => {
    expect(chiSquareSurvival(27.88, 9)).toBeCloseTo(0.000999, 6);
    for (const [n, critical] of Object.entries(CRITICAL)) {
      const p = chiSquareSurvival(critical, Number(n) - 1);
      expect(p).toBeGreaterThan(0.95e-6);
      expect(p).toBeLessThan(1.05e-6);
    }
  });

  it('the choice of a word (RI(62)): 1,000,000 draws under the threshold; byte % 62 far over it', () => {
    const counts = Array<number>(62).fill(0);
    const source = aesStream('words-bias');
    for (let k = 0; k < 100; k++)
      wordDraws(generate(settings({ unit: 'words', count: LIMITS.words, startWithLorem: false }), source).text, counts);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(100 * (LIMITS.words - 1));
    expect(chiSquare(counts)).toBeLessThan(CRITICAL[62]!);
    expect(chiSquare(moduloCounts(62, 999_900, aesStream('words-bias')))).toBeGreaterThan(3 * CRITICAL[62]!);
  });

  it('the first word (RI(63)) and every word overall are uniform over the 63', () => {
    const first = Array<number>(63).fill(0);
    const all = Array<number>(63).fill(0);
    const source = aesStream('first-word');
    for (let k = 0; k < 63_000; k++) {
      const t = generate(settings({ unit: 'words', count: 4, startWithLorem: false }), source).text.toLowerCase();
      const words = t.split(' ');
      first[INDEX.get(words[0]!)!]!++;
      for (const w of words) all[INDEX.get(w)!]!++;
    }
    // The overall counts are of a chain (a word is never its predecessor), so only a loose bound for them (×1.5).
    expect(chiSquareSurvival(CRITICAL_63, 62)).toBeGreaterThan(0.95e-6);
    expect(chiSquare(first)).toBeLessThan(CRITICAL_63);
    expect(chiSquare(all)).toBeLessThan(1.5 * CRITICAL_63);
  });

  it('sentence lengths (5 + RI(10)): 1,000,000 under the threshold, byte % 10 far over it', () => {
    const lengths = Array<number>(10).fill(0);
    const source = aesStream('lengths');
    for (let k = 0; k < 1000; k++) {
      const t = generate(settings({ unit: 'sentences', count: LIMITS.sentences, startWithLorem: false }), source).text;
      let words = 1;
      for (let i = 0; i < t.length; i++) {
        const c = t.charCodeAt(i);
        if (c === 32) words++;
        else if (c === 46) {
          lengths[words - 5]!++;
          words = 0;
        }
      }
    }
    expect(lengths.reduce((a, b) => a + b, 0)).toBe(1_000_000);
    expect(chiSquare(lengths)).toBeLessThan(CRITICAL[10]!);
    expect(chiSquare(moduloCounts(10, 1_000_000, aesStream('lengths')))).toBeGreaterThan(3 * CRITICAL[10]!);
  }, 60_000);

  it('sentences per paragraph (3 + RI(4)) are uniform; 4 divides 256, so byte % 4 would be too', () => {
    const perParagraph = Array<number>(4).fill(0);
    const source = aesStream('per-paragraph');
    for (let k = 0; k < 400; k++) {
      const t = generate(
        settings({ unit: 'paragraphs', count: LIMITS.paragraphs, startWithLorem: false }),
        source,
      ).text;
      for (const p of t.split('\n\n')) perParagraph[p.split('.').length - 1 - 3]!++;
    }
    expect(perParagraph.reduce((a, b) => a + b, 0)).toBe(40_000);
    expect(chiSquare(perParagraph)).toBeLessThan(CRITICAL[4]!);
  });

  it('over the browser’s source too (false failure: 1 in 10⁶)', () => {
    const counts = Array<number>(62).fill(0);
    for (let k = 0; k < 50; k++)
      wordDraws(
        generate(settings({ unit: 'words', count: LIMITS.words, startWithLorem: false }), cryptoRandom).text,
        counts,
      );
    expect(chiSquare(counts)).toBeLessThan(CRITICAL[62]!);
  });
});

/** Every rule of §5.3–5.5 broken by one generated text (none: an empty list). Plain checks, one expect per text. */
const problems = (s: LoremSettings, r: LoremResult): string[] => {
  const out: string[] = [];
  const fail = (what: string) => out.push(what);
  if (r.characters !== r.text.length) fail('characters ≠ text.length');
  if (r.text.endsWith('\n')) fail('a line break at the end');
  let paragraphs: string[];
  if (s.format === 'html') {
    if (!/^<p>[A-Za-z ,.]+<\/p>(\n<p>[A-Za-z ,.]+<\/p>)*$/.test(r.text)) fail('not <p> lines of letters');
    paragraphs = r.text.split('\n').map(line => line.slice(3, -4));
  } else {
    if (!/^[A-Za-z ,.]+(\n\n[A-Za-z ,.]+)*$/.test(r.text)) fail('not blank-line paragraphs of letters');
    paragraphs = r.text.split('\n\n');
  }
  if (paragraphs.length !== (s.unit === 'paragraphs' ? s.count : 1)) fail(`${paragraphs.length} paragraphs`);
  const all: string[] = [];
  for (const p of paragraphs) {
    if (/^ | $| {2}/.test(p)) fail('a space at an end or two in a row');
    if (s.unit === 'words') {
      if (!/^[A-Z][a-z]*( [a-z]+)*$/.test(p)) fail('Words: not one capital then lower-case words, no punctuation');
      all.push(...p.toLowerCase().split(' '));
      continue;
    }
    const sentences = p.split(/(?<=\.) /);
    if (s.unit === 'paragraphs' && (sentences.length < 3 || sentences.length > 6))
      fail(`${sentences.length} sentences in a paragraph`);
    if (s.unit === 'sentences' && sentences.length !== s.count) fail(`${sentences.length} sentences`);
    for (const sentence of sentences) {
      // A capital, lower case after it, a comma only right after a word and before a space, a full stop.
      if (!/^[A-Z][a-z]*(,? [a-z]+)*\.$/.test(sentence)) fail(`sentence shape: ${sentence}`);
      const words = sentence.slice(0, -1).split(' ');
      if (words.length < 5 || words.length > 14) fail(`${words.length} words in a sentence`);
      const commas = words.flatMap((w, i) => (w.endsWith(',') ? [i + 1] : []));
      const expected =
        sentence === CLASSIC_SENTENCE
          ? commas.length === 1 && commas[0] === 5
          : words.length >= 9
            ? commas.length === 1 && commas[0]! >= 3 && commas[0]! <= words.length - 4
            : commas.length === 0;
      if (!expected) fail(`comma rule: ${sentence}`);
      for (const w of words) all.push(w.endsWith(',') ? w.slice(0, -1).toLowerCase() : w.toLowerCase());
    }
  }
  for (let i = 0; i < all.length; i++) {
    if (!INDEX.has(all[i]!)) fail(`not a word of the dictionary: ${all[i]}`);
    if (i > 0 && all[i] === all[i - 1]) fail(`"${all[i]}" twice in a row`);
  }
  if (r.words !== all.length) fail(`words ${r.words} ≠ ${all.length}`);
  if (s.unit === 'words' && all.length !== s.count) fail(`${all.length} words`);
  if (s.startWithLorem) {
    const body = s.format === 'html' ? r.text.slice(3) : r.text;
    const opening =
      s.unit === 'words'
        ? 'Lorem ipsum dolor sit amet consectetur adipiscing elit'.split(' ').slice(0, Math.min(s.count, 8)).join(' ')
        : CLASSIC_SENTENCE;
    if (!body.startsWith(opening)) fail('the opening is not there');
  }
  return out;
};

describe('§5.3–5.5: every generated text keeps the rules — a property test over many seeds', () => {
  const units: LoremUnit[] = ['words', 'sentences', 'paragraphs'];
  const formats: LoremFormat[] = ['plain', 'html'];

  it('600 seeds × unit × format × opening, counts from 1 to the limit', () => {
    let texts = 0;
    for (let seed = 0; seed < 600; seed++) {
      const pick = aesStream(`case-${seed}`);
      for (const unit of units)
        for (const format of formats)
          for (const startWithLorem of [true, false]) {
            // Mostly small counts (where the opening and the edges are), sometimes up to the limit.
            const limit = randomIndex(8, pick) === 0 ? LIMITS[unit] : Math.min(LIMITS[unit], 30);
            const count = 1 + randomIndex(limit, pick);
            const s = settings({ unit, count, format, startWithLorem });
            const found = problems(s, generate(s, aesStream(`text-${seed}`)));
            if (found.length > 0) expect.fail(`${JSON.stringify(s)}, seed ${seed}: ${found.join('; ')}`);
            texts++;
          }
    }
    expect(texts).toBe(600 * 12);
  }, 120_000);

  it('the check itself finds a broken text: a repeat, a missing capital, a stray comma, a short sentence, a wrong count', () => {
    const s = settings({ unit: 'sentences', count: 2, startWithLorem: false });
    const ok = 'Lorem ipsum dolor sit amet. Sed do eiusmod tempor incididunt.';
    const as = (t: string, words = 10): LoremResult => ({ text: t, words, characters: t.length });
    expect(problems(s, as(ok))).toEqual([]);
    for (const broken of [
      'Lorem ipsum ipsum sit amet. Sed do eiusmod tempor incididunt.',
      'lorem ipsum dolor sit amet. Sed do eiusmod tempor incididunt.',
      'Lorem ipsum, dolor sit amet. Sed do eiusmod tempor incididunt.',
      'Lorem ipsum dolor sit. Sed do eiusmod tempor incididunt amet.',
      'Lorem ipsum dolor sit amet. Sed do eiusmod tempor incididunt. Ut labore et dolore magna.',
      'Lorem ipsum dolor sit amet.  Sed do eiusmod tempor incididunt.',
      'Lorem ipsum dolor sit amet. Sed do eiusmod tempor incididunt.\n',
      'Lorem ipsum dolor sit amet. Sed do eiusmod tempor foo.',
    ])
      expect(problems(s, as(broken))).not.toEqual([]);
    expect(problems(s, as(ok, 9))).not.toEqual([]);
    expect(problems({ ...s, startWithLorem: true }, as(ok))).not.toEqual([]);
  });

  it('the limits and one under, both formats, with and without the opening', () => {
    for (const unit of units)
      for (const count of [LIMITS[unit], LIMITS[unit] - 1, 1, 2])
        for (const format of formats)
          for (const startWithLorem of [true, false]) {
            const s = settings({ unit, count, format, startWithLorem });
            expect(problems(s, generate(s, aesStream(`limit-${unit}-${count}`)))).toEqual([]);
          }
  });
});

describe('§5.4: the classic opening is exact, character for character, for every unit and count', () => {
  const opening = 'Lorem ipsum dolor sit amet consectetur adipiscing elit';

  it('Words 1…8: the first Count words of the opening, nothing else; 9…200 and up to the limit: the opening, then a space', () => {
    for (let count = 1; count <= 8; count++)
      expect(text({ unit: 'words', count }, aesStream(`w${count}`))).toBe(opening.split(' ').slice(0, count).join(' '));
    for (const count of [...Array.from({ length: 192 }, (_, i) => i + 9), 1000, 5000, 9999, 10_000]) {
      const t = text({ unit: 'words', count }, aesStream(`w${count}`));
      expect(t.startsWith(`${opening} `)).toBe(true);
      expect(t.split(' ')).toHaveLength(count);
    }
  });

  it('Sentences 1…1,000: the classic sentence first, and alone for 1', () => {
    expect(text({ unit: 'sentences', count: 1 }, aesStream('s'))).toBe(CLASSIC_SENTENCE);
    const replay = createReplaySource(aesStream('sentences'));
    for (let count = 2; count <= LIMITS.sentences; count++) {
      const t = text({ unit: 'sentences', count }, replay.reader());
      expect(t.startsWith(`${CLASSIC_SENTENCE} `)).toBe(true);
    }
  });

  it('Paragraphs 1…100, both formats: the first paragraph begins with the classic sentence, then a space', () => {
    for (let count = 1; count <= LIMITS.paragraphs; count++) {
      expect(text({ unit: 'paragraphs', count }, aesStream(`p${count}`)).startsWith(`${CLASSIC_SENTENCE} `)).toBe(true);
      expect(
        text({ unit: 'paragraphs', count, format: 'html' }, aesStream(`p${count}`)).startsWith(
          `<p>${CLASSIC_SENTENCE} `,
        ),
      ).toBe(true);
    }
  });

  it('Words 1 and Sentences 1 in HTML', () => {
    expect(text({ unit: 'words', count: 1, format: 'html' })).toBe('<p>Lorem</p>');
    expect(text({ unit: 'sentences', count: 1, format: 'html' })).toBe(`<p>${CLASSIC_SENTENCE}</p>`);
  });

  it('off: nothing is fixed — "lorem" may come by chance, but no text of 40 seeds starts with the opening', () => {
    for (let seed = 0; seed < 40; seed++)
      for (const unit of ['words', 'sentences', 'paragraphs'] as const)
        expect(text({ unit, count: 10, startWithLorem: false }, aesStream(`off-${seed}`)).startsWith(opening)).toBe(
          false,
        );
  });
});

describe('§5.5: HTML is well-formed and holds only <p> elements and text that needs no escaping', () => {
  it('every line is one <p> with text of a–z, A–Z, space, comma and full stop: no <, >, &, quote or apostrophe', () => {
    for (const unit of ['words', 'sentences', 'paragraphs'] as const) {
      const t = text({ unit, count: unit === 'paragraphs' ? 100 : 500, format: 'html' }, aesStream(`html-${unit}`));
      const lines = t.split('\n');
      for (const line of lines) {
        expect(line.startsWith('<p>') && line.endsWith('</p>')).toBe(true);
        expect(line.slice(3, -4)).toMatch(/^[A-Za-z ,.]+$/);
      }
      // The only markup: as many <p> as </p>, never nested, nothing else that looks like a tag or an entity.
      expect(t.match(/<p>/g)).toHaveLength(lines.length);
      expect(t.match(/<\/p>/g)).toHaveLength(lines.length);
      expect(t.replace(/<\/?p>/g, '')).not.toMatch(/[<>&"']/);
    }
  });

  it('the dictionary itself is letters only, so no text can hold a character HTML would read', () => {
    for (const w of WORDS) expect(w).toMatch(/^[a-z]+$/);
  });
});

describe('§5.6: the replay source', () => {
  it('every reader replays the same bytes from the start; bytes past the end are new and kept', () => {
    const { source: fill, calls } = recorded(counter());
    const replay = createReplaySource(fill);
    const a = new Uint8Array(10);
    replay.reader()(a);
    const b = new Uint8Array(5000);
    replay.reader()(b);
    expect([...b.subarray(0, 10)]).toEqual([...a]);
    expect(b[4999]).toBe(4999 & 0xff);
    expect(calls).toEqual([4096, 4096]);
    const c = new Uint8Array(5000);
    replay.reader()(c);
    expect(c).toEqual(b);
    expect(calls).toHaveLength(2);
  });

  it('reset forgets the record: the next reader gives new bytes', () => {
    const replay = createReplaySource(aesStream('reset'));
    const s = settings({ unit: 'paragraphs', count: 3 });
    const first = generate(s, replay.reader()).text;
    expect(generate(s, replay.reader()).text).toBe(first);
    replay.reset();
    expect(generate(s, replay.reader()).text).not.toBe(first);
  });

  it('a larger Count keeps what was shown and adds at the end — words, sentences, paragraphs, both formats', () => {
    for (const unit of ['words', 'sentences', 'paragraphs'] as const)
      for (const startWithLorem of [true, false]) {
        const replay = createReplaySource(aesStream(`grow-${unit}-${startWithLorem}`));
        let before = '';
        for (const count of [1, 2, 3, 5, 9, 20, LIMITS[unit]]) {
          const t = text({ unit, count, startWithLorem }, replay.reader());
          if (before) expect(t.startsWith(before)).toBe(true);
          before = t;
        }
      }
  });

  it('a fill that throws leaves the record as it was, and the error reaches generate’s caller', () => {
    let fail = false;
    const inner = counter();
    const replay = createReplaySource(bytes => {
      if (fail) throw new Error('refused');
      inner(bytes);
    });
    const shown = text({ unit: 'words', count: 5 }, replay.reader());
    fail = true;
    expect(() => text({ unit: 'words', count: 5000, startWithLorem: false }, replay.reader())).toThrow('refused');
    expect(text({ unit: 'words', count: 5 }, replay.reader())).toBe(shown);
  });

  it('defaults to the browser’s source', () => {
    const replay = createReplaySource();
    const t = text({ unit: 'words', count: 30, startWithLorem: false }, replay.reader());
    expect(t.split(' ')).toHaveLength(30);
    expect(text({ unit: 'words', count: 30, startWithLorem: false }, replay.reader())).toBe(t);
  });
});

describe('§12: the work grows with the text, not faster', () => {
  it('draws per word are bounded: 10× the words take at most about 10× the draws', () => {
    const draws = (count: number) => {
      const { source, calls } = recorded(aesStream(`grow-${count}`));
      generate(settings({ unit: 'words', count, startWithLorem: false }), source);
      return calls.length;
    };
    const small = draws(1000);
    const large = draws(10_000);
    expect(small).toBeGreaterThanOrEqual(1000);
    expect(large).toBeLessThan(10_000 * 1.01);
    expect(large / small).toBeLessThan(10.5);
  });
});
