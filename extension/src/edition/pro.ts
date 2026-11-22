/**
 * `Edition`: Pro (D21) — the tools' parameters are kept in the browser's storage with the other per-tool settings
 * (chrome.storage.local, `toolSettings.params`), so a tool opens with what the person chose last time; a tool's page
 * offers "Reset settings" while they differ from its defaults. Another storage for Pro (a remote one) is the line
 * `parameters` changed (docs/tools/settings-storage.md §7).
 */
import { localParameterStorage } from '../tools/settings';
import type { Edition } from './edition';

export const pro: Edition = {
  id: 'pro',
  parameters: localParameterStorage,
};
