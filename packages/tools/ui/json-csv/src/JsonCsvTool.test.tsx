/**
 * The JSON and CSV tool's page (docs/tools/specs/json-csv.md §2, §3, §6, §8) in jsdom: there are no workers here, so
 * Run converts on the page (runner.ts) — the same work the worker does. And its history: edits as snapshots, Copy, Save
 * and Swap at once, nothing for a table over 256 Ki characters, an entry opened back with its direction and options.
 */
import { definition } from './definition';
import { detect } from './detect';
import { jsonCsvHistory } from './history';
import JsonCsvTool from './JsonCsvTool';
import { jsonCsvSettings } from './settings';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MAX_INPUT } from '@workspace/tool-logic-json-csv';
import { memoryHost } from '@workspace/tools-host';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const input = () => document.getElementById('json-csv-input') as HTMLTextAreaElement;
const output = () => (document.getElementById('json-csv-output') as HTMLTextAreaElement | null)?.value ?? null;
/** A text area shows (and gives back) CRLF as LF; Copy and Save take the result as it is. */
const shown = (text: string) => text.replaceAll('\r\n', '\n');
const type = (value: string) => fireEvent.change(input(), { target: { value } });
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const status = () => document.querySelector('[data-part="status"]')!.textContent!.trim();
const notes = () =>
  [...document.querySelectorAll('[data-part="note"]')].map(n => n.textContent!.trim()).filter(Boolean);
const summary = () => document.querySelector('[data-part="summary"]')?.textContent ?? null;
const direction = (name: 'JSON → CSV' | 'CSV → JSON') => fireEvent.click(screen.getByRole('radio', { name }));
const check = (label: string) => fireEvent.click(screen.getByLabelText(label));
const checked = (label: string) => screen.getByLabelText(label).getAttribute('data-state') === 'checked';
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
const stubSave = () => {
  const blobs: Blob[] = [];
  URL.createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob);
    return 'blob:x';
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  return { blobs, names: () => click.mock.instances.map(a => (a as unknown as HTMLAnchorElement).download) };
};

describe('the JSON and CSV tool’s definition', () => {
  it('describes the tool, recognises CSV from its own module and loads its component', async () => {
    expect(definition).toMatchObject({
      id: 'json-csv',
      title: 'JSON and CSV',
      summary: 'Turn a JSON array into CSV for a spreadsheet, and CSV back into JSON.',
      order: 22,
      output: { origin: 'input' },
    });
    expect(definition.keywords).toEqual([
      'csv',
      'tsv',
      'json',
      'json to csv',
      'csv to json',
      'excel',
      'spreadsheet',
      'table',
      'export',
      'delimiter',
    ]);
    expect(definition.shortcut).toBeUndefined();
    expect(definition.history).toBe(jsonCsvHistory);
    expect(definition.history?.kinds.map(k => k.id)).toEqual(['to-csv', 'to-json']);
    expect(definition.history?.kinds.some(k => k.secret)).toBe(false);
    expect(detect('id,name\n1,Ann\n2,Bob')).toBe(true);
    expect(detect('[{"a":1}]')).toBe(false);
    expect(detect('')).toBe(false);
    expect((await definition.load()).default).toBe(JsonCsvTool);
  });
});

describe('the JSON and CSV tool, rendered with no host', () => {
  it('starts empty: JSON → CSV, Comma, Header row, Flatten, CRLF, Protect from formulas; Copy and Save off (§4, §8)', () => {
    render(<JsonCsvTool />);
    expect(screen.getByRole('radio', { name: 'JSON → CSV' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByLabelText('Direction').getAttribute('data-slot')).toBe('toggle-group');
    expect(screen.getByLabelText('Delimiter').textContent).toContain('Comma');
    expect(screen.getByLabelText('Line breaks').textContent).toContain('CRLF');
    expect(checked('Header row')).toBe(true);
    expect(checked('Flatten nested objects')).toBe(true);
    expect(checked('Quote all fields')).toBe(false);
    expect(checked('Protect from formulas')).toBe(true);
    expect(checked('Add BOM (for Excel)')).toBe(false);
    expect(screen.queryByLabelText('Detect types')).toBeNull();
    expect(screen.getByLabelText('JSON')).toBe(input());
    expect(input().placeholder).toBe('[{"id": 1, "name": "Ann"}]');
    expect(input().getAttribute('spellcheck')).toBe('false');
    const result = screen.getByLabelText('CSV') as HTMLTextAreaElement;
    expect(result.readOnly).toBe(true);
    expect(result.getAttribute('spellcheck')).toBe('false');
    expect(status()).toBe('');
    expect(notes()).toEqual([]);
    for (const name of ['Copy', 'Save', 'Swap']) expect(button(name).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull();
    expect(picker().accept).toBe('.json,.csv,.tsv,.txt,application/json,text/csv');
    type('  \n\t ');
    expect(status()).toBe('');
    expect(output()).toBe('');
  });

  it('CSV → JSON shows its own options: Auto, Detect types, Empty cells null, 2 spaces; the panes swap names', () => {
    render(<JsonCsvTool />);
    direction('CSV → JSON');
    expect(screen.getByLabelText('Delimiter').textContent).toContain('Auto');
    expect(checked('Detect types')).toBe(true);
    expect(screen.getByLabelText('Empty cells').textContent).toContain('null');
    expect(checked('Nest dotted headers')).toBe(false);
    expect(screen.getByLabelText('Indent').textContent).toContain('2 spaces');
    expect(screen.queryByLabelText('Flatten nested objects')).toBeNull();
    expect(screen.getByLabelText('CSV')).toBe(input());
    expect(input().placeholder).toBe('id,name\n1,Ann');
    expect(screen.getByLabelText('JSON').tagName).toBe('TEXTAREA');
  });

  it('§2.1 an API answer: columns by first appearance, Bob’s city empty, the size note; Save gives converted.csv', () => {
    const saved = stubSave();
    render(<JsonCsvTool />);
    type('[{"id":1,"name":"Ann","address":{"city":"Paris"}},{"id":2,"name":"Bob"}]');
    expect(output()).toBe('id,name,address.city\n1,Ann,Paris\n2,Bob,\n');
    expect(status()).toBe('Valid JSON');
    expect(document.querySelector('[data-part="status"]')!.getAttribute('role')).toBe('status');
    expect(notes()[0]).toBe('2 rows × 3 columns.');
    fireEvent.click(button('Save'));
    expect(saved.names()).toEqual(['converted.csv']);
    expect(saved.blobs[0]!.type).toBe('text/csv');
  });

  it('§2.2 Semicolon and Add BOM: the BOM goes into the saved file only, never into Copy', async () => {
    const writeText = stubClipboard();
    const saved = stubSave();
    render(<JsonCsvTool />);
    type('[{"price":"1,5","name":"x"}]');
    await choose('Delimiter', 'Semicolon');
    check('Add BOM (for Excel)');
    expect(output()).toBe(shown('price;name\r\n1,5;x\r\n'));
    fireEvent.click(button('Copy'));
    await act(async () => undefined);
    expect(writeText).toHaveBeenCalledWith('price;name\r\n1,5;x\r\n');
    fireEvent.click(button('Save'));
    // The bytes: a UTF-8 decoder would drop the very mark asked about.
    const bytes = new Uint8Array(await saved.blobs[0]!.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes)).toBe('price;name\r\n1,5;x\r\n');
    // A tab-separated file is saved as .tsv.
    await choose('Delimiter', 'Tab');
    fireEvent.click(button('Save'));
    expect(saved.names()).toEqual(['converted.csv', 'converted.tsv']);
    expect(saved.blobs[1]!.type).toBe('text/tab-separated-values');
  });

  it('§2.3 a formula is prefixed and the note says so; turned off, the note warns instead', () => {
    render(<JsonCsvTool />);
    type('[{"comment":"=HYPERLINK(\\"http://x\\")"}]');
    expect(output()).toBe(shown('comment\r\n"\'=HYPERLINK(""http://x"")"\r\n'));
    expect(notes()).toContain(
      "1 cell starts with = + - @ or a tab and was prefixed with ' so spreadsheets show it as text.",
    );
    check('Protect from formulas');
    expect(output()).toBe(shown('comment\r\n"=HYPERLINK(""http://x"")"\r\n'));
    expect(notes()).toContain(
      '1 cell starts with = + - @ or a tab: a spreadsheet may run it as a formula (turn on "Protect from formulas").',
    );
  });

  it('§2.4 a zip code keeps its leading zero, a quantity is a number; Valid CSV with its size', () => {
    render(<JsonCsvTool />);
    direction('CSV → JSON');
    type('zip,qty\n01234,3\n');
    expect(output()).toBe('[\n  {\n    "zip": "01234",\n    "qty": 3\n  }\n]');
    expect(status()).toBe('Valid CSV: 1 row × 2 columns');
    expect(notes()).toEqual(['Detected delimiter: comma.']);
  });

  it('§2.5 text handed over from the start page is CSV: CSV → JSON at once, the semicolon detected', () => {
    render(<JsonCsvTool input={'name;price\nTea;1,5\nCoffee;2,0'} />);
    expect(screen.getByRole('radio', { name: 'CSV → JSON' }).getAttribute('aria-checked')).toBe('true');
    expect(notes()).toEqual(['Detected delimiter: semicolon.']);
    expect(JSON.parse(output()!)).toEqual([
      { name: 'Tea', price: '1,5' },
      { name: 'Coffee', price: '2,0' },
    ]);
  });

  it('§2.6 an unclosed quote: the line under the input says where, a press puts the caret there', () => {
    render(<JsonCsvTool />);
    direction('CSV → JSON');
    type('a,b\n"x,1');
    expect(status()).toBe('Line 2, column 1: unclosed quote: the field never ends');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(output()).toBe('');
    expect(button('Copy').disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Line 2, column 1: unclosed quote: the field never ends' }));
    expect(document.activeElement).toBe(input());
    expect([input().selectionStart, input().selectionEnd]).toEqual([4, 4]);
  });

  it('§2.7 long identifiers keep their digits, with the note on inexact numbers', () => {
    render(<JsonCsvTool />);
    type('[{"id":12345678901234567890}]');
    expect(output()).toBe(shown('id\r\n12345678901234567890\r\n'));
    expect(notes()).toContain(
      "1 number is kept as written but can't be held exactly by a double (RFC 8259 §6): JSON.parse in JavaScript would change it.",
    );
  });

  it('§6 the errors next to the field, with the scanner’s words for JSON', () => {
    render(<JsonCsvTool />);
    const cases: Array<[string, string]> = [
      ['42', 'Line 1, column 1: expected an array of objects, an array of arrays or one object'],
      [
        '[{"a":1},[1,2]]',
        'Line 1, column 10: every item must be of one kind: the first is an object, this one is an array',
      ],
      ['[{"a":1,"a":2}]', 'Line 1, column 9: duplicate key "a": a row can\'t have two values for one column'],
      [
        '[{"a.b":1,"a":{"b":2}}]',
        'Line 1, column 16: two values for column "a.b" in one row (a key with a dot and a nested object?)',
      ],
      ['[{"a":1},]', 'Line 1, column 10: trailing comma'],
    ];
    for (const [text, words] of cases) {
      type(text);
      expect(status()).toBe(words);
    }
    type('[]');
    expect(output()).toBe('');
    expect(notes()).toEqual(['The JSON array is empty.']);
    direction('CSV → JSON');
    type('a,b\n1,2,3');
    expect(status()).toBe('Line 2, column 1: this row has 3 fields, the header has 2');
    type('a,b\n"x"y,1');
    expect(status()).toBe(
      'Line 2, column 4: unexpected text after a closing quote (a quote inside a field must be doubled: "")',
    );
    check('Nest dotted headers');
    type('a,a.b\n1,2');
    expect(status()).toBe('Line 1, column 1: column "a" is both a value and the parent of "a.b"');
  });

  it('the options of CSV → JSON change the result: Detect types, Empty cells, Nest, Indent, Header row', async () => {
    render(<JsonCsvTool />);
    direction('CSV → JSON');
    type('id,address.city,n\n1,,7');
    await choose('Indent', 'Minified');
    expect(output()).toBe('[{"id":1,"address.city":null,"n":7}]');
    await choose('Empty cells', 'Leave out');
    expect(output()).toBe('[{"id":1,"n":7}]');
    await choose('Empty cells', 'Empty string');
    check('Nest dotted headers');
    expect(output()).toBe('[{"id":1,"address":{"city":""},"n":7}]');
    check('Detect types');
    expect(output()).toBe('[{"id":"1","address":{"city":""},"n":"7"}]');
    check('Header row');
    expect(output()).toBe('[["id","address.city","n"],["1","","7"]]');
    await choose('Delimiter', 'Semicolon');
    expect(output()).toBe('[["id,address.city,n"],["1,,7"]]');
    expect(notes()).toEqual([]);
  });

  it('the options of JSON → CSV: Flatten, Line breaks, Quote all fields, Header row', async () => {
    render(<JsonCsvTool />);
    type('[{"a":{"b":1}}]');
    check('Flatten nested objects');
    expect(output()).toBe(shown('a\r\n"{""b"":1}"\r\n'));
    await choose('Line breaks', 'LF');
    expect(output()).toBe('a\n"{""b"":1}"\n');
    check('Flatten nested objects');
    check('Quote all fields');
    expect(output()).toBe('"a.b"\n"1"\n');
    check('Header row');
    expect(output()).toBe('"1"\n');
  });

  it('Swap: the result becomes the input, the direction turns, the delimiter goes with it', async () => {
    render(<JsonCsvTool />);
    type('[{"a":1,"b":"x;y"}]');
    await choose('Delimiter', 'Semicolon');
    fireEvent.click(button('Swap'));
    expect(screen.getByRole('radio', { name: 'CSV → JSON' }).getAttribute('aria-checked')).toBe('true');
    expect(input().value).toBe(shown('a;b\r\n1;"x;y"\r\n'));
    expect(screen.getByLabelText('Delimiter').textContent).toContain('Semicolon');
    expect(output()).toBe('[\n  {\n    "a": 1,\n    "b": "x;y"\n  }\n]');
    await choose('Delimiter', 'Auto');
    fireEvent.click(button('Swap'));
    expect(screen.getByRole('radio', { name: 'JSON → CSV' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByLabelText('Delimiter').textContent).toContain('Semicolon');
    expect(output()).toBe(shown('a;b\r\n1;"x;y"\r\n'));
  });

  it('§6, §12 a large input waits for Run (or Ctrl+Enter); 32 Mi + 1 characters are refused', async () => {
    render(<JsonCsvTool />);
    direction('CSV → JSON');
    // 12,000 records of 22 characters: over LIVE_INPUT, and a result that still fits its field.
    const big = `a,b\n${'abcdefghij,klmnopqrst\n'.repeat(12_000)}`;
    type(big);
    expect(status()).toBe('Large input: press Run (Ctrl+Enter) to convert it.');
    expect(output()).toBe('');
    fireEvent.click(button('Run'));
    expect(screen.getByRole('button', { name: 'Working…' })).toHaveProperty('disabled', true);
    await waitFor(() => expect(status()).toBe('Valid CSV: 12,000 rows × 2 columns'), WAIT);
    expect(output()!.startsWith('[\n  {\n    "a": "abcdefghij",')).toBe(true);
    await choose('Indent', 'Minified');
    expect(status()).toBe('Large input: press Run (Ctrl+Enter) to convert it.');
    fireEvent.keyDown(input(), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(output()!.startsWith('[{"a":"abcdefghij","b":"klmnopqrst"},')).toBe(true), WAIT);
    type(`${big}"x`);
    fireEvent.keyDown(input(), { key: 'Enter', metaKey: true });
    await waitFor(() => expect(status()).toBe('Line 12002, column 1: unclosed quote: the field never ends'), WAIT);
    type(`a${' '.repeat(MAX_INPUT)}`);
    expect(status()).toBe('Input is larger than 32 MB. This tool converts up to 32 MB.');
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull();
  });

  it('§2.8, §3 a file too large for the field stays behind a card; a result too large is a summary with Copy', async () => {
    const writeText = stubClipboard();
    render(<JsonCsvTool />);
    // 200,001 lines: more than the field takes (§3), small in bytes.
    const lines = `n\n${'1\n'.repeat(200_000)}`;
    open(new File([lines], 'export.csv', { type: 'text/csv' }));
    await waitFor(() => expect(document.querySelector('[data-part="file"]')).not.toBeNull(), WAIT);
    expect(document.querySelector('[data-part="file"] p')!.textContent).toBe('export.csv — 0.4 MB');
    expect(screen.getByRole('radio', { name: 'CSV → JSON' }).getAttribute('aria-checked')).toBe('true');
    expect(document.getElementById('json-csv-input')).toBeNull();
    expect(status()).toBe('Large input: press Run (Ctrl+Enter) to convert it.');
    fireEvent.click(button('Run'));
    await waitFor(() => expect(status()).toBe('Valid CSV: 200,000 rows × 1 column'), WAIT);
    expect(summary()).toBe('Result: 3.8 MB, 600,002 lines. Too large to show here.');
    expect(output()).toBeNull();
    fireEvent.click(button('Copy'));
    await act(async () => undefined);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect((writeText.mock.calls[0] as unknown as [string])[0].startsWith('[\n  {\n    "n": 1\n  },')).toBe(true);
    // An error in a file is words without a link: there is no field to put the caret in.
    open(new File([`${lines}"x`], 'broken.csv'));
    await waitFor(() => expect(document.querySelector('[data-part="file"] p')!.textContent).toMatch(/^broken\.csv/));
    fireEvent.click(button('Run'));
    await waitFor(() => expect(status()).toBe('Line 200002, column 1: unclosed quote: the field never ends'), WAIT);
    expect(screen.queryByRole('button', { name: /^Line / })).toBeNull();
    fireEvent.click(button('Clear'));
    expect(input().value).toBe('');
    expect(status()).toBe('');
  });

  it('opens a file: .json → JSON → CSV, .tsv → Tab; not UTF-8 and over 32 MiB are refused with their words', async () => {
    render(<JsonCsvTool />);
    direction('CSV → JSON');
    open(new File(['\uFEFF[{"a":1}]'], 'data.json'));
    await waitFor(() => expect(input().value).toBe('[{"a":1}]'));
    expect(screen.getByRole('radio', { name: 'JSON → CSV' }).getAttribute('aria-checked')).toBe('true');
    expect(output()).toBe(shown('a\r\n1\r\n'));
    open(new File(['a\tb\n1\t2'], 'sheet.tsv'));
    await waitFor(() => expect(input().value).toBe('a\tb\n1\t2'));
    expect(screen.getByLabelText('Delimiter').textContent).toContain('Tab');
    expect(notes()).toEqual([]);
    open(new File([new Uint8Array([0x61, 0xff, 0xfe])], 'bad.csv'));
    await waitFor(() =>
      expect(status()).toBe('The file is not valid UTF-8 text. Save it from the spreadsheet as "CSV UTF-8".'),
    );
    const huge = new File(['a'], 'huge.csv');
    Object.defineProperty(huge, 'size', { value: MAX_INPUT + 1 });
    open(huge);
    await waitFor(() => expect(status()).toBe('Input is larger than 32 MB. This tool converts up to 32 MB.'));
  });
});

describe('the JSON and CSV tool’s history', () => {
  const entriesOf = async (host: ReturnType<typeof memoryHost>, kinds?: string[]) =>
    (await host.history.forOwner('json-csv', definition.history!).list(kinds ? { kinds } : {})).entries;

  it('commits Copy, Save and Swap at once, with the input, every option and the result', async () => {
    stubClipboard();
    stubSave();
    const host = memoryHost();
    render(<JsonCsvTool host={host} />);
    type('[{"a":1,"b":"x"}]');
    await choose('Delimiter', 'Semicolon');
    fireEvent.click(button('Copy'));
    await waitFor(async () => expect(await entriesOf(host, ['to-csv'])).toHaveLength(1), WAIT);
    check('Add BOM (for Excel)');
    fireEvent.click(button('Save'));
    await waitFor(async () => expect(await entriesOf(host, ['to-csv'])).toHaveLength(2), WAIT);
    fireEvent.click(button('Swap'));
    await waitFor(async () => expect(await entriesOf(host, ['to-csv'])).toHaveLength(3), WAIT);
    const labels = (await entriesOf(host, ['to-csv'])).map(e => e.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        'JSON → CSV · semicolon · 1 row × 2 columns · copied',
        'JSON → CSV · semicolon · 1 row × 2 columns · saved',
        'JSON → CSV · semicolon · 1 row × 2 columns · swapped',
      ]),
    );
    const history = host.history.forOwner('json-csv', definition.history!);
    const saved = (await entriesOf(host, ['to-csv'])).find(e => e.label?.endsWith('saved'))!;
    const opened = await history.open(saved.id);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.entry.schema).toBe(1);
    expect(opened.payload).toEqual({
      direction: 'to-csv',
      header: true,
      toCsv: { delimiter: ';', flatten: true, newline: 'crlf', quoteAll: false, protectFormulas: true, bom: true },
      toJson: { delimiter: 'auto', detectTypes: true, empty: 'null', nest: false, layout: 2 },
      action: 'save',
      outcome: 'ok',
      rows: 1,
      columns: 2,
    });
    expect(await opened.blobs.input!.text()).toBe('[{"a":1,"b":"x"}]');
    expect(await opened.blobs.output!.text()).toBe('a;b\r\n1;x\r\n');
  });

  it('records an edit as a snapshot (change), and the text handed over from the start page', async () => {
    const host = memoryHost();
    const { unmount } = render(<JsonCsvTool host={host} input={'a,b\n1,2\n3,4'} />);
    type('a,b\n1,2\n3,5');
    unmount();
    await waitFor(async () => expect((await entriesOf(host, ['to-json'])).length).toBeGreaterThan(0), WAIT);
    const [edit] = await entriesOf(host, ['to-json']);
    expect(edit!.label).toBe('CSV → JSON · 2 rows × 2 columns');
  });

  it('records nothing of a table over 256 Ki characters — not Copy, not an edit', async () => {
    const writeText = stubClipboard();
    const host = memoryHost();
    const { unmount } = render(<JsonCsvTool host={host} />);
    direction('CSV → JSON');
    type(`a,b\n${'abcdefghij,klmnopqrst\n'.repeat(12_000)}`);
    fireEvent.click(button('Run'));
    await waitFor(() => expect(status()).toMatch(/^Valid CSV/), WAIT);
    fireEvent.click(button('Copy'));
    await act(async () => undefined);
    expect(writeText).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => undefined);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(await entriesOf(host)).toEqual([]);
  });

  it('opens an entry back into the tool: input, direction and every option', async () => {
    stubClipboard();
    const host = memoryHost();
    const first = render(<JsonCsvTool host={host} />);
    direction('CSV → JSON');
    await choose('Delimiter', 'Pipe');
    await choose('Empty cells', 'Leave out');
    await choose('Indent', '4 spaces');
    check('Nest dotted headers');
    type('a.b|c\n1|');
    fireEvent.click(button('Copy'));
    await waitFor(async () => expect(await entriesOf(host, ['to-json'])).toHaveLength(1), WAIT);
    first.unmount();
    await act(async () => undefined);
    const [entry] = await entriesOf(host, ['to-json']);
    expect(entry!.label).toBe('CSV → JSON · pipe · 1 row × 2 columns · copied');

    render(<JsonCsvTool host={host} restore={{ id: entry!.id }} />);
    expect(await screen.findByText(`Opened from History: ${entry!.label}.`)).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'CSV → JSON' }).getAttribute('aria-checked')).toBe('true');
    expect(input().value).toBe('a.b|c\n1|');
    expect(screen.getByLabelText('Delimiter').textContent).toContain('Pipe');
    expect(screen.getByLabelText('Empty cells').textContent).toContain('Leave out');
    expect(screen.getByLabelText('Indent').textContent).toContain('4 spaces');
    expect(checked('Nest dotted headers')).toBe(true);
    expect(output()).toBe('[\n    {\n        "a": {\n            "b": 1\n        }\n    }\n]');
  });

  it('an entry with options it does not understand opens with the defaults; a newer schema is refused in words', async () => {
    const host = memoryHost();
    const session = host.history.forOwner('json-csv', jsonCsvHistory).session();
    await session.commit({
      kind: 'to-json',
      payload: { toJson: { delimiter: 'x', layout: 3 }, toCsv: 7 },
      label: 'Odd',
      blobs: { input: new Blob(['a;b\n1;2']) },
    });
    await session.end();
    const newer = host.history.forOwner('json-csv', { ...jsonCsvHistory, schema: 2 }).session();
    await newer.commit({ kind: 'to-csv', payload: {}, label: 'From the future', blobs: { input: new Blob(['[]']) } });
    await newer.end();
    const entries = await entriesOf(host);
    const odd = render(<JsonCsvTool host={host} restore={{ id: entries.find(e => e.label === 'Odd')!.id }} />);
    expect(await screen.findByText('Opened from History: Odd.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'CSV → JSON' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByLabelText('Delimiter').textContent).toContain('Auto');
    expect(notes()).toEqual(['Detected delimiter: semicolon.']);
    odd.unmount();
    render(<JsonCsvTool host={host} restore={{ id: entries.find(e => e.label === 'From the future')!.id }} />);
    expect(await screen.findByText('This entry was kept by a newer version of the tool.')).toBeTruthy();
  });
});

describe('the JSON and CSV tool’s saved parameters (D21, docs/tools/settings.md)', () => {
  const savedOf = (host: ReturnType<typeof memoryHost>) => host.settings.forTool('json-csv').saved();
  const seed = async (host: ReturnType<typeof memoryHost>, values: Record<string, unknown>) => {
    host.settings.forTool('json-csv').save(jsonCsvSettings.schema, values as never);
    await host.settings.forTool('json-csv').flush();
  };
  const toJson = () => screen.getByRole('radio', { name: 'CSV → JSON' }).getAttribute('aria-checked') === 'true';
  const label = (name: string) => screen.getByLabelText(name).textContent;

  it('opens with the defaults and saves nothing until an option changes; reopened, it is as left; Swap is saved', async () => {
    const host = memoryHost();
    const first = render(<JsonCsvTool host={host} />);
    type('[{"a":1,"b":"x"}]');
    await host.settings.forTool('json-csv').flush();
    expect(savedOf(host)).toBeUndefined();
    await choose('Delimiter', 'Semicolon');
    check('Protect from formulas');
    check('Add BOM (for Excel)');
    first.unmount();
    expect(savedOf(host)).toEqual({
      schema: 1,
      values: { csvDelimiter: 'semicolon', csvProtectFormulas: false, csvBom: true },
    });

    const second = render(<JsonCsvTool host={host} />);
    expect(toJson()).toBe(false);
    expect(input().value).toBe('');
    expect(label('Delimiter')).toContain('Semicolon');
    expect(checked('Protect from formulas')).toBe(false);
    expect(checked('Add BOM (for Excel)')).toBe(true);
    // Swap is the person's: the new direction and the delimiter it hands over are saved.
    type('[{"a":1,"b":"x"}]');
    fireEvent.click(button('Swap'));
    expect(toJson()).toBe(true);
    second.unmount();
    expect(savedOf(host)!.values).toMatchObject({ direction: 'to-json', jsonDelimiter: 'semicolon' });

    render(<JsonCsvTool host={host} />);
    expect(toJson()).toBe(true);
    expect(label('Delimiter')).toContain('Semicolon');
  });

  it('a saved record it cannot show falls back field by field; the rest is used', async () => {
    const host = memoryHost();
    await seed(host, {
      direction: 'to-json',
      jsonDelimiter: ';',
      jsonEmpty: 'omit',
      jsonIndent: 3,
      jsonDetectTypes: 'no',
      jsonNest: true,
      header: false,
      unknown: 1,
    });
    render(<JsonCsvTool host={host} />);
    expect(toJson()).toBe(true);
    expect(label('Delimiter')).toContain('Auto');
    expect(label('Empty cells')).toContain('Leave out');
    expect(label('Indent')).toContain('2 spaces');
    expect(checked('Detect types')).toBe(true);
    expect(checked('Nest dotted headers')).toBe(true);
    expect(checked('Header row')).toBe(false);
  });

  it('an entry opened from History, a pasted text and an opened file win for the visit and leave what is saved alone', async () => {
    const host = memoryHost();
    const session = host.history.forOwner('json-csv', jsonCsvHistory).session();
    await session.commit({
      kind: 'to-csv',
      payload: {
        direction: 'to-csv',
        header: true,
        toCsv: { delimiter: ',', flatten: true, newline: 'crlf', quoteAll: false, protectFormulas: true, bom: false },
        toJson: { delimiter: 'auto', detectTypes: true, empty: 'null', nest: false, layout: 2 },
        outcome: 'ok',
      } as never,
      label: 'Plain',
      blobs: { input: new Blob(['[{"a":1}]']) },
    });
    await session.end();
    const [entry] = (await host.history.forOwner('json-csv', jsonCsvHistory).list({})).entries;
    const values = { direction: 'to-json', jsonIndent: 'tab', csvDelimiter: 'pipe', csvQuoteAll: true };
    await seed(host, values);
    const opened = render(<JsonCsvTool host={host} restore={{ id: entry!.id }} />);
    expect(await screen.findByText('Opened from History: Plain.')).toBeTruthy();
    expect(toJson()).toBe(false);
    expect(label('Delimiter')).toContain('Comma');
    expect(checked('Quote all fields')).toBe(false);
    opened.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values });

    // A pasted JSON text opens JSON → CSV for the visit, with the saved options of that direction.
    const pasted = render(<JsonCsvTool host={host} input={'[{"a":1}]'} />);
    expect(toJson()).toBe(false);
    expect(label('Delimiter')).toContain('Pipe');
    expect(checked('Quote all fields')).toBe(true);
    pasted.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values });

    // A .json file chooses JSON → CSV for the visit, a .tsv file CSV → JSON and Tab; a later change saves only itself.
    render(<JsonCsvTool host={host} />);
    open(new File(['[{"a":1}]'], 'data.json'));
    await waitFor(() => expect(input().value).toBe('[{"a":1}]'));
    expect(toJson()).toBe(false);
    open(new File(['a\tb\n1\t2'], 'sheet.tsv'));
    await waitFor(() => expect(input().value).toBe('a\tb\n1\t2'));
    expect(toJson()).toBe(true);
    expect(label('Delimiter')).toContain('Tab');
    check('Nest dotted headers');
    await host.settings.forTool('json-csv').flush();
    expect(savedOf(host)).toEqual({ schema: 1, values: { ...values, jsonNest: true } });
  });

  it('reset puts every option back to its default and keeps the input; the result follows', async () => {
    const host = memoryHost();
    await seed(host, { csvDelimiter: 'semicolon', header: false, csvNewline: 'lf' });
    render(<JsonCsvTool host={host} />);
    type('[{"a":1,"b":"x"}]');
    expect(output()).toBe('1;x\n');
    await act(async () => host.settings.forTool('json-csv').reset());
    expect(label('Delimiter')).toContain('Comma');
    expect(checked('Header row')).toBe(true);
    expect(label('Line breaks')).toContain('CRLF');
    expect(input().value).toBe('[{"a":1,"b":"x"}]');
    expect(output()).toBe(shown('a,b\r\n1,x\r\n'));
    expect(savedOf(host)).toBeUndefined();
  });
});
