/**
 * `GET /v1/plans` over a fake fetch (no network): the exact request, each code of the plans address, a portal's HTML,
 * a redirect, a timeout, a body over 32 KB, Retry-After in both forms.
 */
import { httpPlansServer, MAX_PLANS_BYTES } from './fetchPlans';
import { describe, expect, it, vi } from 'vitest';

const ORIGIN = 'https://licence.example.invalid';
const NOW = Date.UTC(2026, 10, 24, 12);

const serverAnswering = (
  answer: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  timeoutMs?: number,
) => {
  const fetchImpl = vi.fn(answer);
  return { plans: httpPlansServer(ORIGIN, fetchImpl as unknown as typeof fetch, () => NOW, timeoutMs), fetchImpl };
};
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

describe('httpPlansServer', () => {
  it('GET with one Accept header, no body, no cookie, no cache, no referrer, no redirect', async () => {
    const { plans, fetchImpl } = serverAnswering(() => Promise.resolve(json(200, { v: 1 })));
    expect(await plans.get()).toEqual({ kind: 'ok', body: { v: 1 } });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${ORIGIN}/v1/plans`);
    expect({ ...init, signal: init?.signal instanceof AbortSignal }).toEqual({
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      mode: 'cors',
      signal: true,
    });
  });

  it.each([
    [
      '429 with seconds',
      () => json(429, { error: 'rate-limited' }, { 'Retry-After': '120' }),
      { kind: 'rate-limited', retryAt: NOW + 120_000 },
    ],
    [
      '429 with a date',
      () => json(429, { error: 'rate-limited' }, { 'Retry-After': new Date(NOW + 600_000).toUTCString() }),
      { kind: 'rate-limited', retryAt: NOW + 600_000 },
    ],
    [
      '429 without Retry-After',
      () => json(429, { error: 'rate-limited' }),
      { kind: 'rate-limited', retryAt: NOW + 60_000 },
    ],
    [
      '503 with Retry-After',
      () => json(503, { error: 'unavailable' }, { 'Retry-After': '300' }),
      { kind: 'busy', retryAt: NOW + 300_000 },
    ],
    ['503 without', () => json(503, { error: 'unavailable' }), { kind: 'unreached', why: 'server' }],
    ['304', () => new Response(null, { status: 304 }), { kind: 'unreached', why: 'server' }],
    ['500', () => json(500, { error: 'internal' }), { kind: 'unreached', why: 'server' }],
    ['404', () => json(404, { error: 'not-found' }), { kind: 'unreached', why: 'server' }],
    ['a portal’s HTML', () => new Response('<!doctype html>', { status: 200 }), { kind: 'unreached', why: 'not-json' }],
  ])('%s', async (_what, answer, expected) => {
    expect(await serverAnswering(() => Promise.resolve(answer())).plans.get()).toEqual(expected);
  });

  it('a network error or a redirect is offline; no answer within the timeout is a timeout', async () => {
    expect(await serverAnswering(() => Promise.reject(new TypeError('Failed to fetch'))).plans.get()).toEqual({
      kind: 'unreached',
      why: 'offline',
    });
    const slow = serverAnswering(
      (_input, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
        ),
      20,
    );
    expect(await slow.plans.get()).toEqual({ kind: 'unreached', why: 'timeout' });
  });

  it('a body over 32 KB is not read; one of 32 KB is', async () => {
    const at = (size: number) => JSON.stringify({ pad: 'x'.repeat(size - 10) });
    expect(at(MAX_PLANS_BYTES).length).toBe(MAX_PLANS_BYTES);
    expect(
      (await serverAnswering(() => Promise.resolve(new Response(at(MAX_PLANS_BYTES), { status: 200 }))).plans.get())
        .kind,
    ).toBe('ok');
    expect(
      await serverAnswering(() => Promise.resolve(new Response(at(MAX_PLANS_BYTES + 1), { status: 200 }))).plans.get(),
    ).toEqual({ kind: 'unreached', why: 'too-large' });
  });
});
