/**
 * docs/tools/specs/json-schema.md §10 and §6: every keyword's sentence with both places, the exact numbers, references
 * that are never fetched, loops, the meta-schema check, repeated keys, detect (§7) and inference (§5 п. 33–38).
 */
import { checkDocument, TOO_DEEP } from './check';
import { compileSchemas } from './compile';
import { compareNumbers, isIntegerValue, isMultipleOf, toDecimal } from './decimal';
import { detectJsonSchema } from './detect';
import { DRAFTS, draftOfUri } from './drafts';
import { checkFormat } from './formats';
import { violationsText } from './messages';
import { runInference, Session } from './run';
import { resolveUri } from './uri';
import { parseJsonTree } from '@workspace/tools-shared/json-scan';
import { describe, expect, it } from 'vitest';
import type { Violation } from './check';
import type { Draft } from './drafts';

const check = (
  schema: string,
  document: string,
  draft: Draft = '2020-12',
  formats = false,
  referenced: string[] = [],
) => {
  const compiled = compileSchemas(schema, referenced, draft);
  if (!compiled.ok) throw new Error(`schema does not parse: ${compiled.error.message}`);
  if (compiled.problems.length > 0)
    throw new Error(`schema problems: ${compiled.problems.map(p => p.message).join('; ')}`);
  const doc = parseJsonTree(document);
  if (!doc.ok) throw new Error(doc.error.message);
  const r = checkDocument(compiled.compiled, doc.tree, document, { formats, maxViolations: 100_000, maxCauses: 100 });
  if (!r.ok) throw new Error(r.message);
  return r;
};

const one = (schema: string, document: string, draft: Draft = '2020-12', formats = false): Violation => {
  const r = check(schema, document, draft, formats);
  expect(r.valid).toBe(false);
  expect(r.violations).toHaveLength(1);
  return r.violations[0]!;
};

const problems = (schema: string, draft: Draft = '2020-12', referenced: string[] = []) => {
  const compiled = compileSchemas(schema, referenced, draft);
  if (!compiled.ok) throw new Error(compiled.error.message);
  return compiled.problems;
};

describe('§6: the sentence of every keyword, with its places', () => {
  // [draft, schema, document, message, instanceLocation, keywordLocation]
  const rows: Array<[Draft, string, string, string, string, string]> = [
    ['2020-12', 'false', '1', 'No value is allowed here: the schema is false.', '', '#'],
    ['2020-12', '{"type":"integer"}', '"8080"', 'Expected an integer, got the string "8080".', '', '#/type'],
    ['2020-12', '{"type":"integer"}', '1.5', 'Expected an integer, got 1.5.', '', '#/type'],
    ['2020-12', '{"type":["string","null"]}', '{}', 'Expected a string or null, got an object.', '', '#/type'],
    [
      '2020-12',
      '{"type":["string","number","null"]}',
      '[]',
      'Expected a string, a number or null, got an array.',
      '',
      '#/type',
    ],
    ['2020-12', '{"type":"boolean"}', 'null', 'Expected a boolean, got null.', '', '#/type'],
    ['2020-12', '{"type":"object"}', 'true', 'Expected an object, got true.', '', '#/type'],
    ['2020-12', '{"enum":["a","b",3]}', '"c"', 'Must be one of: "a", "b", 3.', '', '#/enum'],
    [
      '2020-12',
      '{"enum":[1,2,3,4,5,6,7,8,9,10,11,12]}',
      '0',
      'Must be one of: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 … and 2 more.',
      '',
      '#/enum',
    ],
    ['2020-12', '{"const":{"a":[1,2]}}', '{"a":[1]}', 'Must be exactly {"a":[1,2]}.', '', '#/const'],
    ['2020-12', '{"minimum":5}', '3', 'Must be at least 5, got 3.', '', '#/minimum'],
    ['2020-12', '{"maximum":10}', '12', 'Must be at most 10, got 12.', '', '#/maximum'],
    ['2020-12', '{"exclusiveMinimum":5}', '5', 'Must be greater than 5, got 5.', '', '#/exclusiveMinimum'],
    ['2020-12', '{"exclusiveMaximum":10}', '10', 'Must be less than 10, got 10.', '', '#/exclusiveMaximum'],
    [
      'draft-04',
      '{"minimum":5,"exclusiveMinimum":true}',
      '5',
      'Must be greater than 5, got 5.',
      '',
      '#/exclusiveMinimum',
    ],
    [
      'draft-04',
      '{"maximum":10,"exclusiveMaximum":true}',
      '10',
      'Must be less than 10, got 10.',
      '',
      '#/exclusiveMaximum',
    ],
    ['2020-12', '{"multipleOf":0.01}', '0.105', 'Must be a multiple of 0.01, got 0.105.', '', '#/multipleOf'],
    ['2020-12', '{"minLength":3}', '"ab"', 'Must be at least 3 characters long, got 2.', '', '#/minLength'],
    ['2020-12', '{"maxLength":1}', '"ab"', 'Must be at most 1 character long, got 2.', '', '#/maxLength'],
    ['2020-12', '{"pattern":"^[a-z]+$"}', '"A1"', 'Must match the pattern ^[a-z]+$.', '', '#/pattern'],
    ['2020-12', '{"minItems":2}', '[1]', 'Must have at least 2 items, got 1.', '', '#/minItems'],
    ['2020-12', '{"maxItems":1}', '[1,2]', 'Must have at most 1 item, got 2.', '', '#/maxItems'],
    [
      '2020-12',
      '{"uniqueItems":true}',
      '[1,2,1.0]',
      'Items 0 and 2 are equal: every item must be different.',
      '/2',
      '#/uniqueItems',
    ],
    [
      '2020-12',
      '{"contains":{"type":"string"}}',
      '[1,2]',
      'Must contain an item that matches the contains schema; none of the 2 does.',
      '',
      '#/contains',
    ],
    [
      '2020-12',
      '{"contains":{"type":"string"},"minContains":2}',
      '["a",1]',
      'Must contain at least 2 items that match the contains schema, got 1.',
      '',
      '#/minContains',
    ],
    [
      '2020-12',
      '{"contains":{"type":"string"},"maxContains":1}',
      '["a","b"]',
      'Must contain at most 1 item that matches the contains schema, got 2.',
      '',
      '#/maxContains',
    ],
    [
      '2020-12',
      '{"prefixItems":[{}],"items":false}',
      '[1,2]',
      'Item 1 is not allowed: the array may hold 1 item here.',
      '/1',
      '#/items',
    ],
    [
      '2019-09',
      '{"items":[{},{}],"additionalItems":false}',
      '[1,2,3]',
      'Item 2 is not allowed: the array may hold 2 items here.',
      '/2',
      '#/additionalItems',
    ],
    ['2020-12', '{"items":{"type":"string"}}', '["a",1]', 'Expected a string, got 1.', '/1', '#/items/type'],
    [
      '2020-12',
      '{"prefixItems":[{"type":"string"}]}',
      '[1]',
      'Expected a string, got 1.',
      '/0',
      '#/prefixItems/0/type',
    ],
    [
      '2020-12',
      '{"prefixItems":[{}],"unevaluatedItems":false}',
      '[1,2]',
      'Item 1 is not allowed: no keyword evaluates it and unevaluatedItems is false.',
      '/1',
      '#/unevaluatedItems',
    ],
    ['2020-12', '{"required":["name"]}', '{}', 'Missing required property "name".', '', '#/required'],
    [
      '2020-12',
      '{"properties":{"a":{}},"additionalProperties":false}',
      '{"a":1,"x":2}',
      'Property "x" is not allowed: additionalProperties is false.',
      '/x',
      '#/additionalProperties',
    ],
    [
      '2020-12',
      '{"additionalProperties":{"type":"string"}}',
      '{"x":2}',
      'Expected a string, got 2.',
      '/x',
      '#/additionalProperties/type',
    ],
    [
      '2020-12',
      '{"properties":{"a":{}},"unevaluatedProperties":false}',
      '{"a":1,"x":2}',
      'Property "x" is not allowed: no keyword evaluates it and unevaluatedProperties is false.',
      '/x',
      '#/unevaluatedProperties',
    ],
    [
      '2020-12',
      '{"propertyNames":{"pattern":"^[a-z]+$"}}',
      '{"Foo":1}',
      'Property name "Foo": Must match the pattern ^[a-z]+$.',
      '/Foo',
      '#/propertyNames/pattern',
    ],
    ['2020-12', '{"minProperties":1}', '{}', 'Must have at least 1 property, got 0.', '', '#/minProperties'],
    ['2020-12', '{"maxProperties":1}', '{"a":1,"b":2}', 'Must have at most 1 property, got 2.', '', '#/maxProperties'],
    [
      '2020-12',
      '{"dependentRequired":{"credit_card":["billing"]}}',
      '{"credit_card":1}',
      'Property "billing" is required when "credit_card" is present.',
      '',
      '#/dependentRequired/credit_card',
    ],
    [
      'draft-07',
      '{"dependencies":{"credit_card":["billing"]}}',
      '{"credit_card":1}',
      'Property "billing" is required when "credit_card" is present.',
      '',
      '#/dependencies/credit_card',
    ],
    [
      'draft-07',
      '{"dependencies":{"a":{"required":["b"]}}}',
      '{"a":1}',
      'Missing required property "b".',
      '',
      '#/dependencies/a/required',
    ],
    [
      '2020-12',
      '{"dependentSchemas":{"a":{"required":["b"]}}}',
      '{"a":1}',
      'Missing required property "b".',
      '',
      '#/dependentSchemas/a/required',
    ],
    ['2020-12', '{"not":{"type":"string"}}', '"a"', 'Must not match the schema in not.', '', '#/not'],
    [
      '2020-12',
      '{"oneOf":[{"type":"integer"},{"minimum":0}]}',
      '1',
      'Must match exactly one schema in oneOf; it matches 2: 0, 1.',
      '',
      '#/oneOf',
    ],
    ['2020-12', '{"allOf":[{"type":"string"}]}', '1', 'Expected a string, got 1.', '', '#/allOf/0/type'],
    [
      '2020-12',
      '{"if":{"type":"string"},"then":{"minLength":2},"else":{"minimum":0}}',
      '"a"',
      'Must be at least 2 characters long, got 1.',
      '',
      '#/then/minLength',
    ],
    [
      '2020-12',
      '{"if":{"type":"string"},"else":{"minimum":0}}',
      '-1',
      'Must be at least 0, got -1.',
      '',
      '#/else/minimum',
    ],
    [
      '2020-12',
      '{"$defs":{"a":{"type":"string"}},"$ref":"#/$defs/a"}',
      '1',
      'Expected a string, got 1.',
      '',
      '#/$ref/type',
    ],
    [
      '2020-12',
      '{"$dynamicAnchor":"n","properties":{"x":{"$dynamicRef":"#n"}},"type":"object"}',
      '{"x":1}',
      'Expected an object, got 1.',
      '/x',
      '#/properties/x/$dynamicRef/type',
    ],
    [
      '2019-09',
      '{"$recursiveAnchor":true,"type":"object","properties":{"x":{"$recursiveRef":"#"}}}',
      '{"x":1}',
      'Expected an object, got 1.',
      '/x',
      '#/properties/x/$recursiveRef/type',
    ],
    ['2020-12', '{"format":"email"}', '"no-at"', 'Is not a valid email address (format "email").', '', '#/format'],
  ];
  for (const [draft, schema, document, message, where, keyword] of rows) {
    it(`${draft} ${schema} / ${document}`, () => {
      const v = one(schema, document, draft, schema.includes('format'));
      expect(v.message).toBe(message);
      expect(v.instanceLocation).toBe(where);
      expect(v.keywordLocation).toBe(keyword);
    });
  }

  it('anyOf with two branches that both fail on the type: the anyOf sentence and its causes', () => {
    const v = one('{"anyOf":[{"type":"string"},{"type":"null"}]}', '5');
    expect(v.message).toBe('Must match at least one schema in anyOf; it matches none of the 2.');
    expect(v.keywordLocation).toBe('#/anyOf');
    expect(v.causes?.map(c => [c.message, c.keywordLocation])).toEqual([
      ['Expected a string, got 5.', '#/anyOf/0/type'],
      ['Expected null, got 5.', '#/anyOf/1/type'],
    ]);
  });

  it('oneOf with no match: the oneOf sentence and its causes', () => {
    const v = one('{"oneOf":[{"const":"a"},{"const":"b"}]}', '"c"');
    expect(v.message).toBe('Must match exactly one schema in oneOf; it matches none of the 2.');
    expect(v.causes?.map(c => c.message)).toEqual(['Must be exactly "a".', 'Must be exactly "b".']);
  });

  it('anyOf where one branch has the right type: that branch speaks (§5 п. 30)', () => {
    const v = one('{"anyOf":[{"type":"string","minLength":3},{"type":"null"}]}', '"ab"');
    expect(v.message).toBe('Must be at least 3 characters long, got 2.');
    expect(v.keywordLocation).toBe('#/anyOf/0/minLength');
  });

  it('a violation names the line and column of the place; Copy violations writes one per line', () => {
    const doc = '{\n  "a": 1,\n  "port": "8080"\n}';
    const r = check('{"properties":{"port":{"type":"integer"}}}', doc);
    expect(r.violations[0]).toMatchObject({ instanceLocation: '/port', line: 3, column: 11 });
    expect(violationsText(r.violations)).toBe(
      '/port (line 3, column 11): Expected an integer, got the string "8080". [#/properties/port/type]',
    );
  });

  it('violations come in document order, causes indented in the copy', () => {
    const r = check('{"items":{"anyOf":[{"type":"string"},{"type":"null"}]}}', '[1, "a", 2]');
    expect(r.violations.map(v => v.instanceLocation)).toEqual(['/0', '/2']);
    expect(violationsText(r.violations).split('\n')).toEqual([
      '/0 (line 1, column 2): Must match at least one schema in anyOf; it matches none of the 2. [#/items/anyOf]',
      '  /0 (line 1, column 2): Expected a string, got 1. [#/items/anyOf/0/type]',
      '  /0 (line 1, column 2): Expected null, got 1. [#/items/anyOf/1/type]',
      '/2 (line 1, column 10): Must match at least one schema in anyOf; it matches none of the 2. [#/items/anyOf]',
      '  /2 (line 1, column 10): Expected a string, got 2. [#/items/anyOf/0/type]',
      '  /2 (line 1, column 10): Expected null, got 2. [#/items/anyOf/1/type]',
    ]);
  });

  it('a long string is cut at 40 characters in a sentence', () => {
    const v = one('{"type":"integer"}', JSON.stringify('x'.repeat(100)));
    expect(v.message).toBe(`Expected an integer, got the string "${'x'.repeat(40)}…".`);
  });
});

describe('§5 п. 14–18: exact numbers', () => {
  it('multipleOf is exact', () => {
    expect(check('{"multipleOf":0.1}', '0.3').valid).toBe(true);
    expect(check('{"multipleOf":0.0001}', '0.0075').valid).toBe(true);
    expect(check('{"multipleOf":0.01}', '0.1').valid).toBe(true);
    expect(check('{"multipleOf":0.01}', '0.105').valid).toBe(false);
    expect(check('{"multipleOf":0.5}', '1e308').valid).toBe(true);
    expect(check('{"multipleOf":3}', '1e400').valid).toBe(false);
    expect(check('{"multipleOf":2}', '1e400').valid).toBe(true);
    expect(check('{"multipleOf":1e-400}', '1').valid).toBe(true);
    expect(check('{"multipleOf":0.123456789}', '1e308').valid).toBe(false);
  });

  it('isMultipleOf does not blow up on far exponents', () => {
    expect(isMultipleOf(toDecimal('1e999999999'), toDecimal('7'))).toBe(false);
    expect(isMultipleOf(toDecimal('1e999999999'), toDecimal('1024'))).toBe(true);
    expect(isMultipleOf(toDecimal('3e-999999999'), toDecimal('1'))).toBe(false);
  });

  it('comparisons are exact beyond the double range', () => {
    expect(one('{"maximum":12345678901234567890}', '12345678901234567891').message).toBe(
      'Must be at most 12345678901234567890, got 12345678901234567891.',
    );
    expect(check('{"maximum":12345678901234567891}', '12345678901234567891').valid).toBe(true);
    expect(check('{"minimum":1e399}', '1e400').valid).toBe(true);
    expect(check('{"exclusiveMinimum":0}', '1e-400').valid).toBe(true);
    expect(compareNumbers('1.0', '1')).toBe(0);
    expect(compareNumbers('-0', '0')).toBe(0);
    expect(compareNumbers('10e-1', '1e0')).toBe(0);
    expect(compareNumbers('-2', '-10')).toBe(1);
  });

  it('const, enum and uniqueItems compare numbers by value', () => {
    expect(check('{"const":1}', '1.0').valid).toBe(true);
    expect(check('{"enum":[18446744073709551616]}', '18446744073709551617').valid).toBe(false);
    expect(check('{"enum":[18446744073709551616]}', '18446744073709551616.0').valid).toBe(true);
    expect(one('{"uniqueItems":true}', '[1, 1.0]').message).toBe(
      'Items 0 and 1 are equal: every item must be different.',
    );
    expect(check('{"uniqueItems":true}', '[12345678901234567890, 12345678901234567891]').valid).toBe(true);
    expect(check('{"uniqueItems":true}', '[{"a":1,"b":2}, {"b":2,"a":1.0}]').valid).toBe(false);
  });

  it('integer: draft 4 by the literal, later drafts by the value', () => {
    expect(check('{"type":"integer"}', '1.0', 'draft-04').valid).toBe(false);
    expect(check('{"type":"integer"}', '1.0', 'draft-07').valid).toBe(true);
    expect(check('{"type":"integer"}', '1e2', '2020-12').valid).toBe(true);
    expect(check('{"type":"integer"}', '1e-2', '2020-12').valid).toBe(false);
    expect(isIntegerValue('12345678901234567890', 'draft-04')).toBe(true);
  });

  it('string lengths count code points', () => {
    expect(check('{"maxLength":1}', '"😀"').valid).toBe(true);
    expect(check('{"minLength":2}', '"😀"').valid).toBe(false);
  });
});

describe('§5 п. 6: repeated keys', () => {
  it('every value of a repeated key is checked, and the note says so', () => {
    const r = check('{"properties":{"id":{"type":"integer"}}}', '{"id": 1, "id": "x"}');
    expect(r.violations.map(v => [v.instanceLocation, v.message, v.column])).toEqual([
      ['/id', 'Expected an integer, got the string "x".', 17],
    ]);
    const s = new Session();
    const reply = s.validate({
      schemaKey: 1,
      schema: '{}',
      referenced: [],
      fallback: '2020-12',
      documentKey: 1,
      document: '{"id": 1, "id": "x"}',
      formats: false,
    });
    expect(reply.document).toEqual({
      state: 'ok',
      notes: ['Duplicate key "id" at line 1, column 11: every value is checked.'],
    });
  });

  it('counts and required go by distinct names', () => {
    expect(check('{"maxProperties":1}', '{"a":1,"a":2}').valid).toBe(true);
  });

  it('a repeated key in the schema is a problem of the schema', () => {
    expect(problems('{"type":"string","type":"number"}').map(p => p.message)).toEqual([
      'Duplicate key "type" at line 1, column 18: a schema keyword must appear once.',
    ]);
  });
});

describe('§5 п. 7–13: references, never fetched; loops', () => {
  it('a remote reference is a problem until its schema is pasted', () => {
    expect(problems('{"$ref":"https://example.com/a.json"}').map(p => p.message)).toEqual([
      'The reference https://example.com/a.json could not be resolved: schemas are never fetched. Add it under Referenced schemas with "$id": "https://example.com/a.json".',
    ]);
    const r = check('{"$ref":"https://example.com/a.json"}', '1', '2020-12', false, [
      '{"$id":"https://example.com/a.json","type":"string"}',
    ]);
    expect(r.violations[0]).toMatchObject({
      message: 'Expected a string, got 1.',
      keywordLocation: '#/$ref/type',
      absoluteKeywordLocation: 'https://example.com/a.json#/type',
    });
  });

  it('a fragment of a pasted schema and a relative reference against $id', () => {
    const r = check(
      '{"$id":"https://example.com/root.json","properties":{"a":{"$ref":"defs.json#/$defs/n"}}}',
      '{"a":"x"}',
      '2020-12',
      false,
      ['{"$id":"https://example.com/defs.json","$defs":{"n":{"type":"number"}}}'],
    );
    expect(r.violations[0]?.message).toBe('Expected a number, got the string "x".');
  });

  it('a reference to nothing inside the schema', () => {
    expect(problems('{"$ref":"#/$defs/nope"}').map(p => p.message)).toEqual([
      'The reference #/$defs/nope points to nothing in the schema.',
    ]);
  });

  it('the meta-schemas resolve without the network', () => {
    expect(check('{"$ref":"https://json-schema.org/draft/2020-12/schema"}', '{"type":"strnig"}').valid).toBe(false);
    expect(check('{"$ref":"http://json-schema.org/draft-07/schema#"}', '{"type":"string"}').valid).toBe(true);
  });

  it('a pasted schema without $id, and two with one $id', () => {
    const s = new Session();
    const reply = s.validate({
      schemaKey: 1,
      schema: '{}',
      referenced: ['{"type":"string"}', '{"$id":"https://example.com/a"}', '{"$id":"https://example.com/a"}'],
      fallback: '2020-12',
      documentKey: 1,
      document: '1',
      formats: false,
    });
    expect(reply.schema.state === 'ok' && reply.schema.referenced.map(r => r.note)).toEqual([
      'This schema has no "$id": a reference cannot find it.',
      null,
      'Two referenced schemas have the "$id" https://example.com/a: the first one is used.',
    ]);
  });

  it('a schema that refers to itself without moving into the document stops with a problem', () => {
    const compiled = compileSchemas('{"$ref":"#"}', [], '2020-12');
    if (!compiled.ok) throw new Error('parse');
    const doc = parseJsonTree('1');
    if (!doc.ok) throw new Error('parse');
    expect(
      checkDocument(compiled.compiled, doc.tree, '1', { formats: false, maxViolations: 10, maxCauses: 10 }),
    ).toEqual({
      ok: false,
      message: 'The schema refers to itself in a loop at #: it never moves into the document.',
    });
  });

  it('recursion that moves into the document is fine to a depth of 400; deeper it stops with a message (§12)', () => {
    const doc = '['.repeat(400) + ']'.repeat(400);
    expect(check('{"type":"array","items":{"$ref":"#"}}', doc).valid).toBe(true);
    const compiled = compileSchemas('{"type":"array","items":{"$ref":"#"}}', [], '2020-12');
    const deep = parseJsonTree('['.repeat(999) + ']'.repeat(999));
    if (!compiled.ok || !deep.ok) throw new Error('parse');
    expect(
      checkDocument(compiled.compiled, deep.tree, '', { formats: false, maxViolations: 10, maxCauses: 10 }),
    ).toEqual({
      ok: false,
      message: TOO_DEEP,
    });
    const bad = '['.repeat(500) + '1' + ']'.repeat(500);
    const r = check('{"type":"array","items":{"$ref":"#"}}', bad);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]?.instanceLocation).toBe('/0'.repeat(500));
  });

  it('resolveUri follows RFC 3986 §5.4', () => {
    const base = 'http://a/b/c/d;p?q';
    for (const [ref, target] of [
      ['g', 'http://a/b/c/g'],
      ['./g', 'http://a/b/c/g'],
      ['g/', 'http://a/b/c/g/'],
      ['/g', 'http://a/g'],
      ['//g', 'http://g'],
      ['?y', 'http://a/b/c/d;p?y'],
      ['#s', 'http://a/b/c/d;p?q#s'],
      ['', 'http://a/b/c/d;p?q'],
      ['../g', 'http://a/b/g'],
      ['../../g', 'http://a/g'],
      ['../../../g', 'http://a/g'],
      ['g;x=1/../y', 'http://a/b/c/y'],
    ])
      expect(resolveUri(ref!, base)).toBe(target);
    expect(resolveUri('#foo', 'urn:example:root')).toBe('urn:example:root#foo');
  });
});

describe('§5 п. 1–2, 30: drafts and the meta-schema check', () => {
  it('reads the draft from $schema, http or https, with or without #', () => {
    expect(draftOfUri('https://json-schema.org/draft/2020-12/schema')).toBe('2020-12');
    expect(draftOfUri('http://json-schema.org/draft-07/schema#')).toBe('draft-07');
    expect(draftOfUri('https://json-schema.org/draft-07/schema')).toBe('draft-07');
    expect(draftOfUri('https://example.com/meta')).toBeNull();
  });

  it('says where the draft came from', () => {
    const a = compileSchemas('{"$schema":"http://json-schema.org/draft-04/schema#"}', [], '2020-12');
    const b = compileSchemas('{}', [], 'draft-07');
    expect(a.ok && a.draftLine).toBe('Draft 4 (from $schema).');
    expect(b.ok && b.draftLine).toBe('Draft 7 (no $schema: the draft chosen above).');
  });

  it('an unknown $schema is read as the chosen draft, with a note', () => {
    const c = compileSchemas('{"$schema":"https://example.com/meta","type":"string"}', [], '2020-12');
    expect(c.ok && c.notes).toEqual([
      'The $schema https://example.com/meta is neither a draft this tool knows nor a referenced schema: the schema is read as draft 2020-12, the draft chosen above.',
    ]);
  });

  it('a schema that fails its meta-schema: the leaf problem, with its place in the schema', () => {
    const p = problems('{\n  "type": "strnig"\n}');
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({
      instanceLocation: '/type',
      message: 'Must be one of: "array", "boolean", "integer", "null", "number", "object", "string".',
    });
    expect(problems('{"minLength":-1}').map(x => [x.instanceLocation, x.message])).toEqual([
      ['/minLength', 'Must be at least 0, got -1.'],
    ]);
    expect(problems('{"required":"a"}', 'draft-07').map(x => [x.instanceLocation, x.message])).toEqual([
      ['/required', 'Expected an array, got the string "a".'],
    ]);
  });

  it('a schema that is not a schema', () => {
    expect(problems('[1]').map(p => p.message)).toEqual(['A schema is an object or true or false, not an array.']);
  });

  it('an invalid pattern is a problem of the schema', () => {
    expect(problems('{"pattern":"("}')[0]?.message).toMatch(/^The pattern "\(" is not a valid regular expression: /);
  });

  it('every draft checks a simple schema against its own meta-schema', () => {
    for (const d of DRAFTS) expect(problems('{"type":"object","properties":{"a":{"type":"string"}}}', d)).toEqual([]);
  });
});

describe('§5 п. 24: formats', () => {
  it('format is an annotation unless Check formats is on', () => {
    expect(check('{"format":"email"}', '"no-at"').valid).toBe(true);
    expect(check('{"format":"email"}', '"no-at"', '2020-12', true).valid).toBe(false);
    expect(check('{"format":"unknown-format"}', '"x"', '2020-12', true).valid).toBe(true);
  });

  it('the checks', () => {
    const yes: Array<[string, string]> = [
      ['date-time', '2026-11-22T10:00:00Z'],
      ['date-time', '1990-12-31T23:59:60Z'],
      ['date', '2024-02-29'],
      ['time', '10:00:00+03:00'],
      ['duration', 'P1Y2M3DT4H5M6S'],
      ['email', 'a.b@example.com'],
      ['hostname', 'example.com'],
      ['ipv4', '192.168.0.1'],
      ['ipv6', '::ffff:192.168.0.1'],
      ['uri', 'https://example.com/a?b#c'],
      ['uri-reference', '../a'],
      ['uri-template', 'https://example.com/{id}{?q,lang}'],
      ['json-pointer', '/a~1b/0'],
      ['relative-json-pointer', '1/a'],
      ['regex', '^[a-z]+$'],
      ['uuid', '123e4567-e89b-12d3-a456-426614174000'],
      ['idn-hostname', 'пример.рф'],
    ];
    const no: Array<[string, string]> = [
      ['date-time', '2026-11-22 10:00:00Z'],
      ['date', '2023-02-29'],
      ['time', '24:00:00Z'],
      ['duration', 'P1H'],
      ['email', '.a@example.com'],
      ['hostname', '-a.example.com'],
      ['ipv4', '192.168.0.01'],
      ['ipv6', '1::2::3'],
      ['uri', '/relative'],
      ['json-pointer', 'a'],
      ['regex', '('],
      ['uuid', '123e4567e89b12d3a456426614174000'],
    ];
    for (const [f, v] of yes) expect([f, v, checkFormat(f, v)]).toEqual([f, v, true]);
    for (const [f, v] of no) expect([f, v, checkFormat(f, v)]).toEqual([f, v, false]);
  });
});

describe('§7: detect', () => {
  it.each([
    ['{"$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object"}', true],
    ['{"$schema": "http://json-schema.org/draft-07/schema#", "type": "string"}', true],
    ['  {"$schema": "http://json-schema.org/draft-04/schema#"}\n', true],
    ['{"type": "object", "properties": {"a": {}}}', false],
    ['{"$schema": "https://example.com/my-meta"}', false],
    ['{"$schema": 1}', false],
    ['{"a": {"$schema": "https://json-schema.org/draft/2020-12/schema"}}', false],
    ['{"$schema": "https://json-schema.org/draft/2020-12/schema"', false],
    ['[{"$schema": "https://json-schema.org/draft/2020-12/schema"}]', false],
    ['$schema: https://json-schema.org/draft/2020-12/schema', false],
    ['$.a', false],
    ['', false],
  ])('%s → %s', (text, expected) => {
    expect(detectJsonSchema(text)).toBe(expected);
  });
});

describe('§5 п. 33–38: inference', () => {
  const infer = (samples: string, options: Partial<Parameters<typeof runInference>[1]> = {}) => {
    const r = runInference(samples, { draft: '2020-12', enums: false, formats: false, closed: false, ...options });
    if (r.state !== 'ok') throw new Error(r.state);
    return r;
  };

  it('scenario 6: two samples', () => {
    const r = infer('{"id":1,"name":"Ann","email":null}\n{"id":2,"name":"Bob","tags":["a"]}');
    expect(JSON.parse(r.schema)).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        id: { type: 'integer' },
        name: { type: 'string' },
        email: { type: 'null' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['id', 'name'],
    });
    expect(r.notes).toEqual(['2 samples merged: properties missing from some samples are not required.']);
  });

  it('number vs integer, nullability, mixed kinds, empty containers', () => {
    expect(JSON.parse(infer('[1, 2.5, null]').schema).items).toEqual({ type: ['number', 'null'] });
    expect(JSON.parse(infer('[1, 2.0]').schema).items).toEqual({ type: 'integer' });
    expect(JSON.parse(infer('[1, 2.0]', { draft: 'draft-04' }).schema).items).toEqual({ type: 'number' });
    expect(JSON.parse(infer('[{"a":1}, [2], "x"]').schema).items).toEqual({
      type: ['object', 'array', 'string'],
      properties: { a: { type: 'integer' } },
      required: ['a'],
      items: { type: 'integer' },
    });
    expect(JSON.parse(infer('{"a":[],"b":{}}').schema).properties).toEqual({
      a: { type: 'array' },
      b: { type: 'object' },
    });
  });

  it('keeps the order of properties as written, integer-like names too', () => {
    expect(infer('{"b":1,"10":2,"__proto__":3}').schema).toContain('"b": {');
    expect(Object.keys(JSON.parse(infer('{"b":1,"10":2,"a":3}').schema.replace('"10"', '"x10"')).properties)).toEqual([
      'b',
      'x10',
      'a',
    ]);
    expect(infer('{"__proto__":1}').schema).toContain('"__proto__": {');
  });

  it('the switches: enums, formats, no additional properties', () => {
    const e = JSON.parse(infer('{"s":"on"}\n{"s":"off"}', { enums: true }).schema);
    expect(e.properties.s).toEqual({ type: 'string', enum: ['on', 'off'] });
    expect(JSON.parse(infer('{"s":"on"}', { enums: true }).schema).properties.s).toEqual({
      type: 'string',
      const: 'on',
    });
    expect(JSON.parse(infer('{"s":"on"}', { enums: true, draft: 'draft-04' }).schema).properties.s).toEqual({
      type: 'string',
      enum: ['on'],
    });
    const many = Array.from({ length: 21 }, (_, i) => `"v${i}"`).join(',');
    const wide = infer(`[${many}]`, { enums: true });
    expect(JSON.parse(wide.schema).items).toEqual({ type: 'string' });
    expect(wide.notes).toContain('Enums: 1 position has more than 20 values and got no enum.');
    const f = JSON.parse(infer('["2026-11-22T10:00:00Z", "2026-01-01T00:00:00+03:00"]', { formats: true }).schema);
    expect(f.items).toEqual({ type: 'string', format: 'date-time' });
    expect(JSON.parse(infer('["a@example.com", "x"]', { formats: true }).schema).items).toEqual({ type: 'string' });
    expect(JSON.parse(infer('{"a":{"b":1}}', { closed: true }).schema)).toMatchObject({
      additionalProperties: false,
      properties: { a: { additionalProperties: false } },
    });
  });

  it('every draft writes its $schema', () => {
    expect(JSON.parse(infer('1', { draft: 'draft-07' }).schema).$schema).toBe(
      'http://json-schema.org/draft-07/schema#',
    );
  });

  it('samples with comments are read (JSONC), errors are the scanner’s', () => {
    expect(infer('// a\n{"a":1,}').samples).toBe(1);
    const r = runInference('{"a":', { draft: '2020-12', enums: false, formats: false, closed: false });
    expect(r.state).toBe('error');
  });
});
