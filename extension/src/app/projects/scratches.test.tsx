/**
 * Scratch files in the Projects section (D34): the «Scratches» group on the home in every state of the connection;
 * making one in a language; an open scratch in the editor, saving itself, its language changed, renamed, downloaded
 * and deleted; the limits said in one line; what is kept read back by a new page; the edition without scratches. The
 * editor page in the iframe is played by a fake that answers as it does.
 */
import { SidePanels } from './SidePanels';
import { parseRoute } from '../route';
import { ProjectsPage } from '../sections/ProjectsPage';
import { LANGUAGES } from '@src/compare/languages';
import { demoBackend } from '@src/projects/demo/backend';
import { memoryLayout } from '@src/projects/layoutMemory';
import { recordingSaver } from '@src/projects/scratch/fakeSaver';
import { areaScratches, memoryArea } from '@src/projects/scratch/storage';
import { SCRATCH_MAX_CHARS, SCRATCH_MAX_COUNT, compareNames, fileName } from '@src/projects/scratch/store';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProjectsBehaviors } from '@src/projects/behaviors';
import type { ScratchStore } from '@src/projects/scratch/store';
import type { ToViewer } from '@src/shared/viewerProtocol';

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

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
    /** The person typed: the editor holds `next` and reports an edit. */
    type: (next: string) => {
      text = next;
      act(() => send(shown(undefined)));
    },
  };
};

let area: ReturnType<typeof memoryArea>;
let store: ScratchStore;
let saver: ReturnType<typeof recordingSaver>;
const behaviors = (): ProjectsBehaviors => ({
  backend: Object.assign(() => demoBackend({ wait: () => Promise.resolve() }), { id: 'demo' }),
  autosaveDelayMs: 20,
  layout: SidePanels,
  layoutMemory: memoryLayout(),
  scratchStore: store,
  scratchSaver: saver,
});

/** The page at the address the window has now, as the shell renders it. */
const page = (scratches = true) => (
  <ProjectsPage route={parseRoute(window.location.hash)} behaviors={behaviors()} scratches={scratches} />
);
const open = (hash: string, scratches = true) => {
  window.location.hash = hash;
  return render(page(scratches));
};
/** The page follows an address it went to by itself. */
const follow = (rerender: (ui: React.ReactElement) => void): void => rerender(page());

const made = async (language: string, text?: string) => {
  const result = await store.create(language);
  if (!result.ok) throw new Error('not created');
  if (text !== undefined) await store.write(result.value.id, text);
  return result.value;
};

const choose = async (field: string, option: string): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByRole('combobox', { name: field }));
  });
  await act(async () => {
    fireEvent.click(await screen.findByRole('option', { name: option }));
  });
};

beforeEach(() => {
  area = memoryArea();
  store = areaScratches(area, { id: 'test', keeps: true });
  saver = recordingSaver();
});
afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('the Scratches group', () => {
  it('is next to the projects on the section’s home, with the demo shown and no companion', async () => {
    open('#/projects');
    const group = await screen.findByRole('region', { name: 'Scratches' });
    expect(within(group).getByText('No scratches yet.')).toBeTruthy();
    // The projects come first, the scratches next to them.
    await screen.findByRole('heading', { name: 'Projects', level: 2 });
    const parts = [...document.querySelectorAll('.kit-projects-home > section')].map(s =>
      s.getAttribute('aria-labelledby'),
    );
    expect(parts.slice(0, 2)).toEqual(['projects-list-title', 'scratches-title']);
    expect(document.querySelector('.kit-projects')?.getAttribute('data-backend')).toBe('demo');
  });

  it('lists the scratches by name with their language; each opens at its own address', async () => {
    const b = await made('rust');
    await made('python');
    open('#/projects');
    const group = await screen.findByRole('region', { name: 'Scratches' });
    const links = await within(group).findAllByRole('link');
    expect(links.map(l => l.querySelector('.kit-projects-item-name')?.textContent)).toEqual(
      ['scratch.py', 'scratch.rs'].sort(compareNames),
    );
    const rust = links.find(l => l.textContent?.includes('scratch.rs'))!;
    expect(rust.getAttribute('href')).toBe(`#/projects/scratches/${b.id}`);
    expect(rust.textContent).toContain('Rust');
  });

  it('New scratch: the language popup — the last one used offered first and chosen; filter, Enter; opened at once', async () => {
    await made('go');
    const { rerender } = open('#/projects');
    const group = await screen.findByRole('region', { name: 'Scratches' });
    await waitFor(() =>
      expect(within(group).getByRole('button', { name: 'New scratch…' }).hasAttribute('disabled')).toBe(false),
    );
    await act(async () => {
      fireEvent.click(within(group).getByRole('button', { name: 'New scratch…' }));
    });
    const popup = await screen.findByRole('dialog', { name: 'New scratch file' });
    const filter = within(popup).getByRole('combobox', { name: 'Filter languages' });
    expect(document.activeElement).toBe(filter);
    // Every language of the editor, the last one used first and chosen.
    await waitFor(() => expect(within(popup).getAllByRole('option')[0].textContent).toContain('Go'));
    expect(within(popup).getAllByRole('option')).toHaveLength(LANGUAGES.length);
    expect(within(popup).getAllByRole('option')[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.change(filter, { target: { value: 'pyt' } });
    expect(
      within(popup)
        .getAllByRole('option')
        .map(o => o.getAttribute('data-language')),
    ).toEqual(['python']);
    await act(async () => {
      fireEvent.keyDown(filter, { key: 'Enter' });
    });
    const list = await store.list();
    const python = list.scratches.find(s => s.language === 'python')!;
    expect(fileName(python)).toBe('scratch.py');
    expect(window.location.hash).toBe(`#/projects/scratches/${python.id}`);
    follow(rerender);
    const editor = fakeEditor();
    await editor.attach();
    // A scratch just made opens with the keyboard in the editor.
    await waitFor(() => expect(editor.last('viewer/set-editable')).toMatchObject({ editable: true, focus: true }));
    expect(screen.getByRole('heading', { name: 'scratch.py' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'New scratch file' })).toBeNull();
  });

  it('the popup: ↑ / ↓ move the choice, a word or an extension narrows it; Escape closes it, nothing made', async () => {
    open('#/projects');
    const group = await screen.findByRole('region', { name: 'Scratches' });
    const button = await waitFor(() => {
      const found = within(group).getByRole('button', { name: 'New scratch…' });
      if (found.hasAttribute('disabled')) throw new Error('not yet');
      return found;
    });
    button.focus();
    await act(async () => {
      fireEvent.click(button);
    });
    const popup = await screen.findByRole('dialog', { name: 'New scratch file' });
    const filter = within(popup).getByRole('combobox', { name: 'Filter languages' });
    const selected = () =>
      within(popup)
        .getAllByRole('option')
        .find(o => o.getAttribute('aria-selected') === 'true');
    // Nothing made yet: Plain text first, as the store's first language.
    await waitFor(() => expect(selected()?.getAttribute('data-language')).toBe('text'));
    fireEvent.keyDown(filter, { key: 'ArrowDown' });
    expect(filter.getAttribute('aria-activedescendant')).toBe(selected()!.id);
    expect(selected()?.getAttribute('data-language')).toBe(LANGUAGES[1].id);
    fireEvent.keyDown(filter, { key: 'ArrowUp' });
    fireEvent.keyDown(filter, { key: 'ArrowUp' });
    expect(selected()?.getAttribute('data-language')).toBe(LANGUAGES[LANGUAGES.length - 1].id);
    fireEvent.change(filter, { target: { value: 'rs' } });
    expect(selected()?.getAttribute('data-language')).toBe('rust');
    fireEvent.change(filter, { target: { value: 'script' } });
    expect(
      within(popup)
        .getAllByRole('option')
        .map(o => o.getAttribute('data-language')),
    ).toEqual(['javascript', 'typescript']);
    fireEvent.change(filter, { target: { value: 'cobol' } });
    expect(within(popup).getByRole('status').textContent).toBe('No language matches “cobol”.');
    await act(async () => {
      fireEvent.keyDown(filter, { key: 'Escape' });
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New scratch file' })).toBeNull());
    expect((await store.list()).scratches).toHaveLength(0);
    expect(document.activeElement).toBe(button);
  });

  it(`at ${SCRATCH_MAX_COUNT} scratches a new one is refused in one line; deleting one makes room`, async () => {
    for (let i = 0; i < SCRATCH_MAX_COUNT; i++) await made('text');
    open('#/projects');
    const group = await screen.findByRole('region', { name: 'Scratches' });
    await waitFor(() => expect(within(group).getAllByRole('link')).toHaveLength(SCRATCH_MAX_COUNT));
    await act(async () => {
      fireEvent.click(within(group).getByRole('button', { name: 'New scratch…' }));
    });
    const popup = await screen.findByRole('dialog', { name: 'New scratch file' });
    await act(async () => {
      fireEvent.keyDown(within(popup).getByRole('combobox'), { key: 'Enter' });
    });
    expect((await within(popup).findByRole('alert')).textContent).toBe(
      `${SCRATCH_MAX_COUNT} scratches are kept at most. Delete one to make another.`,
    );
    await act(async () => {
      fireEvent.keyDown(within(popup).getByRole('combobox'), { key: 'Escape' });
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New scratch file' })).toBeNull());
    expect((await store.list()).scratches).toHaveLength(SCRATCH_MAX_COUNT);
    // Deleting from the list asks first.
    fireEvent.click(within(group).getByRole('button', { name: 'Delete scratch.txt' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete scratch.txt?' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    });
    await waitFor(() => expect(within(group).getAllByRole('link')).toHaveLength(SCRATCH_MAX_COUNT - 1));
    expect((await store.list()).scratches.some(s => fileName(s) === 'scratch.txt')).toBe(false);
  });

  it('an edition without scratches shows no group and opens no scratch; what was kept stays', async () => {
    const kept = await made('json', '{}');
    open('#/projects', false);
    await screen.findByRole('heading', { name: 'Projects', level: 2 });
    expect(screen.queryByRole('region', { name: 'Scratches' })).toBeNull();
    cleanup();
    open(`#/projects/scratches/${kept.id}`, false);
    await screen.findByRole('heading', { name: 'Projects', level: 1 });
    expect(document.querySelector('iframe.kit-projects-frame')).toBeNull();
    expect(await store.read(kept.id)).toBe('{}');
  });
});

describe('an open scratch', () => {
  it('its text in the editor alone, editable, highlighted by its language; no demo notice, no connection', async () => {
    const s = await made('python', 'print(1)\n');
    open(`#/projects/scratches/${s.id}`);
    const editor = fakeEditor();
    await editor.attach();
    await waitFor(() =>
      expect(editor.last('viewer/show-file')?.request).toEqual({
        path: '',
        language: 'python',
        text: 'print(1)\n',
        readOnly: false,
      }),
    );
    expect(screen.getByRole('heading', { name: 'scratch.py', level: 1 })).toBeTruthy();
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Connect the companion' })).toBeNull();
  });

  it('an edit saves itself after the pause; a new page reads the text and the language back', async () => {
    const s = await made('typescript', 'let a = 1;\n');
    open(`#/projects/scratches/${s.id}`);
    const editor = fakeEditor();
    await editor.attach();
    await waitFor(() => expect(editor.last('viewer/show-file')).toBeTruthy());
    editor.type('let a = 2;\n');
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Edited'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Saved'));
    expect(await store.read(s.id)).toBe('let a = 2;\n');
    expect(editor.last('viewer/mark-saved')?.text).toBe('let a = 2;\n');
    cleanup();
    // A reload: a new store over the same storage, a new page.
    store = areaScratches(area, { id: 'test', keeps: true });
    open(`#/projects/scratches/${s.id}`);
    const again = fakeEditor();
    await again.attach();
    await waitFor(() =>
      expect(again.last('viewer/show-file')?.request).toMatchObject({ language: 'typescript', text: 'let a = 2;\n' }),
    );
  });

  it('leaving the scratch writes what waits, though the editor is gone', async () => {
    const s = await made('text', 'a');
    const { unmount } = open(`#/projects/scratches/${s.id}`);
    const editor = fakeEditor();
    await editor.attach();
    await waitFor(() => expect(editor.last('viewer/show-file')).toBeTruthy());
    editor.type('b');
    // The pause of the typing has been answered (the text read back), then the person leaves before the autosave.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(screen.getByRole('status').textContent).toBe('Edited');
    unmount();
    await waitFor(async () => expect(await store.read(s.id)).toBe('b'));
  });

  it('the language changes at any time: the editor re-highlights the same text, the extension follows', async () => {
    const s = await made('text', 'fn main() {}\n');
    open(`#/projects/scratches/${s.id}`);
    const editor = fakeEditor();
    await editor.attach();
    await waitFor(() => expect(editor.last('viewer/show-file')).toBeTruthy());
    await choose('Language', 'Rust');
    expect(editor.last('viewer/set-language')?.language).toBe('rust');
    expect(editor.inbox.filter(m => m.type === 'viewer/show-file')).toHaveLength(1);
    await screen.findByRole('heading', { name: 'scratch.rs' });
    await waitFor(async () => expect((await store.list()).scratches[0]?.language).toBe('rust'));
    expect(await store.read(s.id)).toBe('fn main() {}\n');
  });

  it('renames in place: Enter keeps, a known extension changes the language, Escape leaves the name', async () => {
    const s = await made('text');
    open(`#/projects/scratches/${s.id}`);
    const editor = fakeEditor();
    await editor.attach();
    fireEvent.click(await screen.findByRole('button', { name: 'Rename…' }));
    const field = screen.getByRole('textbox', { name: 'Scratch name' }) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(field.value).toBe('scratch.txt');
    fireEvent.change(field, { target: { value: 'query.sql' } });
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' });
    });
    await screen.findByRole('heading', { name: 'query.sql' });
    expect(editor.last('viewer/set-language')?.language).toBe('sql');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Rename…' })));
    fireEvent.click(screen.getByRole('button', { name: 'Rename…' }));
    const again = screen.getByRole('textbox', { name: 'Scratch name' });
    fireEvent.change(again, { target: { value: 'nothing' } });
    await act(async () => {
      fireEvent.keyDown(again, { key: 'Escape' });
    });
    expect(screen.getByRole('heading', { name: 'query.sql' })).toBeTruthy();
    expect(fileName((await store.list()).scratches[0]!)).toBe('query.sql');
  });

  it('Download: Save as under the scratch’s file name, with the text the editor holds; a failure is said', async () => {
    const s = await made('json', '{}');
    open(`#/projects/scratches/${s.id}`);
    const editor = fakeEditor();
    await editor.attach();
    await waitFor(() => expect(editor.last('viewer/show-file')).toBeTruthy());
    editor.type('{ "a": 1 }\n');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    });
    expect(saver.requests).toEqual([{ text: '{ "a": 1 }\n', bom: false, suggestedName: 'scratch.json', handle: null }]);
    expect(screen.getByText('Downloaded scratch.json.')).toBeTruthy();
    saver.answer = 'failed';
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    });
    expect(screen.getByText('Not downloaded: the disk is full')).toBeTruthy();
  });

  it('Delete asks first; then the scratch and its text go, and the page goes back to the list', async () => {
    const s = await made('markdown', '# notes\n');
    open(`#/projects/scratches/${s.id}`);
    const editor = fakeEditor();
    await editor.attach();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete scratch.md?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await store.read(s.id)).toBe('# notes\n');
    fireEvent.click(screen.getByRole('button', { name: 'Delete…' }));
    await act(async () => {
      fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    });
    await waitFor(() => expect(window.location.hash).toBe('#/projects'));
    expect(await store.read(s.id)).toBeNull();
    expect(area.rows.has(`scratch:${s.id}`)).toBe(false);
  });

  it(`a text over ${SCRATCH_MAX_CHARS} units is not saved and says so; the stored one stays; shortened, it saves`, async () => {
    const s = await made('text', 'short');
    open(`#/projects/scratches/${s.id}`);
    const editor = fakeEditor();
    await editor.attach();
    await waitFor(() => expect(editor.last('viewer/show-file')).toBeTruthy());
    editor.type('x'.repeat(SCRATCH_MAX_CHARS + 1));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'Not saved: longer than 262,144 characters. Shorten it, or download it to keep it.',
      ),
    );
    expect(screen.getByRole('status').getAttribute('data-state')).toBe('refused');
    expect(await store.read(s.id)).toBe('short');
    editor.type('shorter');
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Saved'));
    expect(await store.read(s.id)).toBe('shorter');
  });

  it('a scratch that is not there says so', async () => {
    open('#/projects/scratches/s_aaaaaaaaaa');
    expect(await screen.findByText('This scratch no longer exists.')).toBeTruthy();
  });
});
