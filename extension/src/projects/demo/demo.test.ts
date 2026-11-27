/**
 * The demo backend beyond the seam's contract: its data (invented, the states the page has to show), every read,
 * the writes in memory, the events, and the awkward states its controls reach.
 */
import { demoBackend, isSecretPath, protectedRule } from './backend';
import { DEMO_LOCATIONS, DEMO_PROJECTS } from './data';
import { applyHunks, lineHunks } from './diff';
import { isCompanionError } from '../types';
import { describe, expect, it } from 'vitest';
import type { CompanionEvent, ErrorCode, OutputLine } from '../types';

const LEDGER = 'p_demo0ledgr';
const TIDES = 'p_demo0tides';
const NOTES = 'p_demo0notes';
const GARDEN = 'p_demo0garden';

const open = () => demoBackend({ wait: () => Promise.resolve(), now: () => Date.UTC(2026, 10, 27, 12) });
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const codeOf = (promise: Promise<unknown>): Promise<ErrorCode | 'resolved' | unknown> =>
  promise.then(
    () => 'resolved',
    (e: unknown) => (isCompanionError(e) ? e.code : e),
  );
const dataOf = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => null,
    (e: unknown) => (isCompanionError(e) ? e.data : e),
  );

describe('the demo’s data', () => {
  it('two named trusted folders, four projects in them at different depths and one outside, read only', async () => {
    const backend = open();
    expect(DEMO_LOCATIONS.map(l => l.name)).toEqual(['Work', 'Self']);
    const projects = await backend.call('projects.list', {});
    expect(projects).toHaveLength(5);
    const outside = projects.filter(p => p.location === null);
    expect(outside.map(p => [p.name, p.class])).toEqual([['regex-notes', 'view']]);
    const depths = projects.filter(p => p.location).map(p => p.displayPath.split('/').length - 2);
    expect(new Set(depths).size).toBeGreaterThan(1);
    expect(projects.filter(p => p.location).every(p => p.class === 'mine' && p.via === 'location')).toBe(true);
    const locations = await backend.call('locations.list', {});
    expect(locations.map(l => [l.name, l.projects])).toEqual([
      ['Work', 2],
      ['Self', 2],
    ]);
  });

  it('is invented: no web address, no home path, the secret obviously fake', () => {
    const all = JSON.stringify(DEMO_PROJECTS);
    expect(all).not.toMatch(/https?:\/\//);
    expect(all).not.toMatch(/\/Users\/|\/home\//);
    // No relative import in the demo's code: the build's check of chunk imports (validate-build.sh, Check 8b) would read
    // it as one of the extension's own.
    expect(all).not.toMatch(/(from|import)\s*\(?\s*["']\.{1,2}\//);
    const ledger = DEMO_PROJECTS.find(p => p.id === LEDGER)!;
    expect(ledger.disk['.env']).toMatch(/Demo only: nothing here is real/);
    expect(ledger.disk['.env']).toMatch(/x{16}/);
  });

  it('knows the secrets and the files that run code by the specification’s lists', () => {
    for (const path of ['.env', 'config/.env.production', 'keys/server.pem', 'id_ed25519', '.npmrc', 'prod.tfvars'])
      expect(isSecretPath(path)).toBe(true);
    for (const path of ['env.ts', 'src/key.ts', 'README.md']) expect(isSecretPath(path)).toBe(false);
    expect(protectedRule('.husky/pre-commit')).toBe('hooks');
    expect(protectedRule('.nvmrc')).toBe('shell environment');
    expect(protectedRule('rust-toolchain.toml')).toBe('toolchain');
    expect(protectedRule('src/index.ts')).toBeUndefined();
  });
});

describe('reading', () => {
  it('a tree: folders first, ignored dimmed, the secret, the files that run code, a link out of the project', async () => {
    const backend = open();
    const { entries } = await backend.call('tree.list', { project: LEDGER, path: '' });
    const by = (name: string) => entries.find(e => e.name === name)!;
    const kinds = entries.map(e => e.kind);
    expect(kinds.indexOf('file')).toBeGreaterThan(kinds.lastIndexOf('dir'));
    expect(by('node_modules')).toMatchObject({ kind: 'dir', ignored: true });
    expect(by('dist').ignored).toBe(true);
    expect(by('src').ignored).toBe(false);
    expect(by('.env')).toMatchObject({ secret: true, ignored: true, hidden: true });
    expect(by('.nvmrc')).toMatchObject({ protected: true, rule: 'shell environment' });
    const docs = await backend.call('tree.list', { project: LEDGER, path: 'docs' });
    expect(docs.entries[0]).toMatchObject({ name: 'handbook', kind: 'symlink', link: 'outside' });
    const husky = await backend.call('tree.list', { project: LEDGER, path: '.husky' });
    expect(husky.entries[0]).toMatchObject({ protected: true, rule: 'hooks' });
  });

  it('a binary and a too-large file are refused with their sizes; a link out of the project too', async () => {
    const backend = open();
    expect(await dataOf(backend.call('file.read', { project: LEDGER, path: 'assets/logo.png' }))).toEqual({
      size: 18_432,
    });
    expect(await codeOf(backend.call('file.read', { project: LEDGER, path: 'fixtures/large-export.csv' }))).toBe(
      'too-large',
    );
    expect(await codeOf(backend.call('file.read', { project: LEDGER, path: 'docs/handbook' }))).toBe('outside-project');
    expect(await codeOf(backend.call('file.read', { project: LEDGER, path: '.git/config' }))).toBe('protected-path');
  });

  it('the status groups changes as the Commit window does, with a rename, a deletion and a mark of the index', async () => {
    const backend = open();
    const { files } = await backend.call('git.status', { project: LEDGER });
    const map = Object.fromEntries(files.map(f => [f.path, f]));
    expect(map['README.md']).toMatchObject({ group: 'changes', change: 'modified', stagedOutside: false });
    expect(map['package.json']).toMatchObject({ change: 'modified', stagedOutside: true });
    expect(map['src/money.ts']).toMatchObject({ change: 'renamed', renamedFrom: 'src/currency.ts' });
    expect(map['src/currency.ts']).toBeUndefined();
    expect(map['src/legacy/report.ts']).toMatchObject({ change: 'deleted', diskHash: null });
    expect(map['src/routes/invoices.ts']).toMatchObject({ group: 'unversioned', change: 'untracked' });
    // Ignored files are not changes.
    expect(map['.env']).toBeUndefined();
    expect(map['node_modules/left-pad/index.js']).toBeUndefined();
    const tides = await backend.call('git.status', { project: TIDES });
    expect(tides.files.find(f => f.path === 'tide/stations.csv')?.change).toBe('conflicted');
    expect((await backend.call('git.status', { project: 'p_demo0settl' })).files).toEqual([]);
  });

  it('chunks of a modified file; a whole file only when renamed, conflicted or binary', async () => {
    const backend = open();
    const server = await backend.call('git.hunks', { project: LEDGER, path: 'src/server.ts' });
    expect(server.chunkable).toBe(true);
    expect(server.hunks.length).toBe(3);
    expect(await backend.call('git.hunks', { project: LEDGER, path: 'src/money.ts' })).toMatchObject({
      chunkable: false,
      reason: 'renamed',
    });
    expect((await backend.call('git.hunks', { project: TIDES, path: 'tide/stations.csv' })).reason).toBe('conflicted');
    const diff = await backend.call('diff.sides', { project: LEDGER, path: 'src/server.ts', base: 'HEAD' });
    expect(diff.hunks.map(h => h.start)).toEqual(server.hunks.map(h => h.start));
    expect(diff.old.text).toContain("from '@/currency'");
    const renamed = await backend.call('diff.sides', { project: LEDGER, path: 'src/money.ts', base: 'HEAD' });
    expect(renamed.flags.renamedFrom).toBe('src/currency.ts');
    expect(renamed.old.exists).toBe(true);
  });

  it('finds files by letters, the ignored ones marked; searches skip ignored folders unless asked (Р20)', async () => {
    const backend = open();
    const found = await backend.call('files.find', { project: LEDGER, query: 'server.ts' });
    expect(found[0]?.path).toBe('src/server.ts');
    const pad = await backend.call('files.find', { project: LEDGER, query: 'leftpad' });
    expect(pad.every(f => f.ignored)).toBe(true);
    const search = async (includeIgnored: boolean) => {
      const paths: string[] = [];
      const done = await backend.call(
        'search.start',
        { project: LEDGER, pattern: 'padStart', isRegex: false, caseSensitive: true, wholeWord: false, includeIgnored },
        { onStream: hit => paths.push(hit.path) },
      );
      return { paths, done };
    };
    expect((await search(false)).paths).toEqual([]);
    expect((await search(true)).paths).toEqual(['node_modules/left-pad/index.js']);
    const many = await backend.call('search.start', {
      project: LEDGER,
      pattern: 'e',
      isRegex: false,
      caseSensitive: false,
      wholeWord: false,
      maxMatches: 3,
    });
    expect(many).toMatchObject({ matches: 3, truncated: true });
    expect(
      await codeOf(
        backend.call('search.start', {
          project: LEDGER,
          pattern: '(',
          isRegex: true,
          caseSensitive: false,
          wholeWord: false,
        }),
      ),
    ).toBe('invalid-params');
  });

  it('the history of a file, newest first, saves of one session as one row; the project’s with deleted files', async () => {
    const backend = open();
    const { points } = await backend.call('history.file', { project: LEDGER, path: 'src/server.ts' });
    expect(points.map(p => p.label)).toEqual(['Saved', 'Saved', 'Before edit', 'Commit']);
    expect(points[1]).toMatchObject({ count: 4 });
    const project = await backend.call('history.project', { project: LEDGER, limit: 3 });
    expect(project.points).toHaveLength(3);
    expect(project.next).toBe('3');
    expect(project.deleted).toEqual(['src/legacy/report.ts']);
  });

  it('commits waiting for a push, with or without an upstream', async () => {
    const backend = open();
    const ledger = await backend.call('git.outgoing', { project: LEDGER });
    expect(ledger).toMatchObject({ upstream: 'origin/main', setUpstream: false });
    expect(ledger.commits.map(c => c.summary)).toEqual([
      'Answer 404 with a formatted zero',
      'Format amounts with their currency',
    ]);
    expect(await backend.call('git.outgoing', { project: TIDES })).toMatchObject({ upstream: null, setUpstream: true });
  });
});

describe('writing in memory', () => {
  it('a save keeps one «Before edit» per session, merges its saves, and tells the listeners', async () => {
    const backend = open();
    const events: CompanionEvent[] = [];
    backend.subscribe(LEDGER, e => events.push(e));
    let { hash } = await backend.call('file.read', { project: LEDGER, path: 'src/index.ts' });
    for (const text of ['a\n', 'b\n', 'c\n'])
      ({ hash } = await backend.call('file.save', {
        project: LEDGER,
        path: 'src/index.ts',
        baseHash: hash,
        text,
        session: 'one',
      }));
    const { points } = await backend.call('history.file', { project: LEDGER, path: 'src/index.ts' });
    expect(points.map(p => [p.label, p.count])).toEqual([
      ['Saved', 3],
      ['Before edit', undefined],
    ]);
    await settle();
    expect(events.filter(e => e.name === 'files.changed')).toHaveLength(3);
    expect((await backend.call('git.status', { project: LEDGER })).files.some(f => f.path === 'src/index.ts')).toBe(
      true,
    );
  });

  it('refuses writes that the rules forbid: a secret, .git, a «view» project, a link', async () => {
    const backend = open();
    const { hash } = await backend.call('file.read', { project: LEDGER, path: '.env' });
    expect(await codeOf(backend.call('file.save', { project: LEDGER, path: '.env', baseHash: hash, text: 'x' }))).toBe(
      'secret-file',
    );
    expect(await codeOf(backend.call('file.delete', { project: LEDGER, path: '.env' }))).toBe('secret-file');
    expect(await codeOf(backend.call('file.rename', { project: LEDGER, from: 'README.md', to: '.env.old' }))).toBe(
      'secret-file',
    );
    expect(await codeOf(backend.call('folder.create', { project: LEDGER, path: '.git/x' }))).toBe('protected-path');
    expect(await codeOf(backend.call('file.create', { project: NOTES, path: 'x.md', text: '' }))).toBe('not-mine');
    expect(await codeOf(backend.call('file.delete', { project: LEDGER, path: 'docs/handbook' }))).toBe(
      'outside-project',
    );
    // Files that run code are writable in «mine» (Р25).
    const nvmrc = await backend.call('file.read', { project: LEDGER, path: '.nvmrc' });
    expect(nvmrc).toMatchObject({ protected: true, rule: 'shell environment' });
    expect(
      await codeOf(backend.call('file.save', { project: LEDGER, path: '.nvmrc', baseHash: nvmrc.hash, text: '24\n' })),
    ).toBe('resolved');
  });

  it('creates, renames and deletes into the Trash, each in the history', async () => {
    const backend = open();
    await backend.call('folder.create', { project: GARDEN, path: 'levels' });
    await backend.call('file.create', { project: GARDEN, path: 'levels/one.txt', text: 'one\n' });
    expect(await codeOf(backend.call('file.create', { project: GARDEN, path: 'levels/one.txt', text: '' }))).toBe(
      'exists',
    );
    await backend.call('file.rename', { project: GARDEN, from: 'levels', to: 'stages' });
    expect((await backend.call('file.read', { project: GARDEN, path: 'stages/one.txt' })).text).toBe('one\n');
    expect(await backend.call('file.delete', { project: GARDEN, path: 'stages' })).toEqual({ trashed: true, files: 2 });
    const { deleted } = await backend.call('history.project', { project: GARDEN });
    expect(deleted).toContain('stages/one.txt');
  });

  it('commits checked chunks only: the rest stays a change', async () => {
    const backend = open();
    const status = await backend.call('git.status', { project: LEDGER });
    const server = status.files.find(f => f.path === 'src/server.ts')!;
    await backend.call('git.commit', {
      project: LEDGER,
      message: 'Route invoices',
      selection: [{ path: 'src/server.ts', chunks: [1] }],
      runHooks: false,
      expect: { headSha: status.headSha, files: [{ path: server.path, diskHash: server.diskHash }] },
    });
    const left = await backend.call('git.hunks', { project: LEDGER, path: 'src/server.ts' });
    expect(left.hunks).toHaveLength(2);
    const diff = await backend.call('diff.sides', { project: LEDGER, path: 'src/server.ts', base: 'HEAD' });
    expect(diff.old.text).toContain("startsWith('/invoices')");
  });

  it('streams the hooks’ output while committing, and a renamed file moves in HEAD with its old name gone', async () => {
    const backend = open();
    const status = await backend.call('git.status', { project: LEDGER });
    const money = status.files.find(f => f.path === 'src/money.ts')!;
    const lines: OutputLine[] = [];
    await backend.call(
      'git.commit',
      {
        project: LEDGER,
        message: 'Rename currency to money',
        selection: [{ path: 'src/money.ts' }],
        runHooks: true,
        expect: { headSha: status.headSha, files: [{ path: money.path, diskHash: money.diskHash }] },
      },
      { onStream: line => lines.push(line) },
    );
    expect(lines.map(l => l.text)).toContain('pre-commit: passed');
    expect(lines.map(l => l.text)).toContain('commit-msg: message format ok');
    const after = await backend.call('git.status', { project: LEDGER });
    expect(after.files.map(f => f.path)).not.toContain('src/money.ts');
    expect(after.files.map(f => f.path)).not.toContain('src/currency.ts');
    // Undone: the rename is a change again, as git would see it.
    await backend.call('git.undoCommit', { project: LEDGER, headSha: after.headSha });
    const undone = await backend.call('git.status', { project: LEDGER });
    expect(undone.files.find(f => f.path === 'src/money.ts')).toMatchObject({
      change: 'renamed',
      renamedFrom: 'src/currency.ts',
    });
  });

  it('undoes the last commit of the seed, refuses a pushed one and the first one', async () => {
    const backend = open();
    const { headSha } = await backend.call('git.status', { project: LEDGER });
    const undone = await backend.call('git.undoCommit', { project: LEDGER, headSha });
    expect(undone).toEqual({ message: 'Answer 404 with a formatted zero', paths: ['src/server.ts'] });
    const settled = await backend.call('git.status', { project: 'p_demo0settl' });
    expect(await dataOf(backend.call('git.undoCommit', { project: 'p_demo0settl', headSha: settled.headSha }))).toEqual(
      {
        reason: 'pushed',
      },
    );
    const garden = await backend.call('git.status', { project: GARDEN });
    expect(await dataOf(backend.call('git.undoCommit', { project: GARDEN, headSha: garden.headSha }))).toEqual({
      reason: 'root',
    });
  });

  it('a push empties the commits to push, setting the upstream when there was none', async () => {
    const backend = open();
    const { headSha } = await backend.call('git.status', { project: TIDES });
    const lines: string[] = [];
    const pushed = await backend.call(
      'git.push',
      { project: TIDES, expect: { headSha, remote: 'origin', branch: 'lunar-period' } },
      { onStream: l => lines.push(l.text) },
    );
    expect(pushed).toEqual({ pushed: 1, remote: 'origin', branch: 'lunar-period', setUpstream: true });
    expect(lines.at(-1)).toBe('To git.example.invalid:demo/tide-tracker.git');
    expect(await backend.call('git.outgoing', { project: TIDES })).toMatchObject({
      commits: [],
      upstream: 'origin/lunar-period',
    });
    expect(
      await codeOf(
        backend.call('git.push', { project: GARDEN, expect: { headSha: 'x', remote: 'origin', branch: 'main' } }),
      ),
    ).toBe('push-remote-ambiguous');
  });
});

describe('the awkward states the controls reach', () => {
  it('a file changed on disk under an edit: the save conflicts with the disk’s hash', async () => {
    const backend = open();
    const { hash } = await backend.call('file.read', { project: LEDGER, path: 'README.md' });
    backend.controls.changeOnDisk(LEDGER, 'README.md', '# changed elsewhere\n');
    const data = (await dataOf(
      backend.call('file.save', { project: LEDGER, path: 'README.md', baseHash: hash, text: 'mine\n' }),
    )) as { currentHash: string };
    const disk = await backend.call('file.read', { project: LEDGER, path: 'README.md' });
    expect(data.currentHash).toBe(disk.hash);
    // «Keep mine»: from the disk's hash, the disk's text kept as «Before save».
    await backend.call('file.save', {
      project: LEDGER,
      path: 'README.md',
      baseHash: disk.hash,
      text: 'mine\n',
      session: 's',
    });
    const { points } = await backend.call('history.file', { project: LEDGER, path: 'README.md' });
    expect(points.slice(0, 3).map(p => p.label)).toEqual(['Saved', 'Before edit', 'External change']);
  });

  it.each([
    [{ code: 'hook-failed' as const }, 'hook-failed'],
    [{ code: 'hook-tool-missing' as const, tool: 'npx' }, 'hook-tool-missing'],
    [{ code: 'hook-timeout' as const }, 'hook-timeout'],
  ])('a hook’s failure %#: its output streamed, nothing committed', async (failure, code) => {
    const backend = open();
    backend.controls.failNextCommit(failure);
    const status = await backend.call('git.status', { project: LEDGER });
    const readme = status.files.find(f => f.path === 'README.md')!;
    const lines: string[] = [];
    const result = await codeOf(
      backend.call(
        'git.commit',
        {
          project: LEDGER,
          message: 'x',
          selection: [{ path: 'README.md' }],
          runHooks: true,
          expect: { headSha: status.headSha, files: [{ path: readme.path, diskHash: readme.diskHash }] },
        },
        { onStream: l => lines.push(l.text) },
      ),
    );
    expect(result).toBe(code);
    expect(lines.length).toBeGreaterThan(0);
    expect((await backend.call('git.status', { project: LEDGER })).headSha).toBe(status.headSha);
  });

  it('a commit can be cancelled while its hooks run', async () => {
    const backend = open();
    const status = await backend.call('git.status', { project: LEDGER });
    const readme = status.files.find(f => f.path === 'README.md')!;
    const controller = new AbortController();
    const result = codeOf(
      backend.call(
        'git.commit',
        {
          project: LEDGER,
          message: 'x',
          selection: [{ path: 'README.md' }],
          runHooks: true,
          expect: { headSha: status.headSha, files: [{ path: readme.path, diskHash: readme.diskHash }] },
        },
        { signal: controller.signal, onStream: () => controller.abort() },
      ),
    );
    expect(await result).toBe('cancelled');
    expect((await backend.call('git.status', { project: LEDGER })).headSha).toBe(status.headSha);
  });

  it.each([
    'push-rejected',
    'push-remote-rejected',
    'push-auth-failed',
    'push-needs-input',
    'push-timeout',
    'push-network',
  ] as const)('a push that fails: %s', async code => {
    const backend = open();
    backend.controls.failNextPush(code);
    const { headSha } = await backend.call('git.status', { project: LEDGER });
    expect(
      await codeOf(
        backend.call('git.push', { project: LEDGER, expect: { headSha, remote: 'origin', branch: 'main' } }),
      ),
    ).toBe(code);
    expect((await backend.call('git.outgoing', { project: LEDGER })).commits).toHaveLength(2);
  });

  it('no identity: a commit is refused; a pause refuses writes and says so', async () => {
    const backend = open();
    backend.controls.setIdentity(null);
    expect((await backend.call('git.identity', { project: LEDGER })).email).toBeNull();
    const status = await backend.call('git.status', { project: LEDGER });
    expect(
      await codeOf(
        backend.call('git.commit', {
          project: LEDGER,
          message: 'x',
          selection: [{ path: 'README.md' }],
          runHooks: false,
          expect: { headSha: status.headSha, files: [] },
        }),
      ),
    ).toBe('identity-missing');
    const states: string[] = [];
    backend.onState(s => states.push(s));
    backend.controls.setPaused(true);
    expect(states).toEqual(['paused']);
    expect(await codeOf(backend.call('file.create', { project: LEDGER, path: 'x.txt', text: '' }))).toBe('paused');
  });

  it('outside a trusted folder the demo cannot make a project «mine»; inside, at once', async () => {
    const backend = open();
    expect(await codeOf(backend.call('project.requestMine', { project: NOTES }))).toBe('confirmation-unavailable');
    await backend.call('project.setView', { project: GARDEN });
    expect(await backend.call('project.requestMine', { project: GARDEN })).toEqual({ class: 'mine' });
  });
});

describe('the demo’s hunks', () => {
  it('in the editor’s shape: added, modified, deleted; and the commit of some of them', () => {
    const before = 'a\nb\nc\nd\n';
    const after = 'a\nB\nc\nd\ne\n';
    expect(lineHunks(before, after)).toEqual([
      { kind: 'modified', start: 1, lines: 1, oldStart: 1, oldLines: 1, oldText: 'b\n' },
      { kind: 'added', start: 4, lines: 1, oldStart: 4, oldLines: 0, oldText: '' },
    ]);
    expect(lineHunks('a\nb\nc\n', 'a\nc\n')).toEqual([
      { kind: 'deleted', start: 1, lines: 0, oldStart: 1, oldLines: 1, oldText: 'b\n' },
    ]);
    expect(applyHunks(before, after, [1])).toBe('a\nb\nc\nd\ne\n');
    expect(applyHunks(before, after, [0, 1])).toBe(after);
    expect(applyHunks(before, after, [])).toBe(before);
    expect(lineHunks('same\n', 'same\n')).toEqual([]);
  });
});
