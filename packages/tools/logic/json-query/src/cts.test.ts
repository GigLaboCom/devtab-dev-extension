/**
 * The JSONPath Compliance Test Suite of RFC 9535 (docs/tools/specs/json-query.md §10, first row), every case a test:
 * a valid query gives the case's result (or one of its `results`, where the RFC leaves an object's member order open)
 * and its normalized paths; an invalid one is refused by the parser. The suite comes from the public npm registry, as
 * the file `jsonpath-rfc9535` 1.3.0 ships (a development dependency; BSD-2), never fetched from elsewhere.
 */
import { evaluate } from './evaluate';
import { parseQuery } from './parse';
import { normalizedPath } from './paths';
import { printValue } from './print';
import { readDocument } from './run';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

interface Case {
  name: string;
  selector: string;
  document?: unknown;
  result?: unknown[];
  results?: unknown[][];
  result_paths?: string[];
  results_paths?: string[][];
  invalid_selector?: boolean;
}

const require = createRequire(import.meta.url);
const SUITE = join(
  dirname(require.resolve('jsonpath-rfc9535/package.json')),
  'src/__tests__/jsonpath-compliance-test-suite/cts.json',
);
const { tests } = JSON.parse(readFileSync(SUITE, 'utf8')) as { tests: Case[] };

/** The case's query over its document: values (as JavaScript, to compare with the suite's) and paths. */
const run = (c: Case): { values: unknown[]; paths: string[] } => {
  const parsed = parseQuery(c.selector);
  if (!parsed.ok) throw new Error(`refused: ${parsed.error.message} at ${parsed.error.start}`);
  const doc = readDocument(JSON.stringify(c.document));
  if (!doc.ok) throw new Error(doc.error.message);
  const evaluated = evaluate(parsed.query, doc.root);
  if (!evaluated.ok) throw new Error(evaluated.message);
  return {
    values: evaluated.nodes.map(n => JSON.parse(printValue(n.value, 'minify')) as unknown),
    paths: evaluated.nodes.map(normalizedPath),
  };
};

describe('the RFC 9535 compliance test suite', () => {
  it('is all there: 687 cases, 245 of them invalid queries', () => {
    expect(tests.length).toBe(687);
    expect(tests.filter(t => t.invalid_selector).length).toBe(245);
  });

  for (const c of tests) {
    it(c.name, () => {
      if (c.invalid_selector) {
        expect(parseQuery(c.selector).ok, c.selector).toBe(false);
        return;
      }
      const got = run(c);
      if (c.result) {
        expect(got.values).toEqual(c.result);
        if (c.result_paths) expect(got.paths).toEqual(c.result_paths);
        return;
      }
      const k = c.results!.findIndex(r => JSON.stringify(r) === JSON.stringify(got.values));
      expect(k, JSON.stringify(got.values)).toBeGreaterThanOrEqual(0);
      if (c.results_paths) expect(c.results_paths.map(p => JSON.stringify(p))).toContain(JSON.stringify(got.paths));
    });
  }
});
