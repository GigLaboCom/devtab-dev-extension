/**
 * docs/tools/specs/json-schema.md §5 п. 39: every sample validates against the schema inferred from it — in all five
 * drafts, with every combination of the switches (Check formats on when Formats is), on generated samples. The source is
 * a seeded generator (mulberry32), so a failure reproduces.
 */
import { checkDocument } from './check';
import { compileSchemas } from './compile';
import { DRAFTS } from './drafts';
import { inferSchema } from './infer';
import { parseJsonValues } from '@workspace/tools-shared/json-scan';
import { describe, expect, it } from 'vitest';

const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const STRINGS = [
  'a',
  'on',
  'off',
  '',
  '2026-11-22T10:00:00Z',
  '2026-11-22',
  'a@example.com',
  '10.0.0.1',
  '::1',
  'https://example.com/x',
  '123e4567-e89b-12d3-a456-426614174000',
  'é😀',
  'x"y\\z',
];
const NUMBERS = ['0', '-0', '1', '1.0', '2.5', '-7', '1e2', '1E-2', '12345678901234567890', '0.1'];
const KEYS = ['id', 'name', 'tags', '10', '__proto__', 'a b', 'é', 'items', 'type'];

const generate = (rand: () => number, depth: number): string => {
  const r = rand();
  if (depth > 3 || r < 0.35) {
    const k = Math.floor(rand() * 4);
    if (k === 0) return JSON.stringify(STRINGS[Math.floor(rand() * STRINGS.length)]);
    if (k === 1) return NUMBERS[Math.floor(rand() * NUMBERS.length)]!;
    if (k === 2) return rand() < 0.5 ? 'true' : 'false';
    return 'null';
  }
  const n = Math.floor(rand() * 4);
  if (r < 0.65) {
    const keys = Array.from({ length: n }, () => KEYS[Math.floor(rand() * KEYS.length)]!);
    return `{${keys.map(k => `${JSON.stringify(k)}:${generate(rand, depth + 1)}`).join(',')}}`;
  }
  return `[${Array.from({ length: n }, () => generate(rand, depth + 1)).join(',')}]`;
};

describe('every sample validates against the schema inferred from it', () => {
  const rand = mulberry32(20261122);
  const sets = Array.from({ length: 300 }, () =>
    Array.from({ length: 1 + Math.floor(rand() * 3) }, () => generate(rand, 0)).join('\n'),
  );
  for (const draft of DRAFTS) {
    it(`${draft}: 300 sample sets × 8 switch combinations`, () => {
      let checked = 0;
      for (const text of sets) {
        const read = parseJsonValues(text);
        if (!read.ok) throw new Error(read.error.message);
        for (let mask = 0; mask < 8; mask++) {
          const options = { draft, enums: !!(mask & 1), formats: !!(mask & 2), closed: !!(mask & 4) };
          const { schema } = inferSchema(read.values, options);
          const compiled = compileSchemas(schema, [], draft);
          if (!compiled.ok) throw new Error(compiled.error.message);
          expect([text, options, compiled.problems.map(p => p.message)]).toEqual([text, options, []]);
          for (const sample of read.values) {
            const r = checkDocument(compiled.compiled, sample, text, {
              formats: options.formats,
              maxViolations: 5,
              maxCauses: 5,
            });
            expect([text, options, schema, r.ok && r.valid]).toEqual([text, options, schema, true]);
            checked++;
          }
        }
      }
      expect(checked).toBeGreaterThan(4_000);
    });
  }
});
