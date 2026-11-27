/**
 * The contract of seam `ProjectBackend` (./backend.ts): one suite that every implementation passes — the demo and the
 * companion's client over a scripted companion (./contract.test.ts; the specification, §11.3–§11.4). It knows no
 * project by name: it finds a project of each class, a file of each kind and a changed file through the API itself, so
 * it runs over any data that has them. What a backend does not offer (`capabilities().methods` — a companion that does
 * not write yet) is skipped, never failed. Not to be confused with ./api/, the companion's API contract.
 */
import { CONTRACT_METHODS } from './api/types.gen';
import { WRITE_METHODS, isCompanionError } from './types';
import { describe, expect, it } from 'vitest';
import type { ProjectBackend } from './backend';
import type { CompanionEvent, ErrorCode, Method, ProjectSummary, TreeEntry } from './types';

export interface ProjectBackendHarness {
  backend: ProjectBackend;
  /** Lets the backend's queued work and events run. */
  settle(): Promise<void>;
}

const rejects = async (promise: Promise<unknown>, code: ErrorCode): Promise<void> => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(isCompanionError(error) ? error.code : error).toBe(code);
};

/** Every file of the project, walked through `tree.list`. */
const walk = async (backend: ProjectBackend, project: string, path = ''): Promise<TreeEntry[]> => {
  const { entries } = await backend.call('tree.list', { project, path });
  const nested = await Promise.all(entries.filter(e => e.kind === 'dir').map(e => walk(backend, project, e.path)));
  return [...entries, ...nested.flat()];
};

const absolute = /(^|["\s])\/(Users|home|private|var|tmp)\//;

export const projectBackendContract = (name: string, make: () => ProjectBackendHarness): void => {
  describe(`ProjectBackend contract: ${name}`, () => {
    const open = async () => {
      const harness = make();
      const { backend } = harness;
      await backend.connect();
      const projects = await backend.call('projects.list', {});
      const offers = (method: Method): boolean => backend.capabilities().methods.includes(method);
      const writes = offers('file.save');
      const mine = writes ? projects.find(p => p.class === 'mine' && p.state === 'open') : undefined;
      const view = projects.find(p => p.class === 'view' && p.state === 'open');
      // Reading works in a project of either class.
      const any = mine ?? view;
      return { ...harness, projects, mine, view, any, offers };
    };

    it('connects, names the methods it answers, and answers the page’s every method', async () => {
      const { backend } = make();
      const connection = await backend.connect();
      expect(['ready', 'ready-empty', 'paused']).toContain(connection.state);
      const { methods } = backend.capabilities();
      for (const method of CONTRACT_METHODS) expect(methods).toContain(method);
      // Writing is all or nothing: a backend that saves offers every write.
      if (methods.includes('file.save')) for (const method of WRITE_METHODS) expect(methods).toContain(method);
      await rejects(backend.call('no.such' as 'projects.list', {}), 'unknown-method');
      backend.dispose();
    });

    it('lists projects and trusted folders without an absolute path; a project’s folder is one of them or none', async () => {
      const { backend, projects, offers } = await open();
      const locations = offers('locations.list') ? await backend.call('locations.list', {}) : [];
      expect(new Set(projects.map(p => p.id)).size).toBe(projects.length);
      for (const project of projects) {
        expect(project.displayPath.startsWith('~/')).toBe(true);
        if (project.location != null && offers('locations.list'))
          expect(locations.map(l => l.displayPath)).toContain(project.location);
      }
      for (const location of locations) expect(location.name.length).toBeGreaterThan(0);
      expect(JSON.stringify({ projects, locations })).not.toMatch(absolute);
      await rejects(backend.call('project.state', { project: 'p_nosuchone0' }), 'not-found');
      backend.dispose();
    });

    it('walks the tree without .git; refuses paths that leave the project', async () => {
      const { backend, any } = await open();
      if (!any) return;
      const all = await walk(backend, any.id);
      expect(all.length).toBeGreaterThan(0);
      expect(all.some(e => e.path === '.git' || e.path.startsWith('.git/'))).toBe(false);
      for (const bad of ['../outside', '/etc/hosts', 'a//b', 'a/./b', 'back\\slash'])
        await rejects(backend.call('file.read', { project: any.id, path: bad }), 'invalid-path');
      await rejects(backend.call('tree.list', { project: any.id, path: 'no-such-folder' }), 'not-found');
      backend.dispose();
    });

    it('reads a text file with its hash; refuses a binary with its size; marks a secret', async () => {
      const { backend, any } = await open();
      if (!any) return;
      const files = (await walk(backend, any.id)).filter(e => e.kind === 'file');
      const text = files.find(e => !e.secret && e.size > 0 && e.size < 1_000_000);
      expect(text).toBeDefined();
      const read = await backend.call('file.read', { project: any.id, path: text!.path });
      expect(typeof read.text).toBe('string');
      expect(read.hash.length).toBeGreaterThan(8);
      const secret = files.find(e => e.secret);
      if (secret) expect((await backend.call('file.read', { project: any.id, path: secret.path })).secret).toBe(true);
      backend.dispose();
    });

    it('finds files by a few letters, and searches with parts before the result; a search can be cancelled', async () => {
      const { backend, any } = await open();
      if (!any) return;
      const [first] = (await walk(backend, any.id)).filter(e => e.kind === 'file' && !e.ignored && e.size > 0);
      const found = await backend.call('files.find', { project: any.id, query: first!.name.slice(0, 3) });
      expect(found.some(f => f.path === first!.path)).toBe(true);
      const { text } = await backend.call('file.read', { project: any.id, path: first!.path });
      const word = /\w{3,}/.exec(text)?.[0] ?? 'a';
      const parts: string[] = [];
      const done = await backend.call(
        'search.start',
        { project: any.id, pattern: word, isRegex: false, caseSensitive: true, wholeWord: false },
        { onStream: hit => parts.push(hit.path) },
      );
      expect(done.files).toBe(parts.length);
      expect(parts).toContain(first!.path);
      const controller = new AbortController();
      controller.abort();
      await rejects(
        backend.call(
          'search.start',
          { project: any.id, pattern: word, isRegex: false, caseSensitive: false, wholeWord: false },
          { signal: controller.signal },
        ),
        'cancelled',
      );
      backend.dispose();
    });

    it('refuses every write in a «view» project, and a write to a secret or into .git anywhere', async () => {
      const { backend, mine, view, offers } = await open();
      if (view) {
        // A backend that does not write answers every write with `unknown-method` and never sends it.
        const refused = offers('file.save') ? 'not-mine' : 'unknown-method';
        await rejects(
          backend.call('file.save', { project: view.id, path: 'README.md', baseHash: 'x', text: 'y' }),
          refused,
        );
        await rejects(backend.call('file.create', { project: view.id, path: 'new.txt', text: '' }), refused);
        await rejects(backend.call('git.undoCommit', { project: view.id, headSha: 'x' }), refused);
      }
      if (mine) {
        await rejects(backend.call('file.create', { project: mine.id, path: '.env.local', text: 'x' }), 'secret-file');
        await rejects(
          backend.call('file.create', { project: mine.id, path: '.git/hooks/pre-commit', text: 'x' }),
          'protected-path',
        );
      }
      backend.dispose();
    });

    it('saves from the text it read, tells the project’s listeners, and refuses a save from an older text', async () => {
      const { backend, mine, settle } = await open();
      if (!mine) return;
      const events: CompanionEvent[] = [];
      const undo = backend.subscribe(mine.id, e => events.push(e));
      const path = 'contract-probe.txt';
      const { hash: created } = await backend.call('file.create', { project: mine.id, path, text: 'one\n' });
      const saved = await backend.call('file.save', {
        project: mine.id,
        path,
        baseHash: created,
        text: 'two\n',
        session: 's1',
      });
      expect((await backend.call('file.read', { project: mine.id, path })).text).toBe('two\n');
      expect(saved.hash).not.toBe(created);
      await rejects(
        backend.call('file.save', { project: mine.id, path, baseHash: created, text: 'three\n' }),
        'conflict',
      );
      await settle();
      expect(events.some(e => e.name === 'files.changed' && e.data.paths.includes(path))).toBe(true);
      undo();
      const points = await backend.call('history.file', { project: mine.id, path });
      expect(points.points.length).toBeGreaterThan(0);
      backend.dispose();
    });

    it('commits the checked files: they leave the changes and wait to be pushed; an undo brings them back', async () => {
      const { backend, mine } = await open();
      if (!mine) return;
      const path = 'contract-commit.txt';
      await backend.call('file.create', { project: mine.id, path, text: 'commit me\n' });
      const before = await backend.call('git.status', { project: mine.id });
      const entry = before.files.find(f => f.path === path)!;
      expect(entry.group).toBe('unversioned');
      await rejects(
        backend.call('git.commit', {
          project: mine.id,
          message: 'x',
          selection: [],
          runHooks: true,
          expect: { headSha: before.headSha, files: [] },
        }),
        'nothing-selected',
      );
      await rejects(
        backend.call('git.commit', {
          project: mine.id,
          message: 'x',
          selection: [{ path }],
          runHooks: true,
          expect: { headSha: 'f'.repeat(40), files: [{ path, diskHash: entry.diskHash }] },
        }),
        'stale-selection',
      );
      const outgoing = (await backend.call('git.outgoing', { project: mine.id })).commits.length;
      const { sha } = await backend.call('git.commit', {
        project: mine.id,
        message: 'Add the contract probe',
        selection: [{ path }],
        runHooks: false,
        expect: { headSha: before.headSha, files: [{ path, diskHash: entry.diskHash }] },
      });
      const after = await backend.call('git.status', { project: mine.id });
      expect(after.headSha).toBe(sha);
      expect(after.files.some(f => f.path === path)).toBe(false);
      expect((await backend.call('git.outgoing', { project: mine.id })).commits.length).toBe(outgoing + 1);
      expect((await backend.call('git.messages', { project: mine.id })).messages[0]).toBe('Add the contract probe');
      const undone = await backend.call('git.undoCommit', { project: mine.id, headSha: sha });
      expect(undone.message).toBe('Add the contract probe');
      expect((await backend.call('git.status', { project: mine.id })).files.some(f => f.path === path)).toBe(true);
      await rejects(backend.call('git.undoCommit', { project: mine.id, headSha: sha }), 'undo-unavailable');
      backend.dispose();
    });

    it('restores a point of a file’s history over the current text, keeping that one; refuses a stale one', async () => {
      const { backend, mine } = await open();
      if (!mine) return;
      const path = 'contract-history.txt';
      const { hash: first } = await backend.call('file.create', { project: mine.id, path, text: 'first\n' });
      const { hash: second } = await backend.call('file.save', {
        project: mine.id,
        path,
        baseHash: first,
        text: 'second\n',
      });
      const { points } = await backend.call('history.file', { project: mine.id, path });
      const withFirst = [];
      for (const point of points)
        if ((await backend.call('history.content', { project: mine.id, point: point.point })).text === 'first\n')
          withFirst.push(point);
      expect(withFirst.length).toBeGreaterThan(0);
      await rejects(
        backend.call('history.restore', { project: mine.id, path, point: withFirst[0]!.point, currentHash: first }),
        'conflict',
      );
      const restored = await backend.call('history.restore', {
        project: mine.id,
        path,
        point: withFirst[0]!.point,
        currentHash: second,
      });
      expect(restored.before).not.toBeNull();
      expect((await backend.call('file.read', { project: mine.id, path })).text).toBe('first\n');
      expect((await backend.call('history.content', { project: mine.id, point: restored.before! })).text).toBe(
        'second\n',
      );
      backend.dispose();
    });

    it('rolls a changed file back to HEAD, and deletes a new one only when asked', async () => {
      const { backend, mine } = await open();
      if (!mine) return;
      const path = 'contract-rollback.txt';
      await backend.call('file.create', { project: mine.id, path, text: 'new\n' });
      const status = await backend.call('git.status', { project: mine.id });
      const entry = status.files.find(f => f.path === path)!;
      const kept = await backend.call('git.rollback', {
        project: mine.id,
        paths: [path],
        deleteAdded: false,
        expect: { files: [{ path, diskHash: entry.diskHash }] },
      });
      expect(kept.trashed).toEqual([]);
      const gone = await backend.call('git.rollback', {
        project: mine.id,
        paths: [path],
        deleteAdded: true,
        expect: { files: [{ path, diskHash: entry.diskHash }] },
      });
      expect(gone.trashed).toEqual([path]);
      await rejects(backend.call('file.read', { project: mine.id, path }), 'not-found');
      backend.dispose();
    });

    it('a project of class «mine» becomes «view» at once', async () => {
      const { backend, mine } = await open();
      if (!mine) return;
      expect(await backend.call('project.setView', { project: mine.id })).toEqual({ class: 'view' });
      const list: ProjectSummary[] = await backend.call('projects.list', {});
      expect(list.find(p => p.id === mine.id)?.class).toBe('view');
      await rejects(backend.call('file.create', { project: mine.id, path: 'x.txt', text: '' }), 'not-mine');
      backend.dispose();
    });
  });
};
