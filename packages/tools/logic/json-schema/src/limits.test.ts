/**
 * docs/tools/specs/json-schema.md §5 п. 32 and §12: many violations (kept to a bound, all copied), and the shape of the
 * work — linear in the document for validation, `uniqueItems` and the format checks — measured as growth, not
 * milliseconds (`@workspace/tools-shared/growth`).
 */
import { checkDocument } from './check';
import { compileSchemas } from './compile';
import { checkFormat } from './formats';
import { MAX_ROWS, MAX_VIOLATIONS, Session } from './run';
import { growth, GROWTH_BOUND } from '@workspace/tools-shared/growth';
import { parseJsonTree } from '@workspace/tools-shared/json-scan';
import { describe, expect, it } from 'vitest';
import type { JsonNode } from '@workspace/tools-shared/json-scan';

const RECORDS_SCHEMA =
  '{"type":"array","items":{"type":"object","required":["id","name"],"properties":{"id":{"type":"integer","minimum":0},"name":{"type":"string","maxLength":20},"tags":{"type":"array","items":{"type":"string"},"uniqueItems":true},"address":{"type":"object","properties":{"city":{"type":"string"},"zip":{"type":"string","pattern":"^[0-9]{5}$"}}}}}}';

const records = (n: number, bad = false): string =>
  `[${Array.from({ length: n }, (_, i) =>
    bad
      ? `{"id":"${i}","name":${i},"tags":["a","a"],"address":{"city":1,"zip":"x"}}`
      : `{"id":${i},"name":"user ${i}","tags":["a","b","c"],"address":{"city":"Paris","zip":"75001"}}`,
  ).join(',')}]`;

describe('many violations', () => {
  it('10,000 violations: all kept and copied; the page gets the first 1,000 rows', () => {
    const s = new Session();
    const doc = `[${Array.from({ length: 10_000 }, () => '"x"').join(',')}]`;
    const reply = s.validate({
      schemaKey: 1,
      schema: '{"items":{"type":"integer"}}',
      referenced: [],
      fallback: '2020-12',
      documentKey: 1,
      document: doc,
      formats: false,
    });
    expect(reply.outcome?.kind).toBe('checked');
    if (reply.outcome?.kind !== 'checked') return;
    expect(reply.outcome.count).toBe(10_000);
    expect(reply.outcome.rows).toHaveLength(MAX_ROWS);
    expect(reply.outcome.text.split('\n')).toHaveLength(10_000);
    expect(reply.outcome.truncated).toBe(false);
  });

  it(`past ${MAX_VIOLATIONS.toLocaleString('en-US')} the list stops and says so; validity is still decided`, () => {
    const s = new Session();
    const doc = `[${Array.from({ length: MAX_VIOLATIONS + 5 }, () => '0').join(',')}]`;
    const reply = s.validate({
      schemaKey: 1,
      schema: '{"items":{"type":"string"}}',
      referenced: [],
      fallback: '2020-12',
      documentKey: 1,
      document: doc,
      formats: false,
    });
    if (reply.outcome?.kind !== 'checked') throw new Error('not checked');
    expect(reply.outcome.valid).toBe(false);
    expect(reply.outcome.count).toBe(MAX_VIOLATIONS);
    expect(reply.outcome.truncated).toBe(true);
  });

  it('an edit of the document alone does not read the schema again (the session keeps it)', () => {
    const s = new Session();
    const base = {
      schemaKey: 1,
      schema: '{"type":"string"}',
      referenced: [],
      fallback: '2020-12' as const,
      formats: false,
    };
    s.validate({ ...base, documentKey: 1, document: '"a"' });
    const reply = s.validate({ schemaKey: 1, fallback: '2020-12', formats: false, documentKey: 2, document: '1' });
    expect(reply.outcome?.kind === 'checked' && reply.outcome.count).toBe(1);
  });
});

describe('the shape of the work', () => {
  const compiled = compileSchemas(RECORDS_SCHEMA, [], '2020-12');
  if (!compiled.ok) throw new Error('schema');
  const run = (doc: { tree: JsonNode; text: string }) =>
    checkDocument(compiled.compiled, doc.tree, doc.text, { formats: true, maxViolations: 1_000_000, maxCauses: 100 });
  const make = (bad: boolean) => (n: number) => {
    const text = records(n, bad);
    const read = parseJsonTree(text);
    if (!read.ok) throw new Error('doc');
    return { tree: read.tree, text };
  };

  it('validation is linear in the document (valid records)', () => {
    expect(growth(run, make(false), 1_000)).toBeLessThan(GROWTH_BOUND);
  });

  it('validation is linear in the document (every record broken five ways)', () => {
    expect(growth(run, make(true), 500)).toBeLessThan(GROWTH_BOUND);
  });

  it('uniqueItems hashes: linear in the number of items', () => {
    const unique = compileSchemas('{"uniqueItems":true}', [], '2020-12');
    if (!unique.ok) throw new Error('schema');
    const items = (n: number) => {
      const read = parseJsonTree(`[${Array.from({ length: n }, (_, i) => `{"a":${i},"b":[${i},"${i}"]}`).join(',')}]`);
      if (!read.ok) throw new Error('doc');
      return read.tree;
    };
    expect(
      growth(
        t => checkDocument(unique.compiled, t, '', { formats: false, maxViolations: 10, maxCauses: 10 }),
        items,
        2_000,
      ),
    ).toBeLessThan(GROWTH_BOUND);
  });

  it('every format check is linear on hostile strings', () => {
    const shapes = [
      (n: number) => 'a'.repeat(n),
      (n: number) => `${'a'.repeat(n)}!`,
      (n: number) => `/${'a/'.repeat(n / 2)}%`,
      (n: number) => `http://${'a@'.repeat(n / 2)}`,
      (n: number) => `${'1'.repeat(n)}-`,
    ];
    for (const f of [
      'date-time',
      'email',
      'hostname',
      'idn-hostname',
      'uri',
      'uri-reference',
      'iri',
      'iri-reference',
      'uri-template',
      'json-pointer',
      'duration',
      'ipv6',
    ]) {
      for (const shape of shapes) {
        const g = growth(s => checkFormat(f, s), shape, 20_000, { rounds: 3 });
        expect([f, shape(8), g < GROWTH_BOUND]).toEqual([f, shape(8), true]);
      }
    }
  });
});
