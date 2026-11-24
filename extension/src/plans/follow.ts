/**
 * What every `PlanSource` that follows a stored plans record does (./remote.ts over chrome.storage and the service
 * worker, ./memory.ts over a record in memory and scripted answers): the view of the record at the page's clock — a
 * list that parses and is fresh shows its prices, a stale one shows its plans without prices, an unusable one is not
 * shown at all — `loading` while a request is on its way, a timer at the next boundary of freshness and a new look when
 * the page becomes visible (timers run late after sleep). The record is parsed again here: the page trusts no record.
 */
import { parseCatalog } from './model';
import { freshness, STALE_FOR_MS } from '@src/shared/plansRecord';
import type { CatalogRules } from './model';
import type { PlanSource, PlansView } from './source';
import type { PlansOutcome } from '@src/shared/licenceMessages';
import type { PlansRecord } from '@src/shared/plansRecord';

/** The longest delay setTimeout keeps; a boundary further away is reached in steps. */
const MAX_DELAY_MS = 2 ** 31 - 1;
/** How long the page waits for the record's first read before `ready` resolves anyway. */
const READY_WAIT_MS = 2_000;
/** `Try again` after an attempt that failed without a Retry-After: not before this (the worker's own limit). */
const PRESS_GAP_MS = 60_000;

const IDLE: PlansView = { kind: 'idle' };

const sameView = (a: PlansView, b: PlansView): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The usable list in a record at `now`: parsed and fresh or stale; `undefined` otherwise. */
const listOf = (
  record: PlansRecord | undefined,
  rules: CatalogRules,
  now: number,
): Extract<PlansView, { kind: 'fresh' | 'stale' }> | undefined => {
  if (record?.fetchedAt === undefined || record.body === undefined) return undefined;
  const parsed = parseCatalog(record.body, rules);
  if (!parsed.ok) return undefined;
  const age = freshness(record.fetchedAt, parsed.catalog.maxAgeMs, now);
  return age === 'expired' ? undefined : { kind: age, catalog: parsed.catalog, fetchedAt: record.fetchedAt };
};

/** The view of a record at `now` (pro-plans-and-payment §4.8). */
export const viewOf = (record: PlansRecord | undefined, rules: CatalogRules, now: number): PlansView => {
  const list = listOf(record, rules, now);
  if (list) return list;
  const failure = record?.failure;
  if (!record || !failure) return IDLE;
  if (failure.why === 'unsupported') return { kind: 'unsupported' };
  const { last, retryAfter } = record.attempts;
  const retryAt = Math.max(retryAfter ?? 0, last !== undefined ? last + PRESS_GAP_MS : 0);
  return { kind: 'unavailable', why: failure.why, ...(retryAt > 0 ? { retryAt } : {}) };
};

/** The next instant at which the view of `record` changes by the clock alone. */
const nextBoundary = (record: PlansRecord | undefined, rules: CatalogRules, now: number): number | undefined => {
  const list = listOf(record, rules, now);
  if (!list) return undefined;
  return [list.fetchedAt + list.catalog.maxAgeMs, list.fetchedAt + STALE_FOR_MS].find(at => at > now);
};

/** A plans record somewhere, and the way to ask for a fresh one. */
export interface PlansPlace {
  /** The record as stored now; `undefined` when there is none or it is not readable. */
  read(): Promise<PlansRecord | undefined>;
  /** Calls `changed` after each change of the record; returns the undo. */
  follow(changed: (record: PlansRecord | undefined) => void): () => void;
  /** Asks for a fresh list; never rejects. */
  ask(reason: 'person' | 'opened'): Promise<PlansOutcome>;
}

/** An answer of the worker that left no trace in the record (it did not answer at all): what the page shows. */
const pageFailure = (outcome: PlansOutcome): PlansView | undefined =>
  outcome.ok || !['worker', 'refused', 'version', 'unavailable'].includes(outcome.error)
    ? undefined
    : { kind: 'unavailable', why: 'worker' };

export const followPlans = (
  id: PlanSource['id'],
  place: PlansPlace,
  rules: CatalogRules,
  now: () => number,
): PlanSource => {
  const listeners = new Set<(view: PlansView) => void>();
  let record: PlansRecord | undefined;
  let read = false;
  let asking = 0;
  /** The worker did not answer the last request; shown while nothing usable is stored. */
  let unanswered: PlansView | undefined;
  let view: PlansView = IDLE;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let resolveReady: (view: PlansView) => void = () => undefined;
  const ready = new Promise<PlansView>(resolve => (resolveReady = resolve));

  const decide = () => {
    clearTimeout(timer);
    timer = undefined;
    if (disposed) return;
    const at = now();
    let next = viewOf(record, rules, at);
    if (next.kind === 'idle' && unanswered) next = unanswered;
    if (asking > 0) {
      const list = next.kind === 'fresh' || next.kind === 'stale' ? next : undefined;
      next = { kind: 'loading', ...(list ? { stale: { catalog: list.catalog, fetchedAt: list.fetchedAt } } : {}) };
    }
    if (!sameView(next, view)) {
      view = next;
      for (const listener of [...listeners]) {
        try {
          listener(next);
        } catch {
          // One listener's failure is its own.
        }
      }
    }
    const boundary = nextBoundary(record, rules, at);
    if (boundary !== undefined) timer = setTimeout(decide, Math.min(Math.max(boundary - at, 0), MAX_DELAY_MS));
  };

  const take = (next: PlansRecord | undefined) => {
    record = next;
    read = true;
    decide();
  };
  const undo = place.follow(next => {
    if (disposed) return;
    take(next);
  });
  const doc = typeof document === 'undefined' ? undefined : document;
  const visible = () => {
    if (doc?.visibilityState === 'visible') decide();
  };
  doc?.addEventListener('visibilitychange', visible);

  const wait = setTimeout(() => resolveReady(view), READY_WAIT_MS);
  place
    .read()
    .then(
      first => {
        if (!read && !disposed) take(first);
      },
      () => {
        if (!read && !disposed) take(undefined);
      },
    )
    .finally(() => {
      clearTimeout(wait);
      resolveReady(view);
    });

  return {
    id,
    current: () => view,
    ready,
    subscribe: listener => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    refresh: async (reason, signal) => {
      if (disposed) return;
      asking += 1;
      unanswered = undefined;
      decide();
      const asked = place.ask(reason).catch((): PlansOutcome => ({ ok: false, error: 'worker' }));
      const dropped = new Promise<'dropped'>(resolve => {
        if (signal?.aborted) resolve('dropped');
        signal?.addEventListener('abort', () => resolve('dropped'), { once: true });
      });
      const outcome = await Promise.race([asked, dropped]);
      if (outcome !== 'dropped') {
        // The record as the worker left it: its change may reach the page after the answer.
        const after = await place.read().catch(() => record);
        if (!disposed) {
          record = after;
          read = true;
          unanswered = pageFailure(outcome);
        }
      }
      asking -= 1;
      decide();
    },
    dispose: () => {
      disposed = true;
      clearTimeout(timer);
      clearTimeout(wait);
      timer = undefined;
      listeners.clear();
      undo();
      doc?.removeEventListener('visibilitychange', visible);
    },
  };
};
