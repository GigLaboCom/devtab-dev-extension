/**
 * The editor's settings on the page (D39): a scratch opens with what applies to its text (the language's built-in row,
 * the detected indentation), the indent indicator says it and where it came from, a choice there wins for the file and
 * goes back to automatic, a change in the store reaches the open editor without a reload; and Settings → Editor writes
 * the store (general values, a language's row added, changed and reset). The editor page in the iframe is played by a
 * fake that records what the section posts.
 */
import { SidePanels } from '../projects/SidePanels';
import { parseRoute } from '../route';
import { ProjectsPage } from '../sections/ProjectsPage';
import { EditorSettingsGroup } from '../settings/EditorSettingsGroup';
import { countingDetector } from '@src/editorSettings/detect';
import { BUILT_IN_VALUES, defaultEditorSettings } from '@src/editorSettings/model';
import { memoryEditorArea, memoryEditorSettings } from '@src/editorSettings/storage';
import { demoBackend } from '@src/projects/demo/backend';
import { memoryLayout } from '@src/projects/layoutMemory';
import { projectSaver } from '@src/projects/projectSaver';
import { recordingSaver } from '@src/projects/scratch/fakeSaver';
import { areaScratches, memoryArea } from '@src/projects/scratch/storage';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EditorSettingsBehaviors } from '@src/editorSettings/behaviors';
import type { ProjectsBehaviors } from '@src/projects/behaviors';
import type { ScratchStore } from '@src/projects/scratch/store';
import type { ToViewer } from '@src/shared/viewerProtocol';

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

/** The editor page, played: it records what the section posts and answers requests as the real one does. */
const fakeEditor = () => {
  const inbox: ToViewer[] = [];
  let frame: HTMLIFrameElement | null = null;
  const send = (data: unknown): void => {
    window.dispatchEvent(new MessageEvent('message', { data, origin: location.origin, source: frame!.contentWindow }));
  };
  const side = { editable: false, modified: false, empty: false };
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
        if ('id' in message && message.type !== 'viewer/read')
          queueMicrotask(() =>
            send({
              type: 'viewer/shown',
              id: message.id,
              shown: {
                path: '',
                changes: 0,
                added: 0,
                removed: 0,
                lineDiffer: null,
                compareMs: null,
                updateMs: null,
                cause: 'request',
                sides: { old: side, new: side },
                mode: 'file',
              },
            }),
          );
      }) as Window['postMessage'];
      act(() => send({ type: 'viewer/ready' }));
    },
    all: <T extends ToViewer['type']>(type: T) =>
      inbox.filter((m): m is Extract<ToViewer, { type: T }> => m.type === type),
  };
};

let scratches: ScratchStore;
let settings: EditorSettingsBehaviors;
const projects = (): ProjectsBehaviors => ({
  backend: Object.assign(() => demoBackend({ wait: () => Promise.resolve() }), { id: 'demo' }),
  autosaveDelayMs: 20,
  layout: SidePanels,
  layoutMemory: memoryLayout(),
  scratchStore: scratches,
  scratchSaver: recordingSaver(),
  fileSaver: projectSaver,
});

const openScratch = async (language: string, text: string) => {
  const made = await scratches.create(language);
  if (!made.ok) throw new Error('not created');
  await scratches.write(made.value.id, text);
  window.location.hash = `#/projects/scratches/${made.value.id}`;
  render(<ProjectsPage route={parseRoute(window.location.hash)} behaviors={projects()} editorSettings={settings} />);
  const editor = fakeEditor();
  await editor.attach();
  const opened = await waitFor(() => {
    const message = editor.all('viewer/show-file').at(-1);
    if (!message) throw new Error('not opened yet');
    return message;
  });
  return { editor, opened };
};

const indicator = () => screen.findByRole('button', { name: /^Indentation:/ });

beforeEach(() => {
  scratches = areaScratches(memoryArea(), { id: 'test', keeps: true });
  settings = { store: memoryEditorSettings(memoryEditorArea()), detector: countingDetector };
});
afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('an open scratch with the editor’s settings', () => {
  it('a Go scratch opens with tabs — the language’s built-in row — and the indicator says so', async () => {
    const { opened } = await openScratch('go', 'package main\n');
    expect(opened.request.editor).toEqual({
      indentStyle: 'tab',
      indentSize: 4,
      softWrap: false,
      whitespace: false,
      indentGuides: true,
      lineNumbers: true,
      fontSize: null,
    });
    const button = await indicator();
    expect(button.textContent).toBe('Tab: 4Go');
    expect(button.dataset.source).toBe('language');
  });

  it('a YAML scratch indented by 4 is detected as 4, over YAML’s 2', async () => {
    const text = 'a:\n    b: 1\n    c:\n        d: 2\n    e: 3\n    f: 4\n    g: 5\n';
    const { opened } = await openScratch('yaml', text);
    expect([opened.request.editor?.indentStyle, opened.request.editor?.indentSize]).toEqual(['space', 4]);
    const button = await indicator();
    expect(button.textContent).toBe('Spaces: 4detected');
    // With too few indented lines, YAML’s own 2.
    cleanup();
    const short = await openScratch('yaml', 'a:\n  b: 1\n');
    expect(short.opened.request.editor?.indentSize).toBe(2);
  });

  it('a change in Settings reaches the open editor at once, without a reload', async () => {
    const { editor } = await openScratch('rust', 'fn main() {}\n');
    const before = editor.all('viewer/set-editor-settings').length;
    await act(async () => {
      await settings.store.save({
        ...defaultEditorSettings(),
        base: { ...BUILT_IN_VALUES, indentSize: 2, whitespace: true },
      });
    });
    await waitFor(() => {
      const sent = editor.all('viewer/set-editor-settings').slice(before);
      expect(sent.map(m => m.side).sort()).toEqual(['new', 'old']);
      expect(sent.every(m => m.settings.indentSize === 2 && m.settings.whitespace === true)).toBe(true);
    });
    expect((await indicator()).textContent).toBe('Spaces: 2default');
  });

  it('a choice in the indicator wins for this file, and goes back to automatic', async () => {
    const { editor } = await openScratch('go', 'package main\n');
    fireEvent.click(await indicator());
    const popup = await screen.findByRole('dialog', { name: 'Indentation of this file' });
    expect(within(popup).getByText('Go’s value in Settings → Editor.')).toBeTruthy();
    const before = editor.all('viewer/set-editor-settings').length;
    fireEvent.click(within(popup).getByRole('radio', { name: 'Spaces' }));
    await waitFor(() => {
      const sent = editor.all('viewer/set-editor-settings').slice(before);
      expect(sent.some(m => m.settings.indentStyle === 'space')).toBe(true);
    });
    fireEvent.click(within(popup).getByRole('radio', { name: '2' }));
    await waitFor(async () => expect((await indicator()).textContent).toBe('Spaces: 2this file'));
    fireEvent.click(within(popup).getByRole('button', { name: 'Back to automatic' }));
    await waitFor(async () => expect((await indicator()).textContent).toBe('Tab: 4Go'));
    expect(editor.all('viewer/set-editor-settings').at(-1)?.settings).toMatchObject({
      indentStyle: 'tab',
      indentSize: 4,
    });
  });

  it('without the settings the scratch opens as before: no values, no indicator', async () => {
    const made = await scratches.create('go');
    if (!made.ok) throw new Error('not created');
    window.location.hash = `#/projects/scratches/${made.value.id}`;
    render(<ProjectsPage route={parseRoute(window.location.hash)} behaviors={projects()} />);
    const editor = fakeEditor();
    await editor.attach();
    await waitFor(() => expect(editor.all('viewer/show-file')).toHaveLength(1));
    expect(editor.all('viewer/show-file')[0]?.request.editor).toBeUndefined();
    expect(editor.all('viewer/set-editor-settings')).toEqual([]);
    expect(screen.queryByRole('button', { name: /^Indentation:/ })).toBeNull();
  });
});

describe('Settings → Editor', () => {
  const choose = async (field: string, option: string): Promise<void> => {
    await act(async () => {
      fireEvent.click(screen.getByRole('combobox', { name: field }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole('option', { name: option }));
    });
  };

  it('writes the general values and the languages’ rows; a row resets to its built-in values', async () => {
    render(<EditorSettingsGroup behaviors={settings} />);
    await screen.findByRole('heading', { name: 'Editor', level: 2 });
    // The built-in rows are there, pre-filled.
    const rows = () => [...document.querySelectorAll<HTMLElement>('[data-language]')].map(r => r.dataset.language);
    expect(rows()).toEqual(['go', 'markdown', 'text', 'ruby', 'yaml']);
    fireEvent.click(screen.getByRole('radio', { name: 'Tabs' }));
    await waitFor(async () => expect((await settings.store.load()).base.indentStyle).toBe('tab'));
    await choose('Indent size', '2');
    await waitFor(async () => expect((await settings.store.load()).base.indentSize).toBe(2));
    fireEvent.click(screen.getByRole('switch', { name: 'Show spaces and tabs' }));
    await waitFor(async () => expect((await settings.store.load()).base.whitespace).toBe(true));
    // A language added, then given a size.
    await choose('Add a language', 'Python');
    await waitFor(() => expect(rows()).toContain('python'));
    await choose('Size for Python', '8');
    await waitFor(async () => expect((await settings.store.load()).languages.python).toEqual({ indentSize: 8 }));
    // Go changed, then reset to its built-in row.
    await choose('Indent for Go', 'Spaces');
    await waitFor(async () => expect((await settings.store.load()).languages.go).toEqual({ indentStyle: 'space' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset Go' }));
    await waitFor(async () => expect((await settings.store.load()).languages.go).toEqual({ indentStyle: 'tab' }));
    // Everything back.
    fireEvent.click(screen.getByRole('button', { name: 'Reset editor settings' }));
    await waitFor(async () => expect(await settings.store.load()).toEqual(defaultEditorSettings()));
  });

  it('a refused write is said in one line and the page shows what is stored', async () => {
    let full = false;
    const area = memoryEditorArea(() => (full ? new Error('QUOTA_BYTES quota exceeded') : null));
    const refusing: EditorSettingsBehaviors = { store: memoryEditorSettings(area), detector: countingDetector };
    render(<EditorSettingsGroup behaviors={refusing} />);
    await screen.findByRole('heading', { name: 'Editor', level: 2 });
    full = true;
    fireEvent.click(screen.getByRole('radio', { name: 'Tabs' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Not saved: the extension’s storage in this browser is full.',
    );
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Spaces' }).getAttribute('aria-checked')).toBe('true'),
    );
  });
});
