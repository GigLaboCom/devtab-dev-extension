/**
 * Per-tool settings (`ToolHost.settings`): every tool has an entry of its own, which the host keeps and the tool reads
 * and follows. A tool never imports storage or `chrome`; it asks the host for its own entry:
 *
 *   const values = useToolSettings(host, 'password');      // the stored values; the tool's own defaults fill the rest
 *   host.settings.forTool('password').set({ length: 24 }); // upsert into this tool's entry (a later per-tool option)
 *
 * A host's settings page sets a value for many tools at once (`setForAll`): it is upserted into the entry of each tool
 * named and remembered as what a tool without a value of its own reads — so a tool that appears later takes the
 * current state when it is first read, and a switch per tool can come later without a migration. These settings are one
 * versioned record, `{ v: 1, all: {...}, tools: { <id>: {...} } }`, plain JSON scalars, kept in a `ToolSettingsArea`
 * (in memory here; `chrome.storage.local` in the extension) and followed live by every page over the same area.
 *
 * The same entry gives a tool its **saved parameters** (D21: what the person chose last time — the indent, the client,
 * the alphabet), which a tool declares and reads through `useSavedSettings` (savedSettings.ts): `saved()` / `save()` /
 * `reset()` below. Where they are kept is a seam of its own, `ParameterStorage` (parameterStorage.ts): one entry per
 * tool, written conditionally on the revision it was computed from. This module is the logic over it, the same for
 * every implementation:
 *
 * - a change is seen in this page at once and written after `SAVE_AFTER_MS` (or `flush`), one write per tool;
 * - what is written is the stored entry with the person's changes applied field by field under the tool's schema,
 *   bounded (`SAVED_PARAMETERS_MAX_CHARS`); values of another schema are dropped;
 * - `conflict` (the entry changed elsewhere meanwhile): the changes are applied to the entry the storage answered with
 *   and written again, up to `WRITE_ATTEMPTS` times — different fields keep both, the same field keeps the last value;
 * - `unavailable` or `failed`: the changes stay in this page — still seen by the tool, sent again with the next change,
 *   on leaving the page, and when the storage reports the tool — and `unsaved()` says which it was, for the host's page
 *   to say so in words;
 * - a report of the storage (`watch`) replaces what this page knows of that tool's entry; the tool's page open now
 *   keeps the values it shows (savedSettings.ts);
 * - one write at a time in this page, settings and parameters alike, so an implementation that keeps both in one
 *   record cannot overwrite one with the other.
 */
import { memoryParameterStorage } from './parameterStorage';
import type { ParameterEntry, ParameterStorage, ParameterValue, Revision, StoredParameters } from './parameterStorage';

export type { ParameterValue, StoredParameters } from './parameterStorage';

/** A value a tool keeps among its settings: a plain JSON scalar. */
export type SettingValue = boolean | number | string;

/** A tool's settings by key. */
export type ToolSettingValues = Readonly<Record<string, SettingValue>>;

/** Parameters to upsert: `undefined` removes one (it is back at its default). */
export type ParameterChange = Readonly<Record<string, ParameterValue | undefined>>;

/** Which stored parameters a write keeps: the declared, valid ones that differ from their defaults. */
export type KeepParameter = (key: string, value: ParameterValue) => boolean;

/** Do these stored parameters differ from the tool's defaults? (the declaration of the tool's page open now) */
export type DiffersFromDefaults = (saved: StoredParameters | undefined) => boolean;

/**
 * Why the storage does not hold a tool's latest changes: it could not be reached (`unavailable`: offline, signed out —
 * it may be later) or it refused them (`failed`: a quota, a closed context).
 */
export type SaveProblem = 'unavailable' | 'failed';

/** A write of parameters waits this long for the next change (typing "24" writes once). */
export const SAVE_AFTER_MS = 400;

/** The most a tool's saved parameters take, as JSON characters; a larger write is refused, a larger record not read. */
export const SAVED_PARAMETERS_MAX_CHARS = 4096;

/** How many times one write is tried when the entry keeps changing elsewhere (`conflict`) before it is held as failed. */
export const WRITE_ATTEMPTS = 3;

/** One tool's own entry, as the host keeps it. */
export interface OwnSettings {
  /** The values this tool reads: its own over those set for all tools. The same object until something changes. */
  get(): ToolSettingValues;
  /** Called after a change of these settings or parameters, made in this page or in another. */
  subscribe(listener: () => void): () => void;
  /** Upserts these keys into the tool's entry. */
  set(values: ToolSettingValues): Promise<void>;
  /** The tool's saved parameters as kept now (this page's unwritten changes included), checked value by value. */
  saved(): StoredParameters | undefined;
  /**
   * Upserts parameters under the tool's schema: seen at once in this page, written after `SAVE_AFTER_MS` (or `flush`).
   * Stored values of another schema are dropped; `keep` drops the others a write should not carry.
   */
  save(schema: number, change: ParameterChange, keep?: KeepParameter): void;
  /** Writes what `save` has not written yet; resolves when the storage has answered (whatever it answered). */
  flush(): Promise<void>;
  /** The tool's page tells how its saved parameters compare with its defaults, while it is open; returns the undo. */
  declare(differs: DiffersFromDefaults): () => void;
  /**
   * Do the saved parameters differ from the defaults of the tool's page open now? False while none is open, and always
   * in a host whose storage keeps nothing beyond the page (there is nothing kept to put back).
   */
  changed(): boolean;
  /** Every saved parameter back to its default: the saved record is removed and the tool's page in this page told. */
  reset(): Promise<void>;
  /** Called when `reset` was asked in this page (not when another page removed the record). */
  onReset(listener: () => void): () => void;
  /**
   * Why the storage does not hold this tool's latest changes, when it refused them: they stay in this page and are sent
   * again. `undefined`: nothing is refused — everything is kept, or on its way.
   */
  unsaved(): SaveProblem | undefined;
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
  /** Resolves after the first read of the settings' area. */
  ready: Promise<void>;
  /**
   * Resolves when the settings and this tool's saved parameters are read: what a tool's page waits for, so the tool
   * opens with them from its first render. The same promise each time.
   */
  readyFor(toolId: string): Promise<void>;
}

/** The stored record of the settings, version 1. */
export interface ToolSettingsRecord {
  v: 1;
  /** Values set for all tools at once (the one switch). */
  all: ToolSettingValues;
  /** An entry per tool, by its id. */
  tools: Readonly<Record<string, ToolSettingValues>>;
  /**
   * Not the settings': a `ParameterStorage` that keeps the saved parameters in the same record (the extension's local
   * one) owns this part. It is carried through a write of the settings untouched and never read here.
   */
  params?: Readonly<Record<string, unknown>>;
}

/** Where a host keeps the settings' record: read it, write it, and hear of a write made by any page (this one included). */
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

const sameValue = (a: ParameterValue, b: ParameterValue | undefined): boolean =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((item, i) => item === b[i]) : a === b;

const sameParameters = (a: StoredParameters | undefined, b: StoredParameters | undefined): boolean => {
  if (!a || !b) return a === b;
  const keys = Object.keys(a.values);
  return (
    a.schema === b.schema &&
    keys.length === Object.keys(b.values).length &&
    keys.every(key => sameValue(a.values[key]!, b.values[key]))
  );
};

/** Reads whatever is stored as a record of version 1: what is not a valid value is left out, nothing stored is empty. */
export const normalizeToolSettings = (raw: unknown): ToolSettingsRecord => {
  const r = isObject(raw) ? raw : {};
  const tools = isObject(r.tools) ? r.tools : {};
  const record: ToolSettingsRecord = {
    v: 1,
    all: valuesOf(r.all),
    tools: Object.fromEntries(Object.entries(tools).map(([id, values]) => [id, valuesOf(values)])),
  };
  return isObject(r.params) && Object.keys(r.params).length > 0 ? { ...record, params: r.params } : record;
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
  { toolId: string; schema: number; change: ParameterChange; keep?: KeepParameter } | { toolId: string; forget: true };

/** Applies one change to a tool's parameters: an upsert under the tool's schema, or the record's removal. */
const applyOp = (current: StoredParameters | undefined, op: ParameterOp): StoredParameters | undefined => {
  if ('forget' in op) return undefined;
  const values: Record<string, ParameterValue> = current?.schema === op.schema ? { ...current.values } : {};
  for (const [key, value] of Object.entries(op.change)) {
    if (value === undefined) delete values[key];
    else values[key] = value;
  }
  const kept = op.keep
    ? Object.fromEntries(Object.entries(values).filter(([key, value]) => op.keep!(key, value)))
    : values;
  if (Object.keys(kept).length === 0) return undefined;
  const next = { schema: op.schema, values: kept };
  // Too large: the write is refused and what was saved stays (a tool bounds its own fields well below this).
  return fits(next) ? next : current;
};

/** What this page knows of a tool's entry in the storage: its parameters as far as they are valid, and its revision. */
interface Known {
  parameters: StoredParameters | undefined;
  revision: Revision | undefined;
}

/**
 * The store: the settings over `area` (the last known record in memory, followed live; a write reads the area first),
 * the tools' saved parameters over `parameters` (seam `ParameterStorage`).
 */
export const createToolSettings = (area: ToolSettingsArea, parameters: ParameterStorage): ToolSettingsStore => {
  let record = normalizeToolSettings(undefined);
  const listeners = new Set<() => void>();
  const resetListeners = new Map<string, Set<() => void>>();
  const declared = new Map<string, DiffersFromDefaults>();
  const own = new Map<string, { record: ToolSettingsRecord; values: ToolSettingValues }>();
  const notify = () => listeners.forEach(l => l());

  // A write heard while the first read is under way is newer than what that read returns.
  let heard = false;
  const take = (raw: unknown) => {
    record = normalizeToolSettings(raw);
    notify();
  };
  area.watch(raw => {
    heard = true;
    take(raw);
  });
  const ready = area.read().then(
    raw => void (heard || take(raw)),
    () => undefined,
  );

  // One write at a time in this page.
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

  // The saved parameters: what the storage holds for each tool, as far as this page knows; the person's changes the
  // storage has not taken yet, in the order made; and what the tool sees — the first with the second applied.
  const known = new Map<string, Known>();
  let held: ParameterOp[] = [];
  const problems = new Map<string, SaveProblem>();
  const shown = new Map<string, StoredParameters | undefined>();
  const shownOf = (toolId: string): StoredParameters | undefined => {
    if (!shown.has(toolId))
      shown.set(toolId, held.filter(op => op.toolId === toolId).reduce(applyOp, known.get(toolId)?.parameters));
    return shown.get(toolId);
  };
  const changedHere = () => {
    shown.clear();
    notify();
  };
  const learn = (toolId: string, entry: ParameterEntry | undefined) =>
    void known.set(toolId, { parameters: entry && parametersOf(entry.parameters), revision: entry?.revision });

  let timer: ReturnType<typeof setTimeout> | undefined;
  let following = false;
  const reads = new Map<string, Promise<void>>();
  /** The first read of a tool's entry (once per page); the storage is followed from the first one on. */
  const open = (toolId: string): Promise<void> => {
    let read = reads.get(toolId);
    if (read) return read;
    if (!following) {
      following = true;
      parameters.watch((id, entry) => {
        if (known.get(id)?.revision !== entry?.revision || !known.has(id)) {
          learn(id, entry);
          changedHere();
        }
        // News of a tool whose changes were refused: the storage can be asked again.
        if (problems.has(id)) void flush();
      });
    }
    read = parameters.read(toolId).then(
      entry => {
        // Heard of meanwhile (a report, a write's answer): that is newer than what this read returns.
        if (known.has(toolId)) return;
        learn(toolId, entry);
        changedHere();
      },
      () => undefined,
    );
    reads.set(toolId, read);
    return read;
  };

  /**
   * Writes one tool's changes — every one this page holds for it, in the order made: the entry this page knows with
   * them applied, on the condition that the storage's entry is still that one.
   */
  const send = async (toolId: string): Promise<void> => {
    await open(toolId);
    const ops = held.filter(op => op.toolId === toolId);
    // What it stays, if the entry keeps changing elsewhere through every attempt.
    let problem: SaveProblem | undefined = 'failed';
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
      const base = known.get(toolId);
      const next = ops.reduce(applyOp, base?.parameters);
      // Nothing to change — unless it is the removal of an entry that only reads as nothing (a damaged one).
      if (sameParameters(next, base?.parameters) && (next !== undefined || base?.revision === undefined)) {
        problem = undefined;
        break;
      }
      const answer = await parameters
        .write(toolId, next, base?.revision)
        .catch((error: unknown) => ({ status: 'failed' as const, reason: String(error) }));
      if (answer.status === 'accepted' || answer.status === 'conflict') learn(toolId, answer.entry);
      if (answer.status === 'conflict') continue;
      problem = answer.status === 'accepted' ? undefined : answer.status;
      break;
    }
    if (problem) {
      // The changes stay held in this page: still seen by the tool, sent again by the next flush.
      problems.set(toolId, problem);
    } else {
      held = held.filter(op => !ops.includes(op));
      problems.delete(toolId);
    }
  };

  const flush = (): Promise<void> => {
    clearTimeout(timer);
    timer = undefined;
    if (held.length === 0) return queue;
    return serial(async () => {
      try {
        // What an earlier write in the queue has taken meanwhile is no longer held: nothing is written twice.
        for (const toolId of new Set(held.map(op => op.toolId))) await send(toolId);
      } finally {
        changedHere();
      }
    });
  };
  const change = (op: ParameterOp, now: boolean): Promise<void> => {
    void open(op.toolId);
    held.push(op);
    changedHere();
    if (now) return flush();
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), SAVE_AFTER_MS);
    return Promise.resolve();
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  };
  const readiness = new Map<string, Promise<void>>();

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
      saved: () => {
        void open(toolId);
        return shownOf(toolId);
      },
      save: (schema, values, keep) => void change({ toolId, schema, change: values, keep }, false),
      flush,
      declare: differs => {
        void open(toolId);
        declared.set(toolId, differs);
        notify();
        return () => {
          if (declared.get(toolId) !== differs) return;
          declared.delete(toolId);
          notify();
        };
      },
      changed: () => parameters.keeps && (declared.get(toolId)?.(shownOf(toolId)) ?? false),
      reset: () => {
        // The tool's page drops its values first, so nothing it had not written yet comes back after the removal.
        resetListeners.get(toolId)?.forEach(l => l());
        // The removal stands for every earlier change of the tool.
        held = held.filter(op => op.toolId !== toolId);
        return change({ toolId, forget: true }, true);
      },
      onReset: listener => {
        const set = resetListeners.get(toolId) ?? new Set();
        resetListeners.set(toolId, set.add(listener));
        return () => void set.delete(listener);
      },
      unsaved: () => problems.get(toolId),
    }),
    forAll: () => record.all,
    setForAll: (toolIds, values) => write(r => upsertAll(r, toolIds, values)),
    subscribe,
    ready,
    readyFor: toolId => {
      let both = readiness.get(toolId);
      if (!both) {
        both = Promise.all([ready, open(toolId)]).then(() => undefined);
        readiness.set(toolId, both);
      }
      return both;
    },
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

/**
 * Per-tool settings in this page's memory, saved parameters included: nothing outlives the object. The default of a
 * tool rendered with no host.
 */
export const memoryToolSettings = (): ToolSettingsStore =>
  createToolSettings(memoryToolSettingsArea(), memoryParameterStorage());
