import {
  DEFAULTS,
  ENCODING_LABELS,
  ENCODING_ORDER,
  LIMITS,
  MESSAGES,
  PRESETS,
  PRESET_LABELS,
  PRESET_ORDER,
  check,
  encodeBytes,
  encodedLength,
  entropyLine,
  entropyPerString,
  fitsSettings,
  generate,
  generatedLine,
  parseAlphabet,
  parseWholeNumber,
  wholeBits,
} from './logic';
import { parseBase64 } from '@workspace/tools-shared/base64';
import { cryptoRandom, log2BigInt, randomIndex } from '@workspace/tools-shared/random';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCipheriv, createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Encoding, Generated, Preset, Settings } from './logic';
import type { RandomSource } from '@workspace/tools-shared/random';

// The test sources. `counter` (§10): 0, 1, 2, … mod 256, counting on across calls. `listSource`: given bytes in a loop.
// `aesStream`: a deterministic stream of good bytes — AES-128 in counter mode over zeros, keyed by a seed — in which every
// byte value occurs; the same seed gives the same stream.
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
const aesStream = (seed: string): RandomSource => {
  const key = createHash('sha256').update(seed).digest();
  const cipher = createCipheriv('aes-128-ctr', key.subarray(0, 16), key.subarray(16, 32));
  return bytes => bytes.set(cipher.update(new Uint8Array(bytes.length)));
};
/** A source that records every byte it gives. */
const recorded = (inner: RandomSource) => {
  const given: number[] = [];
  const calls: number[] = [];
  const source: RandomSource = bytes => {
    inner(bytes);
    calls.push(bytes.length);
    for (const b of bytes) given.push(b);
  };
  return { source, given, calls };
};

const chars = (o: Partial<Extract<Settings, { mode: 'chars' }>> = {}): Settings => ({
  mode: 'chars',
  preset: 'alnum',
  custom: '',
  length: 32,
  count: 1,
  ...o,
});
const bytes = (o: Partial<Extract<Settings, { mode: 'bytes' }>> = {}): Settings => ({
  mode: 'bytes',
  bytes: 32,
  encoding: 'hex',
  count: 1,
  ...o,
});
const ok = (g: Generated): Extract<Generated, { ok: true }> => {
  if (!g.ok) throw new Error(`expected strings, got ${JSON.stringify(g.errors)}`);
  return g;
};
const errorsOf = (g: Generated) => {
  if (g.ok) throw new Error('expected errors');
  return g.errors;
};
const symbolsOf = (text: string): string[] => {
  const parsed = parseAlphabet(text);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.symbols;
};
const alphabetError = (text: string): string | undefined => {
  const parsed = parseAlphabet(text);
  return parsed.ok ? undefined : parsed.error.message;
};
const graphemeCount = (text: string): number =>
  [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)].length;
/** Hex to bytes (the shared hex module only writes hex; Node's Buffer reads it). */
const fromHex = (hex: string): Uint8Array => new Uint8Array(Buffer.from(hex, 'hex'));

afterEach(() => vi.restoreAllMocks());

describe('§10: strings and bytes from the counter source', () => {
  it('row 1: alnum, length 16, one string — VFzjTDxhRBvfP9td, 95.2671 bits', () => {
    const g = ok(generate(chars({ length: 16 }), counter()));
    expect(g.values).toEqual(['VFzjTDxhRBvfP9td']);
    expect(g.entropyBits).toBeCloseTo(95.2671, 4);
  });

  it('row 2: hex, length 16 — 37bf37bf37bf37bf, 64 bits', () => {
    const g = ok(generate(chars({ preset: 'hex', length: 16 }), counter()));
    expect(g.values).toEqual(['37bf37bf37bf37bf']);
    expect(g.entropyBits).toBe(64);
  });

  it('row 3: digits, length 10 — 1739517395, 33.2193 bits', () => {
    const g = ok(generate(chars({ preset: 'digits', length: 10 }), counter()));
    expect(g.values).toEqual(['1739517395']);
    expect(g.entropyBits).toBeCloseTo(33.2193, 4);
  });

  it('row 4: crockford, length 26 — 37BFKQVZ37BFKQVZ37BFKQVZ37', () => {
    expect(ok(generate(chars({ preset: 'crockford', length: 26 }), counter())).values).toEqual([
      '37BFKQVZ37BFKQVZ37BFKQVZ37',
    ]);
  });

  it('row 5: custom "🙂x", length 4 — xxxx (the low bit of every 4th byte of the counter is 1)', () => {
    expect(ok(generate(chars({ preset: 'custom', custom: '🙂x', length: 4 }), counter())).values).toEqual(['xxxx']);
  });

  it('row 6: 16 bytes, hex — 000102030405060708090a0b0c0d0e0f', () => {
    expect(ok(generate(bytes({ bytes: 16 }), counter())).values).toEqual(['000102030405060708090a0b0c0d0e0f']);
  });

  it('row 7: 16 bytes, base64 — AAECAwQFBgcICQoLDA0ODw==', () => {
    expect(ok(generate(bytes({ bytes: 16, encoding: 'base64' }), counter())).values).toEqual([
      'AAECAwQFBgcICQoLDA0ODw==',
    ]);
  });

  it('row 8: 16 bytes, base64url — AAECAwQFBgcICQoLDA0ODw', () => {
    expect(ok(generate(bytes({ bytes: 16, encoding: 'base64url' }), counter())).values).toEqual([
      'AAECAwQFBgcICQoLDA0ODw',
    ]);
  });

  it('row 9: 32 bytes, base64 — 44 characters ending in "="', () => {
    expect(ok(generate(bytes({ encoding: 'base64' }), counter())).values).toEqual([
      'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=',
    ]);
  });

  it('row 10: 3 bytes, base64url — AAEC', () => {
    expect(ok(generate(bytes({ bytes: 3, encoding: 'base64url' }), counter())).values).toEqual(['AAEC']);
  });
});

describe('§10: entropy and the alphabet', () => {
  it('row 11: entropyPerString(alnum, 32) = 190.5343', () => {
    expect(entropyPerString(chars())).toBeCloseTo(190.5343, 4);
  });

  it('row 12: parseAlphabet("ACGTA") — A, C, G, T', () => {
    expect(symbolsOf('ACGTA')).toEqual(['A', 'C', 'G', 'T']);
  });

  it('row 13: parseAlphabet("e\\u0301\\u00e9") — two characters, compared by code points', () => {
    expect(symbolsOf('éé')).toEqual(['é', 'é']);
  });

  it('row 14: parseAlphabet("👍🏽a") — 👍🏽 and a, 2 characters', () => {
    expect(symbolsOf('👍🏽a')).toEqual(['👍🏽', 'a']);
  });

  it('row 15: empty, "aa", "a b" — the messages of §6', () => {
    expect(alphabetError('')).toBe('Type the characters to use.');
    expect(alphabetError('aa')).toBe('The alphabet needs at least 2 different characters.');
    expect(alphabetError('a b')).toBe('Remove spaces and line breaks from the alphabet.');
  });
});

describe('§10: errors and limits', () => {
  it('row 16: length 1,000 × 1,001 — the error total', () => {
    expect(errorsOf(generate(chars({ length: 1000, count: 1001 })))).toEqual([
      { field: 'total', message: 'Too much at once: length × how many must be at most 1,000,000.' },
    ]);
  });

  it('row 17: length 1,000 × 1,000 (the boundary), cryptoRandom — 1,000 strings of 1,000 characters', () => {
    const g = ok(generate(chars({ length: 1000, count: 1000 })));
    expect(g.values).toHaveLength(1000);
    expect(g.values.every(v => v.length === 1000)).toBe(true);
  });

  it('row 18: length 0 and How many 10,001 — two errors, length and count', () => {
    expect(errorsOf(generate(chars({ length: 0, count: 10_001 })))).toEqual([
      { field: 'length', message: 'Length must be a whole number from 1 to 1,024.' },
      { field: 'count', message: 'How many must be a whole number from 1 to 10,000.' },
    ]);
  });

  it('row 19: every preset, length 64, 100 strings — every character from the preset, length 64', () => {
    for (const preset of PRESET_ORDER.filter((p): p is Exclude<Preset, 'custom'> => p !== 'custom')) {
      const set = new Set(PRESETS[preset]);
      const g = ok(generate(chars({ preset, length: 64, count: 100 })));
      expect(g.values).toHaveLength(100);
      for (const v of g.values) {
        expect(v).toHaveLength(64);
        expect([...v].every(c => set.has(c))).toBe(true);
      }
    }
  });

  it('row 20: bytes 1…20 in every encoding — the length of §5.3, decoding gives n bytes', () => {
    for (const encoding of ENCODING_ORDER)
      for (let n = 1; n <= 20; n++) {
        const [v] = ok(generate(bytes({ bytes: n, encoding }))).values;
        expect(v).toHaveLength(encodedLength(n, encoding));
        expect(v).toHaveLength(
          encoding === 'base64' ? 4 * Math.ceil(n / 3) : encoding === 'base64url' ? Math.ceil((4 * n) / 3) : 2 * n,
        );
        const decoded = encoding.toLowerCase() === 'hex' ? fromHex(v!) : parseBase64(v!);
        expect(decoded instanceof Uint8Array ? decoded.length : decoded.ok && decoded.bytes.length).toBe(n);
        if (encoding === 'base64') expect(atob(v!)).toHaveLength(n);
      }
  });

  it('row 21: the source throws — the error random', () => {
    const throwing: RandomSource = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    expect(errorsOf(generate(chars({ count: 10 }), throwing))).toEqual([
      { field: 'random', message: 'Could not get random numbers from the browser.' },
    ]);
    expect(errorsOf(generate(bytes(), throwing))).toEqual([{ field: 'random', message: MESSAGES.random }]);
  });

  it('row 22: 100 generations write nothing to the console', () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map(m =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    for (let i = 0; i < 50; i++) generate(chars({ count: 10 }));
    for (let i = 0; i < 50; i++) generate(bytes({ count: 10 }));
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

// What §5 and §6 state that §10 does not cover.
describe('§5.2: the preset alphabets', () => {
  it('their characters in the order of §5.2, all different, and their sizes', () => {
    expect(PRESETS).toEqual({
      alnum: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
      'lower-digits': 'abcdefghijklmnopqrstuvwxyz0123456789',
      letters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
      digits: '0123456789',
      hex: '0123456789abcdef',
      HEX: '0123456789ABCDEF',
      base64url: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',
      crockford: '0123456789ABCDEFGHJKMNPQRSTVWXYZ',
    });
    const sizes = Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, new Set(v).size]));
    expect(sizes).toEqual({
      alnum: 62,
      'lower-digits': 36,
      letters: 52,
      digits: 10,
      hex: 16,
      HEX: 16,
      base64url: 64,
      crockford: 32,
    });
    expect([...PRESETS.crockford].some(c => 'ILOU'.includes(c))).toBe(false);
  });

  it('the names of the list and of the encodings, word for word', () => {
    expect(PRESET_ORDER.map(p => PRESET_LABELS[p])).toEqual([
      'Letters and digits',
      'Lowercase letters and digits',
      'Letters',
      'Digits',
      'Hex, lowercase',
      'Hex, uppercase',
      'Base64url alphabet',
      'Crockford Base32',
      'Custom',
    ]);
    expect(ENCODING_ORDER.map(e => ENCODING_LABELS[e])).toEqual([
      'Hex (lowercase)',
      'Hex (uppercase)',
      'Base64',
      'Base64url',
    ]);
  });

  it('the defaults of §4: Characters, Letters and digits, length 32, 10 strings; Bytes 32, Hex (lowercase)', () => {
    expect(DEFAULTS).toEqual({
      mode: 'chars',
      preset: 'alnum',
      custom: '',
      length: 32,
      bytes: 32,
      encoding: 'hex',
      count: 10,
    });
    expect(LIMITS).toEqual({ length: 1024, bytes: 1024, count: 10_000, total: 1_000_000, alphabet: 1024 });
  });

  it('with no "at least one of each kind": all-digit strings of alnum come out as often as chance says', () => {
    // 10^4 / 62^4 ≈ 0.068 % of strings of length 4 are digits only: over 200,000 strings about 135.
    const source = aesStream('no-composition-rule');
    let digitsOnly = 0;
    for (let batch = 0; batch < 20; batch++)
      digitsOnly += ok(generate(chars({ length: 4, count: 10_000 }), source)).values.filter(v =>
        /^\d{4}$/.test(v),
      ).length;
    expect(digitsOnly).toBeGreaterThan(60);
    expect(digitsOnly).toBeLessThan(230);
  });
});

describe('§3 and §6: the custom alphabet', () => {
  it('repeats go silently, the first occurrence stays, in typed order', () => {
    expect(symbolsOf('banana')).toEqual(['b', 'a', 'n']);
    expect(symbolsOf('TGCAACGT')).toEqual(['T', 'G', 'C', 'A']);
  });

  it('a single character, or one repeated — at least 2 different', () => {
    expect(alphabetError('a')).toBe(MESSAGES.customTwo);
    expect(alphabetError('🙂🙂🙂')).toBe(MESSAGES.customTwo);
  });

  it('a space, a tab, a line break or a no-break space anywhere — the space message', () => {
    for (const text of [' ab', 'ab ', 'a\tb', 'a\nb', 'a\r\nb', 'a b', 'a　b', ' '])
      expect(alphabetError(text)).toBe(MESSAGES.customSpace);
  });

  it('characters outside the Basic Multilingual Plane count as one each', () => {
    expect(symbolsOf('🙂x')).toEqual(['🙂', 'x']);
    expect(symbolsOf('𝔸𝔹ℂ')).toEqual(['𝔸', '𝔹', 'ℂ']);
    expect(symbolsOf('🇺🇸🇫🇷')).toEqual(['🇺🇸', '🇫🇷']);
    expect(symbolsOf('👨‍👩‍👧x')).toEqual(['👨‍👩‍👧', 'x']);
  });

  it('a character with combining marks is one character; e + U+0301 and é are two', () => {
    expect(symbolsOf('ộa')).toEqual(['ộ', 'a']);
    expect(symbolsOf('ééé')).toEqual(['é', 'é']);
  });

  it('a character that would join its neighbour is named and refused (§15)', () => {
    // A lone combining mark (only possible at the start: anywhere else it is part of the character before it).
    expect(alphabetError('́ab')).toBe('Remove U+0301 from the alphabet: it joins the character next to it.');
    // A lone skin tone, a lone regional indicator, conjoining Hangul jamo.
    expect(alphabetError('🏽ab')).toBe('Remove "🏽" from the alphabet: it joins the character next to it.');
    expect(alphabetError('🇺ab')).toBe('Remove "🇺" from the alphabet: it joins the character next to it.');
    expect(alphabetError('ᄀab')).toBe('Remove "ᄀ" from the alphabet: it joins the character next to it.');
    expect(alphabetError('aᅡb')).toBe('Remove "ᅡ" from the alphabet: it joins the character next to it.');
    // A character ending in a zero-width joiner after an emoji, one ending in a virama, a prepended mark.
    expect(alphabetError('a👨‍')).toBe('Remove U+1F468 U+200D from the alphabet: it joins the character next to it.');
    expect(alphabetError('aक्')).toBe('Remove U+0915 U+094D from the alphabet: it joins the character next to it.');
    expect(alphabetError('a؀')).toBe('Remove U+0600 from the alphabet: it joins the character next to it.');
    // What does stand alone: precomposed Hangul syllables, flags, skin-toned emoji, ZWJ sequences, plain ASCII.
    expect(symbolsOf('가각')).toEqual(['가', '각']);
    expect(symbolsOf('🇺🇸👍🏽👨‍👩‍👧!~')).toEqual(['🇺🇸', '👍🏽', '👨‍👩‍👧', '!', '~']);
  });

  it('half of a surrogate pair is refused, never written into a string', () => {
    expect(alphabetError('ab\ud83d')).toBe('Remove U+D83D from the alphabet: it is not a whole character.');
    expect(alphabetError('\ude42ab')).toBe('Remove U+DE42 from the alphabet: it is not a whole character.');
  });

  it('1,024 different characters are allowed, 1,025 are not', () => {
    const cjk = (n: number) => Array.from({ length: n }, (_, i) => String.fromCodePoint(0x4e00 + i)).join('');
    expect(symbolsOf(cjk(1024))).toHaveLength(1024);
    expect(symbolsOf(cjk(1024) + cjk(1024))).toHaveLength(1024);
    expect(alphabetError(cjk(1025))).toBe('The alphabet can have at most 1,024 characters.');
  });

  it('a preset ignores the custom field; the custom field is checked only with Custom', () => {
    expect(ok(generate(chars({ preset: 'digits', custom: 'a b', length: 4 }))).values[0]).toMatch(/^\d{4}$/);
    expect(errorsOf(generate(chars({ preset: 'custom', custom: '', length: 0 })))).toEqual([
      { field: 'custom', message: MESSAGES.customEmpty },
      { field: 'length', message: MESSAGES.length },
    ]);
  });

  it('strings of characters outside the BMP are whole characters, never a lone surrogate', () => {
    const g = ok(generate(chars({ preset: 'custom', custom: '🙂😎👍🏽🇺🇸', length: 50, count: 200 })));
    for (const v of g.values) {
      expect(/\p{Cs}/u.test(v)).toBe(false);
      expect(graphemeCount(v)).toBe(50);
    }
    // Row 5's alphabet: a string of four 🙂 is 8 UTF-16 units.
    const smiles = ok(generate(chars({ preset: 'custom', custom: '🙂x', length: 4 }), listSource([0, 0, 0, 0])));
    expect(smiles.values).toEqual(['🙂🙂🙂🙂']);
    expect(smiles.values[0]).toHaveLength(8);
  });
});

describe('§3 and §6: numbers and limits', () => {
  it('a whole decimal number, or NaN for empty, a fraction, a sign or an exponent', () => {
    expect([' 32 ', '1', '1024', '007'].map(parseWholeNumber)).toEqual([32, 1, 1024, 7]);
    expect(['', '2.5', '-1', '+3', '1e3', '0x10', 'ten'].map(parseWholeNumber).every(Number.isNaN)).toBe(true);
  });

  it('Length empty, 0, 1,025, 2.5 — one message; 1 and 1,024 are fine', () => {
    for (const length of [NaN, 0, 1025, 2.5])
      expect(errorsOf(generate(chars({ length })))).toEqual([{ field: 'length', message: MESSAGES.length }]);
    expect(ok(generate(chars({ length: 1 }))).values[0]).toHaveLength(1);
    expect(ok(generate(chars({ length: 1024 }))).values[0]).toHaveLength(1024);
  });

  it('Bytes empty, 0, 1,025 — its message; How many empty, 0, 10,001 — its message', () => {
    for (const n of [NaN, 0, 1025])
      expect(errorsOf(generate(bytes({ bytes: n })))).toEqual([
        { field: 'bytes', message: 'Bytes must be a whole number from 1 to 1,024.' },
      ]);
    for (const count of [NaN, 0, 10_001]) {
      expect(errorsOf(generate(chars({ count })))).toEqual([{ field: 'count', message: MESSAGES.count }]);
      expect(errorsOf(generate(bytes({ count })))).toEqual([{ field: 'count', message: MESSAGES.count }]);
    }
  });

  it('bytes × how many over 1,000,000 — its own sentence; exactly 1,000,000 is made', () => {
    expect(errorsOf(generate(bytes({ bytes: 1000, count: 1001 })))).toEqual([
      { field: 'total', message: 'Too much at once: bytes × how many must be at most 1,000,000.' },
    ]);
    const g = ok(generate(bytes({ bytes: 100, count: 10_000 })));
    expect(g.values).toHaveLength(10_000);
    expect(g.bytes).toHaveLength(1_000_000);
  });

  it('10,000 strings of length 100 — the largest batch of §12', () => {
    const g = ok(generate(chars({ length: 100, count: 10_000 })));
    expect(g.values).toHaveLength(10_000);
    expect(g.values.join('\n')).toHaveLength(1_009_999);
  });

  it('nothing is drawn when a parameter is invalid', () => {
    const source = vi.fn<RandomSource>();
    generate(chars({ length: 2000 }), source);
    generate(chars({ preset: 'custom', custom: 'aa' }), source);
    generate(bytes({ bytes: 1000, count: 1001 }), source);
    expect(source).not.toHaveBeenCalled();
  });
});

describe('§5.4: entropy', () => {
  it('Characters: length × log2 of the alphabet size; Bytes: 8 per byte', () => {
    expect(entropyPerString(chars({ preset: 'custom', custom: 'ACGT', length: 16 }))).toBe(32);
    expect(entropyPerString(chars({ preset: 'crockford', length: 26 }))).toBe(130);
    expect(entropyPerString(chars({ preset: 'lower-digits', length: 12 }))).toBeCloseTo(12 * Math.log2(36), 12);
    expect(entropyPerString(bytes())).toBe(256);
    expect(entropyPerString(bytes({ bytes: 1024 }))).toBe(8192);
    expect(entropyPerString(chars({ length: 0 }))).toBeNaN();
  });

  it('shown rounded down: 190 bits for the defaults, 256 for 32 bytes; 1 bit is singular', () => {
    expect(wholeBits(chars())).toBe(190);
    expect(entropyLine(wholeBits(chars()))).toBe('190 bits of entropy per string');
    expect(entropyLine(wholeBits(bytes()))).toBe('256 bits of entropy per string');
    expect(entropyLine(wholeBits(chars({ preset: 'custom', custom: 'ACGT', length: 16 })))).toBe(
      '32 bits of entropy per string',
    );
    expect(entropyLine(wholeBits(chars({ preset: 'custom', custom: 'ab', length: 1 })))).toBe(
      '1 bit of entropy per string',
    );
    expect(entropyLine(wholeBits(chars({ preset: 'custom', custom: 'abc', length: 1 })))).toBe(
      '1 bit of entropy per string',
    );
    expect(entropyLine(wholeBits(bytes({ bytes: 1024 })))).toBe('8,192 bits of entropy per string');
  });

  it('the whole bits are exact: ⌊log2(size^length)⌋ by BigInt agrees with the unrounded value and log2BigInt', () => {
    const cjk = (n: number) => Array.from({ length: n }, (_, i) => String.fromCodePoint(0x4e00 + i)).join('');
    for (const size of [2, 3, 5, 7, 10, 16, 31, 36, 52, 62, 64, 100, 255, 256, 1000, 1023, 1024]) {
      const custom = size <= 94 ? cjk(size) : cjk(size);
      for (const length of [1, 2, 7, 12, 32, 100, 665, 1000, 1024]) {
        const settings = chars({ preset: 'custom', custom, length });
        const exact = Number((BigInt(size) ** BigInt(length)).toString(2).length - 1);
        expect(wholeBits(settings)).toBe(exact);
        expect(Math.floor(entropyPerString(settings))).toBe(exact);
        expect(entropyPerString(settings)).toBeCloseTo(log2BigInt(BigInt(size) ** BigInt(length)), 9);
      }
    }
    // 1,024 characters of 1,024: 10,240 bits, far past what a double's 2^1024 holds as a number.
    expect(entropyLine(wholeBits(chars({ preset: 'custom', custom: cjk(1024), length: 1024 })))).toBe(
      '10,240 bits of entropy per string',
    );
  });

  it('the announcement of a batch: 10 strings, 1 string, 10,000 strings', () => {
    expect([10, 1, 10_000].map(generatedLine)).toEqual([
      '10 strings generated',
      '1 string generated',
      '10,000 strings generated',
    ]);
  });
});

describe('§5.3: bytes', () => {
  it('Bytes returns the bytes the source gave, unaltered, in the encoding chosen (round trip)', () => {
    for (const encoding of ENCODING_ORDER) {
      const { source, given } = recorded(aesStream(`bytes-${encoding}`));
      const g = ok(generate(bytes({ bytes: 17, count: 50, encoding }), source));
      const taken = Uint8Array.from(given.slice(0, 17 * 50));
      expect(g.bytes).toEqual(taken);
      const decoded = new Uint8Array(17 * 50);
      g.values.forEach((v, i) => {
        if (encoding === 'hex' || encoding === 'HEX') {
          expect(v).toMatch(encoding === 'hex' ? /^[0-9a-f]{34}$/ : /^[0-9A-F]{34}$/);
          decoded.set(fromHex(v), i * 17);
        } else {
          expect(v).toMatch(encoding === 'base64' ? /^[A-Za-z0-9+/]{23}=$/ : /^[A-Za-z0-9_-]{23}$/);
          const parsed = parseBase64(v);
          if (!parsed.ok) throw new Error(parsed.error.message);
          decoded.set(parsed.bytes, i * 17);
        }
      });
      expect(decoded).toEqual(taken);
    }
  });

  it('encodeBytes: no separators, no 0x; Base64 RFC 4648 §4 padded, Base64url §5 unpadded', () => {
    const b = Uint8Array.from([0xfb, 0xff, 0xbf, 0x00]);
    expect(encodeBytes(b, 'hex')).toBe('fbffbf00');
    expect(encodeBytes(b, 'HEX')).toBe('FBFFBF00');
    expect(encodeBytes(b, 'base64')).toBe('+/+/AA==');
    expect(encodeBytes(b, 'base64url')).toBe('-_-_AA');
    expect(Buffer.from(b).toString('base64url')).toBe('-_-_AA');
  });

  it('the lengths of §5.3 for 1 … 1,024 bytes', () => {
    for (let n = 1; n <= 1024; n++) {
      const b = new Uint8Array(n);
      for (const encoding of ENCODING_ORDER) expect(encodeBytes(b, encoding)).toHaveLength(encodedLength(n, encoding));
    }
  });
});

describe('§5.1: the source and the order it is consumed in', () => {
  it('the same source and settings give the same strings; another seed, others', () => {
    const settings = chars({ preset: 'custom', custom: 'ACGT🙂', length: 20, count: 30 });
    const a = ok(generate(settings, aesStream('same'))).values;
    expect(ok(generate(settings, aesStream('same'))).values).toEqual(a);
    expect(ok(generate(settings, aesStream('other'))).values).not.toEqual(a);
    expect(ok(generate(bytes({ count: 5 }), aesStream('same'))).values).toEqual(
      ok(generate(bytes({ count: 5 }), aesStream('same'))).values,
    );
  });

  it('strings in order, characters left to right, one 4-byte big-endian draw each, rejected draws skipped', () => {
    // Size 3: 2^32 mod 3 = 1, so only the draw 0xFFFFFFFF is thrown away.
    const stream = [
      [0, 0, 0, 1], // 1 → "b"
      [0xff, 0xff, 0xff, 0xff], // rejected
      [0, 0, 0, 5], // 5 % 3 = 2 → "c"
      [0, 0, 1, 0], // 256 % 3 = 1 → "b"
      [0, 0, 0, 3], // 0 → "a" (second string)
      [0, 0, 0, 4], // 1 → "b"
      [0, 0, 0, 2], // 2 → "c"
    ].flat();
    const g = ok(generate(chars({ preset: 'custom', custom: 'abc', length: 3, count: 2 }), listSource(stream)));
    expect(g.values).toEqual(['bcb', 'abc']);
  });

  it('the source is read through bufferedSource — 4,096 bytes at a time — and the bytes are the same', () => {
    const { source, calls, given } = recorded(counter());
    const g = ok(generate(chars({ length: 1000, count: 10 }), source));
    expect(new Set(calls)).toEqual(new Set([4096]));
    // 10,000 characters of 62: about 4 bytes each, so 40,000 bytes and a little more for rejections — 10 blocks.
    expect(calls.length).toBe(10);
    expect(given.length).toBe(40_960);
    // Straight from the source, 4 bytes at a time: the same characters.
    const plain = counter();
    let first = '';
    for (let i = 0; i < 1000; i++) first += PRESETS.alnum[randomIndex(62, plain)];
    expect(g.values[0]).toBe(first);
  });

  it('Bytes takes count × bytes from the stream in order: string i is bytes i·n … i·n + n − 1', () => {
    const g = ok(generate(bytes({ bytes: 3, count: 4 }), counter()));
    expect(g.values).toEqual(['000102', '030405', '060708', '090a0b']);
  });

  it('a batch draws about 4 bytes per character, whatever its size: the work grows with the batch, linearly', () => {
    for (const total of [10_000, 1_000_000]) {
      const { source, calls } = recorded(cryptoRandom);
      ok(generate(chars({ length: 100, count: total / 100 }), source));
      const drawn = calls.reduce((a, b) => a + b, 0);
      expect(drawn).toBeGreaterThanOrEqual(4 * total);
      expect(drawn).toBeLessThan(4 * total + 2 * 4096);
    }
  });

  it('no Math.random, console or debug logger anywhere in the logic’s sources', () => {
    const root = dirname(fileURLToPath(import.meta.url));
    const files = readdirSync(root)
      .filter(f => /\.ts$/.test(f) && !/\.test\.ts$/.test(f))
      .map(f => join(root, f));
    expect(files.length).toBe(2);
    for (const file of files) expect(readFileSync(file, 'utf8')).not.toMatch(/Math\.random|console\.|createDebug/);
  });
});

/*
 * No modulo bias (§5.1, §5.2). The classic mistake is `alphabet[byte % n]` (or `⌊byte · n / 256⌋`): for an alphabet
 * whose size does not divide 256, some characters come out more often — for 62, eight of them 5/256 of the time and the
 * others 4/256. The tool picks every character by `randomIndex` (rejection sampling over 32-bit draws). The test counts
 * how often each character of an alphabet of 3, 5, 62, 100 and 255 comes out and compares with the uniform expectation
 * by Pearson's χ² with n − 1 degrees of freedom.
 *
 * The threshold is the χ² value an honest uniform generator exceeds with probability 10⁻⁶ (critical values below, each
 * checked against the χ² survival function computed here). Over the real source the test is random: each alphabet
 * fails falsely once in a million runs, the five together about once in 200,000 runs. Over the deterministic AES stream
 * it is not random at all — the same counts every run, so it cannot fail falsely; the threshold only says how surprising
 * those counts would be. The same deterministic stream fed to the classic mistake gives χ² many times over the threshold
 * (asserted), so the test does catch it: with 4,000,000 draws for 3 and 5 (their bias is smallest — 1/256 of a
 * character's share) and 1,000,000 for the others.
 */
const CRITICAL: Record<number, number> = { 3: 27.63, 5: 33.38, 62: 128.52, 100: 180.79, 255: 375.87 };
const SAMPLES: Record<number, number> = { 3: 4_000_000, 5: 4_000_000, 62: 1_000_000, 100: 1_000_000, 255: 1_000_000 };

/** log Γ (Lanczos, g = 7). */
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
/** P(χ²(df) > x): the regularized upper incomplete gamma Q(df/2, x/2), by its series or continued fraction. */
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
const chiSquare = (counts: readonly number[], total: number): number => {
  const expected = total / counts.length;
  return counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
};

/** An alphabet of `n` single-unit characters: the presets where they exist, CJK ideographs otherwise. */
const alphabetOfSize = (n: number): Settings =>
  n === 62
    ? chars({ preset: 'alnum' })
    : chars({
        preset: 'custom',
        custom:
          n <= 5 ? 'abcde'.slice(0, n) : Array.from({ length: n }, (_, i) => String.fromCharCode(0x4e00 + i)).join(''),
      });
const symbolsFor = (settings: Settings): string => {
  const c = check(settings);
  if (!c.ok || !c.symbols) throw new Error('alphabet');
  return c.symbols.join('');
};

/** How often each character of the alphabet comes out of the tool's own `generate` over `total` characters. */
const toolCounts = (n: number, total: number, source: RandomSource): number[] => {
  const base = alphabetOfSize(n);
  const symbols = symbolsFor(base);
  const position = new Map([...symbols].map((c, i) => [c.charCodeAt(0), i]));
  const counts = Array<number>(n).fill(0);
  for (let made = 0; made < total; made += LIMITS.total) {
    const g = ok(
      generate({ ...base, length: 1000, count: Math.min(LIMITS.total, total - made) / 1000 } as Settings, source),
    );
    for (const v of g.values) for (let i = 0; i < v.length; i++) counts[position.get(v.charCodeAt(i))!]!++;
  }
  return counts;
};
/** The classic mistakes, over the same kind of stream: one byte a character, `byte % n` or `⌊byte · n / 256⌋`. */
const mistakeCounts = (n: number, total: number, source: RandomSource, pick: (byte: number) => number): number[] => {
  const counts = Array<number>(n).fill(0);
  const block = new Uint8Array(65_536);
  for (let made = 0; made < total; made += block.length) {
    source(block);
    const take = Math.min(block.length, total - made);
    for (let i = 0; i < take; i++) counts[pick(block[i]!)]!++;
  }
  return counts;
};

describe('§5.2: no modulo bias — χ² for alphabets whose size does not divide 256', () => {
  it('the thresholds are the χ² values exceeded with probability 10⁻⁶', () => {
    // The survival function itself, at a value the password tool's test states: χ²(9) > 27.88 has p = 0.001.
    expect(chiSquareSurvival(27.88, 9)).toBeCloseTo(0.000999, 6);
    for (const [n, critical] of Object.entries(CRITICAL)) {
      const p = chiSquareSurvival(critical, Number(n) - 1);
      expect(p).toBeGreaterThan(0.95e-6);
      expect(p).toBeLessThan(1.05e-6);
    }
  });

  it('the deterministic stream holds every byte value', () => {
    const seen = new Set<number>();
    const block = new Uint8Array(65_536);
    aesStream('bias')(block);
    for (const b of block) seen.add(b);
    expect(seen.size).toBe(256);
  });

  for (const n of [3, 5, 62, 100, 255]) {
    it(`size ${n}: the tool is under the threshold over the deterministic stream; byte % n is far over it`, () => {
      const total = SAMPLES[n]!;
      const tool = chiSquare(toolCounts(n, total, aesStream(`bias-${n}`)), total);
      expect(tool).toBeLessThan(CRITICAL[n]!);
      const modulo = chiSquare(
        mistakeCounts(n, total, aesStream(`bias-${n}`), b => b % n),
        total,
      );
      const scaled = chiSquare(
        mistakeCounts(n, total, aesStream(`bias-${n}`), b => Math.floor((b * n) / 256)),
        total,
      );
      expect(modulo).toBeGreaterThan(3 * CRITICAL[n]!);
      expect(scaled).toBeGreaterThan(3 * CRITICAL[n]!);
    });

    it(`size ${n}: the tool is under the threshold over the browser's source (false failure: 1 in 10⁶)`, () => {
      const total = SAMPLES[n]!;
      expect(chiSquare(toolCounts(n, total, cryptoRandom), total)).toBeLessThan(CRITICAL[n]!);
    });
  }

  it('the rejection boundary: the last draw under the limit is kept, the limit itself is thrown away', () => {
    const be = (v: number) => [
      Math.floor(v / 2 ** 24) % 256,
      Math.floor(v / 2 ** 16) % 256,
      Math.floor(v / 256) % 256,
      v % 256,
    ];
    for (const n of [3, 5, 62, 100, 255]) {
      const limit = 2 ** 32 - (2 ** 32 % n);
      expect(2 ** 32 % n).toBeGreaterThan(0);
      const settings = alphabetOfSize(n);
      const symbols = symbolsFor(settings);
      const one = { ...settings, length: 1 } as Settings;
      expect(ok(generate(one, listSource(be(limit - 1)))).values[0]).toBe(symbols[(limit - 1) % n]);
      expect(ok(generate(one, listSource([...be(limit), ...be(n + 1)]))).values[0]).toBe(symbols[1]);
    }
  });
});

describe('fitsSettings: an entry from the history is checked, not trusted', () => {
  it('the right number of strings of the right length and alphabet', () => {
    const settings = chars({ preset: 'hex', length: 4, count: 2 });
    expect(fitsSettings(['00af', 'ffff'], settings)).toBe(true);
    expect(fitsSettings(['00af'], settings)).toBe(false);
    expect(fitsSettings(['00af', 'fffff'], settings)).toBe(false);
    expect(fitsSettings(['00AF', 'ffff'], settings)).toBe(false);
    const custom = chars({ preset: 'custom', custom: '🙂x', length: 3, count: 1 });
    expect(fitsSettings(['🙂x🙂'], custom)).toBe(true);
    expect(fitsSettings(['🙂xy'], custom)).toBe(false);
    expect(fitsSettings(['ab'], bytes({ bytes: 1, count: 1 }))).toBe(true);
    expect(fitsSettings(['abc'], bytes({ bytes: 1, count: 1 }))).toBe(false);
    expect(fitsSettings(['00'], chars({ length: 0 }))).toBe(false);
  });

  it('every encoding of every size the tool writes fits its settings', () => {
    for (const encoding of ENCODING_ORDER as Encoding[])
      for (const n of [1, 2, 3, 31, 32, 1024]) {
        const s = bytes({ bytes: n, encoding, count: 3 });
        expect(fitsSettings(ok(generate(s)).values, s)).toBe(true);
      }
  });
});
