/**
 * Files opened from the system on the Projects page (D42, step O2), through the seam to the scripted companion with
 * `openFiles: true`: the «Files» group (absent with nothing to show, marks, Forget, the settings, the command only in
 * Pro), a file arriving by the event and by the address (the token leaves the address at once), a file of an added
 * project, an expired token, a file that waits for the permission, a companion without the methods (nothing sent),
 * the page's activity, Pro editing with a conflict and the free edition's read-only file with «Copy to a scratch». The
 * editor page is played by a fake.
 */
import { SidePanels } from './SidePanels';
import { useRoute } from '../route';
import { ProjectsPage } from '../sections/ProjectsPage';
import { chosenBackend } from '@src/projects/behaviors';
import { fakeCompanion } from '@src/projects/companion/fakeLink';
import { createConnection } from '@src/projects/connection';
import { demoBackend } from '@src/projects/demo/backend';
import { memoryLayout } from '@src/projects/layoutMemory';
import { companionOpenedFiles } from '@src/projects/openFiles/companion';
import { openedFileSaver } from '@src/projects/openFiles/saver';
import { memoryOpenFilesSettings } from '@src/projects/openFiles/settings';
import { projectSaver } from '@src/projects/projectSaver';
import { recordingSaver } from '@src/projects/scratch/fakeSaver';
import { memoryScratches } from '@src/projects/scratch/storage';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpenFilesEdition } from '@src/edition/edition';
import type { ProjectBackend } from '@src/projects/backend';
import type { ProjectsBehaviors } from '@src/projects/behaviors';
import type { PermissionGate } from '@src/projects/permission';
import type { ScratchStore } from '@src/projects/scratch/store';
import type { ToViewer } from '@src/shared/viewerProtocol';
import type { ReactElement } from 'react';

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const TOKEN = 'a1'.repeat(16);

const gate = (held: boolean): PermissionGate => ({
  contains: () => Promise.resolve(held),
  request: () => Promise.resolve(held),
  usable: () => true,
  onAdded: () => () => undefined,
  onRemoved: () => () => undefined,
});

/** The editor page, played: it takes what the section posts and answers like the real one. */
const fakeEditor = () => {
  const inbox: ToViewer[] = [];
  let text = '';
  let frame: HTMLIFrameElement | null = null;
  const send = (data: unknown): void => {
    window.dispatchEvent(new MessageEvent('message', { data, origin: location.origin, source: frame!.contentWindow }));
  };
  const shown = (id: number | undefined) => ({
    type: 'viewer/shown',
    ...(id !== undefined && { id }),
    shown: {
      path: '',
      changes: 0,
      added: 0,
      removed: 0,
      lineDiffer: null,
      compareMs: null,
      updateMs: null,
      cause: id === undefined ? 'edit' : 'request',
      sides: {
        old: { editable: false, modified: false, empty: false },
        new: { editable: true, modified: id === undefined, empty: false },
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
    last: <T extends ToViewer['type']>(type: T) =>
      [...inbox].reverse().find((m): m is Extract<ToViewer, { type: T }> => m.type === type),
    type: (next: string) => {
      text = next;
      act(() => send(shown(undefined)));
    },
  };
};

interface Setup {
  fake: ReturnType<typeof fakeCompanion>;
  backend: ProjectBackend;
  settings: ReturnType<typeof memoryOpenFilesSettings>;
  tab: { bringForward: ReturnType<typeof vi.fn>; openTab: ReturnType<typeof vi.fn> };
  scratches: ScratchStore;
  sent(method: string): { params: Record<string, unknown> }[];
}

const setup = ({
  openFiles = true,
  held = true,
  settings = {},
}: { openFiles?: boolean; held?: boolean; settings?: Parameters<typeof memoryOpenFilesSettings>[0] } = {}): Setup & {
  behaviors: ProjectsBehaviors;
} => {
  const fake = fakeCompanion({ openFiles, wait: () => new Promise(resolve => setTimeout(resolve, 1)) });
  const backend = chosenBackend(
    createConnection({ permission: gate(held), openLink: fake.openLink, extension: '1', reload: vi.fn() }),
    demoBackend({ wait: () => Promise.resolve() }),
  );
  const kept = memoryOpenFilesSettings(settings);
  const tab = { bringForward: vi.fn(() => Promise.resolve()), openTab: vi.fn(() => Promise.resolve()) };
  const scratches = memoryScratches();
  return {
    fake,
    backend,
    settings: kept,
    tab,
    scratches,
    sent: method =>
      fake.ports.flatMap(p => p.sent).filter(f => (f as { method?: string }).method === method) as {
        params: Record<string, unknown>;
      }[],
    behaviors: {
      backend: Object.assign(() => backend, { id: 'test' }),
      autosaveDelayMs: 20,
      layout: SidePanels,
      layoutMemory: memoryLayout(),
      scratchStore: scratches,
      scratchSaver: recordingSaver(),
      fileSaver: projectSaver,
      openFiles: { files: companionOpenedFiles, saver: openedFileSaver, settings: kept, tab },
    },
  };
};

/** The page at the window's address, following it as the shell does. */
const Routed = ({ behaviors, edition }: { behaviors: ProjectsBehaviors; edition: OpenFilesEdition }): ReactElement => (
  <ProjectsPage route={useRoute()} behaviors={behaviors} openFiles={edition} />
);

const open = (hash: string, options: Parameters<typeof setup>[0] = {}, edition: OpenFilesEdition = 'edit') => {
  window.location.hash = hash;
  const made = setup(options);
  render(<Routed behaviors={made.behaviors} edition={edition} />);
  return made;
};

const connected = () =>
  waitFor(() => expect(document.querySelector('.kit-projects')?.getAttribute('data-connection')).toBe('ready'));

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('the «Files» group', () => {
  it('is not there with nothing listed and nothing ever opened', async () => {
    const { sent } = open('#/projects');
    await connected();
    await waitFor(() => expect(sent('openFile.list')).toHaveLength(1));
    expect(screen.queryByRole('region', { name: 'Files' })).toBeNull();
    // The page told the companion it is there.
    await waitFor(() => expect(sent('page.activity').length).toBeGreaterThan(0));
  });

  it('a companion without the methods: no group, and not one of their requests sent', async () => {
    const { sent } = open('#/projects', { openFiles: false });
    await connected();
    await screen.findByRole('region', { name: 'Scratches' });
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(screen.queryByRole('region', { name: 'Files' })).toBeNull();
    for (const method of ['openFile.list', 'openFile.pending', 'page.activity']) expect(sent(method)).toEqual([]);
  });

  it('lists the files with their place and marks; Forget removes one; the settings and, in Pro, the command', async () => {
    const made = setup();
    made.fake.companion.offerFile({ name: 'todo.md', displayPath: '~/notes/todo.md', claimed: true });
    made.fake.companion.offerFile({ name: '.zshrc', displayPath: '~/.zshrc', executes: true, claimed: true });
    made.fake.companion.offerFile({
      name: 'id_ed25519',
      displayPath: '~/.ssh/id_ed25519',
      reason: 'secret',
      claimed: true,
    });
    window.location.hash = '#/projects';
    render(<Routed behaviors={made.behaviors} edition="edit" />);
    const group = await screen.findByRole('region', { name: 'Files' });
    const items = await within(group).findAllByRole('listitem');
    expect(items.map(i => i.textContent)).toEqual([
      expect.stringContaining('id_ed25519~/.ssh/id_ed25519read only'),
      expect.stringContaining('.zshrc~/.zshrcruns on its own'),
      expect.stringContaining('todo.md~/notes/todo.md'),
    ]);
    expect(within(group).getByText('devtab open <file>')).toBeTruthy();
    expect(within(group).getByRole('checkbox', { name: 'Open it in this tab' }).getAttribute('data-state')).toBe(
      'checked',
    );
    fireEvent.click(within(group).getByRole('checkbox', { name: 'Bring this window to the front' }));
    expect(made.settings.kept.bringForward).toBe(false);
    await act(async () => {
      fireEvent.click(within(group).getByRole('button', { name: 'Forget todo.md' }));
    });
    // Asked first, saying that the companion's copies go too.
    const dialog = await screen.findByRole('dialog', { name: 'Forget todo.md?' });
    expect(dialog.textContent).toContain('the companion deletes the copies it kept of it');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Forget' }));
    });
    await waitFor(() => expect(within(group).getAllByRole('listitem')).toHaveLength(2));
  });

  it('the free edition names no command; something opened before keeps the group with an empty list', async () => {
    open('#/projects', { settings: { opened: true } }, 'read');
    const group = await screen.findByRole('region', { name: 'Files' });
    expect(within(group).getByText('No files are open.')).toBeTruthy();
    expect(within(group).queryByText('devtab open <file>')).toBeNull();
  });
});

describe('a file arriving', () => {
  it('by the event: claimed, opened on its own address, the tab brought forward; editable in Pro', async () => {
    const editor = fakeEditor();
    const made = open('#/projects');
    await connected();
    const { token } = made.fake.companion.offerFile({ name: 'todo.md', text: 'one\n', line: 1 });
    made.fake.emit('open.requested', null, { token });
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/projects\/files\/f_/));
    await screen.findByRole('heading', { name: 'todo.md', level: 1 });
    expect(made.tab.bringForward).toHaveBeenCalled();
    expect(made.settings.kept.opened).toBe(true);
    await editor.attach();
    await waitFor(() =>
      expect(editor.last('viewer/show-file')?.request).toMatchObject({ text: 'one\n', readOnly: false }),
    );
    expect(editor.last('viewer/reveal-line')).toEqual({ type: 'viewer/reveal-line', line: 1 });
    editor.type('two\n');
    await waitFor(() => expect(made.sent('openFile.save')).toHaveLength(1));
    expect(made.sent('openFile.save')[0]!.params).toMatchObject({ text: 'two\n' });
    await screen.findByText('Saved');
  });

  it('a file changed on disk under an edit: the conflict and «Keep mine», as for a project’s file', async () => {
    const editor = fakeEditor();
    const made = open('#/projects');
    await connected();
    const { token, file } = made.fake.companion.offerFile({ name: 'todo.md', text: 'one\n' });
    made.fake.emit('open.requested', null, { token });
    await screen.findByRole('heading', { name: 'todo.md', level: 1 });
    await editor.attach();
    await waitFor(() => expect(editor.last('viewer/show-file')).toBeTruthy());
    made.fake.companion.changeOpenedOnDisk(file!, 'theirs\n');
    editor.type('mine\n');
    const conflict = await screen.findByRole('alert');
    expect(conflict.textContent).toContain('The file changed on disk while you were editing it.');
    await act(async () => {
      fireEvent.click(within(conflict).getByRole('button', { name: 'Keep mine' }));
    });
    await screen.findByText('Saved');
    expect(made.fake.companion.opened.files.get(file!)!.text).toBe('mine\n');
  });

  it('a file replaced since it was opened: the save refused, read only from then on, the edit kept for a scratch', async () => {
    const editor = fakeEditor();
    const made = open('#/projects');
    await connected();
    const { token, file } = made.fake.companion.offerFile({ name: 'todo.md', text: 'one\n' });
    made.fake.emit('open.requested', null, { token });
    await screen.findByRole('heading', { name: 'todo.md', level: 1 });
    await editor.attach();
    await waitFor(() => expect(editor.last('viewer/show-file')).toBeTruthy());
    made.fake.companion.replaceOpened(file!);
    editor.type('mine\n');
    const note = await screen.findByText(/^Read only: the file was replaced, moved or became a link/);
    expect(note.getAttribute('role')).toBe('note');
    await waitFor(() =>
      expect(editor.last('viewer/set-editable')).toEqual({
        type: 'viewer/set-editable',
        side: 'new',
        editable: false,
        focus: false,
      }),
    );
    expect(screen.getByRole('button', { name: 'Copy to a scratch' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    const saves = made.sent('openFile.save').length;
    editor.type('more\n');
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(made.sent('openFile.save')).toHaveLength(saves);
  });

  it('by the address: the token leaves the address before anything else and is redeemed once', async () => {
    const editor = fakeEditor();
    const made = setup();
    const { token } = made.fake.companion.offerFile({ token: TOKEN, name: 'notes.txt', line: 3, column: 2 });
    window.location.hash = `#/projects/open/${token}`;
    render(<Routed behaviors={made.behaviors} edition="edit" />);
    expect(window.location.hash).not.toContain(token);
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/projects\/files\/f_/));
    await screen.findByRole('heading', { name: 'notes.txt', level: 1 });
    expect(made.sent('openFile.claim').map(f => f.params.token)).toEqual([token]);
    // A tab the companion opened for the file is in front already.
    expect(made.tab.bringForward).not.toHaveBeenCalled();
    await editor.attach();
    await waitFor(() =>
      expect(editor.last('viewer/reveal-line')).toEqual({ type: 'viewer/reveal-line', line: 3, column: 2 }),
    );
  });

  it('a file inside an added project opens as that project’s file', async () => {
    const made = open('#/projects');
    await connected();
    const { token } = made.fake.companion.offerFile({ project: 'p_abcdefgh23', path: 'src/app.txt' });
    made.fake.emit('open.requested', null, { token });
    await waitFor(() => expect(window.location.hash).toBe('#/projects/p_abcdefgh23/src%2Fapp.txt'));
  });

  it('an expired token: one sentence, nothing opened', async () => {
    const made = setup();
    made.fake.companion.offerFile({ token: TOKEN });
    made.fake.companion.expireTokens();
    window.location.hash = `#/projects/open/${TOKEN}`;
    render(<Routed behaviors={made.behaviors} edition="edit" />);
    await screen.findByText(
      'The link to this file has expired or was already used. Open the file again from your computer.',
    );
    expect(window.location.hash).toBe('#/projects');
  });

  it('without the permission the file waits beside «Connect the companion»; nothing is sent', async () => {
    const made = open(`#/projects/open/${TOKEN}`, { held: false });
    await screen.findByText('A file waits to open here. Connect the companion to open it.');
    expect(screen.getByRole('button', { name: 'Connect the companion' })).toBeTruthy();
    expect(window.location.hash).toBe('#/projects');
    expect(made.fake.ports).toHaveLength(0);
  });

  it('a companion without the methods: one sentence, no claim sent', async () => {
    const made = open(`#/projects/open/${TOKEN}`, { openFiles: false });
    await screen.findByText('This companion cannot open files from your computer yet.');
    expect(made.sent('openFile.claim')).toEqual([]);
  });

  it('with «Open it in this tab» off the event goes to a new tab of the page, which claims it there', async () => {
    const made = open('#/projects', { settings: { reuseTab: false } });
    await connected();
    const { token } = made.fake.companion.offerFile({});
    made.fake.emit('open.requested', null, { token });
    await waitFor(() => expect(made.tab.openTab).toHaveBeenCalledWith(`#/projects/open/${token}`));
    expect(made.sent('openFile.claim')).toEqual([]);
  });

  it('files that waited before the page connected are claimed on connecting', async () => {
    const made = setup();
    made.fake.companion.offerFile({ name: 'waited.md' });
    window.location.hash = '#/projects';
    render(<Routed behaviors={made.behaviors} edition="edit" />);
    await screen.findByRole('heading', { name: 'waited.md', level: 1 });
    expect(made.tab.bringForward).toHaveBeenCalled();
  });
});

describe('the free edition', () => {
  it('opens the file read only, with one quiet line and «Copy to a scratch» — the scratch has the text', async () => {
    const editor = fakeEditor();
    const made = open('#/projects', {}, 'read');
    await connected();
    const { token } = made.fake.companion.offerFile({ name: 'todo.md', text: '# Todo\n' });
    made.fake.emit('open.requested', null, { token });
    await screen.findByRole('heading', { name: 'todo.md', level: 1 });
    await editor.attach();
    await waitFor(() => expect(editor.last('viewer/show-file')?.request.readOnly).toBe(true));
    expect(screen.getByRole('note').textContent).toBe('Editing files opened from your computer is part of Pro.');
    expect(screen.queryByText('Saved')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy to a scratch' }));
    });
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/projects\/scratches\//));
    const { scratches } = await made.scratches.list();
    expect(scratches.map(s => [s.name, s.language])).toEqual([['todo', 'markdown']]);
    expect(await made.scratches.read(scratches[0]!.id)).toBe('# Todo\n');
    expect(made.sent('openFile.save')).toEqual([]);
  });
});
