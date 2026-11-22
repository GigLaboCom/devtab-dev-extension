import { definition } from './definition';
import JsonQueryTool, { TEXTS } from './JsonQueryTool';
import { QueryRunner } from './runner';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { documentNotes, readDocument, runQuery } from '@workspace/tool-logic-json-query';
import { memoryHost } from '@workspace/tools-host';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobMessage, JobResult } from './runner';
import type { DocumentResult } from '@workspace/tool-logic-json-query';

// jsdom has no Worker: a fake one does what json-query.worker.ts does (keeps the last document's tree, runs the
// logic's runQuery) off the test's stack, or never answers (a query that runs for ever), or fails.
type Mode = 'answer' | 'hang' | 'crash' | 'slow';
let mode: Mode = 'answer';
let workers: FakeWorker[] = [];

class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message?: string; preventDefault?: () => void }) => void) | null = null;
  terminated = false;
  messages: JobMessage[] = [];
  private held: { docId: number; read: DocumentResult } | null = null;
  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {
    workers.push(this);
  }
  postMessage(message: unknown): void {
    const { id, request } = message as JobMessage;
    this.messages.push(message as JobMessage);
    if (mode === 'hang') return;
    if (mode === 'crash') {
      setTimeout(() => this.onerror?.({ message: 'boom', preventDefault: () => undefined }), 0);
      return;
    }
    if (request.document !== undefined) this.held = { docId: request.docId, read: readDocument(request.document) };
    const held = this.held!;
    let result: JobResult;
    if (!held.read.ok) result = { ok: false, where: 'document', error: held.read.error };
    else {
      const r = runQuery(request.query, held.read.root);
      result = r.ok ? { ...r, notes: documentNotes(held.read.notes) } : r;
    }
    setTimeout(
      () => {
        if (!this.terminated) this.onmessage?.({ data: { id, result } });
      },
      mode === 'slow' ? 600 : 0,
    );
  }
  terminate(): void {
    this.terminated = true;
  }
}

const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());

beforeEach(() => {
  mode = 'answer';
  workers = [];
  writeText.mockClear();
  vi.stubGlobal('Worker', FakeWorker);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const STORE = JSON.stringify(
  {
    store: {
      book: [
        { category: 'reference', author: 'Nigel Rees', title: 'Sayings of the Century', price: 8.95 },
        { category: 'fiction', author: 'Evelyn Waugh', title: 'Sword of Honour', price: 12.99 },
        { category: 'fiction', author: 'Herman Melville', title: 'Moby Dick', isbn: '0-553-21311-3', price: 8.99 },
        { category: 'fiction', author: 'J. R. R. Tolkien', title: 'The Lord of the Rings', price: 22.99 },
      ],
      bicycle: { color: 'red', price: 399 },
    },
  },
  null,
  2,
);

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement;
const type = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });
const status = () => document.querySelector('[data-status]')?.textContent ?? '';
const message = (where: string) => document.querySelector(`[data-field="${where}"]`)?.textContent?.trim() ?? '';
const rows = () =>
  within(screen.getByRole('table', { name: 'Results' }))
    .getAllByRole('row')
    .slice(1)
    .map(row =>
      within(row)
        .getAllByRole('cell')
        .slice(0, 3)
        .map(cell => cell.textContent),
    );
const until = (text: string) => waitFor(() => expect(status()).toBe(text));
const button = (name: string) => screen.getByRole('button', { name });

describe('the JSON Query tool’s definition', () => {
  it('describes the tool, loads its component, has no shortcut', async () => {
    expect(definition).toMatchObject({
      id: 'json-query',
      title: 'JSON Query',
      summary: 'Query JSON with JSONPath (RFC 9535): the matching values and their paths.',
      order: 35,
      output: { origin: 'input' },
    });
    expect(definition.shortcut).toBeUndefined();
    expect(definition.keywords).toEqual([
      'jsonpath',
      'json',
      'query',
      'path',
      'filter',
      'select',
      'extract',
      'rfc 9535',
    ]);
    expect((await definition.load()).default).toBe(JsonQueryTool);
  });

  it('recognises a pasted query from a module of its own, never JSON (§7)', async () => {
    const { detect } = await import('./detect');
    expect(detect('$.store.book[*].author')).toBe(true);
    expect(detect('{"a": 1}')).toBe(false);
    expect(detect('$HOME')).toBe(false);
  });
});

describe('the JSON Query tool', () => {
  it('renders with no host at all, empty', () => {
    render(<JsonQueryTool />);
    expect(field('Query').value).toBe('');
    expect(field('Document').value).toBe('');
    expect(status()).toBe('');
    expect((button('Copy values') as HTMLButtonElement).disabled).toBe(true);
    expect((button('Copy paths') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(TEXTS.hint)).toBeTruthy();
    expect(field('Query').getAttribute('spellcheck')).toBe('false');
    expect(field('Document').getAttribute('spellcheck')).toBe('false');
  });

  it('§2.1: paths and values; Copy values, Copy paths, a row’s path and value', async () => {
    render(<JsonQueryTool />);
    type('Document', STORE);
    type('Query', '$.store.book[*].author');
    await until('4 results');
    expect(rows()).toEqual([
      ['1', "$['store']['book'][0]['author']", '"Nigel Rees"'],
      ['2', "$['store']['book'][1]['author']", '"Evelyn Waugh"'],
      ['3', "$['store']['book'][2]['author']", '"Herman Melville"'],
      ['4', "$['store']['book'][3]['author']", '"J. R. R. Tolkien"'],
    ]);
    fireEvent.click(button('Copy values'));
    await waitFor(() =>
      expect(writeText).toHaveBeenLastCalledWith(
        '[\n  "Nigel Rees",\n  "Evelyn Waugh",\n  "Herman Melville",\n  "J. R. R. Tolkien"\n]',
      ),
    );
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
    fireEvent.click(button('Copy paths'));
    await waitFor(() =>
      expect(writeText).toHaveBeenLastCalledWith(
        [0, 1, 2, 3].map(k => `$['store']['book'][${k}]['author']`).join('\n'),
      ),
    );
    fireEvent.click(button('Copy value 2'));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('"Evelyn Waugh"'));
    fireEvent.click(button('Copy path 4'));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("$['store']['book'][3]['author']"));
  });

  it('§2.2: a filter; a row’s value is copied indented by 2', async () => {
    render(<JsonQueryTool />);
    type('Document', STORE);
    type('Query', '$..book[?@.price < 10]');
    await until('2 results');
    expect(rows().map(r => r[2]!.slice(0, 40))).toEqual([
      '{"category":"reference","author":"Nigel ',
      '{"category":"fiction","author":"Herman M',
    ]);
    fireEvent.click(button('Copy value 1'));
    await waitFor(() =>
      expect(writeText).toHaveBeenLastCalledWith(
        '{\n  "category": "reference",\n  "author": "Nigel Rees",\n  "title": "Sayings of the Century",\n  "price": 8.95\n}',
      ),
    );
  });

  it('§2.3: while the query is typed with an error, the last results stay and the status line says so', async () => {
    render(<JsonQueryTool />);
    type('Document', STORE);
    type('Query', '$..book[?@.price < 10]');
    await until('2 results');
    type('Query', '$..book[?@.price <');
    expect(message('query')).toBe('Position 19: unexpected end of the query: expected a value to compare with');
    expect(status()).toBe('The query has an error. Showing 2 results of the last valid query: $..book[?@.price < 10]');
    expect(rows()).toHaveLength(2);
    // The echo marks the place (a bar: the end of the query has no width); the message selects it in the field.
    expect(document.querySelector('[data-part="echo"]')?.textContent).toBe('$..book[?@.price <');
    expect(document.querySelector('[data-part="caret"]')).toBeTruthy();
    const input = field('Query');
    fireEvent.click(screen.getByRole('button', { name: /Position 19/ }));
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([18, 18]);
    type('Query', '$..book[?@.price <= 8.95]');
    await until('1 result');
    expect(message('query')).toBe('');
    expect(document.querySelector('[data-part="echo"]')).toBeNull();
  });

  it('a ranged error is marked in the echo and selected in the field', async () => {
    render(<JsonQueryTool />);
    type('Query', '$[?@.a=1]');
    expect(message('query')).toBe('Position 7: use == to compare');
    expect(document.querySelector('[data-part="marked"]')?.textContent).toBe('=');
    fireEvent.click(screen.getByRole('button', { name: /Position 7/ }));
    expect([field('Query').selectionStart, field('Query').selectionEnd]).toEqual([6, 7]);
    type('Query', `$${'.a'.repeat(5001)}`);
    expect(message('query')).toBe('The query is longer than 10,000 characters.');
    expect(document.querySelector('[data-part="echo"]')).toBeNull();
  });

  it('§2.4: numbers beyond a double are compared exactly and shown as written, with a note', async () => {
    render(<JsonQueryTool />);
    type('Document', '{"a":[{"n":12345678901234567890},{"n":12345678901234567891}]}');
    type('Query', '$.a[?@.n == 12345678901234567891].n');
    await until('1 result');
    expect(rows()).toEqual([['1', "$['a'][1]['n']", '12345678901234567891']]);
    expect(message('document')).toBe(
      '2 numbers are kept as written and compared exactly: JSON.parse in JavaScript would change them.',
    );
  });

  it('a pattern literal that is not an I-Regexp: a note under the query', async () => {
    render(<JsonQueryTool />);
    type('Document', '["12"]');
    type('Query', "$[?match(@, '\\\\d+')]");
    await until('No results');
    expect(message('query')).toBe(
      "The pattern '\\\\d+' of match() is not an I-Regexp (RFC 9485): \\d is not part of it (write [0-9]), so match() is false for every node.",
    );
  });

  it('a document with an error: the place, a click puts the caret there; the old results stay', async () => {
    render(<JsonQueryTool />);
    type('Document', '{"a": 1}');
    type('Query', '$.a');
    await until('1 result');
    type('Document', '{"a": 1,}');
    await waitFor(() => expect(message('document')).toBe('Line 1, column 9: trailing comma'));
    expect(status()).toBe('The document has an error. Showing 1 result of the last valid document.');
    const area = field('Document');
    fireEvent.click(screen.getByRole('button', { name: /Line 1, column 9/ }));
    expect(document.activeElement).toBe(area);
    expect(area.selectionStart).toBe(8);
  });

  it('repeated names: a note under the document, and every member is selected', async () => {
    render(<JsonQueryTool />);
    type('Document', '{"a":1,"b":2,"a":3}');
    type('Query', '$.a');
    await until('2 results');
    expect(rows().map(r => r[1])).toEqual(["$['a']", "$['a']"]);
    expect(message('document')).toBe(
      'Duplicate key "a" at line 1, column 14: a name selector selects every member with this name.',
    );
  });

  it('shows the first 1,000 rows and copies all', { timeout: 30_000 }, async () => {
    render(<JsonQueryTool />);
    type('Document', JSON.stringify(Array.from({ length: 2500 }, (_, k) => k)));
    type('Query', '$[*]');
    await until('2,500 results');
    expect(message('results')).toBe('Showing 1,000 of 2,500 results.');
    await waitFor(() => expect(rows()).toHaveLength(1000), { timeout: 15_000 });
    fireEvent.click(button('Copy paths'));
    await waitFor(() => expect(writeText.mock.lastCall?.[0].split('\n')).toHaveLength(2500));
  });

  it('a node list over the limit is refused with the reason', async () => {
    render(<JsonQueryTool />);
    type('Document', `${'['.repeat(600)}${']'.repeat(600)}`);
    type('Query', '$..*..*..*');
    expect(await screen.findByText('The query selects more than 1,000,000 nodes. Narrow it.')).toBeTruthy();
  });

  it('§2.7: a query that never ends is stopped at 1 s, says so, offers 10 s; an edit returns to 1 s', async () => {
    mode = 'hang';
    const run = vi.spyOn(QueryRunner.prototype, 'run');
    render(<JsonQueryTool />);
    type('Document', '[1]');
    type('Query', '$[?count(@..*) > 0]');
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run.mock.calls[0]![1]).toBe(1_000);
    await waitFor(() => expect(screen.getByText(TEXTS.stopped(1_000))).toBeTruthy(), { timeout: 2_500 });
    expect(TEXTS.stopped(1_000)).toBe(
      'Stopped after 1 second: the query takes too long on this document. Descendant queries inside a filter (?@..x) and patterns such as (a+)+ in match() or search() often cause this.',
    );
    expect(screen.getByText(TEXTS.stopped(1_000)).getAttribute('role')).toBe('alert');
    expect(workers[0]!.terminated).toBe(true);
    fireEvent.click(button('Allow 10 seconds'));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    expect(run.mock.calls[1]![1]).toBe(10_000);
    mode = 'answer';
    type('Query', '$[0]');
    await until('1 result');
    expect(run.mock.calls[2]![1]).toBe(1_000);
    expect(screen.queryByText(TEXTS.stopped(1_000))).toBeNull();
  });

  it('a worker that fails says so', async () => {
    mode = 'crash';
    render(<JsonQueryTool />);
    type('Document', '[1]');
    type('Query', '$[0]');
    expect(await screen.findByText('The query could not be run: boom.')).toBeTruthy();
  });

  it('says Running… when the answer takes over 300 ms, keeping the old results meanwhile', async () => {
    render(<JsonQueryTool />);
    type('Document', '[1, 2, 3]');
    type('Query', '$[0]');
    await until('1 result');
    mode = 'slow';
    type('Query', '$[*]');
    await waitFor(() => expect(status()).toBe(`1 result${TEXTS.running}`), { timeout: 1_000 });
    expect(rows()).toHaveLength(1);
    await until('3 results');
  });

  it('sends the document once: editing the query sends only the query', async () => {
    render(<JsonQueryTool />);
    type('Document', STORE);
    type('Query', '$..author');
    await until('4 results');
    type('Query', '$..price');
    await until('5 results');
    type('Document', '{"price": 1}');
    await until('1 result');
    const sent = workers[0]!.messages.map(m => m.request.document !== undefined);
    expect(sent).toEqual([true, false, true]);
  });

  it('an empty document or query is the empty state, not an error', async () => {
    render(<JsonQueryTool />);
    type('Document', '[1]');
    type('Query', '$[0]');
    await until('1 result');
    type('Query', '');
    await waitFor(() => expect(status()).toBe(''));
    expect(screen.queryByRole('table')).toBeNull();
    type('Query', '$[0]');
    await until('1 result');
    type('Document', '   ');
    await waitFor(() => expect(status()).toBe(''));
    expect(message('document')).toBe('');
  });

  it('a pasted query opens in the Query field, any other text in Document (§7)', () => {
    const { unmount } = render(<JsonQueryTool input="$.store.book[0]" />);
    expect(field('Query').value).toBe('$.store.book[0]');
    expect(field('Document').value).toBe('');
    unmount();
    render(<JsonQueryTool input='{"a": 1}' />);
    expect(field('Query').value).toBe('');
    expect(field('Document').value).toBe('{"a": 1}');
  });
});

describe('the JSON Query tool’s history', () => {
  it('records edits as snapshots with the count, commits a copy, and opens an entry back', async () => {
    const host = memoryHost();
    const history = host.history.forOwner('json-query', definition.history!);
    const { unmount } = render(<JsonQueryTool host={host} />);
    type('Document', STORE);
    type('Query', '$..author');
    await until('4 results');
    // Leaving the page writes the pending snapshot.
    unmount();
    let entries: Awaited<ReturnType<typeof history.list>>['entries'] = [];
    await waitFor(async () => {
      entries = (await history.list({})).entries;
      expect(entries).toHaveLength(1);
    });
    expect(entries[0]).toMatchObject({ kind: 'edit', label: '$..author · 4 results' });

    const second = render(<JsonQueryTool host={host} />);
    type('Document', '{"a": [1, 2]}');
    type('Query', '$.a[*]');
    await until('2 results');
    fireEvent.click(button('Copy values'));
    await waitFor(async () => {
      entries = (await history.list({ kinds: ['result'] })).entries;
      expect(entries).toHaveLength(1);
    });
    expect(entries[0]!.label).toBe('$.a[*] · 2 results · copied values');
    second.unmount();

    render(<JsonQueryTool host={host} restore={{ id: entries[0]!.id }} />);
    expect(await screen.findByText('Opened from History: $.a[*] · 2 results · copied values.')).toBeTruthy();
    expect(field('Query').value).toBe('$.a[*]');
    expect(field('Document').value).toBe('{"a": [1, 2]}');
    await until('2 results');
    // Opening an entry is not an edit: nothing new is written by it.
    await act(() => new Promise(r => setTimeout(r, 50)));
    expect((await history.list({})).entries).toHaveLength(2);
  });
});
