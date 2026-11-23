/**
 * Seam `ParameterStorage` for an open page whose edition can change: the storage of the edition in force, without
 * losing what the person chose on the page. Each edition's storage is built once (`edition.parameters(browser)`); reads,
 * writes and reports go to the one in force; `keeps` is a getter — the only implementation whose `keeps` changes on an
 * open page.
 *
 *   - While the storage in force keeps nothing (free), the last parameters written for each tool are remembered in the
 *     page (the same page memory the free version keeps a choice in anyway).
 *   - Keeps nothing → keeps (free → Pro): for each tool chosen on the page, the stored entry is read and the page's
 *     choice written on its revision (up to 3 attempts on a conflict), and the accepted entry is reported to the
 *     watchers — the logic learns the new revision while what it shows stays: the page's choice is newer than anything
 *     stored, and is written first. Tools the page did not change stay as shown; their next write meets the stored
 *     entry (a conflict) and the logic merges field by field. Writes that arrive meanwhile wait for the carrying over.
 *   - Keeps → keeps nothing (Pro → free): writes go nowhere from then on and are remembered in the page; the stored
 *     entries are not touched; nothing is reported.
 */
import { editionFor } from './inForce';
import type { BrowserStorage } from '../tools/settings';
import type { Edition } from './edition';
import type { SourceState } from './source';
import type { ParameterStorage, ParameterWatcher, StoredParameters } from '@workspace/tools-host';

/** How many times the page's choice of a tool is tried when the stored entry keeps changing meanwhile. */
const CARRY_ATTEMPTS = 3;

/**
 * The storage of the edition in force: forwards to `editionOf(state).parameters(browser)` (each built once), and when
 * the edition changes on an open page carries the page's choice over. `keeps` is a getter.
 */
export const editionParameterStorage = (
  source: { current(): SourceState; subscribe(listener: (state: SourceState) => void): () => void },
  browser: BrowserStorage,
  editionOf: (state: SourceState) => Edition = editionFor,
): ParameterStorage & { dispose(): void } => {
  const built = new Map<Edition, ParameterStorage>();
  const storageOf = (edition: Edition): ParameterStorage => {
    let storage = built.get(edition);
    if (!storage) {
      storage = edition.parameters(browser);
      built.set(edition, storage);
    }
    return storage;
  };

  let current = storageOf(editionOf(source.current()));
  const watchers = new Set<ParameterWatcher>();
  const report: ParameterWatcher = (toolId, entry) => watchers.forEach(w => w(toolId, entry));
  let unwatch = current.watch(report);
  /** What the page chose for each tool while the storage in force kept nothing. */
  const pageChoices = new Map<string, StoredParameters | undefined>();
  /** One queue: the carrying over, and the writes that arrive while it runs. */
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };

  const carryOver = async (into: ParameterStorage): Promise<void> => {
    const choices = [...pageChoices];
    pageChoices.clear();
    for (const [toolId, parameters] of choices) {
      for (let attempt = 0; attempt < CARRY_ATTEMPTS; attempt++) {
        const stored = await into.read(toolId);
        if (!stored && !parameters) break;
        const answer = await into.write(toolId, parameters, stored?.revision);
        if (answer.status === 'accepted') {
          report(toolId, answer.entry);
          break;
        }
        if (answer.status !== 'conflict') break;
      }
    }
  };

  const undoSource = source.subscribe(state => {
    const next = storageOf(editionOf(state));
    if (next === current) return;
    const before = current;
    unwatch();
    current = next;
    unwatch = current.watch(report);
    if (!before.keeps && next.keeps) void enqueue(() => carryOver(next));
  });

  return {
    get keeps() {
      return current.keeps;
    },
    read: toolId => enqueue(() => current.read(toolId)),
    write: (toolId, parameters, base) =>
      enqueue(() => {
        if (!current.keeps) pageChoices.set(toolId, parameters);
        return current.write(toolId, parameters, base);
      }),
    watch: listener => {
      watchers.add(listener);
      return () => void watchers.delete(listener);
    },
    dispose: () => {
      undoSource();
      unwatch();
      watchers.clear();
    },
  };
};
