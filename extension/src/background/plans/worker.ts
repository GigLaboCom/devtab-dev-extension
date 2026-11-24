/**
 * The plans list in the service worker (pro-plans-and-payment §4.4–§4.8): a page asks with `plans/refresh`, the worker
 * decides whether to go to the server (./schedule.ts), checks what came (`parseCatalog`, the same rules the pages
 * apply again) and writes the record `plans` — which only it writes; the pages read it and follow its changes, so a
 * new list appears in every open tab at once. An accepted answer replaces the stored one whole and clears the
 * failures; anything else leaves the stored list as it was and notes the failure. Requests that arrive together share
 * one request. A build without the server's origin answers `unavailable` and sends nothing.
 */
import { shouldFetchPlans } from './schedule';
import { createDebug } from '@extension/logger';
import { parseCatalog } from '@src/plans/model';
import { PLANS_KEY, readPlansRecord } from '@src/shared/plansRecord';
import type { PlansServer } from './fetchPlans';
import type { CatalogRules } from '@src/plans/model';
import type { PlansOutcome } from '@src/shared/licenceMessages';
import type { PlansFailure, PlansRecord } from '@src/shared/plansRecord';

const debug = createDebug('extension:plans');

export interface PlansWorkerDeps {
  readonly area: Pick<chrome.storage.LocalStorageArea, 'get' | 'set'>;
  /** undefined when the config has no origin: every request answers `unavailable`, nothing is sent. */
  readonly server: PlansServer | undefined;
  readonly rules: CatalogRules;
  readonly now: () => number;
  /** Whether this installation has a licence (a secret in the record `licence`, read by src/background/licence/store.ts). */
  readonly hasLicence: () => Promise<boolean>;
}

export interface PlansWorker {
  /** Answers one trusted `plans/refresh`; concurrent calls share one request; never rejects. */
  refresh(request: { readonly reason: 'person' | 'opened' }): Promise<PlansOutcome>;
}

const OK: PlansOutcome = { ok: true };

export const plansWorker = (deps: PlansWorkerDeps): PlansWorker => {
  const { area, server, rules, now } = deps;
  let running: Promise<PlansOutcome> | undefined;

  const readRecord = async (): Promise<PlansRecord | undefined> => {
    const record = readPlansRecord(((await area.get(PLANS_KEY)) as Record<string, unknown>)[PLANS_KEY]);
    return typeof record === 'object' ? record : undefined;
  };

  /** The stored list stays; the failure and the attempts are noted. */
  const failed = async (
    record: PlansRecord | undefined,
    last: number,
    why: PlansFailure,
    retry?: { readonly at: number; readonly cause: 'rate-limited' | 'server-busy' },
  ): Promise<PlansOutcome> => {
    const at = now();
    const kept: PlansRecord = {
      v: 1,
      ...(record?.fetchedAt !== undefined ? { fetchedAt: record.fetchedAt } : {}),
      ...(record?.body !== undefined ? { body: record.body } : {}),
      failure: { at, why },
      attempts: {
        last,
        failures: (record?.attempts.failures ?? 0) + 1,
        ...(retry ? { retryAfter: retry.at, retryCause: retry.cause } : {}),
      },
    };
    await area.set({ [PLANS_KEY]: kept });
    return { ok: false, error: why, ...(retry ? { retryAt: retry.at } : {}) };
  };

  const fetchOnce = async (to: PlansServer, record: PlansRecord | undefined): Promise<PlansOutcome> => {
    const last = now();
    // Written before the request: a worker stopped meanwhile still counts it.
    const begun: PlansRecord = {
      ...(record ?? { v: 1 }),
      attempts: { ...(record?.attempts ?? { failures: 0 }), last },
    };
    await area.set({ [PLANS_KEY]: begun });
    const answer = await to.get();
    switch (answer.kind) {
      case 'ok': {
        const parsed = parseCatalog(answer.body, rules);
        if (!parsed.ok) {
          debug.warn('plans answer not kept', parsed.why);
          return failed(record, last, parsed.why === 'unsupported' ? 'unsupported' : 'bad-answer');
        }
        if (parsed.dropped.length > 0)
          debug.warn('plans skipped', parsed.dropped.map(({ index, why }) => `${index}:${why}`).join(' '));
        const accepted: PlansRecord = { v: 1, fetchedAt: now(), body: answer.body, attempts: { last, failures: 0 } };
        await area.set({ [PLANS_KEY]: accepted });
        return OK;
      }
      case 'rate-limited':
        return failed(record, last, 'rate-limited', { at: answer.retryAt, cause: 'rate-limited' });
      case 'busy':
        return failed(record, last, 'server-busy', { at: answer.retryAt, cause: 'server-busy' });
      default:
        return failed(record, last, answer.why === 'offline' || answer.why === 'timeout' ? 'offline' : 'server');
    }
  };

  const refresh = async (reason: 'person' | 'opened'): Promise<PlansOutcome> => {
    if (!server) return { ok: false, error: 'unavailable' };
    const record = await readRecord();
    const decision = shouldFetchPlans({ record, reason, hasLicence: await deps.hasLicence() }, now());
    if (decision.fetch) return fetchOnce(server, record);
    switch (decision.why) {
      case 'fresh':
      case 'not-asked':
        return OK;
      case 'retry-after':
        return {
          ok: false,
          error: record?.attempts.retryCause === 'server-busy' ? 'server-busy' : 'rate-limited',
          ...(decision.notBefore !== undefined ? { retryAt: decision.notBefore } : {}),
        };
      default: {
        // Too soon after the last request: the last failure's answer again, with when to ask next.
        const why = record?.failure?.why ?? 'server';
        return { ok: false, error: why, ...(decision.notBefore !== undefined ? { retryAt: decision.notBefore } : {}) };
      }
    }
  };

  return {
    refresh: request => {
      running ??= refresh(request.reason)
        .catch(error => {
          debug.warn('plans', error);
          return { ok: false, error: 'server' } as const;
        })
        .finally(() => (running = undefined));
      return running;
    },
  };
};
