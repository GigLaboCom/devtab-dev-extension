/**
 * The tools' per-tool settings in this host (`ToolHost.settings`, @workspace/tools-host), and the one record of
 * chrome.storage.local this module owns — `toolSettings`, next to the other settings:
 *
 *   { v: 1, all: {…}, tools: { <id>: {…} }, params?: { <id>: { schema, values } } }
 *
 * - `v`, `all`, `tools` are the settings (`chromeToolSettingsArea`): a tool reads only its own entry and never sees
 *   storage; Settings → Tools sets one value for all the tools it applies to (`setForAll`). The first setting is "Copy
 *   automatically after generating" (`autoCopy`, for the tools whose definition says `output.origin: 'generated'`).
 * - `params` is the tools' saved parameters (D21, docs/tools/settings.md) as `localParameterStorage` keeps them — the
 *   local implementation of seam `ParameterStorage` (D23, docs/tools/settings-storage.md): one entry per tool, the
 *   shape the builds before the seam wrote, so what they saved is read as it is.
 *
 * Each of the two writes the whole record and carries the other's part through untouched; every open page follows
 * both through storage.onChanged. Whether a build keeps the parameters at all is the edition's choice (src/edition):
 * the free one is given `noParameterStorage`, and then nothing of them reaches chrome.storage.
 */
import { createToolSettings } from '@workspace/tools-host';
import type {
  ParameterEntry,
  ParameterStorage,
  ParameterWrite,
  ToolSettingsArea,
  ToolSettingsStore,
} from '@workspace/tools-host';

/** The parts of chrome.storage it uses. */
export type SettingsArea = Pick<chrome.storage.StorageArea, 'get' | 'set'>;
export type SettingsChanged = Pick<chrome.storage.StorageChangedEvent, 'addListener' | 'removeListener'>;

/** The browser's storage as this host hands it to what keeps things in it. */
export interface BrowserStorage {
  area: SettingsArea;
  onChanged: SettingsChanged;
}

export const TOOL_SETTINGS_KEY = 'toolSettings';

/** The record's place in chrome.storage.local, and its changes made by any page of the extension. */
export const chromeToolSettingsArea = (area: SettingsArea, onChanged: SettingsChanged): ToolSettingsArea => ({
  read: async () => (await area.get(TOOL_SETTINGS_KEY))[TOOL_SETTINGS_KEY],
  write: record => area.set({ [TOOL_SETTINGS_KEY]: record }),
  watch: listener => {
    const changed = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName === 'local' && TOOL_SETTINGS_KEY in changes) listener(changes[TOOL_SETTINGS_KEY]!.newValue);
    };
    onChanged.addListener(changed);
    return () => onChanged.removeListener(changed);
  },
});

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The record's `params` part, whatever the record is. */
const paramsOf = (record: unknown): Record<string, unknown> =>
  isObject(record) && isObject(record.params) ? record.params : {};

/**
 * An entry's revision: its JSON with the keys in order — the same for the same content, whoever wrote it and in
 * whatever order. Nothing is added to what is stored, so a record written before the seam has revisions too.
 */
const revisionOf = (value: unknown): string =>
  JSON.stringify(value, (_key, part: unknown) =>
    isObject(part) ? Object.fromEntries(Object.entries(part).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : part,
  );

const entryOf = (params: Record<string, unknown>, toolId: string): ParameterEntry | undefined =>
  Object.prototype.hasOwnProperty.call(params, toolId) && params[toolId] !== undefined
    ? { parameters: params[toolId], revision: revisionOf(params[toolId]) }
    : undefined;

/**
 * Is this page going away? True from `pagehide` (until a `pageshow` brings the page back from the browser's cache) and
 * while the page is hidden. Where there is no page (a worker), never.
 */
const pageLeaving = (): (() => boolean) => {
  if (typeof document === 'undefined') return () => false;
  let hiding = false;
  addEventListener('pagehide', () => void (hiding = true));
  addEventListener('pageshow', () => void (hiding = false));
  return () => hiding || document.visibilityState === 'hidden';
};

/**
 * Seam `ParameterStorage`, local: the `params` part of the record above. A write reads the record, checks that the
 * tool's entry is still the one the write was computed from, and writes the record back with that one entry replaced —
 * one write at a time in this page. chrome.storage has no transaction: between two pages the check and the write are
 * two steps, so two pages writing within the same few milliseconds can still lose one of the two writes (as before the
 * seam). A storage error (a quota, a closed extension context) is answered `failed`; this storage is never
 * `unavailable`. A change made by any page of the extension is reported from storage.onChanged, entry by entry — this
 * page's own writes too.
 *
 * A page that is going away (`leaving`) cannot wait for the read: its answer comes in a later task, which a page being
 * reloaded or closed never runs, and then nothing would be written at all. Such a write is computed from the record as
 * this page last saw it — read, written here or reported by storage.onChanged — and handed to the browser in the same
 * turn, so a choice made a moment before leaving is kept.
 */
export const localParameterStorage = (
  { area, onChanged }: BrowserStorage,
  leaving: () => boolean = pageLeaving(),
): ParameterStorage => {
  let queue: Promise<unknown> = Promise.resolve();
  /** The record as this page last saw it. */
  let seen: { raw: unknown } | undefined;
  let following = false;
  /** From the first read on, what any page writes is seen here too (making the storage touches nothing). */
  const follow = () => {
    if (following) return;
    following = true;
    onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && TOOL_SETTINGS_KEY in changes) seen = { raw: changes[TOOL_SETTINGS_KEY]!.newValue };
    });
  };
  const record = async (): Promise<unknown> => {
    follow();
    const raw = (await area.get(TOOL_SETTINGS_KEY))[TOOL_SETTINGS_KEY];
    seen = { raw };
    return raw;
  };
  return {
    keeps: true,
    read: toolId =>
      record().then(
        raw => entryOf(paramsOf(raw), toolId),
        () => undefined,
      ),
    write: (toolId, parameters, base) => {
      const answer = queue.then(async (): Promise<ParameterWrite> => {
        try {
          const raw = seen && leaving() ? seen.raw : await record();
          const params = paramsOf(raw);
          const current = entryOf(params, toolId);
          if (current?.revision !== base) return { status: 'conflict', entry: current };
          if (!current && !parameters) return { status: 'accepted', entry: undefined };
          const next = Object.fromEntries(Object.entries(params).filter(([id]) => id !== toolId));
          if (parameters) next[toolId] = parameters;
          const rest = Object.fromEntries(Object.entries(isObject(raw) ? raw : {}).filter(([key]) => key !== 'params'));
          const written = { v: 1, all: {}, tools: {}, ...rest, ...(Object.keys(next).length > 0 && { params: next }) };
          await area.set({ [TOOL_SETTINGS_KEY]: written });
          seen = { raw: written };
          return { status: 'accepted', entry: parameters && { parameters, revision: revisionOf(parameters) } };
        } catch (error) {
          return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
        }
      });
      queue = answer;
      return answer;
    },
    watch: listener => {
      const changed = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
        if (areaName !== 'local' || !(TOOL_SETTINGS_KEY in changes)) return;
        const before = paramsOf(changes[TOOL_SETTINGS_KEY]!.oldValue);
        const after = paramsOf(changes[TOOL_SETTINGS_KEY]!.newValue);
        for (const toolId of new Set([...Object.keys(before), ...Object.keys(after)])) {
          const entry = entryOf(after, toolId);
          if (entryOf(before, toolId)?.revision !== entry?.revision) listener(toolId, entry);
        }
      };
      onChanged.addListener(changed);
      return () => onChanged.removeListener(changed);
    },
  };
};

/**
 * The store of this host. `parameters`: what keeps the tools' saved parameters — the edition's choice
 * (src/history/behaviors.ts passes it); by default the local storage over the same record.
 */
export const extensionToolSettings = (
  area: SettingsArea,
  onChanged: SettingsChanged,
  parameters: ParameterStorage = localParameterStorage({ area, onChanged }),
): ToolSettingsStore => createToolSettings(chromeToolSettingsArea(area, onChanged), parameters);
