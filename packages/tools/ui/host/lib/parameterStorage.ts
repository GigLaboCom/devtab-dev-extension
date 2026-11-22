/**
 * Seam `ParameterStorage` — where a host keeps the tools' saved parameters (D21, D23; docs/tools/settings-storage.md).
 * The logic above it (settings.ts: validation, the schema version per tool, the delayed write, reset) is the same for
 * every implementation; an implementation only holds one entry per tool and answers four questions:
 *
 *   keeps                          does what it is given outlive this page?
 *   read(toolId)                   what do you hold for this tool?
 *   write(toolId, parameters, base) put this instead of the entry I based it on — or tell me why you did not
 *   watch(listener)                tell me when a tool's entry changes without my writing it
 *
 * The rules every implementation keeps (parameterStorageContract.ts checks them on each):
 *
 * - **One tool, one entry.** A write names one tool and touches nothing of any other.
 * - **A write is conditional.** It carries the revision of the entry it was computed from (`base`; `undefined`: from
 *   there being none) and is applied only while that is still the tool's current revision. Otherwise nothing changes
 *   and the answer is `conflict` with the current entry: the logic applies the person's changes to it, field by field,
 *   and writes again. So two pages, or two devices, changing different parameters of one tool keep both, and the same
 *   parameter keeps the value written last.
 * - **Every write is answered**, never thrown: `accepted` (the entry is now what was written), `conflict`,
 *   `unavailable` (it cannot be reached now — offline, signed out — and may be later) or `failed` (it refused: a
 *   quota, a closed context; asking again the same way is not expected to help). After anything but `accepted` the
 *   storage holds what it held before.
 * - **A read is answered too**: with the entry, or with `undefined` when there is none or it cannot be reached.
 * - **Both settle in a time the implementation bounds.** A tool's page waits for the read before it shows the tool,
 *   and the logic sends one write at a time, so a write that never settled would hold back every later one.
 * - **Revisions** are the storage's own marks, compared for equality only: an entry that changed has another one, an
 *   entry read twice without a change has the same one.
 * - **`watch`** reports every change of a tool's entry that this storage object did not make itself (another page,
 *   another device), with the entry as it is now, in the order the changes were applied to that tool, and never an
 *   entry older than one this object already returned or reported. It may report this object's own writes as well. A
 *   storage that answered `unavailable` for a tool, or could not be reached while the tool's entry changed, reports the
 *   tool's current entry once it can be reached again — that report is how the logic knows to send what it held.
 * - **It does not check what it holds.** `parameters` of an entry read back is whatever is stored; the logic validates
 *   it (and bounds its size) before any use.
 * - **A queue of changes not yet delivered**, if an implementation has one (a remote one that also keeps a copy on the
 *   device), is its own: it answers `accepted` once the change is safe on the device, delivers it later under the same
 *   conditional rule, and reports whatever that changes through `watch`. An implementation without one answers
 *   `unavailable`, and the logic holds the change in the page until the storage reports the tool again.
 */

/** A value of a saved parameter: a plain JSON scalar, or a list of strings (a list the person built). */
export type ParameterValue = boolean | number | string | readonly string[];

/** A tool's saved parameters as stored: the tool's schema version and the values that differ from its defaults. */
export interface StoredParameters {
  readonly schema: number;
  readonly values: Readonly<Record<string, ParameterValue>>;
}

/** A storage's own mark of one state of a tool's entry: opaque, compared for equality only. */
export type Revision = string;

/** What a storage holds for one tool. */
export interface ParameterEntry {
  /** As stored and unchecked: the logic validates it before use. */
  readonly parameters: unknown;
  readonly revision: Revision;
}

/** A storage's answer to a write. `entry` is what it holds for the tool now (`undefined`: nothing). */
export type ParameterWrite =
  | { readonly status: 'accepted'; readonly entry: ParameterEntry | undefined }
  | { readonly status: 'conflict'; readonly entry: ParameterEntry | undefined }
  | { readonly status: 'unavailable' }
  | { readonly status: 'failed'; readonly reason: string };

export type ParameterWatcher = (toolId: string, entry: ParameterEntry | undefined) => void;

export interface ParameterStorage {
  /**
   * Does what it is given outlive this page? `false`: the parameters live in the page only, so the host offers no reset
   * of them and has nothing to say about saving.
   */
  readonly keeps: boolean;
  /** What it holds for the tool; `undefined`: nothing, or it cannot be reached now. Never rejects. */
  read(toolId: string): Promise<ParameterEntry | undefined>;
  /**
   * Puts `parameters` in place of the tool's entry (`undefined` removes it) if the entry's revision is still `base`
   * (`undefined`: if there is still none). Never rejects.
   */
  write(toolId: string, parameters: StoredParameters | undefined, base: Revision | undefined): Promise<ParameterWrite>;
  /** Calls `listener` when a tool's entry changes otherwise than by this object's own write; returns the undo. */
  watch(listener: ParameterWatcher): () => void;
}

/**
 * The storage that is switched off: it holds nothing and writes nothing anywhere. Every write is taken and forgotten,
 * every read finds nothing, nothing is ever reported. What the person chose lives in the page's own memory (the logic's)
 * while the page is open; the next page opens every tool with its defaults.
 */
export const noParameterStorage = (): ParameterStorage => ({
  keeps: false,
  read: async () => undefined,
  write: async (_toolId, parameters) => ({
    status: 'accepted',
    entry: parameters && { parameters, revision: '' },
  }),
  watch: () => () => undefined,
});

/**
 * A storage in memory, kept for as long as the object lives and shared by every page given the same object: the default
 * of a host that has none (a test, a tool rendered alone), and the plainest implementation of the rules above.
 */
export const memoryParameterStorage = (): ParameterStorage => {
  const entries = new Map<string, ParameterEntry>();
  const watchers = new Set<ParameterWatcher>();
  let written = 0;
  return {
    keeps: true,
    read: async toolId => entries.get(toolId),
    write: async (toolId, parameters, base) => {
      const current = entries.get(toolId);
      if (current?.revision !== base) return { status: 'conflict', entry: current };
      if (!current && !parameters) return { status: 'accepted', entry: undefined };
      const entry = parameters && { parameters: structuredClone(parameters), revision: String(++written) };
      if (entry) entries.set(toolId, entry);
      else entries.delete(toolId);
      watchers.forEach(w => w(toolId, entry));
      return { status: 'accepted', entry };
    },
    watch: listener => {
      watchers.add(listener);
      return () => void watchers.delete(listener);
    },
  };
};
