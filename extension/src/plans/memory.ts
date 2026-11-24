/**
 * `PlanSource` in memory, scripted: a plans record kept in the page and answers to `refresh` taken one by one — what
 * the service worker would write after each. For the tests of pages and of the style kit's plan cards, and the showcase
 * variant (./sample.ts). Nothing is read from storage or sent anywhere. Sources made over the same script object share
 * its place, as two pages share chrome.storage: the record, the answers, and the count of refreshes.
 */
import { followPlans } from './follow';
import { intlCurrencies, parseCatalog } from './model';
import type { PlansPlace } from './follow';
import type { CatalogRules } from './model';
import type { PlanSource } from './source';
import type { PlansOutcome } from '@src/shared/licenceMessages';
import type { PlansFailure, PlansRecord } from '@src/shared/plansRecord';

type Failure = 'offline' | 'server' | 'rate-limited' | 'server-busy';

export interface PlansScript {
  /** What the stored record holds at the start. */
  readonly record?: PlansRecord;
  /** Answers to `refresh`, taken one by one; empty — as if offline. */
  readonly replies?: readonly ({ readonly body: unknown } | { readonly fail: Failure })[];
}

/** A Retry-After a scripted 429 or 503 names. */
const RETRY_MS = 120_000;

interface MemoryPlace extends PlansPlace {
  readonly calls: () => number;
}

const placeOf = (script: PlansScript, now: () => number, rules: CatalogRules): MemoryPlace => {
  let record = script.record;
  /** The next answer of `script.replies` (read as it is then: a test may add answers later). */
  let next = 0;
  const listeners = new Set<(record: PlansRecord | undefined) => void>();
  let calls = 0;

  const store = (next: PlansRecord) => {
    record = next;
    for (const listener of [...listeners]) listener(record);
  };
  const fail = (last: number, why: PlansFailure, retryAt?: number): PlansOutcome => {
    store({
      v: 1,
      ...(record?.fetchedAt !== undefined ? { fetchedAt: record.fetchedAt } : {}),
      ...(record?.body !== undefined ? { body: record.body } : {}),
      failure: { at: last, why },
      attempts: {
        last,
        failures: (record?.attempts.failures ?? 0) + 1,
        ...(retryAt !== undefined
          ? { retryAfter: retryAt, retryCause: why === 'server-busy' ? 'server-busy' : 'rate-limited' }
          : {}),
      },
    });
    return { ok: false, error: why, ...(retryAt !== undefined ? { retryAt } : {}) };
  };

  return {
    calls: () => calls,
    read: async () => record,
    follow: changed => {
      listeners.add(changed);
      return () => void listeners.delete(changed);
    },
    ask: async () => {
      calls += 1;
      const at = now();
      const reply = script.replies?.[next] ?? { fail: 'offline' as const };
      next += 1;
      if ('fail' in reply)
        return fail(
          at,
          reply.fail,
          reply.fail === 'rate-limited' || reply.fail === 'server-busy' ? at + RETRY_MS : undefined,
        );
      const parsed = parseCatalog(reply.body, rules);
      if (!parsed.ok) return fail(at, parsed.why === 'unsupported' ? 'unsupported' : 'bad-answer');
      store({ v: 1, fetchedAt: at, body: reply.body, attempts: { last: at, failures: 0 } });
      return { ok: true };
    },
  };
};

/** The place of each script object, made by its first source. */
const places = new WeakMap<PlansScript, MemoryPlace>();

/**
 * In memory, scripted; for tests of pages and kits. `calls` counts refreshes. `rules` are the ones a list must pass —
 * by default no host to link to and the currencies Intl knows.
 */
export const memoryPlans = (
  script: PlansScript = {},
  now: () => number = Date.now,
  rules: CatalogRules = { payHosts: [], currencies: intlCurrencies() },
): PlanSource & { readonly calls: number } => {
  let place = places.get(script);
  if (!place) {
    place = placeOf(script, now, rules);
    places.set(script, place);
  }
  const { calls } = place;
  return Object.defineProperty(followPlans('memoryPlans', place, rules, now), 'calls', {
    get: calls,
    enumerable: true,
  }) as PlanSource & { readonly calls: number };
};
