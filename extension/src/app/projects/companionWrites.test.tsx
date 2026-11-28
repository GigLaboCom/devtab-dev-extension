/**
 * The section on the companion of stages 4–6 (rows 4.5, 5.4, 6.5), through the seam to the scripted companion: adding
 * a project inside a trusted folder and outside one (the command for Terminal shown verbatim; a window answered, or
 * cancelled), the class changed both ways, a file saved by itself, a conflict and its «Keep mine», a refusal of the
 * write policy in the page's words, a commit of chosen hunks with its streamed output and its undo, a commit's error
 * with what to do, rollback without a Trash, deleting without one. The editor page is played by a fake.
 */
import { SidePanels } from './SidePanels';
import { TRUSTED_ROOT } from '../../../../scripts/e2e-projects/companion.mjs';
import { ProjectsPage } from '../sections/ProjectsPage';
import { chosenBackend } from '@src/projects/behaviors';
import { fakeCompanion } from '@src/projects/companion/fakeLink';
import { createConnection } from '@src/projects/connection';
import { demoBackend } from '@src/projects/demo/backend';
import { memoryLayout } from '@src/projects/layoutMemory';
import { projectSaver } from '@src/projects/projectSaver';
import { recordingSaver } from '@src/projects/scratch/fakeSaver';
import { memoryScratches } from '@src/projects/scratch/storage';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Route } from '../route';
import type { ProjectBackend } from '@src/projects/backend';
import type { ProjectsBehaviors } from '@src/projects/behaviors';
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
const make = (options: Parameters<typeof fakeCompanion>[0] = {}) => {
  fake = fakeCompanion({ wait: () => new Promise(resolve => setTimeout(resolve, 2)), ...options });
  backend = chosenBackend(
    createConnection({ permission: granted, openLink: fake.openLink, extension: '1', reload: vi.fn() }),
    demoBackend({ wait: () => Promise.resolve() }),
  );
};
const behaviors = (): ProjectsBehaviors => ({
  backend: Object.assign(() => backend, { id: 'test' }),
  autosaveDelayMs: 20,
  layout: SidePanels,
  layoutMemory: memoryLayout(),
  scratchStore: memoryScratches(),
  scratchSaver: recordingSaver(),
  fileSaver: projectSaver,
});
const show = (route: Route) => render(<ProjectsPage route={route} behaviors={behaviors()} />);
const sentCalls = (method: string): unknown[] =>
  fake.ports.flatMap(p => p.sent).filter(f => (f as { method?: string }).method === method);

/** The editor page, played: it takes what the section posts and answers like the real one. */
const fakeEditor = () => {
  let text = '';
  let frame: HTMLIFrameElement | null = null;
  const inbox: ToViewer[] = [];
  const send = (data: unknown): void => {
    window.dispatchEvent(new MessageEvent('message', { data, origin: location.origin, source: frame!.contentWindow }));
  };
  const shown = (id: number | undefined) => ({
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
        if (message.type === 'viewer/show-file') text = message.request.text;
        if (message.type === 'viewer/read')
          queueMicrotask(() => send({ type: 'viewer/text', id: message.id, side: message.side, text }));
        if ('id' in message && message.type !== 'viewer/read') queueMicrotask(() => send(shown(message.id)));
      }) as Window['postMessage'];
      act(() => send({ type: 'viewer/ready' }));
    },
    type: (next: string) => {
      text = next;
      act(() => send(shown(undefined)));
    },
    /** A keystroke the editor took but has not reported yet. */
    typeUnreported: (next: string) => {
      text = next;
    },
  };
};

const saveState = () => document.querySelector('.kit-projects-save');
const openFile = async (path: string) => {
  window.location.hash = `#/projects/${PROJECT}/${encodeURIComponent(path)}`;
  show({ section: 'projects', project: PROJECT, path });
  const editor = fakeEditor();
  await editor.attach();
  await waitFor(() => expect(editor.inbox.some(m => m.type === 'viewer/show-file')).toBe(true));
  await waitFor(() => expect(saveState()?.textContent).toBe('Saved'));
  return editor;
};

beforeEach(() => {
  window.location.hash = '#/projects';
});
afterEach(() => cleanup());

describe('adding a project and its class (row 4.5)', () => {
  const addDialog = async () => {
    fireEvent.click(await screen.findByRole('button', { name: /^Add project/ }));
    return screen.findByRole('dialog', { name: 'Add a project' });
  };
  const add = (dialog: HTMLElement, path: string) => {
    fireEvent.change(within(dialog).getByLabelText('Full path of the folder'), { target: { value: path } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
  };

  it('inside a trusted folder: added at once, writable, and opened', async () => {
    make();
    show({ section: 'projects' });
    const dialog = await addDialog();
    add(dialog, 'relative/path');
    expect(await within(dialog).findByText(/Type the full path, starting with \//)).toBeTruthy();
    expect(sentCalls('project.requestAdd')).toHaveLength(0);
    add(dialog, `${TRUSTED_ROOT}/second`);
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/projects\/p_[a-z0-9]+$/));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add a project' })).toBeNull());
  });

  it('outside without the companion’s window: the command for Terminal, verbatim, with one sentence', async () => {
    make();
    show({ section: 'projects' });
    const dialog = await addDialog();
    add(dialog, '/elsewhere/app');
    // Said as a hint (role status), not an error: the companion only says where to do it instead.
    const note = await within(dialog).findByRole('status');
    expect(note.querySelector('[data-command]')?.textContent).toBe('cd /elsewhere/app && devtab add');
    expect(note.textContent).toContain('cannot ask you in a window');
  });

  it('outside with a window: «confirm in the companion’s window» while it waits; Cancel closes it', async () => {
    make({ confirm: 'yes', wait: () => new Promise(resolve => setTimeout(resolve, 60)) });
    show({ section: 'projects' });
    const dialog = await addDialog();
    add(dialog, '/elsewhere/waiting');
    expect(await within(dialog).findByText('Confirm in the companion’s window.', {}, { timeout: 3000 })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(fake.ports.flatMap(p => p.sent).some(f => (f as { type?: string }).type === 'cancel')).toBe(true),
    );
  });

  it('read only at once («made read only by you»); writable again: the command, since there is no window', async () => {
    make();
    show({ section: 'projects', project: PROJECT });
    const makeView = await screen.findByRole('button', { name: 'Make read only' });
    expect(document.querySelector('.kit-projects-class')?.textContent).toContain('via fx');
    fireEvent.click(makeView);
    await waitFor(() => expect(document.querySelector('.kit-projects-class')?.getAttribute('data-class')).toBe('view'));
    expect(document.querySelector('.kit-projects-class')?.textContent).toContain('made read only by you');
    fireEvent.click(await screen.findByRole('button', { name: 'Make writable…' }));
    const said = await waitFor(() => {
      const found = document.querySelector('[data-said="class"] [data-command]');
      if (!found) throw new Error('not said yet');
      return found;
    });
    expect(said.textContent).toBe('cd ~/fx/repo && devtab add --write');
  });
});

describe('saving (row 5.4)', () => {
  it('an edit saves itself through `file.save` from the version read', async () => {
    make();
    const editor = await openFile('src/new.txt');
    editor.type('a new file, edited\n');
    await waitFor(() => expect(sentCalls('file.save')).toHaveLength(1));
    await waitFor(() => expect(saveState()?.textContent).toBe('Saved'));
  });

  it('a change on disk under an unsaved edit: the three choices; «Keep mine» writes over from the disk’s version', async () => {
    make();
    const editor = await openFile('src/new.txt');
    fake.companion.changeOnDisk(PROJECT, 'src/new.txt', 'theirs\n');
    editor.type('mine\n');
    await screen.findByText('The file changed on disk while you were editing it.');
    expect(saveState()?.textContent).toBe('Not saved: conflict');
    fireEvent.click(screen.getByRole('button', { name: 'Keep mine' }));
    await waitFor(() => expect(saveState()?.textContent).toBe('Saved'));
    expect((await backend.call('file.read', { project: PROJECT, path: 'src/new.txt' })).text).toBe('mine\n');
  });

  it('an outside change before a keystroke’s edit reached the page: still a conflict, the keystroke not replaced', async () => {
    make();
    const editor = await openFile('src/new.txt');
    editor.typeUnreported('typed just now\n');
    fake.companion.changeOnDisk(PROJECT, 'src/new.txt', 'theirs\n');
    await screen.findByText('The file changed on disk while you were editing it.');
    expect(screen.queryByText('Updated from disk')).toBeNull();
  });

  it('a refusal of the write policy is said in the page’s words, not the companion’s', async () => {
    make();
    const editor = await openFile('latin1.txt');
    editor.type('snow ☃');
    await waitFor(() =>
      expect(document.querySelector('[data-refused]')?.textContent).toBe(
        'Not saved: The text has characters windows-1252 cannot hold. Nothing was written.',
      ),
    );
    expect(saveState()?.textContent).toBe('Not saved');
  });

  it('deleting without a Trash says so plainly; a new file is created and opened', async () => {
    make();
    show({ section: 'projects', project: PROJECT, path: 'src/new.txt' });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete…' }));
    expect(await screen.findByText(/cannot move files to the Trash yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New file…' }));
    const dialog = await screen.findByRole('dialog', { name: 'New file' });
    const field = within(dialog).getByLabelText('Path in the project') as HTMLInputElement;
    expect(field.value).toBe('src/');
    fireEvent.change(field, { target: { value: 'src/made.txt' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(window.location.hash).toBe(`#/projects/${PROJECT}/src%2Fmade.txt`));
    fireEvent.click(screen.getByRole('button', { name: 'New file…' }));
    const again = await screen.findByRole('dialog', { name: 'New file' });
    fireEvent.change(within(again).getByLabelText('Path in the project'), { target: { value: '.env.local' } });
    fireEvent.click(within(again).getByRole('button', { name: 'Create' }));
    expect(await within(again).findByText('This file holds secrets: it is read only from the page.')).toBeTruthy();
  });
});

describe('committing (row 6.5)', () => {
  const commitView = async () => {
    fireEvent.click(await screen.findByRole('button', { name: /^Commit/, pressed: false }));
    const panel = await screen.findByRole('region', { name: 'Commit' });
    await within(panel).findByRole('group', { name: 'Changes' });
    return panel;
  };

  it('commits chosen hunks with the hooks’ output streamed; undo brings the change and the message back', async () => {
    make();
    show({ section: 'projects', project: PROJECT });
    const panel = await commitView();
    fireEvent.click(within(panel).getByRole('button', { name: /^src\/app\.txt/ }));
    const chunks = await within(panel).findByRole('group', { name: 'Chunks of src/app.txt' });
    await waitFor(() => expect(within(chunks).getAllByRole('checkbox')).toHaveLength(3));
    // Only the second chunk: the first and the third unchecked.
    fireEvent.click(within(chunks).getAllByRole('checkbox')[0]!);
    fireEvent.click(within(chunks).getAllByRole('checkbox')[2]!);
    // docs/readme.md is checked too by default (a tracked change): leave it out.
    fireEvent.click(within(panel).getByRole('checkbox', { name: 'docs/readme.md' }));
    fireEvent.click(within(panel).getByRole('checkbox', { name: 'gone.txt' }));
    expect(within(panel).getByText('1 file checked, 1 chunk')).toBeTruthy();
    fireEvent.change(within(panel).getByPlaceholderText('Commit message'), {
      target: { value: 'Change line 15 only' },
    });
    fireEvent.click(within(panel).getByRole('button', { name: 'Commit' }));
    await within(panel).findByText(/^Committed 1 file as /);
    expect(panel.querySelector('[data-output]')?.textContent).toContain('pre-commit: passed');
    const commit = sentCalls('git.commit').at(-1) as { params: { selection: unknown } };
    expect(commit.params.selection).toEqual([{ path: 'src/app.txt', chunks: [1] }]);
    fireEvent.click(await within(panel).findByRole('button', { name: 'Undo last commit' }));
    await within(panel).findByText('The last commit is undone; its changes are back.');
    expect((within(panel).getByPlaceholderText('Commit message') as HTMLTextAreaElement).value).toBe(
      'Change line 15 only',
    );
  });

  it('«Undo last commit» as the companion says beforehand (headUndoable): offered for a HEAD this page did not make', async () => {
    make();
    show({ section: 'projects', project: PROJECT });
    const panel = await commitView();
    // The vectors' repository: HEAD is a commit no remote branch has — the companion says it can be undone.
    expect(await within(panel).findByRole('button', { name: 'Undo last commit' })).toBeTruthy();
    // Read only: the companion says no (`not-mine`); the action goes, and the class already says why.
    fireEvent.click(screen.getByRole('button', { name: 'Make read only' }));
    await waitFor(() => expect(within(panel).queryByRole('button', { name: 'Undo last commit' })).toBeNull());
    expect(panel.querySelector('[data-undo-reason]')).toBeNull();
  });

  it('a hook that cannot find a program: its output, what to do, the commands; capture again needs the terminal', async () => {
    make();
    show({ section: 'projects', project: PROJECT });
    const panel = await commitView();
    fake.companion.failNext(
      'git.commit',
      'hook-tool-missing',
      { hook: 'pre-commit', tool: 'npx', output: 'npx: command not found\n', pathCapturedAt: null },
      { stream: ['pre-commit: npx: command not found\n'], pauseMs: 1 },
    );
    fireEvent.change(within(panel).getByPlaceholderText('Commit message'), { target: { value: 'Try' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Commit' }));
    const note = await waitFor(() => {
      const found = panel.querySelector('[data-said="hook-tool-missing"]');
      if (!found) throw new Error('not said yet');
      return found as HTMLElement;
    });
    expect(note.textContent).toContain('did not find npx');
    expect([...note.querySelectorAll('[data-command]')].map(c => c.textContent)).toEqual([
      `devtab env path-add --project ${PROJECT} <folder>`,
      `devtab doctor --commit ${PROJECT}`,
    ]);
    expect(panel.querySelector('[data-output]')?.textContent).toBe('pre-commit: npx: command not found\n');
    fireEvent.click(within(note).getByRole('button', { name: 'Capture the environment again…' }));
    await waitFor(() =>
      expect(panel.querySelector('[data-said="capture"] [data-command]')?.textContent).toBe('devtab env capture'),
    );
    // The message and the checks stay.
    expect((within(panel).getByPlaceholderText('Commit message') as HTMLTextAreaElement).value).toBe('Try');
  });

  it('rollback without a Trash: no «delete added» box, one line why; Commit and Push… inactive with why', async () => {
    make();
    show({ section: 'projects', project: PROJECT });
    const panel = await commitView();
    expect(within(panel).getByRole('button', { name: 'Commit and Push…' }).getAttribute('title')).toBe(
      'This companion cannot push yet.',
    );
    fireEvent.click(within(panel).getByRole('button', { name: 'Rollback…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rollback' });
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    expect(within(dialog).getByText(/added files stay on disk/)).toBeTruthy();
  });
});
