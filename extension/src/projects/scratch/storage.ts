/**
 * `ScratchStore` in a storage area (./store.ts): the extension's `chrome.storage.local` (`chromeScratches`), or an area
 * in the page's memory (`memoryScratches`: a host without the extension's API, and tests).
 *
 * Two kinds of records: `scratches` — the list (names, languages, times, sizes, the last language), small and read
 * whole — and `scratch:<id>` — one text each, so an autosave writes one scratch, not all of them. A text and the list
 * change in one `set` (Chrome writes it at once or not at all). The calls of one page run one after another, so a
 * rename never overwrites an autosave's list. Not followed across tabs: the list is read when it is shown, and the
 * last write of one scratch wins (as two editors of one file without a watcher). A record of another shape is read as
 * far as it makes sense — an unknown language as plain text, a broken entry left out — and nothing is deleted for it.
 */
import {
  SCRATCH_DEFAULT_LANGUAGE,
  SCRATCH_MAX_CHARS,
  SCRATCH_MAX_COUNT,
  byName,
  knownLanguage,
  newName,
  parseName,
  scratchId,
} from './store';
import type { ScratchInfo, ScratchList, ScratchRefusal, ScratchResult, ScratchStore } from './store';

/** chrome.storage.local key of the list. */
export const SCRATCHES_KEY = 'scratches';
/** chrome.storage.local key of a scratch's text: this and the id. */
export const SCRATCH_TEXT_PREFIX = 'scratch:';

/** What the store needs of a storage area: `chrome.storage.local`'s promise form. */
export type ScratchArea = Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'>;

interface StoredList {
  version: 1;
  lastLanguage: string;
  items: ScratchInfo[];
}

export interface ScratchStoreOptions {
  id: string;
  keeps: boolean;
  now?: () => number;
  makeId?: () => string;
}

const isInfo = (raw: unknown): raw is ScratchInfo => {
  if (typeof raw !== 'object' || raw === null) return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    r.id.length > 0 &&
    typeof r.name === 'string' &&
    r.name.length > 0 &&
    typeof r.createdMs === 'number' &&
    typeof r.updatedMs === 'number' &&
    typeof r.chars === 'number'
  );
};

/** The stored list as far as it can be read; nothing stored (or nothing readable) is an empty one. */
export const normalizeList = (raw: unknown): StoredList => {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const seen = new Set<string>();
  const items = (Array.isArray(r.items) ? r.items : [])
    .filter(isInfo)
    .filter(item => !seen.has(item.id) && seen.add(item.id))
    .map(item => ({
      id: item.id,
      name: item.name,
      language: knownLanguage(item.language),
      createdMs: item.createdMs,
      updatedMs: item.updatedMs,
      chars: item.chars,
    }));
  return { version: 1, lastLanguage: knownLanguage(r.lastLanguage), items };
};

const refusalOf = (error: unknown): ScratchRefusal => {
  const message = error instanceof Error ? error.message : String(error);
  // Chrome's answer when the area is over its quota: "QUOTA_BYTES quota exceeded" (or a …_PER_ITEM one).
  return /quota/i.test(message) ? { kind: 'full' } : { kind: 'failed', message };
};

const refused = <T>(refusal: ScratchRefusal): ScratchResult<T> => ({ ok: false, refused: refusal });

export const areaScratches = (area: ScratchArea, options: ScratchStoreOptions): ScratchStore => {
  const now = options.now ?? Date.now;
  const makeId = options.makeId ?? (() => scratchId());
  const textKey = (id: string): string => `${SCRATCH_TEXT_PREFIX}${id}`;
  // One call at a time: each reads the list, changes it and writes it before the next one reads it.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run, run);
    queue = next.catch(() => undefined);
    return next;
  };
  const readList = async (): Promise<StoredList> => normalizeList((await area.get(SCRATCHES_KEY))[SCRATCHES_KEY]);

  /** Changes one scratch's entry (and, with `text`, its text) in one write. */
  const change = (
    id: string,
    edit: (item: ScratchInfo) => ScratchInfo,
    text?: string,
  ): Promise<ScratchResult<ScratchInfo>> =>
    serial(async () => {
      try {
        const list = await readList();
        const at = list.items.findIndex(item => item.id === id);
        if (at < 0) return refused({ kind: 'missing' });
        const item = { ...edit(list.items[at]!), updatedMs: now() };
        list.items[at] = item;
        await area.set({ [SCRATCHES_KEY]: list, ...(text !== undefined && { [textKey(id)]: text }) });
        return { ok: true, value: item };
      } catch (error) {
        return refused(refusalOf(error));
      }
    });

  return {
    id: options.id,
    keeps: options.keeps,
    list: () =>
      serial(async (): Promise<ScratchList> => {
        try {
          const list = await readList();
          return { scratches: [...list.items].sort(byName), lastLanguage: list.lastLanguage };
        } catch {
          return { scratches: [], lastLanguage: SCRATCH_DEFAULT_LANGUAGE };
        }
      }),
    read: id =>
      serial(async () => {
        const list = await readList();
        if (!list.items.some(item => item.id === id)) return null;
        const text: unknown = (await area.get(textKey(id)))[textKey(id)];
        return typeof text === 'string' ? text : '';
      }),
    create: language =>
      serial(async (): Promise<ScratchResult<ScratchInfo>> => {
        try {
          const list = await readList();
          if (list.items.length >= SCRATCH_MAX_COUNT) return refused({ kind: 'too-many', max: SCRATCH_MAX_COUNT });
          const known = knownLanguage(language);
          const at = now();
          const item: ScratchInfo = {
            id: makeId(),
            name: newName(list.items, known),
            language: known,
            createdMs: at,
            updatedMs: at,
            chars: 0,
          };
          await area.set({
            [SCRATCHES_KEY]: { ...list, lastLanguage: known, items: [...list.items, item] },
            [textKey(item.id)]: '',
          });
          return { ok: true, value: item };
        } catch (error) {
          return refused(refusalOf(error));
        }
      }),
    write: (id, text) =>
      text.length > SCRATCH_MAX_CHARS
        ? Promise.resolve(refused({ kind: 'too-large', max: SCRATCH_MAX_CHARS, chars: text.length }))
        : change(id, item => ({ ...item, chars: text.length }), text),
    rename: (id, typed) =>
      change(id, item => {
        const parsed = parseName(typed, item.language);
        return parsed ? { ...item, ...parsed } : item;
      }),
    setLanguage: (id, language) => change(id, item => ({ ...item, language: knownLanguage(language) })),
    remove: id =>
      serial(async (): Promise<ScratchResult<null>> => {
        try {
          const list = await readList();
          // The list first: a text left behind by a failed second step is never shown, a listed scratch without its
          // text would be.
          await area.set({ [SCRATCHES_KEY]: { ...list, items: list.items.filter(item => item.id !== id) } });
          await area.remove(textKey(id));
          return { ok: true, value: null };
        } catch (error) {
          return refused(refusalOf(error));
        }
      }),
  };
};

/** A storage area in the page's memory, shaped as `chrome.storage.local` (values copied in and out as JSON). */
export const memoryArea = (): ScratchArea & { rows: Map<string, unknown> } => {
  const rows = new Map<string, unknown>();
  const copy = (value: unknown): unknown => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
  const keysOf = (keys: unknown): string[] =>
    keys === null || keys === undefined
      ? [...rows.keys()]
      : typeof keys === 'string'
        ? [keys]
        : Array.isArray(keys)
          ? (keys as string[])
          : Object.keys(keys as object);
  return {
    rows,
    get: ((keys?: unknown) =>
      Promise.resolve(
        Object.fromEntries(keysOf(keys).flatMap(k => (rows.has(k) ? [[k, copy(rows.get(k))]] : []))),
      )) as ScratchArea['get'],
    set: ((items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) rows.set(k, copy(v));
      return Promise.resolve();
    }) as ScratchArea['set'],
    remove: ((keys: string | string[]) => {
      for (const k of typeof keys === 'string' ? [keys] : keys) rows.delete(k);
      return Promise.resolve();
    }) as ScratchArea['remove'],
  };
};

/** The scratches kept in the extension's storage: they survive a reload and the browser's restart. */
export const chromeScratches = (): ScratchStore =>
  typeof chrome !== 'undefined' && chrome.storage?.local
    ? areaScratches(chrome.storage.local, { id: 'chrome-storage-local', keeps: true })
    : memoryScratches();

/** The scratches kept while the page is open: a host without the extension's storage, and tests. */
export const memoryScratches = (area: ScratchArea = memoryArea()): ScratchStore =>
  areaScratches(area, { id: 'memory', keeps: false });
