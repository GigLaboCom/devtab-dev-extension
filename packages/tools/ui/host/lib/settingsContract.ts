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
  });
};
