import { extensionToolSettings, TOOL_SETTINGS_KEY } from './settings';
import { fakeStorage } from '@src/test/fakes';
import { toolSettingsContract } from '@workspace/tools-host/settings-contract';
import { describe, expect, it } from 'vitest';

// The same contract as the in-memory store (packages/tools/ui/host/lib/settings.test.ts), over chrome.storage.local
// and its onChanged: every page of the harness is another tab of the extension over one storage.
toolSettingsContract('chrome.storage.local', () => {
  const storage = fakeStorage();
  return {
    page: () => extensionToolSettings(storage.area, storage.onChanged),
    stored: async () => structuredClone(storage.rows.get(TOOL_SETTINGS_KEY)),
    seed: async raw => void storage.rows.set(TOOL_SETTINGS_KEY, raw),
  };
});

describe('the extension’s per-tool settings', () => {
  it('keep one record under its own key next to the other settings, and ignore other keys and areas', async () => {
    const storage = fakeStorage();
    storage.rows.set('historySettings', { v: 1, on: true });
    const page = extensionToolSettings(storage.area, storage.onChanged);
    await page.ready;
    let heard = 0;
    page.subscribe(() => heard++);
    await storage.area.set({ startSettings: { v: 1 } });
    for (const l of storage.listeners)
      l({ [TOOL_SETTINGS_KEY]: { newValue: { v: 1, all: { autoCopy: true } } } }, 'sync');
    expect(heard).toBe(0);
    await page.setForAll(['password', 'uuid'], { autoCopy: true });
    expect([...storage.rows.keys()].sort()).toEqual(['historySettings', 'startSettings', TOOL_SETTINGS_KEY]);
    expect(storage.rows.get('historySettings')).toEqual({ v: 1, on: true });
  });
});
