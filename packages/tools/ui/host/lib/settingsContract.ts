/**
 * The contract suite of the per-tool settings (`ToolSettings` / `ToolSettingsStore`, settings.ts) — the logic every
 * host shares, run over every place a host keeps things in: the settings' area (in memory here, chrome.storage.local in
 * the extension) and, for the saved parameters, every implementation of seam `ParameterStorage` (in memory, switched
 * off, a fake remote here; the extension's local one in its own tests). Written against the interfaces; a harness
 * opens pages over one place.
 *
 * The saved parameters' half is the proof that the implementations are interchangeable above the seam: the same tests,
 * whatever keeps the parameters. Where a storage says it keeps nothing (`keeps: false`) the tests check exactly that
 * instead; a harness that can make its place refuse writes or cut a page's storage off gets those answers checked too.
 */
import { createToolSettings } from './settings';
import { describe, expect, it } from 'vitest';
import type { ParameterStorage } from './parameterStorage';
import type { ParameterStorageHarness } from './parameterStorageContract';
import type { ToolSettingsArea, ToolSettingsStore } from './settings';

export interface ToolSettingsHarness {
  /** A new page of the host over the same places (another tab of the extension). */
  page(): ToolSettingsStore;
  /** What the settings' area holds, as stored — without the part a parameter storage keeps in the same record. */
  stored(): Promise<unknown>;
  /** Puts a raw value into the settings' area before a page opens (an older or damaged record). */
  seed(raw: unknown): Promise<void>;
  /** The place of the saved parameters, as the storage contract sees it. */
  parameters: Pick<ParameterStorageHarness, 'held' | 'seed' | 'settle' | 'refuse'> & { keeps: boolean };
  /** Cuts a page's parameter storage off, or brings it back — where the implementation can be. */
  cut?(page: ToolSettingsStore, on: boolean): void;
}

/** The harness of a host: its settings' area and its parameter storage, each page with a storage of its own. */
export const toolSettingsHarness = (
  settings: { area(): ToolSettingsArea; stored(): Promise<unknown>; seed(raw: unknown): Promise<void> },
  parameters: ParameterStorageHarness,
): ToolSettingsHarness => {
  const storages = new WeakMap<ToolSettingsStore, ParameterStorage>();
  return {
    page: () => {
      const storage = parameters.open();
      const page = createToolSettings(settings.area(), storage);
      storages.set(page, storage);
      return page;
    },
    stored: settings.stored,
    seed: settings.seed,
    parameters: { ...parameters, keeps: parameters.open().keeps },
    cut: parameters.cut && ((page, on) => parameters.cut!(storages.get(page)!, on)),
  };
};

const settle = () => new Promise(r => setTimeout(r, 0));

export const toolSettingsContract = (name: string, make: () => ToolSettingsHarness): void => {
  const probe = make();
  const keeps = probe.parameters.keeps;

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

    // Saved parameters (D21): the same entry of a tool, kept by a `ParameterStorage` (D23).

    it('saved parameters: nothing is saved or written until something is saved', async () => {
      const h = make();
      const page = h.page();
      await page.readyFor('json');
      const own = page.forTool('json');
      expect(own.saved()).toBeUndefined();
      expect(own.changed()).toBe(false);
      expect(own.unsaved()).toBeUndefined();
      await own.flush();
      await h.parameters.settle();
      expect(await h.parameters.held('json')).toBeUndefined();
      expect(await h.stored()).toBeUndefined();
    });

    it('saved parameters: seen at once, written on flush under the tool’s schema; a page opened later opens with them exactly when the storage keeps', async () => {
      const h = make();
      const page = h.page();
      await page.readyFor('json');
      const own = page.forTool('json');
      const saved = { schema: 1, values: { indent: 4, mode: 'minify' } };
      own.save(1, { indent: 4, mode: 'minify' });
      expect(own.saved()).toEqual(saved);
      await own.flush();
      await h.parameters.settle();
      // Still what the tool reads in this page, whatever the storage is.
      expect(own.saved()).toEqual(saved);
      expect(own.unsaved()).toBeUndefined();
      expect(await h.parameters.held('json')).toEqual(keeps ? saved : undefined);
      const later = h.page();
      await later.readyFor('json');
      expect(later.forTool('json').saved()).toEqual(keeps ? saved : undefined);
      expect(later.forTool('base64').saved()).toBeUndefined();
    });

    it('saved parameters: undefined removes a field, the entry goes when empty; settings and parameters keep each other', async () => {
      const h = make();
      const page = h.page();
      await page.readyFor('password');
      const own = page.forTool('password');
      await own.set({ autoCopy: true });
      own.save(1, { length: 24, words: 7 });
      own.save(1, { words: undefined });
      await own.flush();
      await h.parameters.settle();
      expect(own.saved()).toEqual({ schema: 1, values: { length: 24 } });
      expect(await h.stored()).toEqual({ v: 1, all: {}, tools: { password: { autoCopy: true } } });
      if (keeps) expect(await h.parameters.held('password')).toEqual({ schema: 1, values: { length: 24 } });
      await page.setForAll(['password'], { autoCopy: false });
      if (keeps) expect(await h.parameters.held('password')).toEqual({ schema: 1, values: { length: 24 } });
      own.save(1, { length: undefined });
      await own.flush();
      await h.parameters.settle();
      expect(own.saved()).toBeUndefined();
      expect(await h.parameters.held('password')).toBeUndefined();
      expect(await h.stored()).toEqual({ v: 1, all: { autoCopy: false }, tools: { password: { autoCopy: false } } });
    });

    it('saved parameters: one write per tool — another tool’s entry is not touched', async () => {
      const h = make();
      const page = h.page();
      await Promise.all([page.readyFor('json'), page.readyFor('base64')]);
      page.forTool('json').save(1, { indent: 4 });
      page.forTool('base64').save(1, { alphabet: 'url' });
      await page.forTool('json').flush();
      await h.parameters.settle();
      expect(page.forTool('json').saved()).toEqual({ schema: 1, values: { indent: 4 } });
      expect(page.forTool('base64').saved()).toEqual({ schema: 1, values: { alphabet: 'url' } });
      await page.forTool('json').reset();
      await h.parameters.settle();
      expect(page.forTool('json').saved()).toBeUndefined();
      expect(page.forTool('base64').saved()).toEqual({ schema: 1, values: { alphabet: 'url' } });
      if (keeps) expect(await h.parameters.held('base64')).toEqual({ schema: 1, values: { alphabet: 'url' } });
    });

    it.runIf(keeps)(
      'saved parameters: readyFor is what a tool’s page waits for — the tool then opens with what is kept',
      async () => {
        const h = make();
        await h.parameters.seed('json', { schema: 1, values: { indent: 4 } });
        const page = h.page();
        const ready = page.readyFor('json');
        expect(page.readyFor('json')).toBe(ready);
        await ready;
        expect(page.forTool('json').saved()).toEqual({ schema: 1, values: { indent: 4 } });
      },
    );

    it.runIf(keeps)(
      'saved parameters: two pages changing different fields keep both, the same field keeps the last; the store follows the other page',
      async () => {
        const h = make();
        const a = h.page();
        const b = h.page();
        await Promise.all([a.readyFor('json'), b.readyFor('json')]);
        a.forTool('json').save(1, { indent: 4 });
        await a.forTool('json').flush();
        await h.parameters.settle();
        b.forTool('json').save(1, { sortKeys: true });
        await b.forTool('json').flush();
        await h.parameters.settle();
        expect(await h.parameters.held('json')).toEqual({ schema: 1, values: { indent: 4, sortKeys: true } });
        // The store follows the entry (the reset control's state), the tool's values are its own (useSavedSettings).
        expect(a.forTool('json').saved()?.values).toEqual({ indent: 4, sortKeys: true });
        a.forTool('json').save(1, { indent: 2 });
        await a.forTool('json').flush();
        b.forTool('json').save(1, { indent: 'tab' });
        await b.forTool('json').flush();
        await h.parameters.settle();
        expect(await h.parameters.held('json')).toEqual({ schema: 1, values: { indent: 'tab', sortKeys: true } });
      },
    );

    it.runIf(keeps)(
      'saved parameters: an entry that changed elsewhere before this page wrote keeps the other change as well',
      async () => {
        const h = make();
        const page = h.page();
        await page.readyFor('json');
        // Another page or device; this page may not have been told yet.
        await h.parameters.seed('json', { schema: 1, values: { indent: 4 } });
        const own = page.forTool('json');
        own.save(1, { sortKeys: true });
        await own.flush();
        await h.parameters.settle();
        expect(await h.parameters.held('json')).toEqual({ schema: 1, values: { indent: 4, sortKeys: true } });
        expect(own.saved()).toEqual({ schema: 1, values: { indent: 4, sortKeys: true } });
        expect(own.unsaved()).toBeUndefined();
      },
    );

    it.runIf(keeps)(
      'saved parameters: keep drops what a write must not carry; another schema starts afresh',
      async () => {
        const h = make();
        await h.parameters.seed('json', { schema: 1, values: { indent: 4, gone: 'x', mode: 'wrong' } });
        const page = h.page();
        await page.readyFor('json');
        const own = page.forTool('json');
        own.save(1, { sortKeys: true }, key => key !== 'gone' && key !== 'mode');
        await own.flush();
        await h.parameters.settle();
        expect(await h.parameters.held('json')).toEqual({ schema: 1, values: { indent: 4, sortKeys: true } });
        own.save(2, { layout: 'tab' });
        await own.flush();
        await h.parameters.settle();
        expect(await h.parameters.held('json')).toEqual({ schema: 2, values: { layout: 'tab' } });
      },
    );

    it.runIf(keeps)(
      'saved parameters: a damaged entry is read as far as it is valid and replaced by the next write; a too large one is not read, nor written',
      async () => {
        const h = make();
        await h.parameters.seed('json', {
          schema: 1,
          values: { indent: 4, nested: { a: 1 }, list: ['a', 2], zones: ['UTC'] },
        });
        await h.parameters.seed('base64', { schema: 'one', values: { a: 1 } });
        await h.parameters.seed('url', 'x');
        await h.parameters.seed('huge', { schema: 1, values: { text: 'x'.repeat(5000) } });
        const page = h.page();
        await Promise.all(['json', 'base64', 'url', 'huge'].map(id => page.readyFor(id)));
        expect(page.forTool('json').saved()).toEqual({ schema: 1, values: { indent: 4, zones: ['UTC'] } });
        for (const id of ['base64', 'url', 'huge']) expect(page.forTool(id).saved()).toBeUndefined();
        const own = page.forTool('json');
        own.save(1, { text: 'y'.repeat(5000) });
        expect(own.saved()).toEqual({ schema: 1, values: { indent: 4, zones: ['UTC'] } });
        page.forTool('url').save(1, { encode: 'component' });
        await page.forTool('url').flush();
        await h.parameters.settle();
        expect(await h.parameters.held('url')).toEqual({ schema: 1, values: { encode: 'component' } });
        // The removal of an entry that reads as nothing still removes it.
        await page.forTool('base64').reset();
        await h.parameters.settle();
        expect(await h.parameters.held('base64')).toBeUndefined();
      },
    );

    it('reset: removes the saved entry at once and tells the tool’s page in this page only', async () => {
      const h = make();
      const a = h.page();
      const b = h.page();
      await Promise.all([a.readyFor('json'), b.readyFor('json')]);
      a.forTool('json').save(1, { indent: 4 });
      await a.forTool('json').flush();
      await h.parameters.settle();
      expect(b.forTool('json').saved()).toEqual(keeps ? { schema: 1, values: { indent: 4 } } : undefined);
      const heard: string[] = [];
      a.forTool('json').onReset(() => heard.push('a'));
      b.forTool('json').onReset(() => heard.push('b'));
      a.forTool('json').save(1, { sortKeys: true });
      await a.forTool('json').reset();
      await h.parameters.settle();
      expect(heard).toEqual(['a']);
      expect(a.forTool('json').saved()).toBeUndefined();
      expect(b.forTool('json').saved()).toBeUndefined();
      expect(await h.parameters.held('json')).toBeUndefined();
    });

    it('changed: what the tool’s open page declares, followed by subscribers — never in a host whose storage keeps nothing', async () => {
      const page = make().page();
      await page.readyFor('json');
      const own = page.forTool('json');
      let heard = 0;
      own.subscribe(() => heard++);
      own.save(1, { indent: 4 });
      expect(own.changed()).toBe(false);
      const undeclare = own.declare(saved => saved?.values.indent !== undefined);
      expect(own.changed()).toBe(keeps);
      own.save(1, { indent: undefined });
      expect(own.changed()).toBe(false);
      undeclare();
      expect(heard).toBeGreaterThanOrEqual(4);
      await own.flush();
    });

    it.runIf(keeps && probe.parameters.refuse !== undefined)(
      'a refused write: the changes stay in this page, the tool’s entry says `failed`, and the next flush sends them all',
      async () => {
        const h = make();
        const page = h.page();
        await page.readyFor('json');
        const own = page.forTool('json');
        own.save(1, { indent: 4 });
        await own.flush();
        await h.parameters.settle();
        let told = 0;
        own.subscribe(() => told++);
        h.parameters.refuse!(true);
        own.save(1, { sortKeys: true });
        await own.flush();
        await h.parameters.settle();
        expect(own.unsaved()).toBe('failed');
        expect(told).toBeGreaterThanOrEqual(2);
        expect(own.saved()).toEqual({ schema: 1, values: { indent: 4, sortKeys: true } });
        expect(await h.parameters.held('json')).toEqual({ schema: 1, values: { indent: 4 } });
        expect(page.forTool('base64').unsaved()).toBeUndefined();
        // Asked again while it still refuses: nothing is lost, nothing changes.
        await own.flush();
        expect(own.unsaved()).toBe('failed');
        h.parameters.refuse!(false);
        own.save(1, { mode: 'minify' });
        await own.flush();
        await h.parameters.settle();
        expect(own.unsaved()).toBeUndefined();
        expect(await h.parameters.held('json')).toEqual({
          schema: 1,
          values: { indent: 4, sortKeys: true, mode: 'minify' },
        });
      },
    );

    it.runIf(keeps && probe.cut !== undefined)(
      'cut off: the changes are held and the tool’s entry says `unavailable`; when the storage reports the tool again they are sent without anyone asking',
      async () => {
        const h = make();
        const page = h.page();
        await page.readyFor('json');
        const own = page.forTool('json');
        h.cut!(page, true);
        own.save(1, { indent: 4 });
        await own.flush();
        await h.parameters.settle();
        expect(own.unsaved()).toBe('unavailable');
        expect(own.saved()).toEqual({ schema: 1, values: { indent: 4 } });
        expect(await h.parameters.held('json')).toBeUndefined();
        // Meanwhile the entry changes elsewhere.
        await h.parameters.seed('json', { schema: 1, values: { sortKeys: true } });
        h.cut!(page, false);
        await h.parameters.settle();
        expect(own.unsaved()).toBeUndefined();
        expect(await h.parameters.held('json')).toEqual({ schema: 1, values: { indent: 4, sortKeys: true } });
        expect(own.saved()).toEqual({ schema: 1, values: { indent: 4, sortKeys: true } });
      },
    );
  });
};
