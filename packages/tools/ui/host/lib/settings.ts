/**
 * Per-tool settings (`ToolHost.settings`): every tool has an entry of its own, which the host keeps and the tool reads
 * and follows. A tool never imports storage or `chrome`; it asks the host for its own entry:
 *
 *   const values = useToolSettings(host, 'password');      // the stored values; the tool's own defaults fill the rest
 *   host.settings.forTool('password').set({ length: 24 }); // upsert into this tool's entry (a later per-tool option)
 *
 * A host's settings page sets a value for many tools at once (`setForAll`): it is upserted into the entry of each tool
 * named and remembered as what a tool without a value of its own reads — so a tool that appears later takes the
 * current state when it is first read, and a switch per tool can come later without a migration.
 *
 * The stored shape (versioned, the same for every host): `{ v: 1, all: {...}, tools: { <id>: {...} } }`, values plain
 * JSON scalars. Where it is stored is the host's: a `ToolSettingsArea` (in memory here; `chrome.storage.local` in the
 * extension). Every page over the same area follows a change made in any of them.
 */

/** A value a tool keeps among its settings: a plain JSON scalar. */
export type SettingValue = boolean | number | string;

/** A tool's settings by key. */
export type ToolSettingValues = Readonly<Record<string, SettingValue>>;

/** One tool's own entry, as the host keeps it. */
export interface OwnSettings {
  /** The values this tool reads: its own over those set for all tools. The same object until something changes. */
  get(): ToolSettingValues;
  /** Called after a change of these settings, made in this page or in another. */
  subscribe(listener: () => void): () => void;
  /** Upserts these keys into the tool's entry. */
  set(values: ToolSettingValues): Promise<void>;
}

/** What a tool sees (`ToolHost.settings`): its own entry. */
export interface ToolSettings {
  forTool(toolId: string): OwnSettings;
}

/** What a host's settings page uses besides: one value for many tools, and the switch's own state. */
export interface ToolSettingsStore extends ToolSettings {
  /** What was last set for all tools at once — a tool without a value of its own reads it. */
  forAll(): ToolSettingValues;
  /** Upserts `values` into the entry of every tool in `toolIds`, and remembers them for a tool that has no entry yet. */
  setForAll(toolIds: readonly string[], values: ToolSettingValues): Promise<void>;
  /** Called after any change of the stored settings. */
  subscribe(listener: () => void): () => void;
  /** Resolves after the first read of the area. */
  ready: Promise<void>;
}

/** The stored record, version 1. */
export interface ToolSettingsRecord {
  v: 1;
  /** Values set for all tools at once (the one switch). */
  all: ToolSettingValues;
  /** An entry per tool, by its id. */
  tools: Readonly<Record<string, ToolSettingValues>>;
}

/** Where a host keeps the record: read it, write it, and hear of a write made by any page (this one included). */
export interface ToolSettingsArea {
  read(): Promise<unknown>;
  write(record: ToolSettingsRecord): Promise<void>;
  watch(listener: (raw: unknown) => void): () => void;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const valuesOf = (raw: unknown): ToolSettingValues =>
  isObject(raw)
    ? Object.fromEntries(
        Object.entries(raw).filter(
          (entry): entry is [string, SettingValue] =>
            typeof entry[1] === 'boolean' ||
            typeof entry[1] === 'string' ||
            (typeof entry[1] === 'number' && Number.isFinite(entry[1])),
        ),
      )
    : {};

/** Reads whatever is stored as a record of version 1: what is not a scalar value is left out, nothing stored is empty. */
export const normalizeToolSettings = (raw: unknown): ToolSettingsRecord => {
  const r = isObject(raw) ? raw : {};
  const tools = isObject(r.tools) ? r.tools : {};
  return {
    v: 1,
    all: valuesOf(r.all),
    tools: Object.fromEntries(Object.entries(tools).map(([id, values]) => [id, valuesOf(values)])),
  };
};

/** The values a tool reads: its own over those set for all. */
export const valuesForTool = (record: ToolSettingsRecord, toolId: string): ToolSettingValues => ({
  ...record.all,
  ...record.tools[toolId],
});

/** One tool's entry with `values` upserted. */
export const upsertTool = (
  record: ToolSettingsRecord,
  toolId: string,
  values: ToolSettingValues,
): ToolSettingsRecord => ({
  ...record,
  tools: { ...record.tools, [toolId]: { ...record.tools[toolId], ...values } },
});

/** `values` upserted into every named tool's entry and into what a tool without an entry reads. */
export const upsertAll = (
  record: ToolSettingsRecord,
  toolIds: readonly string[],
  values: ToolSettingValues,
): ToolSettingsRecord =>
  toolIds.reduce((r, id) => upsertTool(r, id, values), { ...record, all: { ...record.all, ...values } });

/** The store over an area: the last known record in memory, followed live; writes read the area first. */
export const createToolSettings = (area: ToolSettingsArea): ToolSettingsStore => {
  let record = normalizeToolSettings(undefined);
  const listeners = new Set<() => void>();
  const own = new Map<string, { record: ToolSettingsRecord; values: ToolSettingValues }>();
  const take = (raw: unknown) => {
    record = normalizeToolSettings(raw);
    listeners.forEach(l => l());
  };
  area.watch(take);
  const ready = area.read().then(take, () => undefined);
  const write = async (change: (r: ToolSettingsRecord) => ToolSettingsRecord) => {
    const next = change(normalizeToolSettings(await area.read()));
    take(next);
    await area.write(next);
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  };

  return {
    forTool: toolId => ({
      get: () => {
        const cached = own.get(toolId);
        if (cached?.record === record) return cached.values;
        const values = valuesForTool(record, toolId);
        // Same values, same object: a host re-reading an unchanged entry does not re-render the tool.
        const same =
          cached &&
          Object.keys(values).length === Object.keys(cached.values).length &&
          Object.entries(values).every(([k, v]) => cached.values[k] === v);
        own.set(toolId, { record, values: same ? cached.values : values });
        return same ? cached.values : values;
      },
      subscribe,
      set: values => write(r => upsertTool(r, toolId, values)),
    }),
    forAll: () => record.all,
    setForAll: (toolIds, values) => write(r => upsertAll(r, toolIds, values)),
    subscribe,
    ready,
  };
};

/** An area in memory: what several pages of one host would share, without storage (a test, a host with none). */
export const memoryToolSettingsArea = (): ToolSettingsArea => {
  let stored: unknown;
  const watchers = new Set<(raw: unknown) => void>();
  return {
    read: async () => (stored === undefined ? undefined : structuredClone(stored)),
    write: async record => {
      stored = structuredClone(record);
      watchers.forEach(w => w(structuredClone(record)));
    },
    watch: listener => {
      watchers.add(listener);
      return () => void watchers.delete(listener);
    },
  };
};

/** Per-tool settings in this page's memory: nothing persists. The default of a tool rendered with no host. */
export const memoryToolSettings = (): ToolSettingsStore => createToolSettings(memoryToolSettingsArea());
