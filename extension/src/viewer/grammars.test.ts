/**
 * The grammar files' loader (./grammars.ts) with fakes — no wasm: the package's files are a map, the module's linking
 * and registration are counters. One load per grammar, shared while it runs; a file that is not the index's, a missing
 * file, an index or a grammar for another runtime, a module that refuses — each leaves the text plain and is reported
 * once; a page that is going away reports nothing.
 */
import { createGrammarLoader, subtleSha256 } from './grammars';
import { describe, expect, it, vi } from 'vitest';
import type { GrammarEvent, GrammarLoaderDeps } from './grammars';
import type { GrammarEntry, GrammarHost, GrammarIndex } from '@extension/review-wasm';

const bytesOf = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;

const entry = async (file: string, content: string, extra: Partial<GrammarEntry> = {}): Promise<GrammarEntry> => ({
  file,
  size: bytesOf(content).length,
  sha256: await subtleSha256(bytesOf(content)),
  abi: 14,
  symbol: `tree_sitter_${file.replace('.wasm', '')}`,
  injects: [],
  highlights: '(identifier) @variable',
  injections: '',
  locals: '',
  ...extra,
});

const FILES: Record<string, string> = {
  'go.wasm': 'go grammar',
  'embedded_template.wasm': 'templates',
  'sql.wasm': 'sql grammar',
};

const makeIndex = async (): Promise<GrammarIndex> => ({
  format: 1,
  runtime: { crate: 'tree-sitter', version: '0.27.2', abi: { min: 13, max: 15 } },
  languages: {
    go: 'go',
    golang: 'go',
    erb: 'erb',
    ejs: 'ejs',
    sql: 'sql',
    rust: 'rust',
    rs: 'rust',
    graphql: 'graphql',
  },
  builtIn: ['rust'],
  none: ['graphql'],
  grammars: {
    go: await entry('go.wasm', FILES['go.wasm']),
    erb: await entry('embedded_template.wasm', FILES['embedded_template.wasm']),
    ejs: await entry('embedded_template.wasm', FILES['embedded_template.wasm']),
    sql: await entry('sql.wasm', FILES['sql.wasm']),
  },
});

/** A loader over fakes; `files` may be changed or held back by a test. */
const setup = async (overrides: Partial<GrammarLoaderDeps> = {}, files: Record<string, string> = { ...FILES }) => {
  const events: GrammarEvent[] = [];
  const held: Array<() => void> = [];
  const fetched: string[] = [];
  let hold = false;
  let leaving = false;
  const host = {
    abi: { min: 13, max: 15 },
    link: vi.fn<GrammarHost['link']>(async (_bytes, symbol) => 1000 + symbol.length),
    register: vi.fn<GrammarHost['register']>(() => true),
  } satisfies GrammarHost;
  const loader = createGrammarLoader({
    index: await makeIndex(),
    host,
    fetchFile: async file => {
      fetched.push(file);
      if (hold) await new Promise<void>(resolve => held.push(resolve));
      if (leaving) throw new TypeError('Failed to fetch: the request was aborted');
      if (!(file in files)) throw new Error(`grammars/${file}: HTTP 404`);
      return bytesOf(files[file]);
    },
    sha256: subtleSha256,
    onEvent: event => events.push(event),
    life: { leaving: () => leaving },
    later: run => run(),
    now: () => 0,
    ...overrides,
  });
  return {
    loader,
    host,
    events,
    fetched,
    hold: () => (hold = true),
    release: () => held.splice(0).forEach(resolve => resolve()),
    leave: () => (leaving = true),
  };
};

describe('the language a name means', () => {
  it('an id or an alias of the table is its id; anything else goes to the module as it is', async () => {
    const { loader } = await setup();
    expect(loader.use('rs')).toBe('rust');
    expect(loader.use('golang')).toBe('go');
    expect(loader.use('GoLang')).toBe('go');
    expect(loader.use('graphql')).toBe('graphql');
    expect(loader.use('brainfuck')).toBe('brainfuck');
    expect(loader.use('text')).toBe('text');
  });

  it('a built-in language or one with no grammar loads nothing', async () => {
    const { loader, fetched } = await setup();
    loader.use('rust');
    loader.use('graphql');
    loader.use('brainfuck');
    await Promise.resolve();
    expect(fetched).toEqual([]);
  });

  it('without an index every name goes as it is, nothing is fetched, and that is reported once', async () => {
    const events: GrammarEvent[] = [];
    const { loader, fetched } = await setup({
      index: new Error('grammars/index.json: HTTP 404'),
      onEvent: event => events.push(event),
    });
    expect(loader.use('golang')).toBe('golang');
    expect(await loader.load('go')).toBe(false);
    expect(fetched).toEqual([]);
    expect(events).toEqual([{ language: '*', state: 'failed', message: 'grammars/index.json: HTTP 404' }]);
  });
});

describe('loading a grammar file', () => {
  it('fetches, checks, links and registers it once, and says whether the open text was repainted', async () => {
    const { loader, host, events, fetched } = await setup();
    expect(loader.use('go')).toBe('go');
    expect(await loader.load('go')).toBe(true);
    expect(fetched).toEqual(['go.wasm']);
    expect(host.link).toHaveBeenCalledTimes(1);
    expect(host.link.mock.calls[0][1]).toBe('tree_sitter_go');
    expect(host.register).toHaveBeenCalledTimes(1);
    expect(host.register.mock.calls[0][0]).toMatchObject({ id: 'go', abi: 14, highlights: '(identifier) @variable' });
    expect(events).toEqual([{ language: 'go', state: 'loaded', repainted: true, ms: 0 }]);
    // Later texts in Go: nothing more.
    loader.use('go');
    loader.use('golang');
    expect(await loader.load('go')).toBe(true);
    expect(fetched).toEqual(['go.wasm']);
    expect(host.register).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
  });

  it('requests while it loads share the one load: one fetch, one link, one repaint', async () => {
    const { loader, host, fetched, hold, release } = await setup();
    hold();
    const first = loader.load('go');
    loader.use('go');
    loader.use('golang');
    const second = loader.load('go');
    expect(second).toBe(first);
    release();
    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(fetched).toEqual(['go.wasm']);
    expect(host.link).toHaveBeenCalledTimes(1);
    expect(host.register).toHaveBeenCalledTimes(1);
  });

  it('two languages of one file link it once and register each', async () => {
    const { loader, host, fetched } = await setup();
    expect(await Promise.all([loader.load('erb'), loader.load('ejs')])).toEqual([true, true]);
    expect(fetched).toEqual(['embedded_template.wasm']);
    expect(host.link).toHaveBeenCalledTimes(1);
    expect(host.register.mock.calls.map(([e, language]) => [e.id, language])).toEqual([
      ['erb', 1000 + 'tree_sitter_embedded_template'.length],
      ['ejs', 1000 + 'tree_sitter_embedded_template'.length],
    ]);
  });
});

describe('a grammar that cannot be used leaves the text plain and is reported once', () => {
  it('a file that is not the one the index states (another hash) is never linked', async () => {
    const { loader, host, events, fetched } = await setup({}, { ...FILES, 'go.wasm': 'go grammar, changed' });
    expect(await loader.load('go')).toBe(false);
    expect(host.link).not.toHaveBeenCalled();
    expect(host.register).not.toHaveBeenCalled();
    expect(events).toEqual([
      { language: 'go', state: 'failed', message: 'grammars/go.wasm is not the file the index states' },
    ]);
    // Not tried again, not reported again.
    loader.use('go');
    expect(await loader.load('go')).toBe(false);
    expect(fetched).toEqual(['go.wasm']);
    expect(events).toHaveLength(1);
  });

  it('a file of the same size and another content is refused by its hash', async () => {
    const { loader, host, events } = await setup({}, { ...FILES, 'go.wasm': 'go grammaR' });
    expect(await loader.load('go')).toBe(false);
    expect(host.link).not.toHaveBeenCalled();
    expect(events[0]).toMatchObject({ language: 'go', state: 'failed' });
  });

  it('a missing file', async () => {
    const { loader, host, events } = await setup({}, { 'embedded_template.wasm': 'templates' });
    expect(await loader.load('go')).toBe(false);
    expect(host.register).not.toHaveBeenCalled();
    expect(events).toEqual([{ language: 'go', state: 'failed', message: 'grammars/go.wasm: HTTP 404' }]);
  });

  it('a grammar of an ABI version the module does not take is refused before it is fetched', async () => {
    const index = await makeIndex();
    index.grammars.sql = { ...index.grammars.sql, abi: 16 };
    const { loader, host, events, fetched } = await setup({ index });
    expect(await loader.load('sql')).toBe(false);
    expect(fetched).toEqual([]);
    expect(host.link).not.toHaveBeenCalled();
    expect(events[0]).toMatchObject({ language: 'sql', state: 'failed' });
    expect(events[0].state === 'failed' && events[0].message).toMatch(/ABI version 16/);
  });

  it('an index made for another runtime: no grammar file is used at all', async () => {
    const index = await makeIndex();
    index.runtime.abi = { min: 13, max: 14 };
    const { loader, fetched, events } = await setup({ index });
    expect(loader.use('golang')).toBe('golang');
    expect(await loader.load('go')).toBe(false);
    expect(fetched).toEqual([]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ language: '*', state: 'failed' });
  });

  it('the module refuses the grammar (its queries, its language)', async () => {
    const { loader, host, events } = await setup();
    host.register.mockImplementation(() => {
      throw 'register_grammar: grammar go: its queries do not compile: …';
    });
    expect(await loader.load('go')).toBe(false);
    expect(events).toEqual([
      { language: 'go', state: 'failed', message: 'register_grammar: grammar go: its queries do not compile: …' },
    ]);
  });

  it('linking fails', async () => {
    const { loader, host, events } = await setup();
    host.link.mockRejectedValueOnce(new Error('the editor module does not export calloc (function)'));
    expect(await loader.load('go')).toBe(false);
    expect(host.register).not.toHaveBeenCalled();
    expect(events).toEqual([
      { language: 'go', state: 'failed', message: 'the editor module does not export calloc (function)' },
    ]);
  });
});

describe('a page that is going away', () => {
  it('a load it interrupts is not reported', async () => {
    const { loader, host, events, hold, release, leave } = await setup();
    hold();
    const loading = loader.load('go');
    leave();
    release();
    expect(await loading).toBe(false);
    expect(host.register).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('an abort waits a moment and is reported only if the page stayed', async () => {
    const timers: Array<() => void> = [];
    const { loader, events } = await setup(
      {
        fetchFile: async () => {
          throw new DOMException('The user aborted a request.', 'AbortError');
        },
        later: run => timers.push(run),
      },
      {},
    );
    expect(await loader.load('go')).toBe(false);
    expect(events).toEqual([]);
    timers.splice(0).forEach(run => run());
    expect(events).toEqual([{ language: 'go', state: 'failed', message: 'The user aborted a request.' }]);
  });
});
