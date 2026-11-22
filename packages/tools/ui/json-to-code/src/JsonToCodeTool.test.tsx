/**
 * The JSON to Code tool's page (docs/tools/specs/json-to-code.md §2, §6, §8) in jsdom: there are no workers here, so
 * Generate works on the page (runner.ts) — the same work the worker does. And its history: edits as snapshots, Copy and
 * Generate at once, an entry opened back.
 */
import { definition } from './definition';
import { jsonToCodeHistory } from './history';
import JsonToCodeTool from './JsonToCodeTool';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LIVE_INPUT, MAX_INPUT } from '@workspace/tool-logic-json-to-code';
import { memoryHost } from '@workspace/tools-host';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const input = () => document.getElementById('json-to-code-input') as HTMLTextAreaElement;
const output = () => (document.getElementById('json-to-code-output') as HTMLTextAreaElement).value;
const root = () => document.getElementById('json-to-code-root') as HTMLInputElement;
const type = (value: string) => fireEvent.change(input(), { target: { value } });
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const status = () => document.querySelector('[data-part="status"]')!.textContent!.trim();
const notes = () =>
  [...document.querySelectorAll('[data-part="note"]')].map(n => n.textContent!.trim()).filter(Boolean);
const choose = async (label: string, option: string) => {
  const trigger = screen.getByLabelText(label);
  fireEvent.keyDown(trigger, { key: 'Enter' });
  const item = await screen.findByRole('option', { name: option });
  fireEvent.keyDown(item, { key: 'Enter' });
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
};
const WAIT = { timeout: 15_000 };
const stubClipboard = () => {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  return writeText;
};

describe('the JSON to Code tool’s definition', () => {
  it('describes the tool, recognises nothing (JSON opens the json tool) and loads its component', async () => {
    expect(definition).toMatchObject({
      id: 'json-to-code',
      title: 'JSON to Code',
      summary: 'Generate TypeScript, Go, Rust or Python types from a JSON sample.',
      order: 31,
      output: { origin: 'input' },
    });
    expect(definition.keywords).toEqual([
      'json',
      'types',
      'typescript',
      'interface',
      'go',
      'struct',
      'rust',
      'serde',
      'python',
      'typeddict',
      'codegen',
      'infer',
    ]);
    expect(definition.shortcut).toBeUndefined();
    expect('detect' in definition).toBe(false);
    expect(definition.history).toBe(jsonToCodeHistory);
    expect(definition.history?.kinds.map(k => k.id)).toEqual(['edit', 'result']);
    expect(definition.history?.kinds.some(k => k.secret)).toBe(false);
    expect((await definition.load()).default).toBe(JsonToCodeTool);
  });
});

describe('the JSON to Code tool, rendered with no host', () => {
  it('starts empty: TypeScript, Root, interface, Export on, Copy off, nothing under the fields (§6, §8)', () => {
    render(<JsonToCodeTool />);
    expect(screen.getByLabelText('Language').textContent).toContain('TypeScript');
    expect(root().placeholder).toBe('Root');
    expect(root().value).toBe('');
    expect(root().getAttribute('spellcheck')).toBe('false');
    expect(screen.getByRole('radio', { name: 'interface' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByLabelText('Declaration').getAttribute('data-slot')).toBe('toggle-group');
    expect(screen.getByLabelText('Export').getAttribute('data-state')).toBe('checked');
    expect(screen.getByLabelText('JSON sample')).toBe(input());
    expect(input().placeholder).toBe('{"id": 1, "name": "Ann"}');
    expect(input().getAttribute('spellcheck')).toBe('false');
    const result = screen.getByLabelText('Result') as HTMLTextAreaElement;
    expect(result.readOnly).toBe(true);
    expect(result.getAttribute('spellcheck')).toBe('false');
    expect(status()).toBe('');
    expect(notes()).toEqual([]);
    expect(button('Copy').disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Generate' })).toBeNull();
    type('  \n\t ');
    expect(status()).toBe('');
    expect(output()).toBe('');
    expect(button('Copy').disabled).toBe(true);
  });

  it('§2.1 an answer from the Network tab: interfaces at once', () => {
    render(<JsonToCodeTool input='{"id":7,"name":"Ann","owner":{"login":"ann"}}' />);
    expect(output()).toBe(
      'export interface Root {\n  id: number;\n  name: string;\n  owner: Owner;\n}\n\nexport interface Owner {\n  login: string;\n}\n',
    );
    expect(document.querySelector('[data-part="status"]')!.getAttribute('role')).toBe('status');
  });

  it('§2.2 Go: structs aligned as gofmt; the TypeScript options hide and keep their values', async () => {
    render(<JsonToCodeTool input='{"id":7,"name":"Ann","owner":{"login":"ann"}}' />);
    fireEvent.click(screen.getByRole('radio', { name: 'type' }));
    fireEvent.click(screen.getByLabelText('Export'));
    await choose('Language', 'Go');
    expect(output()).toBe(
      'type Root struct {\n\tID    int64  `json:"id"`\n\tName  string `json:"name"`\n\tOwner Owner  `json:"owner"`\n}\n\ntype Owner struct {\n\tLogin string `json:"login"`\n}\n',
    );
    expect(screen.queryByRole('radio', { name: 'type' })).toBeNull();
    expect(screen.queryByLabelText('Export')).toBeNull();
    await choose('Language', 'TypeScript');
    expect(screen.getByRole('radio', { name: 'type' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByLabelText('Export').getAttribute('data-state')).toBe('unchecked');
    expect(output()).toMatch(/^type Root = \{\n/);
  });

  it('§2.3 a list of users: null and a missing key', () => {
    render(<JsonToCodeTool input='[{"id":1,"email":"a@x"},{"id":2,"email":null,"phone":"1"}]' />);
    expect(output()).toBe(
      'export type Root = RootItem[];\n\nexport interface RootItem {\n  id: number;\n  email: string | null;\n  phone?: string;\n}\n',
    );
  });

  it('§2.4 two log lines: the missing keys optional, the note under the result', () => {
    render(<JsonToCodeTool />);
    type('{"event":"login","user":"ann"}\n{"event":"login","ip":"1.2.3.4"}');
    expect(output()).toBe('export interface Root {\n  event: string;\n  user?: string;\n  ip?: string;\n}\n');
    expect(notes()).toEqual(['2 samples merged: keys missing from some of them are optional.']);
    expect(document.querySelector('[data-part="notes"]')!.getAttribute('role')).toBe('status');
  });

  it('§2.5 Root type: user profile', () => {
    render(<JsonToCodeTool input='{"id":1}' />);
    fireEvent.change(root(), { target: { value: 'user profile' } });
    expect(output()).toBe('export interface UserProfile {\n  id: number;\n}\n');
  });

  it('§2.6 an identifier beyond i64: u64 in Rust, uint64 in Go', async () => {
    render(<JsonToCodeTool input='{"id":12345678901234567890}' />);
    await choose('Language', 'Rust');
    expect(output()).toContain('    pub id: u64,\n');
    await choose('Language', 'Go');
    expect(output()).toContain('\tID uint64 `json:"id"`\n');
    await choose('Language', 'Python');
    expect(output()).toBe('from typing import TypedDict\n\n\nclass Root(TypedDict):\n    id: int\n');
  });

  it('§2.7 an error: the result is empty, the line under the input says where, a press puts the caret there', () => {
    render(<JsonToCodeTool />);
    type('{\n  "a": 1,\n  "b": \n}');
    expect(status()).toBe('Line 4, column 1: unexpected "}"');
    // An input error changes while typing: role status, never alert.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(output()).toBe('');
    expect(button('Copy').disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Line 4, column 1: unexpected "}"' }));
    expect(document.activeElement).toBe(input());
    expect([input().selectionStart, input().selectionEnd]).toEqual([20, 20]);
  });

  it('trailing commas and comments are read silently (§3)', () => {
    render(<JsonToCodeTool input={'{\n  // id\n  "id": 1,\n}'} />);
    expect(output()).toBe('export interface Root {\n  id: number;\n}\n');
    expect(status()).toBe('');
  });

  it('a repeated key: the note', () => {
    render(<JsonToCodeTool input='{"a":1,"a":"x"}' />);
    expect(output()).toBe('export interface Root {\n  a: string;\n}\n');
    expect(notes()).toEqual([
      'Duplicate key "a" at line 1, column 8: the type follows its last value, as JSON.parse does.',
    ]);
  });

  it('Copy copies the whole result', async () => {
    const writeText = stubClipboard();
    render(<JsonToCodeTool input='"hello"' />);
    fireEvent.click(button('Copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('export type Root = string;\n'));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('above LIVE_INPUT: no live result, Generate (and Ctrl+Enter) instead; Working… meanwhile', async () => {
    render(<JsonToCodeTool />);
    const large = `[${'{"a":1},'.repeat(Math.ceil(LIVE_INPUT / 8))}{"b":2}]`;
    type(large);
    expect(output()).toBe('');
    expect(status()).toBe('Large input: press Generate (Ctrl+Enter).');
    fireEvent.click(button('Generate'));
    expect(button('Working…').disabled).toBe(true);
    await waitFor(
      () => expect(output()).toContain('export interface RootItem {\n  a?: number;\n  b?: number;\n}'),
      WAIT,
    );
    expect(status()).toBe('');
    // A change makes the result out of date; Ctrl+Enter generates again.
    type(large.replace('"b":2', '"b":"x"'));
    expect(output()).toBe('');
    fireEvent.keyDown(input(), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(output()).toContain('  b?: string;\n'), WAIT);
  });

  it('above MAX_INPUT: refused in words, no Generate', () => {
    render(<JsonToCodeTool />);
    type(' '.repeat(MAX_INPUT) + '{}');
    expect(status()).toBe('Input is larger than 16 MB; paste a smaller sample.');
    expect(screen.queryByRole('button', { name: 'Generate' })).toBeNull();
    expect(output()).toBe('');
  });
});

describe('the JSON to Code tool’s history', () => {
  const entriesOf = async (host: ReturnType<typeof memoryHost>, kinds?: string[]) =>
    (await host.history.forOwner('json-to-code', definition.history!).list(kinds ? { kinds } : {})).entries;

  it('commits Copy and Generate at once, with the sample, the options and the result', async () => {
    stubClipboard();
    const host = memoryHost();
    render(<JsonToCodeTool host={host} />);
    type('{"id": 1}');
    fireEvent.change(root(), { target: { value: 'user' } });
    await choose('Language', 'Go');
    fireEvent.click(button('Copy'));
    await waitFor(async () => expect(await entriesOf(host, ['result'])).toHaveLength(1), WAIT);
    type(`[${'1,'.repeat(Math.ceil(LIVE_INPUT / 2))}1]`);
    fireEvent.click(button('Generate'));
    await waitFor(async () => expect(await entriesOf(host, ['result'])).toHaveLength(2), WAIT);
    const labels = (await entriesOf(host, ['result'])).map(e => e.label);
    expect(labels).toEqual(expect.arrayContaining(['Go · user · copied', 'Go · user · generated']));
    const copied = (await entriesOf(host, ['result'])).find(e => e.label?.endsWith('copied'))!;
    const opened = await host.history.forOwner('json-to-code', definition.history!).open(copied.id);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.payload).toEqual({
      language: 'go',
      rootName: 'user',
      declaration: 'interface',
      exportTypes: true,
      action: 'copy',
      ok: true,
      samples: 1,
    });
    expect(await opened.blobs.input!.text()).toBe('{"id": 1}');
    expect(await opened.blobs.output!.text()).toBe('type User struct {\n\tID int64 `json:"id"`\n}\n');
  });

  it('records an edit as a snapshot (change)', async () => {
    const host = memoryHost();
    const { unmount } = render(<JsonToCodeTool host={host} />);
    type('{"x": 2}');
    unmount();
    await waitFor(async () => expect((await entriesOf(host, ['edit'])).length).toBeGreaterThan(0), WAIT);
    const [edit] = await entriesOf(host, ['edit']);
    expect(edit!.label).toBe('Edit · TypeScript · 8 characters');
  });

  it('opens an entry back into the tool: the sample, the language and every option', async () => {
    stubClipboard();
    const host = memoryHost();
    const first = render(<JsonToCodeTool host={host} />);
    fireEvent.click(screen.getByRole('radio', { name: 'type' }));
    fireEvent.click(screen.getByLabelText('Export'));
    fireEvent.change(root(), { target: { value: 'event' } });
    type('{"a": 1} {"b": 2}');
    fireEvent.click(button('Copy'));
    await waitFor(async () => expect(await entriesOf(host, ['result'])).toHaveLength(1), WAIT);
    first.unmount();
    await act(async () => undefined);
    const [entry] = await entriesOf(host, ['result']);
    expect(entry!.label).toBe('TypeScript · event · copied');

    render(<JsonToCodeTool host={host} restore={{ id: entry!.id }} />);
    expect(await screen.findByText(`Opened from History: ${entry!.label}.`)).toBeTruthy();
    expect(input().value).toBe('{"a": 1} {"b": 2}');
    expect(root().value).toBe('event');
    expect(screen.getByRole('radio', { name: 'type' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByLabelText('Export').getAttribute('data-state')).toBe('unchecked');
    expect(output()).toBe('type Event = {\n  a?: number;\n  b?: number;\n};\n');
    expect(notes()).toEqual(['2 samples merged: keys missing from some of them are optional.']);
  });

  it('an entry with an error opens with its error', async () => {
    const host = memoryHost();
    const session = host.history.forOwner('json-to-code', jsonToCodeHistory).session();
    await session.commit({
      kind: 'edit',
      payload: { language: 'rust', rootName: '', declaration: 'interface', exportTypes: true },
      label: 'Edit · Rust · 5 characters',
      blobs: { input: new Blob(['{"a":']) },
    });
    await session.end();
    const [entry] = await entriesOf(host);
    render(<JsonToCodeTool host={host} restore={{ id: entry!.id }} />);
    await waitFor(() => expect(input().value).toBe('{"a":'));
    expect(screen.getByLabelText('Language').textContent).toContain('Rust');
    expect(status()).toBe('Line 1, column 6: unexpected end of input, expected a value');
  });

  it('an entry of a newer schema is refused in words', async () => {
    const host = memoryHost();
    const newer = host.history.forOwner('json-to-code', { ...jsonToCodeHistory, schema: 2 }).session();
    await newer.commit({ kind: 'edit', payload: {}, label: 'From the future', blobs: { input: new Blob(['[]']) } });
    await newer.end();
    const [entry] = await entriesOf(host);
    render(<JsonToCodeTool host={host} restore={{ id: entry!.id }} />);
    expect(await screen.findByText('This entry was kept by a newer version of the tool.')).toBeTruthy();
  });
});
