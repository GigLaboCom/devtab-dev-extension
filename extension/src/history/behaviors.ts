/**
 * The composition root of the tool history in the extension (D17) — the one place that chooses what stands behind each
 * seam (docs/replaceable-behaviors.md):
 *
 *   HistoryStore     the edition's (seam Edition, src/edition — Pro: idbStore, the IndexedDB of the extension's origin;
 *                    free: an empty memoryStore nothing writes to); memoryStore in an incognito context
 *   HistoryCipher    passwordCipher — "none" until the user sets a master password (optional, off by default)
 *   KeyHolder        sessionKeyHolder (chrome.storage.session, memory only, shared by the tabs, idle lock)
 *   HistoryArchive   zipArchive (the tool-history archive, format 1)
 *   RetentionRule    ageAndBudget (the settings' retention period and size budget)
 *
 * and builds the factory every tool records through (ToolHost.history). Which edition is in force is seam
 * EditionSource's to say (src/edition/source.ts; the build's source is named by src/edition/index.ts), and the root
 * follows it while the page is open: its state becomes an Edition (editionFor), and whether the tools' work is recorded
 * at all is that edition's to say (`recording`, D25): where it is not, the gate tells every tool its history is off,
 * nothing opens the store or the key holder, and `included` tells the host's own places to say the history is not part
 * of this version. It also carries the tools' per-tool settings (ToolHost.settings, src/tools/settings.ts —
 * chrome.storage.local), with the tools' saved parameters in the storage of the edition in force (seam
 * ParameterStorage: the browser's storage — Pro — or none — free; src/edition/parameters.ts carries the page's choice
 * over when it changes), whether automatic copying exists (the edition's `automaticCopying`, D24), and what stands
 * behind the editor's profiles and a project's editor settings (the edition's `editorProfiles` and
 * `projectEditorSettings`, D39): this object is what the shell already hands to Tools and Settings, so these members
 * travel with the first.
 *
 * When the edition in force changes on an open page: the gate and automatic copying follow at once; free → Pro opens
 * the Pro store first (the same steps as at the start, the gate closed meanwhile) and only then switches the store and
 * the key holder (src/history/switching.ts) and opens the gate; Pro → free closes the gate first, then switches to an
 * empty store in memory and a key holder in memory — a record begun before reaches the database, and the key in
 * chrome.storage.session is left alone (another tab may still be in Pro). `onEdition` tells the pages.
 * Incognito: an extension page in spanning mode cannot run in an incognito window at all (probe), but if one ever does
 * (`chrome.extension.inIncognitoContext` — a split-mode manifest, a change of Chrome), nothing reaches the persistent
 * database: the store is in memory and the gate is closed.
 */
import { sessionKeyHolder } from './sessionKeyHolder';
import { historySettingsSource } from './settings';
import { historySources } from './sources';
import { switchingHolder, switchingStore } from './switching';
import pkg from '../../package.json';
import product from '../../product.json';
import { fixedSource } from '../edition/fixed';
import { editionFor } from '../edition/inForce';
import { editionParameterStorage } from '../edition/parameters';
import { extensionToolSettings } from '../tools/settings';
import { createDebug } from '@extension/logger';
import {
  ageAndBudget,
  createHistoryFactory,
  memoryKeyHolder,
  memoryStore,
  passwordCipher,
  zipArchive,
} from '@workspace/tools-shared/history';
import type { Edition, EditionHistory, OpenFilesEdition } from '../edition/edition';
import type { LicenceControls } from '../edition/licenceClient';
import type { EditionSource, SourceState } from '../edition/source';
import type { EditorProfilesStore } from '../editorSettings/profilesStore';
import type { ProjectEditorSettingsFactory } from '../editorSettings/project';
import type { IndexedDbApi } from './idbStore';
import type { SessionArea } from './sessionKeyHolder';
import type { HistorySettingsSource, SettingsArea, SettingsChanged } from './settings';
import type { HistorySource, Recordable } from './sources';
import type { ToolSettingsStore } from '@workspace/tools-host';
import type {
  GateState,
  HistoryArchive,
  HistoryFactory,
  HistoryGate,
  HistoryStore,
  KeyHolder,
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
  /**
   * The history is part of the edition in force now (it records, D25). `false`: nothing is recorded or read, and the
   * tool page's line, History and Settings → History say so in one sentence instead of offering the history. Read it
   * on each render: it can change (`onEdition`).
   */
  readonly included: boolean;
  producer: Producer;
  prune(): Promise<Measure>;
  /** The user did something (the idle lock's clock). */
  touch(): void;
  /** Something wrote to or deleted from the history in this page (lists refresh). */
  changed(): void;
  onChange(listener: () => void): () => void;
  /** The tools' per-tool settings (ToolHost.settings), in chrome.storage.local, followed live; parameters where the edition in force keeps them. */
  toolSettings: ToolSettingsStore;
  /**
   * "Copy automatically after generating" exists in the edition in force now (the edition's, D24): Settings → Tools
   * offers it, and the tools are told to copy after Generate while it is on (ToolHost.automaticCopying). `false`:
   * neither. Read it on each render: it can change (`onEdition`).
   */
  readonly automaticCopying: boolean;
  /**
   * The Projects section has scratch files in the edition in force now (the edition's `scratches`, D34). Read it on
   * each render: it can change (`onEdition`).
   */
  readonly scratches: boolean;
  /**
   * Where the editor's profiles besides Default are kept in the edition in force (seam `EditorProfilesStore`, D39): the
   * browser's storage (Pro), or none (free: nothing read or written). One object per edition, made when first asked.
   * Read it on each render: it can change (`onEdition`).
   */
  readonly editorProfiles: EditorProfilesStore;
  /**
   * What a project says about its files in the edition in force (seam `ProjectEditorSettings`, D39): its
   * `.editorconfig` (Pro), or nothing read at all (free). Read it on each render: it can change (`onEdition`).
   */
  readonly projectEditorSettings: ProjectEditorSettingsFactory;
  /**
   * What the Projects section does with a file opened from the system in the edition in force (the edition's
   * `openFiles`, D42): written as the companion allows (Pro), or shown read only (free). Read it on each render: it can
   * change (`onEdition`).
   */
  readonly openFiles: OpenFilesEdition;
  /** Called after `included`, `automaticCopying`, `scratches`, the editor's members (or the licence state) changed; returns the undo. */
  onEdition(listener: () => void): () => void;
  /** Settings → Pro: the licence's state and controls — only where the build follows a licence (source `licensed`). */
  readonly licence?: LicenceView;
}

/** What Settings → Pro reads of a licence: its controls (src/edition/licenceClient.ts) and the source's state now. */
export interface LicenceView extends LicenceControls {
  state(): SourceState;
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

/** Where the history may keep its records: IndexedDB of this origin, or a given store (in memory, for a host without storage). */
export type HistoryPlace = { indexedDB: IndexedDbApi } | { store: HistoryStore };

export interface HistoryEnvironment {
  chrome: HistoryChrome;
  /** The place offered for the records; whether and how it is used is the edition's choice (Edition.history). */
  storage: HistoryPlace;
  tools: readonly Recordable[];
  now?: () => number;
  /** Which edition is in force; absent: fixedSource('pro') — today's default build. Tests pass one. */
  source?: EditionSource;
}

type Holder = KeyHolder & { touch(): void; dispose(): void };
const memoryHolder = (): Holder => ({ ...memoryKeyHolder(), touch: () => {}, dispose: () => {} });

export const historyHost = (env: HistoryEnvironment): HistoryHost => {
  const now = env.now ?? Date.now;
  const source = env.source ?? fixedSource('pro');
  const incognito = env.chrome.extension?.inIncognitoContext === true;
  const settings = historySettingsSource(env.chrome.storage.local, env.chrome.storage.onChanged);
  // Built before the root follows the source, so its storage has switched when the pages hear of a change.
  const toolSettings = extensionToolSettings(
    env.chrome.storage.local,
    env.chrome.storage.onChanged,
    editionParameterStorage(source, { area: env.chrome.storage.local, onChanged: env.chrome.storage.onChanged }),
  );

  // What stands behind the history in each edition, asked of it once, when first needed.
  const histories = new Map<Edition, EditionHistory>();
  const historyOf = (edition: Edition): EditionHistory => {
    let kept = histories.get(edition);
    if (!kept) {
      kept = edition.history(env.storage);
      histories.set(edition, kept);
    }
    return kept;
  };
  // The master password's keys: chrome.storage.session where the edition records, memory elsewhere (each made once).
  let sessionHolder: Holder | undefined;
  let pageHolder: Holder | undefined;
  const holderFor = (recording: boolean): Holder =>
    incognito || !recording
      ? (pageHolder ??= memoryHolder())
      : (sessionHolder ??= sessionKeyHolder({
          area: env.chrome.storage.session,
          onChanged: env.chrome.storage.onChanged,
          idleMinutes: () => settings.get().idleLockMinutes,
          now,
        }));

  // Where each edition keeps the editor's profiles, asked of it once, when first needed.
  const profileStores = new Map<Edition, EditorProfilesStore>();
  const profilesOf = (edition: Edition): EditorProfilesStore => {
    let kept = profileStores.get(edition);
    if (!kept) {
      kept = edition.editorProfiles({
        area: env.chrome.storage.local,
        onChanged: env.chrome.storage.onChanged,
        areaName: 'local',
      });
      profileStores.set(edition, kept);
    }
    return kept;
  };

  /** The edition whose history is in use: the store and key holder below are its own, and the gate follows it. */
  let using = editionFor(source.current());
  const first = historyOf(using);
  const stores = switchingStore(incognito ? memoryStore() : first.store);
  const holders = switchingHolder(holderFor(first.recording));
  const store = stores.store;
  const vault = passwordCipher({ keyrings: store, holder: holders.holder, now });
  const sources = historySources(env.tools);

  let unavailable = false;
  const gateListeners = new Set<() => void>();
  const tellGate = () => gateListeners.forEach(l => l());
  const recordsNow = () => editionFor(source.current()) === using && historyOf(using).recording;
  const gate: HistoryGate = {
    state(owner): GateState {
      // The edition in force asked at each call: a gate never opens for an edition that is not (or not yet) in use.
      if (!recordsNow()) return 'off';
      if (incognito) return 'incognito';
      if (unavailable) return 'unavailable';
      const s = settings.get();
      return s.on && !s.off.includes(owner) ? 'on' : 'off';
    },
    subscribe(listener) {
      gateListeners.add(listener);
      return () => gateListeners.delete(listener);
    },
  };
  settings.subscribe(tellGate);

  const retention: RetentionRule = ageAndBudget(() => ({
    maxAgeDays: settings.get().retentionDays,
    budgetBytes: settings.get().budgetMiB * 1024 * 1024,
  }));
  const changeListeners = new Set<() => void>();
  const changed = () => changeListeners.forEach(l => l());
  const editionListeners = new Set<() => void>();
  const tellEdition = () =>
    editionListeners.forEach(l => {
      try {
        l();
      } catch (error) {
        debug.warn('edition listener', error);
      }
    });
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

  /**
   * Opens a recording edition's store — the database is opened (or not) here, and a browser that refuses IndexedDB
   * leaves the history unavailable — then puts it and its key holder in use. The gate stays closed until `using`
   * names the edition, which is the last step.
   */
  const open = async (edition: Edition, isCurrent: () => boolean): Promise<void> => {
    const kept = historyOf(edition);
    let failed = false;
    try {
      await kept.store.stats();
    } catch (error) {
      failed = true;
      debug.warn('open the history', error);
    }
    if (!isCurrent()) return;
    stores.use(kept.store);
    holders.use(holderFor(true));
    try {
      if (!failed) {
        await vault.refresh();
        await settings.ready;
        await prune();
      }
    } catch (error) {
      failed = true;
      debug.warn('open the history', error);
    }
    if (!isCurrent()) return;
    unavailable = failed;
  };

  /** Every change of the source starts a new generation; an opening that finishes in an older one changes nothing. */
  let generation = 0;

  // The first edition, as the page opens: its gate is open at once (records wait for the database), as before.
  if (!incognito && first.recording) void open(using, () => generation === 0).then(tellGate);

  source.subscribe(state => {
    const mine = ++generation;
    const next = editionFor(state);
    if (next === using) {
      // Another state of the same edition (active → grace), or back before an opening finished: its own store again.
      if (!incognito) {
        stores.use(historyOf(using).store);
        holders.use(holderFor(historyOf(using).recording));
      }
      tellGate();
      tellEdition();
      return;
    }
    const nextHistory = historyOf(next);
    if (incognito || !nextHistory.recording) {
      // Pro → free: the gate closes first (`using` is what it reads), then the store and the key holder change.
      using = next;
      tellGate();
      if (!incognito) {
        stores.use(nextHistory.store);
        holders.use(holderFor(false));
      }
      changed();
      tellEdition();
      return;
    }
    // Free → Pro: automatic copying follows at once; the history once its store is open, the gate closed meanwhile.
    tellGate();
    tellEdition();
    const isCurrent = () => mine === generation;
    void open(next, isCurrent).then(() => {
      if (!isCurrent()) return;
      using = next;
      tellGate();
      changed();
      tellEdition();
    });
  });

  return {
    factory,
    store,
    vault,
    archive: zipArchive,
    settings,
    sources,
    gate,
    incognito,
    get included() {
      return historyOf(using).recording;
    },
    producer: { name: product.name, version: pkg.version },
    prune,
    touch: () => holders.holder.touch(),
    changed,
    onChange: listener => {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
    toolSettings,
    get automaticCopying() {
      return editionFor(source.current()).automaticCopying;
    },
    get scratches() {
      return editionFor(source.current()).scratches;
    },
    get editorProfiles() {
      return profilesOf(editionFor(source.current()));
    },
    get projectEditorSettings() {
      return editionFor(source.current()).projectEditorSettings;
    },
    get openFiles() {
      return editionFor(source.current()).openFiles;
    },
    onEdition: listener => {
      editionListeners.add(listener);
      return () => editionListeners.delete(listener);
    },
    ...(source.licence && { licence: { ...source.licence, state: () => source.current() } }),
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

/** A history host that keeps everything in this page's memory: the default when the app is given none. `source` as in historyHost. */
export const memoryHistoryHost = (tools: readonly Recordable[], source?: EditionSource): HistoryHost =>
  historyHost({ chrome: memoryChrome(), storage: { store: memoryStore() }, tools, source });
