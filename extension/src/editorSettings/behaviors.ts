/**
 * The composition root of the editor's settings (D39; AGENTS.md, "Replaceable Behavior"; research §4.8): the one place
 * that names the implementation behind each of their seams. The shell makes one for the page (src/app/Shell.tsx) and
 * hands it to every place with an editor — «Compare code», the Projects section (project files and scratch files) —
 * and to Settings → Editor; they receive `EditorSettingsBehaviors` and never import an implementation.
 *
 *   EditorSettingsStore  where the Default set is kept (./store.ts): chrome.storage.local, record `editorSettings`
 *                        (./storage.ts); the page's memory where the page has no extension storage
 *   IndentDetector       the indentation a text already uses (./detect.ts): counting lines as VS Code does
 *
 * Stage 2 adds the profiles (`EditorProfilesStore`, Pro) and stage 3 the project's settings (`ProjectEditorSettings`,
 * `.editorconfig`, Pro): both are named by the edition (src/edition/edition.ts), not here, and plug into the levels of
 * ./resolve.ts that wait for them (`profile`, `project`).
 */
import { countingDetector } from './detect';
import { chromeEditorSettings } from './storage';
import type { IndentDetector } from './detect';
import type { EditorSettingsStore } from './store';

export interface EditorSettingsBehaviors {
  /** Where the Default set is kept. */
  store: EditorSettingsStore;
  /** The indentation a text already uses. */
  detector: IndentDetector;
}

export const editorSettingsBehaviors = (): EditorSettingsBehaviors => ({
  store: chromeEditorSettings(),
  detector: countingDetector,
});
