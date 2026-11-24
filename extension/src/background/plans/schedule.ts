/**
 * When the service worker asks the server for the plans list (pro-plans-and-payment §4.5). Never on its own: only
 * when a page asks — the person pressed `See plans` or `Try again` (`person`), or Settings opened in a profile with a
 * licence (`opened`). A free installation never asks on `opened`, and the worker refuses it even if a page did: the
 * promise "no request without the person's press" is the worker's too. Pure.
 */
import { MAX_AGE_MAX_S, MAX_AGE_MIN_S } from '@src/plans/model';
import { freshness } from '@src/shared/plansRecord';
import type { PlansRecord } from '@src/shared/plansRecord';

const MINUTE = 60_000;
/** A press is answered from the server at most this often. */
export const PLANS_BUTTON_GAP_MS = MINUTE;
/** After failures on `opened`: 5 min, doubled each time, at most 6 h. */
export const PLANS_BACKOFF_MIN_MS = 5 * MINUTE;
export const PLANS_BACKOFF_MAX_MS = 6 * 60 * MINUTE;

export type PlansDecision =
  | { readonly fetch: true }
  | {
      readonly fetch: false;
      readonly why: 'fresh' | 'retry-after' | 'button-limit' | 'backoff' | 'not-asked';
      readonly notBefore?: number;
    };

/** The pause after `failures` failed requests on `opened`; 0 without failures. */
export const plansBackoffMs = (failures: number): number =>
  failures > 0 ? Math.min(PLANS_BACKOFF_MIN_MS * 2 ** (Math.floor(failures) - 1), PLANS_BACKOFF_MAX_MS) : 0;

/** Whether the record holds a list that is fresh at `now` (its `maxAge` kept within 1 h … 7 days). */
const isFresh = (record: PlansRecord | undefined, now: number): boolean => {
  if (record?.fetchedAt === undefined || typeof record.body !== 'object' || record.body === null) return false;
  const maxAge = (record.body as { maxAge?: unknown }).maxAge;
  if (typeof maxAge !== 'number' || !Number.isFinite(maxAge)) return false;
  const maxAgeMs = Math.min(Math.max(maxAge, MAX_AGE_MIN_S), MAX_AGE_MAX_S) * 1000;
  return freshness(record.fetchedAt, maxAgeMs, now) === 'fresh';
};

export const shouldFetchPlans = (
  input: {
    readonly record: PlansRecord | undefined;
    readonly reason: 'person' | 'opened';
    readonly hasLicence: boolean;
  },
  now: number,
): PlansDecision => {
  const { record, reason, hasLicence } = input;
  if (reason === 'opened' && !hasLicence) return { fetch: false, why: 'not-asked' };
  const attempts = record?.attempts;
  if (attempts?.retryAfter !== undefined && attempts.retryAfter > now)
    return { fetch: false, why: 'retry-after', notBefore: attempts.retryAfter };
  if (isFresh(record, now)) return { fetch: false, why: 'fresh' };
  const last = attempts?.last;
  if (reason === 'person') {
    if (last !== undefined && now - last < PLANS_BUTTON_GAP_MS)
      return { fetch: false, why: 'button-limit', notBefore: last + PLANS_BUTTON_GAP_MS };
    return { fetch: true };
  }
  const pause = plansBackoffMs(attempts?.failures ?? 0);
  if (last !== undefined && now - last < pause) return { fetch: false, why: 'backoff', notBefore: last + pause };
  return { fetch: true };
};
