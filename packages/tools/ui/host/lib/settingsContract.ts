/**
 * The contract suite of the per-tool settings seam (`ToolSettings` / `ToolSettingsStore`): every implementation runs
 * it — the in-memory one here (settings.test.ts), the extension's over chrome.storage.local
 * (extension/src/tools/settings.test.ts). Written against the interface; a harness opens pages over one storage.
 */
import { describe, expect, it } from 'vitest';
import type { ToolSettingsStore } from './settings';

export interface ToolSettingsHarness {
  /** A new page of the host over the same storage (another tab of the extension). */
  page(): ToolSettingsStore;
  /** What the storage holds, as stored. */
  stored(): Promise<unknown>;
  /** Puts a raw value into the storage before a page opens (an older or damaged record). */
  seed(raw: unknown): Promise<void>;
}

const settle = () => new Promise(r => setTimeout(r, 0));

export const toolSettingsContract = (name: string, make: () => ToolSettingsHarness): void => {
  describe(`ToolSettings contract: ${name}`, () => {
    it('a tool with nothing stored reads nothing — its own defaults apply', async () => {
      const page = make().page();
      await page.ready;
      expect(page.forTool('password').get()).toEqual({});
      expect(page.forAll()).toEqual({});
    });

    it('set upserts into the tool’s own entry, keeps its other keys and leaves other tools alone', async () => {
      const h = make();
      const page = h.page();
      await page.ready;
      await page.forTool('password').set({ length: 24 });
      await page.forTool('password').set({ autoCopy: true });
      expect(page.forTool('password').get()).toEqual({ length: 24, autoCopy: true });
      expect(page.forTool('uuid').get()).toEqual({});
      expect(await h.stored()).toEqual({ v: 1, all: {}, tools: { password: { length: 24, autoCopy: true } } });
    });

    it('one switch over many entries: setForAll upserts the value into every named tool’s entry', async () => {
      const h = make();
      const page = h.page();
      await page.ready;
      await page.forTool('password').set({ length: 24 });
      await page.setForAll(['password', 'uuid', 'random-string'], { autoCopy: true });
      expect(await h.stored()).toEqual({
        v: 1,
        all: { autoCopy: true },
        tools: {
          password: { length: 24, autoCopy: true },
          uuid: { autoCopy: true },
          'random-string': { autoCopy: true },
        },
      });
      await page.setForAll(['password', 'uuid', 'random-string'], { autoCopy: false });
      for (const id of ['password', 'uuid', 'random-string']) expect(page.forTool(id).get().autoCopy).toBe(false);
      expect(page.forTool('password').get().length).toBe(24);
      expect(page.forAll()).toEqual({ autoCopy: false });
    });

    it('a tool that appears later reads the switch’s current state; its own value wins once it has one', async () => {
      const h = make();
      const page = h.page();
      await page.ready;
      await page.setForAll(['password', 'uuid'], { autoCopy: true });
      // lorem-ipsum was not among the tools when the switch was flipped.
      expect(page.forTool('lorem-ipsum').get()).toEqual({ autoCopy: true });
      const later = h.page();
      await later.ready;
      expect(later.forTool('lorem-ipsum').get().autoCopy).toBe(true);
      await later.forTool('lorem-ipsum').set({ autoCopy: false });
      expect(later.forTool('lorem-ipsum').get().autoCopy).toBe(false);
      expect(later.forTool('password').get().autoCopy).toBe(true);
    });

    it('every page follows a change made in another, live', async () => {
      const h = make();
      const a = h.page();
      const b = h.page();
      await Promise.all([a.ready, b.ready]);
      const heard: string[] = [];
      const own = b.forTool('uuid');
      own.subscribe(() => heard.push(String(own.get().autoCopy)));
      b.subscribe(() => heard.push('store'));
      await a.setForAll(['password', 'uuid'], { autoCopy: true });
      await settle();
      expect(own.get().autoCopy).toBe(true);
      expect(b.forAll()).toEqual({ autoCopy: true });
      expect(heard).toContain('true');
      await b.forTool('password').set({ autoCopy: false });
      await settle();
      expect(a.forTool('password').get().autoCopy).toBe(false);
      expect(a.forTool('uuid').get().autoCopy).toBe(true);
    });

    it('gives the same object until the entry changes (a tool re-renders only on a change)', async () => {
      const page = make().page();
      await page.ready;
      const own = page.forTool('password');
      const first = own.get();
      expect(own.get()).toBe(first);
      await page.forTool('uuid').set({ autoCopy: true });
      expect(own.get()).toBe(first);
      await own.set({ autoCopy: true });
      expect(own.get()).not.toBe(first);
      expect(own.get()).toBe(own.get());
    });

    it('reads a damaged or foreign record as far as it is valid, and writes version 1', async () => {
      const h = make();
      await h.seed({ v: 1, all: { autoCopy: 'yes', n: 3 }, tools: { password: { autoCopy: true, list: [1] }, x: 5 } });
      const page = h.page();
      await page.ready;
      expect(page.forTool('password').get()).toEqual({ autoCopy: true, n: 3 });
      expect(page.forTool('x').get()).toEqual({ autoCopy: 'yes', n: 3 });
      await page.forTool('uuid').set({ autoCopy: false });
      expect(await h.stored()).toEqual({
        v: 1,
        all: { autoCopy: 'yes', n: 3 },
        tools: { password: { autoCopy: true }, x: {}, uuid: { autoCopy: false } },
      });

      const g = make();
      await g.seed('not a record');
      const other = g.page();
      await other.ready;
      expect(other.forTool('password').get()).toEqual({});
    });

    // Saved parameters (D21): the same entry, a part of the record of its own (`params`).

    it('saved parameters: nothing is saved or written until something is saved', async () => {
      const h = make();
      const page = h.page();
      await page.ready;
      const own = page.forTool('json');
      expect(own.saved()).toBeUndefined();
      expect(own.changed()).toBe(false);
      await own.flush();
      expect(await h.stored()).toBeUndefined();
    });

    it('saved parameters: seen at once, written on flush under the tool’s schema, read by a page opened later', async () => {
      const h = make();
      const page = h.page();
      await page.ready;
      const own = page.forTool('json');
      own.save(1, { indent: 4, mode: 'minify' });
      expect(own.saved()).toEqual({ schema: 1, values: { indent: 4, mode: 'minify' } });
      await own.flush();
      expect(await h.stored()).toEqual({
        v: 1,
        all: {},
        tools: {},
        params: { json: { schema: 1, values: { indent: 4, mode: 'minify' } } },
      });
      const later = h.page();
      await later.ready;
      expect(later.forTool('json').saved()).toEqual({ schema: 1, values: { indent: 4, mode: 'minify' } });
      expect(later.forTool('base64').saved()).toBeUndefined();
    });

    it('saved parameters: undefined removes a field, the record goes when empty; settings and parameters keep each other', async () => {
      const h = make();
      const page = h.page();
      await page.ready;
      const own = page.forTool('password');
      await own.set({ autoCopy: true });
      own.save(1, { length: 24, words: 7 });
      own.save(1, { words: undefined });
      await own.flush();
      expect(await h.stored()).toEqual({
        v: 1,
        all: {},
        tools: { password: { autoCopy: true } },
        params: { password: { schema: 1, values: { length: 24 } } },
      });
      await page.setForAll(['password'], { autoCopy: false });
      own.save(1, { length: undefined });
      await own.flush();
      expect(await h.stored()).toEqual({ v: 1, all: { autoCopy: false }, tools: { password: { autoCopy: false } } });
    });

    it('saved parameters: two pages changing different fields keep both; an open page does not follow the other', async () => {
      const h = make();
      const a = h.page();
      const b = h.page();
      await Promise.all([a.ready, b.ready]);
      a.forTool('json').save(1, { indent: 4 });
      await a.forTool('json').flush();
      await settle();
      b.forTool('json').save(1, { sortKeys: true });
      await b.forTool('json').flush();
      await settle();
      expect((await h.stored()) as unknown).toMatchObject({
        params: { json: { schema: 1, values: { indent: 4, sortKeys: true } } },
      });
      // The store follows the record (the reset control's state), the tool's values are its own (useSavedSettings).
      expect(a.forTool('json').saved()?.values).toEqual({ indent: 4, sortKeys: true });
    });

    it('saved parameters: keep drops what a write must not carry; another schema starts afresh', async () => {
      const h = make();
      await h.seed({
        v: 1,
        all: {},
        tools: {},
        params: { json: { schema: 1, values: { indent: 4, gone: 'x', mode: 'wrong' } } },
      });
      const page = h.page();
      await page.ready;
      const own = page.forTool('json');
      own.save(1, { sortKeys: true }, key => key !== 'gone' && key !== 'mode');
      await own.flush();
      expect(((await h.stored()) as { params: unknown }).params).toEqual({
        json: { schema: 1, values: { indent: 4, sortKeys: true } },
      });
      own.save(2, { layout: 'tab' });
      await own.flush();
      expect(((await h.stored()) as { params: unknown }).params).toEqual({
        json: { schema: 2, values: { layout: 'tab' } },
      });
    });

    it('saved parameters: a damaged record is read as far as it is valid; a too large one is not read, nor written', async () => {
      const h = make();
      await h.seed({
        v: 1,
        all: {},
        tools: {},
        params: {
          json: { schema: 1, values: { indent: 4, nested: { a: 1 }, list: ['a', 2], zones: ['UTC'] } },
          base64: { schema: 'one', values: { a: 1 } },
          url: 'x',
          huge: { schema: 1, values: { text: 'x'.repeat(5000) } },
        },
      });
      const page = h.page();
      await page.ready;
      expect(page.forTool('json').saved()).toEqual({ schema: 1, values: { indent: 4, zones: ['UTC'] } });
      for (const id of ['base64', 'url', 'huge']) expect(page.forTool(id).saved()).toBeUndefined();
      const own = page.forTool('json');
      own.save(1, { text: 'y'.repeat(5000) });
      expect(own.saved()).toEqual({ schema: 1, values: { indent: 4, zones: ['UTC'] } });
    });

    it('reset: removes the saved record at once and tells the tool’s page in this page only', async () => {
      const h = make();
      const a = h.page();
      const b = h.page();
      await Promise.all([a.ready, b.ready]);
      a.forTool('json').save(1, { indent: 4 });
      const heard: string[] = [];
      a.forTool('json').onReset(() => heard.push('a'));
      b.forTool('json').onReset(() => heard.push('b'));
      await a.forTool('json').reset();
      await settle();
      expect(heard).toEqual(['a']);
      expect(a.forTool('json').saved()).toBeUndefined();
      expect(b.forTool('json').saved()).toBeUndefined();
      expect(await h.stored()).toEqual({ v: 1, all: {}, tools: {} });
    });

    it('changed: what the tool’s open page declares, followed by subscribers; false while none is declared', async () => {
      const page = make().page();
      await page.ready;
      const own = page.forTool('json');
      let heard = 0;
      own.subscribe(() => heard++);
      own.save(1, { indent: 4 });
      expect(own.changed()).toBe(false);
      const undeclare = own.declare(saved => saved?.values.indent !== undefined);
      expect(own.changed()).toBe(true);
      own.save(1, { indent: undefined });
      expect(own.changed()).toBe(false);
      undeclare();
      expect(heard).toBeGreaterThanOrEqual(4);
      await own.flush();
    });
  });
};
