/**
 * Profiles and a project's `.editorconfig` on the page (D39 stages 2 and 3), in both editions: Settings → Editor makes,
 * chooses, renames, duplicates, deletes, exports and imports profiles (a hostile file refused in one line), and an open
 * editor follows the profile in force at once; a demo project's file with an `.editorconfig` opens with its values, the
 * indicator says "EditorConfig" and which file decided, a choice there still wins, an edit of the `.editorconfig` on
 * disk reaches the open file, and the project can name a profile of its own. In the free edition: the one quiet line
 * in Settings, the one in a project file's popup, no profile and no `.editorconfig` read at all. The editor page in the
 * iframe is played by a fake that records what the section posts.
 */
import { SidePanels } from '../projects/SidePanels';
import { parseRoute } from '../route';
import { ProjectsPage } from '../sections/ProjectsPage';
import { EditorSettingsGroup } from '../settings/EditorSettingsGroup';
import { countingDetector } from '@src/editorSettings/detect';
import { editorConfigSettings } from '@src/editorSettings/editorconfig/editorConfigReader';
import { BUILT_IN_VALUES, builtInSet } from '@src/editorSettings/model';
import { DEFAULT_PROFILE, createProfile, emptyEditorProfiles } from '@src/editorSettings/profiles';
import { EDITOR_PROFILES_KEY, areaEditorProfiles, noEditorProfiles } from '@src/editorSettings/profilesStore';
import { noProjectEditorSettings } from '@src/editorSettings/project';
import { memoryEditorArea, memoryEditorSettings } from '@src/editorSettings/storage';
import { demoBackend } from '@src/projects/demo/backend';
import { memoryLayout } from '@src/projects/layoutMemory';
import { projectSaver } from '@src/projects/projectSaver';
import { recordingSaver } from '@src/projects/scratch/fakeSaver';
import { areaScratches, memoryArea } from '@src/projects/scratch/storage';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EditorSettingsBehaviors } from '@src/editorSettings/behaviors';
import type { ProjectEditorSettingsFactory } from '@src/editorSettings/project';
import type { ProjectsBehaviors } from '@src/projects/behaviors';
import type { DemoBackend } from '@src/projects/demo/backend';
import type { ScratchStore } from '@src/projects/scratch/store';
import type { ToViewer } from '@src/shared/viewerProtocol';

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

const GARDEN = 'p_demo0garden';
const EDITORCONFIG_RE = /(^|\/)\.editorconfig$/;

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
let backend: DemoBackend | null;
/** Every path the demo was asked to read. */
let reads: string[];
const projects = (): ProjectsBehaviors => ({
  backend: Object.assign(
    () => {
      const made = demoBackend({ wait: () => Promise.resolve() });
      const call = made.call.bind(made);
      made.call = ((method, params, options) => {
        if (method === 'file.read') reads.push((params as { path: string }).path);
        return call(method, params, options);
      }) as typeof made.call;
      backend = made;
      return made;
    },
    { id: 'demo' },
  ),
  autosaveDelayMs: 20,
  layout: SidePanels,
  layoutMemory: memoryLayout(),
  scratchStore: scratches,
  scratchSaver: recordingSaver(),
  fileSaver: projectSaver,
});

const behaviorsOf = (
  edition: 'pro' | 'free',
  profilesArea = memoryEditorArea(),
  projectSettings: ProjectEditorSettingsFactory = editorConfigSettings,
): EditorSettingsBehaviors => ({
  store: memoryEditorSettings(memoryEditorArea()),
  detector: countingDetector,
  profiles: edition === 'pro' ? areaEditorProfiles(profilesArea, { id: 'test', keeps: true }) : noEditorProfiles,
  projectSettings: edition === 'pro' ? projectSettings : noProjectEditorSettings,
});

const indicator = () => screen.findByRole('button', { name: /^Indentation:/ });
const openPopup = async () => {
  fireEvent.click(await indicator());
  return screen.findByRole('dialog', { name: 'Indentation of this file' });
};

const openProjectFile = async (behaviors: EditorSettingsBehaviors, path: string, project = GARDEN) => {
  window.location.hash = `#/projects/${project}/${path}`;
  render(<ProjectsPage route={parseRoute(window.location.hash)} behaviors={projects()} editorSettings={behaviors} />);
  const editor = fakeEditor();
  await editor.attach();
  const opened = await waitFor(() => {
    const message = editor.all('viewer/show-file').find(m => m.request.path === path);
    if (!message) throw new Error('not opened yet');
    return message;
  });
  return { editor, opened };
};

const openScratch = async (behaviors: EditorSettingsBehaviors, language: string, text: string) => {
  const made = await scratches.create(language);
  if (!made.ok) throw new Error('not created');
  await scratches.write(made.value.id, text);
  window.location.hash = `#/projects/scratches/${made.value.id}`;
  render(<ProjectsPage route={parseRoute(window.location.hash)} behaviors={projects()} editorSettings={behaviors} />);
  const editor = fakeEditor();
  await editor.attach();
  await waitFor(() => expect(editor.all('viewer/show-file')).toHaveLength(1));
  return editor;
};

beforeEach(() => {
  scratches = areaScratches(memoryArea(), { id: 'test', keeps: true });
  backend = null;
  reads = [];
});
afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('a project’s .editorconfig (Pro)', () => {
  it('a demo project’s file opens with its values; the indicator says EditorConfig and which file decided', async () => {
    const { opened } = await openProjectFile(behaviorsOf('pro'), 'Cargo.toml');
    expect([opened.request.editor?.indentStyle, opened.request.editor?.indentSize]).toEqual(['space', 2]);
    const button = await indicator();
    expect(button.textContent).toBe('Spaces: 2EditorConfig');
    expect(button.dataset.source).toBe('project');
    const popup = await openPopup();
    expect(within(popup).getByText('Set by .editorconfig.')).toBeTruthy();
    expect(popup.querySelector('[data-project-note]')).toBeNull();
    expect(reads.filter(p => EDITORCONFIG_RE.test(p))).toEqual(['.editorconfig']);
  });

  it('a choice in the indicator still wins; back to automatic, EditorConfig again', async () => {
    const { editor } = await openProjectFile(behaviorsOf('pro'), 'src/main.rs');
    expect((await indicator()).textContent).toBe('Spaces: 4EditorConfig');
    const popup = await openPopup();
    fireEvent.click(within(popup).getByRole('radio', { name: '8' }));
    await waitFor(async () => expect((await indicator()).textContent).toBe('Spaces: 8this file'));
    expect(editor.all('viewer/set-editor-settings').at(-1)?.settings.indentSize).toBe(8);
    fireEvent.click(within(popup).getByRole('button', { name: 'Back to automatic' }));
    await waitFor(async () => expect((await indicator()).textContent).toBe('Spaces: 4EditorConfig'));
  });

  it('the .editorconfig changed on disk (the files.changed event): the open file takes the new values at once', async () => {
    const { editor } = await openProjectFile(behaviorsOf('pro'), 'Cargo.toml');
    await waitFor(async () => expect((await indicator()).textContent).toBe('Spaces: 2EditorConfig'));
    const before = editor.all('viewer/set-editor-settings').length;
    act(() =>
      backend!.controls.changeOnDisk(
        GARDEN,
        '.editorconfig',
        'root = true\n[*.toml]\nindent_style = tab\ntab_width = 3\n',
      ),
    );
    await waitFor(async () => expect((await indicator()).textContent).toBe('Tab: 3EditorConfig'));
    expect(editor.all('viewer/set-editor-settings').slice(before).at(-1)?.settings).toMatchObject({
      indentStyle: 'tab',
      indentSize: 3,
    });
    // Read again once: the cache was dropped by the event, not by the reopening.
    expect(reads.filter(p => EDITORCONFIG_RE.test(p))).toEqual(['.editorconfig', '.editorconfig']);
  });

  it('a file over the limits: no project settings, and one quiet line in the popup — never an error', async () => {
    const { opened } = await openProjectFile(behaviorsOf('pro'), 'Cargo.toml');
    expect(opened.request.editor?.indentSize).toBe(2);
    act(() => backend!.controls.changeOnDisk(GARDEN, '.editorconfig', '[x]\n'.repeat(1001)));
    await waitFor(async () => expect((await indicator()).dataset.source).not.toBe('project'));
    const popup = await openPopup();
    expect(popup.querySelector('[data-project-note="problem"]')?.textContent).toBe(
      '.editorconfig is over the limits read here, so the project’s settings are not used.',
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('the project names a profile of its own in the popup; its files follow it, the active one stays', async () => {
    const area = memoryEditorArea();
    const made = createProfile(
      emptyEditorProfiles(),
      'Narrow',
      { ...builtInSet(), base: { ...BUILT_IN_VALUES, indentSize: 3 } },
      'ep_narrow0001',
    );
    if (!made.ok) throw new Error('not made');
    area.rows.set(EDITOR_PROFILES_KEY, { ...made.record, active: DEFAULT_PROFILE });
    const behaviors = behaviorsOf('pro', area, noProjectEditorSettings);
    await openProjectFile(behaviors, 'Cargo.toml');
    await waitFor(async () => expect((await indicator()).textContent).toBe('Spaces: 4default'));
    const popup = await openPopup();
    await act(async () => fireEvent.click(within(popup).getByRole('combobox', { name: 'Profile of this project' })));
    await act(async () => fireEvent.click(await screen.findByRole('option', { name: 'Narrow' })));
    await waitFor(async () => expect((await indicator()).textContent).toBe('Spaces: 3Narrow'));
    const stored = await behaviors.profiles!.load();
    expect(stored.projects).toEqual({ [GARDEN]: 'ep_narrow0001' });
    expect(stored.active).toBe(DEFAULT_PROFILE);
  });
});

describe('profiles in Settings → Editor (Pro)', () => {
  it('make one from the active, switch, rename, duplicate, delete — and an open editor follows each switch at once', async () => {
    const behaviors = behaviorsOf('pro');
    const editor = await openScratch(behaviors, 'rust', 'fn main() {}\n');
    render(<EditorSettingsGroup behaviors={behaviors} />);
    await screen.findByRole('heading', { name: 'Profiles', level: 3 });
    const names = () => [...document.querySelectorAll<HTMLElement>('[data-profile]')].map(r => r.textContent);
    expect(names()).toEqual(['Default']);
    // A new profile from the active one; it becomes the active one.
    fireEvent.change(screen.getByRole('textbox', { name: 'New profile' }), { target: { value: 'Work' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await screen.findByText('Created “Work”.');
    const record = async () => behaviors.profiles!.load();
    const work = (await record()).profiles[0]!;
    expect((await record()).active).toBe(work.id);
    // Its values change, the Default set’s stay; the open editor takes them.
    await act(async () => fireEvent.click(screen.getByRole('combobox', { name: 'Indent size' })));
    await act(async () => fireEvent.click(await screen.findByRole('option', { name: '2' })));
    await waitFor(async () => expect((await record()).profiles[0]?.base.indentSize).toBe(2));
    expect((await behaviors.store.load()).base.indentSize).toBe(4);
    await waitFor(() => expect(editor.all('viewer/set-editor-settings').at(-1)?.settings.indentSize).toBe(2));
    expect((await indicator()).textContent).toBe('Spaces: 2Work');
    // Back to Default: the editor follows at once.
    fireEvent.click(screen.getByRole('radio', { name: 'Use Default' }));
    await waitFor(() => expect(editor.all('viewer/set-editor-settings').at(-1)?.settings.indentSize).toBe(4));
    // Rename, with a refusal first.
    fireEvent.click(screen.getByRole('button', { name: 'Rename Work' }));
    const field = screen.getByRole('textbox', { name: 'New name for Work' });
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: 'default' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Not renamed: there is already a profile named “default”.');
    fireEvent.change(field, { target: { value: 'Office' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(names()).toEqual(['Default', 'Office']));
    // Duplicate, then delete the copy (asked first).
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Office' }));
    await waitFor(() => expect(names()).toEqual(['Default', 'Office', 'Office (2)']));
    expect(screen.queryByRole('button', { name: 'Delete Default' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rename Default' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Office (2)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete the profile “Office (2)”?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(names()).toEqual(['Default', 'Office']));
    await screen.findByText('Deleted “Office (2)”.');
  });

  it('export makes a profile file; import checks it — a hostile file is refused in one line, a good one added', async () => {
    const behaviors = behaviorsOf('pro');
    render(<EditorSettingsGroup behaviors={behaviors} />);
    await screen.findByRole('heading', { name: 'Profiles', level: 3 });
    const saved: string[] = [];
    const create = URL.createObjectURL;
    const click = HTMLAnchorElement.prototype.click;
    const downloads: string[] = [];
    URL.createObjectURL = ((blob: Blob) => (void blob.text().then(t => saved.push(t)), 'blob:test')) as typeof create;
    URL.revokeObjectURL ??= () => undefined;
    // The page has no downloads: the link's name is noted instead.
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    };
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Export Default' }));
      await screen.findByText('Saved as default.editor-profile.json.');
      await waitFor(() => expect(saved).toHaveLength(1));
      expect(downloads).toEqual(['default.editor-profile.json']);
    } finally {
      URL.createObjectURL = create;
      HTMLAnchorElement.prototype.click = click;
    }
    expect(JSON.parse(saved[0]!)).toMatchObject({
      format: 'devtab-editor-profile',
      version: 1,
      profile: { name: 'Default' },
    });
    const input = document.querySelector<HTMLInputElement>('[data-editor-profile-file]')!;
    const give = async (text: string, name = 'p.json') =>
      act(async () => {
        fireEvent.change(input, { target: { files: [new File([text], name, { type: 'application/json' })] } });
        await new Promise(resolve => setTimeout(resolve, 20));
      });
    await give('{"format":"devtab-editor-profile","version":1,"profile":[]}');
    await screen.findByText('Not imported: the file is not an editor profile exported from this extension.');
    await give('<script>alert(1)</script>');
    await screen.findByText('Not imported: the file is not JSON.');
    await give(saved[0]!);
    await screen.findByText('Imported “Default (2)”.');
    const record = await behaviors.profiles!.load();
    expect(record.profiles.map(p => p.name)).toEqual(['Default (2)']);
    expect(record.active).toBe(DEFAULT_PROFILE);
  });
});

describe('the free edition', () => {
  it('Settings → Editor: one quiet line where the profiles would be, nothing else of them; Default as before', async () => {
    const behaviors = behaviorsOf('free');
    render(<EditorSettingsGroup behaviors={behaviors} />);
    await screen.findByRole('heading', { name: 'Editor', level: 2 });
    const line = document.querySelector('[data-editor-profiles]');
    expect(line?.getAttribute('data-editor-profiles')).toBe('excluded');
    expect(line?.textContent).toBe('Profiles are part of Pro.');
    expect(screen.queryByRole('heading', { name: 'Profiles' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Tabs' }));
    await waitFor(async () => expect((await behaviors.store.load()).base.indentStyle).toBe('tab'));
  });

  it('a project file: no .editorconfig is read, the indicator is as before, and its popup says so in one line', async () => {
    const { opened } = await openProjectFile(behaviorsOf('free'), 'Cargo.toml');
    // The line is there for a project whose root, as the Files tree listed it, has an `.editorconfig`.
    await screen.findByRole('treeitem', { name: /\.editorconfig/ });
    expect(opened.request.editor?.indentSize).toBe(4);
    const button = await indicator();
    expect(button.dataset.source).not.toBe('project');
    const popup = await openPopup();
    expect(popup.querySelector('[data-project-note="excluded"]')?.textContent).toBe(
      'Settings from a project’s .editorconfig are part of Pro.',
    );
    expect(within(popup).queryByRole('combobox', { name: 'Profile of this project' })).toBeNull();
    expect(reads.filter(p => EDITORCONFIG_RE.test(p))).toEqual([]);
    expect(reads).toEqual(['Cargo.toml']);
  });

  it('a project without an .editorconfig in its root: nothing about Pro in the popup, and nothing read for it', async () => {
    await openProjectFile(behaviorsOf('free'), 'src/server.ts', 'p_demo0ledgr');
    await screen.findByRole('treeitem', { name: /package\.json/ });
    const popup = await openPopup();
    expect(popup.querySelector('[data-project-note]')).toBeNull();
    expect(popup.textContent).not.toContain('Pro');
    expect(reads).toEqual(['src/server.ts']);
  });

  it('a scratch shows nothing about a project or Pro', async () => {
    await openScratch(behaviorsOf('free'), 'go', 'package main\n');
    const popup = await openPopup();
    expect(popup.querySelector('[data-project-note]')).toBeNull();
  });
});
