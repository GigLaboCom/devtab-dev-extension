import { EFF_LARGE_WORDLIST } from './eff-large-wordlist';
import {
  DEFAULT_CHAR_OPTIONS,
  DEFAULT_SETTINGS,
  DEFAULT_SYMBOLS,
  DEFAULT_WORD_OPTIONS,
  LIMITS,
  LOOK_ALIKE,
  MAX_REJECTED,
  charEntropy,
  charSets,
  generate,
  loadWordList,
  parseWholeNumber,
  strength,
  strengthLine,
  strengthNote,
  validCount,
  wordEntropy,
} from './logic';
import { cryptoRandom, randomIndex } from '@workspace/tools-shared/random';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CharOptions, Generated, Settings, WordOptions } from './logic';
import type { RandomSource } from '@workspace/tools-shared/random';

// The test sources of §10: `counter` fills 0, 1, 2, … mod 256, counting on across calls; `list` plays given bytes in a
// loop.
const counter = (): RandomSource => {
  let c = 0;
  return bytes => {
    for (let i = 0; i < bytes.length; i++) bytes[i] = c++ & 0xff;
  };
};
const listSource = (bytes: number[]): RandomSource => {
  let c = 0;
  return out => {
    for (let i = 0; i < out.length; i++) out[i] = bytes[c++ % bytes.length]!;
  };
};

const ALL = { upper: true, lower: true, digits: true, symbols: true };
const chars = (o: Partial<CharOptions> = {}): CharOptions => ({ ...DEFAULT_CHAR_OPTIONS, ...o });
const charSettings = (o: Partial<CharOptions> = {}, count = 1): Settings => ({ mode: 'chars', chars: chars(o), count });
const wordSettings = (o: Partial<WordOptions> = {}, count = 1): Settings => ({
  mode: 'words',
  words: { ...DEFAULT_WORD_OPTIONS, ...o },
  count,
});
const ok = (g: Generated): Extract<Generated, { ok: true }> => {
  if (!g.ok) throw new Error(`expected passwords, got ${JSON.stringify(g.errors)}`);
  return g;
};
const errorsOf = (g: Generated) => {
  if (g.ok) throw new Error('expected errors');
  return g.errors;
};

// Literal values of §10 (strings with quotes and backslashes).
const P4 = '"rXD:5lR|*zfL\\$tZF<7';
const P5 = '"rXD:5lR';
const P7 = '4[Vy=Ru/Mq+H';
const P10 = ':5lR';

afterEach(() => vi.restoreAllMocks());

describe('§10: randomIndex', () => {
  it('row 1: randomIndex(94, counter) five times', () => {
    const s = counter();
    expect([0, 1, 2, 3, 4].map(() => randomIndex(94, s))).toEqual([63, 43, 23, 3, 77]);
  });

  it('row 2: a draw at or over the limit is thrown away (n = 94)', () => {
    expect(2 ** 32 - (2 ** 32 % 94)).toBe(4294967254);
    expect(randomIndex(94, listSource([0xff, 0xff, 0xff, 0xff, 0, 0, 0, 5]))).toBe(5);
  });

  it('row 3: no rejection when n divides 2^32 (n = 64)', () => {
    expect(randomIndex(64, listSource([0xff, 0xff, 0xff, 0xff, 0, 0, 0, 5]))).toBe(63);
  });
});

describe('§10: passwords and passphrases from the counter source', () => {
  it('row 4: the defaults (characters, length 20)', () => {
    const g = ok(generate(DEFAULT_SETTINGS, undefined, counter()));
    expect(g.values).toEqual([P4]);
    expect(g.entropyBits).toBeCloseTo(130.9259, 4);
  });

  it('row 5: length 8, all sets', () => {
    expect(ok(generate(charSettings({ length: 8 }), undefined, counter())).values).toEqual([P5]);
  });

  it('row 6: length 12 without Symbols — the second candidate', () => {
    const settings = charSettings({ length: 12, sets: { ...ALL, symbols: false } });
    expect(ok(generate(settings, undefined, counter())).values).toEqual(['P9tdN7rbL5pZ']);
  });

  it('row 7: length 12, look-alikes avoided', () => {
    expect(ok(generate(charSettings({ length: 12, avoidLookAlike: true }), undefined, counter())).values).toEqual([P7]);
  });

  it('row 8: length 6, Digits only', () => {
    const settings = charSettings({ length: 6, sets: { upper: false, lower: false, digits: true, symbols: false } });
    const g = ok(generate(settings, undefined, counter()));
    expect(g.values).toEqual(['173951']);
    expect(g.entropyBits).toBeCloseTo(19.9316, 4);
  });

  it('row 9: length 10, Symbols "-_" — the second candidate', () => {
    expect(ok(generate(charSettings({ length: 10, symbols: '-_' }), undefined, counter())).values).toEqual([
      'rvz37_DHLP',
    ]);
  });

  it('row 10: length 4, all sets — the second candidate', () => {
    expect(ok(generate(charSettings({ length: 4 }), undefined, counter())).values).toEqual([P10]);
  });

  it('row 11: 6 words, "-"', () => {
    const g = ok(generate(wordSettings(), EFF_LARGE_WORDLIST, counter()));
    expect(g.values).toEqual(['manliness-pessimist-retool-spelling-turtle-woven']);
    expect(g.entropyBits).toBeCloseTo(77.5489, 4);
  });

  it('row 12: 6 words, space, Capitalize words', () => {
    const g = ok(generate(wordSettings({ separator: ' ', capitalize: true }), EFF_LARGE_WORDLIST, counter()));
    expect(g.values).toEqual(['Manliness Pessimist Retool Spelling Turtle Woven']);
  });
});

describe('§10: entropy', () => {
  it('row 13: all sets at lengths 4 … 128', () => {
    const want = [22.3078, 51.3183, 78.1401, 104.5925, 209.7068, 419.4926, 838.9874];
    [4, 8, 12, 16, 32, 64, 128].forEach((length, i) =>
      expect(Math.abs(charEntropy(chars({ length })) - want[i]!)).toBeLessThan(1e-4),
    );
  });

  it('row 14: length 20 without Symbols', () => {
    expect(charEntropy(chars({ sets: { ...ALL, symbols: false } }))).toBeCloseTo(119.0404, 4);
  });

  it('row 15: length 20, look-alikes avoided', () => {
    expect(charEntropy(chars({ avoidLookAlike: true }))).toBeCloseTo(128.9515, 4);
  });

  it('row 16: length 16, Lowercase only = 16 · log2 26', () => {
    const e = charEntropy(chars({ length: 16, sets: { upper: false, lower: true, digits: false, symbols: false } }));
    expect(e).toBeCloseTo(75.207, 4);
    expect(e).toBeCloseTo(16 * Math.log2(26), 10);
  });

  it('row 17: 4 and 10 words', () => {
    expect(wordEntropy({ ...DEFAULT_WORD_OPTIONS, words: 4 })).toBeCloseTo(51.6993, 4);
    expect(wordEntropy({ ...DEFAULT_WORD_OPTIONS, words: 10 })).toBeCloseTo(129.2481, 4);
  });
});

describe('§10: errors', () => {
  it('row 18: length 3', () => {
    expect(errorsOf(generate(charSettings({ length: 3 })))).toEqual([
      { field: 'length', message: 'Length must be a whole number from 4 to 128.' },
    ]);
  });

  it('row 19: Symbols on, the field empty', () => {
    expect(errorsOf(generate(charSettings({ symbols: '' })))).toEqual([
      { field: 'symbols', message: 'Add at least one symbol or turn Symbols off.' },
    ]);
  });

  it('row 20: Symbols "é!"', () => {
    expect(errorsOf(generate(charSettings({ symbols: 'é!' })))).toEqual([
      { field: 'symbols', message: 'Only ASCII punctuation can be used here. Remove "é".' },
    ]);
  });

  it('row 21: Symbols "🙂" — the emoji whole, not half a surrogate pair', () => {
    expect(errorsOf(generate(charSettings({ symbols: '🙂' })))).toEqual([
      { field: 'symbols', message: 'Only ASCII punctuation can be used here. Remove "🙂".' },
    ]);
  });

  it('row 22: Symbols "!!!@" is taken as "!@"', () => {
    expect(charSets(chars({ symbols: '!!!@' }))).toEqual({
      ok: true,
      sets: ['ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz', '0123456789', '!@'],
    });
  });

  it('row 23: Symbols "|" with look-alikes avoided', () => {
    expect(errorsOf(generate(charSettings({ symbols: '|', avoidLookAlike: true })))).toEqual([
      {
        field: 'symbols',
        message: 'All symbols are excluded as look-alikes. Add others or turn Avoid look-alike characters off.',
      },
    ]);
  });

  it('row 24: every set off', () => {
    const none = { upper: false, lower: false, digits: false, symbols: false };
    expect(errorsOf(generate(charSettings({ sets: none })))).toEqual([
      { field: 'sets', message: 'Choose at least one character set.' },
    ]);
  });

  it('row 25: words 21 and count 0 at once — both errors', () => {
    expect(errorsOf(generate(wordSettings({ words: 21 }, 0), EFF_LARGE_WORDLIST))).toEqual([
      { field: 'words', message: 'Words must be a whole number from 3 to 20.' },
      { field: 'count', message: 'How many must be a whole number from 1 to 20.' },
    ]);
  });

  it('row 26: the source throws', () => {
    const throwing: RandomSource = () => {
      throw new Error('QuotaExceededError');
    };
    expect(errorsOf(generate(DEFAULT_SETTINGS, undefined, throwing))).toEqual([
      { field: 'random', message: 'Could not get random numbers from the browser.' },
    ]);
  });

  it('row 27: list([00 00 00 00]) gives "AAAA" every time — gives up after 10,000 candidates', () => {
    let draws = 0;
    const zeros = listSource([0, 0, 0, 0]);
    const counting: RandomSource = bytes => {
      draws += bytes.length;
      zeros(bytes);
    };
    expect(errorsOf(generate(charSettings({ length: 4 }), undefined, counting))).toEqual([
      { field: 'generation', message: 'Could not generate a password with these settings. Try a longer length.' },
    ]);
    // 10,000 candidates of 4 characters, 4 bytes each, read through the 4,096-byte buffer.
    expect(MAX_REJECTED).toBe(10_000);
    expect(draws).toBe(Math.ceil((MAX_REJECTED * 4 * 4) / 4096) * 4096);
  });
});

describe('§10: properties with the real source', () => {
  it('row 28: 1,000 default passwords — 20 characters of the 94, every set, all different', () => {
    const alphabet = new Set([...('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' + DEFAULT_SYMBOLS)]);
    expect(alphabet.size).toBe(94);
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const [p] = ok(generate(DEFAULT_SETTINGS)).values;
      expect(p).toHaveLength(20);
      expect([...p!].every(c => alphabet.has(c))).toBe(true);
      expect(/[A-Z]/.test(p!) && /[a-z]/.test(p!) && /[0-9]/.test(p!) && /[^A-Za-z0-9]/.test(p!)).toBe(true);
      seen.add(p!);
    }
    expect(seen.size).toBe(1000);
  });

  it('row 29: randomIndex(10) 200,000 times — χ² with 9 degrees of freedom under 27.88 (p = 0.001)', () => {
    const counts = Array<number>(10).fill(0);
    for (let i = 0; i < 200_000; i++) counts[randomIndex(10, cryptoRandom)]!++;
    const chi2 = counts.reduce((sum, c) => sum + (c - 20_000) ** 2 / 20_000, 0);
    expect(chi2).toBeLessThan(27.88);
  });

  it('row 30: 1,000 passphrases of 6 words — words of the list joined by "-", all different', () => {
    const words = new Set(EFF_LARGE_WORDLIST);
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const [p] = ok(generate(wordSettings(), EFF_LARGE_WORDLIST)).values;
      // Split on the separator, then put back the four words that have a hyphen of their own.
      const parts = p!.split('-');
      const picked: string[] = [];
      for (let at = 0; at < parts.length; at++) {
        const joined = `${parts[at]}-${parts[at + 1]}`;
        if (!words.has(parts[at]!) && words.has(joined)) {
          picked.push(joined);
          at++;
        } else picked.push(parts[at]!);
      }
      expect(picked.every(w => words.has(w))).toBe(true);
      expect(picked.length).toBeGreaterThanOrEqual(6);
      seen.add(p!);
    }
    expect(seen.size).toBe(1000);
  });

  it('row 31: cryptoRandom fills 100,000 bytes in two calls (65,536 + 34,464)', () => {
    const spy = vi.spyOn(crypto, 'getRandomValues');
    const bytes = new Uint8Array(100_000);
    expect(() => cryptoRandom(bytes)).not.toThrow();
    expect(spy.mock.calls.map(([a]) => (a as Uint8Array).length)).toEqual([65_536, 34_464]);
  });

  it('row 32: 100 generations write nothing to the console', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map(m =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    for (let i = 0; i < 100; i++) generate(DEFAULT_SETTINGS);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('row 33: the word list — 7,776 words, all different, sorted, the SHA-256 of §5.6', () => {
    expect(EFF_LARGE_WORDLIST).toHaveLength(7776);
    expect(new Set(EFF_LARGE_WORDLIST).size).toBe(7776);
    expect(EFF_LARGE_WORDLIST.every((w, i) => i === 0 || EFF_LARGE_WORDLIST[i - 1]! < w)).toBe(true);
    expect(
      createHash('sha256')
        .update(`${EFF_LARGE_WORDLIST.join('\n')}\n`)
        .digest('hex'),
    ).toBe('6d557f0693958fb5e650b68b5bee585eb82cf4da32965505c789e924743bc522');
  });
});

// What §5 and §6 state that §10 does not cover.
describe('§5.1: the source', () => {
  it('generate reads its source in 4,096-byte blocks, and the bytes are the same as unbuffered', () => {
    const sizes: number[] = [];
    const inner = counter();
    const watched: RandomSource = bytes => {
      sizes.push(bytes.length);
      inner(bytes);
    };
    const buffered = ok(generate(charSettings({}, 20), undefined, watched)).values;
    expect(new Set(sizes)).toEqual(new Set([4096]));
    expect(buffered[0]).toBe(P4);
    // The same password drawn straight from the source, 4 bytes at a time (no read-ahead): the bytes are the same.
    const plain = counter();
    let calls = 0;
    const unbuffered: RandomSource = bytes => {
      calls++;
      plain(bytes);
    };
    const sets = charSets(chars());
    if (!sets.ok) throw new Error('sets');
    const alphabet = sets.sets.join('');
    let candidate = '';
    for (let i = 0; i < 20; i++) candidate += alphabet[randomIndex(alphabet.length, unbuffered)];
    expect(calls).toBe(20);
    expect(candidate).toBe(P4);
  });

  it('nothing is drawn when a parameter is invalid', () => {
    const source = vi.fn<RandomSource>();
    generate(charSettings({ length: 200 }), undefined, source);
    generate(wordSettings({ words: 2 }), EFF_LARGE_WORDLIST, source);
    expect(source).not.toHaveBeenCalled();
  });

  it('no Math.random, console or debug logger anywhere in the logic’s sources', () => {
    const root = dirname(fileURLToPath(import.meta.url));
    const files = readdirSync(root)
      .filter(f => /\.ts$/.test(f) && !/\.test\.ts$/.test(f))
      .map(f => join(root, f));
    expect(files.length).toBe(3);
    for (const file of files) expect(readFileSync(file, 'utf8')).not.toMatch(/Math\.random|console\.|createDebug/);
  });
});

describe('§5.2: an unbiased index', () => {
  it('2^32 mod 94 = 42 and 2^32 mod 7,776 = 2,560 values are thrown away', () => {
    expect(2 ** 32 % 94).toBe(42);
    expect(2 ** 32 % 7776).toBe(2560);
    const limit = 2 ** 32 - 2560;
    const be = (v: number) => [
      Math.floor(v / 2 ** 24) % 256,
      Math.floor(v / 2 ** 16) % 256,
      Math.floor(v / 256) % 256,
      v % 256,
    ];
    // The last value under the limit is kept; the limit itself is thrown away and the next draw is used.
    expect(randomIndex(7776, listSource(be(limit - 1)))).toBe((limit - 1) % 7776);
    expect(randomIndex(7776, listSource([...be(limit), ...be(7777)]))).toBe(1);
  });
});

describe('§5.3: sets and the alphabet', () => {
  it('look-alikes leave sets of 24, 25, 8 and 31', () => {
    const found = charSets(chars({ avoidLookAlike: true }));
    expect(found.ok && found.sets.map(s => s.length)).toEqual([24, 25, 8, 31]);
    expect(
      found.ok &&
        found.sets
          .join('')
          .split('')
          .some(c => LOOK_ALIKE.includes(c)),
    ).toBe(false);
  });

  it('Digits only with look-alikes avoided is "23456789"', () => {
    const found = charSets(
      chars({ sets: { upper: false, lower: false, digits: true, symbols: false }, avoidLookAlike: true }),
    );
    expect(found).toEqual({ ok: true, sets: ['23456789'] });
  });

  it('the Symbols field keeps its typed order, first occurrences only', () => {
    expect(charSets(chars({ symbols: '@!@-!' }))).toMatchObject({
      ok: true,
      sets: [expect.any(String), expect.any(String), expect.any(String), '@!-'],
    });
  });

  it('a space, a letter or a digit in Symbols is an error naming it (§6)', () => {
    expect(errorsOf(generate(charSettings({ symbols: ' ' })))[0]!.message).toBe(
      'Only ASCII punctuation can be used here. Remove " ".',
    );
    expect(errorsOf(generate(charSettings({ symbols: 'a1' })))[0]!.message).toBe(
      'Only ASCII punctuation can be used here. Remove "a".',
    );
    expect(errorsOf(generate(charSettings({ symbols: '!-é' })))[0]!.message).toBe(
      'Only ASCII punctuation can be used here. Remove "é".',
    );
  });

  it('the Symbols field is not checked while Symbols is off', () => {
    expect(ok(generate(charSettings({ symbols: 'abc', sets: { ...ALL, symbols: false } }))).values[0]).toMatch(
      /^[A-Za-z0-9]{20}$/,
    );
  });

  it('the default symbols are the 32 printable ASCII characters that are not letters, digits or the space', () => {
    const want = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i))
      .filter(c => !/[A-Za-z0-9 ]/.test(c))
      .join('');
    expect(DEFAULT_SYMBOLS).toBe(want);
    expect(DEFAULT_SYMBOLS).toHaveLength(32);
  });
});

describe('§5.4: at least one of each set', () => {
  it('every password of a batch has every chosen set, also at the shortest length', () => {
    const g = ok(generate(charSettings({ length: 4 }, 20)));
    expect(g.values).toHaveLength(20);
    for (const p of g.values)
      expect(/[A-Z]/.test(p) && /[a-z]/.test(p) && /[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p)).toBe(true);
  });

  it('the worst valid case (length 4, four sets, one symbol, look-alikes avoided) accepts 1.02 % of candidates', () => {
    const sizes = [24, 25, 8, 1];
    const p = Number(validCount(sizes, 4)) / 58 ** 4;
    expect(p * 100).toBeCloseTo(1.02, 2);
    // …so the limit of 10,000 rejections is practically never reached.
    expect(ok(generate(charSettings({ length: 4, symbols: '!', avoidLookAlike: true }, 20))).values).toHaveLength(20);
  });
});

describe('§5.5 and §8: strength', () => {
  it('the defaults: 130.93 bits shown as 130, below the naive 20 · log2 94 = 131.09', () => {
    const s = strength(DEFAULT_SETTINGS);
    expect(s.ok && strengthLine(s.entropyBits, s.summary)).toBe(
      '130 bits of entropy (20 characters from a set of 94, at least one of each chosen set)',
    );
    expect(s.ok && s.entropyBits).toBeLessThan(20 * Math.log2(94));
    expect(strengthNote(130.93)).toBe(
      'Entropy of these settings, not of a single password: someone who knows the settings needs up to 2^130 guesses.',
    );
  });

  it('§2: Symbols "-_!@" — 120 bits; look-alikes avoided — 128 bits', () => {
    expect(Math.floor(charEntropy(chars({ symbols: '-_!@' })))).toBe(120);
    expect(Math.floor(charEntropy(chars({ avoidLookAlike: true })))).toBe(128);
  });

  it('one set: the brackets without the tail; words: from a list of 7,776', () => {
    const digits = strength(
      charSettings({ length: 6, sets: { upper: false, lower: false, digits: true, symbols: false } }),
    );
    expect(digits.ok && strengthLine(digits.entropyBits, digits.summary)).toBe(
      '19 bits of entropy (6 characters from a set of 10)',
    );
    const words = strength(wordSettings());
    expect(words.ok && strengthLine(words.entropyBits, words.summary)).toBe(
      '77 bits of entropy (6 words from a list of 7,776)',
    );
  });

  it('§6: length 4 — 22 bits; length 128 — 838 bits', () => {
    const at = (length: number) => {
      const s = strength(charSettings({ length }));
      return s.ok ? Math.floor(s.entropyBits) : NaN;
    };
    expect(at(4)).toBe(22);
    expect(at(128)).toBe(838);
  });

  it('a word is ≈ 12.925 bits; Capitalize words and the separator add nothing', () => {
    expect(wordEntropy({ words: 1 as number, separator: '-', capitalize: false })).toBeNaN();
    expect(wordEntropy(DEFAULT_WORD_OPTIONS) / 6).toBeCloseTo(12.925, 3);
    expect(wordEntropy({ words: 6, separator: '_', capitalize: true })).toBe(wordEntropy(DEFAULT_WORD_OPTIONS));
  });

  it('several passwords: each has the same entropy', () => {
    const one = strength(charSettings());
    const five = strength(charSettings({}, 5));
    expect(one.ok && five.ok && one.entropyBits === five.entropyBits).toBe(true);
  });
});

describe('§5.6: passphrases', () => {
  it('the list: abacus … zoom, 3–9 letters, a–z and a hyphen in exactly four words', () => {
    expect(EFF_LARGE_WORDLIST[0]).toBe('abacus');
    expect(EFF_LARGE_WORDLIST.at(-1)).toBe('zoom');
    expect(EFF_LARGE_WORDLIST.every(w => /^[a-z-]{3,9}$/.test(w))).toBe(true);
    expect(EFF_LARGE_WORDLIST.filter(w => w.includes('-'))).toEqual(['drop-down', 'felt-tip', 't-shirt', 'yo-yo']);
  });

  it('Capitalize words upper-cases the first letter only: "T-shirt", not "T-Shirt"', () => {
    const g = ok(generate(wordSettings({ words: 3, capitalize: true }), ['t-shirt'], counter()));
    expect(g.values).toEqual(['T-shirt-T-shirt-T-shirt']);
  });

  it('words are picked independently, repeats allowed', () => {
    // Every draw is 0: the first word each time.
    const g = ok(generate(wordSettings({ words: 3, separator: '.' }), EFF_LARGE_WORDLIST, listSource([0, 0, 0, 0])));
    expect(g.values).toEqual(['abacus.abacus.abacus']);
  });

  it('every separator of §4', () => {
    for (const separator of ['-', ' ', '.', '_'] as const) {
      const [p] = ok(generate(wordSettings({ separator }), EFF_LARGE_WORDLIST, counter())).values;
      expect(p).toBe(['manliness', 'pessimist', 'retool', 'spelling', 'turtle', 'woven'].join(separator));
    }
  });

  it('the list loads on first use, as a module of its own', async () => {
    expect(await loadWordList()).toBe(EFF_LARGE_WORDLIST);
  });

  it('mode "words" without the list is a programming error', () => {
    expect(() => generate(wordSettings())).toThrow(TypeError);
  });
});

describe('§3 and §6: number fields', () => {
  it('a whole decimal number, or NaN for empty, a fraction, a sign or an exponent', () => {
    expect(parseWholeNumber('20')).toBe(20);
    expect(parseWholeNumber(' 7 ')).toBe(7);
    for (const text of ['', '12.5', '-4', '1e1', '+5', 'abc']) expect(parseWholeNumber(text)).toBeNaN();
  });

  it('Length "", 3, 129, 12.5, -4 — the same message', () => {
    for (const length of [NaN, 3, 129, 12.5, -4])
      expect(errorsOf(generate(charSettings({ length })))).toEqual([
        { field: 'length', message: 'Length must be a whole number from 4 to 128.' },
      ]);
  });

  it('Words 2, 21, "" and How many 0, 21, "" — their messages', () => {
    for (const words of [2, 21, NaN])
      expect(errorsOf(generate(wordSettings({ words }), EFF_LARGE_WORDLIST))[0]!.field).toBe('words');
    for (const count of [0, 21, NaN])
      expect(errorsOf(generate(charSettings({}, count)))).toEqual([
        { field: 'count', message: 'How many must be a whole number from 1 to 20.' },
      ]);
  });

  it('the limits of §4', () => {
    expect(LIMITS).toEqual({ length: { min: 4, max: 128 }, words: { min: 3, max: 20 }, count: { min: 1, max: 20 } });
  });

  it('20 passwords of 128 characters', () => {
    const g = ok(generate(charSettings({ length: 128 }, 20)));
    expect(g.values.every(p => p.length === 128)).toBe(true);
    expect(Math.floor(g.entropyBits)).toBe(838);
  });
});
