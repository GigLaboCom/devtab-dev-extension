/**
 * The keys of the Projects section (D38) on the demo: what the page offers the shell and when (nothing without a
 * target), what each command does — the language popup of a new scratch asked for from elsewhere or here, the open
 * scratch's download, rename, language and delete, the panels' keys (show and focus, focus, hide), quick open, the
 * changes of a diff and the file / diff switch — and the keys shown in the controls' tooltips, as the person set them.
 */
import { SidePanels } from './SidePanels';
import { parseRoute } from '../route';
import { ProjectsPage } from '../sections/ProjectsPage';
import { demoBackend } from '@src/projects/demo/backend';
import { memoryLayout } from '@src/projects/layoutMemory';
import { projectSaver } from '@src/projects/projectSaver';
import { recordingSaver } from '@src/projects/scratch/fakeSaver';
import { areaScratches, memoryArea } from '@src/projects/scratch/storage';
import { ask } from '@src/shortcuts/intent';
import { createTargets } from '@src/shortcuts/targets';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SectionKeys } from '../shell/sectionKeys';
import type { ProjectsBehaviors } from '@src/projects/behaviors';
import type { ScratchStore } from '@src/projects/scratch/store';
import type { KeyChord } from '@src/shared/keys';
import type { ToViewer } from '@src/shared/viewerProtocol';

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const LEDGER = 'p_demo0ledgr';

let store: ScratchStore;
let saver: ReturnType<typeof recordingSaver>;
let targets: ReturnType<typeof createTargets>;
let keys: SectionKeys;
const BOUND: Record<string, KeyChord> = {
  'scratch:new': { key: 'n', code: 'KeyN', mod: true, shift: true, alt: true },
  'projects:files': { key: 'j', code: 'KeyJ', mod: true, shift: false, alt: true },
};

const behaviors = (): ProjectsBehaviors => ({
  backend: Object.assign(() => demoBackend({ wait: () => Promise.resolve() }), { id: 'demo' }),
  autosaveDelayMs: 20,
  layout: SidePanels,
  layoutMemory: memoryLayout(),
  scratchStore: store,
  scratchSaver: saver,
  fileSaver: projectSaver,
});
const page = (scratches = true) => (
  <ProjectsPage route={parseRoute(window.location.hash)} behaviors={behaviors()} scratches={scratches} keys={keys} />
);
const open = (hash: string, scratches = true) => {
  window.location.hash = hash;
  return render(page(scratches));
};
const run = async (id: string): Promise<boolean> => {
  let done = false;
  await act(async () => {
    done = targets.run(id);
    await Promise.resolve();
  });
  return done;
};

/** The editor page, played: it answers each request with what it shows (`changes` hunks in a diff). */
const fakeEditor = async (changes = 0) => {
  const inbox: ToViewer[] = [];
  let text = '';
  const frame = await waitFor(() => {
    const found = document.querySelector<HTMLIFrameElement>('iframe.kit-projects-frame');
    if (!found?.contentWindow) throw new Error('no editor frame yet');
    return found;
  });
  const send = (data: unknown): void => {
    window.dispatchEvent(new MessageEvent('message', { data, origin: location.origin, source: frame.contentWindow }));
  };
  frame.contentWindow!.postMessage = ((message: ToViewer) => {
    inbox.push(message);
    if (message.type === 'viewer/show-file') text = message.request.text;
    if (message.type === 'viewer/read')
      queueMicrotask(() => send({ type: 'viewer/text', id: message.id, side: message.side, text }));
    else if ('id' in message)
      queueMicrotask(() =>
        send({
          type: 'viewer/shown',
          id: message.id,
          shown: {
            path: '',
            changes: message.type === 'viewer/show-diff' ? changes : 0,
            added: 0,
            removed: 0,
            lineDiffer: null,
            compareMs: null,
            updateMs: null,
            cause: 'request',
            sides: {
              old: { editable: false, modified: false, empty: false },
              new: { editable: true, modified: false, empty: false },
            },
            mode: message.type === 'viewer/show-diff' ? 'diff' : 'file',
          },
        }),
      );
  }) as Window['postMessage'];
  act(() => send({ type: 'viewer/ready' }));
  return {
    all: <T extends ToViewer['type']>(type: T) =>
      inbox.filter((m): m is Extract<ToViewer, { type: T }> => m.type === type),
  };
};

beforeEach(() => {
  store = areaScratches(memoryArea(), { id: 'test', keeps: true });
  saver = recordingSaver();
  targets = createTargets();
  keys = { offer: targets.offer, keyOf: id => BOUND[id], mac: true };
});
afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('a new scratch from the keyboard', () => {
  it('asked for before the section was there (another page): the popup opens on arrival, once', async () => {
    ask('scratch:new');
    open('#/projects');
    const popup = await screen.findByRole('dialog', { name: 'New scratch file' });
    expect(document.activeElement).toBe(within(popup).getByRole('combobox', { name: 'Filter languages' }));
    // Taken: a second page does not open it again.
    cleanup();
    open('#/projects');
    await screen.findByRole('region', { name: 'Scratches' });
    expect(screen.queryByRole('dialog', { name: 'New scratch file' })).toBeNull();
  });

  it('asked for while the section is shown — over an open project too — the popup opens there', async () => {
    open(`#/projects/${LEDGER}`);
    await screen.findByRole('tree', { name: 'Files' });
    await act(async () => ask('scratch:new'));
    const popup = await screen.findByRole('dialog', { name: 'New scratch file' });
    fireEvent.change(within(popup).getByRole('combobox'), { target: { value: 'json' } });
    await act(async () => {
      fireEvent.keyDown(within(popup).getByRole('combobox'), { key: 'Enter' });
    });
    const made = (await store.list()).scratches[0];
    expect(made.language).toBe('json');
    expect(window.location.hash).toBe(`#/projects/scratches/${made.id}`);
  });

  it('an edition without scratches takes no intent', async () => {
    ask('scratch:new');
    open('#/projects', false);
    await screen.findByRole('heading', { name: 'Projects', level: 2 });
    expect(screen.queryByRole('dialog')).toBeNull();
    // Left for nobody: cleared for the next test.
    cleanup();
    open('#/projects');
    await screen.findByRole('dialog', { name: 'New scratch file' });
  });

  it('«New scratch…» says its key now (the person’s, not the default)', async () => {
    open('#/projects');
    const button = await screen.findByRole('button', { name: 'New scratch…' });
    expect(button.getAttribute('title')).toBe('New scratch file (⌥⇧⌘N)');
    expect(button.getAttribute('aria-keyshortcuts')).toBe('Meta+Alt+Shift+N');
  });
});

describe('the open scratch', () => {
  it('offers download, rename, language and delete only while it is open', async () => {
    const made = await store.create('python');
    if (!made.ok) throw new Error('not created');
    open('#/projects');
    await screen.findByRole('region', { name: 'Scratches' });
    for (const id of ['scratch:download', 'scratch:rename', 'scratch:language', 'scratch:delete'])
      expect(targets.offers(id)).toBe(false);
    cleanup();
    open(`#/projects/scratches/${made.value.id}`);
    await screen.findByRole('heading', { name: 'scratch.py', level: 1 });
    const editor = await fakeEditor();
    await waitFor(() => expect(targets.offers('scratch:download')).toBe(true));

    // Rename: the name field takes the keyboard.
    expect(await run('scratch:rename')).toBe(true);
    const field = await screen.findByRole('textbox', { name: 'Scratch name' });
    expect(document.activeElement).toBe(field);
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Escape' });
    });

    // Change language: the language popup, the scratch's language first.
    await run('scratch:language');
    const popup = await screen.findByRole('dialog', { name: 'Language of scratch.py' });
    expect(within(popup).getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true');
    expect(within(popup).getAllByRole('option')[0].getAttribute('data-language')).toBe('python');
    fireEvent.change(within(popup).getByRole('combobox'), { target: { value: 'ruby' } });
    await act(async () => {
      fireEvent.keyDown(within(popup).getByRole('combobox'), { key: 'Enter' });
    });
    await screen.findByRole('heading', { name: 'scratch.rb', level: 1 });
    expect(editor.all('viewer/set-language').at(-1)?.language).toBe('ruby');

    // Download: «Compare code»'s saver, under the scratch's name.
    await run('scratch:download');
    await waitFor(() => expect(saver.requests.at(-1)?.suggestedName).toBe('scratch.rb'));

    // Delete: asks first.
    await run('scratch:delete');
    expect(await screen.findByRole('dialog', { name: 'Delete scratch.rb?' })).toBeTruthy();
  });
});

describe('an open project', () => {
  it('offers its panels and quick open; the section’s home offers none of them', async () => {
    open('#/projects');
    await screen.findByRole('region', { name: 'Scratches' });
    for (const id of ['projects:files', 'projects:commit', 'projects:history', 'projects:find', 'projects:go-to-file'])
      expect(targets.offers(id)).toBe(false);
    cleanup();
    open(`#/projects/${LEDGER}`);
    await screen.findByRole('tree', { name: 'Files' });
    for (const id of ['projects:files', 'projects:commit', 'projects:history', 'projects:find', 'projects:go-to-file'])
      expect(targets.offers(id)).toBe(true);
    // No file open: no change to go to, no view to switch.
    expect(targets.offers('projects:next-change')).toBe(false);
    expect(targets.offers('projects:view')).toBe(false);
    await run('projects:go-to-file');
    expect(await screen.findByRole('dialog', { name: 'Go to file' })).toBeTruthy();
  });

  it('a panel’s key: hidden — shows and takes the keyboard; showing, keyboard elsewhere — takes it; holding it — hides', async () => {
    open(`#/projects/${LEDGER}`);
    const tree = await screen.findByRole('tree', { name: 'Files' });
    const filesSwitch = screen.getAllByRole('button', { name: 'Files' }).find(b => b.hasAttribute('aria-pressed'))!;
    expect(filesSwitch.getAttribute('title')).toBe('Files (⌥⌘J)');
    // Showing, the keyboard elsewhere: it goes into the tree.
    (document.activeElement as HTMLElement | null)?.blur();
    await run('projects:files');
    await waitFor(() => expect(tree.contains(document.activeElement)).toBe(true));
    // Holding the keyboard: the panel hides, the keyboard on the view's switch.
    await run('projects:files');
    expect(document.getElementById('projects-side')?.dataset.open).toBe('false');
    expect(document.activeElement).toBe(filesSwitch);
    // Hidden: it shows and takes the keyboard.
    await run('projects:files');
    expect(document.getElementById('projects-side')?.dataset.open).toBe('true');
    await waitFor(() =>
      expect(screen.getByRole('tree', { name: 'Files' }).contains(document.activeElement)).toBe(true),
    );
    // Find in files: the bottom panel opens, its field focused.
    await run('projects:find');
    await waitFor(() =>
      expect(document.getElementById('projects-view-find')?.contains(document.activeElement)).toBe(true),
    );
    expect(document.activeElement?.tagName).toBe('INPUT');
    // History and Commit show their views.
    await run('projects:history');
    await waitFor(() => expect(document.getElementById('projects-view-history')?.hidden).toBe(false));
    await run('projects:commit');
    await waitFor(() => expect(document.getElementById('projects-view-commit')?.hidden).toBe(false));
  });

  it('a diff with changes: next and previous change go round the hunks; the file / diff switch has its key', async () => {
    const backend = demoBackend({ wait: () => Promise.resolve() });
    const status = await backend.call('git.status', { project: LEDGER });
    const changed = status.files.find(f => f.change === 'modified')!.path;
    open(`#/projects/${LEDGER}/${encodeURIComponent(changed)}`);
    const editor = await fakeEditor(3);
    await waitFor(() => expect(targets.offers('projects:view')).toBe(true));
    expect(targets.offers('projects:next-change')).toBe(false);
    await run('projects:view');
    await waitFor(() => expect(editor.all('viewer/show-diff').length).toBeGreaterThan(0));
    await waitFor(() => expect(targets.offers('projects:next-change')).toBe(true));
    for (let i = 0; i < 4; i++) await run('projects:next-change');
    await run('projects:previous-change');
    await run('projects:previous-change');
    expect(editor.all('viewer/reveal-hunk').map(m => m.index)).toEqual([0, 1, 2, 0, 2, 1]);
    // Back to the file: no changes to go to there.
    await run('projects:view');
    await waitFor(() => expect(targets.offers('projects:next-change')).toBe(false));
  });
});
