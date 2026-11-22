/**
 * The promises §10 states as runs and §5 states as rules (docs/tools/specs/json-csv.md), on generated tables, seeded:
 * a failure names its seed and repeats.
 *
 * - fuzz: the writer and the reader agree on 5,000 tables of awkward values, every delimiter, CRLF and LF;
 * - the delimiter rule on 2,000 tables with commas, semicolons and pipes inside values;
 * - CSV → JSON → CSV gives the same table for any table of strings;
 * - JSON → CSV → JSON gives the same JSON where §5 promises it (flat or nested objects of numbers as written, true,
 *   false, null and strings that read back as strings), and wherever the tool does not say it lost something.
 */
import {
  DEFAULT_TO_CSV,
  DEFAULT_TO_JSON,
  DELIMITERS,
  csvToJson,
  describeLosses,
  detectDelimiter,
  jsonToCsv,
  readCsv,
} from './logic';
import { parseJsonTree } from '@workspace/tools-shared/json-scan';
import { describe, expect, it } from 'vitest';
import type { Delimiter, ToCsvOptions, ToJsonOptions } from './logic';
import type { JsonNode } from '@workspace/tools-shared/json-scan';

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
const pick = <T>(next: () => number, from: readonly T[]): T => from[Math.floor(next() * from.length)]!;
const between = (next: () => number, lo: number, hi: number): number => lo + Math.floor(next() * (hi - lo + 1));

/** The awkward pieces of the fuzz row of §10. */
const PIECES = [
  ',',
  ';',
  '\t',
  '|',
  '"',
  '""',
  '\r',
  '\n',
  '\r\n',
  ' ',
  '🙂',
  '=1',
  "'",
  'a',
  'Bob',
  'é',
  '42',
  '-',
  '+',
  '@',
];
const cellOf = (next: () => number): string => {
  let s = '';
  const n = between(next, 0, 4);
  for (let k = 0; k < n; k++) s += pick(next, PIECES);
  return s;
};
const tableOf = (next: () => number, cell: () => string = () => cellOf(next)): string[][] => {
  const columns = between(next, 1, 6);
  return Array.from({ length: between(next, 1, 8) }, () => Array.from({ length: columns }, cell));
};

/** An independent writer for the tests: RFC 4180, every field quoted when it holds anything special. */
const writeTable = (table: string[][], delimiter: Delimiter, newline: string): string =>
  table
    .map(row =>
      row.length === 1 && row[0] === ''
        ? '""'
        : row.map(f => (/[",;\t|\r\n]/.test(f) ? `"${f.replaceAll('"', '""')}"` : f)).join(delimiter),
    )
    .join(newline) + newline;

const fieldsOf = (text: string, delimiter: Delimiter): string[][] => {
  const read = readCsv(text, delimiter);
  if (!read.ok) throw new Error(`${read.error.line}:${read.error.column} ${read.error.message}`);
  return read.records.map(r => r.fields);
};

/** A JSON value as one canonical string: members sorted, numbers as written (so `1.50` ≠ `1.5`). */
const canonical = (node: JsonNode): string => {
  switch (node.type) {
    case 'object':
      return `{${[...node.entries]
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
        .map(e => `${JSON.stringify(e.key)}:${canonical(e.value)}`)
        .join(',')}}`;
    case 'array':
      return `[${node.items.map(canonical).join(',')}]`;
    case 'string':
      return JSON.stringify(node.value);
    case 'number':
      return node.raw;
    case 'boolean':
      return String(node.value);
    default:
      return 'null';
  }
};
const canonicalOf = (json: string): string => {
  const parsed = parseJsonTree(json);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return canonical(parsed.tree);
};

const NUMBERS = [
  '0',
  '-0',
  '7',
  '-12',
  '1.50',
  '1e2',
  '1E400',
  '-1e400',
  '1e-400',
  '1.5E-3',
  '9007199254740993',
  '12345678901234567890',
  '-123456789012345678901234567890',
  '0.1000000000000000055511151231257827',
];
/** Strings that read back as strings: not empty, not a number, not true/false, not formula-like. */
const PLAIN = [
  'Ann',
  ' lead',
  'trail ',
  'a,b',
  'say "hi"',
  'line1\nline2',
  'x\r\ny',
  'é',
  '🙂',
  '007',
  '1 555',
  'null',
  'N/A',
  "'q",
  '1.',
  'tRUE',
  'a;b|c\td',
];

const KEYS = ['id', 'name', 'ok', 'n', 'ключ', '2', '1', 'a b', 'x"y', 'p,q'];

const valueOf = (next: () => number, nested: boolean, depth = 0): string => {
  const roll = next();
  if (nested && depth < 3 && roll < 0.15) {
    const keys = [...KEYS].sort(() => next() - 0.5).slice(0, between(next, 1, 3));
    return `{${keys.map(k => `${JSON.stringify(k)}:${valueOf(next, nested, depth + 1)}`).join(',')}}`;
  }
  if (roll < 0.4) return pick(next, NUMBERS);
  if (roll < 0.5) return pick(next, ['true', 'false']);
  if (roll < 0.6) return 'null';
  return JSON.stringify(pick(next, PLAIN));
};

describe('properties', () => {
  it(
    'fuzz (§10): the writer and the reader agree on 5,000 tables, every delimiter, CRLF and LF',
    () => {
      for (let seed = 1; seed <= 5000; seed++) {
        const next = random(seed);
        const table = tableOf(next);
        const delimiter = pick(next, DELIMITERS);
        const newline = pick(next, ['\r\n', '\n'] as const);
        const options: ToCsvOptions = { ...DEFAULT_TO_CSV, delimiter, newline, protectFormulas: false };
        const written = jsonToCsv(JSON.stringify(table), options);
        expect(written.ok, `seed ${seed}`).toBe(true);
        if (!written.ok) continue;
        expect(fieldsOf(written.text, delimiter), `seed ${seed}`).toEqual(table);
        // With the guard on, the same fields — formula-like ones with their quote prefix.
        const guarded = jsonToCsv(JSON.stringify(table), { ...options, protectFormulas: true });
        const expected = table.map(row => row.map(f => (/^[=+\-@\t\r]/.test(f) ? `'${f}` : f)));
        expect(guarded.ok && fieldsOf(guarded.text, delimiter), `seed ${seed}`).toEqual(expected);
      }
    },
    SLOW,
  );

  it(
    'the delimiter rule (§5 «Разделитель») on 2,000 tables with commas, semicolons and pipes inside values',
    () => {
      const inside = [
        '1,5',
        'a;b',
        'x|y',
        'say "hi"',
        'Smith, J.',
        'k=v;w',
        'p|q|r',
        '',
        ' ',
        'Ann',
        '42',
        '2024-01-02',
      ];
      let right = 0;
      const wrong: number[] = [];
      for (let seed = 1; seed <= 2000; seed++) {
        const next = random(seed * 7919);
        const delimiter = pick(next, DELIMITERS);
        const columns = between(next, 2, 8);
        const table = Array.from({ length: between(next, 2, 30) }, (_, row) =>
          Array.from({ length: columns }, (_, c) => (row === 0 ? `col${c}` : pick(next, inside))),
        );
        if (detectDelimiter(writeTable(table, delimiter, pick(next, ['\r\n', '\n']))) === delimiter) right++;
        else wrong.push(seed);
      }
      // Measured: 2,000 of 2,000 (the specification's run: 1,999). A table is ambiguous only when another
      // delimiter also splits the first ten records evenly into more fields.
      expect(right, `wrong at seeds ${wrong.join(', ')}`).toBeGreaterThanOrEqual(1990);
      expect(right).toBe(2000);
    },
    SLOW,
  );

  it(
    'CSV → JSON → CSV gives the same table for any table of strings (Detect types off, Empty cells: Empty string)',
    () => {
      for (let seed = 1; seed <= 3000; seed++) {
        const next = random(seed * 31);
        const body = tableOf(next);
        const header = body[0]!.map((_, c) => `${pick(next, ['h', ' h ', '"q"', 'a,b', 'x\ny', '=f', '🙂'])}${c}`);
        const table = [header, ...body];
        const delimiter = pick(next, DELIMITERS);
        const toJson: ToJsonOptions = { ...DEFAULT_TO_JSON, delimiter, detectTypes: false, empty: 'string' };
        const json = csvToJson(writeTable(table, delimiter, pick(next, ['\r\n', '\n', '\r'])), toJson);
        expect(json.ok, `seed ${seed}`).toBe(true);
        if (!json.ok) continue;
        const back = jsonToCsv(json.text, { ...DEFAULT_TO_CSV, delimiter, protectFormulas: false });
        expect(back.ok && fieldsOf(back.text, delimiter), `seed ${seed}`).toEqual(table);
      }
    },
    SLOW,
  );

  it(
    'CSV → JSON → CSV with the default options changes only TRUE/True/FALSE/False to true/false (and adds the formula guard)',
    () => {
      const cells = [
        '42',
        '007',
        '1e5',
        '-0',
        '12345678901234567890',
        'TRUE',
        'True',
        'false',
        'FALSE',
        '',
        ' 42',
        'x',
        'a,b',
        '=1',
      ];
      for (let seed = 1; seed <= 1000; seed++) {
        const next = random(seed * 131);
        const body = tableOf(next, () => pick(next, cells));
        const table = [body[0]!.map((_, c) => `c${c}`), ...body];
        const json = csvToJson(writeTable(table, ',', '\n'), { ...DEFAULT_TO_JSON, delimiter: ',' });
        expect(json.ok, `seed ${seed}`).toBe(true);
        if (!json.ok) continue;
        const back = jsonToCsv(json.text, DEFAULT_TO_CSV);
        const expected = table.map((row, r) =>
          row.map(f =>
            r > 0 && /^(?:TRUE|True)$/.test(f)
              ? 'true'
              : r > 0 && /^(?:FALSE|False)$/.test(f)
                ? 'false'
                : r > 0 && f.startsWith('=')
                  ? `'${f}`
                  : f,
          ),
        );
        expect(back.ok && fieldsOf(back.text, ','), `seed ${seed}`).toEqual(expected);
      }
    },
    SLOW,
  );

  it(
    'JSON → CSV → JSON gives the same JSON where §5 promises it: flat, and nested with Nest dotted headers',
    () => {
      for (const nested of [false, true]) {
        for (let seed = 1; seed <= 1500; seed++) {
          const next = random(seed * 977 + (nested ? 1 : 0));
          // One shape for the table (which keys hold a nested object, and its keys), values drawn per row: every row
          // has every column, in one order, so the columns come back in that order.
          type Shape = Array<[string, Shape | null]>;
          const shapeOf = (depth: number): Shape =>
            [...KEYS]
              .sort(() => next() - 0.5)
              .slice(0, between(next, 1, depth === 0 ? 6 : 3))
              .map(k => [k, nested && depth < 3 && next() < 0.25 ? shapeOf(depth + 1) : null]);
          const fill = (shape: Shape): string =>
            `{${shape.map(([k, sub]) => `${JSON.stringify(k)}:${sub ? fill(sub) : valueOf(next, false)}`).join(',')}}`;
          const shape = shapeOf(0);
          const json = `[${Array.from({ length: between(next, 1, 6) }, () => fill(shape)).join(',')}]`;
          const csv = jsonToCsv(json, DEFAULT_TO_CSV);
          expect(csv.ok, `seed ${seed}`).toBe(true);
          if (!csv.ok) continue;
          expect(csv.notes.protectedCells, `seed ${seed}`).toBe(0);
          const back = csvToJson(csv.text, { ...DEFAULT_TO_JSON, delimiter: ',', nest: nested, layout: 'minify' });
          expect(back.ok && back.text, `seed ${seed}: ${json}`).toBe(json);
        }
      }
    },
    SLOW,
  );

  it(
    'JSON → CSV → JSON: whatever the tool does not say it lost comes back the same',
    () => {
      const anyValue = (next: () => number): string => {
        const roll = next();
        if (roll < 0.1) return pick(next, ['""', '"42"', '"TRUE"', '"1e5"', '"=x"', '"-1"']);
        if (roll < 0.2) return pick(next, ['[]', '[1,"a"]', '{}', '{"k":1}', '{"k":{"m":null}}']);
        return valueOf(next, false);
      };
      let silent = 0;
      for (let seed = 1; seed <= 4000; seed++) {
        const next = random(seed * 4243);
        const rows = Array.from({ length: between(next, 1, 5) }, () => {
          const keys = [...KEYS].sort(() => next() - 0.5).slice(0, between(next, 1, 5));
          return `{${keys.map(k => `${JSON.stringify(k)}:${anyValue(next)}`).join(',')}}`;
        });
        const json = `[${rows.join(',')}]`;
        const csv = jsonToCsv(json, DEFAULT_TO_CSV);
        expect(csv.ok, `seed ${seed}`).toBe(true);
        if (!csv.ok || describeLosses(csv.notes.lost) !== null || csv.notes.protectedCells > 0) continue;
        silent++;
        const back = csvToJson(csv.text, { ...DEFAULT_TO_JSON, delimiter: ',' });
        expect(back.ok && canonicalOf(back.text), `seed ${seed}: ${json}`).toBe(canonicalOf(json));
      }
      // The property is not empty: many tables lose nothing.
      expect(silent).toBeGreaterThan(400);
    },
    SLOW,
  );
});
