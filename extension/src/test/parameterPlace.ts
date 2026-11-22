/**
 * chrome.storage.local (the fake of ./fakes.ts) as the place the contract suites of seam `ParameterStorage` look at
 * (@workspace/tools-host/parameter-storage-contract): every `open()` is another tab of the extension over one storage,
 * `held` and `seed` read and write the `toolSettings` record past the storage under test, and `refuse` makes
 * chrome.storage reject a write the way a full quota does (with the words Chrome for Testing answered in the e2e,
 * scripts/e2e-tools/saved-settings.mjs).
 */
import { fakeStorage } from './fakes';
import { TOOL_SETTINGS_KEY } from '@src/tools/settings';
import type { BrowserStorage, SettingsArea } from '@src/tools/settings';
import type { ParameterStorage } from '@workspace/tools-host';
import type { ParameterStorageHarness } from '@workspace/tools-host/parameter-storage-contract';

type StoredRecord = { params?: Record<string, unknown> } | undefined;

export const chromePlace = (
  make: (browser: BrowserStorage) => ParameterStorage,
  storage = fakeStorage(),
): ParameterStorageHarness & { storage: ReturnType<typeof fakeStorage>; browser: BrowserStorage } => {
  let refusing = false;
  const area = {
    get: (key: string) => storage.area.get(key),
    set: (items: Record<string, unknown>) =>
      refusing ? Promise.reject(new Error('Resource::kQuotaBytes quota exceeded')) : storage.area.set(items),
  } as unknown as SettingsArea;
  const browser = { area, onChanged: storage.onChanged };
  const record = () => storage.rows.get(TOOL_SETTINGS_KEY) as StoredRecord;
  return {
    storage,
    browser,
    open: () => make(browser),
    held: async toolId => structuredClone(record()?.params?.[toolId]),
    seed: async (toolId, raw) =>
      void storage.rows.set(TOOL_SETTINGS_KEY, {
        v: 1,
        all: {},
        tools: {},
        ...record(),
        params: { ...record()?.params, [toolId]: raw },
      }),
    settle: async () => undefined,
    refuse: on => void (refusing = on),
  };
};
