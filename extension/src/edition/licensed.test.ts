/**
 * `EditionSource` `licensed` over a fake chrome.storage, with a key made for each run: the contract of the seam (both
 * halves — the one with `put` and `advance` runs here), every row of the table of states reached through the stored
 * record, and what the source does besides: the controls of Settings → Pro, a storage that fails, a changed mark that
 * needs no new check of the signature.
 */
import { licensed, licensedSource } from './licensed';
import { editionSourceContract } from './sourceContract';
import { claimsAt, makeTestKey, signToken } from '@extension/licence/testing';
import { fakeStorage } from '@src/test/fakes';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditionSource, SourceState } from './source';
import type { PublicKeyEntry, RevokeReason } from '@extension/licence';
import type { WireClaims } from '@extension/licence/testing';

const DAY = 86_400_000;
const DAY_S = 86_400;
const T0 = Date.UTC(2026, 10, 1);
const INST = 'q3V2mZ0bTEST0000000000';

let key: { readonly publicKey: PublicKeyEntry; readonly privateKey: CryptoKey };
let other: { readonly publicKey: PublicKeyEntry; readonly privateKey: CryptoKey };
beforeAll(async () => {
  key = await makeTestKey();
  other = await makeTestKey();
});

const sign = (claims: WireClaims | Record<string, unknown>, by = key, header?: Record<string, unknown>) =>
  signToken(claims, { kid: by.publicKey.kid, privateKey: by.privateKey }, header);

/** WebCrypto whose calls are counted, so a test can wait until every check of a signature has finished. */
const countedSubtle = () => {
  const pending = new Set<Promise<unknown>>();
  const real = globalThis.crypto.subtle;
  const subtle = new Proxy(real, {
    get(target, name) {
      const value = Reflect.get(target, name) as unknown;
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const answer = (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
        pending.add(answer);
        void answer.finally(() => pending.delete(answer)).catch(() => undefined);
        return answer;
      };
    },
  });
  const nextTask = () => new Promise(resolve => setImmediate(resolve));
  /** Every started check finished and what follows it ran (at most 100 rounds). */
  const settle = async () => {
    for (let round = 0; round < 100; round++) {
      await nextTask();
      if (pending.size === 0) {
        await nextTask();
        if (pending.size === 0) return;
      }
      await Promise.allSettled([...pending]);
    }
    throw new Error('the checks of the signature did not finish');
  };
  return { subtle, settle };
};

/** A record that should give `kind` at `now` (a token issued with the usual spans, or broken for `invalid`). */
const recordFor = async (kind: SourceState['kind'], now: number) => {
  const iatOf = (days: number) => claimsAt(now - days * DAY, { inst: INST });
  switch (kind) {
    case 'free':
      return undefined;
    case 'active':
      return { v: 1, inst: INST, token: await sign(iatOf(0)), seen: 0 };
    case 'grace':
      return { v: 1, inst: INST, token: await sign(iatOf(25)), seen: 0 };
    case 'expired':
      return { v: 1, inst: INST, token: await sign(iatOf(31)), seen: 0 };
    case 'ended': {
      const claims = iatOf(0);
      return {
        v: 1,
        inst: INST,
        token: await sign({ ...claims, status: 'ended', warn: claims.iat, exp: claims.iat }),
        seen: 0,
      };
    }
    case 'revoked': {
      const claims = iatOf(0);
      const fields = {
        ...claims,
        status: 'revoked',
        reason: 'refund',
        chk: claims.iat,
        warn: claims.iat,
        exp: claims.iat,
      };
      return { v: 1, inst: INST, token: await sign(fields), seen: 0 };
    }
    case 'invalid':
      return { v: 1, inst: INST, token: await sign(iatOf(0), other), seen: 0 };
    default:
      throw new Error(`no record gives ${kind}`);
  }
};

const runtime = { sendMessage: vi.fn(() => Promise.resolve({ v: 1, ok: true })) };

describe('with the clock and timers of the test', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  editionSourceContract('licensed', () => {
    const storage = fakeStorage();
    const crypto = countedSubtle();
    return {
      open: () =>
        licensedSource({
          chrome: { storage: { local: storage.area, onChanged: storage.onChanged }, runtime: runtime as never },
          now: () => Date.now(),
          subtle: crypto.subtle,
          keys: [key.publicKey],
          host: 'licence.example.invalid',
        }),
      put: async (kind, at) => {
        await storage.area.set({ entitlement: await recordFor(kind, at?.now ?? Date.now()) });
      },
      advance: ms => vi.advanceTimersByTime(ms),
      settle: crypto.settle,
    };
  });

  it('the time to check is a boundary too: `due` turns on by a timer at chk', async () => {
    const storage = fakeStorage();
    const crypto = countedSubtle();
    await storage.area.set({ entitlement: await recordFor('active', T0) });
    const source = licensedSource({
      chrome: { storage: { local: storage.area, onChanged: storage.onChanged }, runtime: runtime as never },
      subtle: crypto.subtle,
      keys: [key.publicKey],
      host: undefined,
    });
    await source.ready;
    expect(source.current()).toMatchObject({ kind: 'active', due: false });
    vi.advanceTimersByTime(7 * DAY);
    expect(source.current()).toMatchObject({ kind: 'active', due: true });
    source.dispose();
  });
});

/** A source over `entitlement` at the clock `now` of the test. */
const sourceOver = (entitlement: unknown, now: number, extra: { subtle?: SubtleCrypto } = {}) => {
  const storage = fakeStorage();
  if (entitlement !== undefined) storage.rows.set('entitlement', entitlement);
  const crypto = countedSubtle();
  const source = licensedSource({
    chrome: { storage: { local: storage.area, onChanged: storage.onChanged }, runtime: runtime as never },
    now: () => now,
    subtle: extra.subtle ?? crypto.subtle,
    keys: [key.publicKey],
    host: 'licence.example.invalid',
  });
  return { source, storage, settle: crypto.settle };
};

const stateOf = async (entitlement: unknown, now: number): Promise<SourceState> => {
  const { source } = sourceOver(entitlement, now);
  const state = await source.ready;
  source.dispose();
  return state;
};

describe('every row of the table of states, through the stored record', () => {
  const base = () => claimsAt(T0, { inst: INST });
  const record = (token: string, seen: unknown = 0, inst = INST) => ({ v: 1, inst, token, seen });
  const at = (days: number) => T0 + days * DAY;

  it('1: no record → free', async () => {
    expect(await stateOf(undefined, at(1))).toEqual({ kind: 'free' });
  });

  it('2: a record that does not read → invalid: unreadable', async () => {
    expect(await stateOf({ v: 2, inst: INST, token: 'x', seen: 0 }, at(1))).toEqual({
      kind: 'invalid',
      reason: 'unreadable',
    });
    expect(await stateOf('a.b.c', at(1))).toEqual({ kind: 'invalid', reason: 'unreadable' });
  });

  it('3: a token that is not three parts of base64url → invalid: malformed', async () => {
    expect(await stateOf(record('not-a-token'), at(1))).toEqual({ kind: 'invalid', reason: 'malformed' });
  });

  it('4: another algorithm → invalid: unsupported', async () => {
    expect(await stateOf(record(await sign(base(), key, { alg: 'ES384' })), at(1))).toEqual({
      kind: 'invalid',
      reason: 'unsupported',
    });
  });

  it('5: a key the build does not trust → invalid: unknown-key', async () => {
    expect(await stateOf(record(await sign(base(), other)), at(1))).toEqual({
      kind: 'invalid',
      reason: 'unknown-key',
    });
  });

  it('6: a signature that does not match → invalid: signature', async () => {
    const [h, p, s] = (await sign(base())).split('.');
    const broken = `${h}.${p}.${s.slice(0, 10)}${s[10] === 'A' ? 'B' : 'A'}${s.slice(11)}`;
    expect(await stateOf(record(broken), at(1))).toEqual({ kind: 'invalid', reason: 'signature' });
  });

  it('7: signed fields that break the format → invalid: claims', async () => {
    expect(await stateOf(record(await sign({ ...base(), plan: 'free' })), at(1))).toEqual({
      kind: 'invalid',
      reason: 'claims',
    });
  });

  it('8: a token of another installation → invalid: foreign', async () => {
    expect(await stateOf(record(await sign(base()), 0, 'otherInstTEST000000000'), at(1))).toEqual({
      kind: 'invalid',
      reason: 'foreign',
    });
  });

  it.each([
    [9, 1, 0, { kind: 'active', due: false }],
    [10, 8, 0, { kind: 'active', due: true }],
    [11, 7, 0, { kind: 'active', due: true }],
    [12, 23 - 1 / DAY, 0, { kind: 'active', due: true }],
    [13, 23, 0, { kind: 'grace' }],
    [14, 30, 0, { kind: 'expired' }],
    [15, 45, 0, { kind: 'expired' }],
    [16, -5, 0, { kind: 'active', due: false }],
    [17, 2, 20, { kind: 'active', due: true }],
    [18, 10, 31, { kind: 'expired' }],
    [19, 400, 0, { kind: 'expired' }],
    [20, 5, 400, { kind: 'expired' }],
  ] as const)('%i: active, now day %d, mark day %d → %o', async (_row, day, seenDay, expected) => {
    const state = await stateOf(record(await sign(base()), seenDay === 0 ? 0 : at(seenDay)), at(day));
    expect(state).toMatchObject(expected);
  });

  it('21: ended → ended', async () => {
    const claims = base();
    const token = await sign({ ...claims, status: 'ended', warn: claims.iat, exp: claims.iat });
    expect((await stateOf(record(token), at(100))).kind).toBe('ended');
  });

  it.each(['refund', 'deactivated', 'key-blocked', 'seat-limit', 'unknown-installation'] as RevokeReason[])(
    '22: revoked, %s → revoked with that reason',
    async reason => {
      const claims = base();
      const token = await sign({
        ...claims,
        status: 'revoked',
        reason,
        chk: claims.iat,
        warn: claims.iat,
        exp: claims.iat,
      });
      expect(await stateOf(record(token), at(3))).toMatchObject({ kind: 'revoked', reason });
    },
  );

  it('23: active with `paid` before `exp` → active (the window is the server’s to bound)', async () => {
    const claims = base();
    const token = await sign({ ...claims, paid: claims.iat + 5 * DAY_S });
    expect(await stateOf(record(token), at(10))).toMatchObject({
      kind: 'active',
      licence: { paidUntil: T0 + 5 * DAY },
    });
  });

  it.each([
    ['text', 'soon'],
    ['negative', -1],
    ['NaN', Number.NaN],
  ])('24: a mark that is %s counts as 0 → as row 9', async (_what, seen) => {
    expect(await stateOf(record(await sign(base()), seen), at(1))).toMatchObject({ kind: 'active', due: false });
  });
});

describe('the source besides its states', () => {
  it('has the controls of Settings → Pro with the host it is given', async () => {
    const { source } = sourceOver(undefined, T0);
    expect(source.licence?.host).toBe('licence.example.invalid');
    expect(await source.licence?.check()).toEqual({ ok: true });
    expect(runtime.sendMessage).toHaveBeenCalledWith({ type: 'licence/check', v: 1 });
    source.dispose();
  });

  it('a storage that cannot be read gives invalid: unreadable — the free edition', async () => {
    const failing = {
      get: () => Promise.reject(new Error('storage')),
    } as unknown as Pick<chrome.storage.LocalStorageArea, 'get'>;
    const storage = fakeStorage();
    const source: EditionSource = licensedSource({
      chrome: { storage: { local: failing, onChanged: storage.onChanged }, runtime: runtime as never },
      keys: [key.publicKey],
      host: undefined,
    });
    expect(await source.ready).toEqual({ kind: 'invalid', reason: 'unreadable' });
    source.dispose();
  });

  it('a new mark alone is no new check of the signature; a new token is', async () => {
    const verify = vi.fn((...args: Parameters<SubtleCrypto['verify']>) => globalThis.crypto.subtle.verify(...args));
    const real = globalThis.crypto.subtle;
    const subtle = {
      importKey: (...args: Parameters<SubtleCrypto['importKey']>) => real.importKey(...args),
      verify,
    } as unknown as SubtleCrypto;
    const token = await sign(claimsAt(T0, { inst: INST }));
    const { source, storage, settle } = sourceOver({ v: 1, inst: INST, token, seen: 0 }, T0 + DAY, { subtle });
    await source.ready;
    expect(verify).toHaveBeenCalledTimes(1);
    await storage.area.set({ entitlement: { v: 1, inst: INST, token, seen: T0 + 8 * DAY } });
    await settle();
    await vi.waitFor(() => expect(source.current()).toMatchObject({ kind: 'active', due: true }));
    expect(verify).toHaveBeenCalledTimes(1);
    await storage.area.set({
      entitlement: { v: 1, inst: INST, token: await sign(claimsAt(T0, { inst: INST })), seen: 0 },
    });
    await vi.waitFor(() => expect(verify).toHaveBeenCalledTimes(2));
    source.dispose();
  });

  it('the factory of the build takes its keys and host from the licence root (none before the server exists)', async () => {
    const storage = fakeStorage();
    storage.rows.set('entitlement', { v: 1, inst: INST, token: await sign(claimsAt(T0, { inst: INST })), seen: 0 });
    expect(licensed.id).toBe('licensed');
    const source = licensed({
      chrome: { storage: { local: storage.area, onChanged: storage.onChanged }, runtime: runtime as never },
    });
    expect(source.id).toBe('licensed');
    expect(source.licence?.host).toBeUndefined();
    // The store build's configuration trusts no key yet: any token is from a key it does not know.
    expect(await source.ready).toEqual({ kind: 'invalid', reason: 'unknown-key' });
    source.dispose();
  });
});
