/**
 * `Edition`: Pro (D21, D24) — the tools' parameters are kept in the browser's storage with the other per-tool settings
 * (chrome.storage.local, `toolSettings.params`), so a tool opens with what the person chose last time, and a tool's page
 * offers "Reset settings" while they differ from its defaults; the tools' work is recorded in the history, in the
 * IndexedDB of the extension's origin (or in the store the host gives instead, when it has no database); "Copy
 * automatically after generating" exists. Another storage for Pro (a remote one) is the line `parameters` changed
 * (docs/tools/settings-storage.md §7).
 */
import { idbStore } from '../history/idbStore';
import { localParameterStorage } from '../tools/settings';
import type { Edition } from './edition';

export const pro: Edition = {
  id: 'pro',
  parameters: localParameterStorage,
  history: place => ({ store: 'store' in place ? place.store : idbStore(place.indexedDB), recording: true }),
  automaticCopying: true,
};
