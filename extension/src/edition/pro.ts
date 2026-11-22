/**
 * `Edition`: Pro (D21) — the tools' parameters are kept with the other per-tool settings (chrome.storage.local,
 * `toolSettings.params`), so a tool opens with what the person chose last time; a tool's page offers "Reset settings"
 * while they differ from its defaults.
 */
import type { Edition } from './edition';

export const pro: Edition = {
  id: 'pro',
  pro: true,
  parameters: settings => settings,
};
