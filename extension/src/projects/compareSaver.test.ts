/**
 * «Compare code» saving a side that is a project's file (./compareSaver.ts): through a connection of its own for each
 * Save, from the version the side came with and then from the one it wrote; a file changed on disk meanwhile is not
 * overwritten; a side whose backend is not the one connected now is not written; refusals in the page's words. The
 * same for a file opened from the computer, through the companion's `openFile.save`. And the last visit of a project
 * (./lastSeen.ts), and «Compare code»'s lazy saver of such sides.
 */
import { chosenBackend } from './behaviors';
import { fakeCompanion } from './companion/fakeLink';
import { compareProjectSaver } from './compareSaver';
import { createConnection } from './connection';
import { demoBackend } from './demo/backend';
import { LAST_SEEN_PREFIX, memoryLastSeen, storedLastSeen } from './lastSeen';
import { companionOpenedFiles } from './openFiles/companion';
import { extensionOwnTab } from './openFiles/ownTab';
import { openedFileSaver } from './openFiles/saver';
import { memoryOpenFilesSettings } from './openFiles/settings';
import { TEXT } from '../app/projects/text';
import { lazyProjectSavers } from '../compare/behaviors';
import { describe, expect, it, vi } from 'vitest';
import type { OpenedFileOrigin, ProjectFileOrigin } from '../compare/handoff';
import type { SaveRequest, SideSaver } from '../compare/sideSaver';
import type { ProjectBackend, ProjectBackendFactory } from './backend';
import type { DemoBackend } from './demo/backend';

const LEDGER = 'p_demo0ledgr';
const request = (text: string): SaveRequest => ({ text, bom: false, suggestedName: 'README.md', handle: null });

/** The demo, kept across connections (each Save makes and lets go of one), counting them. */
const world = () => {
  const demo: DemoBackend = demoBackend({ wait: () => Promise.resolve() });
  const made: ProjectBackend[] = [];
  const factory: ProjectBackendFactory = Object.assign(
    () => {
      const backend: ProjectBackend = { ...demo, name: 'demo', dispose: vi.fn() };
      made.push(backend);
      return backend;
    },
    { id: 'test' },
  );
  return { demo, made, factory };
};

const originOf = async (demo: DemoBackend, path = 'README.md'): Promise<ProjectFileOrigin> => ({
  project: LEDGER,
  path,
  baseHash: (await demo.call('file.read', { project: LEDGER, path })).hash,
  backend: 'demo',
});

describe('compareProjectSaver', () => {
  it('saves from the version it came with, then from the one it wrote; a connection of its own each time, let go', async () => {
    const { demo, made, factory } = world();
    const saver = compareProjectSaver(await originOf(demo), factory);
    expect(await saver.save(request('first\n'))).toMatchObject({ status: 'saved', fileName: 'README.md' });
    expect(await saver.save(request('second\n'))).toMatchObject({ status: 'saved' });
    expect((await demo.call('file.read', { project: LEDGER, path: 'README.md' })).text).toBe('second\n');
    expect(made).toHaveLength(2);
    for (const backend of made) expect(backend.dispose).toHaveBeenCalledTimes(1);
  });

  it('a file changed on disk meanwhile is not overwritten, and the page says so', async () => {
    const { demo, factory } = world();
    const saver = compareProjectSaver(await originOf(demo), factory);
    demo.controls.changeOnDisk(LEDGER, 'README.md', 'someone else\n');
    expect(await saver.save(request('mine\n'))).toMatchObject({
      status: 'failed',
      code: 'conflict',
      message: TEXT.history.compareConflict,
    });
    expect((await demo.call('file.read', { project: LEDGER, path: 'README.md' })).text).toBe('someone else\n');
  });

  it('a refusal in the page’s words; a side of another backend than the one connected is not written', async () => {
    const { demo, factory } = world();
    const secret = compareProjectSaver({ ...(await originOf(demo)), path: '.env' }, factory);
    const refused = await secret.save(request('X=1\n'));
    expect(refused).toMatchObject({ status: 'failed', code: 'secret-file' });
    expect(refused.status === 'failed' && refused.message).toBe(TEXT.history.compareFailed(TEXT.errors.secretFile));
    const elsewhere = compareProjectSaver({ ...(await originOf(demo)), backend: 'companion' }, factory);
    expect(await elsewhere.save(request('x\n'))).toEqual({
      status: 'failed',
      message: TEXT.history.compareNotConnected,
    });
    expect(await elsewhere.saveAs(request('x\n'))).toEqual({ status: 'cancelled' });
  });
});

describe('compareProjectSaver — a file opened from the computer', () => {
  it('saves through `openFile.save` from the version it came with, then from the one it wrote; a conflict is not overwritten', async () => {
    let clock = 1_800_000_000_000;
    const fake = fakeCompanion({ openFiles: true, now: () => clock });
    const { file } = fake.companion.offerFile({ name: 'todo.md', text: 'one\n', claimed: true });
    const made: ProjectBackend[] = [];
    const factory: ProjectBackendFactory = Object.assign(
      () => {
        const backend = chosenBackend(
          createConnection({
            permission: {
              contains: () => Promise.resolve(true),
              request: () => Promise.resolve(true),
              usable: () => true,
              onAdded: () => () => undefined,
              onRemoved: () => () => undefined,
            },
            openLink: fake.openLink,
            extension: '1',
            reload: vi.fn(),
          }),
          demoBackend({ wait: () => Promise.resolve() }),
        );
        made.push(backend);
        return backend;
      },
      { id: 'test' },
    );
    const openFiles = {
      files: companionOpenedFiles,
      saver: openedFileSaver,
      settings: memoryOpenFilesSettings(),
      tab: extensionOwnTab(),
    };
    const first = factory();
    await first.connect();
    const baseHash = (await companionOpenedFiles(first).read(file!)).hash;
    first.dispose();
    const origin: OpenedFileOrigin = {
      file: file!,
      name: 'todo.md',
      displayPath: '~/notes/todo.md',
      baseHash,
      backend: 'companion',
    };
    const saver = compareProjectSaver(origin, factory, openFiles);
    expect(await saver.save(request('two\n'))).toMatchObject({ status: 'saved', fileName: 'todo.md' });
    clock += 1000;
    expect(await saver.save(request('three\n'))).toMatchObject({ status: 'saved' });
    expect(fake.companion.opened.files.get(file!)!.text).toBe('three\n');
    clock += 1000;
    fake.companion.changeOpenedOnDisk(file!, 'theirs\n');
    expect(await saver.save(request('mine\n'))).toMatchObject({
      status: 'failed',
      code: 'conflict',
      message: TEXT.history.compareConflict,
    });
    expect(fake.companion.opened.files.get(file!)!.text).toBe('theirs\n');
    clock += 1000;
    fake.companion.replaceOpened(file!);
    const replaced = await saver.save(request('again\n'));
    expect(replaced.status === 'failed' && replaced.message).toBe(
      TEXT.history.compareFailed(TEXT.openFiles.readOnly.replaced!),
    );
    // Each Save had a connection of its own, let go.
    expect(made).toHaveLength(5);
    // The demo has no such files: a side of the companion's is not written there.
    const demoOnly = compareProjectSaver(
      origin,
      Object.assign(() => ({ ...demoBackend({ wait: () => Promise.resolve() }), name: 'demo' as const }), {
        id: 'demo',
      }),
      openFiles,
    );
    expect(await demoOnly.save(request('x\n'))).toEqual({
      status: 'failed',
      message: TEXT.history.compareNotConnected,
    });
  });
});

describe('lazyProjectSavers («Compare code»)', () => {
  it('loads the implementation on the first Save only, and keeps one saver per handed file', async () => {
    const save = vi.fn((r: SaveRequest) =>
      Promise.resolve({ status: 'saved' as const, fileName: r.suggestedName, handle: null, how: 'file' as const }),
    );
    const make = vi.fn((): SideSaver => ({ name: 'inner', save, saveAs: save }));
    const load = vi.fn(() => Promise.resolve(make));
    const savers = lazyProjectSavers(load);
    const origin: ProjectFileOrigin = { project: 'p', path: 'a.txt', baseHash: 'h', backend: 'companion' };
    const one = savers(origin);
    expect(savers(origin)).toBe(one);
    expect(load).not.toHaveBeenCalled();
    await one.save(request('a'));
    await one.save(request('b'));
    expect(load).toHaveBeenCalledTimes(1);
    expect(make).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(2);
    expect(savers({ ...origin })).not.toBe(one);
  });
});

describe('LastSeen', () => {
  it('chrome.storage.local: one key per project; nothing stored reads as never; a failing storage forgets', async () => {
    const data: Record<string, unknown> = {};
    const area = {
      get: vi.fn((key: string) => Promise.resolve({ [key]: data[key] })),
      set: vi.fn((items: Record<string, unknown>) => Promise.resolve(void Object.assign(data, items))),
    } as unknown as Pick<chrome.storage.StorageArea, 'get' | 'set'>;
    const memory = storedLastSeen(() => area);
    expect(await memory.get('p_a')).toBeNull();
    memory.set('p_a', 1234);
    await Promise.resolve();
    expect(data[`${LAST_SEEN_PREFIX}p_a`]).toBe(1234);
    expect(await memory.get('p_a')).toBe(1234);
    data[`${LAST_SEEN_PREFIX}p_b`] = 'not a time';
    expect(await memory.get('p_b')).toBeNull();
    expect(await storedLastSeen(() => null).get('p_a')).toBeNull();
    const broken = storedLastSeen(
      () => ({ get: () => Promise.reject(new Error('x')), set: () => Promise.reject(new Error('x')) }) as never,
    );
    expect(await broken.get('p_a')).toBeNull();
    expect(() => broken.set('p_a', 1)).not.toThrow();
  });

  it('in memory for the page’s life', async () => {
    const memory = memoryLastSeen({ p_a: 5 });
    expect(await memory.get('p_a')).toBe(5);
    memory.set('p_a', 9);
    expect(await memory.get('p_a')).toBe(9);
  });
});
