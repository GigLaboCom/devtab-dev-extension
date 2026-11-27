/**
 * The Projects section's parts on the demo backend (§8.4): the list grouped by trusted folder, the tree's marks, the
 * editor's states and its autosave with a conflict, the Commit window (checks, commit, hooks, undo, rollback, push),
 * find and history. The editor page in the iframe is played by a fake that answers as it does.
 */
import { groupProjects } from './ProjectList';
import { ProjectsPage } from '../sections/ProjectsPage';
import { demoBackend } from '@src/projects/demo/backend';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Route } from '../route';
import type { ProjectsBehaviors } from '@src/projects/behaviors';
import type { DemoBackend } from '@src/projects/demo/backend';
import type { ToViewer } from '@src/shared/viewerProtocol';

const LEDGER = 'p_demo0ledgr';

/** The editor page, played: it takes what the section posts and answers like the real one. */
const fakeEditor = () => {
  const inbox: ToViewer[] = [];
  let text = '';
  let frame: HTMLIFrameElement | null = null;
  const send = (data: unknown): void => {
    window.dispatchEvent(new MessageEvent('message', { data, origin: location.origin, source: frame!.contentWindow }));
  };
  const shown = (id: number | undefined, over: Record<string, unknown> = {}) => ({
    type: 'viewer/shown',
    ...(id !== undefined && { id }),
    shown: {
      path: 'p',
      changes: 0,
      added: 0,
      removed: 0,
      lineDiffer: null,
      compareMs: null,
      updateMs: null,
      cause: id === undefined ? 'edit' : 'request',
      sides: {
        old: { editable: false, modified: false, empty: false },
        new: { editable: false, modified: id === undefined, empty: false },
      },
      mode: 'file',
      ...over,
    },
  });
  const attach = async (): Promise<void> => {
    frame = await waitFor(() => {
      const found = document.querySelector<HTMLIFrameElement>('iframe.kit-projects-frame');
      if (!found?.contentWindow) throw new Error('no editor frame yet');
      return found;
    });
    frame.contentWindow!.postMessage = ((message: ToViewer) => {
      inbox.push(message);
      if (message.type === 'viewer/show-file') text = message.request.text;
      if (message.type === 'viewer/read')
        queueMicrotask(() => send({ type: 'viewer/text', id: message.id, side: message.side, text }));
      if ('id' in message && message.type !== 'viewer/read')
        queueMicrotask(() => send(shown(message.id, message.type === 'viewer/show-diff' ? { mode: 'diff' } : {})));
    }) as Window['postMessage'];
    act(() => send({ type: 'viewer/ready' }));
  };
  return {
    inbox,
    attach,
    last: <T extends ToViewer['type']>(type: T) =>
      [...inbox].reverse().find((m): m is Extract<ToViewer, { type: T }> => m.type === type),
    /** A key the editor hands up. */
    key: (chord: { key: string; mod: boolean; shift: boolean }) =>
      act(() => send({ type: 'viewer/key', chord, side: 'new' })),
    /** The person typed: the editor holds `next` and reports an edit. */
    type: (next: string) => {
      text = next;
      act(() => send(shown(undefined)));
    },
  };
};

let backend: DemoBackend;
const behaviors = (autosaveDelayMs = 20): ProjectsBehaviors => ({
  backend: Object.assign(() => backend, { id: 'demo' }),
  autosaveDelayMs,
});

const show = (route: Route, delay?: number) => render(<ProjectsPage route={route} behaviors={behaviors(delay)} />);
const goTo = (hash: string, rerender: (ui: React.ReactElement) => void): void => {
  act(() => {
    window.location.hash = hash;
  });
  const [, , project, path] = hash.split('/');
  rerender(
    <ProjectsPage
      route={{ section: 'projects', ...(project && { project }), ...(path && { path: decodeURIComponent(path) }) }}
      behaviors={behaviors()}
    />,
  );
};

// Radix's Switch measures itself; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

beforeEach(() => {
  backend = demoBackend({ wait: () => Promise.resolve() });
  window.location.hash = '#/projects';
});
afterEach(() => cleanup());

describe('the list of projects', () => {
  it('groups the projects by trusted folder name, the ones outside last; lists the folders; says it is a demo', async () => {
    show({ section: 'projects' });
    const work = await screen.findByRole('group', { name: 'Work' });
    expect(
      within(work)
        .getAllByRole('link')
        .map(a => a.querySelector('.kit-projects-item-name')?.textContent),
    ).toEqual(['ledger-api', 'settlement-worker']);
    expect(within(screen.getByRole('group', { name: 'Self' })).getAllByRole('link')).toHaveLength(2);
    const outside = screen.getByRole('group', { name: 'Outside trusted folders' });
    expect(outside.textContent).toContain('regex-notes');
    expect(outside.textContent).toContain('Read only');
    expect(screen.getByRole('heading', { name: 'Trusted folders' })).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain('invented projects');
  });

  it('groupProjects: an empty folder is no group; a project of an unknown folder counts as outside', () => {
    const p = (id: string, location: string | null) =>
      ({
        id,
        name: id,
        displayPath: `~/${id}`,
        class: 'mine',
        via: 'location',
        location,
        branch: null,
        state: 'open',
      }) as const;
    expect(
      groupProjects(
        [p('b', '~/w'), p('a', '~/w'), p('c', '~/gone')],
        [
          { name: 'W', displayPath: '~/w', mode: 'write', projects: 2, createdVia: 'init' },
          { name: 'E', displayPath: '~/e', mode: 'write', projects: 0, createdVia: 'init' },
        ],
      ).map(g => [g.name, g.projects.map(x => x.id)]),
    ).toEqual([
      ['W', ['a', 'b']],
      [null, ['c']],
    ]);
    // A companion that lists no folders: each project's own folder name groups it.
    expect(
      groupProjects([{ ...p('d', '~/x'), locationName: 'X' }, p('e', null)], []).map(g => [
        g.name,
        g.projects.map(x => x.id),
      ]),
    ).toEqual([
      ['X', ['d']],
      [null, ['e']],
    ]);
  });
});

describe('a project', () => {
  it('the tree: ignored dimmed, the secret and the files that run code marked, a link out of the project not opened', async () => {
    show({ section: 'projects', project: LEDGER });
    const tree = await screen.findByRole('tree', { name: 'Files' });
    const row = (path: string) =>
      waitFor(() => {
        const found = tree.querySelector<HTMLButtonElement>(`[data-path="${path}"]`);
        if (!found) throw new Error(`no row ${path}`);
        return found;
      });
    expect((await row('node_modules')).hasAttribute('data-ignored')).toBe(true);
    expect((await row('src')).hasAttribute('data-ignored')).toBe(false);
    expect((await row('.env')).textContent).toContain('Secret: read only');
    expect((await row('.nvmrc')).textContent).toContain('Runs code');
    fireEvent.click(await row('docs'));
    expect((await row('docs/handbook')).disabled).toBe(true);
    expect(screen.getByText('Writable')).toBeTruthy();
    expect(screen.getByText('via Work')).toBeTruthy();
  });

  it('opens a file editable, a secret read only, a binary and a too-large file as cards', async () => {
    const editor = fakeEditor();
    const { rerender } = show({ section: 'projects', project: LEDGER, path: 'src/index.ts' });
    await editor.attach();
    await waitFor(() =>
      expect(editor.last('viewer/show-file')?.request).toMatchObject({ path: 'src/index.ts', readOnly: false }),
    );
    expect(editor.last('viewer/show-file')?.request.language).toBe('typescript');
    goTo('#/projects/p_demo0ledgr/.env', rerender);
    await waitFor(() =>
      expect(editor.last('viewer/show-file')?.request).toMatchObject({ path: '.env', readOnly: true }),
    );
    expect(await screen.findByText('Read only: this file holds secrets.')).toBeTruthy();
    goTo('#/projects/p_demo0ledgr/assets%2Flogo.png', rerender);
    expect(await screen.findByText('Binary file, 18.0 KB')).toBeTruthy();
    goTo('#/projects/p_demo0ledgr/fixtures%2Flarge-export.csv', rerender);
    expect(await screen.findByText('Too large to show (7.0 MB)')).toBeTruthy();
  });

  it('a read-only project opens its files read only and refuses commits', async () => {
    const editor = fakeEditor();
    show({ section: 'projects', project: 'p_demo0notes', path: 'README.md' });
    await editor.attach();
    await waitFor(() => expect(editor.last('viewer/show-file')?.request.readOnly).toBe(true));
    expect(await screen.findByText('Read only: the project is read only.')).toBeTruthy();
    expect(screen.getByText('This project is read only: nothing can be written from the page.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Commit' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('⌘S writes at once, without waiting for the pause', async () => {
    const editor = fakeEditor();
    show({ section: 'projects', project: LEDGER, path: 'src/index.ts' }, 60_000);
    await editor.attach();
    await waitFor(() => expect(editor.last('viewer/show-file')).toBeDefined());
    expect(editor.last('viewer/keys')?.keys).toContainEqual({ key: 's', mod: true, shift: false });
    editor.type('saved by the key\n');
    expect(document.querySelector('.kit-projects-save')?.textContent).toBe('Edited');
    editor.key({ key: 's', mod: true, shift: false });
    await waitFor(async () =>
      expect((await backend.call('file.read', { project: LEDGER, path: 'src/index.ts' })).text).toBe(
        'saved by the key\n',
      ),
    );
  });

  it('an edit saves itself after the pause', async () => {
    const editor = fakeEditor();
    show({ section: 'projects', project: LEDGER, path: 'src/index.ts' });
    await editor.attach();
    await waitFor(() => expect(editor.last('viewer/show-file')).toBeDefined());
    editor.type("import { start } from './server';\n\nstart();\nconsole.log('up');\n");
    await waitFor(async () =>
      expect((await backend.call('file.read', { project: LEDGER, path: 'src/index.ts' })).text).toContain(
        "console.log('up')",
      ),
    );
    await waitFor(() => expect(document.querySelector('.kit-projects-save')?.getAttribute('data-state')).toBe('saved'));
    expect(editor.last('viewer/mark-saved')?.text).toContain("console.log('up')");
    const { points } = await backend.call('history.file', { project: LEDGER, path: 'src/index.ts' });
    expect(points.map(p => p.label)).toEqual(['Saved', 'Before edit']);
  });

  it('a change on disk under an unsaved edit: autosave stops, the three choices; «Keep mine» writes over', async () => {
    const editor = fakeEditor();
    show({ section: 'projects', project: LEDGER, path: 'README.md' });
    await editor.attach();
    await waitFor(() => expect(editor.last('viewer/show-file')).toBeDefined());
    backend.controls.changeOnDisk(LEDGER, 'README.md', '# changed elsewhere\n');
    editor.type('# mine\n');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The file changed on disk while you were editing it.');
    for (const name of ['Keep mine', 'Apply the external change', 'Show the comparison'])
      expect(within(alert).getByRole('button', { name })).toBeTruthy();
    expect(document.querySelector('.kit-projects-save')?.textContent).toBe('Not saved: conflict');
    fireEvent.click(within(alert).getByRole('button', { name: 'Show the comparison' }));
    await waitFor(() =>
      expect(editor.last('viewer/compare')?.request).toMatchObject({
        oldText: '# changed elsewhere\n',
        newText: '# mine\n',
      }),
    );
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Keep mine' }));
    await waitFor(async () =>
      expect((await backend.call('file.read', { project: LEDGER, path: 'README.md' })).text).toBe('# mine\n'),
    );
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('a change on disk with nothing unsaved is taken by itself', async () => {
    const editor = fakeEditor();
    show({ section: 'projects', project: LEDGER, path: 'README.md' });
    await editor.attach();
    await waitFor(() => expect(editor.last('viewer/show-file')).toBeDefined());
    act(() => backend.controls.changeOnDisk(LEDGER, 'README.md', '# theirs\n'));
    await waitFor(() => expect(editor.last('viewer/show-file')?.request.text).toBe('# theirs\n'));
    expect(await screen.findByText('Updated from disk')).toBeTruthy();
  });

  it('the diff with HEAD comes with the companion’s hunks; a chunk is revealed in it', async () => {
    const editor = fakeEditor();
    show({ section: 'projects', project: LEDGER, path: 'src/server.ts' });
    await editor.attach();
    await screen.findByRole('group', { name: 'Changes' });
    fireEvent.click(screen.getByRole('button', { name: /^src\/server\.ts/ }));
    await waitFor(() => expect(editor.last('viewer/show-diff')?.payload.hunks).toHaveLength(3));
    const chunks = await screen.findByRole('group', { name: 'Chunks of src/server.ts' });
    fireEvent.click(within(chunks).getAllByRole('button')[1]!);
    await waitFor(() => expect(editor.last('viewer/reveal-hunk')).toEqual({ type: 'viewer/reveal-hunk', index: 1 }));
    // Back to the file: the diff already holds it, so the editor only switches its mode.
    fireEvent.click(screen.getByRole('radio', { name: 'File' }));
    await waitFor(() => expect(editor.last('viewer/set-mode')?.mode).toBe('file'));
  });
});

describe('the Commit window', () => {
  const commitWindow = async () => {
    show({ section: 'projects', project: LEDGER });
    return screen.findByRole('region', { name: 'Commit' });
  };

  it('groups changes and unversioned files; checks tracked changes, not unversioned ones', async () => {
    const panel = await commitWindow();
    const changes = await within(panel).findByRole('group', { name: 'Changes' });
    const unversioned = within(panel).getByRole('group', { name: 'Unversioned Files' });
    expect(within(changes).getByRole('checkbox', { name: 'README.md' }).getAttribute('data-state')).toBe('checked');
    expect(
      within(unversioned).getByRole('checkbox', { name: 'src/routes/invoices.ts' }).getAttribute('data-state'),
    ).toBe('unchecked');
    expect(within(changes).getByText('renamed from src/currency.ts')).toBeTruthy();
    expect(within(changes).getByText('Staged in the terminal')).toBeTruthy();
    expect(
      within(panel).getByText('main → origin/main · 2 to push · Demo Developer <developer@example.invalid>'),
    ).toBeTruthy();
    expect(within(panel).getByRole('checkbox', { name: 'Run Git hooks' }).getAttribute('data-state')).toBe('checked');
  });

  it('a conflicted file cannot be checked', async () => {
    show({ section: 'projects', project: 'p_demo0tides' });
    const panel = await screen.findByRole('region', { name: 'Commit' });
    const box = await within(panel).findByRole('checkbox', { name: 'tide/stations.csv' });
    expect((box as HTMLButtonElement).disabled).toBe(true);
  });

  it('commits what is checked with the hooks’ output; the files leave the changes; undo brings them and the message back', async () => {
    const panel = await commitWindow();
    await within(panel).findByRole('group', { name: 'Changes' });
    const commit = within(panel).getByRole('button', { name: 'Commit' }) as HTMLButtonElement;
    expect(commit.disabled).toBe(true);
    fireEvent.change(within(panel).getByPlaceholderText('Commit message'), { target: { value: 'Ship invoices' } });
    expect(commit.disabled).toBe(false);
    fireEvent.click(commit);
    expect(await within(panel).findByText(/^Committed 5 files as [0-9a-f]{7}\.$/)).toBeTruthy();
    expect(panel.querySelector('.kit-projects-output')?.textContent).toContain('pre-commit: passed');
    await waitFor(() => expect(within(panel).queryByRole('checkbox', { name: 'README.md' })).toBeNull());
    expect((await backend.call('git.outgoing', { project: LEDGER })).commits[0]?.summary).toBe('Ship invoices');
    fireEvent.click(within(panel).getByRole('button', { name: 'Undo last commit' }));
    await waitFor(() => expect(within(panel).getByRole('checkbox', { name: 'README.md' })).toBeTruthy());
    expect((within(panel).getByPlaceholderText('Commit message') as HTMLTextAreaElement).value).toBe('Ship invoices');
  });

  it('a failing hook: its output, nothing committed, the message and the checks kept', async () => {
    backend.controls.failNextCommit({ code: 'hook-failed', output: ['pre-commit: secret found in README.md'] });
    const panel = await commitWindow();
    await within(panel).findByRole('group', { name: 'Changes' });
    fireEvent.change(within(panel).getByPlaceholderText('Commit message'), { target: { value: 'Try' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Commit' }));
    expect(await within(panel).findByText('pre-commit failed. Nothing was committed.')).toBeTruthy();
    expect(panel.querySelector('.kit-projects-output')?.textContent).toBe('pre-commit: secret found in README.md');
    expect((within(panel).getByPlaceholderText('Commit message') as HTMLTextAreaElement).value).toBe('Try');
    expect(within(panel).getByRole('checkbox', { name: 'README.md' }).getAttribute('data-state')).toBe('checked');
  });

  it('unchecking «Run Git hooks» says what it skips', async () => {
    const panel = await commitWindow();
    fireEvent.click(await within(panel).findByRole('checkbox', { name: 'Run Git hooks' }));
    expect(within(panel).getByText(/Skips pre-commit and commit-msg/)).toBeTruthy();
  });

  it('rollback: the files and «Delete local copies of added files», off by default', async () => {
    const panel = await commitWindow();
    await within(panel).findByRole('group', { name: 'Changes' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Rollback…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rollback' });
    expect(within(dialog).getByText('README.md')).toBeTruthy();
    expect(
      within(dialog).getByRole('checkbox', { name: 'Delete local copies of added files' }).getAttribute('data-state'),
    ).toBe('unchecked');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rollback' }));
    expect(await within(panel).findByText('Rolled back 5 files.')).toBeTruthy();
    expect((await backend.call('git.status', { project: LEDGER })).files.map(f => f.path)).toEqual([
      'src/routes/invoices.ts',
    ]);
    fireEvent.click(within(panel).getByRole('button', { name: 'Undo rollback' }));
    await waitFor(async () =>
      expect((await backend.call('git.status', { project: LEDGER })).files.length).toBeGreaterThan(3),
    );
  });

  it('push: the commits that go and where; a rejected push says what to do', async () => {
    backend.controls.failNextPush('push-rejected');
    const panel = await commitWindow();
    fireEvent.click(await within(panel).findByRole('button', { name: 'Push…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Push' });
    expect(await within(dialog).findByText('Answer 404 with a formatted zero')).toBeTruthy();
    expect(within(dialog).getByText('main → origin/main')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Push' }));
    expect(await within(dialog).findByText(/Pull in the terminal, then push\./)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Push' }));
    expect(await within(dialog).findByText('Pushed 2 commits to origin/main.')).toBeTruthy();
  });
});

describe('find and history', () => {
  it('finds in files, ignored folders only when asked; a match opens its file at its line', async () => {
    show({ section: 'projects', project: LEDGER });
    fireEvent.click(await screen.findByRole('radio', { name: 'Find in files' }));
    const input = screen.getByRole('textbox', { name: 'Find in files' });
    fireEvent.change(input, { target: { value: 'padStart' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));
    expect(await screen.findByText('0 matches in 0 files')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Include ignored folders' }));
    fireEvent.click(screen.getByRole('button', { name: 'Find' }));
    expect(await screen.findByText('1 match in 1 file')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /padStart/ }));
    await waitFor(() =>
      expect(window.location.hash).toBe('#/projects/p_demo0ledgr/node_modules%2Fleft-pad%2Findex.js'),
    );
  });

  it('a file’s history, newest first; a restore asks, writes, and can be undone', async () => {
    const editor = fakeEditor();
    show({ section: 'projects', project: LEDGER, path: 'src/server.ts' });
    await editor.attach();
    const history = await screen.findByRole('region', { name: 'History' });
    const rows = await within(history).findAllByRole('listitem');
    expect(rows.map(r => r.querySelector('.kit-projects-point-label')?.textContent)).toEqual([
      'Saved',
      'Saved',
      'Before edit',
      'Commit',
    ]);
    fireEvent.click(within(rows[3]!).getByRole('button', { name: 'Restore…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Restore this version?' });
    expect(dialog.textContent).toContain('The current version is kept in the history.');
    await waitFor(() => expect(editor.last('viewer/show-diff')).toBeDefined());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore' }));
    expect(await within(history).findByText('Restored. The version it replaced is in the history.')).toBeTruthy();
    expect((await backend.call('file.read', { project: LEDGER, path: 'src/server.ts' })).text).toContain(
      "from '@/currency'",
    );
    fireEvent.click(within(history).getByRole('button', { name: 'Undo restore' }));
    await waitFor(async () =>
      expect((await backend.call('file.read', { project: LEDGER, path: 'src/server.ts' })).text).toContain(
        "from '@/money'",
      ),
    );
  });

  it('two points of the history compared in the editor', async () => {
    const editor = fakeEditor();
    show({ section: 'projects', project: LEDGER, path: 'src/server.ts' });
    await editor.attach();
    const history = await screen.findByRole('region', { name: 'History' });
    const boxes = await within(history).findAllByRole('checkbox');
    fireEvent.click(boxes[0]!);
    fireEvent.click(boxes[3]!);
    fireEvent.click(within(history).getByRole('button', { name: 'Compare the two selected' }));
    await waitFor(() => expect(editor.last('viewer/compare')?.request.oldText).toContain("from '@/currency'"));
    expect(editor.last('viewer/compare')?.request.newText).toContain("from '@/money'");
  });

  it('quick open: a few letters, Enter opens the file', async () => {
    show({ section: 'projects', project: LEDGER });
    fireEvent.click(await screen.findByRole('button', { name: 'Go to file' }));
    const dialog = await screen.findByRole('dialog', { name: 'Go to file' });
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'schema' } });
    expect(await within(dialog).findByRole('button', { name: 'src/db/schema.sql' })).toBeTruthy();
    fireEvent.keyDown(within(dialog).getByRole('textbox'), { key: 'Enter' });
    await waitFor(() => expect(window.location.hash).toBe('#/projects/p_demo0ledgr/src%2Fdb%2Fschema.sql'));
  });
});
