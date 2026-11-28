/**
 * `EditorSettingsStore` in a storage area (./store.ts): the extension's `chrome.storage.local` (`chromeEditorSettings`),
 * or an area in the page's memory (`memoryEditorSettings`: a host without the extension's API, and tests). One record,
 * `editorSettings` — the Default set, versioned from the start (./model.ts); no other record is read or written. A
 * record of another shape is read as far as it makes sense and is not deleted for it.
 */
import { RECORD_MAX_CHARS, normalizeEditorSettings } from './model';
import type { EditorSettingsRecord } from './model';
import type { EditorSettingsRefusal, EditorSettingsResult, EditorSettingsStore } from './store';

/** chrome.storage.local key of the Default set. (Profiles, stage 2, get a key of their own: `editorProfiles`.) */
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

export const areaEditorSettings = (
  { area, onChanged, areaName }: EditorSettingsArea,
  options: { id: string; keeps: boolean },
): EditorSettingsStore => {
  const load = async (): Promise<EditorSettingsRecord> =>
    normalizeEditorSettings((await area.get(EDITOR_SETTINGS_KEY))[EDITOR_SETTINGS_KEY]);
  return {
    id: options.id,
    keeps: options.keeps,
    load,
    async save(record): Promise<EditorSettingsResult> {
      const value = normalizeEditorSettings(record);
      const chars = JSON.stringify(value).length;
      if (chars > RECORD_MAX_CHARS) return { ok: false, refused: { kind: 'too-large', max: RECORD_MAX_CHARS, chars } };
      try {
        await area.set({ [EDITOR_SETTINGS_KEY]: value });
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
        if (name !== areaName || !(EDITOR_SETTINGS_KEY in changes)) return;
        if (!loaded) changedWhileLoading = true;
        else if (live) onRecord(normalizeEditorSettings(changes[EDITOR_SETTINGS_KEY]!.newValue));
      };
      onChanged.addListener(onStorage);
      void (async () => {
        let record = await load().catch(() => normalizeEditorSettings(undefined));
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
