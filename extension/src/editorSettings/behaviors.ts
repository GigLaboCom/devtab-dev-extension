/**
 * The composition root of the editor's settings (D39; AGENTS.md, "Replaceable Behavior"; research §4.8): the one place
 * that names the implementation behind each of their seams. The shell makes one for the page (src/app/Shell.tsx) and
 * hands it to every place with an editor — «Compare code», the Projects section (project files and scratch files) —
 * and to Settings → Editor; they receive `EditorSettingsBehaviors` and never import an implementation.
 *
 *   EditorSettingsStore    where the Default set is kept (./store.ts): chrome.storage.local, record `editorSettings`
 *                          (./storage.ts); the page's memory where the page has no extension storage
 *   IndentDetector         the indentation a text already uses (./detect.ts): counting lines as VS Code does
 *   EditorProfilesStore    where the other profiles are kept (./profilesStore.ts) — the edition's to name
 *                          (src/edition/edition.ts, `editorProfiles`): record `editorProfiles` (Pro), or none (free)
 *   ProjectEditorSettings  what a project says about its files (./project.ts) — the edition's to name
 *                          (`projectEditorSettings`): its `.editorconfig` (Pro), or nothing read (free)
 *
 * The shell passes the edition's two (followed while the page is open: when the edition in force changes, the shell
 * makes the behaviors again with the other edition's, and every editor follows). Absent — a page drawn without an
 * edition, as in older tests — there are no profiles and no project settings, and nothing says so.
 */
import { countingDetector } from './detect';
import { chromeEditorSettings } from './storage';
import type { IndentDetector } from './detect';
import type { EditorProfilesStore } from './profilesStore';
import type { ProjectEditorSettingsFactory } from './project';
import type { EditorSettingsStore } from './store';

export interface EditorSettingsBehaviors {
  /** Where the Default set is kept. */
  store: EditorSettingsStore;
  /** The indentation a text already uses. */
  detector: IndentDetector;
  /** Where the other profiles are kept (the edition's); absent: Default alone. */
  profiles?: EditorProfilesStore;
  /** What a project says about its files (the edition's); absent: nothing. */
  projectSettings?: ProjectEditorSettingsFactory;
}

export const editorSettingsBehaviors = (): EditorSettingsBehaviors => ({
  store: chromeEditorSettings(),
  detector: countingDetector,
});

/** The page's behaviors with what the edition in force names for the profiles and a project's settings. */
export const withEdition = (
  behaviors: EditorSettingsBehaviors,
  edition: { profiles: EditorProfilesStore; projectSettings: ProjectEditorSettingsFactory },
): EditorSettingsBehaviors => ({ ...behaviors, ...edition });
