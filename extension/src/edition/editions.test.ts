/**
 * Seam `Edition`: the shared contract, run against both implementations over chrome.storage.local (a fake), and the
 * root's choice. Each edition names an implementation of seam `ParameterStorage` (D23): Pro the local one, which keeps
 * the tools' saved parameters in the per-tool settings record, so the next page opens with them; free the switched-off
 * one, which writes nothing of them, so the next page opens with the defaults. The storage each names passes that
 * seam's own contract here, over the same chrome.storage. Both keep "Copy automatically after generating" as before
 * (D21 leaves it open: it is not moved).
 */
import { edition } from './index';
import { free } from './free';
import { pro } from './pro';
import { fakeStorage } from '@src/test/fakes';
import { chromePlace } from '@src/test/parameterPlace';
import { TOOL_SETTINGS_KEY, extensionToolSettings } from '@src/tools/settings';
import { parameterStorageContract } from '@workspace/tools-host/parameter-storage-contract';
import { describe, expect, it } from 'vitest';
import type { Edition } from './edition';

const IMPLEMENTATIONS: readonly Edition[] = [pro, free];

for (const variant of IMPLEMENTATIONS)
  parameterStorageContract(`the storage of edition ${variant.id}, over chrome.storage.local`, () =>
    chromePlace(variant.parameters),
  );

describe.each(IMPLEMENTATIONS.map(e => [e.id, e] as const))('Edition %s', (id, variant) => {
  const keeps = id === 'pro';
  const open = (storage: ReturnType<typeof fakeStorage>) =>
    extensionToolSettings(
      storage.area,
      storage.onChanged,
      variant.parameters({ area: storage.area, onChanged: storage.onChanged }),
    );

  it('a saved parameter is seen in the page at once; the next page opens with it only in Pro', async () => {
    const storage = fakeStorage();
    const page = open(storage);
    await page.readyFor('json');
    page.forTool('json').save(1, { indent: 4 });
    await page.forTool('json').flush();
    expect(page.forTool('json').saved()).toEqual({ schema: 1, values: { indent: 4 } });
    const next = open(storage);
    await next.readyFor('json');
    expect(next.forTool('json').saved()).toEqual(keeps ? { schema: 1, values: { indent: 4 } } : undefined);
  });

  it('what reaches chrome.storage.local: the parameters only in Pro; the automatic-copy switch in both', async () => {
    const storage = fakeStorage();
    const page = open(storage);
    await page.readyFor('password');
    page.forTool('password').save(1, { length: 24 });
    await page.forTool('password').flush();
    if (!keeps) expect(storage.rows.has(TOOL_SETTINGS_KEY)).toBe(false);
    await page.setForAll(['password'], { autoCopy: true });
    const stored = storage.rows.get(TOOL_SETTINGS_KEY) as Record<string, unknown>;
    expect(stored.tools).toEqual({ password: { autoCopy: true } });
    expect(stored.params).toEqual(keeps ? { password: { schema: 1, values: { length: 24 } } } : undefined);
  });

  it('the free one neither reads nor touches what a Pro build left in the record', async () => {
    const storage = fakeStorage();
    const left = { v: 1, all: {}, tools: {}, params: { json: { schema: 1, values: { indent: 4 } } } };
    storage.rows.set(TOOL_SETTINGS_KEY, structuredClone(left));
    const page = open(storage);
    await page.readyFor('json');
    expect(page.forTool('json').saved()).toEqual(keeps ? left.params.json : undefined);
    await page.forTool('json').set({ autoCopy: true });
    expect((storage.rows.get(TOOL_SETTINGS_KEY) as typeof left).params).toEqual(left.params);
  });

  it('names a storage that keeps exactly in Pro, and the reset control goes with the storage', async () => {
    const storage = fakeStorage();
    expect(variant.parameters({ area: storage.area, onChanged: storage.onChanged }).keeps).toBe(keeps);
    const page = open(storage);
    await page.readyFor('json');
    const own = page.forTool('json');
    own.declare(saved => saved !== undefined);
    own.save(1, { indent: 4 });
    expect(own.changed()).toBe(keeps);
    await own.flush();
    expect(own.unsaved()).toBeUndefined();
  });
});

describe('the edition’s composition root', () => {
  it('selects one of the implementations — Pro for now (no payment check yet; docs/defaults.md §2)', () => {
    expect(IMPLEMENTATIONS).toContain(edition);
    expect(edition).toBe(pro);
  });
});
