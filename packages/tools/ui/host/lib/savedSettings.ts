/**
 * A tool's saved parameters (D21; docs/tools/settings.md): what the person chose last time — the indent, the client,
 * the alphabet, a list they built — so the tool opens with it next time. The tool declares its parameters once, each
 * with its default and the check a stored value must pass, and reads them back through one hook:
 *
 *   export const jsonSettings = declareSettings({
 *     schema: 1,
 *     fields: { mode: setting.oneOf(['format', 'minify'], 'format'), sortKeys: setting.boolean(false) },
 *   });
 *   const saved = useSavedSettings(host, 'json', jsonSettings);
 *   saved.values.mode               // what to open with: saved over the defaults, then what this visit set
 *   saved.set({ mode: 'minify' })   // the person changed it: shown and saved
 *   saved.visit({ mode: 'minify' }) // an opened entry or a paste chose it: shown for this visit, never saved
 *   useSavedSettings(host, 'base64', base64Settings, { opening: input ? { mode: 'decode' } : undefined })
 *                                   // a paste that opens the tool in a mode: the same, from the first render
 *
 * What a tool opens with, in this order: a history entry being opened → what the start page's paste chose → the saved
 * values → the defaults. Only the person changing a parameter writes (`set`); an entry or a paste (`visit`) never does.
 *
 * Robust to change: the stored record carries the tool's `schema`; a field that is missing, of the wrong type or outside
 * its allowed values falls back to its default by itself, an unknown field is dropped, and values of another schema are
 * not used (unless the declaration's `migrate` reads them). Nothing is written until the person changes something; a
 * value equal to its default is not stored, so the record is exactly what differs from the defaults. Writes are
 * debounced and bounded (settings.ts).
 *
 * Whether the values outlive the page is the host's choice, not the tool's: the host's `settings` keeps them in storage
 * (Pro) or in the page's memory (the free version), and offers the reset control on the tool's page
 * (`useSettingsReset`). A tool with no host keeps them for the visit only. Two pages open on one tool: each opens
 * with what was saved when it opened and does not follow the other's later changes; a write merges the parameters the
 * person changed into what is stored at that moment, so each changed field keeps its last value.
 */
import { memoryToolSettings } from './settings';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ToolHost } from './host';
import type { KeepParameter, ParameterChange, ParameterValue, StoredParameters, ToolSettings } from './settings';

/** One parameter: its default and the check a stored value must pass to be used. */
export interface Setting<T extends ParameterValue> {
  readonly default: T;
  /** Is a stored value one the tool's controls can show? */
  readonly accepts: (value: unknown) => value is T;
}

const inRange = (value: number, { min, max }: { min: number; max: number }) => value >= min && value <= max;

/**
 * A default, or how to read one that depends on the machine (the browser's time zone): read again each time it is
 * needed, so the default follows the browser and a test can set it.
 */
export type Fallback<T> = T | (() => T);

const withDefault = <T extends ParameterValue>(
  fallback: Fallback<T>,
  accepts: (value: unknown) => value is T,
): Setting<T> => ({
  get default() {
    return typeof fallback === 'function' ? (fallback as () => T)() : fallback;
  },
  accepts,
});

/** The kinds of parameters a tool declares, each with its default (the last argument). */
export const setting = {
  boolean: (fallback: Fallback<boolean>): Setting<boolean> =>
    withDefault(fallback, (value): value is boolean => typeof value === 'boolean'),
  /** One of the listed values (strings or numbers, as the control's options are). */
  oneOf: <const T extends string | number>(values: readonly T[], fallback: Fallback<NoInfer<T>>): Setting<T> =>
    withDefault(fallback, (value): value is T => values.includes(value as T)),
  integer: (range: { min: number; max: number }, fallback: Fallback<number>): Setting<number> =>
    withDefault(fallback, (value): value is number => Number.isSafeInteger(value) && inRange(value as number, range)),
  number: (range: { min: number; max: number }, fallback: Fallback<number>): Setting<number> =>
    withDefault(
      fallback,
      (value): value is number => typeof value === 'number' && Number.isFinite(value) && inRange(value, range),
    ),
  /** A text the person typed that configures the tool (never its input): bounded, and passing `test` if given. */
  text: (rule: { maxLength: number; test?: (text: string) => boolean }, fallback: Fallback<string>): Setting<string> =>
    withDefault(
      fallback,
      (value): value is string =>
        typeof value === 'string' && value.length <= rule.maxLength && (rule.test?.(value) ?? true),
    ),
  /** A list the person built: at most `maxItems` strings, each passing `item`, no repeats. */
  list: (
    rule: { maxItems: number; item: (text: string) => boolean },
    fallback: Fallback<readonly string[]>,
  ): Setting<readonly string[]> =>
    withDefault(
      fallback,
      (value): value is readonly string[] =>
        Array.isArray(value) &&
        value.length <= rule.maxItems &&
        new Set(value).size === value.length &&
        value.every(item => typeof item === 'string' && rule.item(item)),
    ),
};

/** A tool's parameters by key. */
export type ParameterValues = Readonly<Record<string, ParameterValue>>;

/** What a tool declares: its parameters with their defaults and checks, under a schema version. */
export interface SettingsDeclaration<V extends ParameterValues = ParameterValues> {
  /**
   * Raised when a field's meaning changes (not when a field is added or removed — those fall back or are dropped by
   * themselves). Stored values of another schema are not used, unless `migrate` reads them.
   */
  readonly schema: number;
  readonly fields: { readonly [K in keyof V]: Setting<V[K]> };
  /** Stored values of an older schema, as this schema's (each is still checked). */
  readonly migrate?: (from: number, values: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>;
}

type ValuesOf<F> = { readonly [K in keyof F]: F[K] extends Setting<infer T> ? T : never };

/** Declares a tool's saved parameters; the values' type follows from the fields. */
export const declareSettings = <F extends Readonly<Record<string, Setting<ParameterValue>>>>(declaration: {
  schema: number;
  fields: F;
  migrate?: SettingsDeclaration['migrate'];
}): SettingsDeclaration<ValuesOf<F>> => declaration as unknown as SettingsDeclaration<ValuesOf<F>>;

/** The values a declaration's type stands for. */
export type SettingsValues<D> = D extends SettingsDeclaration<infer V> ? V : never;

/** Two parameter values are the same (a list by its items, in order). */
export const sameParameter = (a: ParameterValue, b: ParameterValue): boolean =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((item, i) => item === b[i]) : a === b;

const fieldsOf = <V extends ParameterValues>(declaration: SettingsDeclaration<V>) =>
  Object.entries(declaration.fields) as Array<[string, Setting<ParameterValue>]>;

/** The declared defaults. */
export const defaultsOf = <V extends ParameterValues>(declaration: SettingsDeclaration<V>): V =>
  Object.fromEntries(fieldsOf(declaration).map(([key, field]) => [key, field.default])) as unknown as V;

/** What is stored, as this schema's values (another schema's, migrated or nothing). */
const storedValues = <V extends ParameterValues>(
  declaration: SettingsDeclaration<V>,
  saved: StoredParameters | undefined,
): Readonly<Record<string, unknown>> => {
  if (!saved) return {};
  if (saved.schema === declaration.schema) return saved.values;
  if (declaration.migrate && saved.schema < declaration.schema) {
    try {
      return declaration.migrate(saved.schema, saved.values);
    } catch {
      return {};
    }
  }
  return {};
};

/** The values to open with: each field's stored value when it passes the field's check, its default otherwise. */
export const readSaved = <V extends ParameterValues>(
  declaration: SettingsDeclaration<V>,
  saved: StoredParameters | undefined,
): V => {
  const values = storedValues(declaration, saved);
  return Object.fromEntries(
    fieldsOf(declaration).map(([key, field]) => {
      const value = Object.prototype.hasOwnProperty.call(values, key) ? values[key] : undefined;
      return [key, field.accepts(value) ? value : field.default];
    }),
  ) as unknown as V;
};

/** Does any field read from what is stored differ from its default? */
export const differsFromDefaults = <V extends ParameterValues>(
  declaration: SettingsDeclaration<V>,
  saved: StoredParameters | undefined,
): boolean => {
  const values = readSaved(declaration, saved);
  return fieldsOf(declaration).some(([key, field]) => !sameParameter(values[key]!, field.default));
};

/** What a write keeps of the stored values: declared fields, valid, not at their defaults. Unknown fields are dropped. */
const keeper =
  <V extends ParameterValues>(declaration: SettingsDeclaration<V>): KeepParameter =>
  (key, value) => {
    const field = (declaration.fields as Readonly<Record<string, Setting<ParameterValue>>>)[key];
    return field !== undefined && field.accepts(value) && !sameParameter(value, field.default);
  };

export interface SavedSettings<V extends ParameterValues> {
  /** The values for this visit: saved over the defaults, then what this visit set. */
  readonly values: V;
  /** The person changed these: shown at once and saved (a value that fails its field's check is shown, not saved). */
  set(change: Partial<V>): void;
  /** An opened history entry or the start page's paste chose these: shown for this visit, never saved. */
  visit(change: Partial<V>): void;
}

export interface SavedSettingsOptions<V extends ParameterValues> {
  /**
   * What the start page's paste chose for this visit (a tool that opens pasted text in a mode): over the saved values
   * from the first render, never saved — `visit` at the opening.
   */
  opening?: Partial<V>;
  /**
   * Called after the reset control put every parameter back to its default, with the defaults — for a tool that keeps
   * the parameters in a state of its own (the values given by the hook are already the defaults then).
   */
  onReset?: (defaults: V) => void;
}

/**
 * A tool's saved parameters, read once when its page opens. The host decides whether they outlive the page; with no
 * host they live as long as the tool's component.
 */
export const useSavedSettings = <V extends ParameterValues>(
  host: ToolHost | undefined,
  toolId: string,
  declaration: SettingsDeclaration<V>,
  options: SavedSettingsOptions<V> = {},
): SavedSettings<V> => {
  // No host: the visit's own memory — nothing is remembered from one rendering of the tool to the next.
  const [alone] = useState(memoryToolSettings);
  const settings = host?.settings ?? alone;
  const own = useMemo(() => settings.forTool(toolId), [settings, toolId]);
  const [opened] = useState(() => own.saved());
  const [values, setValues] = useState<V>(() => ({ ...readSaved(declaration, opened), ...options.opening }));
  const onReset = useRef(options.onReset);
  onReset.current = options.onReset;
  // Values of an older schema the tool migrated go into the first write, so changing one field keeps the others.
  const carried = useRef<Record<string, ParameterValue>>(
    opened && opened.schema !== declaration.schema
      ? Object.fromEntries(
          Object.entries(readSaved(declaration, opened)).filter(([key, value]) => keeper(declaration)(key, value)),
        )
      : {},
  );

  useEffect(() => {
    const undeclare = own.declare(saved => differsFromDefaults(declaration, saved));
    const off = own.onReset(() => {
      const defaults = defaultsOf(declaration);
      carried.current = {};
      setValues(defaults);
      onReset.current?.(defaults);
    });
    const flush = () => void own.flush().catch(() => undefined);
    const hidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', hidden);
      off();
      undeclare();
      flush();
    };
  }, [own, declaration]);

  const set = useCallback(
    (change: Partial<V>) => {
      setValues(current => ({ ...current, ...change }));
      const keep = keeper(declaration);
      const fields = declaration.fields as Readonly<Record<string, Setting<ParameterValue>>>;
      const write: Record<string, ParameterValue | undefined> = { ...carried.current };
      carried.current = {};
      for (const [key, value] of Object.entries(change) as Array<[string, ParameterValue | undefined]>) {
        const field = fields[key];
        if (field === undefined || value === undefined || !field.accepts(value)) continue;
        write[key] = sameParameter(value, field.default) ? undefined : value;
      }
      if (Object.keys(write).length > 0) own.save(declaration.schema, write as ParameterChange, keep);
    },
    [own, declaration],
  );
  const visit = useCallback((change: Partial<V>) => setValues(current => ({ ...current, ...change })), []);
  return useMemo(() => ({ values, set, visit }), [values, set, visit]);
};

/**
 * For a host's tool page: the reset of the tool's saved parameters while they differ from its defaults, or undefined
 * (none saved, all at their defaults, the tool's page not open yet — or no `settings`: a host that offers no reset
 * passes none).
 */
export const useSettingsReset = (settings: ToolSettings | undefined, toolId: string): (() => void) | undefined => {
  const own = useMemo(() => settings?.forTool(toolId), [settings, toolId]);
  const subscribe = useCallback((listener: () => void) => own?.subscribe(listener) ?? (() => undefined), [own]);
  const changed = useSyncExternalStore(
    subscribe,
    useCallback(() => own?.changed() ?? false, [own]),
  );
  return useMemo(() => (own && changed ? () => void own.reset().catch(() => undefined) : undefined), [own, changed]);
};
