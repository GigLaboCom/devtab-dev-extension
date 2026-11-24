/** The page's side of the licence messages: what each control sends, and every way of not answering is `worker`. */
import { licenceClient } from './licenceClient';
import { describe, expect, it, vi } from 'vitest';

const runtimeAnswering = (answer: () => Promise<unknown>) => ({
  sendMessage: vi.fn<(message: unknown) => Promise<unknown>>(() => answer()),
});

describe('licenceClient', () => {
  it('sends one message per control and passes the worker’s answer on', async () => {
    const runtime = runtimeAnswering(() => Promise.resolve({ v: 1, ok: true }));
    const controls = licenceClient(runtime as never, 'licence.example.invalid');
    expect(controls.host).toBe('licence.example.invalid');
    expect(await controls.activate('DTD-TEST-AAAA-BBBB-CCCC-DDDD')).toEqual({ ok: true });
    expect(await controls.check()).toEqual({ ok: true });
    expect(await controls.deactivate()).toEqual({ ok: true });
    expect(await controls.remove()).toEqual({ ok: true });
    expect(runtime.sendMessage.mock.calls.map(([m]) => m)).toEqual([
      { type: 'licence/activate', v: 1, key: 'DTD-TEST-AAAA-BBBB-CCCC-DDDD' },
      { type: 'licence/check', v: 1 },
      { type: 'licence/deactivate', v: 1 },
      { type: 'licence/remove', v: 1 },
    ]);
  });

  it('a refusal comes with its error and, when the worker names one, its time', async () => {
    const runtime = runtimeAnswering(() => Promise.resolve({ v: 1, ok: false, error: 'rate-limited', retryAt: 5 }));
    expect(await licenceClient(runtime as never, undefined).check()).toEqual({
      ok: false,
      error: 'rate-limited',
      retryAt: 5,
    });
  });

  it.each([
    ['rejects (no worker, stopped, updating)', () => Promise.reject(new Error('Could not establish connection'))],
    ['answers nothing', () => Promise.resolve(undefined)],
    ['answers another version', () => Promise.resolve({ v: 2, ok: true })],
    ['answers an unknown error', () => Promise.resolve({ v: 1, ok: false, error: 'teapot' })],
    ['answers without ok', () => Promise.resolve({ v: 1 })],
    ['answers a string', () => Promise.resolve('ok')],
  ])('a worker that %s is `worker`', async (_what, answer) => {
    const controls = licenceClient(runtimeAnswering(answer) as never, undefined);
    expect(await controls.activate('DTD-TEST-AAAA-BBBB-CCCC-DDDD')).toEqual({ ok: false, error: 'worker' });
    expect(await controls.check()).toEqual({ ok: false, error: 'worker' });
  });

  it('a sendMessage that throws at once is `worker` too, never a rejection', async () => {
    const runtime = {
      sendMessage: () => {
        throw new Error('no runtime');
      },
    };
    await expect(licenceClient(runtime as never, undefined).remove()).resolves.toEqual({ ok: false, error: 'worker' });
  });
});
