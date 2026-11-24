/**
 * `GET /v1/plans` as the service worker sends it (pro-plans-and-payment §4.3): no body, no query, no cookie, one
 * `Accept` header — a simple CORS request — on the licence server's origin. The body is read up to 32 KB; a 304 is
 * an error of the path (the worker never sends If-None-Match). Never rejects; the catalog itself is checked by the
 * worker (`parseCatalog`, ./worker.ts).
 */
import { REQUEST_TIMEOUT_MS, exchange, jsonOf, retryOf } from '../request';
import type { Unreached } from '../request';

/** The largest plans list the worker reads; a longer one is "not reached". */
export const MAX_PLANS_BYTES = 32 * 1024;

export interface PlansServer {
  /** GET /v1/plans; never rejects. */
  get(): Promise<
    | { readonly kind: 'ok'; readonly body: unknown }
    | { readonly kind: 'rate-limited'; readonly retryAt: number }
    /** 503 with a readable Retry-After; a 503 without it is `unreached: 'server'`. */
    | { readonly kind: 'busy'; readonly retryAt: number }
    | { readonly kind: 'unreached'; readonly why: Unreached }
  >;
}

export const httpPlansServer = (
  origin: string,
  fetchImpl: typeof fetch,
  now: () => number,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): PlansServer => ({
  get: async () => {
    const answer = await exchange(fetchImpl, `${origin}/v1/plans`, {
      method: 'GET',
      limit: MAX_PLANS_BYTES,
      timeoutMs,
    });
    if (answer.kind === 'unreached') return answer;
    if (answer.status === 200) {
      const body = jsonOf(answer.text);
      return body === undefined ? { kind: 'unreached', why: 'not-json' } : { kind: 'ok', body };
    }
    return retryOf(answer.status, answer.headers, now()) ?? { kind: 'unreached', why: 'server' };
  },
});
