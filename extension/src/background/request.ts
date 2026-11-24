/**
 * The service worker's one way of asking the licence server (src/background/licence/server.ts, the licence; and
 * src/background/plans/fetchPlans.ts, the plans list): a fetch with the options the contract names — no cookies, no
 * cache, no referrer, no redirect, CORS — a timeout over the whole exchange, and a body read up to a limit, beyond which
 * the answer is not read further. It never rejects: a network error, the timeout, a redirect, a body too large come
 * back as `unreached`.
 */
import { retryAfterAt } from '@extension/licence';

/** The worker never waits longer for one answer (Chrome stops a worker whose fetch takes more than 30 s). */
export const REQUEST_TIMEOUT_MS = 10_000;
/** Without a readable Retry-After, a 429 waits this long. */
const DEFAULT_RETRY_MS = 60_000;

export type Unreached = 'offline' | 'timeout' | 'server' | 'not-json' | 'too-large' | 'unexpected';

/** What came back: a status with its body (read, up to the limit, as text), or why nothing usable did. */
export type Exchange =
  | { readonly kind: 'answer'; readonly status: number; readonly headers: Headers; readonly text: string }
  | { readonly kind: 'unreached'; readonly why: Unreached };

/** Reads at most `limit` bytes; `undefined` when the body is longer (the rest is never read). */
const readUpTo = async (response: Response, limit: number): Promise<string | undefined> => {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel().catch(() => undefined);
    return undefined;
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
};

/**
 * One request to `url` with the contract's options; the body is read only when `readBody` says so for the status (a
 * deactivation's answer is never read). `body` is sent as JSON with its Content-Type.
 */
export const exchange = async (
  fetchImpl: typeof fetch,
  url: string,
  options: {
    readonly method: 'GET' | 'POST';
    readonly body?: Record<string, string>;
    readonly limit: number;
    readonly timeoutMs: number;
    readonly readBody?: (status: number) => boolean;
  },
): Promise<Exchange> => {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: options.method,
      headers: options.body ? { 'Content-Type': 'application/json' } : { Accept: 'application/json' },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      mode: 'cors',
      signal: controller.signal,
    });
    // `redirect: 'error'` makes a redirect a network error; an answer that still says it was redirected is not ours.
    if (response.redirected || response.type === 'opaqueredirect') return { kind: 'unreached', why: 'server' };
    if (options.readBody && !options.readBody(response.status)) {
      await response.body?.cancel().catch(() => undefined);
      return { kind: 'answer', status: response.status, headers: response.headers, text: '' };
    }
    const text = await readUpTo(response, options.limit);
    if (text === undefined) return { kind: 'unreached', why: 'too-large' };
    return { kind: 'answer', status: response.status, headers: response.headers, text };
  } catch {
    return { kind: 'unreached', why: timedOut ? 'timeout' : 'offline' };
  } finally {
    clearTimeout(timer);
  }
};

/** JSON of a body, or `undefined` when it is not JSON (a captive portal's HTML, nothing). */
export const jsonOf = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

/** The error code of an error body (`{ "error": "<code>", "message": … }`); the message is never read. */
export const errorCode = (text: string): string | undefined => {
  const body = jsonOf(text);
  return typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
    ? (body as { error: string }).error
    : undefined;
};

/**
 * 429 and 503 as the contract reads them: 429 — `rate-limited` until Retry-After (60 s when unreadable); 503 with a
 * readable Retry-After — `busy` until then; 503 without — not reached (`server`, the usual pause after a failure).
 * `undefined` for any other status.
 */
export const retryOf = (
  status: number,
  headers: Headers,
  now: number,
):
  | { readonly kind: 'rate-limited'; readonly retryAt: number }
  | { readonly kind: 'busy'; readonly retryAt: number }
  | { readonly kind: 'unreached'; readonly why: 'server' }
  | undefined => {
  if (status === 429)
    return { kind: 'rate-limited', retryAt: retryAfterAt(headers.get('retry-after'), now) ?? now + DEFAULT_RETRY_MS };
  if (status === 503) {
    const at = retryAfterAt(headers.get('retry-after'), now);
    return at === undefined ? { kind: 'unreached', why: 'server' } : { kind: 'busy', retryAt: at };
  }
  return undefined;
};
