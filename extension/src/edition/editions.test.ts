/**
 * Seam `Edition`: the shared contract, run against both implementations over chrome.storage.local (a fake); seam
 * `EditionSource`: its contract on both fixed sources, how a source's state becomes an edition (editionFor), and the
 * root's choice. Each edition names an implementation of seam `ParameterStorage` (D23): Pro the local one, which keeps
 * the tools' saved parameters in the per-tool settings record, so the next page opens with them; free the switched-off
 * one, which writes nothing of them, so the next page opens with the defaults. The storage each names passes that
 * seam's own contract here, over the same chrome.storage. The per-tool settings record itself (where the "Copy
 * automatically after generating" switch is stored) is written the same way by both; whether that copying exists is the
 * edition's `automaticCopying` (D24). Each edition also says what stands behind the tool history (D25): Pro records in
 * the extension's IndexedDB; free records nothing and never opens it.
 */
import { editionSource } from './index';
import { fixedSource } from './fixed';
import { fixedFree } from './fixedFree';
import { fixedPro } from './fixedPro';
import { free } from './free';
import { editionFor } from './inForce';
import { pro } from './pro';
import { editionSourceContract } from './sourceContract';
import { memoryHistoryHost } from '@src/history/behaviors';
import { HISTORY_DB } from '@src/history/idbStore';
import { fakeStorage } from '@src/test/fakes';
import { chromePlace } from '@src/test/parameterPlace';
import { TOOL_SETTINGS_KEY, extensionToolSettings } from '@src/tools/settings';
import { parameterStorageContract } from '@workspace/tools-host/parameter-storage-contract';
import { memoryStore } from '@workspace/tools-shared/history';
import { describe, expect, it } from 'vitest';
import type { Edition } from './edition';
import type { EditionSourceFactory, SourceState } from './source';
import type { HistoryDeclaration } from '@workspace/tools-shared/history';

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

describe.each(IMPLEMENTATIONS.map(e => [e.id, e] as const))(
  'Edition %s: the history and automatic copying',
  (id, variant) => {
    const isPro = id === 'pro';
    const DECLARATION: HistoryDeclaration = {
      kinds: [{ id: 'result', title: 'Result' }],
      schema: 1,
      records: '',
      never: '',
    };

    it('records exactly in Pro; the free one never opens the database it is offered', async () => {
      const opened: string[] = [];
      // An IndexedDB that only notes what is opened: the free edition must not reach it at all.
      const factory = {
        open: (name: string) => {
          opened.push(name);
          throw new Error('not in this test');
        },
      } as unknown as IDBFactory;
      const history = variant.history({ indexedDB: { factory, keyRange: {} as typeof IDBKeyRange } });
      expect(history.recording).toBe(isPro);
      await history.store.stats().catch(() => undefined);
      expect(opened).toEqual(isPro ? [HISTORY_DB] : []);
    });

    it('a store the host gives instead of a database: Pro keeps the records there; the free one leaves it alone', () => {
      const given = memoryStore();
      expect(variant.history({ store: given }).store === given).toBe(isPro);
    });

    it('through the host: what a tool records, and what the host tells its places and the tools', async () => {
      const host = memoryHistoryHost([{ id: 'json', title: 'JSON', history: DECLARATION }], fixedSource(variant.id));
      expect([host.included, host.automaticCopying]).toEqual([isPro, isPro]);
      const history = host.factory.forOwner('json', DECLARATION);
      expect(history.status().gate).toBe(isPro ? 'on' : 'off');
      expect((await history.session().commit({ kind: 'result', payload: 1 })).recorded).toBe(isPro);
      expect((await host.store.stats()).records).toBe(isPro ? 1 : 0);
    });

    it('scratch files (D34): in both editions until the owner decides; the host says so to the pages', () => {
      expect(variant.scratches).toBe(true);
      expect(memoryHistoryHost([], fixedSource(variant.id)).scratches).toBe(true);
    });

    it('the editor’s profiles and a project’s .editorconfig (D39) exist exactly in Pro; the host says so to the pages', () => {
      const storage = fakeStorage();
      const profiles = variant.editorProfiles({ area: storage.area, onChanged: storage.onChanged, areaName: 'local' });
      expect(profiles.included).toBe(isPro);
      expect(variant.projectEditorSettings.included).toBe(isPro);
      const host = memoryHistoryHost([], fixedSource(variant.id));
      expect(host.editorProfiles.included).toBe(isPro);
      // One store per edition and page: the pages can follow it by identity.
      expect(host.editorProfiles).toBe(host.editorProfiles);
      expect(host.projectEditorSettings).toBe(variant.projectEditorSettings);
    });

    it('automatic copying exists exactly in Pro; a stored "on" is left in the record either way', async () => {
      expect(variant.automaticCopying).toBe(isPro);
      const storage = fakeStorage();
      storage.rows.set(TOOL_SETTINGS_KEY, { v: 1, all: { autoCopy: true }, tools: { password: { autoCopy: true } } });
      const page = extensionToolSettings(
        storage.area,
        storage.onChanged,
        variant.parameters({ area: storage.area, onChanged: storage.onChanged }),
      );
      await page.readyFor('password');
      page.forTool('password').save(1, { length: 24 });
      await page.forTool('password').flush();
      expect(page.forTool('password').get().autoCopy).toBe(true);
      expect((storage.rows.get(TOOL_SETTINGS_KEY) as { tools: unknown }).tools).toEqual({
        password: { autoCopy: true },
      });
    });
  },
);

/** A page's environment for a source; the fixed ones read none of it. */
const SOURCE_ENV = {
  chrome: {
    storage: { local: fakeStorage().area, onChanged: fakeStorage().onChanged },
    runtime: { sendMessage: () => Promise.reject(new Error('no worker in this test')) },
  },
} as unknown as Parameters<EditionSourceFactory>[0];

const FIXED_SOURCES: readonly EditionSourceFactory[] = [fixedPro, fixedFree];

for (const factory of FIXED_SOURCES)
  editionSourceContract(factory.id, () => ({ open: () => factory(SOURCE_ENV), settle: () => Promise.resolve() }));

describe('the fixed sources', () => {
  it.each([
    ['fixedPro', fixedPro, 'pro'],
    ['fixedFree', fixedFree, 'free'],
  ] as const)('%s says the edition fixed at build time, already known', async (_name, factory, id) => {
    const source = factory(SOURCE_ENV);
    expect(source.id).toBe(factory.id);
    expect(source.current()).toEqual({ kind: 'fixed', edition: id });
    expect(await source.ready).toEqual({ kind: 'fixed', edition: id });
    expect(editionFor(source.current()).id).toBe(id);
  });
});

describe('editionFor — from a source’s state to the edition in force', () => {
  const facts = {
    lid: 'lic_TEST0000000001',
    checkedAt: 0,
    checkAfter: 1,
    warnFrom: 2,
    validUntil: 3,
    paidUntil: null,
  };
  const STATES: readonly (readonly [SourceState, Edition])[] = [
    [{ kind: 'active', licence: facts, due: false }, pro],
    [{ kind: 'grace', licence: facts }, pro],
    [{ kind: 'fixed', edition: 'pro' }, pro],
    [{ kind: 'fixed', edition: 'free' }, free],
    [{ kind: 'unknown' }, free],
    [{ kind: 'free' }, free],
    [{ kind: 'expired', licence: facts }, free],
    [{ kind: 'ended', licence: facts }, free],
    [{ kind: 'revoked', licence: facts, reason: 'refund' }, free],
    [{ kind: 'invalid', reason: 'signature' }, free],
  ];

  it.each(STATES.map(([state, edition]) => [state.kind, state, edition] as const))(
    '%s → its edition',
    (_kind, state, edition) => {
      expect(editionFor(state)).toBe(edition);
    },
  );

  it('takes the editions to choose between (a test, a later edition)', () => {
    const other = { ...free, id: 'free' as const };
    expect(editionFor({ kind: 'ended', licence: facts }, { pro, free: other })).toBe(other);
  });
});

describe('the edition’s composition root', () => {
  it('names a fixed source — Pro for now (no payment check yet; docs/defaults.md §2)', () => {
    expect(FIXED_SOURCES).toContain(editionSource);
    expect(editionSource.id).toBe('fixedPro');
    expect(editionFor(editionSource(SOURCE_ENV).current())).toBe(pro);
  });
});
