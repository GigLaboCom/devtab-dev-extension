/**
 * Seam `LicenceServer` — the licence server's three addresses as the service worker sees them: `POST /v1/activate`,
 * `/v1/refresh`, `/v1/deactivate` (the endpoint contract of pro-entitlement-implementation §5). `httpLicenceServer`
 * speaks it over a fetch — the browser's, or a test's script (seam LicenceConfig's `transport`). Nothing here is kept:
 * the answers are turned into data, and the worker decides (./worker.ts). Only the token inside an answer is signed;
 * the codes, headers and wrapper never change anything stored on their own.
 */
import { REQUEST_TIMEOUT_MS, errorCode, exchange, jsonOf, retryOf } from '../request';
import type { Unreached } from '../request';

export type { Unreached } from '../request';

/** The refusals of an activation — each has its own text. 400 is not one: it is `unreached: 'server'`. */
export type ActivationRefusal = 'key-unknown' | 'seat-limit' | 'key-blocked' | 'licence-inactive';

export type ServerAnswer<T> =
  | { readonly kind: 'ok'; readonly body: T }
  | { readonly kind: 'refused'; readonly error: ActivationRefusal }
  /** 429; `retryAt` from Retry-After, or 60 s when it is missing or unreadable. */
  | { readonly kind: 'rate-limited'; readonly retryAt: number }
  /** 503 with a readable Retry-After: the server is busy until then. A 503 without it is `unreached: 'server'`. */
  | { readonly kind: 'busy'; readonly retryAt: number }
  | { readonly kind: 'unreached'; readonly why: Unreached };

export interface LicenceServer {
  activate(request: {
    readonly key: string;
    readonly inst: string;
  }): Promise<ServerAnswer<{ readonly token: string; readonly secret: string }>>;
  refresh(request: {
    readonly lid: string;
    readonly inst: string;
    readonly secret: string;
  }): Promise<ServerAnswer<{ readonly token: string }>>;
  /** `ok` for any 2xx; the body is never read. */
  deactivate(request: {
    readonly lid: string;
    readonly inst: string;
    readonly secret: string;
  }): Promise<ServerAnswer<undefined>>;
}

/** The largest answer the worker reads; a longer one is "not reached". */
export const MAX_ANSWER_BYTES = 16 * 1024;

/** Each refusal of an activation comes with exactly one status. */
const REFUSALS: Readonly<Record<ActivationRefusal, number>> = {
  'key-unknown': 404,
  'seat-limit': 409,
  'key-blocked': 403,
  'licence-inactive': 403,
};

const SECRET = /^[A-Za-z0-9_-]{32,128}$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The licence server over `fetchImpl`; never rejects. `refused` comes only from `activate`. */
export const httpLicenceServer = (
  origin: string,
  fetchImpl: typeof fetch,
  now: () => number,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): LicenceServer => {
  /**
   * One POST with exactly `body`; a 200 whose JSON `read` accepts is `ok`, a refusal of an activation `refused`, 429
   * and 503 by their rule, anything else not reached.
   */
  const post = async <T>(
    path: string,
    body: Record<string, string>,
    read: (json: Record<string, unknown>) => T | undefined,
    refusals: boolean,
  ): Promise<ServerAnswer<T>> => {
    const answer = await exchange(fetchImpl, `${origin}${path}`, {
      method: 'POST',
      body,
      limit: MAX_ANSWER_BYTES,
      timeoutMs,
    });
    if (answer.kind === 'unreached') return answer;
    const { status, headers, text } = answer;
    if (status === 200) {
      const json = jsonOf(text);
      if (json === undefined) return { kind: 'unreached', why: 'not-json' };
      const parsed = isObject(json) ? read(json) : undefined;
      return parsed === undefined ? { kind: 'unreached', why: 'unexpected' } : { kind: 'ok', body: parsed };
    }
    const retry = retryOf(status, headers, now());
    if (retry) return retry;
    if (refusals) {
      const error = errorCode(text) as ActivationRefusal | undefined;
      if (error && Object.hasOwn(REFUSALS, error) && REFUSALS[error] === status) return { kind: 'refused', error };
    }
    return { kind: 'unreached', why: 'server' };
  };

  return {
    activate: ({ key, inst }) =>
      post(
        '/v1/activate',
        { key, inst },
        json =>
          typeof json.token === 'string' && typeof json.secret === 'string' && SECRET.test(json.secret)
            ? { token: json.token, secret: json.secret }
            : undefined,
        true,
      ),
    refresh: ({ lid, inst, secret }) =>
      post(
        '/v1/refresh',
        { lid, inst, secret },
        json => (typeof json.token === 'string' ? { token: json.token } : undefined),
        false,
      ),
    deactivate: async ({ lid, inst, secret }) => {
      const answer = await exchange(fetchImpl, `${origin}/v1/deactivate`, {
        method: 'POST',
        body: { lid, inst, secret },
        limit: MAX_ANSWER_BYTES,
        timeoutMs,
        readBody: () => false,
      });
      if (answer.kind === 'unreached') return answer;
      if (answer.status >= 200 && answer.status < 300) return { kind: 'ok', body: undefined };
      return retryOf(answer.status, answer.headers, now()) ?? { kind: 'unreached', why: 'server' };
    },
  };
};
