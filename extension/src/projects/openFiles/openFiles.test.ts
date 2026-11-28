/**
 * Files opened from the system (D42, step O2): the seam `OpenedFiles` over the companion — the wire module
 * (./companion.ts) against the scripted companion of scripts/e2e-projects/ with `openFiles: true` (the e2e's fake host
 * speaks the same one), and against frames this page cannot read; a companion that announces nothing of it; the saver
 * (./saver.ts), the settings (./settings.ts) and the page's own tab (./ownTab.ts).
 */
import { companionOpenedFiles, OPEN_REQUESTED } from './companion';
import { chromeOwnTab, noOwnTab } from './ownTab';
import { openedFileSaver } from './saver';
import {
  OPEN_FILES_BRING_FORWARD_KEY,
  OPEN_FILES_DEFAULTS,
  OPEN_FILES_OPENED_KEY,
  OPEN_FILES_REUSE_TAB_KEY,
  memoryOpenFilesSettings,
  storedOpenFilesSettings,
} from './settings';
import { chosenBackend } from '../behaviors';
import { VECTORS, fakeCompanion } from '../companion/fakeLink';
import { errorCode } from '../companion/link';
import { createConnection } from '../connection';
import { demoBackend } from '../demo/backend';
import { CompanionError, isCompanionError } from '../types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectBackend } from '../backend';
import type { PermissionGate } from '../permission';
import type { OpenedFiles } from './files';

const granted: PermissionGate = {
  contains: () => Promise.resolve(true),
  request: () => Promise.resolve(true),
  usable: () => true,
  onAdded: () => () => undefined,
  onRemoved: () => () => undefined,
};

let backend: ProjectBackend | null = null;
afterEach(() => {
  backend?.dispose();
  backend = null;
});

const connect = async (options: Parameters<typeof fakeCompanion>[0] = { openFiles: true }) => {
  const fake = fakeCompanion(options);
  backend = chosenBackend(
    createConnection({ permission: granted, openLink: fake.openLink, extension: '1', reload: vi.fn() }),
    demoBackend({ wait: () => Promise.resolve() }),
  );
  await backend.connect();
  const files = companionOpenedFiles(backend);
  const sent = (method: string): unknown[] =>
    fake.ports.flatMap(p => p.sent).filter(f => (f as { method?: string }).method === method);
  return { fake, files, sent };
};

const codeOf = (promise: Promise<unknown>): Promise<string> =>
  promise.then(
    () => 'resolved',
    (error: unknown) => (isCompanionError(error) ? error.code : String(error)),
  );

const TOKEN = 'a1'.repeat(16);

describe('opened files over the companion', () => {
  it('a companion that announces them: offered, with each further method on its own', async () => {
    const { files } = await connect();
    expect(files.offered()).toBe(true);
    for (const action of ['save', 'history', 'historyContent', 'restore', 'forget', 'activity'] as const)
      expect(files.can(action)).toBe(true);
  });

  it('a companion that does not: nothing offered, nothing sent — not even the page’s activity', async () => {
    const { files, sent } = await connect({});
    expect(files.offered()).toBe(false);
    expect(files.can('save')).toBe(false);
    await files.activity(true, 1);
    expect(await codeOf(files.claim(TOKEN))).toBe('unknown-method');
    expect(await codeOf(files.list())).toBe('unknown-method');
    expect([...sent('page.activity'), ...sent('openFile.claim'), ...sent('openFile.list')]).toEqual([]);
  });

  it('claims a token once: the file, its marks and where the caret goes; then the token is spent', async () => {
    const { fake, files } = await connect();
    const { token } = fake.companion.offerFile({
      name: 'zshrc',
      displayPath: '~/.zshrc',
      text: 'export A=1\n',
      executes: true,
      via: 'open-with',
      line: 4,
      column: 2,
    });
    expect(await files.pending()).toEqual([token]);
    const claim = await files.claim(token);
    expect(claim).toEqual({
      kind: 'file',
      file: {
        id: expect.any(String),
        name: 'zshrc',
        displayPath: '~/.zshrc',
        mode: 'edit',
        executes: true,
        reason: null,
        via: null,
        openedAt: null,
      },
      at: { line: 4, column: 2 },
    });
    expect(await codeOf(files.claim(token))).toBe('not-found');
    expect(await files.pending()).toEqual([]);
    const [listed] = await files.list();
    expect(listed).toMatchObject({ name: 'zshrc', via: 'open-with', executes: true, reason: null });
    expect(typeof listed!.openedAt).toBe('number');
  });

  it('an expired or unknown token is `not-found`; a token of another shape `invalid-params`', async () => {
    const { fake, files } = await connect();
    const { token } = fake.companion.offerFile({});
    fake.companion.expireTokens();
    expect(await files.pending()).toEqual([]);
    expect(await codeOf(files.claim(token))).toBe('not-found');
    expect(await codeOf(files.claim('ffffffffffffffffffffffffffffffff'))).toBe('not-found');
    expect(await codeOf(files.claim('x'))).toBe('invalid-params');
  });

  it('a token for a file inside an added project names the project, the path and the project’s class', async () => {
    const { fake, files } = await connect();
    const { token } = fake.companion.offerFile({ project: 'p_abcdefgh23', path: 'src/app.txt', line: 3 });
    expect(await files.claim(token)).toEqual({
      kind: 'project',
      project: 'p_abcdefgh23',
      path: 'src/app.txt',
      name: 'app.txt',
      displayPath: '~/fx/repo/src/app.txt',
      class: 'mine',
      at: { line: 3 },
    });
  });

  it('reads and saves from the version read; a file that moved on is a conflict naming the disk’s version', async () => {
    const { fake, files } = await connect();
    const { token } = fake.companion.offerFile({ text: 'one\n' });
    const claim = await files.claim(token);
    if (claim.kind !== 'file') throw new Error('a file');
    const read = await files.read(claim.file.id);
    expect(read.text).toBe('one\n');
    const saved = await files.save(claim.file.id, read.hash, 'two\n');
    expect(saved.hash).not.toBe(read.hash);
    expect((await files.read(claim.file.id)).text).toBe('two\n');
    // One save of a file per 500 ms: the next one at once is told when to try again.
    const soon = await files.save(claim.file.id, saved.hash, 'three\n').catch((e: unknown) => e);
    expect(isCompanionError(soon, 'rate-limited') && typeof soon.data?.retryAfterMs).toBe('number');
    fake.companion.changeOpenedOnDisk(claim.file.id, 'theirs\n');
    await new Promise(resolve => setTimeout(resolve, 520));
    const conflict = await files.save(claim.file.id, saved.hash, 'mine\n').catch((e: unknown) => e);
    expect(isCompanionError(conflict, 'conflict')).toBe(true);
    expect((conflict as CompanionError).data?.currentHash).toBe((await files.read(claim.file.id)).hash);
  });

  it('a read-only file is refused with `not-editable` and its reason — a secret too; a replaced file from then on', async () => {
    const { fake, files } = await connect();
    for (const spec of [{ reason: 'requested' as const }, { reason: 'secret' as const }]) {
      const claim = await files.claim(fake.companion.offerFile(spec).token);
      if (claim.kind !== 'file') throw new Error('a file');
      expect([claim.file.mode, claim.file.reason]).toEqual(['read', spec.reason]);
      const { hash } = await files.read(claim.file.id);
      const refused = await files.save(claim.file.id, hash, 'x').catch((e: unknown) => e);
      expect(isCompanionError(refused, 'not-editable') && refused.data?.reason).toBe(spec.reason);
    }
    const { token, file } = fake.companion.offerFile({ text: 'mine\n' });
    await files.claim(token);
    const { hash } = await files.read(file!);
    fake.companion.replaceOpened(file!);
    const replaced = await files.save(file!, hash, 'x').catch((e: unknown) => e);
    expect(isCompanionError(replaced, 'not-editable') && replaced.data?.reason).toBe('replaced');
  });

  it('keeps the companion’s own copies of the file, gives a copy’s text and restores one; forgets a file', async () => {
    const { fake, files } = await connect();
    const claim = await files.claim(fake.companion.offerFile({ text: 'first\n' }).token);
    if (claim.kind !== 'file') throw new Error('a file');
    const id = claim.file.id;
    const { hash } = await files.read(id);
    const saved = await files.save(id, hash, 'second\n');
    const [copy] = await files.history(id);
    expect(copy).toMatchObject({ label: 'Before save', content: true });
    expect(await files.historyContent(id, copy!.point)).toEqual({ text: 'first\n', secret: false });
    const restored = await files.restore(id, copy!.point, saved.hash);
    expect(restored.before).toMatch(/^f:/);
    expect((await files.read(id)).text).toBe('first\n');
    await files.forget(id);
    expect(await files.list()).toEqual([]);
    expect(await codeOf(files.read(id))).toBe('not-found');
  });

  it('tells the companion the page’s visibility and focus, as a time in ms', async () => {
    const { fake, files, sent } = await connect();
    await files.activity(true, 1234.7);
    await files.activity(false, 0);
    expect(sent('page.activity').map(f => (f as { params: unknown }).params)).toEqual([
      { visible: true, focusedAt: 1234 },
      { visible: false, focusedAt: 0 },
    ]);
    expect(fake.companion.opened.activity).toHaveLength(2);
  });

  it('hears `open.requested` with its token; other events and broken ones are not taken', async () => {
    const { fake, files } = await connect();
    const heard: string[] = [];
    const undo = files.onRequested(token => heard.push(token));
    fake.emit(OPEN_REQUESTED, null, { token: TOKEN });
    fake.emit(OPEN_REQUESTED, null, { token: 42 });
    fake.emit(OPEN_REQUESTED, null, null);
    fake.emit('projects.changed', null, {});
    await vi.waitFor(() => expect(heard).toEqual([TOKEN]));
    undo();
    fake.emit(OPEN_REQUESTED, null, { token: 'ffffffffffffffffffffffffffffffff' });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(heard).toHaveLength(1);
  });
});

describe('the contract’s vectors, read by the wire module', () => {
  const vector = (method: string, at = 0) => {
    const list = VECTORS[`${method}.json`] as { response: { result?: unknown } }[];
    return list[at]!.response.result;
  };
  const fromVectors = companionOpenedFiles({
    capabilities: () => ({ methods: [] as never, demo: false }),
    call: (method: string) => Promise.resolve(vector(method)),
    subscribe: () => () => undefined,
  } as unknown as ProjectBackend);

  it('every answer of `openFile.*` in the companion’s own words reads into the seam’s types', async () => {
    expect(await fromVectors.claim(TOKEN)).toEqual({
      kind: 'file',
      file: {
        id: 'f_<ID>',
        name: 'todo.md',
        displayPath: '~/notes/todo.md',
        mode: 'edit',
        executes: false,
        reason: null,
        via: null,
        openedAt: null,
      },
      at: { line: 1 },
    });
    expect(await fromVectors.pending()).toEqual(['<TOKEN>']);
    expect(await fromVectors.list()).toMatchObject([{ id: 'f_<ID>', via: 'terminal', openedAt: 0 }]);
    expect((await fromVectors.read('f')).text).toBe('- one\n- two\n');
    expect((await fromVectors.save('f', 'h', 't')).hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await fromVectors.history('f')).toMatchObject([{ label: 'Before save', content: true }]);
    expect(await fromVectors.historyContent('f', 'p')).toEqual({ text: '- one\n- two\n', secret: false });
    expect((await fromVectors.restore('f', 'p', 'h')).before).toMatch(/^f:/);
  });
});

describe('the wire module reads what it can and refuses the rest', () => {
  /** A backend that announces everything and answers each method with what the test says. */
  const answering = (answers: Record<string, unknown>): OpenedFiles =>
    companionOpenedFiles({
      capabilities: () => ({ methods: Object.keys(answers) as never, demo: false }),
      call: (method: string) => Promise.resolve(answers[method]),
      subscribe: () => () => undefined,
    } as unknown as ProjectBackend);

  it('a claim in neither shape, a list that is not one, a save without a hash: `internal`', async () => {
    const files = answering({
      'openFile.claim': { name: 'x' },
      'openFile.read': { text: 'a' },
      'openFile.list': { files: [] },
      'openFile.pending': [],
      'openFile.save': {},
    });
    expect(await codeOf(files.claim('t'))).toBe('internal');
    expect(await codeOf(files.read('f'))).toBe('internal');
    expect(await codeOf(files.list())).toBe('internal');
    expect(await codeOf(files.pending())).toBe('internal');
    expect(await codeOf(files.save('f', 'h', 'x'))).toBe('internal');
  });

  it('drops list entries it cannot read and unknown marks; keeps line without a bad column', async () => {
    const files = answering({
      'openFile.claim': {
        kind: 'file',
        file: 'f_1',
        name: 'a.md',
        displayPath: '~/a.md',
        mode: 'edit',
        executes: false,
        reason: 'secret',
        line: 2,
        column: -1,
      },
      'openFile.read': {},
      'openFile.list': [
        {
          file: 'f_1',
          name: 'a.md',
          displayPath: '~/a.md',
          mode: 'read',
          via: 'carrier-pigeon',
          openedAt: 5,
          reason: 'odd',
        },
        { file: 'f_2', name: 'b.md', displayPath: '~/b.md', mode: 'write' },
        null,
      ],
    });
    // A reason in mode `edit` is no reason; a bad column is no column.
    expect(await files.claim('t')).toMatchObject({ kind: 'file', file: { reason: null }, at: { line: 2 } });
    expect(await files.list()).toEqual([
      {
        id: 'f_1',
        name: 'a.md',
        displayPath: '~/a.md',
        mode: 'read',
        executes: false,
        reason: null,
        via: null,
        openedAt: 5,
      },
    ]);
  });

  it('`not-editable` is a contract code the frame check keeps; an unknown code is `internal`', () => {
    expect(errorCode('not-editable')).toBe('not-editable');
    expect(errorCode('conflict')).toBe('conflict');
    expect(errorCode('made-up')).toBe('internal');
  });
});

describe('openedFileSaver', () => {
  const files = (save: OpenedFiles['save']): OpenedFiles => ({ save }) as unknown as OpenedFiles;

  it('writes from its base and moves the base on; Save says saved under the file’s name', async () => {
    const save = vi.fn((_f: string, base: string) => Promise.resolve({ hash: `${base}+` }));
    const saver = openedFileSaver(files(save), 'f_1', 'todo.md', 'h0');
    expect(await saver.write('a', saver.baseHash)).toEqual({ hash: 'h0+' });
    expect(saver.baseHash).toBe('h0+');
    expect(await saver.save({ text: 'b', bom: false, suggestedName: 'x', handle: null })).toEqual({
      status: 'saved',
      fileName: 'todo.md',
      handle: null,
      how: 'file',
    });
    expect(save).toHaveBeenLastCalledWith('f_1', 'h0+', 'b');
  });

  it('a refusal carries the companion’s code and data, never its message; cancelled is cancelled', async () => {
    const saver = openedFileSaver(
      files(() => Promise.reject(new CompanionError('conflict', 'raw words', { currentHash: 'd' }))),
      'f_1',
      'todo.md',
      'h0',
    );
    expect(await saver.save({ text: 'b', bom: false, suggestedName: 'x', handle: null })).toEqual({
      status: 'failed',
      message: 'conflict',
      code: 'conflict',
      data: { currentHash: 'd' },
    });
    const cancelled = openedFileSaver(
      files(() => Promise.reject(new CompanionError('cancelled', 'x'))),
      'f_1',
      'a',
      'h',
    );
    expect(await cancelled.save({ text: 'b', bom: false, suggestedName: 'x', handle: null })).toEqual({
      status: 'cancelled',
    });
  });

  it('Save as is the browser’s saver, or cancelled without one — never a new file through the companion', async () => {
    const request = { text: 'b', bom: false, suggestedName: 'todo.md', handle: null };
    const save = vi.fn();
    expect(await openedFileSaver(files(save), 'f_1', 'todo.md', 'h').saveAs(request)).toEqual({ status: 'cancelled' });
    const browser = {
      name: 'download',
      save: vi.fn(),
      saveAs: vi.fn(() => Promise.resolve({ status: 'cancelled' as const })),
    };
    await openedFileSaver(files(save), 'f_1', 'todo.md', 'h', { saveAs: browser }).saveAs(request);
    expect(browser.saveAs).toHaveBeenCalledWith(request);
    expect(save).not.toHaveBeenCalled();
  });
});

describe('the settings of opened files', () => {
  it('defaults: the same tab, brought forward, nothing opened yet', async () => {
    expect(OPEN_FILES_DEFAULTS).toEqual({ reuseTab: true, bringForward: true, opened: false });
    expect(await memoryOpenFilesSettings().get()).toEqual(OPEN_FILES_DEFAULTS);
    expect(await storedOpenFilesSettings(() => null).get()).toEqual(OPEN_FILES_DEFAULTS);
  });

  it('one key each in the extension’s storage; a stored value of another type is the default', async () => {
    const kept: Record<string, unknown> = { [OPEN_FILES_REUSE_TAB_KEY]: 'no', [OPEN_FILES_BRING_FORWARD_KEY]: false };
    const area = {
      get: vi.fn((keys: string[]) => Promise.resolve(Object.fromEntries(keys.map(k => [k, kept[k]])))),
      set: vi.fn((items: Record<string, unknown>) => Promise.resolve(void Object.assign(kept, items))),
    };
    const store = storedOpenFilesSettings(() => area as never);
    expect(await store.get()).toEqual({ reuseTab: true, bringForward: false, opened: false });
    await store.set({ opened: true, reuseTab: false });
    expect(area.set).toHaveBeenCalledWith({ [OPEN_FILES_OPENED_KEY]: true, [OPEN_FILES_REUSE_TAB_KEY]: false });
    expect(await store.get()).toEqual({ reuseTab: false, bringForward: false, opened: true });
  });

  it('a storage that fails only loses the memory', async () => {
    const broken = { get: () => Promise.reject(new Error('x')), set: () => Promise.reject(new Error('x')) };
    const store = storedOpenFilesSettings(() => broken as never);
    await expect(store.set({ opened: true })).resolves.toBeUndefined();
    expect(await store.get()).toEqual(OPEN_FILES_DEFAULTS);
  });
});

describe('the page’s own tab', () => {
  const api = () => ({
    tabs: {
      getCurrent: vi.fn(() => Promise.resolve({ id: 7, windowId: 3, index: 2 } as chrome.tabs.Tab)),
      update: vi.fn(() => Promise.resolve({} as chrome.tabs.Tab)),
      create: vi.fn(() => Promise.resolve({} as chrome.tabs.Tab)),
    },
    windows: { update: vi.fn(() => Promise.resolve({} as chrome.windows.Window)) },
  });

  it('brings its own tab and window forward — nothing else', async () => {
    const chromeApi = api();
    await chromeOwnTab(() => chromeApi as never).bringForward();
    expect(chromeApi.tabs.update).toHaveBeenCalledWith(7, { active: true });
    expect(chromeApi.windows.update).toHaveBeenCalledWith(3, { focused: true });
  });

  it('opens the page at a hash in a new tab next to its own', async () => {
    const chromeApi = api();
    await chromeOwnTab(
      () => chromeApi as never,
      () => 'chrome-extension://id/src/app/index.html',
    ).openTab('#/projects/open/tok');
    expect(chromeApi.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://id/src/app/index.html#/projects/open/tok',
      windowId: 3,
      index: 3,
      openerTabId: 7,
    });
  });

  it('a refusal or no API is no error', async () => {
    const chromeApi = api();
    chromeApi.windows.update.mockRejectedValue(new Error('no'));
    await expect(chromeOwnTab(() => chromeApi as never).bringForward()).resolves.toBeUndefined();
    await expect(chromeOwnTab(() => null).openTab('#/x')).resolves.toBeUndefined();
    await expect(noOwnTab.bringForward()).resolves.toBeUndefined();
  });
});
