/**
 * The local history on the companion of stage 7 (row 7.5), through the seam to the scripted companion: a file's feed
 * with its commits and the stretch the companion did not watch (and the event that tells of one), a restore with its
 * question and its undo, a refusal in the page's words, the project's feed page by page with its deleted files, a
 * deleted file brought back, a file a commit deleted and its points without a text (by `content`, or by label from a
 * companion older than the field), the page size the companion announces, «Since your last visit», clearing the
 * history answered with the command for Terminal (or the companion's window), «Open in Compare code»; a companion of
 * stage 6 (no restore, no clearing) and one with no history at all — inactive, one sentence, nothing sent. The editor
 * page is played by a fake.
 */
import { SidePanels } from './SidePanels';
import { ProjectsPage } from '../sections/ProjectsPage';
import { takeHandedTexts } from '@src/compare/handoff';
import { chosenBackend } from '@src/projects/behaviors';
import { fakeCompanion } from '@src/projects/companion/fakeLink';
import { createConnection } from '@src/projects/connection';
import { demoBackend } from '@src/projects/demo/backend';
import { memoryLastSeen } from '@src/projects/lastSeen';
import { memoryLayout } from '@src/projects/layoutMemory';
import { projectSaver } from '@src/projects/projectSaver';
import { recordingSaver } from '@src/projects/scratch/fakeSaver';
import { memoryScratches } from '@src/projects/scratch/storage';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectBackend } from '@src/projects/backend';
import type { ProjectsBehaviors } from '@src/projects/behaviors';
import type { LastSeen } from '@src/projects/lastSeen';
import type { PermissionGate } from '@src/projects/permission';
import type { ToViewer } from '@src/shared/viewerProtocol';

const PROJECT = 'p_abcdefgh23';

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const granted: PermissionGate = {
  contains: () => Promise.resolve(true),
  request: () => Promise.resolve(true),
  usable: () => true,
  onAdded: () => () => undefined,
  onRemoved: () => () => undefined,
};

let backend: ProjectBackend;
let fake: ReturnType<typeof fakeCompanion>;
const make = (options: Parameters<typeof fakeCompanion>[0] = {}, methods?: (all: string[]) => string[]) => {
  fake = fakeCompanion({ wait: () => new Promise(resolve => setTimeout(resolve, 2)), ...options });
  if (methods) fake.companion.welcome.methods = methods(fake.companion.welcome.methods as string[]);
  backend = chosenBackend(
    createConnection({ permission: granted, openLink: fake.openLink, extension: '1', reload: vi.fn() }),
    demoBackend({ wait: () => Promise.resolve() }),
  );
};
const behaviors = (lastSeen?: LastSeen): ProjectsBehaviors => ({
  backend: Object.assign(() => backend, { id: 'test' }),
  autosaveDelayMs: 20,
  layout: SidePanels,
  layoutMemory: memoryLayout(),
  scratchStore: memoryScratches(),
  scratchSaver: recordingSaver(),
  fileSaver: projectSaver,
  ...(lastSeen && { lastSeen }),
});
const sent = (method: string): Record<string, unknown>[] =>
  fake.ports
    .flatMap(p => p.sent)
    .filter(f => (f as { method?: string }).method === method)
    .map(f => (f as { params: Record<string, unknown> }).params);

/** The editor page, played: it takes what the section posts and answers like the real one. */
const fakeEditor = () => {
  let frame: HTMLIFrameElement | null = null;
  const inbox: ToViewer[] = [];
  const send = (data: unknown): void => {
    window.dispatchEvent(new MessageEvent('message', { data, origin: location.origin, source: frame!.contentWindow }));
  };
  const shown = (id: number) => ({
    type: 'viewer/shown',
    id,
    shown: {
      path: 'p',
      changes: 0,
      added: 0,
      removed: 0,
      lineDiffer: null,
      compareMs: null,
      updateMs: null,
      cause: 'request',
      sides: {
        old: { editable: false, modified: false, empty: false },
        new: { editable: false, modified: false, empty: false },
      },
      mode: 'file',
    },
  });
  return {
    inbox,
    attach: async (): Promise<void> => {
      frame = await waitFor(() => {
        const found = document.querySelector<HTMLIFrameElement>('iframe.kit-projects-frame');
        if (!found?.contentWindow) throw new Error('no editor frame yet');
        return found;
      });
      frame.contentWindow!.postMessage = ((message: ToViewer) => {
        inbox.push(message);
        if (message.type === 'viewer/read')
          queueMicrotask(() => send({ type: 'viewer/text', id: message.id, side: message.side, text: '' }));
        if ('id' in message && message.type !== 'viewer/read') queueMicrotask(() => send(shown(message.id)));
      }) as Window['postMessage'];
      act(() => send({ type: 'viewer/ready' }));
    },
  };
};

/** The section on a file of the project, its history shown. */
const historyOf = async (path: string, lastSeen?: LastSeen) => {
  window.location.hash = `#/projects/${PROJECT}/${encodeURIComponent(path)}`;
  const view = render(
    <ProjectsPage route={{ section: 'projects', project: PROJECT, path }} behaviors={behaviors(lastSeen)} />,
  );
  const editor = fakeEditor();
  await editor.attach();
  fireEvent.click(await screen.findByRole('button', { name: 'Show history' }));
  const history = await screen.findByRole('region', { name: 'History' });
  return { history, editor, view };
};
const labels = (history: HTMLElement): string[] =>
  [...history.querySelectorAll('.kit-projects-point-label')].map(e => e.textContent ?? '');
const rowOf = (history: HTMLElement, label: string): HTMLElement =>
  [...history.querySelectorAll<HTMLElement>('.kit-projects-point')].find(
    r => r.querySelector('.kit-projects-point-label')?.textContent === label,
  )!;

/** Two saves of src/new.txt, so its history has the companion's «Before edit» and the server's «Saved». */
const saveTwice = async (): Promise<string> => {
  await backend.connect();
  const { hash } = await backend.call('file.read', { project: PROJECT, path: 'src/new.txt' });
  const one = await backend.call('file.save', { project: PROJECT, path: 'src/new.txt', baseHash: hash, text: 'one\n' });
  const two = await backend.call('file.save', {
    project: PROJECT,
    path: 'src/new.txt',
    baseHash: one.hash,
    text: 'two\n',
  });
  return two.hash;
};

beforeEach(() => {
  window.location.hash = '#/projects';
});
afterEach(() => cleanup());

describe('a file’s history on the companion (row 7.5)', () => {
  it('the server’s points, the commits marked; the stretch the companion did not watch, also when an event tells', async () => {
    make();
    const { history } = await historyOf('docs/readme.md');
    await waitFor(() => expect(labels(history)).toEqual(['External change', 'Second commit', 'First commit']));
    expect(rowOf(history, 'Second commit').textContent).toContain('Commit');
    expect(history.querySelector('[data-gap]')).toBeNull();
    act(() => fake.companion.gap(PROJECT, Date.UTC(2026, 10, 27, 18), Date.UTC(2026, 10, 28, 9), 2));
    await waitFor(() =>
      expect(history.querySelector('[data-gap]')?.textContent).toMatch(
        /^The history may be incomplete: the companion was not running from .+ to .+\.$/,
      ),
    );
  });

  it('a restore asks with the comparison shown, writes from the version shown, and is undone the same way', async () => {
    make();
    const hash = await saveTwice();
    const { history, editor } = await historyOf('src/new.txt');
    await waitFor(() => expect(labels(history)).toEqual(['Saved', 'Saved', 'Before edit']));
    fireEvent.click(within(rowOf(history, 'Before edit')).getByRole('button', { name: 'Restore…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Restore this version?' });
    expect(dialog.textContent).toContain('The current version is kept in the history.');
    await waitFor(() => expect(editor.inbox.some(m => m.type === 'viewer/show-diff')).toBe(true));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore' }));
    expect(await within(history).findByText('Restored. The version it replaced is in the history.')).toBeTruthy();
    expect(sent('history.restore')[0]).toMatchObject({ path: 'src/new.txt', currentHash: hash });
    expect((await backend.call('file.read', { project: PROJECT, path: 'src/new.txt' })).text).toBe('a new file\n');
    fireEvent.click(within(history).getByRole('button', { name: 'Undo restore' }));
    expect(await within(history).findByText('The restore is undone.')).toBeTruthy();
    expect((await backend.call('file.read', { project: PROJECT, path: 'src/new.txt' })).text).toBe('two\n');
  });

  it('a refusal of the write policy and a stale version, each in the page’s words', async () => {
    make();
    await saveTwice();
    const { history } = await historyOf('src/new.txt');
    await waitFor(() => expect(labels(history)).toContain('Before edit'));
    fake.companion.failNext('history.restore', 'secret-file');
    fireEvent.click(within(rowOf(history, 'Before edit')).getByRole('button', { name: 'Restore…' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Restore' }));
    expect(await within(history).findByText('This file holds secrets: it is read only from the page.')).toBeTruthy();
    // Changed on disk after the question was asked: nothing written.
    fireEvent.click(within(rowOf(history, 'Before edit')).getByRole('button', { name: 'Restore…' }));
    const dialog = await screen.findByRole('dialog');
    fake.companion.changeOnDisk(PROJECT, 'src/new.txt', 'someone else\n');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore' }));
    expect(
      await within(history).findByText('The file changed since this was asked. Nothing was written; look at it again.'),
    ).toBeTruthy();
    expect((await backend.call('file.read', { project: PROJECT, path: 'src/new.txt' })).text).toBe('someone else\n');
  });

  it('«Open in Compare code»: the version and the current file handed over, the current side saving into the project', async () => {
    make();
    await saveTwice();
    const { history } = await historyOf('src/new.txt');
    await waitFor(() => expect(labels(history)).toContain('Before edit'));
    fireEvent.click(within(rowOf(history, 'Before edit')).getByRole('button', { name: 'Open in Compare code' }));
    await waitFor(() => expect(window.location.hash).toBe('#/compare'));
    const [version, current] = takeHandedTexts();
    expect(version).toMatchObject({ text: 'a new file\n' });
    expect(version!.name).toMatch(/^new\.txt \(Before edit .+\)$/);
    expect(version!.origin).toBeUndefined();
    expect(current).toMatchObject({
      text: 'two\n',
      name: 'new.txt',
      origin: { project: PROJECT, path: 'src/new.txt', backend: 'companion' },
    });
  });
});

describe('the project’s history (row 7.5)', () => {
  it('page by page; the deleted files, one brought back from its version; a moment without a text offers nothing', async () => {
    make();
    await backend.connect();
    let { hash } = await backend.call('file.read', { project: PROJECT, path: 'src/new.txt' });
    for (let i = 0; i < 101; i++)
      ({ hash } = await backend.call('file.save', {
        project: PROJECT,
        path: 'src/new.txt',
        baseHash: hash,
        text: `v${i}\n`,
      }));
    const { history } = await historyOf('src/new.txt');
    fireEvent.click(within(history).getByRole('radio', { name: 'Project' }));
    await waitFor(() => expect(history.querySelectorAll('.kit-projects-point:not([data-deleted])')).toHaveLength(100));
    fireEvent.click(within(history).getByRole('button', { name: 'Show more' }));
    await waitFor(() =>
      expect(history.querySelectorAll('.kit-projects-point:not([data-deleted])').length).toBeGreaterThan(100),
    );
    expect(sent('history.project').some(p => typeof p.cursor === 'string')).toBe(true);
    const deleted = within(history).getByRole('group', { name: 'Deleted files' });
    fireEvent.click(within(deleted).getByRole('button', { name: 'History of gone.txt, deleted' }));
    await waitFor(() => expect(labels(history)).toEqual(['Deleted while away', 'Saved']));
    expect(history.querySelector('[data-deleted-subject]')?.textContent).toContain('gone.txt is deleted.');
    const noText = rowOf(history, 'Deleted while away');
    expect(noText.textContent).toContain('No version kept');
    expect(within(noText).queryAllByRole('button')).toHaveLength(0);
    // A deleted file has nothing to open next to it in «Compare code»; restoring creates it again.
    expect(within(rowOf(history, 'Saved')).queryByRole('button', { name: 'Open in Compare code' })).toBeNull();
    fireEvent.click(within(rowOf(history, 'Saved')).getByRole('button', { name: 'Restore…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Restore this version?' });
    expect(dialog.textContent).toContain('gone.txt was deleted. It will be created again');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore' }));
    expect(await within(history).findByText('Restored: the file is back.')).toBeTruthy();
    expect(sent('history.restore').at(-1)).toMatchObject({ path: 'gone.txt', currentHash: null });
    expect((await backend.call('file.read', { project: PROJECT, path: 'gone.txt' })).text).toBe(
      'This file will be deleted.\n',
    );
  });

  it('a file a commit deleted: listed; its points without a text offer nothing (by `content`); restored from the commit that added it', async () => {
    make();
    const { history } = await historyOf('docs/readme.md');
    fireEvent.click(within(history).getByRole('radio', { name: 'Project' }));
    const deleted = await within(history).findByRole('group', { name: 'Deleted files' });
    fireEvent.click(within(deleted).getByRole('button', { name: 'History of retired.txt, deleted' }));
    await waitFor(() => expect(labels(history)).toEqual(['Remove retired.txt', 'Before rollback', 'Add retired.txt']));
    // Neither label is one the page knows: the companion's `content: false` says so.
    for (const label of ['Remove retired.txt', 'Before rollback']) {
      const row = rowOf(history, label);
      expect(row.getAttribute('data-text')).toBe('none');
      expect(row.textContent).toContain('No version kept');
      expect(within(row).queryAllByRole('button')).toHaveLength(0);
    }
    fireEvent.click(within(rowOf(history, 'Add retired.txt')).getByRole('button', { name: 'Restore…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Restore this version?' });
    expect(dialog.textContent).toContain('retired.txt was deleted. It will be created again');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore' }));
    expect(await within(history).findByText('Restored: the file is back.')).toBeTruthy();
    expect(sent('history.restore').at(-1)).toMatchObject({ path: 'retired.txt', currentHash: null });
    expect((await backend.call('file.read', { project: PROJECT, path: 'retired.txt' })).text).toBe(
      'A file a commit deleted.\n',
    );
  });

  it('pages of the size the companion announces (`maxHistoryPage`)', async () => {
    make({ limits: { maxHistoryPage: 40 } });
    await backend.connect();
    let { hash } = await backend.call('file.read', { project: PROJECT, path: 'src/new.txt' });
    for (let i = 0; i < 40; i++)
      ({ hash } = await backend.call('file.save', {
        project: PROJECT,
        path: 'src/new.txt',
        baseHash: hash,
        text: `v${i}\n`,
      }));
    const { history } = await historyOf('src/new.txt');
    fireEvent.click(within(history).getByRole('radio', { name: 'Project' }));
    await waitFor(() => expect(history.querySelectorAll('.kit-projects-point:not([data-deleted])')).toHaveLength(40));
    fireEvent.click(within(history).getByRole('button', { name: 'Show more' }));
    await waitFor(() =>
      expect(history.querySelectorAll('.kit-projects-point:not([data-deleted])').length).toBeGreaterThan(40),
    );
    expect(sent('history.project').every(p => p.limit === 40)).toBe(true);
  });

  it('a companion older than `content`: a moment without a text known by its label; pages as before (100)', async () => {
    make({ contentFlag: false });
    await backend.connect();
    const { points } = await backend.call('history.file', { project: PROJECT, path: 'gone.txt' });
    expect(points.some(p => 'content' in p)).toBe(false);
    const { history } = await historyOf('docs/readme.md');
    fireEvent.click(within(history).getByRole('radio', { name: 'Project' }));
    const deleted = await within(history).findByRole('group', { name: 'Deleted files' });
    expect(sent('history.project').at(-1)).toMatchObject({ limit: 100 });
    fireEvent.click(within(deleted).getByRole('button', { name: 'History of gone.txt, deleted' }));
    await waitFor(() => expect(labels(history)).toEqual(['Deleted while away', 'Saved']));
    const noText = rowOf(history, 'Deleted while away');
    expect(noText.textContent).toContain('No version kept');
    expect(within(noText).queryAllByRole('button')).toHaveLength(0);
    expect(within(rowOf(history, 'Saved')).getByRole('button', { name: 'Restore…' })).toBeTruthy();
  });

  it('«Since your last visit»: what changed after the person last left; the visit remembered on leaving', async () => {
    make();
    const left = Date.now() - 60_000;
    const lastSeen = memoryLastSeen({ [PROJECT]: left });
    await saveTwice();
    const { history, view } = await historyOf('src/new.txt', lastSeen);
    const since = await within(history).findByRole('radio', { name: 'Since your last visit (1)' });
    fireEvent.click(since);
    await waitFor(() => expect(labels(history)).toEqual(['Saved', 'Saved', 'Before edit']));
    expect(sent('history.project').some(p => p.since === left)).toBe(true);
    view.unmount();
    expect(lastSeen.kept[PROJECT]).toBeGreaterThan(left);
  });

  it('clearing: the companion without its window answers with the command, shown verbatim with Copy', async () => {
    make();
    const { history } = await historyOf('docs/readme.md');
    fireEvent.click(within(history).getByRole('radio', { name: 'Project' }));
    fireEvent.click(await within(history).findByRole('button', { name: 'Clear history…' }));
    const said = await waitFor(() => {
      const found = history.querySelector<HTMLElement>('[data-said="purge"]');
      if (!found) throw new Error('not said yet');
      return found;
    });
    expect(said.getAttribute('data-tone')).toBe('info');
    expect(said.textContent).toContain('Clearing the history needs your confirmation');
    expect(said.querySelector('[data-command]')?.textContent).toBe('devtab history purge ~/fx/repo');
    expect(within(said).getByRole('button', { name: 'Copy the command devtab history purge ~/fx/repo' })).toBeTruthy();
  });

  it('clearing with the companion’s window: it waits, says so, and the history is empty after «yes»', async () => {
    // The window answers after 40 waits: 1.2 s, well past the 400 ms after which the page says it waits.
    make({ confirm: 'yes', wait: () => new Promise(resolve => setTimeout(resolve, 30)) });
    const { history } = await historyOf('docs/readme.md');
    fireEvent.click(within(history).getByRole('radio', { name: 'Project' }));
    fireEvent.click(await within(history).findByRole('button', { name: 'Clear history…' }));
    expect(await within(history).findByText('Confirm in the companion’s window.', {}, { timeout: 3000 })).toBeTruthy();
    expect(
      await within(history).findByText('The local history of this project is cleared.', {}, { timeout: 5000 }),
    ).toBeTruthy();
    await waitFor(() => expect(within(history).getByText('No history yet.')).toBeTruthy());
  });
});

describe('a companion without stage 7', () => {
  it('stage 6: the feeds read; restoring and clearing are not offered, one sentence says so, neither is sent', async () => {
    make({ methods: 'stage6' });
    await saveTwice();
    const { history } = await historyOf('src/new.txt');
    await waitFor(() => expect(labels(history)).toContain('Before edit'));
    expect(history.querySelector('[data-history="quiet"]')?.textContent).toBe(
      'This companion cannot restore versions or clear the history yet.',
    );
    expect(within(history).queryByRole('button', { name: 'Restore…' })).toBeNull();
    fireEvent.click(within(history).getByRole('radio', { name: 'Project' }));
    await waitFor(() => expect(labels(history).length).toBeGreaterThan(0));
    expect(within(history).queryByRole('button', { name: 'Clear history…' })).toBeNull();
    expect(sent('history.restore')).toHaveLength(0);
    expect(sent('history.requestPurge')).toHaveLength(0);
  });

  it('no history at all: one sentence, no request about the history', async () => {
    make({}, all => all.filter(m => !m.startsWith('history.')));
    const { history } = await historyOf('docs/readme.md');
    expect(history.querySelector('[data-history="not-offered"]')?.textContent).toBe(
      'This companion does not keep a history yet.',
    );
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(
      fake.ports.flatMap(p => p.sent).some(f => String((f as { method?: string }).method).startsWith('history.')),
    ).toBe(false);
  });
});
