/**
 * The tools' per-tool settings in this host (`ToolHost.settings`, @workspace/tools-host): one record in
 * chrome.storage.local next to the other settings, under `toolSettings` — `{ v: 1, all: {…}, tools: { <id>: {…} } }`
 * — followed live by every open page through storage.onChanged. A tool reads only its own entry and never sees
 * storage; Settings → Tools sets one value for all the tools it applies to (`setForAll`). The first setting is
 * "Copy automatically after generating" (`autoCopy`, for the tools whose definition says `output.origin: 'generated'`).
 *
 * A tool's other options (the alphabet of a password, the type of a UUID) would go into the same entry — `forTool(id)
 * .set({ … })` when they change, `useToolSettings` for the defaults when the tool opens — once the owner decides they
 * are remembered (docs/tools/README.md, open question 1).
 */
import { createToolSettings } from '@workspace/tools-host';
import type { ToolSettingsArea, ToolSettingsStore } from '@workspace/tools-host';

/** The parts of chrome.storage it uses. */
export type SettingsArea = Pick<chrome.storage.StorageArea, 'get' | 'set'>;
export type SettingsChanged = Pick<chrome.storage.StorageChangedEvent, 'addListener' | 'removeListener'>;

export const TOOL_SETTINGS_KEY = 'toolSettings';

/** The record's place in chrome.storage.local, and its changes made by any page of the extension. */
export const chromeToolSettingsArea = (area: SettingsArea, onChanged: SettingsChanged): ToolSettingsArea => ({
  read: async () => (await area.get(TOOL_SETTINGS_KEY))[TOOL_SETTINGS_KEY],
  write: record => area.set({ [TOOL_SETTINGS_KEY]: record }),
  watch: listener => {
    const changed = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName === 'local' && TOOL_SETTINGS_KEY in changes) listener(changes[TOOL_SETTINGS_KEY]!.newValue);
    };
    onChanged.addListener(changed);
    return () => onChanged.removeListener(changed);
  },
});

export const extensionToolSettings = (area: SettingsArea, onChanged: SettingsChanged): ToolSettingsStore =>
  createToolSettings(chromeToolSettingsArea(area, onChanged));
