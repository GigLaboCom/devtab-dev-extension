/**
 * The composition root of the tool history in the extension (D17) — the one place that chooses what stands behind each
 * seam (docs/replaceable-behaviors.md):
 *
 *   HistoryStore     idbStore (IndexedDB of the extension's origin); memoryStore in an incognito context
 *   HistoryCipher    passwordCipher — "none" until the user sets a master password (optional, off by default)
 *   KeyHolder        sessionKeyHolder (chrome.storage.session, memory only, shared by the tabs, idle lock)
 *   HistoryArchive   zipArchive (the tool-history archive, format 1)
 *   RetentionRule    ageAndBudget (the settings' retention period and size budget)
 *
 * and builds the factory every tool records through (ToolHost.history). Incognito: an extension page in spanning mode
 * cannot run in an incognito window at all (probe), but if one ever does (`chrome.extension.inIncognitoContext` — a
 * split-mode manifest, a change of Chrome), nothing reaches the persistent database: the store is in memory and the gate
 * is closed.
 */
import { idbStore } from './idbStore';
import { sessionKeyHolder } from './sessionKeyHolder';
import { historySettingsSource } from './settings';
import { historySources } from './sources';
import pkg from '../../package.json';
import product from '../../product.json';
import { createDebug } from '@extension/logger';
import {
  ageAndBudget,
  createHistoryFactory,
  memoryKeyHolder,
  memoryStore,
  passwordCipher,
  zipArchive,
} from '@workspace/tools-shared/history';
import type { SessionArea } from './sessionKeyHolder';
import type { HistorySettingsSource, SettingsArea, SettingsChanged } from './settings';
import type { HistorySource, Recordable } from './sources';
import type {
  GateState,
  HistoryArchive,
  HistoryFactory,
  HistoryGate,
  HistoryStore,
  Measure,
  PasswordVault,
  Producer,
  RetentionRule,
} from '@workspace/tools-shared/history';

const debug = createDebug('extension:history');

/** Prune at most this often after writes. */
const PRUNE_EVERY_MS = 60_000;

export interface HistoryHost {
  factory: HistoryFactory;
  store: HistoryStore;
  vault: PasswordVault;
  archive: HistoryArchive;
  settings: HistorySettingsSource;
  sources: readonly HistorySource[];
  gate: HistoryGate;
  /** This page is in an incognito context: nothing is recorded or kept. */
  incognito: boolean;
  producer: Producer;
  prune(): Promise<Measure>;
  /** The user did something (the idle lock's clock). */
  touch(): void;
  /** Something wrote to or deleted from the history in this page (lists refresh). */
  changed(): void;
  onChange(listener: () => void): () => void;
}

/** The parts of `chrome` the history uses. */
export interface HistoryChrome {
  storage: {
    local: SettingsArea;
    session: SessionArea;
    onChanged: SettingsChanged;
  };
  extension?: { inIncognitoContext?: boolean };
}

export interface HistoryEnvironment {
  chrome: HistoryChrome;
  /** Where records go: IndexedDB of this origin, or a given store (an in-memory one, for a host without storage). */
  storage: { indexedDB: { factory: IDBFactory; keyRange: typeof IDBKeyRange } } | { store: HistoryStore };
  tools: readonly Recordable[];
  now?: () => number;
}

export const historyHost = (env: HistoryEnvironment): HistoryHost => {
  const now = env.now ?? Date.now;
  const incognito = env.chrome.extension?.inIncognitoContext === true;
  const settings = historySettingsSource(env.chrome.storage.local, env.chrome.storage.onChanged);
  const store = incognito
    ? memoryStore()
    : 'store' in env.storage
      ? env.storage.store
      : idbStore(env.storage.indexedDB);
  const holder = incognito
    ? { ...memoryKeyHolder(), touch: () => {}, dispose: () => {} }
    : sessionKeyHolder({
        area: env.chrome.storage.session,
        onChanged: env.chrome.storage.onChanged,
        idleMinutes: () => settings.get().idleLockMinutes,
        now,
      });
  const vault = passwordCipher({ keyrings: store, holder, now });
  const sources = historySources(env.tools);

  let unavailable = false;
  const listeners = new Set<() => void>();
  const gate: HistoryGate = {
    state(owner): GateState {
      if (incognito) return 'incognito';
      if (unavailable) return 'unavailable';
      const s = settings.get();
      return s.on && !s.off.includes(owner) ? 'on' : 'off';
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  settings.subscribe(() => listeners.forEach(l => l()));

  const retention: RetentionRule = ageAndBudget(() => ({
    maxAgeDays: settings.get().retentionDays,
    budgetBytes: settings.get().budgetMiB * 1024 * 1024,
  }));
  const changeListeners = new Set<() => void>();
  const changed = () => changeListeners.forEach(l => l());
  let lastPrune = 0;
  const prune = async (): Promise<Measure> => {
    lastPrune = now();
    return retention.prune(store, now());
  };

  const factory = createHistoryFactory({
    store,
    cipher: vault,
    gate,
    onWritten: () => {
      changed();
      if (now() - lastPrune > PRUNE_EVERY_MS) prune().catch(e => debug.warn('prune', e));
    },
    onError: (what, error) => debug.warn(what, error),
  });

  if (!incognito) {
    // The database opens (or not) once per page: a browser that refuses IndexedDB leaves the history unavailable.
    store
      .stats()
      .then(() => vault.refresh())
      .then(() => settings.ready)
      .then(() => prune())
      .catch(error => {
        unavailable = true;
        listeners.forEach(l => l());
        debug.warn('open the history', error);
      });
  }

  return {
    factory,
    store,
    vault,
    archive: zipArchive,
    settings,
    sources,
    gate,
    incognito,
    producer: { name: product.name, version: pkg.version },
    prune,
    touch: () => holder.touch(),
    changed,
    onChange: listener => {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
  };
};

/** chrome.storage.local and .session in memory, for a host without them (tests, a page outside the extension). */
const memoryChrome = (): HistoryChrome => {
  type Listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;
  const listeners = new Set<Listener>();
  const area = (name: string) => {
    const rows = new Map<string, unknown>();
    return {
      get: async (keys: string | string[]) =>
        Object.fromEntries(
          [keys]
            .flat()
            .filter(k => rows.has(k))
            .map(k => [k, rows.get(k)]),
        ),
      set: async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) {
          const oldValue = rows.get(k);
          rows.set(k, v);
          listeners.forEach(l => l({ [k]: { oldValue, newValue: v } }, name));
        }
      },
      remove: async (keys: string | string[]) => {
        for (const key of [keys].flat()) {
          const oldValue = rows.get(key);
          rows.delete(key);
          listeners.forEach(l => l({ [key]: { oldValue } }, name));
        }
      },
    };
  };
  return {
    storage: {
      local: area('local') as unknown as SettingsArea,
      session: area('session') as unknown as SessionArea,
      onChanged: {
        addListener: (l: Listener) => void listeners.add(l),
        removeListener: (l: Listener) => void listeners.delete(l),
      } as unknown as SettingsChanged,
    },
  };
};

/** A history host that keeps everything in this page's memory: the default when the app is given none. */
export const memoryHistoryHost = (tools: readonly Recordable[]): HistoryHost =>
  historyHost({ chrome: memoryChrome(), storage: { store: memoryStore() }, tools });
