/**
 * `EditorSettingsStore` in a storage area (./store.ts): the extension's `chrome.storage.local` (`chromeEditorSettings`),
 * or an area in the page's memory (`memoryEditorSettings`: a host without the extension's API, and tests). One record,
 * `editorSettings` — the Default set, versioned from the start (./model.ts); this store reads and writes no other. A
 * record of another shape is read as far as it makes sense and is not deleted for it. `areaRecord` is the same for
 * any one record: the profiles' store (./profilesStore.ts) is made of it too.
 */
import { RECORD_MAX_CHARS, normalizeEditorSettings } from './model';
import type { EditorSettingsRecord } from './model';
import type { EditorSettingsRefusal, EditorSettingsStore } from './store';

/** chrome.storage.local key of the Default set. (The profiles have a record of their own: ./profilesStore.ts.) */
export const EDITOR_SETTINGS_KEY = 'editorSettings';

/** What the store needs of a storage area: `chrome.storage.local`'s promise form and the change event. */
export interface EditorSettingsArea {
  area: Pick<chrome.storage.StorageArea, 'get' | 'set'>;
  onChanged: Pick<chrome.storage.StorageChangedEvent, 'addListener' | 'removeListener'>;
  /** The area's name in the change event (`local`). */
  areaName: string;
}

const refusalOf = (error: unknown): EditorSettingsRefusal => {
  const message = error instanceof Error ? error.message : String(error);
  // Chrome's answer when the area is over its quota: "QUOTA_BYTES quota exceeded" (or a …_PER_ITEM one).
  return /quota/i.test(message) ? { kind: 'full' } : { kind: 'failed', message };
};

/** One record of a storage area: its key, how it is read back, the longest written. */
export interface RecordShape<T> {
  key: string;
  normalize(raw: unknown): T;
  maxChars: number;
}

/** What a store of one record does — read, normalize and write it, follow its changes — whatever the record. */
export interface AreaRecord<T> {
  load(): Promise<T>;
  save(record: T): Promise<{ ok: true; value: T } | { ok: false; refused: EditorSettingsRefusal }>;
  watch(onRecord: (record: T) => void): () => void;
}

/**
 * One record kept in a storage area: written normalized and refused (an answer, never an exception) when longer than
 * its limit or when the area is full; `watch` answers with the stored record, then every change from any page. Shared
 * by the Default set (`editorSettings`) and the profiles (`editorProfiles`, ./profilesStore.ts).
 */
export const areaRecord = <T>(
  shape: RecordShape<T>,
  { area, onChanged, areaName }: EditorSettingsArea,
): AreaRecord<T> => {
  const { key, normalize, maxChars } = shape;
  const load = async (): Promise<T> => normalize((await area.get(key))[key]);
  return {
    load,
    async save(record) {
      const value = normalize(record);
      const chars = JSON.stringify(value).length;
      if (chars > maxChars) return { ok: false, refused: { kind: 'too-large', max: maxChars, chars } };
      try {
        await area.set({ [key]: value });
        return { ok: true, value };
      } catch (error) {
        return { ok: false, refused: refusalOf(error) };
      }
    },
    watch(onRecord) {
      let live = true;
      let loaded = false;
      let changedWhileLoading = false;
      const onStorage = (changes: Record<string, chrome.storage.StorageChange>, name: string): void => {
        if (name !== areaName || !(key in changes)) return;
        if (!loaded) changedWhileLoading = true;
        else if (live) onRecord(normalize(changes[key]!.newValue));
      };
      onChanged.addListener(onStorage);
      void (async () => {
        let record = await load().catch(() => normalize(undefined));
        while (changedWhileLoading) {
          changedWhileLoading = false;
          record = await load().catch(() => record);
        }
        loaded = true;
        if (live) onRecord(record);
      })();
      return () => {
        live = false;
        onChanged.removeListener(onStorage);
      };
    },
  };
};

export const areaEditorSettings = (
  area: EditorSettingsArea,
  options: { id: string; keeps: boolean },
): EditorSettingsStore => ({
  id: options.id,
  keeps: options.keeps,
  ...areaRecord<EditorSettingsRecord>(
    { key: EDITOR_SETTINGS_KEY, normalize: normalizeEditorSettings, maxChars: RECORD_MAX_CHARS },
    area,
  ),
});

type Listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void;

/**
 * A storage area in the page's memory with Chrome's change event: values copied in and out as JSON, every write
 * announced to the listeners as `chrome.storage.onChanged` would. `rows` for tests.
 */
export const memoryEditorArea = (
  fail?: (items: Record<string, unknown>) => Error | null,
): EditorSettingsArea & { rows: Map<string, unknown> } => {
  const rows = new Map<string, unknown>();
  const listeners = new Set<Listener>();
  const copy = (value: unknown): unknown => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
  return {
    rows,
    areaName: 'local',
    area: {
      get: ((key: string) =>
        Promise.resolve(
          rows.has(key) ? { [key]: copy(rows.get(key)) } : {},
        )) as unknown as chrome.storage.StorageArea['get'],
      set: ((items: Record<string, unknown>) => {
        const error = fail?.(items);
        if (error) return Promise.reject(error);
        const changes: Record<string, chrome.storage.StorageChange> = {};
        for (const [k, v] of Object.entries(items)) {
          changes[k] = { oldValue: copy(rows.get(k)), newValue: copy(v) };
          rows.set(k, copy(v));
        }
        for (const listener of [...listeners]) listener(changes, 'local');
        return Promise.resolve();
      }) as unknown as chrome.storage.StorageArea['set'],
    },
    onChanged: {
      addListener: (listener: Listener) => void listeners.add(listener),
      removeListener: (listener: Listener) => void listeners.delete(listener),
    } as unknown as EditorSettingsArea['onChanged'],
  };
};

/** The Default set kept in the extension's storage: it survives a reload and the browser's restart. */
export const chromeEditorSettings = (): EditorSettingsStore =>
  typeof chrome !== 'undefined' && chrome.storage?.local && chrome.storage.onChanged
    ? areaEditorSettings(
        { area: chrome.storage.local, onChanged: chrome.storage.onChanged, areaName: 'local' },
        { id: 'chrome-storage-local', keeps: true },
      )
    : memoryEditorSettings();

/** The Default set kept while the page is open: a host without the extension's storage, and tests. */
export const memoryEditorSettings = (area: EditorSettingsArea = memoryEditorArea()): EditorSettingsStore =>
  areaEditorSettings(area, { id: 'memory', keeps: false });
