// Properties over generated strings (a seeded generator, so a failure repeats): Escape then Unescape gives the input back
// in every dialect, with and without quotes and Escape non-ASCII — unpaired surrogates included except in C, which
// cannot hold them (they become U+FFFD). JSON is checked against JSON.stringify / JSON.parse, and JavaScript against V8
// reading the literal in strict mode (node:vm, the oracle only — the tool never evaluates text).
import { DIALECTS, escapeString, quotesFor, unescapeString } from './index';
import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import type { Dialect, Quote } from './index';

// Heavy on purpose (thousands of generated cases, megabytes, external oracles): more than the default 5 s per test
// when the whole workspace's tests run at once.
const HEAVY = { timeout: 60_000 };

/** xorshift32: deterministic, enough to spread the cases. */
const generator = (seed: number) => {
  let state = seed >>> 0 || 1;
  return (n: number): number => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state % n;
  };
};

/** Code units and characters that matter to some dialect, and some that matter to none. */
const POOL = [
  ...'abcXYZ019 ',
  '\\',
  '"',
  "'",
  '`',
  '$',
  '{',
  '}',
  '?',
  '/',
  '\u0000',
  '\u0007',
  '\u0008',
  '\t',
  '\n',
  '\u000b',
  '\u000c',
  '\r',
  '\u001b',
  '\u001f',
  '\u007f',
  '\u0080',
  '\u0085',
  '\u009f',
  ' ',
  'é',
  'ÿ',
  'Ā',
  'Ж',
  '\u2028',
  '\u2029',
  '﻿',
  '�',
  '￿',
  '\u{1F600}',
  '\u{10FFFF}',
  '\u{10000}',
  '\uD800',
  '\uDBFF',
  '\uDC00',
  '\uDFFF',
];

const randomText = (next: (n: number) => number, withSurrogates: boolean): string => {
  let s = '';
  const length = next(24);
  for (let i = 0; i < length; i++) {
    const piece = POOL[next(POOL.length)]!;
    if (!withSurrogates && piece.length === 1 && piece >= '\uD800' && piece <= '\uDFFF') continue;
    s += next(10) === 0 ? String.fromCharCode(next(0x10000)) : piece;
  }
  if (!withSurrogates) s = s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
  return s;
};

const RUNS = 3000;

/** Does the text hold a C0 control character (or DEL, when `del`)? */
const hasControl = (s: string, del: boolean): boolean => {
  for (let i = 0; i < s.length; i++) {
    const unit = s.charCodeAt(i);
    if (unit < 0x20 || (del && unit === 0x7f)) return true;
  }
  return false;
};

describe('Escape then Unescape gives the input back', HEAVY, () => {
  for (const dialect of DIALECTS)
    it(`${dialect}: every quote, with and without quotes and Escape non-ASCII${dialect === 'c' ? ' (no unpaired surrogates)' : ''}`, () => {
      const next = generator(0x5eed + dialect.length);
      for (let run = 0; run < RUNS; run++) {
        const input = randomText(next, dialect !== 'c');
        for (const quote of quotesFor(dialect) as Quote[])
          for (const nonAscii of [false, true])
            for (const withQuotes of [false, true]) {
              const escaped = escapeString(input, { dialect, quote, nonAscii, withQuotes });
              const back = unescapeString(escaped, { dialect, withQuotes });
              const context = JSON.stringify({ input, quote, nonAscii, withQuotes, escaped });
              expect(back.ok, context).toBe(true);
              if (!back.ok) return;
              expect(back.text, context).toBe(input);
              expect(back.keptUnknown, context).toEqual([]);
              expect(back.invalidUtf8, context).toBe(false);
              // ASCII only (JSON keeps DEL, U+007F, as JSON.stringify does).
              if (nonAscii) expect(/^[\x20-\x7f]*$/.test(escaped), context).toBe(true);
            }
      }
    });

  it('c: an unpaired surrogate comes back as U+FFFD, everything else as it was', () => {
    const next = generator(0xc0de);
    for (let run = 0; run < RUNS; run++) {
      const input = randomText(next, true);
      const expected = input.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�');
      for (const nonAscii of [false, true]) {
        const back = unescapeString(escapeString(input, { dialect: 'c', quote: '"', nonAscii, withQuotes: false }), {
          dialect: 'c',
          withQuotes: false,
        });
        expect(back.ok && back.text, JSON.stringify(input)).toBe(expected);
      }
    }
  });

  it('the result of Escape holds no line break and no other control character (JSON keeps DEL)', () => {
    const next = generator(42);
    for (const dialect of DIALECTS)
      for (let run = 0; run < 500; run++) {
        const escaped = escapeString(randomText(next, true), {
          dialect,
          quote: '"',
          nonAscii: false,
          withQuotes: false,
        });
        expect(hasControl(escaped, dialect !== 'json'), JSON.stringify(escaped)).toBe(false);
        if (dialect === 'js' || dialect === 'python') expect(/[\u2028\u2029]/.test(escaped)).toBe(false);
      }
  });
});

describe('the languages themselves agree (JSON, V8)', HEAVY, () => {
  it('JSON Escape is JSON.stringify(text).slice(1, -1) for any text', () => {
    const next = generator(7);
    for (let run = 0; run < RUNS; run++) {
      const input = randomText(next, true);
      expect(escapeString(input, { dialect: 'json', quote: '"', nonAscii: false, withQuotes: false })).toBe(
        JSON.stringify(input).slice(1, -1),
      );
    }
  });

  it('JSON.parse reads what Escape wrote, also under Escape non-ASCII', () => {
    const next = generator(8);
    for (let run = 0; run < RUNS; run++) {
      const input = randomText(next, true);
      const escaped = escapeString(input, { dialect: 'json', quote: '"', nonAscii: true, withQuotes: true });
      expect(JSON.parse(escaped)).toBe(input);
    }
  });

  /** V8 reads a string literal in strict mode, or says it is an error. */
  const v8 = (literal: string): { ok: true; text: string } | { ok: false } => {
    try {
      return { ok: true, text: runInNewContext(`'use strict'; ${literal}`) as string };
    } catch {
      return { ok: false };
    }
  };

  it('V8 reads what JavaScript Escape wrote, in each quote, as the input', () => {
    const next = generator(9);
    for (let run = 0; run < RUNS; run++) {
      const input = randomText(next, true);
      for (const quote of quotesFor('js') as Quote[])
        for (const nonAscii of [false, true]) {
          const literal = escapeString(input, { dialect: 'js', quote, nonAscii, withQuotes: true });
          expect(v8(literal), literal).toEqual({ ok: true, text: input });
        }
    }
  });

  /** Escapes of every kind, well-formed and not, glued to plain text. */
  const ESCAPE_POOL = [
    'a',
    '1',
    '8',
    '{',
    '}',
    'é',
    '\\n',
    '\\t',
    '\\r',
    '\\b',
    '\\f',
    '\\v',
    '\\0',
    '\\00',
    '\\1',
    '\\7',
    '\\8',
    '\\9',
    '\\101',
    '\\x41',
    '\\x4',
    '\\xZ',
    '\\u0041',
    '\\uD83D',
    '\\uDE00',
    '\\u12',
    '\\u{1F600}',
    '\\u{110000}',
    '\\u{}',
    '\\u{41',
    '\\U0001F600',
    '\\N{BULLET}',
    '\\a',
    '\\q',
    '\\?',
    '\\/',
    "\\'",
    '\\"',
    '\\`',
    '\\$',
    '\\\\',
    '\\\n',
    '\\\r\n',
    '\\\u2028',
    '\\é',
  ];

  const randomEscapes = (next: (n: number) => number): string => {
    let s = '';
    const length = 1 + next(6);
    for (let i = 0; i < length; i++) s += ESCAPE_POOL[next(ESCAPE_POOL.length)]!;
    return s;
  };

  it('JavaScript Unescape agrees with V8 on generated escapes: the same text, or both refuse', () => {
    const next = generator(10);
    for (let run = 0; run < RUNS; run++) {
      const body = randomEscapes(next);
      // Inside double quotes: a raw " or line break would end or break V8's literal, not ours.
      if (/(^|[^\\])(\\\\)*"/.test(body) || /[\n\r\u2028]/.test(body.replace(/\\(\r\n|[\n\r\u2028])/g, ''))) continue;
      const ours = unescapeString(body, { dialect: 'js', withQuotes: false });
      const theirs = v8(`"${body}"`);
      expect(ours.ok ? { ok: true, text: ours.text } : { ok: false }, body).toEqual(theirs);
    }
  });

  it('JSON Unescape agrees with JSON.parse on generated escapes (where the text has no raw control character)', () => {
    const next = generator(11);
    let compared = 0;
    for (let run = 0; run < RUNS; run++) {
      const body = randomEscapes(next);
      if (hasControl(body, false) || /(^|[^\\])(\\\\)*"/.test(body)) continue;
      const ours = unescapeString(body, { dialect: 'json', withQuotes: false });
      let theirs: { ok: true; text: string } | { ok: false };
      try {
        theirs = { ok: true, text: JSON.parse(`"${body}"`) as string };
      } catch {
        theirs = { ok: false };
      }
      expect(ours.ok ? { ok: true, text: ours.text } : { ok: false }, body).toEqual(theirs);
      compared++;
    }
    expect(compared).toBeGreaterThan(RUNS / 10);
  });
});

describe('every dialect reads at least what it writes', () => {
  it.each(DIALECTS.map(d => [d]))('%s', (dialect: Dialect) => {
    const all = Array.from({ length: 0xa0 }, (_, i) => String.fromCharCode(i)).join('') + '\u2028\u2029\u{1F600}';
    for (const quote of quotesFor(dialect) as Quote[]) {
      const escaped = escapeString(all, { dialect, quote, nonAscii: true, withQuotes: false });
      const back = unescapeString(escaped, { dialect, withQuotes: false });
      expect(back.ok && back.text).toBe(all);
    }
  });
});
