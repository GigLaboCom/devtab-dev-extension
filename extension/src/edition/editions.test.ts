/**
 * Seam `Edition`: the shared contract, run against both implementations over chrome.storage.local (a fake), and the
 * root's choice. Pro keeps the tools' saved parameters in the per-tool settings record, so the next page opens with
 * them; free keeps them in the page's memory, writes nothing of them, and the next page opens with the defaults. Both
 * keep "Copy automatically after generating" as before (D21 leaves it open: it is not moved).
 */
import { edition } from './index';
import { free } from './free';
import { pro } from './pro';
import { fakeStorage } from '@src/test/fakes';
import { TOOL_SETTINGS_KEY, extensionToolSettings } from '@src/tools/settings';
import { describe, expect, it } from 'vitest';
import type { Edition } from './edition';

const IMPLEMENTATIONS: readonly Edition[] = [pro, free];

describe.each(IMPLEMENTATIONS.map(e => [e.id, e] as const))('Edition %s', (_id, variant) => {
  const open = (storage: ReturnType<typeof fakeStorage>) =>
    extensionToolSettings(storage.area, storage.onChanged, variant.parameters);

  it('a saved parameter is seen in the page at once; the next page opens with it only in Pro', async () => {
    const storage = fakeStorage();
    const page = open(storage);
    await page.ready;
    page.forTool('json').save(1, { indent: 4 });
    await page.forTool('json').flush();
    expect(page.forTool('json').saved()).toEqual({ schema: 1, values: { indent: 4 } });
    const next = open(storage);
    await next.ready;
    expect(next.forTool('json').saved()).toEqual(variant.pro ? { schema: 1, values: { indent: 4 } } : undefined);
  });

  it('what reaches chrome.storage.local: the parameters only in Pro; the automatic-copy switch in both', async () => {
    const storage = fakeStorage();
    const page = open(storage);
    await page.ready;
    page.forTool('password').save(1, { length: 24 });
    await page.forTool('password').flush();
    await page.setForAll(['password'], { autoCopy: true });
    const stored = storage.rows.get(TOOL_SETTINGS_KEY) as Record<string, unknown>;
    expect(stored.tools).toEqual({ password: { autoCopy: true } });
    expect(stored.params).toEqual(variant.pro ? { password: { schema: 1, values: { length: 24 } } } : undefined);
  });

  it('is Pro exactly when it keeps the parameters between pages (the reset control goes with it)', () => {
    expect(variant.pro).toBe(variant.id === 'pro');
  });
});

describe('the edition’s composition root', () => {
  it('selects one of the implementations — Pro for now (no payment check yet; docs/defaults.md §2)', () => {
    expect(IMPLEMENTATIONS).toContain(edition);
    expect(edition).toBe(pro);
  });
});
