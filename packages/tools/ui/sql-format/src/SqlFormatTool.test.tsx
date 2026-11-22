/**
 * The SQL Formatter's page (docs/tools/specs/sql-format.md §2, §3, §4, §6, §8) in jsdom. There are no workers here, so
 * every dialect's worker is replaced by the worker's own body (serve.ts) run on the page with the real library, behind
 * the same messages and the same runner. And its history: edits as snapshots, Copy, Save and Run at once, a query with
 * a password only encrypted, an entry opened back with its dialect and options.
 */
import { definition } from './definition';
import { detect } from './detect';
import { sqlFormatHistory } from './history';
import { serve } from './serve';
import SqlFormatTool from './SqlFormatTool';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DIALECTS, DIALECT_LABELS, LIVE_INPUT, MAX_INPUT } from '@workspace/tool-logic-sql-format';
import { memoryHost, unlockedHost } from '@workspace/tools-host';
import * as library from 'sql-formatter';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkerLike } from './runner';
import type { FormatReply, FormatRequest, WorkerScope } from './serve';
import type { DialectOptions, SqlDialect } from '@workspace/tool-logic-sql-format';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Workers that run serve.ts on the page; `readyAfter` / `answerAfter` in milliseconds. */
const pageWorkers = ({ readyAfter = 0, answerAfter = 0 }: { readyAfter?: number; answerAfter?: number } = {}) => {
  const started: SqlDialect[] = [];
  const terminated: SqlDialect[] = [];
  const start = (dialect: SqlDialect): WorkerLike => {
    started.push(dialect);
    let alive = true;
    const scope: WorkerScope = {
      onmessage: null,
      postMessage: (reply: FormatReply) =>
        void setTimeout(() => alive && worker.onmessage?.({ data: reply }), reply.type === 'ready' ? readyAfter : 0),
    };
    const worker: WorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage: message =>
        void setTimeout(() => alive && scope.onmessage?.({ data: message as FormatRequest }), answerAfter),
      terminate: () => {
        alive = false;
        terminated.push(dialect);
      },
    };
    serve((library as unknown as Record<string, DialectOptions>)[dialect]!, scope);
    return worker;
  };
  return { start, started, terminated };
};

const input = () => document.getElementById('sql-format-input') as HTMLTextAreaElement;
const output = () => (document.getElementById('sql-format-output') as HTMLTextAreaElement | null)?.value ?? null;
const type = (value: string) => fireEvent.change(input(), { target: { value } });
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const status = () => document.querySelector('[data-part="status"]')!.textContent!.trim();
const note = () => document.querySelector('[data-part="note"]')!.textContent!.trim();
const summary = () => document.querySelector('[data-part="summary"]')?.textContent ?? null;
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
const formatted = async (expected: string) => waitFor(() => expect(output()).toBe(expected), WAIT);
const stubClipboard = () => {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  return writeText;
};
const lines = (...rows: string[]) => rows.join('\n');

describe('the SQL Formatter’s definition', () => {
  it('describes the tool, recognises SQL and loads its component', async () => {
    expect(definition).toMatchObject({
      id: 'sql-format',
      title: 'SQL Formatter',
      summary: 'Lay out SQL queries for reading: keywords, indentation, one clause per line.',
      order: 21,
      output: { origin: 'input' },
    });
    expect(definition.keywords).toEqual([
      'sql',
      'format',
      'pretty',
      'beautify',
      'query',
      'postgresql',
      'mysql',
      'sqlite',
      'sql server',
      'oracle',
      'bigquery',
    ]);
    expect(definition.shortcut).toBeUndefined();
    expect(definition.history).toBe(sqlFormatHistory);
    expect(sqlFormatHistory.kinds).toEqual([
      { id: 'format', title: 'Formatted' },
      { id: 'credentials', title: 'With credentials', secret: true },
    ]);
    expect(detect('select * from t')).toBe(true);
    expect(detect('Select the file from the list')).toBe(false);
    expect((await definition.load()).default).toBe(SqlFormatTool);
  });
});

describe('the SQL Formatter, rendered', () => {
  it('starts empty: Standard SQL, UPPER, 2 spaces, Standard; nothing under the query, Copy and Save off (§4, §8)', () => {
    const { started } = pageWorkers();
    render(<SqlFormatTool />);
    expect(screen.getByLabelText('Dialect').textContent).toContain('Standard SQL');
    expect(screen.getByRole('radio', { name: 'UPPER' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByLabelText('Keyword case').getAttribute('data-slot')).toBe('toggle-group');
    expect(screen.getByLabelText('Indent').textContent).toContain('2 spaces');
    expect(screen.getByLabelText('Layout').textContent).toContain('Standard');
    expect(screen.getByLabelText('SQL')).toBe(input());
    expect(input().placeholder).toBe('select id, name from users where active = 1');
    expect(input().getAttribute('spellcheck')).toBe('false');
    const result = screen.getByLabelText('Formatted') as HTMLTextAreaElement;
    expect(result.readOnly).toBe(true);
    expect(result.getAttribute('spellcheck')).toBe('false');
    expect(status()).toBe('');
    expect(note()).toBe("Formatting doesn't check that the query is valid.");
    for (const name of ['Copy', 'Save']) expect(button(name).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull();
    expect(button('Open file')).toBeTruthy();
    expect(picker().accept).toBe('.sql,text/plain');
    // No worker until there is something to format (nothing of the library loads with the page).
    expect(started).toEqual([]);
  });

  it('renders with no host and no workers at all, and says why it cannot format', async () => {
    render(<SqlFormatTool input="select 1" />);
    await waitFor(() => expect(status()).toMatch(/^The formatter stopped: /), WAIT);
    expect(output()).toBe('');
  });

  it('§2.1 a query from a log, laid out at once (text handed over from the start page)', async () => {
    const { start } = pageWorkers();
    render(
      <SqlFormatTool
        startWorker={start}
        input="select id, name from users where active = 1 and age > 18 order by name"
      />,
    );
    await formatted(
      lines(
        'SELECT',
        '  id,',
        '  name',
        'FROM',
        '  users',
        'WHERE',
        '  active = 1',
        '  AND age > 18',
        'ORDER BY',
        '  name',
      ),
    );
    expect(status()).toBe('');
    expect(button('Copy').disabled).toBe(false);
  });

  it('§2.2 :: under Standard SQL: the error with the hint, a link to its place; PostgreSQL lays it out', async () => {
    const { start, started, terminated } = pageWorkers();
    render(<SqlFormatTool startWorker={start} />);
    type('select created::date from t');
    const text =
      'Line 1, column 15: unexpected "::date fro". Standard SQL doesn\'t have this syntax; try PostgreSQL, Redshift, DuckDB, Snowflake.';
    await waitFor(() => expect(status()).toBe(text), WAIT);
    // An input error changes while typing: role status, never alert.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(output()).toBe('');
    fireEvent.click(screen.getByRole('button', { name: text }));
    expect(document.activeElement).toBe(input());
    expect([input().selectionStart, input().selectionEnd]).toEqual([14, 14]);
    await choose('Dialect', 'PostgreSQL');
    await formatted(lines('SELECT', '  created::date', 'FROM', '  t'));
    expect(status()).toBe('');
    // The worker of Standard SQL gives way to PostgreSQL's.
    expect(started).toEqual(['sql', 'postgresql']);
    expect(terminated).toContain('sql');
  });

  it('§2.3 Keyword case lower; Preserve; data types follow it', async () => {
    const { start } = pageWorkers();
    render(<SqlFormatTool startWorker={start} input="SELECT id FROM users WHERE x = 1" />);
    fireEvent.click(screen.getByRole('radio', { name: 'lower' }));
    await formatted(lines('select', '  id', 'from', '  users', 'where', '  x = 1'));
    type('create table t (a INT, b VARCHAR(10))');
    await formatted('create table t (a int, b varchar(10))');
    fireEvent.click(screen.getByRole('radio', { name: 'Preserve' }));
    type('Select id From users');
    await formatted(lines('Select', '  id', 'From', '  users'));
  });

  it('§2.4 comments stay where they were', async () => {
    const { start } = pageWorkers();
    render(
      <SqlFormatTool
        startWorker={start}
        input={'-- leading comment\nselect a, -- trailing\n /* block */ b from t /* end */'}
      />,
    );
    await formatted(
      lines('-- leading comment', 'SELECT', '  a, -- trailing', '  /* block */', '  b', 'FROM', '  t /* end */'),
    );
  });

  it('§2.5 a cut-off query: where it ends too early; an unclosed comment is ours', async () => {
    const { start } = pageWorkers();
    render(<SqlFormatTool startWorker={start} />);
    type('select (a from t');
    await waitFor(
      () => expect(status()).toBe('Line 1, column 17: the query ends too early (an unclosed parenthesis or CASE?)'),
      WAIT,
    );
    type('select 1 /* abc');
    await waitFor(() => expect(status()).toBe('Line 1, column 10: unclosed comment: /* without */'), WAIT);
  });

  it('Indent: 4 spaces and Tab; Layout: Tabular left and right, and Tab is not offered with Tabular (§5 п. 3)', async () => {
    const { start } = pageWorkers();
    render(<SqlFormatTool startWorker={start} input="select a, b from t where x = 1 and y = 2" />);
    await choose('Indent', '4 spaces');
    await formatted(lines('SELECT', '    a,', '    b', 'FROM', '    t', 'WHERE', '    x = 1', '    AND y = 2'));
    await choose('Indent', 'Tab');
    await formatted(lines('SELECT', '\ta,', '\tb', 'FROM', '\tt', 'WHERE', '\tx = 1', '\tAND y = 2'));
    await choose('Layout', 'Tabular left');
    // Tab gave way to 2 spaces, and the list does not offer it now.
    expect(screen.getByLabelText('Indent').textContent).toContain('2 spaces');
    await formatted(lines('SELECT    a,', '          b', 'FROM      t', 'WHERE     x = 1', 'AND       y = 2'));
    fireEvent.keyDown(screen.getByLabelText('Indent'), { key: 'Enter' });
    const tab = await screen.findByRole('option', { name: 'Tab' });
    expect(tab.getAttribute('aria-disabled')).toBe('true');
    fireEvent.keyDown(tab, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    await choose('Layout', 'Tabular right');
    await formatted(lines('   SELECT a,', '          b', '     FROM t', '    WHERE x = 1', '      AND y = 2'));
  });

  it('every dialect of the list is offered and formats', async () => {
    const { start, started } = pageWorkers();
    render(<SqlFormatTool startWorker={start} input="select id from users" />);
    await formatted(lines('SELECT', '  id', 'FROM', '  users'));
    for (const dialect of DIALECTS.slice(1)) {
      await choose('Dialect', DIALECT_LABELS[dialect]);
      await waitFor(() => expect(started.at(-1)).toBe(dialect), WAIT);
      await formatted(lines('SELECT', '  id', 'FROM', '  users'));
    }
    expect(started).toEqual([...DIALECTS]);
  });

  it('says the formatter is loading the first time a dialect’s worker starts (§8)', async () => {
    const { start } = pageWorkers({ readyAfter: 400, answerAfter: 500 });
    render(<SqlFormatTool startWorker={start} />);
    type('select 1');
    await waitFor(() => expect(status()).toBe('Loading the Standard SQL formatter…'), WAIT);
    await formatted(lines('SELECT', '  1'));
    expect(status()).toBe('');
  });

  it('§2.6 a large input waits for Run; Run formats it in the worker, Cancel stops it, an edit too', async () => {
    const { start, terminated } = pageWorkers({ answerAfter: 300 });
    render(<SqlFormatTool startWorker={start} />);
    // The dialect's worker is loaded once (a small query), so the Run below shows its own state.
    type('select 1');
    await formatted(lines('SELECT', '  1'));
    const large = `select ${'a, '.repeat(Math.ceil(LIVE_INPUT / 3))}b from t`;
    type(large);
    expect(status()).toBe('Large input: press Run (Ctrl+Enter) to format it.');
    expect(output()).toBe('');
    fireEvent.click(button('Run'));
    expect(status()).toBe('Formatting…');
    expect(document.activeElement).toBe(button('Cancel'));
    fireEvent.click(button('Cancel'));
    expect(terminated).toEqual(['sql']);
    expect(status()).toBe('Large input: press Run (Ctrl+Enter) to format it.');
    fireEvent.keyDown(input(), { key: 'Enter', ctrlKey: true });
    expect(status()).toBe('Formatting…');
    await waitFor(() => expect(output()!.startsWith('SELECT\n  a,\n  a,')).toBe(true), WAIT);
    expect(status()).toBe('');
  });

  it('refuses more than 2 MB (§6)', () => {
    const { start, started } = pageWorkers();
    render(<SqlFormatTool startWorker={start} />);
    type('x'.repeat(MAX_INPUT + 1));
    expect(status()).toBe('Input is larger than 2 MB. This tool formats up to 2 MB.');
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull();
    expect(started).toEqual([]);
  });

  it('a result over 200 000 lines is a summary, still copied and saved whole (§3)', async () => {
    const { start } = pageWorkers();
    render(<SqlFormatTool startWorker={start} />);
    type(`select ${Array.from({ length: 200_001 }, (_, i) => `c${i}`).join(',')} from t`);
    fireEvent.click(button('Run'));
    await waitFor(() => expect(summary()).toMatch(/^Result: .* MB, 200,004 lines\. Too large to show here\.$/), WAIT);
    expect(button('Copy').disabled).toBe(false);
    expect(button('Save').disabled).toBe(false);
  });

  it('Copy copies the result as shown; Save downloads formatted.sql', async () => {
    const writeText = stubClipboard();
    const created: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      created.push(blob);
      return 'blob:x';
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    const { start } = pageWorkers();
    render(<SqlFormatTool startWorker={start} input="select 1; select 2;" />);
    await formatted(lines('SELECT', '  1;', '', 'SELECT', '  2;'));
    fireEvent.click(button('Copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(lines('SELECT', '  1;', '', 'SELECT', '  2;')));
    fireEvent.click(button('Save'));
    expect(downloads).toEqual(['formatted.sql']);
    expect(await created[0]!.text()).toBe(lines('SELECT', '  1;', '', 'SELECT', '  2;'));
  });

  it('Open file: a UTF-8 file becomes the query; another is refused in words', async () => {
    const { start } = pageWorkers();
    render(<SqlFormatTool startWorker={start} />);
    open(new File(['select a from t'], 'q.sql', { type: 'application/sql' }));
    await formatted(lines('SELECT', '  a', 'FROM', '  t'));
    open(new File([new Uint8Array([0x73, 0xff, 0xfe])], 'bad.sql'));
    await waitFor(() => expect(status()).toBe('The file is not valid UTF-8 text.'), WAIT);
  });

  it('empty input and white space: an empty result and no message (§6)', async () => {
    const { start } = pageWorkers();
    render(<SqlFormatTool startWorker={start} input="select 1" />);
    await formatted(lines('SELECT', '  1'));
    type('  \n\t ');
    await waitFor(() => expect(output()).toBe(''), WAIT);
    expect(status()).toBe('');
    expect(button('Copy').disabled).toBe(true);
  });
});

describe('the SQL Formatter’s history', () => {
  const entriesOf = async (host: { history: ReturnType<typeof memoryHost>['history'] }, kinds?: string[]) =>
    (await host.history.forOwner('sql-format', sqlFormatHistory).list(kinds ? { kinds } : {})).entries;

  it('commits Copy, Save and Run at once, with the query, the options and the result', async () => {
    stubClipboard();
    URL.createObjectURL = vi.fn(() => 'blob:x') as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const host = memoryHost();
    const { start } = pageWorkers();
    render(<SqlFormatTool host={host} startWorker={start} />);
    type('select a from t');
    await formatted(lines('SELECT', '  a', 'FROM', '  t'));
    fireEvent.click(button('Copy'));
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1), WAIT);
    await choose('Dialect', 'PostgreSQL');
    fireEvent.click(screen.getByRole('radio', { name: 'lower' }));
    await formatted(lines('select', '  a', 'from', '  t'));
    fireEvent.click(button('Save'));
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(2), WAIT);
    const large = `select ${'a, '.repeat(Math.ceil(LIVE_INPUT / 3))}b from t`;
    type(large);
    fireEvent.click(button('Run'));
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(3), WAIT);
    const labels = (await entriesOf(host)).map(e => e.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        'Standard SQL · UPPER · 2 spaces · 15 characters · copied',
        'PostgreSQL · lower · 2 spaces · 15 characters · saved',
        `PostgreSQL · lower · 2 spaces · ${large.length.toLocaleString('en-US')} characters · ran`,
      ]),
    );
    const copied = (await entriesOf(host)).find(e => e.label?.endsWith('copied'))!;
    expect(copied.kind).toBe('format');
    const opened = await host.history.forOwner('sql-format', sqlFormatHistory).open(copied.id);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.payload).toEqual({
      dialect: 'sql',
      keywordCase: 'upper',
      indent: 2,
      layout: 'standard',
      outcome: 'ok',
      action: 'copy',
    });
    expect(await opened.blobs.input!.text()).toBe('select a from t');
    expect(await opened.blobs.output!.text()).toBe(lines('SELECT', '  a', 'FROM', '  t'));
  });

  it('records an edit as a snapshot (change), errors too, with the place in the label', async () => {
    const host = memoryHost();
    const { start } = pageWorkers();
    const { unmount } = render(<SqlFormatTool host={host} startWorker={start} input="select 1" />);
    await formatted(lines('SELECT', '  1'));
    type('select (a from t');
    await waitFor(() => expect(status()).toMatch(/ends too early/), WAIT);
    unmount();
    await waitFor(async () => expect((await entriesOf(host)).length).toBeGreaterThan(0), WAIT);
    const [last] = await entriesOf(host);
    expect(last!.label).toBe('Standard SQL · UPPER · 2 spaces · error at line 1, column 17 · 16 characters');
  });

  it('opens an entry back into the tool: the query, the dialect, keyword case, indent and layout', async () => {
    stubClipboard();
    const host = memoryHost();
    const { start } = pageWorkers();
    const first = render(<SqlFormatTool host={host} startWorker={start} />);
    await choose('Dialect', 'SQL Server');
    fireEvent.click(screen.getByRole('radio', { name: 'Preserve' }));
    await choose('Indent', '4 spaces');
    await choose('Layout', 'Tabular right');
    type('select top 10 [Order Id] from t');
    await formatted(lines('   select top 10 [Order Id]', '     from t'));
    fireEvent.click(button('Copy'));
    await waitFor(async () => expect(await entriesOf(host)).toHaveLength(1), WAIT);
    first.unmount();
    await act(async () => undefined);
    const [entry] = await entriesOf(host);
    expect(entry!.label).toBe('SQL Server · Preserve · 4 spaces · Tabular right · 31 characters · copied');

    render(<SqlFormatTool host={host} startWorker={start} restore={{ id: entry!.id }} />);
    expect(await screen.findByText(`Opened from History: ${entry!.label}.`)).toBeTruthy();
    expect(input().value).toBe('select top 10 [Order Id] from t');
    expect(screen.getByLabelText('Dialect').textContent).toContain('SQL Server');
    expect(screen.getByRole('radio', { name: 'Preserve' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByLabelText('Indent').textContent).toContain('4 spaces');
    expect(screen.getByLabelText('Layout').textContent).toContain('Tabular right');
    await formatted(lines('   select top 10 [Order Id]', '     from t'));
  });

  it('a query with a password goes to the secret kind: without a master password it is not kept', async () => {
    stubClipboard();
    const host = memoryHost();
    const { start } = pageWorkers();
    const { unmount } = render(<SqlFormatTool host={host} startWorker={start} />);
    type("create user app identified by 's3cret'");
    await waitFor(() => expect(output()).not.toBe(''), WAIT);
    fireEvent.click(button('Copy'));
    await act(async () => new Promise(resolve => setTimeout(resolve, 50)));
    unmount();
    await act(async () => undefined);
    expect(await entriesOf(host)).toEqual([]);
  });

  it('… and with the history unlocked it is kept encrypted and opens back', async () => {
    stubClipboard();
    const host = await unlockedHost();
    const { start } = pageWorkers();
    const first = render(<SqlFormatTool host={host} startWorker={start} />);
    type("alter user app with password 's3cret'");
    await waitFor(() => expect(output()).not.toBe(''), WAIT);
    fireEvent.click(button('Copy'));
    await waitFor(async () => expect(await entriesOf(host, ['credentials'])).toHaveLength(1), WAIT);
    first.unmount();
    await act(async () => undefined);
    const [entry] = await entriesOf(host, ['credentials']);
    render(<SqlFormatTool host={host} startWorker={start} restore={{ id: entry!.id }} />);
    await waitFor(() => expect(input().value).toBe("alter user app with password 's3cret'"), WAIT);
    cleanup();
    await host.vault.lock();
    render(<SqlFormatTool host={host} startWorker={start} restore={{ id: entry!.id }} />);
    expect(await screen.findByText('This entry is encrypted: unlock the history to open it.')).toBeTruthy();
  });

  it('an entry of a newer schema is refused in words', async () => {
    const host = memoryHost();
    const newer = host.history.forOwner('sql-format', { ...sqlFormatHistory, schema: 2 }).session();
    await newer.commit({
      kind: 'format',
      payload: {},
      label: 'From the future',
      blobs: { input: new Blob(['select 1']) },
    });
    await newer.end();
    const [entry] = await entriesOf(host);
    const { start } = pageWorkers();
    render(<SqlFormatTool host={host} startWorker={start} restore={{ id: entry!.id }} />);
    expect(await screen.findByText('This entry was kept by a newer version of the tool.')).toBeTruthy();
  });
});
