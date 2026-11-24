/**
 * "A page opened": one message when the profile has a licence record, none without; every failure swallowed (an
 * unhandled rejection would fail the run).
 */
import { sayOpened } from './opened';
import { fakeStorage } from '@src/test/fakes';
import { describe, expect, it, vi } from 'vitest';

/** The storage's `get`, with the promise it answered — to wait for exactly that read and what follows it. */
const watchedGet = (area: Pick<chrome.storage.LocalStorageArea, 'get'>) => {
  const answered: Promise<unknown>[] = [];
  const get = (keys: string) => {
    const answer = area.get(keys);
    answered.push(answer);
    return answer;
  };
  /** After the read and the message that may follow it. */
  const settled = async () => {
    await Promise.allSettled(answered);
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  return { local: { get } as unknown as Pick<chrome.storage.LocalStorageArea, 'get'>, answered, settled };
};

describe('sayOpened', () => {
  it('without a licence record no message is sent at all', async () => {
    const storage = watchedGet(fakeStorage().area);
    const sendMessage = vi.fn(() => Promise.resolve({ v: 1, ok: true }));
    sayOpened({ storage: { local: storage.local }, runtime: { sendMessage } as never });
    await storage.settled();
    expect(storage.answered).toHaveLength(1);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('with one, the worker is told once', async () => {
    const rows = fakeStorage();
    rows.rows.set('entitlement', { v: 1, inst: 'q3V2mZ0bTEST0000000000', token: 'a.b.c', seen: 0 });
    const storage = watchedGet(rows.area);
    const sendMessage = vi.fn(() => Promise.resolve({ v: 1, ok: true }));
    sayOpened({ storage: { local: storage.local }, runtime: { sendMessage } as never });
    await storage.settled();
    expect(sendMessage.mock.calls).toEqual([[{ type: 'licence/opened', v: 1 }]]);
  });

  it('a worker that does not answer, a storage that fails or is missing: nothing thrown, nothing rejected', async () => {
    const rows = fakeStorage();
    rows.rows.set('entitlement', { v: 1 });
    const storage = watchedGet(rows.area);
    const refusing = vi.fn(() => Promise.reject(new Error('Could not establish connection')));
    expect(() =>
      sayOpened({ storage: { local: storage.local }, runtime: { sendMessage: refusing } as never }),
    ).not.toThrow();
    const failing = watchedGet({ get: () => Promise.reject(new Error('storage')) } as never);
    expect(() =>
      sayOpened({ storage: { local: failing.local }, runtime: { sendMessage: refusing } as never }),
    ).not.toThrow();
    expect(() => sayOpened({ storage: undefined as never, runtime: undefined as never })).not.toThrow();
    await storage.settled();
    await failing.settled();
    expect(refusing).toHaveBeenCalledTimes(1);
  });
});
