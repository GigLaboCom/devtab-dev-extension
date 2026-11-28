/**
 * `Edition`: Pro (D21, D24) — the tools' parameters are kept in the browser's storage with the other per-tool settings
 * (chrome.storage.local, `toolSettings.params`), so a tool opens with what the person chose last time, and a tool's page
 * offers "Reset settings" while they differ from its defaults; the tools' work is recorded in the history, in the
 * IndexedDB of the extension's origin (or in the store the host gives instead, when it has no database); "Copy
 * automatically after generating" exists; the editor has profiles, kept in a record of their own in the browser's
 * storage (`editorProfiles`, D39), and a project's `.editorconfig` applies to its files (read through the backend, in
 * a chunk loaded when the first project asks); a file opened from the system is written as the companion's mode for
 * it says (D42). Another storage for Pro (a remote one) is the line `parameters` changed
 * (docs/tools/settings-storage.md §7).
 */
import { areaEditorProfiles } from '../editorSettings/profilesStore';
import { lazyProjectEditorSettings } from '../editorSettings/project';
import { idbStore } from '../history/idbStore';
import { localParameterStorage } from '../tools/settings';
import type { Edition } from './edition';

export const pro: Edition = {
  id: 'pro',
  parameters: localParameterStorage,
  history: place => ({ store: 'store' in place ? place.store : idbStore(place.indexedDB), recording: true }),
  automaticCopying: true,
  // D34: Free or Pro is the owner's decision, not made yet; on in both editions until then.
  scratches: true,
  editorProfiles: browser => areaEditorProfiles(browser),
  projectEditorSettings: lazyProjectEditorSettings('editorconfig', () =>
    import('../editorSettings/editorconfig/editorConfigReader').then(m => m.editorConfigSettings),
  ),
  // D42 (owner's decision): editing a file opened from the system is Pro.
  openFiles: 'edit',
};
