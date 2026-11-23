// @vitest-environment node
import { historyHost } from './behaviors';
import { HISTORY_DB } from './idbStore';
import { SESSION_KEYS_KEY } from './sessionKeyHolder';
import { HISTORY_SETTINGS_KEY } from './settings';
import { fixedSource } from '../edition/fixed';
import { FREE, PRO, switchableSource } from '../test/switchableSource';
import { memoryStore } from '@workspace/tools-shared/history';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { HistoryChrome } from './behaviors';
import type { HistoryDeclaration, HistoryStore } from '@workspace/tools-shared/history';

type Listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;

/** chrome.storage.local and .session over maps, one onChanged for both (as Chrome has). */
const fakeChrome = (incognito = false) => {
  const listeners = new Set<Listener>();
  const area = (name: string) => {
    const rows = new Map<string, unknown>();
    return {
      rows,
      get: async (keys: string | string[]) =>
        Object.fromEntries(
          [keys]
            .flat()
            .filter(k => rows.has(k))
            .map(k => [k, rows.get(k)]),
        ),
      set: async (items: Record<string, unknown>) => {
        const changes: Record<string, chrome.storage.StorageChange> = {};
        for (const [k, v] of Object.entries(items)) {
          changes[k] = { oldValue: rows.get(k), newValue: v };
          rows.set(k, JSON.parse(JSON.stringify(v)));
        }
        listeners.forEach(l => l(changes, name));
      },
      remove: async (keys: string | string[]) => {
        const changes: Record<string, chrome.storage.StorageChange> = {};
        for (const key of [keys].flat()) {
          changes[key] = { oldValue: rows.get(key) };
          rows.delete(key);
        }
        listeners.forEach(l => l(changes, name));
      },
    };
  };
  const local = area('local');
  const session = area('session');
  const api = {
    storage: {
      local,
      session,
      onChanged: {
        addListener: (l: Listener) => void listeners.add(l),
        removeListener: (l: Listener) => void listeners.delete(l),
      },
    },
    extension: { inIncognitoContext: incognito },
  } as unknown as HistoryChrome;
  return { api, local, session };
};

const DECLARATION: HistoryDeclaration = {
  kinds: [
    { id: 'result', title: 'Result' },
    { id: 'secret', title: 'Secret', secret: true },
  ],
  schema: 1,
  records: '',
  never: '',
};
const TOOLS = [
  { id: 'json', title: 'JSON', history: DECLARATION },
  { id: 'password', title: 'Password Generator' },
];
const settle = () => new Promise(r => setTimeout(r, 20));
/** Waits until `ready()` holds (an opening over IndexedDB takes longer on a busy machine), at most 5 s. */
const until = async (ready: () => boolean) => {
  for (const started = Date.now(); !ready(); await settle())
    if (Date.now() - started > 5_000) throw new Error('waited 5 s in vain');
};

const countRecords = (factory: IDBFactory) =>
  new Promise<number>((resolve, reject) => {
    const open = factory.open(HISTORY_DB);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('records')) return resolve(0);
      const c = db.transaction('records').objectStore('records').count();
      c.onsuccess = () => resolve(c.result);
      c.onerror = () => reject(c.error);
    };
    open.onerror = () => reject(open.error);
  });

describe('the history composition root', () => {
  it('records into IndexedDB, and follows the master switch and the per-owner switch', async () => {
    const { api, local } = fakeChrome();
    const factory = new IDBFactory();
    const host = historyHost({ chrome: api, storage: { indexedDB: { factory, keyRange: IDBKeyRange } }, tools: TOOLS });
    await settle();
    expect(host.sources.map(s => [s.owner, s.declaration.kinds.length])).toEqual([
      ['json', 2],
      ['password', 0],
    ]);
    const history = host.factory.forOwner('json', DECLARATION);
    expect((await history.session().commit({ kind: 'result', payload: 1 })).recorded).toBe(true);
    expect(await countRecords(factory)).toBe(1);

    await local.set({ [HISTORY_SETTINGS_KEY]: { on: false } });
    expect(history.status().gate).toBe('off');
    expect(await history.session().commit({ kind: 'result', payload: 2 })).toEqual({ recorded: false, reason: 'off' });
    await local.set({ [HISTORY_SETTINGS_KEY]: { on: true, off: ['json'] } });
    expect(history.status().gate).toBe('off');
    await local.set({ [HISTORY_SETTINGS_KEY]: { on: true } });
    expect((await history.session().commit({ kind: 'result', payload: 3 })).recorded).toBe(true);
    expect(await countRecords(factory)).toBe(2);
  });

  it('in an incognito context records nothing and never opens the persistent database', async () => {
    const { api } = fakeChrome(true);
    const factory = new IDBFactory();
    const opened: string[] = [];
    const watched = new Proxy(factory, {
      get: (target, key) =>
        key === 'open'
          ? (name: string, v?: number) => (opened.push(name), target.open(name, v))
          : Reflect.get(target, key),
    });
    const host = historyHost({
      chrome: api,
      storage: { indexedDB: { factory: watched, keyRange: IDBKeyRange } },
      tools: TOOLS,
    });
    await settle();
    expect(host.incognito).toBe(true);
    const history = host.factory.forOwner('json', DECLARATION);
    expect(history.status().gate).toBe('incognito');
    const recorder = history.session();
    expect(await recorder.commit({ kind: 'result', payload: 1 })).toEqual({ recorded: false, reason: 'off' });
    recorder.change({ kind: 'result', payload: 2 });
    await recorder.flush();
    expect(opened).toEqual([]);
    expect((await host.store.stats()).records).toBe(0);
  });

  it('a master password: unlocks in one page, the other page follows; lock locks both; the raw key is only in session storage', async () => {
    const { api, session, local } = fakeChrome();
    const factory = new IDBFactory();
    const env = { chrome: api, storage: { indexedDB: { factory, keyRange: IDBKeyRange } }, tools: TOOLS };
    const pageA = historyHost(env);
    const pageB = historyHost(env);
    await settle();
    await pageA.vault.setPassword('a throwaway test passphrase');
    await settle();
    expect(pageB.vault.state()).toBe('unlocked');
    const held = session.rows.get(SESSION_KEYS_KEY) as { keys: Record<string, string> };
    expect(Object.keys(held.keys)).toEqual([pageA.vault.activeKid()]);
    expect(JSON.stringify([...local.rows])).not.toContain(Object.values(held.keys)[0]);

    const secret = pageB.factory.forOwner('json', DECLARATION);
    const outcome = await secret.session().commit({ kind: 'secret', payload: { s: 'value' } });
    expect(outcome.recorded).toBe(true);
    const id = outcome.recorded ? outcome.id : '';
    expect(await pageA.factory.forOwner('json', DECLARATION).open(id)).toMatchObject({
      ok: true,
      payload: { s: 'value' },
    });

    await pageA.vault.lock();
    await settle();
    expect(pageB.vault.state()).toBe('locked');
    expect(session.rows.has(SESSION_KEYS_KEY)).toBe(false);
    expect(await secret.open(id)).toEqual({ ok: false, reason: 'locked' });
  });

  it('locks after the idle time', async () => {
    const { api } = fakeChrome();
    let t = Date.UTC(2026, 10, 21, 9);
    const host = historyHost({
      chrome: api,
      storage: { indexedDB: { factory: new IDBFactory(), keyRange: IDBKeyRange } },
      tools: TOOLS,
      now: () => t,
    });
    await settle();
    await host.vault.setPassword('a throwaway test passphrase');
    t += 14 * 60_000;
    host.touch();
    await settle();
    t += 14 * 60_000;
    await host.vault.refresh();
    expect(host.vault.state()).toBe('unlocked'); // 14 minutes after the last activity
    t += 2 * 60_000;
    await host.vault.refresh();
    expect(host.vault.state()).toBe('locked'); // 16 minutes: past the default 15
  });

  it('activity marked at the moment of a lock never undoes the lock', async () => {
    const { api, session } = fakeChrome();
    let t = Date.UTC(2026, 10, 21, 9);
    const host = historyHost({
      chrome: api,
      storage: { indexedDB: { factory: new IDBFactory(), keyRange: IDBKeyRange } },
      tools: TOOLS,
      now: () => t,
    });
    await settle();
    await host.vault.setPassword('a throwaway test passphrase');
    t += 60_000;
    host.touch(); // reads the keys, then writes its mark…
    await host.vault.lock(); // …while another page locks
    await settle();
    expect(session.rows.has(SESSION_KEYS_KEY)).toBe(false);
    await host.vault.refresh();
    expect(host.vault.state()).toBe('locked');
  });
});

describe('the history root follows the edition (D25)', () => {
  /** An IndexedDB that notes every database a page opens. */
  const watchedIndexedDb = (factory: IDBFactory) => {
    const opened: string[] = [];
    const watched = new Proxy(factory, {
      get: (target, key) =>
        key === 'open'
          ? (name: string, v?: number) => (opened.push(name), target.open(name, v))
          : Reflect.get(target, key),
    });
    return { opened, indexedDB: { factory: watched, keyRange: IDBKeyRange } };
  };

  it('Pro records into IndexedDB and says the history is part of the build', async () => {
    const { api } = fakeChrome();
    const db = watchedIndexedDb(new IDBFactory());
    const host = historyHost({
      chrome: api,
      storage: { indexedDB: db.indexedDB },
      tools: TOOLS,
      source: fixedSource('pro'),
    });
    await settle();
    expect([host.included, host.automaticCopying]).toEqual([true, true]);
    const history = host.factory.forOwner('json', DECLARATION);
    expect(history.status().gate).toBe('on');
    expect((await history.session().commit({ kind: 'result', payload: 1 })).recorded).toBe(true);
    expect(db.opened).toContain(HISTORY_DB);
  });

  it('free: nothing is recorded — not to IndexedDB, not to memory —, the database is never opened, chrome.storage.session is never touched', async () => {
    const { api, session } = fakeChrome();
    const sessionCalls: string[] = [];
    for (const method of ['get', 'set', 'remove'] as const) {
      const real = session[method] as (...args: unknown[]) => Promise<unknown>;
      (session as Record<string, unknown>)[method] = (...args: unknown[]) => (sessionCalls.push(method), real(...args));
    }
    const db = watchedIndexedDb(new IDBFactory());
    const host = historyHost({
      chrome: api,
      storage: { indexedDB: db.indexedDB },
      tools: TOOLS,
      source: fixedSource('free'),
    });
    await settle();
    expect([host.included, host.automaticCopying]).toEqual([false, false]);
    const history = host.factory.forOwner('json', DECLARATION);
    expect(history.status().gate).toBe('off');
    const recorder = history.session();
    expect(await recorder.commit({ kind: 'result', payload: 1 })).toEqual({ recorded: false, reason: 'off' });
    recorder.change({ kind: 'result', payload: 2 });
    await recorder.flush();
    await recorder.end();
    await settle();
    expect((await host.store.stats()).records).toBe(0);
    expect(db.opened).toEqual([]);
    expect(sessionCalls).toEqual([]);
  });

  it('free: what a Pro build kept in the profile is neither opened, read nor deleted — Pro finds it as it was', async () => {
    const factory = new IDBFactory();
    const before = historyHost({
      chrome: fakeChrome().api,
      storage: { indexedDB: { factory, keyRange: IDBKeyRange } },
      tools: TOOLS,
      source: fixedSource('pro'),
    });
    await settle();
    await before.factory.forOwner('json', DECLARATION).session().commit({ kind: 'result', payload: 'kept' });
    expect(await countRecords(factory)).toBe(1);

    const db = watchedIndexedDb(factory);
    const freePage = historyHost({
      chrome: fakeChrome().api,
      storage: { indexedDB: db.indexedDB },
      tools: TOOLS,
      source: fixedSource('free'),
    });
    await settle();
    expect(await freePage.store.page({}, { limit: 10 })).toMatchObject({ rows: [] });
    await freePage.prune();
    expect(db.opened).toEqual([]);

    const after = historyHost({
      chrome: fakeChrome().api,
      storage: { indexedDB: { factory, keyRange: IDBKeyRange } },
      tools: TOOLS,
      source: fixedSource('pro'),
    });
    await settle();
    expect((await after.store.stats()).records).toBe(1);
  });
});

describe('the history root follows the source on an open page', () => {
  /** A store in memory whose opening (its first `stats`) a test can hold back; `opened` counts the openings. */
  const heldStore = () => {
    const inner = memoryStore();
    let release: () => void = () => undefined;
    let held: Promise<void> = Promise.resolve();
    const state = { opened: 0 };
    const store: HistoryStore = {
      ...inner,
      stats: async () => {
        state.opened += 1;
        await held;
        return inner.stats();
      },
    };
    return {
      store,
      state,
      hold: () => void (held = new Promise(resolve => (release = resolve))),
      release: () => release(),
    };
  };
  /** An IndexedDB that notes every database a page opens. */
  const watchedIndexedDb = (factory: IDBFactory) => {
    const opened: string[] = [];
    const watched = new Proxy(factory, {
      get: (target, key) =>
        key === 'open'
          ? (name: string, v?: number) => (opened.push(name), target.open(name, v))
          : Reflect.get(target, key),
    });
    return { opened, indexedDB: { factory: watched, keyRange: IDBKeyRange } };
  };

  it('free → Pro: the database opens only now, the gate stays closed until it is open; automatic copying at once', async () => {
    const { api, session } = fakeChrome();
    const sessionCalls: string[] = [];
    for (const method of ['get', 'set', 'remove'] as const) {
      const real = session[method] as (...args: unknown[]) => Promise<unknown>;
      (session as Record<string, unknown>)[method] = (...args: unknown[]) => (sessionCalls.push(method), real(...args));
    }
    const pro = heldStore();
    const source = switchableSource(FREE);
    const host = historyHost({ chrome: api, storage: { store: pro.store }, tools: TOOLS, source });
    const told: Array<[boolean, boolean]> = [];
    host.onEdition(() => told.push([host.included, host.automaticCopying]));
    const history = host.factory.forOwner('json', DECLARATION);
    await settle();
    expect([host.included, host.automaticCopying, history.status().gate]).toEqual([false, false, 'off']);
    expect(pro.state.opened).toBe(0);
    expect(sessionCalls).toEqual([]);

    pro.hold();
    source.set(PRO);
    expect(host.automaticCopying).toBe(true);
    await settle();
    expect(pro.state.opened).toBe(1);
    // Opening: closed, and the places still say the history is not part of the edition.
    expect([host.included, history.status().gate]).toEqual([false, 'off']);
    expect(await history.session().commit({ kind: 'result', payload: 'too early' })).toEqual({
      recorded: false,
      reason: 'off',
    });
    pro.release();
    await until(() => host.included);
    expect([host.included, history.status().gate]).toEqual([true, 'on']);
    expect(told.at(0)).toEqual([false, true]);
    expect(told.at(-1)).toEqual([true, true]);
    expect((await history.session().commit({ kind: 'result', payload: 1 })).recorded).toBe(true);
    expect((await pro.store.page({}, { limit: 10 })).rows).toHaveLength(1);
  });

  it('free → Pro over IndexedDB: the database is opened only after the change', async () => {
    const { api } = fakeChrome();
    const db = watchedIndexedDb(new IDBFactory());
    const source = switchableSource(FREE);
    const host = historyHost({ chrome: api, storage: { indexedDB: db.indexedDB }, tools: TOOLS, source });
    await settle();
    expect(db.opened).toEqual([]);
    source.set(PRO);
    const history = host.factory.forOwner('json', DECLARATION);
    await until(() => history.status().gate === 'on');
    expect(new Set(db.opened)).toEqual(new Set([HISTORY_DB]));
  });

  it('Pro → free: the gate closes before the store changes; what was recorded stays in the database; session storage is left alone', async () => {
    const { api, session } = fakeChrome();
    const factory = new IDBFactory();
    const source = switchableSource(PRO);
    const host = historyHost({
      chrome: api,
      storage: { indexedDB: { factory, keyRange: IDBKeyRange } },
      tools: TOOLS,
      source,
    });
    await settle();
    await host.vault.setPassword('a throwaway test passphrase');
    await settle();
    expect(session.rows.has(SESSION_KEYS_KEY)).toBe(true);
    const history = host.factory.forOwner('json', DECLARATION);
    expect(history.status().gate).toBe('on');

    expect((await history.session().commit({ kind: 'result', payload: 'kept in Pro' })).recorded).toBe(true);
    // What the gate says, and which store is in use, when the gate's listeners are told of the change.
    const told: Array<Promise<[string, number]>> = [];
    host.gate.subscribe(() =>
      told.push(host.store.stats().then(stats => [history.status().gate, stats.records] as [string, number])),
    );
    source.set(FREE);
    // The gate was closed while the Pro store (its one record) was still the one in use.
    expect(await told[0]).toEqual(['off', 1]);
    expect([host.included, host.automaticCopying]).toEqual([false, false]);
    expect(await countRecords(factory)).toBe(1);
    // In the free one the store is an empty one in memory, and nothing is recorded.
    expect((await host.store.stats()).records).toBe(0);
    expect(await history.session().commit({ kind: 'result', payload: 2 })).toEqual({ recorded: false, reason: 'off' });
    expect(await countRecords(factory)).toBe(1);
    expect(session.rows.has(SESSION_KEYS_KEY)).toBe(true);

    // And back: the same database, its records and its keyring again.
    source.set(PRO);
    await until(() => host.included);
    expect([host.included, history.status().gate]).toEqual([true, 'on']);
    expect((await host.store.stats()).records).toBe(1);
    expect(host.vault.hasPassword()).toBe(true);
  });

  it('back to free before the database finished opening: nothing switches to Pro', async () => {
    const { api } = fakeChrome();
    const pro = heldStore();
    const source = switchableSource(FREE);
    const host = historyHost({ chrome: api, storage: { store: pro.store }, tools: TOOLS, source });
    await settle();
    pro.hold();
    source.set(PRO);
    await settle();
    source.set(FREE);
    pro.release();
    await settle();
    expect([host.included, host.automaticCopying]).toEqual([false, false]);
    expect(host.factory.forOwner('json', DECLARATION).status().gate).toBe('off');
    await host.store.putKeyring('probe', 'line');
    expect((await pro.store.keyrings()).size).toBe(0);
  });

  it('another state of the same edition changes nothing but tells the pages', async () => {
    const { api } = fakeChrome();
    const source = switchableSource(PRO);
    const host = historyHost({
      chrome: api,
      storage: { indexedDB: { factory: new IDBFactory(), keyRange: IDBKeyRange } },
      tools: TOOLS,
      source,
    });
    await settle();
    let told = 0;
    host.onEdition(() => told++);
    if (PRO.kind === 'active') source.set({ kind: 'grace', licence: PRO.licence });
    expect(told).toBe(1);
    expect([host.included, host.automaticCopying]).toEqual([true, true]);
    expect(host.factory.forOwner('json', DECLARATION).status().gate).toBe('on');
  });

  it('the tools’ saved parameters follow the edition too (keeps)', async () => {
    const { api } = fakeChrome();
    const source = switchableSource(FREE);
    const host = historyHost({
      chrome: api,
      storage: { indexedDB: { factory: new IDBFactory(), keyRange: IDBKeyRange } },
      tools: TOOLS,
      source,
    });
    await host.toolSettings.readyFor('json');
    const json = host.toolSettings.forTool('json');
    json.declare(saved => saved !== undefined);
    json.save(1, { indent: 4 });
    await json.flush();
    expect(json.changed()).toBe(false);
    source.set(PRO);
    await settle();
    expect(json.changed()).toBe(true);
  });

  it('in an incognito context the database is never opened, whatever the edition', async () => {
    const { api } = fakeChrome(true);
    const db = watchedIndexedDb(new IDBFactory());
    const source = switchableSource(FREE);
    const host = historyHost({ chrome: api, storage: { indexedDB: db.indexedDB }, tools: TOOLS, source });
    source.set(PRO);
    await settle();
    expect(host.factory.forOwner('json', DECLARATION).status().gate).toBe('incognito');
    expect(db.opened).toEqual([]);
  });
});
