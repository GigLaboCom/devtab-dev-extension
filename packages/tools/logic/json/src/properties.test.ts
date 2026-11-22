/**
 * The promise that matters (docs/tools/specs/json.md §1, §5 «Результат»): formatting and minifying never change a value.
 * On generated documents — huge and odd numbers, odd and repeated names, every escape, line breaks of every kind,
 * nesting down to the limit, comments and trailing commas for JSONC — the tokens of the output are the tokens of the
 * input (Sort keys: the same tokens, every object's members in code-point order, repeats in their order), the output
 * is strict JSON, and format → minify → format is stable. Then the fuzz row of §10: random edits of valid documents are
 * accepted exactly when JSON.parse accepts them, and what is accepted prints to the same value. Seeded: a failure
 * names its seed and repeats.
 */
import { printJson } from './logic';
import { scanJson } from '@workspace/tools-shared/json-scan';
import { describe, expect, it } from 'vitest';
import { isDeepStrictEqual } from 'node:util';
import type { PrintOptions } from './logic';
import type { Layout } from '@workspace/tools-shared/json-scan';

/** Generous: these run with every other package's tests at once, and the machine may be busy. */
const SLOW = 120_000;

/** mulberry32: small, fast, seeded. */
const random = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const NUMBERS = [
  '0',
  '-0',
  '7',
  '-12',
  '1.50',
  '1.0',
  '1e2',
  '1E400',
  '-1e400',
  '1e-400',
  '1.5E-3',
  '0.1e1',
  '-0.0e-0',
  '9007199254740993',
  '12345678901234567890',
  '-123456789012345678901234567890',
  '0.1000000000000000055511151231257827',
  '3.141592653589793238462643383279',
];
const PIECES = [
  'a',
  'Z',
  ' ',
  'x y',
  'é',
  'ключ',
  '🙂',
  '😀',
  '！',
  '\u2028',
  '\\"',
  '\\\\',
  '\\/',
  '\\b',
  '\\f',
  '\\n',
  '\\r',
  '\\t',
  '\\u00e9',
  '\\u00E9',
  '\\ud800',
  '\\udc00',
  '\\ud83d\\ude00',
  '\\u0000',
  '\\u001f',
  '\\uFFFF',
  '\\uE000',
];
const NAMES = [
  '""',
  '"a"',
  '"b"',
  '"B"',
  '"_"',
  '"1"',
  '"2"',
  '"10"',
  '"9"',
  '"__proto__"',
  '"constructor"',
  '"\\u0061"',
];
const SPACES = ['', '', '', ' ', '\n', '\r\n', '\r', '\t', '  \n    ', ' \r\n\t'];
const COMMENTS = ['/* c */', '// line\n', '//\r', '/**/', '/* multi\nline */', '// x\r\n'];

interface Gen {
  rnd: () => number;
  comments: boolean;
}
const pick = <T>(g: Gen, from: readonly T[]): T => from[Math.floor(g.rnd() * from.length)]!;
const gap = (g: Gen): string =>
  g.comments && g.rnd() < 0.3 ? `${pick(g, SPACES)}${pick(g, COMMENTS)}${pick(g, SPACES)}` : pick(g, SPACES);
const str = (g: Gen): string => `"${Array.from({ length: Math.floor(g.rnd() * 5) }, () => pick(g, PIECES)).join('')}"`;
const name = (g: Gen): string => (g.rnd() < 0.5 ? pick(g, NAMES) : str(g));

/** A random document: `budget` bounds the number of values, depth up to `deep`. Iterative, so `deep` may be 1000. */
const document = (g: Gen, budget: number, deep: number): string => {
  let out = gap(g);
  let left = budget;
  const scalar = (): string => {
    const r = g.rnd();
    return r < 0.35 ? pick(g, NUMBERS) : r < 0.75 ? str(g) : pick(g, ['true', 'false', 'null']);
  };
  /** Returns the text of one value; containers recurse only `deep` levels, each level a frame of this small function. */
  const value = (depth: number): string => {
    left--;
    const r = g.rnd();
    if (depth >= deep || left <= 0 || r < 0.45) return scalar();
    const members = Math.floor(g.rnd() * 5);
    const object = r < 0.72;
    let text = object ? '{' : '[';
    for (let k = 0; k < members; k++) {
      text += gap(g);
      if (object) text += `${name(g)}${gap(g)}:${gap(g)}`;
      text += value(depth + 1);
      text += gap(g);
      if (k < members - 1) text += ',';
    }
    if (g.comments && members > 0 && g.rnd() < 0.3) text += `,${gap(g)}`;
    return `${text}${object ? '}' : ']'}`;
  };
  out += value(0);
  return out + gap(g);
};

/** A chain `deep` levels down, objects and arrays mixed, with a scalar at the bottom and siblings on the way. */
const chain = (g: Gen, deep: number): string => {
  let open = '';
  let close = '';
  for (let d = 0; d < deep; d++) {
    if (g.rnd() < 0.5) {
      open += `{${gap(g)}${name(g)}${gap(g)}:${gap(g)}`;
      close = `${gap(g)}}${close}`;
    } else {
      open += `[${g.rnd() < 0.3 ? `${pick(g, NUMBERS)},` : ''}${gap(g)}`;
      close = `${gap(g)}]${close}`;
    }
  }
  return `${open}${pick(g, NUMBERS)}${close}`;
};

type Token = string;
const tokensOf = (text: string, allowComments: boolean): Token[] => {
  const out: Token[] = [];
  const r = scanJson(
    text,
    { allowComments },
    {
      open: b => out.push(b),
      close: b => out.push(b === '{' ? '}' : ']'),
      key: raw => out.push(`k${raw}`),
      value: raw => out.push(`v${raw}`),
      comma: () => out.push(','),
    },
  );
  if (!r.ok) throw new Error(`${r.error.line}:${r.error.column} ${r.error.message}`);
  return out;
};

/** The reference of Sort keys: comparing arrays of code points, a stable sort, written as plainly as possible. */
const byCodePoints = (a: string, b: string): number => {
  const x = Array.from(a, c => c.codePointAt(0)!);
  const y = Array.from(b, c => c.codePointAt(0)!);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return x.length - y.length;
};
const decode = (raw: string): string => JSON.parse(raw) as string;
/** Tokens of the input with every object's members sorted: a small tree of token runs, then flattened. */
const sortedTokens = (text: string, allowComments: boolean): Token[] => {
  const flat = tokensOf(text, allowComments);
  let at = 0;
  const run = (): Token[] => {
    const first = flat[at++]!;
    if (first !== '{' && first !== '[') return [first];
    const members: Array<{ name: string; tokens: Token[] }> = [];
    while (flat[at] !== '}' && flat[at] !== ']') {
      if (flat[at] === ',') at++;
      const key = first === '{' ? flat[at++]! : null;
      members.push({ name: key ? decode(key.slice(1)) : '', tokens: [...(key ? [key] : []), ...run()] });
    }
    at++;
    if (first === '{') members.sort((p, q) => byCodePoints(p.name, q.name));
    return [first, ...members.flatMap((m, i) => (i ? [',', ...m.tokens] : m.tokens)), first === '{' ? '}' : ']'];
  };
  return run();
};

const print = (text: string, layout: Layout, more: Partial<PrintOptions> = {}): string => {
  const r = printJson(text, { layout, sortKeys: false, allowComments: false, ...more });
  if (!r.ok) throw new Error(`${r.error.line}:${r.error.column} ${r.error.message}`);
  return r.text;
};

const LAYOUTS: Layout[] = [2, 4, 'tab', 'minify'];

const promise = (text: string, allowComments: boolean): void => {
  const input = tokensOf(text, allowComments);
  const inputNotes = scanJson(text, { allowComments });
  const minified = print(text, 'minify', { allowComments });
  for (const layout of LAYOUTS) {
    const out = print(text, layout, { allowComments });
    // The same tokens, as written; the output is strict JSON with the same repeated names and inexact numbers.
    expect(tokensOf(out, false)).toEqual(input);
    const outNotes = scanJson(out);
    expect(outNotes.ok && inputNotes.ok).toBe(true);
    if (outNotes.ok && inputNotes.ok) {
      expect(outNotes.notes.comments + outNotes.notes.trailingCommas).toBe(0);
      expect(outNotes.notes.duplicateKeys.map(d => d.key)).toEqual(inputNotes.notes.duplicateKeys.map(d => d.key));
      expect(outNotes.notes.inexactNumbers).toBe(inputNotes.notes.inexactNumbers);
    }
    // Stable: printing the output again gives it back; minify and format undo each other.
    expect(print(out, layout)).toBe(out);
    expect(print(out, 'minify')).toBe(minified);
    if (layout !== 'minify') expect(print(minified, layout)).toBe(out);
    // Without comments JSON.parse reads the same value from both (the last of repeated names wins in both).
    if (!allowComments) expect(isDeepStrictEqual(JSON.parse(out), JSON.parse(text))).toBe(true);
  }
  const sorted = print(text, 'minify', { allowComments, sortKeys: true });
  expect(tokensOf(sorted, false)).toEqual(sortedTokens(text, allowComments));
  expect(print(sorted, 'minify', { sortKeys: true })).toBe(sorted);
  expect(print(text, 2, { allowComments, sortKeys: true })).toBe(print(sorted, 2));
  if (!allowComments) expect(isDeepStrictEqual(JSON.parse(sorted), JSON.parse(text))).toBe(true);
};

describe('formatting and minifying never change a value', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'generated documents, seed %i (400 each)',
    seed => {
      const g: Gen = { rnd: random(seed), comments: false };
      for (let k = 0; k < 400; k++) {
        const text = document(g, 60, 12);
        try {
          promise(text, false);
        } catch (error) {
          throw new Error(`seed ${seed}, document ${k}: ${JSON.stringify(text)}\n${String(error)}`);
        }
      }
    },
    SLOW,
  );

  it.each([11, 12, 13, 14])(
    'JSONC documents: comments and trailing commas go, nothing else changes, seed %i',
    seed => {
      const g: Gen = { rnd: random(seed), comments: true };
      for (let k = 0; k < 300; k++) {
        const text = document(g, 60, 10);
        try {
          promise(text, true);
        } catch (error) {
          throw new Error(`seed ${seed}, document ${k}: ${JSON.stringify(text)}\n${String(error)}`);
        }
      }
    },
    SLOW,
  );

  it(
    'nesting down to the limit, objects and arrays mixed',
    () => {
      const g: Gen = { rnd: random(21), comments: false };
      for (const deep of [1000, 999, 500]) {
        const text = chain(g, deep);
        promise(text, false);
        const tree = (() => {
          const r = printJson(text, { layout: 2, sortKeys: true, allowComments: false });
          return r.ok;
        })();
        expect(tree).toBe(true);
      }
      expect(printJson(chain(g, 1001), { layout: 2, sortKeys: false, allowComments: false }).ok).toBe(false);
    },
    SLOW,
  );

  it(
    'a large generated document: the tokens stay, in linear time',
    () => {
      const g: Gen = { rnd: random(31), comments: false };
      const parts: string[] = [];
      for (let k = 0; k < 3000; k++) parts.push(document(g, 40, 8));
      const text = `[${parts.join(',')}]`;
      const t0 = performance.now();
      promise(text, false);
      expect(performance.now() - t0).toBeLessThan(20_000);
    },
    SLOW,
  );
});

describe('json.md §10, the fuzz row: random edits of valid documents', () => {
  const VALID = [
    '{"id":7,"tags":["a","b"],"ok":true,"n":null,"x":-1.5e3,"s":"q\\"\\u00e9\\n"}',
    '[{"a":[1,2,{"b":[]}]},{},[[0.5]],"\\ud83d\\ude00",-0,1E2]',
    '{\n  "name": "example",\n  "list": [\n    1,\n    2\n  ],\n  "nested": {"k": {"j": false}}\n}',
    '"just a string with \\t tab"',
  ];
  const ALPHABET = '{}[],:"\0-1.e+0 \n\tabfnrtuE\\/\'x9';

  it(
    '200 000 edits (insert, delete, replace): accepted ⇔ JSON.parse accepts; the result reads to the same value',
    () => {
      const rnd = random(2026);
      let accepted = 0;
      for (let k = 0; k < 200_000; k++) {
        let text = VALID[k % VALID.length]!;
        for (let edits = 1 + Math.floor(rnd() * 3); edits > 0; edits--) {
          const at = Math.floor(rnd() * (text.length + 1));
          const ch = ALPHABET[Math.floor(rnd() * ALPHABET.length)]!;
          const op = rnd();
          text =
            op < 0.34
              ? text.slice(0, at) + ch + text.slice(at)
              : op < 0.67
                ? text.slice(0, at) + text.slice(at + 1)
                : text.slice(0, at) + ch + text.slice(at + 1);
        }
        let parsed: unknown;
        let native = true;
        try {
          parsed = JSON.parse(text);
        } catch {
          native = false;
        }
        const ours = scanJson(text);
        if (ours.ok !== native) throw new Error(`disagreement on ${JSON.stringify(text)}: JSON.parse ${native}`);
        if (!native) continue;
        accepted++;
        for (const layout of [2, 'minify'] as const) {
          const out = print(text, layout);
          if (!isDeepStrictEqual(JSON.parse(out), parsed)) throw new Error(`value changed: ${JSON.stringify(text)}`);
        }
      }
      expect(accepted).toBeGreaterThan(1000);
    },
    SLOW,
  );
});
