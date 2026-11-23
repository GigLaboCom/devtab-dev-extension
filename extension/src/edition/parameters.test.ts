/**
 * The storage of the edition in force (./parameters.ts): seam `ParameterStorage`'s contract and the logic's over it
 * with a fixed Pro source (keeps) and a fixed free one (keeps nothing), over chrome.storage.local (a fake); then a
 * change of the edition on an open page — nothing the person chose on the page is lost.
 */
import { fixedSource } from './fixed';
import { editionParameterStorage } from './parameters';
import { fakeStorage } from '@src/test/fakes';
import { chromePlace } from '@src/test/parameterPlace';
import { FREE, PRO, switchableSource } from '@src/test/switchableSource';
import { chromeToolSettingsArea, extensionToolSettings, TOOL_SETTINGS_KEY } from '@src/tools/settings';
import { parameterStorageContract } from '@workspace/tools-host/parameter-storage-contract';
import { toolSettingsContract, toolSettingsHarness } from '@workspace/tools-host/settings-contract';
import { describe, expect, it } from 'vitest';
import type { BrowserStorage } from '@src/tools/settings';

for (const edition of ['pro', 'free'] as const) {
  const make = (browser: BrowserStorage) => editionParameterStorage(fixedSource(edition), browser);
  parameterStorageContract(`the edition in force (fixed ${edition}), over chrome.storage.local`, () =>
    chromePlace(make),
  );
  toolSettingsContract(`chrome.storage.local, parameters of the edition in force (fixed ${edition})`, () => {
    const place = chromePlace(make);
    const { storage, browser } = place;
    return toolSettingsHarness(
      {
        area: () => chromeToolSettingsArea(browser.area, browser.onChanged),
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
}

/** A page whose edition a test switches, over a fake chrome.storage.local; `params` is what the record keeps. */
const page = (initial = FREE, storage = fakeStorage()) => {
  const source = switchableSource(initial);
  const parameters = editionParameterStorage(source, { area: storage.area, onChanged: storage.onChanged });
  const settings = extensionToolSettings(storage.area, storage.onChanged, parameters);
  const params = () =>
    (storage.rows.get(TOOL_SETTINGS_KEY) as { params?: Record<string, unknown> } | undefined)?.params;
  return { source, parameters, settings, storage, params };
};
const settle = () => new Promise(resolve => setTimeout(resolve, 10));

describe('editionParameterStorage: the edition changes on an open page', () => {
  it('keeps follows the edition in force', () => {
    const { source, parameters } = page(FREE);
    expect(parameters.keeps).toBe(false);
    source.set(PRO);
    expect(parameters.keeps).toBe(true);
    source.set(FREE);
    expect(parameters.keeps).toBe(false);
  });

  it('free → Pro: a choice made in the free one is written after the change, and what the page shows does not change', async () => {
    const { source, settings, params } = page(FREE);
    await settings.readyFor('json');
    const json = settings.forTool('json');
    json.save(1, { indent: 4 });
    await json.flush();
    expect(params()).toBeUndefined();
    source.set(PRO);
    await settle();
    expect(params()).toEqual({ json: { schema: 1, values: { indent: 4 } } });
    expect(json.saved()).toEqual({ schema: 1, values: { indent: 4 } });
    // The logic knows the stored revision now: the next change is written on it, at once and without a conflict.
    json.save(1, { sortKeys: true });
    await json.flush();
    expect(params()).toEqual({ json: { schema: 1, values: { indent: 4, sortKeys: true } } });
    expect(json.unsaved()).toBeUndefined();
  });

  it('free → Pro: the page’s choice is newer than what was stored, and wins over it', async () => {
    const storage = fakeStorage();
    storage.rows.set(TOOL_SETTINGS_KEY, {
      v: 1,
      all: {},
      tools: {},
      params: { json: { schema: 1, values: { indent: 2 } } },
    });
    const { source, settings, params } = page(FREE, storage);
    await settings.readyFor('json');
    settings.forTool('json').save(1, { indent: 'tab' });
    await settings.forTool('json').flush();
    source.set(PRO);
    await settle();
    expect(params()).toEqual({ json: { schema: 1, values: { indent: 'tab' } } });
  });

  it('free → Pro: a tool the page did not change stays as shown; its next write merges with the stored entry field by field', async () => {
    const storage = fakeStorage();
    storage.rows.set(TOOL_SETTINGS_KEY, {
      v: 1,
      all: {},
      tools: {},
      params: { json: { schema: 1, values: { sortKeys: true } } },
    });
    const { source, settings, params } = page(FREE, storage);
    await settings.readyFor('json');
    const json = settings.forTool('json');
    expect(json.saved()).toBeUndefined();
    source.set(PRO);
    await settle();
    expect(json.saved()).toBeUndefined();
    json.save(1, { indent: 4 });
    await json.flush();
    expect(params()).toEqual({ json: { schema: 1, values: { sortKeys: true, indent: 4 } } });
  });

  it('a write that arrives while the choice is carried over waits for it', async () => {
    const storage = fakeStorage();
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => (release = resolve));
    const slowArea = {
      get: async (key: string) => {
        await gate;
        return storage.area.get(key);
      },
      set: (items: Record<string, unknown>) => storage.area.set(items),
    } as unknown as BrowserStorage['area'];
    const source = switchableSource(FREE);
    const parameters = editionParameterStorage(source, { area: slowArea, onChanged: storage.onChanged });
    await parameters.write('json', { schema: 1, values: { indent: 4 } }, undefined);
    source.set(PRO);
    const order: string[] = [];
    const later = parameters.write('base64', { schema: 1, values: { lineLength: 64 } }, undefined).then(answer => {
      order.push(`base64 ${answer.status}`);
    });
    await settle();
    expect(order).toEqual([]);
    release();
    await later;
    const params = (storage.rows.get(TOOL_SETTINGS_KEY) as { params: Record<string, unknown> }).params;
    expect(Object.keys(params)).toEqual(['json', 'base64']);
    expect(order).toEqual(['base64 accepted']);
  });

  it('Pro → free: the stored entry is not touched; the page keeps its choice; nothing is reported', async () => {
    const { source, settings, params, parameters } = page(PRO);
    await settings.readyFor('json');
    const json = settings.forTool('json');
    json.save(1, { indent: 4 });
    await json.flush();
    const heard: string[] = [];
    parameters.watch(id => heard.push(id));
    source.set(FREE);
    json.save(1, { indent: 'tab' });
    await json.flush();
    await settle();
    expect(params()).toEqual({ json: { schema: 1, values: { indent: 4 } } });
    expect(json.saved()).toEqual({ schema: 1, values: { indent: 'tab' } });
    expect(heard).toEqual([]);
    // And back to Pro: what was chosen in the free one meanwhile is carried over.
    source.set(PRO);
    await settle();
    expect(params()).toEqual({ json: { schema: 1, values: { indent: 'tab' } } });
  });

  it('the reset control goes with the edition: changed() only where the storage keeps', async () => {
    const { source, settings } = page(PRO);
    await settings.readyFor('json');
    const json = settings.forTool('json');
    json.declare(saved => saved !== undefined);
    json.save(1, { indent: 4 });
    await json.flush();
    expect(json.changed()).toBe(true);
    source.set(FREE);
    expect(json.changed()).toBe(false);
    source.set(PRO);
    expect(json.changed()).toBe(true);
  });

  it('reports changes made in another tab only while the edition in force keeps', async () => {
    const storage = fakeStorage();
    const mine = page(PRO, storage);
    const heard: string[] = [];
    mine.parameters.watch(id => heard.push(id));
    const other = page(PRO, storage);
    await other.parameters.write('json', { schema: 1, values: { indent: 4 } }, undefined);
    expect(heard).toEqual(['json']);
    mine.source.set(FREE);
    const current = await other.parameters.read('json');
    await other.parameters.write('json', { schema: 1, values: { indent: 2 } }, current?.revision);
    expect(heard).toEqual(['json']);
  });

  it('dispose stops following the source and the storage', () => {
    const { source, parameters } = page(FREE);
    expect(source.listeners).toBe(1);
    parameters.dispose();
    expect(source.listeners).toBe(0);
  });
});
