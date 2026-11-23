/**
 * The YAML and JSON tool's page (docs/tools/specs/yaml-json.md §2, §6, §8) in jsdom: there are no workers here, so the
 * conversion runs on the page (conversion.ts) — the same converter the worker loads.
 */
import { definition } from './definition';
import { detect } from './detect';
import { yamlJsonSettings } from './settings';
import YamlJsonTool from './YamlJsonTool';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LIVE_INPUT, MAX_INPUT } from '@workspace/tool-logic-yaml-json';
import { memoryHost } from '@workspace/tools-host';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolHost } from '@workspace/tools-host';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const input = () => document.getElementById('yaml-json-input') as HTMLTextAreaElement;
const output = () => (document.getElementById('yaml-json-output') as HTMLTextAreaElement | null)?.value ?? null;
const type = (value: string) => fireEvent.change(input(), { target: { value } });
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const status = () => document.querySelector('[data-part="status"]')!.textContent!.trim();
const notes = () =>
  [...document.querySelectorAll('[data-part="note"]')].map(n => n.textContent!.trim()).filter(Boolean);
const direction = (name: 'YAML → JSON' | 'JSON → YAML') => fireEvent.click(screen.getByRole('radio', { name }));
const choose = async (label: string, option: string) => {
  const trigger = screen.getByLabelText(label);
  fireEvent.keyDown(trigger, { key: 'Enter' });
  const item = await screen.findByRole('option', { name: option });
  fireEvent.keyDown(item, { key: 'Enter' });
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
};
// Generous: the conversion runs on the page here, and the machine may be busy.
const WAIT = { timeout: 10_000 };
const result = async (expected: string) => waitFor(() => expect(output()).toBe(expected), WAIT);
const said = async (expected: string) => waitFor(() => expect(status()).toBe(expected), WAIT);

const LOST = 'JSON has no comments, anchors, tags or YAML styles: they are not carried over.';

describe('the YAML and JSON tool’s definition', () => {
  it('describes the tool, recognises YAML and loads its component', async () => {
    expect(definition).toMatchObject({
      id: 'yaml-json',
      title: 'YAML and JSON',
      summary: 'Convert YAML to JSON and back, with the line and column of every error.',
      order: 11,
      output: { origin: 'input' },
    });
    expect(definition.shortcut).toBeUndefined();
    expect(definition.keywords).toContain('docker compose');
    expect(detect('apiVersion: v1\nkind: Pod')).toBe(true);
    expect(detect('{"a": 1}')).toBe(false);
    expect(definition.history?.kinds.map(k => k.id)).toEqual(['to-json', 'to-yaml']);
    expect(definition.history?.kinds.some(k => k.secret)).toBe(false);
    expect((await definition.load()).default).toBe(YamlJsonTool);
  });
});

describe('the YAML and JSON tool, rendered with no host', () => {
  it('starts empty: YAML → JSON, 1.2, 2 spaces, no messages, Copy, Save and Swap off (§6, §8)', () => {
    render(<YamlJsonTool />);
    expect(screen.getByRole('radio', { name: 'YAML → JSON' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByLabelText('YAML version').textContent).toContain('YAML 1.2');
    expect(screen.getByLabelText('Indent').textContent).toContain('2 spaces');
    expect(screen.getByLabelText('YAML')).toBe(input());
    expect(input().placeholder).toBe('key: value');
    expect(input().getAttribute('spellcheck')).toBe('false');
    expect(screen.getByLabelText('JSON').getAttribute('spellcheck')).toBe('false');
    expect((screen.getByLabelText('JSON') as HTMLTextAreaElement).readOnly).toBe(true);
    expect(status()).toBe('');
    expect(notes()).toEqual([]);
    for (const name of ['Copy', 'Save', 'Swap']) expect(button(name).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull();
  });

  it('§2.1 a manifest becomes JSON with 2 spaces and the note of what is lost', async () => {
    render(<YamlJsonTool input={'apiVersion: v1\nkind: Pod\nmetadata:\n  name: web'} />);
    await result('{\n  "apiVersion": "v1",\n  "kind": "Pod",\n  "metadata": {\n    "name": "web"\n  }\n}');
    expect(status()).toBe('Valid YAML');
    expect(notes()).toEqual([LOST]);
    expect(button('Copy').disabled).toBe(false);
  });

  it('§2.2 YAML 1.1: the key on stays "on", the value on becomes true', async () => {
    render(<YamlJsonTool />);
    type('on: on');
    await result('{\n  "on": "on"\n}');
    await choose('YAML version', 'YAML 1.1');
    await result('{\n  "on": true\n}');
  });

  it('§2.3 merge keys apply, with their note', async () => {
    render(<YamlJsonTool />);
    await choose('Indent', 'Minified');
    type('x-defaults: &defaults\n  restart: always\n  image: app\nweb:\n  <<: *defaults\n  image: web\n');
    await result('{"x-defaults":{"restart":"always","image":"app"},"web":{"restart":"always","image":"web"}}');
    expect(notes()).toEqual([LOST, 'Aliases were expanded and merge keys (<<) applied: JSON has no references.']);
  });

  it('§2.4 a broken indent: the error is a link that puts the cursor there; the result is empty', async () => {
    render(<YamlJsonTool />);
    type('a:\n  b: 1\n c: 2');
    await said('Line 3, column 1: All mapping items must start at the same column');
    expect(output()).toBe('');
    expect(button('Copy').disabled).toBe(true);
    expect(button('Swap').disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /^Line 3, column 1/ }));
    expect(document.activeElement).toBe(input());
    expect(input().selectionStart).toBe(10);
    // Never an alert: the line changes while the person types.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('§2.5 JSON → YAML keeps numbers and key order as in JSON', async () => {
    render(<YamlJsonTool />);
    direction('JSON → YAML');
    expect(screen.getByLabelText('JSON')).toBe(input());
    expect(input().placeholder).toBe('{"key": "value"}');
    expect(screen.queryByLabelText('YAML version')).toBeNull();
    type('{"id":12345678901234567890,"price":1.50,"b":1,"2":2}');
    await result('id: 12345678901234567890\nprice: 1.50\nb: 1\n"2": 2\n');
    expect(status()).toBe('Valid JSON');
    expect(notes()).toEqual([
      "1 number is kept as written but can't be held exactly by a double (RFC 8259 §6): JSON.parse in JavaScript would change it.",
    ]);
    await choose('Indent', '4 spaces');
    type('{"a":{"b":1}}');
    await result('a:\n    b: 1\n');
  });

  it('§2.6 the string "yes" is quoted in YAML', async () => {
    render(<YamlJsonTool />);
    direction('JSON → YAML');
    type('{"answer":"yes"}');
    await result('answer: "yes"\n');
  });

  it('§2.7 three documents become an array, with a note', async () => {
    render(<YamlJsonTool />);
    await choose('Indent', 'Minified');
    type('a: 1\n---\nb: 2\n---\nc: 3');
    await result('[{"a":1},{"b":2},{"c":3}]');
    expect(notes()).toContain('3 YAML documents became a JSON array of 3 items.');
  });

  it('§2.8 an alias bomb is refused with its place', async () => {
    const lines = [`a: &a [${Array(9).fill('"lol"').join(', ')}]`];
    for (const [prev, name] of [...'abcdefgh'].map((c, i) => [c, 'bcdefghi'[i]!]))
      lines.push(`${name}: &${name} [${Array(9).fill(`*${prev}`).join(', ')}]`);
    render(<YamlJsonTool />);
    type(lines.join('\n'));
    await said('Line 7, column 8: aliases expand to more than 1,000,000 nodes: refusing (an alias bomb?)');
    expect(output()).toBe('');
  });

  it('only a comment: no document, no error', async () => {
    render(<YamlJsonTool />);
    type('# only a comment');
    await said('No YAML document.');
    expect(output()).toBe('');
    expect(notes()).toEqual([]);
  });

  it('several errors: the first, and how many more', async () => {
    render(<YamlJsonTool />);
    type('k: 🙂🙂\n  bad: : x\n');
    await said('Line 1, column 4: Nested mappings are not allowed in compact mappings (and 2 more)');
  });

  it('a JSON error with its place', async () => {
    render(<YamlJsonTool />);
    direction('JSON → YAML');
    type('{"a":1,"a":2}');
    await said('Line 1, column 8: duplicate key "a": YAML requires unique keys');
  });

  it('Tab and Minified for JSON; the indent list follows the direction', async () => {
    render(<YamlJsonTool />);
    type('a: [1]');
    await choose('Indent', 'Tab');
    await result('{\n\t"a": [\n\t\t1\n\t]\n}');
    direction('JSON → YAML');
    fireEvent.keyDown(screen.getByLabelText('Indent'), { key: 'Enter' });
    const options = (await screen.findAllByRole('option')).map(o => o.textContent);
    expect(options).toEqual(['2 spaces', '4 spaces']);
  });

  it('copies, saves and swaps the result', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const created: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      created.push(blob);
      return 'blob:converted';
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<YamlJsonTool />);
    type('a: 1');
    await result('{\n  "a": 1\n}');
    fireEvent.click(button('Copy'));
    await act(async () => undefined);
    expect(writeText).toHaveBeenCalledWith('{\n  "a": 1\n}');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
    fireEvent.click(button('Save'));
    expect(click).toHaveBeenCalledTimes(1);
    const link = click.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(link.download).toBe('converted.json');
    expect(await created[0]!.text()).toBe('{\n  "a": 1\n}');
    fireEvent.click(button('Swap'));
    expect(input().value).toBe('{\n  "a": 1\n}');
    expect(screen.getByRole('radio', { name: 'JSON → YAML' }).getAttribute('aria-checked')).toBe('true');
    await result('a: 1\n');
    fireEvent.click(button('Save'));
    expect((click.mock.instances[1] as unknown as HTMLAnchorElement).download).toBe('converted.yaml');
  });

  it('opens a file: .json turns to JSON → YAML; not UTF-8 is refused', async () => {
    render(<YamlJsonTool />);
    const picker = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(picker.accept).toBe('.yaml,.yml,.json,application/json,application/yaml');
    const file = new File(['{"a":[1,2]}'], 'data.json', { type: 'application/json' });
    fireEvent.change(picker, { target: { files: [file] } });
    await waitFor(() => expect(input().value).toBe('{"a":[1,2]}'));
    expect(screen.getByRole('radio', { name: 'JSON → YAML' }).getAttribute('aria-checked')).toBe('true');
    await result('a:\n  - 1\n  - 2\n');
    fireEvent.change(picker, { target: { files: [new File([new Uint8Array([0xff, 0xfe])], 'bad.yaml')] } });
    await said('The file is not valid UTF-8 text.');
    const yaml = new File(['\uFEFFa: 1\r\nb: 2\r\n'], 'conf.yml');
    fireEvent.change(picker, { target: { files: [yaml] } });
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'YAML → JSON' }).getAttribute('aria-checked')).toBe('true'),
    );
    await result('{\n  "a": 1,\n  "b": 2\n}');
  });

  it('a large input waits for Run (or Ctrl+Enter); 8 Mi + 1 is refused at once (§6, §12)', async () => {
    render(<YamlJsonTool />);
    const big = `list:\n${'  - item\n'.repeat(Math.ceil(LIVE_INPUT / 9) + 1)}`;
    type(big);
    await said('Large input: press Run (Ctrl+Enter) to convert it.');
    expect(output()).toBe('');
    fireEvent.click(button('Run'));
    await waitFor(() => expect(output()!.startsWith('{\n  "list": [\n    "item",')).toBe(true), WAIT);
    expect(status()).toBe('Valid YAML');
    type(`${big}  - other\n`);
    await said('Large input: press Run (Ctrl+Enter) to convert it.');
    fireEvent.keyDown(input(), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(output()!.endsWith('"other"\n  ]\n}')).toBe(true), WAIT);
    type('x'.repeat(MAX_INPUT + 1));
    expect(status()).toBe('Input is larger than 8 MB. This tool converts up to 8 MB.');
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull();
  }, 60_000);

  it('a result too large to show is a summary; Copy still has it', async () => {
    render(<YamlJsonTool />);
    direction('JSON → YAML');
    type(`[${Array(200_001).fill('1').join(',')}]`);
    fireEvent.click(button('Run'));
    await waitFor(() => expect(document.querySelector('[data-part="summary"]')).toBeTruthy(), WAIT);
    expect(document.querySelector('[data-part="summary"]')!.textContent).toBe(
      'Result: 781.3 KB, 200,002 lines. Too large to show here.',
    );
    expect(output()).toBeNull();
    expect(button('Copy').disabled).toBe(false);
  }, 60_000);
});

describe('the YAML and JSON tool’s history', () => {
  const entriesOf = async (host: ReturnType<typeof memoryHost>, kinds?: string[]) =>
    (await host.history.forOwner('yaml-json', definition.history!).list(kinds ? { kinds } : {})).entries;

  /** The entries once the history has stopped changing (two equal counts 60 ms apart). */
  const settled = async (host: Parameters<typeof entriesOf>[0]): Promise<Awaited<ReturnType<typeof entriesOf>>> => {
    let before = -1;
    for (;;) {
      const now = await entriesOf(host);
      if (now.length === before) return now;
      before = now.length;
      await new Promise(resolve => setTimeout(resolve, 60));
    }
  };

  it('records an edit as a snapshot when the page goes away', async () => {
    const host = memoryHost();
    const { unmount } = render(<YamlJsonTool host={host} />);
    type('a: 1');
    await result('{\n  "a": 1\n}');
    unmount();
    await waitFor(async () => expect(await entriesOf(host, ['to-json'])).toHaveLength(1), WAIT);
    expect((await entriesOf(host))[0]!.label).toBe('YAML 1.2 → JSON · 2 spaces · 4 characters');
  });

  it('commits Copy, Save and Swap at once, with the input, the options and the result', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.resolve() },
    });
    URL.createObjectURL = vi.fn(() => 'blob:x') as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const host = memoryHost();
    render(<YamlJsonTool host={host} />);
    direction('JSON → YAML');
    type('{"id":12345678901234567890}');
    await result('id: 12345678901234567890\n');
    fireEvent.click(button('Copy'));
    await waitFor(async () => expect(await entriesOf(host, ['to-yaml'])).toHaveLength(1), WAIT);
    fireEvent.click(button('Save'));
    await waitFor(async () => expect(await entriesOf(host, ['to-yaml'])).toHaveLength(2), WAIT);
    fireEvent.click(button('Swap'));
    await waitFor(async () => expect(await entriesOf(host, ['to-yaml'])).toHaveLength(3), WAIT);
    const labels = (await entriesOf(host)).map(e => e.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        'JSON → YAML · 2 spaces · 27 characters · copied',
        'JSON → YAML · 2 spaces · 27 characters · saved',
        'JSON → YAML · 2 spaces · 27 characters · swapped',
      ]),
    );
    const history = host.history.forOwner('yaml-json', definition.history!);
    const copied = (await entriesOf(host)).find(e => e.label?.endsWith('copied'))!;
    const opened = await history.open(copied.id);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.payload).toMatchObject({ direction: 'json-to-yaml', indent: 2, outcome: 'ok', action: 'copy' });
    expect(await opened.blobs.input!.text()).toBe('{"id":12345678901234567890}');
    expect(await opened.blobs.output!.text()).toBe('id: 12345678901234567890\n');
  });

  it('opens an entry back into the tool: input, direction, version, indent; opening records nothing', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.resolve() },
    });
    const host = memoryHost();
    const first = render(<YamlJsonTool host={host} />);
    await choose('YAML version', 'YAML 1.1');
    await choose('Indent', 'Minified');
    type('a: on');
    await result('{"a":true}');
    fireEvent.click(button('Copy'));
    await waitFor(async () => expect(await entriesOf(host, ['to-json'])).toHaveLength(1), WAIT);
    first.unmount();
    await act(async () => undefined);
    // An unmounted page ends its history session asynchronously: count the entries once they have stopped arriving,
    // or a slow machine counts one too few here and blames the reopening below for it.
    const entries = await settled(host);
    const copied = entries.find(e => e.label?.endsWith('copied'))!;
    expect(copied.label).toBe('YAML 1.1 → JSON · Minified · 5 characters · copied');

    const second = render(<YamlJsonTool host={host} restore={{ id: copied.id }} />);
    expect(await screen.findByText(`Opened from History: ${copied.label}.`)).toBeTruthy();
    expect(input().value).toBe('a: on');
    expect(screen.getByLabelText('YAML version').textContent).toContain('YAML 1.1');
    expect(screen.getByLabelText('Indent').textContent).toContain('Minified');
    await result('{"a":true}');
    second.unmount();
    await act(async () => undefined);
    expect(await settled(host)).toHaveLength(entries.length);
  });

  it('records text handed over from the start page as the visit’s first edit', async () => {
    const host = memoryHost();
    const { unmount } = render(<YamlJsonTool host={host} input={'a: 1\nb: 2'} />);
    await result('{\n  "a": 1,\n  "b": 2\n}');
    unmount();
    await waitFor(async () => expect(await entriesOf(host, ['to-json'])).toHaveLength(1), WAIT);
  });
});

describe('the YAML and JSON tool’s saved parameters (D21, docs/tools/settings.md)', () => {
  const savedOf = (host: ToolHost) => host.settings!.forTool('yaml-json').saved();
  const seed = async (host: ToolHost, values: Record<string, unknown>) => {
    host.settings!.forTool('yaml-json').save(yamlJsonSettings.schema, values as never);
    await host.settings!.forTool('yaml-json').flush();
  };
  const current = () =>
    (['YAML → JSON', 'JSON → YAML'] as const).find(
      name => screen.getByRole('radio', { name }).getAttribute('aria-checked') === 'true',
    );
  const shown = (label: string) => screen.getByLabelText(label).textContent;

  it('saves the direction, the version and both indents the person chose; reopened, it is as left', async () => {
    const host = memoryHost();
    const first = render(<YamlJsonTool host={host} />);
    direction('JSON → YAML');
    await choose('Indent', '4 spaces');
    direction('YAML → JSON');
    await choose('YAML version', 'YAML 1.1');
    await choose('Indent', 'Tab');
    first.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { version: '1.1', jsonIndent: 'tab', yamlIndent: 4 } });

    const second = render(<YamlJsonTool host={host} />);
    expect(current()).toBe('YAML → JSON');
    expect(shown('YAML version')).toContain('YAML 1.1');
    expect(shown('Indent')).toContain('Tab');
    type('a: 1');
    await result('{\n\t"a": 1\n}');
    // Swap is the person's change of direction: saved too.
    fireEvent.click(button('Swap'));
    expect(current()).toBe('JSON → YAML');
    second.unmount();
    expect(savedOf(host)).toEqual({
      schema: 1,
      values: { direction: 'json-to-yaml', version: '1.1', jsonIndent: 'tab', yamlIndent: 4 },
    });

    render(<YamlJsonTool host={host} />);
    expect(current()).toBe('JSON → YAML');
    expect(shown('Indent')).toContain('4 spaces');
    expect(input().value).toBe('');
  });

  it('a saved record it cannot show falls back field by field', async () => {
    const host = memoryHost();
    await seed(host, { direction: 'sideways', version: '1.1', jsonIndent: 3, yamlIndent: 'tab' });
    render(<YamlJsonTool host={host} />);
    expect(current()).toBe('YAML → JSON');
    expect(shown('YAML version')).toContain('YAML 1.1');
    expect(shown('Indent')).toContain('2 spaces');
    direction('JSON → YAML');
    expect(shown('Indent')).toContain('2 spaces');
  });

  it('a handed-over text, a file and an opened entry choose for the visit; what is saved stays', async () => {
    const host = memoryHost();
    const kept = { direction: 'json-to-yaml', jsonIndent: 4, yamlIndent: 4 };
    await seed(host, kept);
    // Text from the start page is YAML (detect): YAML → JSON, with the saved JSON indent.
    const pasted = render(<YamlJsonTool host={host} input="a: 1" />);
    expect(current()).toBe('YAML → JSON');
    await result('{\n    "a": 1\n}');
    pasted.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: kept });

    const filed = render(<YamlJsonTool host={host} />);
    expect(current()).toBe('JSON → YAML');
    const picker = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(picker, { target: { files: [new File(['a: 1'], 'conf.yaml')] } });
    await waitFor(() => expect(current()).toBe('YAML → JSON'));
    filed.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: kept });

    await host.history
      .forOwner('yaml-json', definition.history!)
      .session()
      .commit({
        kind: 'to-json',
        label: 'YAML 1.1 → JSON · Minified · 5 characters · copied',
        payload: {
          direction: 'yaml-to-json',
          version: '1.1',
          layout: 'minify',
          indent: 2,
          outcome: 'ok',
          action: 'copy',
        },
        blobs: { input: new Blob(['a: on']) },
      });
    const [entry] = (await host.history.forOwner('yaml-json', definition.history!).list({})).entries;
    const opened = render(<YamlJsonTool host={host} restore={{ id: entry!.id }} />);
    expect(await screen.findByText(/^Opened from History/)).toBeTruthy();
    expect(current()).toBe('YAML → JSON');
    expect(shown('YAML version')).toContain('YAML 1.1');
    expect(shown('Indent')).toContain('Minified');
    await result('{"a":true}');
    opened.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: kept });

    render(<YamlJsonTool host={host} />);
    expect(current()).toBe('JSON → YAML');
    expect(shown('Indent')).toContain('4 spaces');
  });

  it('reset puts the direction and the options back to the defaults and keeps the input; the result follows', async () => {
    const host = memoryHost();
    await seed(host, { direction: 'json-to-yaml', version: '1.1', yamlIndent: 4 });
    render(<YamlJsonTool host={host} />);
    type('{"a":[1]}');
    await result('a:\n    - 1\n');
    await act(async () => host.settings!.forTool('yaml-json').reset());
    expect(current()).toBe('YAML → JSON');
    expect(shown('YAML version')).toContain('YAML 1.2');
    expect(shown('Indent')).toContain('2 spaces');
    expect(input().value).toBe('{"a":[1]}');
    await result('{\n  "a": [\n    1\n  ]\n}');
    expect(savedOf(host)).toBeUndefined();
  });
});
