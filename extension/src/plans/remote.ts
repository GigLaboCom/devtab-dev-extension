/**
 * `PlanSource` of the product: the record `plans` that the service worker writes (src/background/plans) — read from
 * chrome.storage.local, followed through storage.onChanged so a new list reaches every open tab at once — and
 * `plans/refresh` to ask the worker for a fresh one. The page never goes to the network itself. A build whose licence
 * configuration has no server (no origin — the store build until the server exists) shows no plans at all (`absent`)
 * and asks nothing. The rules a list must pass — the hosts a card may link to, the currencies a price may use — come
 * from the same configuration (src/licence).
 */
import { followPlans } from './follow';
import { intlCurrencies } from './model';
import { licence } from '@src/licence';
import { PLANS_KEY, readPlansRecord } from '@src/shared/plansRecord';
import type { CatalogRules } from './model';
import type { PlanSource, PlanSourceEnvironment, PlanSourceFactory, PlansView } from './source';
import type { PlansOutcome, PlansReply } from '@src/shared/licenceMessages';
import type { PlansRecord } from '@src/shared/plansRecord';

const ABSENT: PlansView = { kind: 'absent' };

const recordOf = (raw: unknown): PlansRecord | undefined => {
  const record = readPlansRecord(raw);
  return typeof record === 'object' ? record : undefined;
};

/** A reply of the worker's shape as an outcome; anything else is `worker`. */
const outcomeOf = (reply: unknown): PlansOutcome => {
  const { v, ok, error, retryAt } = (reply ?? {}) as Partial<Record<keyof PlansReply | 'error' | 'retryAt', unknown>>;
  if (v !== 1) return { ok: false, error: 'worker' };
  if (ok === true) return { ok: true };
  if (ok !== false || typeof error !== 'string') return { ok: false, error: 'worker' };
  return {
    ok: false,
    error: error as Extract<PlansOutcome, { ok: false }>['error'],
    ...(typeof retryAt === 'number' && Number.isFinite(retryAt) ? { retryAt } : {}),
  };
};

/** Reads `plans` from storage.local, follows onChanged, asks the worker with `plans/refresh`. */
export const remotePlansSource = (
  env: PlanSourceEnvironment & { readonly rules: CatalogRules; readonly origin: string | undefined },
): PlanSource => {
  if (env.origin === undefined)
    return {
      id: 'remotePlans',
      current: () => ABSENT,
      ready: Promise.resolve(ABSENT),
      subscribe: () => () => undefined,
      refresh: () => Promise.resolve(),
      dispose: () => undefined,
    };
  const { local, onChanged } = env.chrome.storage;
  return followPlans(
    'remotePlans',
    {
      read: async () => recordOf(((await local.get(PLANS_KEY)) as Record<string, unknown>)[PLANS_KEY]),
      follow: changed => {
        const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
          if (area === 'local' && PLANS_KEY in changes) changed(recordOf(changes[PLANS_KEY].newValue));
        };
        onChanged.addListener(listener);
        return () => onChanged.removeListener(listener);
      },
      ask: async reason => {
        try {
          return outcomeOf(await env.chrome.runtime.sendMessage({ type: 'plans/refresh', v: 1, reason }));
        } catch {
          return { ok: false, error: 'worker' };
        }
      },
    },
    env.rules,
    env.now ?? Date.now,
  );
};

/** The plans of the build: origin and rules (payHosts; currencies = Intl + testCurrencies) from the licence root. */
export const remotePlans: PlanSourceFactory = Object.assign(
  (env: PlanSourceEnvironment) =>
    remotePlansSource({
      ...env,
      origin: licence.origin,
      rules: { payHosts: licence.payHosts, currencies: new Set([...intlCurrencies(), ...licence.testCurrencies]) },
    }),
  { id: 'remotePlans' as const },
);
