/**
 * DEVTAB_LICENCE_TEST — the fake licence server of the e2e build (`licence:test`, src/licence/test.ts), never of a
 * store build: a `fetch` that reads a script from chrome.storage.local (`licenceFakeServer`) and answers from it. The
 * browser's fetch is never called, so no request leaves the browser; the test, in Node, signs the tokens of the replies
 * with the test key and puts the script there before it opens the pages. Every request is appended to `calls`.
 */

/** The record the e2e writes and reads back. */
export const FAKE_SERVER_KEY = 'licenceFakeServer';

/** The build check refuses a store build carrying this mark (it stays in the built code: it names the fake's failures). */
const MARK = 'DEVTAB_LICENCE_TEST';

export type FakeEndpoint = 'activate' | 'refresh' | 'deactivate' | 'plans';

export interface FakeServerScript {
  /** Taken one by one; an empty list answers as if offline. */
  replies: Array<
    | { endpoint: FakeEndpoint; status: number; headers?: Record<string, string>; body: string }
    | { endpoint: FakeEndpoint; offline: true }
  >;
  /** Appended by the fake: what the extension sent (method, path, the body as parsed JSON, `null` for GET) and when. */
  calls: Array<{ endpoint: string; method: string; path: string; body: unknown; at: number }>;
}

const ENDPOINTS: Readonly<Record<string, FakeEndpoint>> = {
  '/v1/activate': 'activate',
  '/v1/refresh': 'refresh',
  '/v1/deactivate': 'deactivate',
  '/v1/plans': 'plans',
};

/** Statuses whose answer has no body (a Response refuses one). */
const NO_BODY = new Set([204, 205, 304]);

const scriptOf = (raw: unknown): FakeServerScript => {
  const value = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<FakeServerScript>;
  return {
    replies: Array.isArray(value.replies) ? [...value.replies] : [],
    calls: Array.isArray(value.calls) ? [...value.calls] : [],
  };
};

const offline = () => Promise.reject(new TypeError(`${MARK}: the scripted licence server answers as if offline`));

/** A fetch over the script in `local`; requests are taken one at a time, so none of them loses its reply or its call. */
export const scriptedFetch = (
  local: Pick<chrome.storage.LocalStorageArea, 'get' | 'set'>,
  now: () => number = Date.now,
): typeof fetch => {
  let queue: Promise<unknown> = Promise.resolve();
  const answer = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (init?.signal?.aborted) throw new DOMException('The request was aborted.', 'AbortError');
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const requested = ENDPOINTS[url.pathname] ?? 'unknown';
    let body: unknown = null;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const script = scriptOf(((await local.get(FAKE_SERVER_KEY)) as Record<string, unknown>)[FAKE_SERVER_KEY]);
    const reply = script.replies.shift();
    const mismatch = reply !== undefined && reply.endpoint !== requested;
    script.calls.push({ endpoint: mismatch ? 'mismatch' : requested, method, path: url.pathname, body, at: now() });
    await local.set({ [FAKE_SERVER_KEY]: script });
    if (!reply || mismatch || 'offline' in reply) return offline();
    return new Response(NO_BODY.has(reply.status) ? null : reply.body, {
      status: reply.status,
      headers: { 'Content-Type': 'application/json', ...reply.headers },
    });
  };
  return (input, init) => {
    const next = queue.then(() => answer(input, init));
    queue = next.catch(() => undefined);
    return next;
  };
};
