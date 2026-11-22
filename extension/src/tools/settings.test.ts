import { chromeToolSettingsArea, extensionToolSettings, localParameterStorage, TOOL_SETTINGS_KEY } from './settings';
import { fakeStorage } from '@src/test/fakes';
import { chromePlace } from '@src/test/parameterPlace';
import { parameterStorageContract } from '@workspace/tools-host/parameter-storage-contract';
import { toolSettingsContract, toolSettingsHarness } from '@workspace/tools-host/settings-contract';
import { describe, expect, it } from 'vitest';

// Seam `ParameterStorage`, the local implementation: the same contract as the one in memory, the switched-off one and
// the fake remote (packages/tools/ui/host/lib/parameterStorage.test.ts), over chrome.storage.local and its onChanged.
parameterStorageContract('local — chrome.storage.local', () => chromePlace(localParameterStorage));

// The logic's contract (the same as packages/tools/ui/host/lib/settings.test.ts) over the extension's two places in
// one record: every page of the harness is another tab of the extension over one storage.
toolSettingsContract('chrome.storage.local, parameters local', () => {
  const place = chromePlace(localParameterStorage);
  const { storage, browser } = place;
  return toolSettingsHarness(
    {
      area: () => chromeToolSettingsArea(browser.area, browser.onChanged),
      // The settings' part of the record: `params` is the parameter storage's.
      stored: async () => {
        const record = structuredClone(storage.rows.get(TOOL_SETTINGS_KEY)) as Record<string, unknown> | undefined;
        if (record && typeof record === 'object') delete record.params;
        return record;
      },
      seed: async raw => void storage.rows.set(TOOL_SETTINGS_KEY, raw),
    },
    place,
  );
});

describe('the extension’s per-tool settings', () => {
  it('keep one record under its own key next to the other settings, and ignore other keys and areas', async () => {
    const storage = fakeStorage();
    storage.rows.set('historySettings', { v: 1, on: true });
    const page = extensionToolSettings(storage.area, storage.onChanged);
    await page.readyFor('json');
    let heard = 0;
    page.subscribe(() => heard++);
    await storage.area.set({ startSettings: { v: 1 } });
    for (const l of storage.listeners)
      l(
        { [TOOL_SETTINGS_KEY]: { newValue: { v: 1, all: { autoCopy: true }, params: { json: { schema: 1 } } } } },
        'sync',
      );
    expect(heard).toBe(0);
    await page.setForAll(['password', 'uuid'], { autoCopy: true });
    page.forTool('json').save(1, { indent: 4 });
    await page.forTool('json').flush();
    expect([...storage.rows.keys()].sort()).toEqual(['historySettings', 'startSettings', TOOL_SETTINGS_KEY]);
    expect(storage.rows.get('historySettings')).toEqual({ v: 1, on: true });
  });

  it('settings and saved parameters share the record: a write of one carries the other through', async () => {
    const storage = fakeStorage();
    const page = extensionToolSettings(storage.area, storage.onChanged);
    await page.readyFor('password');
    const own = page.forTool('password');
    own.save(1, { length: 24 });
    void own.flush();
    await page.setForAll(['password'], { autoCopy: true });
    own.save(1, { count: 3 });
    await own.flush();
    expect(storage.rows.get(TOOL_SETTINGS_KEY)).toEqual({
      v: 1,
      all: { autoCopy: true },
      tools: { password: { autoCopy: true } },
      params: { password: { schema: 1, values: { length: 24, count: 3 } } },
    });
  });

  it('a full quota: the write is answered `failed` with Chrome’s reason, the page says so and keeps the choice', async () => {
    const place = chromePlace(localParameterStorage);
    const page = extensionToolSettings(place.browser.area, place.browser.onChanged, place.open());
    await page.readyFor('json');
    place.refuse!(true);
    expect(await place.open().write('base64', { schema: 1, values: { alphabet: 'url' } }, undefined)).toEqual({
      status: 'failed',
      reason: 'Resource::kQuotaBytes quota exceeded',
    });
    const own = page.forTool('json');
    own.save(1, { indent: 4 });
    await own.flush();
    expect(own.unsaved()).toBe('failed');
    expect(own.saved()).toEqual({ schema: 1, values: { indent: 4 } });
    expect(place.storage.rows.has(TOOL_SETTINGS_KEY)).toBe(false);
  });
});

describe('what the build before the seam saved (docs/tools/settings-storage.md §5)', () => {
  // The record as that build wrote it after five tools were used and the automatic-copy switch was touched.
  const before = () => ({
    v: 1,
    all: { autoCopy: false },
    tools: { password: { autoCopy: false } },
    params: {
      json: { schema: 1, values: { indent: 'tab', sortKeys: true } },
      base64: { schema: 1, values: { alphabet: 'url', padding: false, lineLength: 76 } },
      'curl-to-code': { schema: 1, values: { target: 'kotlin' } },
      password: { schema: 1, values: { length: 24, setsSymbols: false, count: 3 } },
      'date-calc': { schema: 1, values: { zones: ['Europe/Berlin', 'UTC', 'Asia/Tokyo'], operation: 'subtract' } },
    },
  });
  const opened = async () => {
    const storage = fakeStorage();
    storage.rows.set(TOOL_SETTINGS_KEY, before());
    const page = extensionToolSettings(storage.area, storage.onChanged);
    await Promise.all(Object.keys(before().params).map(id => page.readyFor(id)));
    return { storage, page };
  };

  it('is read as it is: every tool opens with what it saved, the switch is as it was, and reading rewrites nothing', async () => {
    const { storage, page } = await opened();
    for (const [id, saved] of Object.entries(before().params)) expect(page.forTool(id).saved()).toEqual(saved);
    expect(page.forTool('password').get()).toEqual({ autoCopy: false });
    expect(page.forTool('json').unsaved()).toBeUndefined();
    await page.forTool('json').flush();
    expect(storage.rows.get(TOOL_SETTINGS_KEY)).toEqual(before());
  });

  it('a change goes into the same record in the same shape: one tool’s entry replaced, nothing added, nothing else touched', async () => {
    const { storage, page } = await opened();
    page.forTool('json').save(1, { mode: 'minify', sortKeys: undefined });
    await page.forTool('json').flush();
    const expected = before();
    expect(storage.rows.get(TOOL_SETTINGS_KEY)).toEqual({
      ...expected,
      params: { ...expected.params, json: { schema: 1, values: { indent: 'tab', mode: 'minify' } } },
    });
    const written = (storage.rows.get(TOOL_SETTINGS_KEY) as ReturnType<typeof before>).params.json;
    expect(Object.keys(written).sort()).toEqual(['schema', 'values']);
  });

  it('reset removes that tool’s entry and leaves the others', async () => {
    const { storage, page } = await opened();
    await page.forTool('password').reset();
    const others = Object.fromEntries(Object.entries(before().params).filter(([id]) => id !== 'password'));
    expect(storage.rows.get(TOOL_SETTINGS_KEY)).toEqual({ ...before(), params: others });
    expect(page.forTool('password').get()).toEqual({ autoCopy: false });
  });

  it('another tab that still holds an older view of a tool does not undo a newer write: its change is merged in', async () => {
    const { storage, page } = await opened();
    const other = extensionToolSettings(storage.area, storage.onChanged);
    await other.readyFor('base64');
    page.forTool('base64').save(1, { lineLength: 64 });
    await page.forTool('base64').flush();
    other.forTool('base64').save(1, { padding: true });
    await other.forTool('base64').flush();
    expect((storage.rows.get(TOOL_SETTINGS_KEY) as ReturnType<typeof before>).params.base64).toEqual({
      schema: 1,
      values: { alphabet: 'url', padding: true, lineLength: 64 },
    });
  });
});
