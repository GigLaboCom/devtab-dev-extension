import file from './attribute-names.json' with { type: 'json' };
import { attributeNamesFrom, loadAttributeNames } from './names.ts';
import { BOOLEAN_PROPS, EVENT_PROPS, REACT_EVENTS, UNITLESS_STYLES } from './tables.ts';
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// docs/tools/specs/html-to-jsx.md §10, first row: the data file — and the fixed tables of tables.ts — against the
// `react-dom` the workspace has installed (read as a file: the logic never imports React). When `react-dom` changes
// version these fail until scripts/generate-attribute-names.mjs is run again and the tables are checked.

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = createRequire(join(PACKAGE, 'package.json')).resolve('react-dom/package.json');
const installed = JSON.parse(readFileSync(manifest, 'utf8')) as { version: string };
const source = readFileSync(join(dirname(manifest), 'cjs/react-dom-client.development.js'), 'utf8');

describe('attribute-names.json', () => {
  it('records its source, the version, the hash of the source and the number of pairs', () => {
    expect(file.package).toBe('react-dom');
    expect(file.version).toBe(installed.version);
    expect(file.sha256).toBe(createHash('sha256').update(source).digest('hex'));
    expect(file.count).toBe(Object.keys(file.names).length);
    expect(file.count).toBe(306);
    const names = Object.keys(file.names);
    expect(names.filter(n => !/[-:]/.test(n))).toHaveLength(220);
    expect(names.filter(n => /[-:]/.test(n))).toHaveLength(86);
    expect(existsSync(join(PACKAGE, 'licenses/react-dom-LICENSE.txt'))).toBe(true);
    expect(readFileSync(join(PACKAGE, 'licenses/react-dom-LICENSE.txt'), 'utf8')).toMatch(/^MIT License/);
  });

  it('holds exactly the pairs of possibleStandardNames that change (read here a second way)', () => {
    const start = source.indexOf('possibleStandardNames = {');
    const body = source.slice(start, source.indexOf('}', start));
    const changed = [...body.matchAll(/^\s*(?:"([^"]+)"|([\w$]+)): "([^"]*)"/gm)]
      .map(m => [m[1] ?? m[2]!, m[3]!] as const)
      .filter(([name, property]) => name !== property);
    expect(Object.entries(file.names)).toEqual(changed);
  });

  it('maps the names the specification names', async () => {
    const names = await loadAttributeNames();
    expect(names).toBe(await loadAttributeNames());
    expect(names).toEqual(attributeNamesFrom(file));
    for (const [name, property] of [
      ['class', 'className'],
      ['for', 'htmlFor'],
      ['tabindex', 'tabIndex'],
      ['stroke-width', 'strokeWidth'],
      ['xlink:href', 'xlinkHref'],
      ['xmlns:xlink', 'xmlnsXlink'],
      ['viewbox', 'viewBox'],
      ['charset', 'charSet'],
    ])
      expect(names.get(name!)).toBe(property);
    for (const kept of ['id', 'href', 'role', 'hx-get', 'xmlns', 'd']) expect(names.has(kept)).toBe(false);
  });
});

describe('tables.ts against react-dom', () => {
  it('the events: simpleEventPluginEvents, scrollEnd and the plugins’ registrations', () => {
    const simple = /simpleEventPluginEvents =\s*"([^"]+)"/.exec(source)![1]!.split(' ');
    const plugins = [...source.matchAll(/register(?:TwoPhase|Direct)Event\(\s*"on([A-Za-z]+)"/g)].map(m => m[1]!);
    const special = [...source.matchAll(/registerSimpleEvent\(\s*[A-Z_]+,\s*"on([A-Za-z]+)"/g)].map(m => m[1]!);
    const expected = new Set(
      [...simple, 'scrollEnd', ...plugins, ...special].map(e => e[0]!.toLowerCase() + e.slice(1)),
    );
    // onFocus and onBlur are registered on focusin and focusout: the attributes onfocus and onblur are theirs too.
    expect(new Set(REACT_EVENTS)).toEqual(new Set([...expected, 'focus', 'blur']));
    expect(source).toContain('registerSimpleEvent("dblclick", "onDoubleClick")');
    expect(source).toContain('registerSimpleEvent("focusin", "onFocus")');
    expect(source).toContain('registerSimpleEvent("focusout", "onBlur")');
    expect(EVENT_PROPS.get('ondblclick')).toBe('onDoubleClick');
    expect(EVENT_PROPS.get('onclick')).toBe('onClick');
    expect(EVENT_PROPS.get('onfullscreenchange')).toBe('onFullscreenChange');
  });

  it('the unitless style properties: unitlessNumbers', () => {
    const list = /unitlessNumbers = new Set\(\s*"([^"]+)"/.exec(source)![1]!.split(' ');
    expect(new Set(UNITLESS_STYLES)).toEqual(new Set(list));
  });

  it('every flag is one React writes as a bare attribute', () => {
    // React's setProp: the cases that end with `setAttribute(key, "")` for `true`; checked, selected, multiple, muted
    // and autoFocus are properties React sets on the node, and defaultChecked is checked's initial value.
    const own = ['checked', 'defaultChecked', 'selected', 'multiple', 'muted', 'autoFocus'];
    for (const flag of BOOLEAN_PROPS) if (!own.includes(flag)) expect(source, flag).toContain(`case "${flag}":`);
    const section = source.slice(source.indexOf('case "inert":'), source.indexOf('case "capture":'));
    const cases = [...section.matchAll(/case "([A-Za-z]+)":/g)].map(m => m[1]!);
    expect(cases.filter(c => !BOOLEAN_PROPS.has(c))).toEqual([]);
  });
});
