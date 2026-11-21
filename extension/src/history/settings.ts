/**
 * The history's settings (D17), kept like every other setting in chrome.storage.local and broadcast by its onChanged:
 * the master switch, how long entries are kept, the size budget, the idle time after which an unlocked master password
 * locks again, and a switch per owner (only the owners the user turned off are stored).
 */
export const HISTORY_SETTINGS_KEY = 'historySettings';

export interface HistorySettings {
  v: 1;
  on: boolean;
  retentionDays: number;
  budgetMiB: number;
  idleLockMinutes: number;
  /** Owners switched off by the user (absent: on). */
  off: readonly string[];
}

/** Choices the settings offer; the default is the middle one. Numbers: docs/research/history-storage-probe.md. */
export const RETENTION_DAYS = [7, 30, 90, 365] as const;
export const BUDGET_MIB = [64, 256, 1024] as const;
export const IDLE_LOCK_MINUTES = [5, 15, 60] as const;

export const DEFAULT_HISTORY_SETTINGS: HistorySettings = {
  v: 1,
  on: true,
  retentionDays: 30,
  budgetMiB: 256,
  idleLockMinutes: 15,
  off: [],
};

const pick = <T extends number>(value: unknown, choices: readonly T[], fallback: T): T =>
  choices.includes(value as T) ? (value as T) : fallback;

export const normalizeHistorySettings = (raw: unknown): HistorySettings => {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Record<keyof HistorySettings, unknown>>;
  const d = DEFAULT_HISTORY_SETTINGS;
  return {
    v: 1,
    on: typeof r.on === 'boolean' ? r.on : d.on,
    retentionDays: pick(r.retentionDays, RETENTION_DAYS, d.retentionDays),
    budgetMiB: pick(r.budgetMiB, BUDGET_MIB, d.budgetMiB),
    idleLockMinutes: pick(r.idleLockMinutes, IDLE_LOCK_MINUTES, d.idleLockMinutes),
    off: Array.isArray(r.off) ? [...new Set(r.off.filter((x): x is string => typeof x === 'string'))] : [],
  };
};

export type SettingsArea = Pick<chrome.storage.StorageArea, 'get' | 'set'>;
export type SettingsChanged = Pick<chrome.storage.StorageChangedEvent, 'addListener' | 'removeListener'>;

/** The settings as a small observable: `get()` is the last known value (defaults until the first read). */
export interface HistorySettingsSource {
  get(): HistorySettings;
  subscribe(listener: () => void): () => void;
  save(next: HistorySettings): Promise<void>;
  /** Resolves after the first read from storage. */
  ready: Promise<void>;
}

export const historySettingsSource = (area: SettingsArea, onChanged: SettingsChanged): HistorySettingsSource => {
  let current = DEFAULT_HISTORY_SETTINGS;
  const listeners = new Set<() => void>();
  const set = (raw: unknown) => {
    current = normalizeHistorySettings(raw);
    listeners.forEach(l => l());
  };
  onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && HISTORY_SETTINGS_KEY in changes) set(changes[HISTORY_SETTINGS_KEY].newValue);
  });
  const ready = area.get(HISTORY_SETTINGS_KEY).then(
    items => set(items[HISTORY_SETTINGS_KEY]),
    () => undefined,
  );
  return {
    get: () => current,
    subscribe: l => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    save: next => area.set({ [HISTORY_SETTINGS_KEY]: normalizeHistorySettings(next) }),
    ready,
  };
};
