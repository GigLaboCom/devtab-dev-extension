// The languages themselves as oracles, when the machine has them: Python 3 (`python3`, ast.literal_eval) and clang
// (`clang -std=c11`). Each is asked once for a batch of literals; where it is missing, its checks are skipped. The tool
// never runs either — this is how the specification's "checked" column is kept honest (docs/tools/specs/backslash-escape.md
// §10, §15).
import { escapeString, quotesFor, unescapeString } from './index';
import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Quote } from './index';

// Heavy on purpose (thousands of generated cases, megabytes, external oracles): more than the default 5 s per test
// when the whole workspace's tests run at once.
const HEAVY = { timeout: 60_000 };

const has = (command: string, args: string[]): boolean => {
  try {
    return spawnSync(command, args, { stdio: 'ignore', timeout: 10_000 }).status === 0;
  } catch {
    return false;
  }
};
const PYTHON = has('python3', ['--version']);
const CLANG = has('clang', ['--version']);

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

const PLAIN = [...'abz09 "\'`$?/', '\\', '\t', '\n', '\r', '\u0000', '\u0007', '\u001f', '\u007f', '\u0085', ' '];
const MORE = ['é', 'ÿ', 'Ж', '\u2028', '\u2029', '﻿', '�', '\u{1F600}', '\u{10FFFF}', '\uD800', '\uDFFF'];

const randomText = (next: (n: number) => number, loneSurrogates: boolean): string => {
  let s = '';
  for (let i = next(20); i > 0; i--) {
    const pool = next(3) === 0 ? MORE : PLAIN;
    const piece = pool[next(pool.length)]!;
    if (!loneSurrogates && piece.length === 1 && piece >= '\uD800' && piece <= '\uDFFF') continue;
    s += piece;
  }
  return s;
};

const ESCAPES = [
  'a',
  '8',
  'é',
  '\\n',
  '\\t',
  '\\r',
  '\\b',
  '\\f',
  '\\v',
  '\\a',
  '\\0',
  '\\08',
  '\\1012',
  '\\7',
  '\\377',
  '\\400',
  '\\777',
  '\\8',
  '\\x41',
  '\\xe9',
  '\\x4',
  '\\x100',
  '\\x00e9',
  '\\u0041',
  '\\u00e9',
  '\\uD83D',
  '\\uDE00',
  '\\u12',
  '\\U0001F600',
  '\\U0000d800',
  '\\U00110000',
  '\\U0001F6',
  '\\u{41}',
  '\\q',
  '\\?',
  '\\/',
  '\\`',
  "\\'",
  '\\"',
  '\\\\',
  '\\\n',
  '\\é',
  '\\303\\251',
];

const randomEscapes = (next: (n: number) => number): string => {
  let s = '';
  for (let i = 1 + next(5); i > 0; i--) s += ESCAPES[next(ESCAPES.length)]!;
  return s;
};

/** UTF-16 code units of Python code points (a surrogate code point is its own unit, as the tool keeps it). */
type PythonAnswer = { ok: true; units: number[]; surrogates: number } | { ok: false };

const PYTHON_READER = `
import ast, json, sys, warnings
warnings.simplefilter('ignore')
out = []
for source in json.loads(sys.stdin.read()):
    try:
        value = ast.literal_eval(source)
    except Exception:
        out.append({'ok': False})
        continue
    units = []
    for c in value:
        o = ord(c)
        units.extend([0xD800 + ((o - 0x10000) >> 10), 0xDC00 + ((o - 0x10000) & 0x3FF)] if o > 0xFFFF else [o])
    out.append({'ok': True, 'units': units, 'surrogates': sum(1 for c in value if 0xD800 <= ord(c) <= 0xDFFF)})
print(json.dumps(out))
`;

const python = (sources: string[]): PythonAnswer[] =>
  JSON.parse(
    execFileSync('python3', ['-I', '-c', PYTHON_READER], {
      input: JSON.stringify(sources),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 60_000,
    }),
  ) as PythonAnswer[];

const units = (s: string): number[] => Array.from({ length: s.length }, (_, i) => s.charCodeAt(i));

describe.skipIf(!PYTHON)('Python 3 reads what the tool writes, and reads escapes as the tool does', HEAVY, () => {
  it('Escape, Python: ast.literal_eval gives the input back (each quote, Escape non-ASCII on and off)', () => {
    const next = generator(31);
    const inputs: string[] = [];
    const sources: string[] = [];
    for (let run = 0; run < 1500; run++) {
      const input = randomText(next, true);
      for (const quote of quotesFor('python') as Quote[])
        for (const nonAscii of [false, true]) {
          inputs.push(input);
          sources.push(escapeString(input, { dialect: 'python', quote, nonAscii, withQuotes: true }));
        }
    }
    const answers = python(sources);
    answers.forEach((answer, i) =>
      expect(answer, sources[i]).toEqual(expect.objectContaining({ ok: true, units: units(inputs[i]!) })),
    );
  });

  it('Unescape, Python: the same text, or both refuse — except \\N{…}, which the tool does not support', () => {
    const next = generator(32);
    const bodies: string[] = [];
    for (let run = 0; run < 3000; run++) {
      const body = randomEscapes(next);
      // A raw ' would close Python's literal; a raw line break not after a backslash would break it.
      if (/(^|[^\\])(\\\\)*'/.test(body)) continue;
      bodies.push(body);
    }
    const answers = python(bodies.map(b => `'${b}'`));
    let refusedByBoth = 0;
    bodies.forEach((body, i) => {
      const ours = unescapeString(body, { dialect: 'python', withQuotes: false });
      const theirs = answers[i]!;
      expect(ours.ok, body).toBe(theirs.ok);
      if (ours.ok && theirs.ok) {
        expect(units(ours.text), body).toEqual(theirs.units);
        expect(ours.loneSurrogates, body).toBe(theirs.surrogates);
      } else refusedByBoth++;
    });
    expect(refusedByBoth).toBeGreaterThan(0);
    expect(python(["'\\N{BULLET}'"])[0]).toEqual({ ok: true, units: [0x2022], surrogates: 0 });
  });

  it('the specification’s Python rows (§10) — what Python itself gives', () => {
    const rows: Array<[string, string | null]> = [
      ['\\a\\b\\f\\n\\r\\t\\v', '\u0007\u0008\u000c\u000a\u000d\u0009\u000b'],
      ['\\x41\\u00e9\\U0001F600', 'Aé\u{1F600}'],
      ['\\101\\0\\7', 'A\u0000\u0007'],
      ['\\q\\d', '\\q\\d'],
      ['\\777', 'ǿ'],
      ['\\U00110000', null],
      ['\\u12', null],
      ['abc\\', null],
      ['a\\\nb', 'ab'],
      ['\\ud800', '\uD800'],
    ];
    const answers = python(rows.map(([body]) => `'${body}'`));
    rows.forEach(([body, expected], i) => {
      const ours = unescapeString(body, { dialect: 'python', withQuotes: false });
      expect(answers[i]!.ok, body).toBe(expected !== null);
      expect(ours.ok ? ours.text : null, body).toBe(expected);
    });
  });
});

/** clang's bytes for each literal (one program for all), or null when the program does not compile. */
const clangBytes = (literals: string[]): number[][] | null => {
  const dir = mkdtempSync(join(tmpdir(), 'backslash-escape-c-'));
  try {
    const decl = literals.map((l, i) => `static const char s${i}[] = "${l}";`).join('\n');
    const prints = literals
      .map(
        (_, i) =>
          `for (unsigned i = 0; i + 1 < sizeof s${i}; i++) printf("%02x ", (unsigned char)s${i}[i]); printf("|\\n");`,
      )
      .join('\n');
    writeFileSync(join(dir, 't.c'), `#include <stdio.h>\n${decl}\nint main(void) {\n${prints}\nreturn 0;\n}\n`, 'utf8');
    const compiled = spawnSync('clang', ['-std=c11', '-w', join(dir, 't.c'), '-o', join(dir, 't')], {
      encoding: 'utf8',
      timeout: 60_000,
    });
    if (compiled.status !== 0) return null;
    const out = execFileSync(join(dir, 't'), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return out
      .split('|\n')
      .slice(0, literals.length)
      .map(line =>
        line
          .trim()
          .split(' ')
          .filter(Boolean)
          .map(h => parseInt(h, 16)),
      );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const decodeUtf8 = (bytes: number[]): string =>
  new TextDecoder('utf-8', { ignoreBOM: true }).decode(new Uint8Array(bytes));

describe.skipIf(!CLANG)('clang (C11) compiles what the tool writes, and reads escapes as the tool does', HEAVY, () => {
  it('Escape, C: the literal’s bytes are the input’s UTF-8 (Escape non-ASCII on and off)', () => {
    const next = generator(41);
    const inputs: string[] = [];
    const literals: string[] = [];
    for (let run = 0; run < 400; run++) {
      const input = randomText(next, false);
      for (const nonAscii of [false, true]) {
        inputs.push(input);
        literals.push(escapeString(input, { dialect: 'c', quote: '"', nonAscii, withQuotes: false }));
      }
    }
    const answers = clangBytes(literals);
    expect(answers).not.toBeNull();
    answers!.forEach((b, i) => expect(b, literals[i]).toEqual([...new TextEncoder().encode(inputs[i]!)]));
  });

  it('Unescape, C: what the tool accepts compiles to the same text', () => {
    const next = generator(42);
    const accepted: Array<[string, string]> = [];
    for (let run = 0; run < 1500; run++) {
      const body = randomEscapes(next);
      if (/(^|[^\\])(\\\\)*"/.test(body)) continue;
      const ours = unescapeString(body, { dialect: 'c', withQuotes: false });
      if (ours.ok) accepted.push([body, ours.text]);
    }
    const answers = clangBytes(accepted.map(([body]) => body));
    expect(answers).not.toBeNull();
    answers!.forEach((b, i) => expect(decodeUtf8(b), accepted[i]![0]).toBe(accepted[i]![1]));
  });

  it('what the tool refuses as out of range or malformed, clang refuses too', () => {
    for (const body of [
      '\\x100',
      '\\400',
      '\\u0041',
      '\\u009f',
      '\\ud800',
      '\\U0000D800',
      '\\U00110000',
      '\\u12',
      '\\U0001F6',
      '\\x',
    ]) {
      expect(unescapeString(body, { dialect: 'c', withQuotes: false }).ok, body).toBe(false);
      expect(clangBytes([body]), body).toBeNull();
    }
  });
});
