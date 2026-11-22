/**
 * The promise of docs/tools/specs/json-query.md §5 п. 24–25, on generated documents with a fixed seed: every node's
 * normalized path is in the RFC's form (the `normalized-path` grammar of RFC 9535 §2.7) and, run as a query on the same
 * document, selects exactly that node. Names cover what the escaping must get right: quotes, backslashes, every
 * control character, U+007F, U+2028, astral characters, the empty name, `__proto__`, digits. With repeated names the
 * path selects every member of that name, this node among them (§5 п. 11).
 */
import { evaluate } from './evaluate';
import { parseQuery } from './parse';
import { normalizedPath } from './paths';
import { readDocument } from './run';
import { describe, expect, it } from 'vitest';
import type { JsonNode } from '@workspace/tools-shared/json-scan';

/** mulberry32: a small seeded source, so a failure reproduces. */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Names as written in JSON (with their escapes). */
const NAMES = [
  'a',
  'b c',
  '',
  "'",
  '\\\\',
  '\\"',
  '\\/',
  '__proto__',
  '1',
  '0',
  'é',
  '\\u00e9',
  '😀',
  '\\ud83d\\ude00',
  '\u{7f}',
  '\u{2028}',
  '$',
  '@',
  '[',
  ']',
  '.',
  '*',
  '?',
  ...Array.from({ length: 32 }, (_, c) => `\\u${c.toString(16).padStart(4, '0')}`),
  '\\b\\f\\n\\r\\t',
  'it\'s \\"x\\"',
];
const NUMBERS = ['0', '-0', '1.0', '12345678901234567890', '1e400', '-2.5E-3', '7'];
const STRINGS = ['"x"', '""', '"\\u0000"', '"😀"', '"\\ud800"'];

const pathGrammar =
  /^\$(?:\[(?:'(?:[\x20-\x26\x28-\x5b\x5d-\u{d7ff}\u{e000}-\u{10ffff}]|\\(?:[bfnrt'\\]|u00(?:0[0-7bef]|1[0-9a-f])))*'|0|[1-9][0-9]*)\])*$/u;

const generate = (random: () => number, duplicates: boolean): string => {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
  const value = (depth: number): string => {
    const r = random();
    if (depth > 4 || r < 0.35) {
      const s = random();
      return s < 0.4 ? pick(NUMBERS) : s < 0.75 ? pick(STRINGS) : pick(['true', 'false', 'null']);
    }
    const size = Math.floor(random() * 5);
    if (r < 0.65) return `[${Array.from({ length: size }, () => value(depth + 1)).join(',')}]`;
    const names = new Set<string>();
    const members: string[] = [];
    for (let k = 0; k < size; k++) {
      const name = pick(NAMES);
      // Unique by the decoded name: "😀" and "\ud83d\ude00" are one name (the test's own constants, never input).
      const decoded = JSON.parse(`"${name}"`) as string;
      if (!duplicates && names.has(decoded)) continue;
      names.add(decoded);
      members.push(`"${name}":${value(depth + 1)}`);
    }
    return `{${members.join(',')}}`;
  };
  return value(0);
};

const all = (root: JsonNode) => {
  const parsed = parseQuery('$..*');
  if (!parsed.ok) throw new Error();
  const r = evaluate(parsed.query, root);
  if (!r.ok) throw new Error();
  return [{ value: root, parent: null, step: '' }, ...r.nodes];
};

describe('normalized paths', () => {
  it('are the RFC’s form and select exactly their node (2,000 documents, unique names)', () => {
    const random = seeded(9535);
    let checked = 0;
    for (let doc = 0; doc < 2000; doc++) {
      const text = generate(random, false);
      const read = readDocument(text);
      if (!read.ok) throw new Error(`${text}: ${read.error.message}`);
      for (const node of all(read.root)) {
        const path = normalizedPath(node);
        // A name with a lone surrogate has no form in the grammar (§5 п. 25): only the documents' strings hold one here.
        expect(path, text).toMatch(pathGrammar);
        const parsed = parseQuery(path);
        if (!parsed.ok) throw new Error(`${path}: ${parsed.error.message}`);
        const back = evaluate(parsed.query, read.root);
        if (!back.ok) throw new Error(back.message);
        expect(back.nodes.length, `${text} ${path}`).toBe(1);
        expect(back.nodes[0]!.value === node.value, `${text} ${path}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10_000);
  });

  it('with repeated names select every member of the name, the node among them', () => {
    const random = seeded(8259);
    for (let doc = 0; doc < 500; doc++) {
      const text = generate(random, true);
      const read = readDocument(text);
      if (!read.ok) throw new Error(`${text}: ${read.error.message}`);
      for (const node of all(read.root)) {
        const parsed = parseQuery(normalizedPath(node));
        if (!parsed.ok) throw new Error(parsed.error.message);
        const back = evaluate(parsed.query, read.root);
        if (!back.ok) throw new Error(back.message);
        expect(back.nodes.some(n => n.value === node.value)).toBe(true);
      }
    }
  });
});
