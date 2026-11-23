// @vitest-environment node
import { historyHost } from './behaviors';
import { HISTORY_DB } from './idbStore';
import { SESSION_KEYS_KEY } from './sessionKeyHolder';
import { HISTORY_SETTINGS_KEY } from './settings';
import { free } from '../edition/free';
import { pro } from '../edition/pro';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { HistoryChrome } from './behaviors';
import type { HistoryDeclaration } from '@workspace/tools-shared/history';

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
    const host = historyHost({ chrome: api, storage: { indexedDB: db.indexedDB }, tools: TOOLS, edition: pro });
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
    const host = historyHost({ chrome: api, storage: { indexedDB: db.indexedDB }, tools: TOOLS, edition: free });
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
      edition: pro,
    });
    await settle();
    await before.factory.forOwner('json', DECLARATION).session().commit({ kind: 'result', payload: 'kept' });
    expect(await countRecords(factory)).toBe(1);

    const db = watchedIndexedDb(factory);
    const freePage = historyHost({
      chrome: fakeChrome().api,
      storage: { indexedDB: db.indexedDB },
      tools: TOOLS,
      edition: free,
    });
    await settle();
    expect(await freePage.store.page({}, { limit: 10 })).toMatchObject({ rows: [] });
    await freePage.prune();
    expect(db.opened).toEqual([]);

    const after = historyHost({
      chrome: fakeChrome().api,
      storage: { indexedDB: { factory, keyRange: IDBKeyRange } },
      tools: TOOLS,
      edition: pro,
    });
    await settle();
    expect((await after.store.stats()).records).toBe(1);
  });
});
