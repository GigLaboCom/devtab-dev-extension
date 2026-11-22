/**
 * The tools' per-tool settings in this host (`ToolHost.settings`, @workspace/tools-host): one record in
 * chrome.storage.local next to the other settings, under `toolSettings` — `{ v: 1, all: {…}, tools: { <id>: {…} } }`
 * — followed live by every open page through storage.onChanged. A tool reads only its own entry and never sees
 * storage; Settings → Tools sets one value for all the tools it applies to (`setForAll`). The first setting is
 * "Copy automatically after generating" (`autoCopy`, for the tools whose definition says `output.origin: 'generated'`).
 *
 * The same record keeps the tools' saved parameters (D21, docs/tools/settings.md): `params: { <id>: { schema, values } }`
 * — when the edition keeps them in storage (src/edition: Pro). The free edition gives the store an area in the page's
 * memory for them instead (`parameters`), so nothing of them reaches chrome.storage.
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

/** `parameters`: where the tools' saved parameters go, given this record's area (the edition's choice); by default here. */
export const extensionToolSettings = (
  area: SettingsArea,
  onChanged: SettingsChanged,
  parameters: (settings: ToolSettingsArea) => ToolSettingsArea = settings => settings,
): ToolSettingsStore => {
  const settings = chromeToolSettingsArea(area, onChanged);
  return createToolSettings(settings, parameters(settings));
};
