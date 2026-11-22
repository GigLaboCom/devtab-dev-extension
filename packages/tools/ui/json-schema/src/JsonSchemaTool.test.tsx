import { definition } from './definition';
import JsonSchemaTool, { TEXTS } from './JsonSchemaTool';
import { jsonSchemaSettings } from './settings';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { runInference, Session } from '@workspace/tool-logic-json-schema';
import { memoryHost } from '@workspace/tools-host';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobMessage, JobReply } from './runner';

// jsdom has no Worker: a fake one does what json-schema.worker.ts does (a Session that keeps the last schema and
// document, runInference) off the test's stack, or never answers (a check that runs for ever), or fails.
type Mode = 'answer' | 'hang' | 'crash';
let mode: Mode = 'answer';
let workers: FakeWorker[] = [];

class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message?: string; preventDefault?: () => void }) => void) | null = null;
  terminated = false;
  messages: JobMessage[] = [];
  private readonly session = new Session();
  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {
    workers.push(this);
  }
  postMessage(message: unknown): void {
    const data = message as JobMessage;
    this.messages.push(data);
    if (mode === 'hang') return;
    if (mode === 'crash') {
      setTimeout(() => this.onerror?.({ message: 'boom', preventDefault: () => undefined }), 0);
      return;
    }
    let reply: JobReply;
    try {
      reply =
        data.kind === 'validate'
          ? { id: data.id, result: { kind: 'validate', reply: this.session.validate(data.request) } }
          : { id: data.id, result: { kind: 'infer', reply: runInference(data.samples, data.options) } };
    } catch (e) {
      reply = { id: data.id, error: String(e) };
    }
    setTimeout(() => {
      if (!this.terminated) this.onmessage?.({ data: reply });
    }, 0);
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

const field = (label: string) => screen.getByLabelText(label) as HTMLTextAreaElement;
const type = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });
const status = () => document.querySelector('[data-status]')?.textContent ?? '';
const message = (where: string) => document.querySelector(`[data-field="${where}"]`)?.textContent?.trim() ?? '';
const until = (text: string) => waitFor(() => expect(status()).toBe(text));
const button = (name: string) => screen.getByRole('button', { name });
const rows = (table = 'Violations') =>
  within(screen.getByRole('table', { name: table }))
    .getAllByRole('row')
    .slice(1)
    .map(row =>
      within(row)
        .getAllByRole('cell')
        .map(cell => cell.textContent),
    );
const choose = async (label: string, option: string) => {
  const trigger = screen.getByLabelText(label);
  fireEvent.keyDown(trigger, { key: 'Enter' });
  const item = await screen.findByRole('option', { name: option });
  fireEvent.keyDown(item, { key: 'Enter' });
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
};

const SCHEMA = '{"type": "object", "properties": {"port": {"type": "integer"}}, "required": ["port"]}';
const DOC = '{\n  "name": "web",\n  "port": "8080"\n}';

describe('the JSON Schema tool’s definition', () => {
  it('describes the tool, loads its component, has no shortcut', async () => {
    expect(definition).toMatchObject({
      id: 'json-schema',
      title: 'JSON Schema',
      summary:
        'Validate JSON against a JSON Schema and see every violation in place, or generate a schema from samples.',
      order: 42,
      output: { origin: 'input' },
    });
    expect(definition.keywords).toEqual([
      'json schema',
      'validate json',
      'schema validator',
      'generate schema',
      'openapi',
      '$ref',
    ]);
    expect(definition.shortcut).toBeUndefined();
    expect((await definition.load()).default).toBe(JsonSchemaTool);
  });

  it('recognises a pasted schema naming a json-schema.org draft, never other JSON (§7)', async () => {
    const { detect } = await import('./detect');
    expect(detect('{"$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object"}')).toBe(true);
    expect(detect('{"type": "object"}')).toBe(false);
    expect(detect('{"a": 1}')).toBe(false);
  });
});

describe('Validate', () => {
  it('renders with no host at all, empty', () => {
    render(<JsonSchemaTool />);
    expect(field('Schema').value).toBe('');
    expect(field('Document').value).toBe('');
    expect(status()).toBe('');
    expect(screen.queryByRole('table', { name: 'Violations' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Validate' }).getAttribute('data-state')).toBe('on');
  });

  it('scenario 1: one violation with both places; a click puts the caret on it; Copy violations', async () => {
    render(<JsonSchemaTool />);
    type('Schema', SCHEMA);
    type('Document', DOC);
    await until('1 violation');
    expect(message('schema')).toBe('Draft 2020-12 (no $schema: the draft chosen above).');
    expect(rows()).toEqual([
      ['1', '/portline 3, column 11', 'Expected an integer, got the string "8080".', '#/properties/port/type'],
    ]);
    fireEvent.click(button('Go to /port, line 3, column 11'));
    expect(document.activeElement).toBe(field('Document'));
    expect(field('Document').selectionStart).toBe(DOC.indexOf('"8080"'));
    fireEvent.click(button('Copy violations'));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        '/port (line 3, column 11): Expected an integer, got the string "8080". [#/properties/port/type]',
      ),
    );
    type('Document', '{"port": 8080}');
    await until(TEXTS.valid);
    expect(screen.queryByRole('table', { name: 'Violations' })).toBeNull();
  });

  it('scenario 2: a remote reference is never fetched; pasted under Referenced schemas, it resolves', async () => {
    render(<JsonSchemaTool />);
    type('Schema', '{"$ref": "https://example.com/schemas/address.json"}');
    type('Document', '{"city": 1}');
    await waitFor(() => expect(screen.queryByRole('table', { name: 'Schema problems' })).not.toBeNull());
    expect(rows('Schema problems')[0]?.[2]).toBe(
      'The reference https://example.com/schemas/address.json could not be resolved: schemas are never fetched. Add it under Referenced schemas with "$id": "https://example.com/schemas/address.json".',
    );
    expect(message('problems')).toBe(TEXTS.problemsPlain(1));
    expect(status()).toBe('');
    fireEvent.click(button('Add a referenced schema'));
    type(
      'Referenced schema 1',
      '{"$id": "https://example.com/schemas/address.json", "properties": {"city": {"type": "string"}}}',
    );
    await until('1 violation');
    expect(message('referenced-0')).toBe('Found by "$id": https://example.com/schemas/address.json');
    expect(rows()[0]?.[3]).toBe('#/$ref/properties/city/type');
    fireEvent.click(button('Remove referenced schema 1'));
    await waitFor(() => expect(screen.queryByRole('table', { name: 'Schema problems' })).not.toBeNull());
  });

  it('scenario 3: a schema that fails its meta-schema — problems apart, the document unchecked, a click into the schema', async () => {
    render(<JsonSchemaTool />);
    type('Schema', '{\n  "type": "strnig"\n}');
    type('Document', '1');
    await waitFor(() => expect(message('problems')).toBe(TEXTS.problems(1, 'draft 2020-12')));
    expect(rows('Schema problems')).toEqual([
      [
        '1',
        '/typeline 2, column 11',
        'Must be one of: "array", "boolean", "integer", "null", "number", "object", "string".',
        'https://json-schema.org/draft/2020-12/meta/validation#/$defs/simpleTypes/enum',
      ],
    ]);
    expect(status()).toBe('');
    fireEvent.click(button('Go to /type, line 2, column 11'));
    expect(document.activeElement).toBe(field('Schema'));
    fireEvent.click(button('Copy problems'));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0]![0]).toMatch(/^\/type \(line 2, column 11\): Must be one of: /);
  });

  it('scenario 4: exact numbers; scenario 5: a repeated key', async () => {
    render(<JsonSchemaTool />);
    type('Schema', '{"multipleOf": 0.1}');
    type('Document', '0.3');
    await until(TEXTS.valid);
    type('Schema', '{"maximum": 12345678901234567890}');
    type('Document', '12345678901234567891');
    await until('1 violation');
    expect(rows()[0]?.[2]).toBe('Must be at most 12345678901234567890, got 12345678901234567891.');
    expect(message('document')).toBe(
      '1 number is kept as written and compared exactly: JSON.parse in JavaScript would change it.',
    );
    type('Schema', '{"properties": {"id": {"type": "integer"}}}');
    type('Document', '{"id": 1, "id": "x"}');
    // Wait for what only the new input gives: the status line already said «1 violation».
    await waitFor(() =>
      expect(message('document')).toBe('Duplicate key "id" at line 1, column 11: every value is checked.'),
    );
    expect(rows()[0]?.[2]).toBe('Expected an integer, got the string "x".');
  });

  it('the draft without $schema and Check formats', async () => {
    render(<JsonSchemaTool />);
    type('Schema', '{"type": "integer", "format": "email"}');
    type('Document', '1.0');
    await until(TEXTS.valid);
    await choose('Draft without $schema', 'Draft 4');
    await until('1 violation');
    expect(message('schema')).toBe('Draft 4 (no $schema: the draft chosen above).');
    type('Schema', '{"format": "email"}');
    type('Document', '"no-at"');
    await until(TEXTS.valid);
    fireEvent.click(screen.getByLabelText('Check formats'));
    await until('1 violation');
    expect(rows()[0]?.[2]).toBe('Is not a valid email address (format "email").');
  });

  it('errors of the fields, and the result of the last valid input staying', async () => {
    render(<JsonSchemaTool />);
    type('Schema', '{"type": "string"}');
    type('Document', '1');
    await until('1 violation');
    type('Document', '{"a":');
    await until(TEXTS.staleDocument);
    expect(message('document')).toBe('Line 1, column 6: unexpected end of input, expected a value');
    expect(screen.getByRole('table', { name: 'Violations' })).toBeTruthy();
    type('Document', '1');
    await until('1 violation');
    type('Schema', '{"type": ');
    await until(TEXTS.staleSchema);
  });

  it('a loop in the schema is said in words', async () => {
    render(<JsonSchemaTool />);
    type('Schema', '{"$ref": "#"}');
    type('Document', '1');
    await waitFor(() =>
      expect(document.querySelector('[data-refused]')?.textContent).toBe(
        'The schema refers to itself in a loop at #: it never moves into the document.',
      ),
    );
  });

  it('a check past the limit is stopped: the worker is terminated, the page offers 10 seconds', async () => {
    mode = 'hang';
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      render(<JsonSchemaTool />);
      type('Schema', '{"pattern": "^(a+)+$"}');
      type('Document', '"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!"');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_200);
      });
      expect(document.querySelector('[data-stopped]')?.textContent).toContain(TEXTS.stopped(1_000));
      expect(workers[0]?.terminated).toBe(true);
      fireEvent.click(button('Allow 10 seconds'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_200);
      });
      expect(document.querySelector('[data-stopped]')?.textContent).toContain(TEXTS.stopped(10_000));
      expect(screen.queryByRole('button', { name: 'Allow 10 seconds' })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a worker that fails says so', async () => {
    mode = 'crash';
    render(<JsonSchemaTool />);
    type('Schema', '{}');
    type('Document', '1');
    await waitFor(() =>
      expect(document.querySelector('[data-failed]')?.textContent).toBe('Validation could not be run: boom.'),
    );
  });

  it('the worker gets each text once: an edit of the document sends only the document', async () => {
    render(<JsonSchemaTool />);
    type('Schema', '{"type": "string"}');
    type('Document', '1');
    await until('1 violation');
    type('Document', '"a"');
    await until(TEXTS.valid);
    const last = workers[0]!.messages.at(-1)!;
    expect(last.kind === 'validate' && last.request.schema).toBeUndefined();
    expect(last.kind === 'validate' && last.request.document).toBe('"a"');
  });

  it('more than 1,000 violations: 1,000 rows, the line, Copy takes all', { timeout: 30_000 }, async () => {
    render(<JsonSchemaTool />);
    type('Schema', '{"items": {"type": "string"}}');
    type('Document', `[${Array.from({ length: 1_500 }, () => '0').join(',')}]`);
    await until('1,500 violations');
    expect(message('violations')).toBe(TEXTS.shownRows(1_500));
    await waitFor(() => expect(rows().length).toBe(1_000), { timeout: 20_000 });
    fireEvent.click(button('Copy violations'));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0]![0].split('\n')).toHaveLength(1_500);
  });

  it('a pasted schema (detect) lands in Schema, any other text in Document', () => {
    const pasted = '{"$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object"}';
    const first = render(<JsonSchemaTool input={pasted} />);
    expect(field('Schema').value).toBe(pasted);
    expect(field('Document').value).toBe('');
    first.unmount();
    render(<JsonSchemaTool input='{"a": 1}' />);
    expect(field('Schema').value).toBe('');
    expect(field('Document').value).toBe('{"a": 1}');
  });
});

describe('Generate schema', () => {
  it('scenario 6: two samples merged; Copy; Validate with it', async () => {
    render(<JsonSchemaTool />);
    fireEvent.click(screen.getByRole('radio', { name: 'Generate schema' }));
    type('Samples', '{"id":1,"name":"Ann","email":null}\n{"id":2,"name":"Bob","tags":["a"]}');
    await waitFor(() => expect(field('Schema').value).not.toBe(''));
    expect(JSON.parse(field('Schema').value)).toMatchObject({
      type: 'object',
      required: ['id', 'name'],
      properties: { tags: { type: 'array', items: { type: 'string' } } },
    });
    expect(message('inferred')).toBe('2 samples merged: properties missing from some samples are not required.');
    fireEvent.click(button('Copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(field('Schema').value));
    const inferred = field('Schema').value;
    fireEvent.click(button('Validate with it'));
    expect(screen.getByRole('radio', { name: 'Validate' }).getAttribute('data-state')).toBe('on');
    expect(field('Schema').value).toBe(inferred);
  });

  it('the switches change the schema', async () => {
    render(<JsonSchemaTool />);
    fireEvent.click(screen.getByRole('radio', { name: 'Generate schema' }));
    type('Samples', '{"s":"on"}\n{"s":"off"}');
    await waitFor(() => expect(field('Schema').value).toContain('"s"'));
    expect(field('Schema').value).not.toContain('enum');
    fireEvent.click(screen.getByLabelText('Enums'));
    await waitFor(() => expect(field('Schema').value).toContain('"enum"'));
    fireEvent.click(screen.getByLabelText('No additional properties'));
    await waitFor(() => expect(field('Schema').value).toContain('"additionalProperties": false'));
    await choose('Draft', 'Draft 7');
    await waitFor(() => expect(field('Schema').value).toContain('http://json-schema.org/draft-07/schema#'));
  });

  it('a sample with an error', async () => {
    render(<JsonSchemaTool />);
    fireEvent.click(screen.getByRole('radio', { name: 'Generate schema' }));
    type('Samples', '{"a":');
    await waitFor(() => expect(message('samples')).toBe('Line 1, column 6: unexpected end of input, expected a value'));
  });
});

describe('the JSON Schema tool’s history', () => {
  it('records a validation snapshot with its outcome, commits a copy, and opens an entry back', async () => {
    const host = memoryHost();
    const history = host.history.forOwner('json-schema', definition.history!);
    const first = render(<JsonSchemaTool host={host} />);
    type('Schema', SCHEMA);
    type('Document', DOC);
    await until('1 violation');
    first.unmount();
    let entries: Awaited<ReturnType<typeof history.list>>['entries'] = [];
    await waitFor(async () => {
      entries = (await history.list({})).entries;
      expect(entries).toHaveLength(1);
    });
    expect(entries[0]).toMatchObject({ kind: 'validate', label: 'Validate · 1 violation' });

    const second = render(<JsonSchemaTool host={host} />);
    type('Schema', '{"$ref": "https://example.com/a.json"}');
    fireEvent.click(button('Add a referenced schema'));
    type('Referenced schema 1', '{"$id": "https://example.com/a.json", "type": "string"}');
    type('Document', '1');
    await until('1 violation');
    fireEvent.click(button('Copy violations'));
    await waitFor(async () => {
      entries = (await history.list({ kinds: ['result'] })).entries;
      expect(entries).toHaveLength(1);
    });
    expect(entries[0]!.label).toBe('Copied violations · 1 violation');
    second.unmount();

    render(<JsonSchemaTool host={host} restore={{ id: entries[0]!.id }} />);
    expect(await screen.findByText('Opened from History: Copied violations · 1 violation.')).toBeTruthy();
    expect(field('Schema').value).toBe('{"$ref": "https://example.com/a.json"}');
    expect(field('Referenced schema 1').value).toBe('{"$id": "https://example.com/a.json", "type": "string"}');
    expect(field('Document').value).toBe('1');
    await until('1 violation');
    await act(() => new Promise(r => setTimeout(r, 50)));
    expect((await history.list({})).entries).toHaveLength(2);
  });

  it('records a generation and opens it back into Generate schema', async () => {
    const host = memoryHost();
    const history = host.history.forOwner('json-schema', definition.history!);
    const first = render(<JsonSchemaTool host={host} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Generate schema' }));
    fireEvent.click(screen.getByLabelText('Enums'));
    type('Samples', '{"a": "x"}');
    await waitFor(() => expect(field('Schema').value).toContain('"const": "x"'));
    first.unmount();
    let entries: Awaited<ReturnType<typeof history.list>>['entries'] = [];
    await waitFor(async () => {
      entries = (await history.list({})).entries;
      expect(entries).toHaveLength(1);
    });
    expect(entries[0]).toMatchObject({ kind: 'infer', label: 'Generate schema · 1 sample' });
    host.settings.forTool('json-schema').reset();
    render(<JsonSchemaTool host={host} restore={{ id: entries[0]!.id }} />);
    expect(await screen.findByText('Opened from History: Generate schema · 1 sample.')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Generate schema' }).getAttribute('data-state')).toBe('on');
    expect(screen.getByLabelText('Enums').getAttribute('data-state')).toBe('checked');
    expect(field('Samples').value).toBe('{"a": "x"}');
  });
});

describe('the JSON Schema tool’s saved parameters (D21, docs/tools/settings.md)', () => {
  const savedOf = (host: ReturnType<typeof memoryHost>) => host.settings.forTool('json-schema').saved();
  const seed = async (host: ReturnType<typeof memoryHost>, values: Record<string, unknown>) => {
    host.settings.forTool('json-schema').save(jsonSchemaSettings.schema, values as never);
    await host.settings.forTool('json-schema').flush();
  };
  const shows = () => ({
    task:
      screen.getByRole('radio', { name: 'Generate schema' }).getAttribute('data-state') === 'on' ? 'infer' : 'validate',
    draft: screen.queryByLabelText('Draft without $schema')?.textContent ?? null,
    formats: screen.queryByLabelText('Check formats')?.getAttribute('data-state') ?? null,
  });

  it('opens with the defaults and saves nothing until an option changes; reopened, it is as left', async () => {
    const host = memoryHost();
    const first = render(<JsonSchemaTool host={host} />);
    expect(shows()).toEqual({ task: 'validate', draft: '2020-12', formats: 'unchecked' });
    type('Schema', '{}');
    await host.settings.forTool('json-schema').flush();
    expect(savedOf(host)).toBeUndefined();
    await choose('Draft without $schema', 'Draft 7');
    fireEvent.click(screen.getByLabelText('Check formats'));
    first.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { draft: 'draft-07', formats: true } });
    render(<JsonSchemaTool host={host} />);
    expect(shows()).toEqual({ task: 'validate', draft: 'Draft 7', formats: 'checked' });
  });

  it('a saved record it cannot show falls back field by field; the rest is used', async () => {
    const host = memoryHost();
    await seed(host, { draft: 'draft-03', formats: true, task: 'nope', enums: 'yes' });
    render(<JsonSchemaTool host={host} />);
    expect(shows()).toEqual({ task: 'validate', draft: '2020-12', formats: 'checked' });
  });

  it('an entry opened from History and a pasted text win for the visit and leave what is saved alone', async () => {
    const host = memoryHost();
    const recorder = host.history.forOwner('json-schema', definition.history!).session();
    await recorder.commit({
      kind: 'result',
      label: 'Copied violations · 1 violation',
      payload: {
        task: 'validate',
        action: 'copy-violations',
        count: 1,
        draft: 'draft-04',
        formats: false,
        referenced: 0,
      },
      blobs: { schema: new Blob(['{"type":"integer"}']), document: new Blob(['1.0']) },
    });
    const [entry] = (await host.history.forOwner('json-schema', definition.history!).list({})).entries;
    await seed(host, { task: 'infer', draft: 'draft-07', formats: true });
    const opened = render(<JsonSchemaTool host={host} restore={{ id: entry!.id }} />);
    expect(await screen.findByText('Opened from History: Copied violations · 1 violation.')).toBeTruthy();
    expect(shows()).toEqual({ task: 'validate', draft: 'Draft 4', formats: 'unchecked' });
    await until('1 violation');
    opened.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { task: 'infer', draft: 'draft-07', formats: true } });

    // A paste from the start page opens Validate for the visit, with the saved draft.
    render(<JsonSchemaTool host={host} input='{"a": 1}' />);
    expect(shows()).toEqual({ task: 'validate', draft: 'Draft 7', formats: 'checked' });
    expect(savedOf(host)).toEqual({ schema: 1, values: { task: 'infer', draft: 'draft-07', formats: true } });
  });

  it('Reset settings goes back to the defaults', async () => {
    const host = memoryHost();
    await seed(host, { draft: 'draft-06', formats: true });
    render(<JsonSchemaTool host={host} />);
    expect(shows()).toEqual({ task: 'validate', draft: 'Draft 6', formats: 'checked' });
    await act(async () => host.settings.forTool('json-schema').reset());
    expect(shows()).toEqual({ task: 'validate', draft: '2020-12', formats: 'unchecked' });
    expect(savedOf(host)).toBeUndefined();
  });
});
