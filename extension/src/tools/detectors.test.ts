/**
 * The tools' `detect` as the pages use them (detectors.ts, recogniser.ts): found by location, in the catalogue's order,
 * and the `PasteRecogniser` contract every implementation passes.
 */
import { TOOL_CATALOGUE } from './catalogue';
import { DETECTING, detectorsOf, recogniseIn } from './detectors';
import { PENDING, deferredRecogniser, recogniserOf, recognisesNothing } from './recogniser';
import { toolRecogniser } from './toolRecogniser';
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PasteRecogniser } from './recogniser';

const PACKAGES = join(__dirname, '../../../packages/tools/ui');
const ORDER = TOOL_CATALOGUE.map(t => t.id);
const recognise = recogniseIn(ORDER);

describe('the detectors', () => {
  it('are every tool package’s src/detect.ts, in the catalogue’s order', () => {
    const expected = ORDER.filter(id => existsSync(join(PACKAGES, id, 'src/detect.ts')));
    expect(ORDER.filter(id => DETECTING.includes(id))).toEqual(expected);
    expect([...DETECTING].sort()).toEqual([...expected].sort());
    expect(expected.length).toBeGreaterThan(0);
  });

  it('leave out a module without a detect and one the catalogue does not list', () => {
    const t = () => true;
    const found = { '/x/packages/tools/ui/b/src/detect.ts': t, '/x/packages/tools/ui/a/src/detect.ts': t };
    expect(
      detectorsOf({ ...found, '/x/packages/tools/ui/c/src/detect.ts': undefined }, ['a', 'b']).map(d => d.id),
    ).toEqual(['a', 'b']);
    expect(detectorsOf(found, ['b']).map(d => d.id)).toEqual(['b']);
  });

  it('JSON is the JSON tool’s alone, though JSON is YAML too; what strict JSON refuses opens nothing', () => {
    // docs/tools/specs/json.md §7: every other detect refuses an object or an array, so the order does not decide.
    const modules = import.meta.glob<(text: string) => boolean>('../../../packages/tools/ui/*/src/detect.ts', {
      eager: true,
      import: 'detect',
    });
    const all = detectorsOf(modules, ORDER);
    const who = (text: string) => all.filter(d => d.detect(text)).map(d => d.id);
    for (const text of ['{"a": [1, 2]}', '[1, 2]\n', '{}', '{\n  "a": 1\n}', '["#ff0000"]', '{"a":"\\u00e9"}'])
      expect(who(text), text).toEqual(['json']);
    for (const text of ['{a: 1}', '[a, b]', '{"a":1}\n{"a":2}', '{"a":1} // c', '{"a":1,}', '[1,2,3', '42', '"x"'])
      expect(who(text), text).toEqual([]);
    expect(who('a: 1\nb: 2')).toEqual(['yaml-json']);
    expect(who('"He said \\"hi\\""')).toEqual(['backslash-escape']);
  });

  it('recognise pasted text: the first tool in the order that knows it; nothing for plain or blank text', () => {
    expect(recognise('{"a": [1, 2]}')).toBe('json');
    expect(recognise('[1, 2')).toBeUndefined();
    expect(recognise('hello world')).toBeUndefined();
    expect(recognise('  ')).toBeUndefined();
  });
});

describe.each<[string, () => PasteRecogniser]>([
  ['the tools’ detect (lazy)', () => toolRecogniser(ORDER)],
  ['deferred over a function', () => deferredRecogniser(() => Promise.resolve(recogniserOf(recognise)))],
  ['over a function', () => recogniserOf(recognise)],
])('PasteRecogniser contract: %s', (_name, make) => {
  it('answers PENDING or the answer at once; after ready(), always the answer', async () => {
    const r = make();
    const before = r.recognise('{"a": 1}');
    expect([PENDING, 'json']).toContain(before);
    await r.ready();
    expect(r.recognise('{"a": 1}')).toBe('json');
    expect(r.recognise('hello')).toBeUndefined();
    await r.ready();
  });
});

describe('PasteRecogniser defaults', () => {
  it('the tools’ detect: PENDING until its chunk has arrived', async () => {
    const r = toolRecogniser(ORDER);
    expect(r.recognise('{"a": 1}')).toBe(PENDING);
    await r.ready();
    expect(r.recognise('{"a": 1}')).toBe('json');
  });

  it('a load that fails: ready() rejects, then nothing is recognised (the paste is text)', async () => {
    const r = deferredRecogniser(() => Promise.reject(new Error('offline')));
    await expect(r.ready()).rejects.toThrow('offline');
    expect(r.recognise('{"a": 1}')).toBeUndefined();
    expect(recognisesNothing.recognise('{"a": 1}')).toBeUndefined();
  });
});
