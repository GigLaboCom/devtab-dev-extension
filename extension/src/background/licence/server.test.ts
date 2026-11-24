/**
 * The licence server's addresses over a fake fetch (Response objects, no network): the exact request, each code of the
 * contract, the answers that are not the server's (a portal's HTML, a redirect, a timeout, a body too large), and
 * Retry-After in both forms.
 */
import { httpLicenceServer, MAX_ANSWER_BYTES } from './server';
import { describe, expect, it, vi } from 'vitest';

const ORIGIN = 'https://licence.example.invalid';
const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
const INST = 'q3V2mZ0bTEST0000000000';
const SECRET = 's'.repeat(43);
const KEY = 'DTD-TEST-AAAA-BBBB-CCCC-DDDD';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const error = (status: number, code: string, headers: Record<string, string> = {}) =>
  json(status, { error: code, message: 'For logs and people.' }, headers);

const serverAnswering = (
  answer: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  timeoutMs?: number,
) => {
  const fetchImpl = vi.fn(answer);
  return { server: httpLicenceServer(ORIGIN, fetchImpl as unknown as typeof fetch, () => NOW, timeoutMs), fetchImpl };
};

describe('httpLicenceServer: the request', () => {
  it('activate, refresh, deactivate: POST to their path, JSON of exactly the named fields, no cookie, no cache, no referrer, no redirect', async () => {
    const { server, fetchImpl } = serverAnswering(() => Promise.resolve(json(200, { token: 'a.b.c', secret: SECRET })));
    await server.activate({ key: KEY, inst: INST });
    await server.refresh({ lid: 'lic_TEST0000000001', inst: INST, secret: SECRET });
    await server.deactivate({ lid: 'lic_TEST0000000001', inst: INST, secret: SECRET });
    const calls = fetchImpl.mock.calls.map(([url, init]) => ({
      url,
      ...init,
      signal: init?.signal instanceof AbortSignal,
    }));
    const common = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      mode: 'cors',
      signal: true,
    };
    expect(calls).toEqual([
      { url: `${ORIGIN}/v1/activate`, ...common, body: JSON.stringify({ key: KEY, inst: INST }) },
      {
        url: `${ORIGIN}/v1/refresh`,
        ...common,
        body: JSON.stringify({ lid: 'lic_TEST0000000001', inst: INST, secret: SECRET }),
      },
      {
        url: `${ORIGIN}/v1/deactivate`,
        ...common,
        body: JSON.stringify({ lid: 'lic_TEST0000000001', inst: INST, secret: SECRET }),
      },
    ]);
  });
});

describe('httpLicenceServer: activate', () => {
  it('200 with a token and a secret is ok', async () => {
    const { server } = serverAnswering(() => Promise.resolve(json(200, { token: 'a.b.c', secret: SECRET })));
    expect(await server.activate({ key: KEY, inst: INST })).toEqual({
      kind: 'ok',
      body: { token: 'a.b.c', secret: SECRET },
    });
  });

  it.each([
    ['no secret', { token: 'a.b.c' }],
    ['a secret too short', { token: 'a.b.c', secret: 's'.repeat(31) }],
    ['a secret not base64url', { token: 'a.b.c', secret: `${'s'.repeat(40)}+/=` }],
    ['no token', { secret: SECRET }],
    ['an array', [{ token: 'a.b.c', secret: SECRET }]],
  ])('200 with %s is not the server’s answer (unexpected)', async (_what, body) => {
    const { server } = serverAnswering(() => Promise.resolve(json(200, body)));
    expect(await server.activate({ key: KEY, inst: INST })).toEqual({ kind: 'unreached', why: 'unexpected' });
  });

  it.each([
    [403, 'key-blocked'],
    [403, 'licence-inactive'],
    [404, 'key-unknown'],
    [409, 'seat-limit'],
  ] as const)('%i %s is a refusal with that code', async (status, code) => {
    const { server } = serverAnswering(() => Promise.resolve(error(status, code)));
    expect(await server.activate({ key: KEY, inst: INST })).toEqual({ kind: 'refused', error: code });
  });

  it.each([
    ['400 bad-request (not a refusal)', () => error(400, 'bad-request')],
    ['413 payload-too-large', () => error(413, 'payload-too-large')],
    ['404 not-found (a path the server does not know)', () => error(404, 'not-found')],
    ['409 with the code of another status', () => error(409, 'key-blocked')],
    ['403 without a body', () => new Response(null, { status: 403 })],
    ['405 method-not-allowed', () => error(405, 'method-not-allowed', { Allow: 'POST' })],
    ['500', () => error(500, 'internal')],
    ['503 without Retry-After', () => error(503, 'unavailable')],
    [
      'a 302 that still came back',
      () => new Response(null, { status: 302, headers: { Location: 'https://portal.example.invalid/' } }),
    ],
  ])('%s is not reached: server', async (_what, answer) => {
    const { server } = serverAnswering(() => Promise.resolve(answer()));
    expect(await server.activate({ key: KEY, inst: INST })).toEqual({ kind: 'unreached', why: 'server' });
  });

  it('429 waits until its Retry-After — seconds, or an HTTP date — and 60 s without a readable one', async () => {
    const seconds = serverAnswering(() => Promise.resolve(error(429, 'rate-limited', { 'Retry-After': '120' }))).server;
    expect(await seconds.activate({ key: KEY, inst: INST })).toEqual({ kind: 'rate-limited', retryAt: NOW + 120_000 });
    const date = new Date(NOW + 300_000).toUTCString();
    const dated = serverAnswering(() => Promise.resolve(error(429, 'rate-limited', { 'Retry-After': date }))).server;
    expect(await dated.activate({ key: KEY, inst: INST })).toEqual({ kind: 'rate-limited', retryAt: NOW + 300_000 });
    const none = serverAnswering(() => Promise.resolve(error(429, 'rate-limited'))).server;
    expect(await none.activate({ key: KEY, inst: INST })).toEqual({ kind: 'rate-limited', retryAt: NOW + 60_000 });
    const nonsense = serverAnswering(() =>
      Promise.resolve(error(429, 'rate-limited', { 'Retry-After': 'soon-ish!' })),
    ).server;
    expect(await nonsense.activate({ key: KEY, inst: INST })).toEqual({ kind: 'rate-limited', retryAt: NOW + 60_000 });
  });

  it('503 with Retry-After is busy until then, kept within 60 s … 24 h', async () => {
    const busy = serverAnswering(() => Promise.resolve(error(503, 'unavailable', { 'Retry-After': '600' }))).server;
    expect(await busy.activate({ key: KEY, inst: INST })).toEqual({ kind: 'busy', retryAt: NOW + 600_000 });
    const long = serverAnswering(() => Promise.resolve(error(503, 'unavailable', { 'Retry-After': '999999' }))).server;
    expect(await long.activate({ key: KEY, inst: INST })).toEqual({ kind: 'busy', retryAt: NOW + 86_400_000 });
  });
});

describe('httpLicenceServer: what is not the server', () => {
  it('a captive portal’s HTML with 200 is not JSON', async () => {
    const { server } = serverAnswering(() =>
      Promise.resolve(
        new Response('<!doctype html><title>Sign in to the Wi-Fi</title>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
      ),
    );
    expect(await server.refresh({ lid: 'lic_TEST0000000001', inst: INST, secret: SECRET })).toEqual({
      kind: 'unreached',
      why: 'not-json',
    });
  });

  it('a network error — and a redirect, which `redirect: error` makes one — is offline', async () => {
    const { server } = serverAnswering(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await server.activate({ key: KEY, inst: INST })).toEqual({ kind: 'unreached', why: 'offline' });
  });

  it('no answer within the timeout is a timeout (the request is aborted)', async () => {
    let aborted = false;
    const { server } = serverAnswering(
      (_input, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => {
            aborted = true;
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          }),
        ),
      20,
    );
    expect(await server.refresh({ lid: 'lic_TEST0000000001', inst: INST, secret: SECRET })).toEqual({
      kind: 'unreached',
      why: 'timeout',
    });
    expect(aborted).toBe(true);
  });

  it('a body over 16 KB is not read: too large — declared, or streamed without a length', async () => {
    const big = JSON.stringify({ token: 'x'.repeat(MAX_ANSWER_BYTES) });
    const declared = serverAnswering(() =>
      Promise.resolve(new Response(big, { status: 200, headers: { 'Content-Length': String(big.length) } })),
    ).server;
    expect(await declared.refresh({ lid: 'lic_TEST0000000001', inst: INST, secret: SECRET })).toEqual({
      kind: 'unreached',
      why: 'too-large',
    });
    const streamed = serverAnswering(() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              for (let i = 0; i < 20; i++) controller.enqueue(new TextEncoder().encode('x'.repeat(1024)));
              controller.close();
            },
          }),
          { status: 200 },
        ),
      ),
    ).server;
    expect(await streamed.refresh({ lid: 'lic_TEST0000000001', inst: INST, secret: SECRET })).toEqual({
      kind: 'unreached',
      why: 'too-large',
    });
  });

  it('a refresh never reports a refusal: its 403 is not reached', async () => {
    const { server } = serverAnswering(() => Promise.resolve(error(403, 'key-blocked')));
    expect(await server.refresh({ lid: 'lic_TEST0000000001', inst: INST, secret: SECRET })).toEqual({
      kind: 'unreached',
      why: 'server',
    });
  });
});

describe('httpLicenceServer: deactivate', () => {
  it.each([204, 200, 202])('%i is ok, whatever the body; the body is never read', async status => {
    const text = vi.fn();
    const response = new Response(status === 204 ? null : 'not even JSON', { status });
    Object.defineProperty(response, 'text', { value: text });
    const { server } = serverAnswering(() => Promise.resolve(response));
    expect(await server.deactivate({ lid: 'lic_TEST0000000001', inst: INST, secret: SECRET })).toEqual({
      kind: 'ok',
      body: undefined,
    });
    expect(text).not.toHaveBeenCalled();
  });

  it('offline, 400 and 503 are what they are (the worker erases its records whatever comes)', async () => {
    expect(
      await serverAnswering(() => Promise.reject(new TypeError('offline'))).server.deactivate({
        lid: 'lic_TEST0000000001',
        inst: INST,
        secret: SECRET,
      }),
    ).toEqual({ kind: 'unreached', why: 'offline' });
    expect(
      await serverAnswering(() => Promise.resolve(error(400, 'bad-request'))).server.deactivate({
        lid: 'lic_TEST0000000001',
        inst: INST,
        secret: SECRET,
      }),
    ).toEqual({ kind: 'unreached', why: 'server' });
    expect(
      await serverAnswering(() =>
        Promise.resolve(error(503, 'unavailable', { 'Retry-After': '120' })),
      ).server.deactivate({ lid: 'lic_TEST0000000001', inst: INST, secret: SECRET }),
    ).toEqual({ kind: 'busy', retryAt: NOW + 120_000 });
  });
});
