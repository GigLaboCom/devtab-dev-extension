/**
 * When the worker asks the licence server again (pro-entitlement §6.4.4). There is no alarm: the occasions are the
 * profile's start, the extension's install or update, one of our pages opening, and the `Check now` button. The rules
 * are tried in order and the first that fits decides.
 */
import type { EditionState } from './state';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The button is refused when the last request began less than this long ago. */
export const BUTTON_GAP_MS = MINUTE;
/** An `ended` licence is checked on its own for this long after `paid` (or `iat`); then only by the button. */
export const ENDED_CHECKS_MS = 30 * DAY;
/** The longest pause after failures outside the urgent states. */
export const MAX_BACKOFF_MS = 12 * HOUR;
/** Retry-After is kept within these bounds; a 429 without a readable one waits the shortest. */
export const RETRY_AFTER_MIN_MS = MINUTE;
export const RETRY_AFTER_MAX_MS = DAY;

export interface Attempts {
  /** When the last request to the server began (ms). */
  readonly last?: number;
  /** Requests in a row that ended without an accepted token. */
  readonly failures: number;
  /** Not before this instant (the server's Retry-After), ms. */
  readonly retryAfter?: number;
  /** Which answer set `retryAfter`: 429 or 503 with Retry-After — it picks the text of a refused button. */
  readonly retryCause?: 'rate-limited' | 'server-busy';
}

export type Trigger = 'startup' | 'installed' | 'opened' | 'button';

export type CheckDecision =
  | { readonly check: true }
  | {
      readonly check: false;
      readonly why: 'no-secret' | 'not-due' | 'backoff' | 'retry-after' | 'manual-only';
      readonly notBefore?: number;
    };

/** The pause after `failures` failed requests: 1 h while urgent; otherwise 1 h · 2^(failures − 1), at most 12 h; 0 without failures. */
export const backoffMs = (failures: number, urgent: boolean): number => {
  if (!(failures > 0)) return 0;
  if (urgent) return HOUR;
  return Math.min(HOUR * 2 ** (Math.floor(failures) - 1), MAX_BACKOFF_MS);
};

/** Retry-After (seconds or an HTTP date) as an instant, kept within 60 s … 24 h from `now`; `undefined` if unreadable (a 429 then waits 60 s). */
export const retryAfterAt = (header: string | null, now: number): number | undefined => {
  if (header === null) return undefined;
  const text = header.trim();
  let at: number;
  if (/^\d+$/.test(text)) at = now + Number(text) * 1000;
  else if (/[A-Za-z]/.test(text)) at = Date.parse(text);
  else return undefined;
  if (!Number.isFinite(at)) return undefined;
  return Math.min(Math.max(at, now + RETRY_AFTER_MIN_MS), now + RETRY_AFTER_MAX_MS);
};

const CHECK: CheckDecision = { check: true };

/** Should the worker ask the server now? */
export const shouldCheck = (
  input: {
    readonly hasSecret: boolean;
    readonly state: EditionState;
    readonly attempts: Attempts;
    readonly trigger: Trigger;
  },
  now: number,
  seen: number,
): CheckDecision => {
  const { hasSecret, state, attempts, trigger } = input;
  if (!hasSecret) return { check: false, why: 'no-secret' };
  if (attempts.retryAfter !== undefined && attempts.retryAfter > now)
    return { check: false, why: 'retry-after', notBefore: attempts.retryAfter };
  const last = attempts.last;
  if (trigger === 'button') {
    if (last !== undefined && now - last < BUTTON_GAP_MS)
      return { check: false, why: 'backoff', notBefore: last + BUTTON_GAP_MS };
    return CHECK;
  }
  const afterPause = (urgent: boolean): CheckDecision => {
    const pause = backoffMs(attempts.failures, urgent);
    if (last !== undefined && now - last < pause) return { check: false, why: 'backoff', notBefore: last + pause };
    return CHECK;
  };
  const mark = typeof seen === 'number' && Number.isFinite(seen) && seen >= 0 ? seen : 0;
  switch (state.kind) {
    case 'revoked':
      return { check: false, why: 'manual-only' };
    case 'ended': {
      const { licence } = state;
      const t = Math.max(now, mark, licence.checkedAt);
      if (t >= (licence.paidUntil ?? licence.checkedAt) + ENDED_CHECKS_MS) return { check: false, why: 'manual-only' };
      if (t < licence.checkAfter) return { check: false, why: 'not-due', notBefore: licence.checkAfter };
      return afterPause(false);
    }
    case 'active': {
      const { licence } = state;
      const t = Math.max(now, mark, licence.checkedAt);
      if (t < licence.checkAfter) return { check: false, why: 'not-due', notBefore: licence.checkAfter };
      return afterPause(false);
    }
    case 'grace':
    case 'expired':
    case 'invalid':
      return afterPause(true);
    default:
      // `free` with a secret (no token record next to it) is not a state the worker writes: no request on its own.
      return { check: false, why: 'manual-only' };
  }
};
