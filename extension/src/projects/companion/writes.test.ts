/**
 * The companion's client and backend with the methods of stages 4–6 (the companion's specification §12, rows 4.5, 5.4,
 * 6.5), over the scripted companion: each new method, a request that waits for the companion's window and its
 * `cancel`, the streamed output of a commit, every refusal in the contract's code and data, and an older companion
 * whose `welcome` lacks them — the page then never sends them.
 */
import { companionBackend } from './backend';
import { fakeCompanion } from './fakeLink';
import { TRUSTED_ROOT } from '../../../../scripts/e2e-projects/companion.mjs';
import { createConnection } from '../connection';
import { isCompanionError } from '../types';
import { describe, expect, it } from 'vitest';
import type { ProjectBackend } from '../backend';
import type { PermissionGate } from '../permission';

const PROJECT = 'p_abcdefgh23';

const granted: PermissionGate = {
  contains: () => Promise.resolve(true),
  request: () => Promise.resolve(true),
  usable: () => true,
  onAdded: () => () => undefined,
  onRemoved: () => () => undefined,
};

const open = async (options: Parameters<typeof fakeCompanion>[0] = {}) => {
  const fake = fakeCompanion({ wait: () => new Promise(resolve => setTimeout(resolve, 5)), ...options });
  const backend: ProjectBackend = companionBackend(
    createConnection({ permission: granted, openLink: fake.openLink, extension: '1.0.0', reload: () => undefined }),
  );
  await backend.connect();
  const sent = (method: string): number =>
    fake.ports.flatMap(p => p.sent).filter(f => (f as { method?: string }).method === method).length;
  return { fake, backend, sent };
};

const failure = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  if (!isCompanionError(error)) throw new Error(`expected a refusal, got ${String(error)}`);
  return { code: error.code, data: error.data };
};

/** The scripted project's status, and a file's version as it was shown. */
const shown = async (backend: ProjectBackend, path: string) => {
  const status = await backend.call('git.status', { project: PROJECT });
  const file = status.files.find(f => f.path === path)!;
  return { status, file, expect: { path, diskHash: file.diskHash ?? null } };
};

describe('classes, trusted folders, adding (row 4.5)', () => {
  it('lists the trusted folders; adds a folder inside one at once, writable; tells every page (`projects.changed`)', async () => {
    const { backend } = await open();
    expect(await backend.call('locations.list', {})).toEqual([
      { createdVia: 'terminal', displayPath: '~/fx', mode: 'write', name: 'fx', projects: 1 },
    ]);
    const heard: string[] = [];
    backend.subscribe(null, e => heard.push(e.name));
    const added = await backend.call('project.requestAdd', { path: `${TRUSTED_ROOT}/second` });
    expect(added).toMatchObject({ class: 'mine', via: 'location' });
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(heard).toContain('projects.changed');
    const list = await backend.call('projects.list', {});
    expect(list.find(p => p.id === added.id)).toMatchObject({ locationName: 'fx', location: '~/fx' });
  });

  it('outside every trusted folder without the companion’s window: the command for Terminal in `data.command`', async () => {
    const { backend } = await open();
    expect(await failure(backend.call('project.requestAdd', { path: '/elsewhere/app' }))).toEqual({
      code: 'confirmation-unavailable',
      data: { command: 'cd /elsewhere/app && devtab add', reason: 'no-window' },
    });
    // Every refusal of the folder is the same `not-found` (S7).
    expect((await failure(backend.call('project.requestAdd', { path: 'relative/app' }))).code).toBe('not-found');
    expect((await failure(backend.call('project.requestAdd', { path: `${TRUSTED_ROOT}/outside` }))).code).toBe(
      'not-found',
    );
  });

  it('a request that waits for the window: answered yes, answered no, or cancelled — `cancel` goes, `cancelled`', async () => {
    const { backend, fake } = await open({ confirm: 'yes' });
    const yes = await backend.call('project.requestAdd', { path: '/elsewhere/yes' });
    expect(yes).toMatchObject({ class: 'view', via: 'dialog' });
    fake.companion.setConfirm('no');
    expect((await failure(backend.call('project.requestAdd', { path: '/elsewhere/no' }))).code).toBe(
      'confirmation-declined',
    );
    const abort = new AbortController();
    const waiting = backend.call('project.requestAdd', { path: '/elsewhere/later' }, { signal: abort.signal });
    await new Promise(resolve => setTimeout(resolve, 20));
    abort.abort();
    expect((await failure(waiting)).code).toBe('cancelled');
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(fake.ports[0]!.sent.some(f => (f as { type?: string }).type === 'cancel')).toBe(true);
    for (const [answer, code] of [
      ['busy', 'confirmation-busy'],
      ['rate-limited', 'rate-limited'],
      ['requests-off', 'confirmation-unavailable'],
    ] as const) {
      fake.companion.setConfirm(answer);
      expect((await failure(backend.call('project.requestAdd', { path: `/elsewhere/${answer}` }))).code).toBe(code);
    }
  });

  it('read only at once (via the person), then writable again only through the window; removed', async () => {
    const { backend } = await open();
    expect(await backend.call('project.setView', { project: PROJECT })).toEqual({ class: 'view' });
    expect((await backend.call('project.state', { project: PROJECT })).via).toBe('person');
    expect((await failure(backend.call('project.setView', { project: PROJECT }))).code).toBe('not-mine');
    expect(await failure(backend.call('project.requestMine', { project: PROJECT }))).toEqual({
      code: 'confirmation-unavailable',
      data: { command: 'cd ~/fx/repo && devtab add --write', reason: 'no-window' },
    });
    expect(await backend.call('project.remove', { project: PROJECT })).toEqual({});
    expect(await backend.call('projects.list', {})).toEqual([]);
  });

  it('capturing the environment again needs the window: the command instead', async () => {
    const { backend } = await open();
    expect((await failure(backend.call('env.requestCapture', {}))).data).toEqual({
      command: 'devtab env capture',
      reason: 'no-window',
    });
  });
});

describe('writing files (row 5.4)', () => {
  it('saves from the version read, a new version back; an older version is `conflict` with the disk’s', async () => {
    const { backend } = await open();
    const read = await backend.call('file.read', { project: PROJECT, path: 'crlf.txt' });
    const saved = await backend.call('file.save', {
      project: PROJECT,
      path: 'crlf.txt',
      baseHash: read.hash,
      text: 'one\n',
      reason: 'explicit',
    });
    expect(saved).toMatchObject({ protected: null });
    expect(
      await failure(backend.call('file.save', { project: PROJECT, path: 'crlf.txt', baseHash: read.hash, text: 'x' })),
    ).toEqual({ code: 'conflict', data: { currentHash: saved.hash } });
  });

  it('every refusal of the write policy keeps its code and data', async () => {
    const { backend, fake } = await open();
    const save = (path: string, text = 'x') =>
      failure(backend.call('file.save', { project: PROJECT, path, baseHash: '0'.repeat(64), text }));
    expect(await save('.env')).toEqual({ code: 'secret-file', data: undefined });
    expect(await save('.git/config')).toEqual({ code: 'protected-path', data: { rule: 'git-dir' } });
    expect(await save('link-in')).toEqual({ code: 'protected-path', data: { rule: 'symlink' } });
    const latin = await backend.call('file.read', { project: PROJECT, path: 'latin1.txt' });
    expect(
      await failure(
        backend.call('file.save', { project: PROJECT, path: 'latin1.txt', baseHash: latin.hash, text: 'snow ☃' }),
      ),
    ).toEqual({ code: 'not-encodable', data: { encoding: 'windows-1252' } });
    fake.companion.failNext('file.save', 'disk-low', { freeBytes: 1, floorBytes: 2, usedBytes: 0, budgetBytes: 2 });
    expect((await save('src/app.txt')).code).toBe('disk-low');
    expect((await failure(backend.call('file.create', { project: PROJECT, path: 'src/app.txt', text: '' }))).code).toBe(
      'exists',
    );
  });

  it('creates a file (marked when it runs code), a folder, renames; deleting has no Trash here', async () => {
    const { backend } = await open();
    expect(
      await backend.call('file.create', { project: PROJECT, path: '.husky/pre-commit', text: '#!/bin/sh\n' }),
    ).toMatchObject({ protected: 'hooks' });
    expect(await backend.call('folder.create', { project: PROJECT, path: 'notes/folder' })).toEqual({
      protected: null,
    });
    await backend.call('file.create', { project: PROJECT, path: 'notes/a.txt', text: 'a\n' });
    expect(await backend.call('file.rename', { project: PROJECT, from: 'notes/a.txt', to: 'notes/b.txt' })).toEqual({
      protected: null,
    });
    expect((await backend.call('tree.list', { project: PROJECT, path: 'notes' })).entries.map(e => e.name)).toEqual([
      'folder',
      'b.txt',
    ]);
    // `file.delete` is not in this companion's welcome: refused here, never sent.
    expect(backend.capabilities().methods).not.toContain('file.delete');
    expect((await failure(backend.call('file.delete', { project: PROJECT, path: 'notes/b.txt' }))).code).toBe(
      'unknown-method',
    );
  });
});

describe('committing (row 6.5)', () => {
  it('commits chosen hunks with the output of the hooks streamed as `{text}` before the result', async () => {
    const { backend } = await open();
    const { status, expect: version } = await shown(backend, 'src/app.txt');
    const hunks = await backend.call('git.hunks', { project: PROJECT, path: 'src/app.txt' });
    expect(hunks.hunks).toHaveLength(3);
    const parts: string[] = [];
    const done = await backend.call(
      'git.commit',
      {
        project: PROJECT,
        message: 'Change line 15 only',
        selection: [{ path: 'src/app.txt', chunks: [1] }],
        runHooks: true,
        expect: { headSha: status.headSha, files: [version] },
      },
      { onStream: part => parts.push(part.text) },
    );
    expect(parts.join('')).toContain('pre-commit: passed');
    expect(done).toMatchObject({ hooksSkipped: [], indexKept: [] });
    // Two of the three hunks are still changes.
    expect((await backend.call('git.hunks', { project: PROJECT, path: 'src/app.txt' })).hunks).toHaveLength(2);
    expect((await backend.call('git.messages', { project: PROJECT })).messages).toEqual(['Change line 15 only']);
    const undone = await backend.call('git.undoCommit', { project: PROJECT, headSha: done.sha });
    expect(undone).toEqual({ message: 'Change line 15 only', paths: ['src/app.txt'] });
  });

  it('hooks off: `hooksSkipped`; a file changed since it was shown: `stale-selection` with its path', async () => {
    const { backend, fake } = await open();
    const { status, expect: version } = await shown(backend, 'src/new.txt');
    fake.companion.changeOnDisk(PROJECT, 'src/new.txt', 'changed meanwhile\n');
    const params = {
      project: PROJECT,
      message: 'Add new.txt',
      selection: [{ path: 'src/new.txt' }],
      runHooks: false,
      expect: { headSha: status.headSha, files: [version] },
    };
    expect(await failure(backend.call('git.commit', params))).toEqual({
      code: 'stale-selection',
      data: { paths: ['src/new.txt'] },
    });
    const again = await shown(backend, 'src/new.txt');
    const done = await backend.call('git.commit', {
      ...params,
      expect: { headSha: again.status.headSha, files: [again.expect] },
    });
    expect(done.hooksSkipped).toEqual(['pre-commit']);
  });

  it('each refusal of a commit keeps its code and data; a hook’s output arrives first', async () => {
    const { backend, fake } = await open();
    const { status, expect: version } = await shown(backend, 'src/app.txt');
    const commit = (onStream?: (part: { text: string }) => void) =>
      backend.call(
        'git.commit',
        {
          project: PROJECT,
          message: 'x',
          selection: [{ path: 'src/app.txt' }],
          runHooks: true,
          expect: { headSha: status.headSha, files: [version] },
        },
        { ...(onStream && { onStream }) },
      );
    const cases: Array<[string, Record<string, unknown>]> = [
      ['hook-failed', { hook: 'pre-commit', exitCode: 1, output: 'lint: 1 problem\n' }],
      [
        'hook-tool-missing',
        { hook: 'pre-commit', tool: 'npx', output: 'npx: command not found\n', pathCapturedAt: null },
      ],
      ['hook-timeout', { hook: 'pre-commit', afterMs: 300000 }],
      ['signing-failed', { output: 'gpg: signing failed\n' }],
      ['index-locked', {}],
      ['operation-in-progress', { operation: 'rebase' }],
      ['rate-limited', { retryAfterMs: 2000 }],
    ];
    for (const [code, data] of cases) {
      const parts: string[] = [];
      fake.companion.failNext('git.commit', code, data, { stream: ['running\n'], pauseMs: 1 });
      expect(await failure(commit(part => parts.push(part.text)))).toEqual({ code, data });
      expect(parts).toEqual(['running\n']);
    }
    fake.companion.setIdentity(null);
    expect((await failure(commit())).code).toBe('identity-missing');
  });

  it('chunks of a file committed whole: `hunks-unsupported` with the reason; cancel stops a commit', async () => {
    const { backend, fake } = await open();
    const { status, expect: version } = await shown(backend, 'src/new.txt');
    expect(
      await failure(
        backend.call('git.commit', {
          project: PROJECT,
          message: 'x',
          selection: [{ path: 'src/new.txt', chunks: [0] }],
          runHooks: false,
          expect: { headSha: status.headSha, files: [version] },
        }),
      ),
    ).toEqual({ code: 'hunks-unsupported', data: { path: 'src/new.txt', reason: 'new-file' } });
    fake.companion.failNext(
      'git.commit',
      'hook-timeout',
      { afterMs: 1 },
      { stream: ['slow\n'], pauseMs: 1, hang: true },
    );
    const abort = new AbortController();
    const running = backend.call(
      'git.commit',
      {
        project: PROJECT,
        message: 'x',
        selection: [{ path: 'src/new.txt' }],
        runHooks: true,
        expect: { headSha: status.headSha, files: [version] },
      },
      { signal: abort.signal, onStream: () => abort.abort() },
    );
    expect((await failure(running)).code).toBe('cancelled');
  });

  it('rolls back to HEAD; with «delete added» and no Trash: `trash-unavailable`, nothing changed', async () => {
    const { backend } = await open();
    const app = await shown(backend, 'src/app.txt');
    const added = await shown(backend, 'src/new.txt');
    expect(
      await failure(
        backend.call('git.rollback', {
          project: PROJECT,
          paths: ['src/new.txt'],
          deleteAdded: true,
          expect: { files: [added.expect] },
        }),
      ),
    ).toEqual({ code: 'trash-unavailable', data: undefined });
    expect(
      await backend.call('git.rollback', {
        project: PROJECT,
        paths: ['src/app.txt'],
        deleteAdded: false,
        expect: { files: [app.expect] },
      }),
    ).toEqual({ rolledBack: ['src/app.txt'], trashed: [] });
    expect((await backend.call('git.status', { project: PROJECT })).files.map(f => f.path)).not.toContain(
      'src/app.txt',
    );
  });
});

describe('an older companion (stage 3)', () => {
  it('reads as before; every method of stages 4–6 is inactive: refused here with `unknown-method`, never sent', async () => {
    const { backend, sent } = await open({ methods: 'stage3' });
    expect((await backend.call('projects.list', {})).length).toBe(1);
    for (const method of [
      'locations.list',
      'project.requestMine',
      'file.save',
      'git.commit',
      'git.messages',
    ] as const) {
      expect(backend.capabilities().methods).not.toContain(method);
      const params = { project: PROJECT } as never;
      expect((await failure(backend.call(method, params))).code).toBe('unknown-method');
      expect(sent(method)).toBe(0);
    }
  });
});
