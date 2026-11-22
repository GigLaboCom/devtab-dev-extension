/**
 * The JSON tool's page (docs/tools/specs/json.md §2, §3, §6, §8) in jsdom: there are no workers here, so Run prints on
 * the page (runner.ts) — the same work the worker does. And its history: edits as snapshots, Copy, Save and Run at once,
 * an entry opened back — entries written by the first version of the tool (schema 1) too.
 */
import { definition } from './definition';
import { detect } from './detect';
import { jsonHistory } from './history';
import JsonTool from './JsonTool';
import { jsonSettings } from './settings';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LIVE_INPUT, MAX_INPUT } from '@workspace/tool-logic-json';
import { memoryHost } from '@workspace/tools-host';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const BOM = String.fromCharCode(0xfeff);
const NBSP = String.fromCharCode(0xa0);
const input = () => document.getElementById('json-input') as HTMLTextAreaElement;
const output = () => (document.getElementById('json-output') as HTMLTextAreaElement | null)?.value ?? null;
const type = (value: string) => fireEvent.change(input(), { target: { value } });
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const status = () => document.querySelector('[data-part="status"]')!.textContent!.trim();
const notes = () =>
  [...document.querySelectorAll('[data-part="note"]')].map(n => n.textContent!.trim()).filter(Boolean);
const summary = () => document.querySelector('[data-part="summary"]')?.textContent ?? null;
const mode = (name: 'Format' | 'Minify') => fireEvent.click(screen.getByRole('radio', { name }));
const check = (label: 'Sort keys' | 'Allow comments') => fireEvent.click(screen.getByLabelText(label));
const choose = async (label: string, option: string) => {
  const trigger = screen.getByLabelText(label);
  fireEvent.keyDown(trigger, { key: 'Enter' });
  const item = await screen.findByRole('option', { name: option });
  fireEvent.keyDown(item, { key: 'Enter' });
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
};
const picker = () => document.querySelector('input[type="file"]') as HTMLInputElement;
const open = (file: File) => fireEvent.change(picker(), { target: { files: [file] } });
const WAIT = { timeout: 15_000 };
const stubClipboard = () => {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  return writeText;
};

describe('the JSON tool’s definition', () => {
  it('describes the tool, recognises JSON and loads its component', async () => {
    expect(definition).toMatchObject({
      id: 'json',
      title: 'JSON',
      summary: 'Format, validate and minify JSON.',
      order: 1,
      output: { origin: 'input' },
    });
    expect(definition.keywords).toEqual([
      'json',
      'format',
      'pretty',
      'prettify',
      'beautify',
      'validate',
      'lint',
      'minify',
      'sort keys',
      'jsonc',
    ]);
    expect(definition.shortcut).toBeUndefined();
    expect(definition.history).toBe(jsonHistory);
    expect(definition.history?.kinds.map(k => k.id)).toEqual(['edit', 'result']);
    expect(definition.history?.kinds.some(k => k.secret)).toBe(false);
    expect(detect('{"a": 1}')).toBe(true);
    expect(detect('hello')).toBe(false);
    expect(detect('a: 1')).toBe(false);
    expect((await definition.load()).default).toBe(JsonTool);
  });
});

describe('the JSON tool, rendered with no host', () => {
  it('starts empty: Format, 2 spaces, nothing under the fields, Copy and Save off, no Run (§6, §8)', () => {
    render(<JsonTool />);
    expect(screen.getByRole('radio', { name: 'Format' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByLabelText('Mode').getAttribute('data-slot')).toBe('toggle-group');
    expect(screen.getByLabelText('Indent').textContent).toContain('2 spaces');
    expect(screen.getByLabelText('Sort keys').getAttribute('data-state')).toBe('unchecked');
    expect(screen.getByLabelText('Allow comments').getAttribute('data-state')).toBe('unchecked');
    expect(screen.getByLabelText('Input')).toBe(input());
    expect(input().placeholder).toBe('{"paste": "JSON here"}');
    expect(input().getAttribute('spellcheck')).toBe('false');
    const result = screen.getByLabelText('Result') as HTMLTextAreaElement;
    expect(result.readOnly).toBe(true);
    expect(result.getAttribute('spellcheck')).toBe('false');
    expect(status()).toBe('');
    expect(notes()).toEqual([]);
    for (const name of ['Copy', 'Save']) expect(button(name).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull();
    expect(picker().accept).toBe('.json,.jsonc,.geojson,application/json');
    type('  \n\t ');
    expect(status()).toBe('');
    expect(output()).toBe('');
    expect(button('Copy').disabled).toBe(true);
  });

  it('§2.1 a one-line API answer is formatted at once with 2 spaces, Valid JSON', () => {
    render(<JsonTool input='{"id":7,"tags":["a","b"],"ok":true}' />);
    expect(output()).toBe('{\n  "id": 7,\n  "tags": [\n    "a",\n    "b"\n  ],\n  "ok": true\n}');
    expect(status()).toBe('Valid JSON');
    expect(document.querySelector('[data-part="status"]')!.getAttribute('role')).toBe('status');
  });

  it('§2.2 a trailing comma: the line under the input says where, a press puts the caret there', () => {
    render(<JsonTool />);
    type('{\n  "a": 1,\n}');
    expect(status()).toBe('Line 3, column 1: trailing comma');
    // An input error changes while typing: role status, never alert (it would interrupt on every key).
    expect(screen.queryByRole('alert')).toBeNull();
    expect(output()).toBe('');
    expect(button('Copy').disabled).toBe(true);
    expect(button('Save').disabled).toBe(true);
    const link = screen.getByRole('button', { name: 'Line 3, column 1: trailing comma' });
    fireEvent.click(link);
    expect(document.activeElement).toBe(input());
    expect([input().selectionStart, input().selectionEnd]).toEqual([12, 12]);
  });

  it('§2.3 a number a double cannot hold is kept, with the note', () => {
    render(<JsonTool input='{"id":12345678901234567890}' />);
    expect(output()).toBe('{\n  "id": 12345678901234567890\n}');
    expect(notes()).toEqual([
      "1 number is kept as written but can't be held exactly by a double (RFC 8259 §6): JSON.parse in JavaScript would change it.",
    ]);
  });

  it('§2.4 Sort keys: names on every level in code-point order, arrays untouched', () => {
    render(<JsonTool input='{"b":{"d":1,"c":2},"a":[3,1]}' />);
    check('Sort keys');
    expect(output()).toBe('{\n  "a": [\n    3,\n    1\n  ],\n  "b": {\n    "c": 2,\n    "d": 1\n  }\n}');
  });

  it('§2.5 Minify for an environment variable, then Copy; the indent is off in Minify', async () => {
    const writeText = stubClipboard();
    render(<JsonTool input={'{\n  "a": [1, 2],\n  "b": "x y"\n}'} />);
    mode('Minify');
    expect(output()).toBe('{"a":[1,2],"b":"x y"}');
    expect(screen.getByLabelText('Indent').hasAttribute('disabled')).toBe(true);
    fireEvent.click(button('Copy'));
    await act(async () => undefined);
    expect(writeText).toHaveBeenCalledWith('{"a":[1,2],"b":"x y"}');
    expect(button('Copied')).toBeTruthy();
    mode('Format');
    expect(screen.getByLabelText('Indent').hasAttribute('disabled')).toBe(false);
    await choose('Indent', 'Tab');
    expect(output()).toBe('{\n\t"a": [\n\t\t1,\n\t\t2\n\t],\n\t"b": "x y"\n}');
    await choose('Indent', '4 spaces');
    expect(output()).toBe('{\n    "a": [\n        1,\n        2\n    ],\n    "b": "x y"\n}');
  });

  it('§2.6 a tsconfig with comments: the error says what to turn on; Allow comments gives strict JSON', () => {
    render(<JsonTool />);
    type('{\n  // Base options\n  "strict": true, /* on */\n  "lib": ["dom",],\n}');
    expect(status()).toBe('Line 2, column 3: comments are not allowed in JSON (turn on "Allow comments")');
    check('Allow comments');
    expect(output()).toBe('{\n  "strict": true,\n  "lib": [\n    "dom"\n  ]\n}');
    expect(status()).toBe('Valid JSON with comments');
    expect(notes()).toEqual(['Removed 2 comments and 2 trailing commas: the result is strict JSON.']);
    type('{"a": 1}');
    expect(status()).toBe('Valid JSON');
  });

  it('§2.7 a repeated name: both kept, the note says where the second is', () => {
    render(<JsonTool input='{"a":1,"b":2,"a":3}' />);
    mode('Minify');
    expect(output()).toBe('{"a":1,"b":2,"a":3}');
    expect(notes()).toEqual([
      'Duplicate key "a" at line 1, column 14. Both are kept; parsers disagree on which one wins (RFC 8259 §4).',
    ]);
  });

  it('§2.9 JSON Lines: the error says this tool does not read them', () => {
    render(<JsonTool input={'{"a":1}\n{"a":2}'} />);
    expect(status()).toBe(
      'Line 2, column 1: unexpected text after the JSON value: several values, one per line, are JSON Lines, which this tool does not read',
    );
  });

  it.each([
    [
      `${BOM}{"a":1}`,
      '{\n  "a": 1\n}',
      'Valid JSON',
      ['A byte order mark (U+FEFF) at the start was skipped (RFC 8259 §8.1).'],
    ],
    ['{"ключ":"🙂"}', '{\n  "ключ": "🙂"\n}', 'Valid JSON', []],
    ['{"🙂": x}', '', 'Line 1, column 8: unexpected "x"', []],
    [`{${NBSP}"a":1}`, '', 'Line 1, column 2: unexpected U+00A0 (an invisible character)', []],
    [`[1,${String.fromCharCode(0x200b)}2]`, '', 'Line 1, column 4: unexpected U+200B (an invisible character)', []],
    ["{'a':1}", '', 'Line 1, column 2: property names must be in double quotes', []],
    ['"a\tb"', '', 'Line 1, column 3: control character U+0009 in a string; write it as \\t', []],
    ['{"a":1', '', "Line 1, column 7: unexpected end of input, expected ',' or '}'", []],
    ['{"a":1} {"a":2}', '', 'Line 1, column 9: unexpected text after the JSON value', []],
    [`${'['.repeat(1001)}${']'.repeat(1001)}`, '', 'Line 1, column 1001: nesting deeper than 1000 levels', []],
    [
      '{"a":1,"a":2}',
      '{\n  "a": 1,\n  "a": 2\n}',
      'Valid JSON',
      ['Duplicate key "a" at line 1, column 8. Both are kept; parsers disagree on which one wins (RFC 8259 §4).'],
    ],
  ])('§6 %j', (text, result, said, noted) => {
    render(<JsonTool input={text} />);
    expect(output()).toBe(result);
    expect(status()).toBe(said);
    expect(notes()).toEqual(noted);
  });

  it('an error leaves no old result behind; fixing it brings the result back', () => {
    render(<JsonTool input="[1,2]" />);
    expect(output()).toBe('[\n  1,\n  2\n]');
    type('[1,2');
    expect(output()).toBe('');
    expect(button('Copy').disabled).toBe(true);
    type('[1,2,3]');
    expect(output()).toBe('[\n  1,\n  2,\n  3\n]');
  });

  it('deep nesting far past the limit is a worded error, not a crash (§5 «Разбор» п. 3)', () => {
    render(<JsonTool />);
    type(`${'['.repeat(9000)}${']'.repeat(9000)}`);
    expect(status()).toBe('Line 1, column 1001: nesting deeper than 1000 levels');
  });

  it('§6, §12 a large input waits for Run (or Ctrl+Enter); 32 Mi + 1 characters are refused', async () => {
    render(<JsonTool />);
    const big = `[${'1,'.repeat(Math.ceil(LIVE_INPUT / 2))}1]`;
    type(big);
    expect(status()).toBe('Large input: press Run (Ctrl+Enter) to check it.');
    expect(output()).toBe('');
    fireEvent.click(button('Run'));
    expect(screen.getByRole('button', { name: 'Working…' })).toHaveProperty('disabled', true);
    await waitFor(() => expect(status()).toBe('Valid JSON'), WAIT);
    expect(output()!.startsWith('[\n  1,\n  1,')).toBe(true);
    mode('Minify');
    expect(status()).toBe('Large input: press Run (Ctrl+Enter) to check it.');
    fireEvent.keyDown(input(), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(output()).toBe(big), WAIT);
    type(`[${'1,'.repeat(Math.ceil(LIVE_INPUT / 2))}x]`);
    fireEvent.keyDown(input(), { key: 'Enter', metaKey: true });
    await waitFor(() => expect(status()).toMatch(/^Line 1, column 262146: unexpected "x"$/), WAIT);
    type(' '.repeat(MAX_INPUT + 1));
    expect(status()).toBe('');
    type(`[${' '.repeat(MAX_INPUT)}]`);
    expect(status()).toBe('Input is larger than 32 MB. This tool works with up to 32 MB.');
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull();
  });

  it('§2.8, §3 a file too large for the field stays behind a card; a result too large is a summary with Copy', async () => {
    const writeText = stubClipboard();
    render(<JsonTool />);
    // 200,001 lines: more than the field takes (§3), small in bytes.
    const lines = `[\n${'1,\n'.repeat(200_000)}1\n]`;
    open(new File([lines], 'export.json', { type: 'application/json' }));
    await waitFor(() => expect(document.querySelector('[data-part="file"]')).not.toBeNull(), WAIT);
    expect(document.querySelector('[data-part="file"] p')!.textContent).toBe('export.json — 0.6 MB');
    expect(document.getElementById('json-input')).toBeNull();
    expect(status()).toBe('Large input: press Run (Ctrl+Enter) to check it.');
    fireEvent.click(button('Run'));
    await waitFor(() => expect(status()).toBe('Valid JSON'), WAIT);
    expect(summary()).toBe('Result: 1.0 MB, 200,003 lines. Too large to show here.');
    expect(output()).toBeNull();
    fireEvent.click(button('Copy'));
    await act(async () => undefined);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect((writeText.mock.calls[0] as unknown as [string])[0].startsWith('[\n  1,\n  1,')).toBe(true);
    // An error in a file is words without a link: there is no field to put the caret in.
    open(new File([`[\n${'1,\n'.repeat(200_000)}x\n]`], 'broken.json'));
    await waitFor(() => expect(document.querySelector('[data-part="file"] p')!.textContent).toMatch(/^broken\.json/));
    fireEvent.click(button('Run'));
    await waitFor(() => expect(status()).toBe('Line 200002, column 1: unexpected "x"'), WAIT);
    expect(screen.queryByRole('button', { name: /^Line / })).toBeNull();
    fireEvent.click(button('Clear'));
    expect(input().value).toBe('');
    expect(status()).toBe('');
  });

  it('opens a file into the field; not UTF-8 and over 32 MiB are refused with their words', async () => {
    render(<JsonTool />);
    open(new File([`${BOM}{"a":[1,2]}`], 'data.json'));
    await waitFor(() => expect(input().value).toBe('{"a":[1,2]}'));
    expect(output()).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
    open(new File([new Uint8Array([0x7b, 0xff, 0xfe])], 'bad.json'));
    await waitFor(() => expect(status()).toBe('The file is not valid UTF-8 text.'));
    const huge = new File(['{}'], 'huge.json');
    Object.defineProperty(huge, 'size', { value: MAX_INPUT + 1 });
    open(huge);
    await waitFor(() => expect(status()).toBe('Input is larger than 32 MB. This tool works with up to 32 MB.'));
    type('[1]');
    expect(status()).toBe('Valid JSON');
  });

  it('Save downloads formatted.json or minified.json', () => {
    URL.createObjectURL = vi.fn(() => 'blob:x') as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<JsonTool input="[1]" />);
    fireEvent.click(button('Save'));
    mode('Minify');
    fireEvent.click(button('Save'));
    expect(click.mock.instances.map(a => (a as unknown as HTMLAnchorElement).download)).toEqual([
      'formatted.json',
      'minified.json',
    ]);
  });
});

describe('the JSON tool’s history', () => {
  const entriesOf = async (host: ReturnType<typeof memoryHost>, kinds?: string[]) =>
    (await host.history.forOwner('json', definition.history!).list(kinds ? { kinds } : {})).entries;

  it('commits Copy, Save and Run at once, with the text, the options and the result', async () => {
    stubClipboard();
    URL.createObjectURL = vi.fn(() => 'blob:x') as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const host = memoryHost();
    render(<JsonTool host={host} />);
    type('{"b": 1, "a": [1, 2]}');
    check('Sort keys');
    fireEvent.click(button('Copy'));
    await waitFor(async () => expect(await entriesOf(host, ['result'])).toHaveLength(1), WAIT);
    mode('Minify');
    fireEvent.click(button('Save'));
    await waitFor(async () => expect(await entriesOf(host, ['result'])).toHaveLength(2), WAIT);
    type(`[${'1,'.repeat(Math.ceil(LIVE_INPUT / 2))}1]`);
    fireEvent.click(button('Run'));
    await waitFor(async () => expect(await entriesOf(host, ['result'])).toHaveLength(3), WAIT);
    const labels = (await entriesOf(host, ['result'])).map(e => e.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        'Format · 2 spaces · sorted keys · copied',
        'Minify · sorted keys · saved',
        'Minify · sorted keys · ran',
      ]),
    );
    const history = host.history.forOwner('json', definition.history!);
    const copied = (await entriesOf(host, ['result'])).find(e => e.label?.endsWith('copied'))!;
    const opened = await history.open(copied.id);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.entry.schema).toBe(2);
    expect(opened.payload).toEqual({ layout: 2, sortKeys: true, allowComments: false, action: 'copy', ok: true });
    expect(await opened.blobs.input!.text()).toBe('{"b": 1, "a": [1, 2]}');
    expect(await opened.blobs.output!.text()).toBe('{\n  "a": [\n    1,\n    2\n  ],\n  "b": 1\n}');
  });

  it('records an edit as a snapshot (change), and the text handed over from the start page', async () => {
    const host = memoryHost();
    const { unmount } = render(<JsonTool host={host} input='{"x": 1}' />);
    type('{"x": 2}');
    unmount();
    await waitFor(async () => expect((await entriesOf(host, ['edit'])).length).toBeGreaterThan(0), WAIT);
    const [edit] = await entriesOf(host, ['edit']);
    expect(edit!.label).toBe('Edit · 8 characters');
  });

  it('opens an entry back into the tool: text, mode, indent, Sort keys, Allow comments', async () => {
    stubClipboard();
    const host = memoryHost();
    const first = render(<JsonTool host={host} />);
    check('Allow comments');
    await choose('Indent', '4 spaces');
    check('Sort keys');
    type('{"b": 1, /* c */ "a": 2}');
    fireEvent.click(button('Copy'));
    await waitFor(async () => expect(await entriesOf(host, ['result'])).toHaveLength(1), WAIT);
    first.unmount();
    await act(async () => undefined);
    const [entry] = await entriesOf(host, ['result']);
    expect(entry!.label).toBe('Format · 4 spaces · sorted keys · comments allowed · copied');

    render(<JsonTool host={host} restore={{ id: entry!.id }} />);
    expect(await screen.findByText(`Opened from History: ${entry!.label}.`)).toBeTruthy();
    expect(input().value).toBe('{"b": 1, /* c */ "a": 2}');
    expect(screen.getByLabelText('Indent').textContent).toContain('4 spaces');
    expect(screen.getByLabelText('Sort keys').getAttribute('data-state')).toBe('checked');
    expect(screen.getByLabelText('Allow comments').getAttribute('data-state')).toBe('checked');
    expect(output()).toBe('{\n    "a": 2,\n    "b": 1\n}');
  });

  it('opens entries written by the first version of the tool (schema 1): Format with its indent, Minify, an edit', async () => {
    const host = memoryHost();
    // The first version's declaration, as it wrote: schema 1, payloads `{ action, indent, sortKeys, ok }`.
    const old = host.history.forOwner('json', { ...jsonHistory, schema: 1 }).session();
    const blob = (text: string) => new Blob([text], { type: 'application/json' });
    await old.commit({
      kind: 'result',
      payload: { action: 'format', indent: 'tab', sortKeys: true, ok: true },
      label: 'Format · Tab · sorted keys',
      text: '{"b":1,"a":12345678901234567890}',
      blobs: {
        input: blob('{"b":1,"a":12345678901234567890}'),
        output: blob('{\n\t"a": 12345678901234567000,\n\t"b": 1\n}'),
      },
    });
    await old.commit({
      kind: 'result',
      payload: { action: 'minify', indent: 4, sortKeys: false, ok: true },
      label: 'Minify',
      text: '[1, 2]',
      blobs: { input: blob('[1, 2]'), output: blob('[1,2]') },
    });
    await old.commit({
      kind: 'edit',
      payload: { indent: 4, sortKeys: false },
      label: 'Edit · 5 characters',
      text: '{"a":',
      blobs: { input: blob('{"a":') },
    });
    await old.end();
    const entries = await entriesOf(host);
    expect(entries.map(e => e.schema)).toEqual([1, 1, 1]);
    const byLabel = (label: string) => entries.find(e => e.label === label)!.id;

    const a = render(<JsonTool host={host} restore={{ id: byLabel('Format · Tab · sorted keys') }} />);
    expect(await screen.findByText('Opened from History: Format · Tab · sorted keys.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Format' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByLabelText('Indent').textContent).toContain('Tab');
    expect(screen.getByLabelText('Sort keys').getAttribute('data-state')).toBe('checked');
    // Printed again by the rules of now: the number the first version rounded comes back as written.
    expect(output()).toBe('{\n\t"a": 12345678901234567890,\n\t"b": 1\n}');
    a.unmount();

    const b = render(<JsonTool host={host} restore={{ id: byLabel('Minify') }} />);
    expect(await screen.findByText('Opened from History: Minify.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Minify' }).getAttribute('aria-checked')).toBe('true');
    expect(output()).toBe('[1,2]');
    b.unmount();

    render(<JsonTool host={host} restore={{ id: byLabel('Edit · 5 characters') }} />);
    expect(await screen.findByText('Opened from History: Edit · 5 characters.')).toBeTruthy();
    expect(input().value).toBe('{"a":');
    expect(screen.getByLabelText('Indent').textContent).toContain('4 spaces');
    expect(status()).toBe('Line 1, column 6: unexpected end of input, expected a value');
  });

  it('an entry of a newer schema is refused in words', async () => {
    const host = memoryHost();
    const newer = host.history.forOwner('json', { ...jsonHistory, schema: 3 }).session();
    await newer.commit({ kind: 'edit', payload: {}, label: 'From the future', blobs: { input: new Blob(['[]']) } });
    await newer.end();
    const [entry] = await entriesOf(host);
    render(<JsonTool host={host} restore={{ id: entry!.id }} />);
    expect(await screen.findByText('This entry was kept by a newer version of the tool.')).toBeTruthy();
  });
});

describe('the JSON tool’s saved parameters (D21, docs/tools/settings.md)', () => {
  const savedOf = (host: ReturnType<typeof memoryHost>) => host.settings.forTool('json').saved();
  const seed = async (host: ReturnType<typeof memoryHost>, values: Record<string, unknown>) => {
    host.settings.forTool('json').save(jsonSettings.schema, values as never);
    await host.settings.forTool('json').flush();
  };
  const shows = () => ({
    mode: screen.getByRole('radio', { name: 'Minify' }).getAttribute('data-state') === 'on' ? 'minify' : 'format',
    indent: screen.getByLabelText('Indent').textContent,
    sortKeys: screen.getByLabelText('Sort keys').getAttribute('data-state'),
    allowComments: screen.getByLabelText('Allow comments').getAttribute('data-state'),
  });

  it('opens with the defaults and saves nothing until an option changes; reopened, it is as left', async () => {
    const host = memoryHost();
    const first = render(<JsonTool host={host} />);
    expect(shows()).toEqual({ mode: 'format', indent: '2 spaces', sortKeys: 'unchecked', allowComments: 'unchecked' });
    type('{"b":1,"a":2}');
    await host.settings.forTool('json').flush();
    expect(savedOf(host)).toBeUndefined();
    await choose('Indent', 'Tab');
    check('Sort keys');
    first.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { indent: 'tab', sortKeys: true } });

    render(<JsonTool host={host} input='{"b":1,"a":2}' />);
    expect(shows()).toEqual({ mode: 'format', indent: 'Tab', sortKeys: 'checked', allowComments: 'unchecked' });
    expect(output()).toBe('{\n\t"a": 2,\n\t"b": 1\n}');
  });

  it('a saved record it cannot show falls back field by field; the rest is used', async () => {
    const host = memoryHost();
    await seed(host, { mode: 'minify', indent: 3, sortKeys: 'yes', allowComments: true, unknown: 1 });
    render(<JsonTool host={host} />);
    expect(shows()).toEqual({ mode: 'minify', indent: '2 spaces', sortKeys: 'unchecked', allowComments: 'checked' });
  });

  it('an entry opened from History and a pasted text win for the visit and leave what is saved alone', async () => {
    const host = memoryHost();
    const recorder = host.history.forOwner('json', jsonHistory).session();
    await recorder.commit({
      kind: 'result',
      label: 'Minify',
      payload: { schema: 2, layout: 'minify', sortKeys: false, allowComments: false, action: 'copy' } as never,
      blobs: { input: new Blob(['{"a": 1}']), result: new Blob(['{"a":1}']) },
    });
    const [entry] = (await host.history.forOwner('json', jsonHistory).list({})).entries;
    await seed(host, { indent: 4, sortKeys: true });
    const opened = render(<JsonTool host={host} restore={{ id: entry!.id }} />);
    expect(await screen.findByText('Opened from History: Minify.')).toBeTruthy();
    expect(shows()).toMatchObject({ mode: 'minify', sortKeys: 'unchecked' });
    opened.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { indent: 4, sortKeys: true } });

    // A paste from the start page: its text, with the saved options.
    render(<JsonTool host={host} input='{"b":1,"a":2}' />);
    expect(shows()).toMatchObject({ mode: 'format', indent: '4 spaces', sortKeys: 'checked' });
    expect(output()).toBe('{\n    "a": 2,\n    "b": 1\n}');
    expect(savedOf(host)).toEqual({ schema: 1, values: { indent: 4, sortKeys: true } });
  });

  it('after an opened entry, a change writes only the option the person changed', async () => {
    const host = memoryHost();
    await host.history
      .forOwner('json', jsonHistory)
      .session()
      .commit({
        kind: 'result',
        label: 'Format · Tab',
        payload: { schema: 2, layout: 'tab', sortKeys: false, allowComments: false, action: 'copy' } as never,
        blobs: { input: new Blob(['[]']), result: new Blob(['[]']) },
      });
    const [entry] = (await host.history.forOwner('json', jsonHistory).list({})).entries;
    render(<JsonTool host={host} restore={{ id: entry!.id }} />);
    expect(await screen.findByText('Opened from History: Format · Tab.')).toBeTruthy();
    check('Allow comments');
    await host.settings.forTool('json').flush();
    expect(savedOf(host)).toEqual({ schema: 1, values: { allowComments: true } });
  });

  it('reset puts every option back to its default and keeps the input; the result follows', async () => {
    const host = memoryHost();
    await seed(host, { mode: 'minify', sortKeys: true });
    render(<JsonTool host={host} />);
    type('{"b":1,"a":2}');
    expect(output()).toBe('{"a":2,"b":1}');
    await act(async () => host.settings.forTool('json').reset());
    expect(shows()).toEqual({ mode: 'format', indent: '2 spaces', sortKeys: 'unchecked', allowComments: 'unchecked' });
    expect(input().value).toBe('{"b":1,"a":2}');
    expect(output()).toBe('{\n  "b": 1,\n  "a": 2\n}');
    expect(savedOf(host)).toBeUndefined();
  });
});
