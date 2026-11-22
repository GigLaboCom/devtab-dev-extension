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
 * The same entry keeps the tool's **saved parameters** (D21: what the person chose last time — the indent, the client,
 * the alphabet), which a tool declares and reads through `useSavedSettings` (savedSettings.ts): `saved()` /
 * `save()` / `reset()` below. They are a part of the record of their own (`params`), with the tool's schema version, and
 * they may live in another area than the rest: `createToolSettings(area, parameters)` — the same area (the parameters
 * persist: Pro) or one in this page's memory (they live while the page is open: the free version). Writes of parameters
 * are debounced (`SAVE_AFTER_MS`) and merged field by field into what is stored at the moment of writing, so two pages
 * changing different parameters of one tool keep both; a tool's saved parameters are bounded
 * (`SAVED_PARAMETERS_MAX_CHARS`).
 *
 * The stored shape (versioned, the same for every host):
 *   `{ v: 1, all: {...}, tools: { <id>: {...} }, params?: { <id>: { schema: <n>, values: {...} } } }`
 * settings plain JSON scalars, parameters scalars or lists of strings. Where it is stored is the host's: a
 * `ToolSettingsArea` (in memory here; `chrome.storage.local` in the extension). Every page over the same area follows a
 * change made in any of them.
 */

/** A value a tool keeps among its settings: a plain JSON scalar. */
export type SettingValue = boolean | number | string;

/** A tool's settings by key. */
export type ToolSettingValues = Readonly<Record<string, SettingValue>>;

/** A value of a saved parameter: a plain JSON scalar, or a list of strings (a list the person built). */
export type ParameterValue = boolean | number | string | readonly string[];

/** A tool's saved parameters as stored: the tool's schema version and the values that differ from its defaults. */
export interface StoredParameters {
  readonly schema: number;
  readonly values: Readonly<Record<string, ParameterValue>>;
}

/** Parameters to upsert: `undefined` removes one (it is back at its default). */
export type ParameterChange = Readonly<Record<string, ParameterValue | undefined>>;

/** Which stored parameters a write keeps: the declared, valid ones that differ from their defaults. */
export type KeepParameter = (key: string, value: ParameterValue) => boolean;

/** Do these stored parameters differ from the tool's defaults? (the declaration of the tool's page open now) */
export type DiffersFromDefaults = (saved: StoredParameters | undefined) => boolean;

/** A write of parameters waits this long for the next change (typing "24" writes once). */
export const SAVE_AFTER_MS = 400;

/** The most a tool's saved parameters take, as JSON characters; a larger write is refused, a larger record not read. */
export const SAVED_PARAMETERS_MAX_CHARS = 4096;

/** One tool's own entry, as the host keeps it. */
export interface OwnSettings {
  /** The values this tool reads: its own over those set for all tools. The same object until something changes. */
  get(): ToolSettingValues;
  /** Called after a change of these settings or parameters, made in this page or in another. */
  subscribe(listener: () => void): () => void;
  /** Upserts these keys into the tool's entry. */
  set(values: ToolSettingValues): Promise<void>;
  /** The tool's saved parameters as kept now (this page's unwritten changes included), unchecked. */
  saved(): StoredParameters | undefined;
  /**
   * Upserts parameters under the tool's schema: seen at once in this page, written after `SAVE_AFTER_MS` (or `flush`).
   * Stored values of another schema are dropped; `keep` drops the others a write should not carry.
   */
  save(schema: number, change: ParameterChange, keep?: KeepParameter): void;
  /** Writes what `save` has not written yet. */
  flush(): Promise<void>;
  /** The tool's page tells how its saved parameters compare with its defaults, while it is open; returns the undo. */
  declare(differs: DiffersFromDefaults): () => void;
  /** Do the saved parameters differ from the defaults of the tool's page open now? False while none is open. */
  changed(): boolean;
  /** Every saved parameter back to its default: the saved record is removed and the tool's page in this page told. */
  reset(): Promise<void>;
  /** Called when `reset` was asked in this page (not when another page removed the record). */
  onReset(listener: () => void): () => void;
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
  /** Resolves after the first read of the area (and of the parameters' area). */
  ready: Promise<void>;
}

/** The stored record, version 1. */
export interface ToolSettingsRecord {
  v: 1;
  /** Values set for all tools at once (the one switch). */
  all: ToolSettingValues;
  /** An entry per tool, by its id. */
  tools: Readonly<Record<string, ToolSettingValues>>;
  /** Each tool's saved parameters (D21), by its id; absent while none is saved. */
  params?: Readonly<Record<string, StoredParameters>>;
}

/** Where a host keeps the record: read it, write it, and hear of a write made by any page (this one included). */
export interface ToolSettingsArea {
  read(): Promise<unknown>;
  write(record: ToolSettingsRecord): Promise<void>;
  watch(listener: (raw: unknown) => void): () => void;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isScalar = (value: unknown): value is SettingValue =>
  typeof value === 'boolean' || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));

const isParameterValue = (value: unknown): value is ParameterValue =>
  isScalar(value) || (Array.isArray(value) && value.every(item => typeof item === 'string'));

const valuesOf = (raw: unknown): ToolSettingValues =>
  isObject(raw)
    ? Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, SettingValue] => isScalar(entry[1])))
    : {};

const fits = (saved: StoredParameters): boolean => JSON.stringify(saved).length <= SAVED_PARAMETERS_MAX_CHARS;

/** One tool's stored parameters as far as they are valid: what is not a value is left out; nothing is no record. */
const parametersOf = (raw: unknown): StoredParameters | undefined => {
  if (!isObject(raw) || !Number.isSafeInteger(raw.schema) || !isObject(raw.values)) return undefined;
  const values = Object.fromEntries(
    Object.entries(raw.values).filter((entry): entry is [string, ParameterValue] => isParameterValue(entry[1])),
  );
  const saved = { schema: raw.schema as number, values };
  return Object.keys(values).length > 0 && fits(saved) ? saved : undefined;
};

const withParams = (
  record: ToolSettingsRecord,
  params: Readonly<Record<string, StoredParameters>>,
): ToolSettingsRecord => {
  const rest: ToolSettingsRecord = { v: 1, all: record.all, tools: record.tools };
  return Object.keys(params).length > 0 ? { ...rest, params } : rest;
};

/** Reads whatever is stored as a record of version 1: what is not a valid value is left out, nothing stored is empty. */
export const normalizeToolSettings = (raw: unknown): ToolSettingsRecord => {
  const r = isObject(raw) ? raw : {};
  const tools = isObject(r.tools) ? r.tools : {};
  const params = isObject(r.params)
    ? Object.fromEntries(
        Object.entries(r.params)
          .map(([id, saved]) => [id, parametersOf(saved)] as const)
          .filter((entry): entry is readonly [string, StoredParameters] => entry[1] !== undefined),
      )
    : {};
  return withParams(
    {
      v: 1,
      all: valuesOf(r.all),
      tools: Object.fromEntries(Object.entries(tools).map(([id, values]) => [id, valuesOf(values)])),
    },
    params,
  );
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

/** A change of one tool's saved parameters, in the order asked. */
type ParameterOp =
  | { toolId: string; schema: number; change: ParameterChange; keep?: KeepParameter; sent?: boolean }
  | { toolId: string; forget: true; sent?: boolean };

/** Applies one change to the parameters of every tool: an upsert under the tool's schema, or the record's removal. */
const applyOp = (
  params: Readonly<Record<string, StoredParameters>>,
  op: ParameterOp,
): Readonly<Record<string, StoredParameters>> => {
  const { [op.toolId]: current, ...others } = params;
  if ('forget' in op) return others;
  const values: Record<string, ParameterValue> = current?.schema === op.schema ? { ...current.values } : {};
  for (const [key, value] of Object.entries(op.change)) {
    if (value === undefined) delete values[key];
    else values[key] = value;
  }
  const kept = op.keep
    ? Object.fromEntries(Object.entries(values).filter(([key, value]) => op.keep!(key, value)))
    : values;
  if (Object.keys(kept).length === 0) return others;
  const next = { schema: op.schema, values: kept };
  // Too large: the write is refused and what was saved stays (a tool bounds its own fields well below this).
  if (!fits(next)) return params;
  return { ...others, [op.toolId]: next };
};

/**
 * The store over an area: the last known record in memory, followed live; writes read the area first. The tools' saved
 * parameters are kept in `parameters` — by default the same area.
 */
export const createToolSettings = (area: ToolSettingsArea, parameters: ToolSettingsArea = area): ToolSettingsStore => {
  const shared = parameters === area;
  let record = normalizeToolSettings(undefined);
  /** The parameters as stored, and as this page sees them: with its changes not yet written. */
  let stored: Readonly<Record<string, StoredParameters>> = {};
  let shown: Readonly<Record<string, StoredParameters>> = {};
  let unwritten: ParameterOp[] = [];
  const listeners = new Set<() => void>();
  const resetListeners = new Map<string, Set<() => void>>();
  const declared = new Map<string, DiffersFromDefaults>();
  const own = new Map<string, { record: ToolSettingsRecord; values: ToolSettingValues }>();
  const notify = () => listeners.forEach(l => l());
  const show = () => {
    shown = unwritten.reduce(applyOp, stored);
  };
  const take = (raw: unknown) => {
    record = normalizeToolSettings(raw);
    if (shared) {
      stored = record.params ?? {};
      show();
    }
    notify();
  };
  const takeParameters = (raw: unknown) => {
    stored = normalizeToolSettings(raw).params ?? {};
    show();
    notify();
  };
  // A write heard while the first read is under way is newer than what that read returns.
  let heard = false;
  let heardParameters = false;
  area.watch(raw => {
    heard = true;
    take(raw);
  });
  if (!shared)
    parameters.watch(raw => {
      heardParameters = true;
      takeParameters(raw);
    });
  const ready = Promise.all([
    area.read().then(
      raw => void (heard || take(raw)),
      () => undefined,
    ),
    shared
      ? undefined
      : parameters.read().then(
          raw => void (heardParameters || takeParameters(raw)),
          () => undefined,
        ),
  ]).then(() => undefined);

  // One write at a time in this page: each reads the area, changes what it read and writes it back.
  let queue: Promise<void> = Promise.resolve();
  const serial = (job: () => Promise<void>): Promise<void> => {
    const next = queue.then(job);
    queue = next.catch(() => undefined);
    return next;
  };
  const write = (change: (r: ToolSettingsRecord) => ToolSettingsRecord) =>
    serial(async () => {
      const next = change(normalizeToolSettings(await area.read()));
      take(next);
      await area.write(next);
    });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = (): Promise<void> => {
    clearTimeout(timer);
    timer = undefined;
    const batch = unwritten.filter(op => !op.sent);
    if (batch.length === 0) return queue;
    batch.forEach(op => (op.sent = true));
    return serial(async () => {
      try {
        const base = normalizeToolSettings(await parameters.read());
        const next = withParams(base, batch.reduce(applyOp, base.params ?? {}));
        await parameters.write(next);
        stored = next.params ?? {};
      } finally {
        unwritten = unwritten.filter(op => !batch.includes(op));
        show();
        notify();
      }
    });
  };
  const change = (op: ParameterOp, now: boolean): Promise<void> => {
    unwritten.push(op);
    show();
    notify();
    if (now) return flush();
    clearTimeout(timer);
    timer = setTimeout(() => void flush().catch(() => undefined), SAVE_AFTER_MS);
    return Promise.resolve();
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
      saved: () => shown[toolId],
      save: (schema, values, keep) => void change({ toolId, schema, change: values, keep }, false),
      flush,
      declare: differs => {
        declared.set(toolId, differs);
        notify();
        return () => {
          if (declared.get(toolId) !== differs) return;
          declared.delete(toolId);
          notify();
        };
      },
      changed: () => declared.get(toolId)?.(shown[toolId]) ?? false,
      reset: () => {
        // The tool's page drops its values first, so nothing it had not written yet comes back after the removal.
        resetListeners.get(toolId)?.forEach(l => l());
        return change({ toolId, forget: true }, true);
      },
      onReset: listener => {
        const set = resetListeners.get(toolId) ?? new Set();
        resetListeners.set(toolId, set.add(listener));
        return () => void set.delete(listener);
      },
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
