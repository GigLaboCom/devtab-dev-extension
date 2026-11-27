/**
 * The licence in the worker over a fake storage and a fake server in memory (no network), with a key made for each
 * run: every operation, the schedule's answers as the worker gives them, a replayed old answer, a token signed with
 * another key, the unsigned answers that change nothing, `busy`, a check shared by an occasion and the button, and a
 * worker stopped in the middle of a request (a promise of the server that never settles, then a new worker).
 */
import { licenceStore } from './store';
import { licenceWorker } from './worker';
import { claimsAt, makeTestKey, signToken } from '@extension/licence/testing';
import { fakeStorage } from '@src/test/fakes';
import { beforeAll, describe, expect, it } from 'vitest';
import type { LicenceServer, ServerAnswer } from './server';
import type { LicenceRecord } from './store';
import type { PublicKeyEntry } from '@extension/licence';
import type { WireClaims } from '@extension/licence/testing';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 1);
const INST = 'q3V2mZ0bTEST0000000000';
const LID = 'lic_TEST0000000001';
const SECRET = 's'.repeat(43);
const KEY = 'DTD-TEST-AAAA-BBBB-CCCC-DDDD';

let key: { readonly publicKey: PublicKeyEntry; readonly privateKey: CryptoKey };
let other: { readonly publicKey: PublicKeyEntry; readonly privateKey: CryptoKey };
beforeAll(async () => {
  key = await makeTestKey();
  other = await makeTestKey();
});

const sign = (claims: WireClaims | Record<string, unknown>, by = key) =>
  signToken(claims, { kid: by.publicKey.kid, privateKey: by.privateKey });
/** A token issued `days` after T0 for this installation and licence. */
const tokenAt = (days: number, overrides: Partial<WireClaims> = {}, by = key) =>
  sign(claimsAt(T0 + days * DAY, { inst: INST, lid: LID, ...overrides }), by);

type Answer<T> = () => Promise<ServerAnswer<T>>;
const OFFLINE = { kind: 'unreached', why: 'offline' } as const;

/** A server in memory: answers queued per address (offline when none is left), every request written down. */
const fakeServer = () => {
  const calls: Array<{ readonly address: string; readonly body: unknown }> = [];
  const queues = {
    activate: [] as Answer<{ token: string; secret: string }>[],
    refresh: [] as Answer<{ token: string }>[],
    deactivate: [] as Answer<undefined>[],
  };
  const take = <T>(queue: Answer<T>[]): Promise<ServerAnswer<T>> =>
    (queue.shift() ?? (() => Promise.resolve(OFFLINE)))();
  const server: LicenceServer = {
    activate: body => (calls.push({ address: 'activate', body }), take(queues.activate)),
    refresh: body => (calls.push({ address: 'refresh', body }), take(queues.refresh)),
    deactivate: body => (calls.push({ address: 'deactivate', body }), take(queues.deactivate)),
  };
  return { server, calls, queues };
};

const setup = (options: { now?: number; server?: boolean } = {}) => {
  const storage = fakeStorage();
  const remote = fakeServer();
  const clock = { now: options.now ?? T0 };
  const store = licenceStore(storage.area as never);
  const make = () =>
    licenceWorker({
      store,
      server: options.server === false ? undefined : remote.server,
      keys: [key.publicKey],
      now: () => clock.now,
      random: () => new Uint8Array(16).fill(7),
    });
  const licence = () => storage.rows.get('licence') as LicenceRecord | undefined;
  const entitlement = () => storage.rows.get('entitlement') as { token: string; seen: number } | undefined;
  /** A licensed installation: secret, token issued at `days`, attempts as given. */
  const licensed = async (
    days: number,
    extra: { attempts?: LicenceRecord['attempts']; seen?: number; token?: string } = {},
  ) => {
    const token = extra.token ?? (await tokenAt(days));
    storage.rows.set('licence', {
      v: 1,
      inst: INST,
      lid: LID,
      secret: SECRET,
      attempts: extra.attempts ?? { failures: 0 },
    });
    storage.rows.set('entitlement', { v: 1, inst: INST, token, seen: extra.seen ?? T0 + days * DAY });
    return token;
  };
  return { storage, remote, clock, store, worker: make(), make, licence, entitlement, licensed };
};

const ok =
  <T>(body: T) =>
  () =>
    Promise.resolve({ kind: 'ok', body } as const);
const answer =
  <T>(value: ServerAnswer<T>) =>
  () =>
    Promise.resolve(value);

describe('activate', () => {
  it('a key that is not one is refused before anything is sent', async () => {
    const { worker, remote, storage } = setup();
    expect(await worker.handle({ type: 'licence/activate', v: 1, key: 'short' })).toEqual({
      v: 1,
      ok: false,
      error: 'malformed-key',
    });
    expect(remote.calls).toEqual([]);
    expect(storage.rows.size).toBe(0);
  });

  it('a build without a server cannot activate', async () => {
    const { worker } = setup({ server: false });
    expect(await worker.handle({ type: 'licence/activate', v: 1, key: KEY })).toEqual({
      v: 1,
      ok: false,
      error: 'unavailable',
    });
  });

  it('a signed active token: both records, the secret, `seen = iat`; the key sent once and stored nowhere', async () => {
    const { worker, remote, storage, licence, entitlement } = setup({ now: T0 + 1_000 });
    const token = await sign(claimsAt(T0, { inst: 'BwcHBwcHBwcHBwcHBwcHBw', lid: LID }));
    remote.queues.activate.push(ok({ token, secret: SECRET }));
    expect(await worker.handle({ type: 'licence/activate', v: 1, key: ` ${KEY.replace(/-/g, ' - ')} ` })).toEqual({
      v: 1,
      ok: true,
    });
    // The key without its spaces; a new installation's number: 16 random bytes in base64url.
    expect(remote.calls).toEqual([{ address: 'activate', body: { key: KEY, inst: 'BwcHBwcHBwcHBwcHBwcHBw' } }]);
    expect(licence()).toEqual({
      v: 1,
      inst: 'BwcHBwcHBwcHBwcHBwcHBw',
      lid: LID,
      secret: SECRET,
      attempts: { failures: 0 },
    });
    expect(entitlement()).toEqual({ v: 1, inst: 'BwcHBwcHBwcHBwcHBwcHBw', token, seen: T0 });
    expect(JSON.stringify([...storage.rows])).not.toContain('DTD-');
  });

  it('an installation that already has a number keeps it', async () => {
    const { worker, remote, storage } = setup();
    storage.rows.set('licence', { v: 1, inst: INST, attempts: { failures: 0 } });
    remote.queues.activate.push(ok({ token: await tokenAt(0), secret: SECRET }));
    expect((await worker.handle({ type: 'licence/activate', v: 1, key: KEY })).ok).toBe(true);
    expect(remote.calls[0].body).toEqual({ key: KEY, inst: INST });
  });

  it.each(['key-unknown', 'seat-limit', 'key-blocked', 'licence-inactive'] as const)(
    'refused %s: that error, nothing stored, the pending mark gone',
    async error => {
      const { worker, remote, licence, entitlement } = setup();
      remote.queues.activate.push(answer({ kind: 'refused', error }));
      expect(await worker.handle({ type: 'licence/activate', v: 1, key: KEY })).toEqual({ v: 1, ok: false, error });
      expect(entitlement()).toBeUndefined();
      expect(licence()?.pending).toBeUndefined();
      expect(licence()?.secret).toBeUndefined();
    },
  );

  it.each([
    ['offline', 'offline'],
    ['timeout', 'offline'],
    ['server', 'server'],
    ['not-json', 'server'],
    ['too-large', 'server'],
    ['unexpected', 'server'],
  ] as const)('not reached (%s) → %s; nothing stored', async (why, error) => {
    const { worker, remote, licence, entitlement } = setup();
    remote.queues.activate.push(answer({ kind: 'unreached', why }));
    expect(await worker.handle({ type: 'licence/activate', v: 1, key: KEY })).toEqual({ v: 1, ok: false, error });
    expect(entitlement()).toBeUndefined();
    expect(licence()?.pending).toBeUndefined();
  });

  it.each([
    ['rate-limited', 'rate-limited'],
    ['busy', 'server-busy'],
  ] as const)('%s: the error with its time; until then neither activation nor check goes out', async (kind, error) => {
    const { worker, remote, licence } = setup();
    remote.queues.activate.push(answer({ kind, retryAt: T0 + 120_000 }));
    expect(await worker.handle({ type: 'licence/activate', v: 1, key: KEY })).toEqual({
      v: 1,
      ok: false,
      error,
      retryAt: T0 + 120_000,
    });
    expect(licence()?.attempts).toMatchObject({ retryAfter: T0 + 120_000, retryCause: error });
    expect(await worker.handle({ type: 'licence/activate', v: 1, key: KEY })).toEqual({
      v: 1,
      ok: false,
      error,
      retryAt: T0 + 120_000,
    });
    expect(remote.calls).toHaveLength(1);
  });

  it.each([
    ['signed with another key', () => tokenAt(0, { inst: 'BwcHBwcHBwcHBwcHBwcHBw' }, other)],
    ['for another installation', () => tokenAt(0, { inst: 'otherInstTEST000000000' })],
    [
      'not active',
      () =>
        tokenAt(0, {
          inst: 'BwcHBwcHBwcHBwcHBwcHBw',
          status: 'ended',
          warn: Math.floor(T0 / 1000),
          exp: Math.floor(T0 / 1000),
        }),
    ],
    ['not a token', () => Promise.resolve('not.a.token')],
  ])('an answer %s is not kept: bad-answer, nothing stored', async (_what, token) => {
    const { worker, remote, licence, entitlement } = setup();
    remote.queues.activate.push(ok({ token: await token(), secret: SECRET }));
    expect(await worker.handle({ type: 'licence/activate', v: 1, key: KEY })).toEqual({
      v: 1,
      ok: false,
      error: 'bad-answer',
    });
    expect(entitlement()).toBeUndefined();
    expect(licence()).toEqual({ v: 1, inst: 'BwcHBwcHBwcHBwcHBwcHBw', attempts: { failures: 0 } });
  });

  it('an activation arriving while another operation runs is told busy', async () => {
    const { worker, remote, licensed } = setup({ now: T0 + 8 * DAY });
    await licensed(0);
    let release: (value: ServerAnswer<{ token: string }>) => void = () => undefined;
    let asked: () => void = () => undefined;
    const sent = new Promise<void>(resolve => (asked = resolve));
    remote.queues.refresh.push(() => {
      asked();
      return new Promise(resolve => (release = resolve));
    });
    const checking = worker.handle({ type: 'licence/check', v: 1 });
    await sent;
    expect(await worker.handle({ type: 'licence/activate', v: 1, key: KEY })).toEqual({
      v: 1,
      ok: false,
      error: 'busy',
    });
    release(OFFLINE);
    expect(await checking).toEqual({ v: 1, ok: false, error: 'offline' });
  });
});

describe('check', () => {
  it('without a licence, or without its secret, there is nothing to check: ok, nothing sent', async () => {
    const { worker, remote, storage } = setup();
    expect(await worker.handle({ type: 'licence/check', v: 1 })).toEqual({ v: 1, ok: true });
    storage.rows.set('licence', { v: 1, inst: INST, attempts: { failures: 0 } });
    expect(await worker.handle({ type: 'licence/check', v: 1 })).toEqual({ v: 1, ok: true });
    await worker.trigger('startup');
    expect(remote.calls).toEqual([]);
  });

  it('the button: a newer signed token is kept with `seen = iat`, the failures reset; the request carries lid, inst, secret', async () => {
    const { worker, remote, licensed, licence, entitlement } = setup({ now: T0 + 2 * DAY });
    await licensed(0, { attempts: { failures: 2, last: T0 } });
    const fresh = await tokenAt(1);
    remote.queues.refresh.push(ok({ token: fresh }));
    expect(await worker.handle({ type: 'licence/check', v: 1 })).toEqual({ v: 1, ok: true });
    expect(remote.calls).toEqual([{ address: 'refresh', body: { lid: LID, inst: INST, secret: SECRET } }]);
    expect(entitlement()).toEqual({ v: 1, inst: INST, token: fresh, seen: T0 + DAY });
    expect(licence()?.attempts).toEqual({ last: T0 + 2 * DAY, failures: 0 });
  });

  it('the same iat is kept too; a newer revoked replaces an active, an older one does not', async () => {
    const { worker, remote, licensed, entitlement, clock } = setup({ now: T0 + DAY });
    await licensed(0);
    const same = await tokenAt(0);
    remote.queues.refresh.push(ok({ token: same }));
    expect((await worker.handle({ type: 'licence/check', v: 1 })).ok).toBe(true);
    expect(entitlement()?.token).toBe(same);
    const iat = Math.floor((T0 + DAY / 2) / 1000);
    const revoked = await tokenAt(0.5, { status: 'revoked', reason: 'refund', chk: iat, warn: iat, exp: iat });
    clock.now += 120_000;
    remote.queues.refresh.push(ok({ token: revoked }));
    expect((await worker.handle({ type: 'licence/check', v: 1 })).ok).toBe(true);
    expect(entitlement()?.token).toBe(revoked);
    // An old "revoked" never overrides a newer "active".
    const newer = await tokenAt(0.9);
    await licensed(0.9, { token: newer });
    const olderIat = Math.floor((T0 + DAY / 4) / 1000);
    clock.now += 120_000;
    remote.queues.refresh.push(
      ok({
        token: await tokenAt(0.25, {
          status: 'revoked',
          reason: 'refund',
          chk: olderIat,
          warn: olderIat,
          exp: olderIat,
        }),
      }),
    );
    expect(await worker.handle({ type: 'licence/check', v: 1 })).toEqual({ v: 1, ok: false, error: 'bad-answer' });
    expect(entitlement()?.token).toBe(newer);
  });

  it('a replayed older answer is not kept: bad-answer, the token and its mark stay, one more failure', async () => {
    const { worker, remote, licensed, licence, entitlement } = setup({ now: T0 + 10 * DAY });
    const held = await licensed(5);
    remote.queues.refresh.push(ok({ token: await tokenAt(1) }));
    expect(await worker.handle({ type: 'licence/check', v: 1 })).toEqual({ v: 1, ok: false, error: 'bad-answer' });
    expect(entitlement()).toEqual({ v: 1, inst: INST, token: held, seen: T0 + 5 * DAY });
    expect(licence()?.attempts.failures).toBe(1);
  });

  it.each([
    ['signed with another key', () => tokenAt(1, {}, other)],
    ['for another licence', () => tokenAt(1, { lid: 'lic_OTHER000000001' })],
    ['for another installation', () => tokenAt(1, { inst: 'otherInstTEST000000000' })],
  ])('an answer %s is not kept', async (_what, token) => {
    const { worker, remote, licensed, entitlement } = setup({ now: T0 + 2 * DAY });
    const held = await licensed(0);
    remote.queues.refresh.push(ok({ token: await token() }));
    expect(await worker.handle({ type: 'licence/check', v: 1 })).toEqual({ v: 1, ok: false, error: 'bad-answer' });
    expect(entitlement()?.token).toBe(held);
  });

  it.each([
    [{ kind: 'unreached', why: 'offline' }, { error: 'offline' }],
    [{ kind: 'unreached', why: 'timeout' }, { error: 'offline' }],
    [{ kind: 'unreached', why: 'server' }, { error: 'server' }],
    [{ kind: 'unreached', why: 'not-json' }, { error: 'server' }],
    [
      { kind: 'rate-limited', retryAt: T0 + DAY + 60_000 },
      { error: 'rate-limited', retryAt: T0 + DAY + 60_000 },
    ],
    [
      { kind: 'busy', retryAt: T0 + DAY + 600_000 },
      { error: 'server-busy', retryAt: T0 + DAY + 600_000 },
    ],
  ] as const)('an unsigned answer %o changes nothing stored but the count: %o', async (reply, outcome) => {
    const { worker, remote, licensed, licence, entitlement } = setup({ now: T0 + DAY });
    const held = await licensed(0);
    remote.queues.refresh.push(answer(reply as ServerAnswer<{ token: string }>));
    expect(await worker.handle({ type: 'licence/check', v: 1 })).toEqual({ v: 1, ok: false, ...outcome });
    expect(entitlement()).toEqual({ v: 1, inst: INST, token: held, seen: T0 });
    expect(licence()?.attempts).toMatchObject({ failures: 1, last: T0 + DAY });
  });

  it('the button within 60 s of the last request is refused with when it may come; a Retry-After holds it too', async () => {
    const { worker, remote, licensed, clock } = setup({ now: T0 + DAY });
    await licensed(0, { attempts: { failures: 0, last: T0 + DAY - 10_000 } });
    expect(await worker.handle({ type: 'licence/check', v: 1 })).toEqual({
      v: 1,
      ok: false,
      error: 'rate-limited',
      retryAt: T0 + DAY + 50_000,
    });
    await licensed(0, {
      attempts: { failures: 1, last: T0, retryAfter: T0 + DAY + 300_000, retryCause: 'server-busy' },
    });
    expect(await worker.handle({ type: 'licence/check', v: 1 })).toEqual({
      v: 1,
      ok: false,
      error: 'server-busy',
      retryAt: T0 + DAY + 300_000,
    });
    clock.now = T0 + DAY + 300_000;
    remote.queues.refresh.push(answer(OFFLINE));
    expect((await worker.handle({ type: 'licence/check', v: 1 })).ok).toBe(false);
    expect(remote.calls).toHaveLength(1);
  });

  it('occasions: not before chk; due — once; revoked — only by the button', async () => {
    const { worker, remote, licensed, clock } = setup({ now: T0 + 3 * DAY });
    await licensed(0);
    await worker.trigger('opened');
    expect(remote.calls).toHaveLength(0);
    clock.now = T0 + 8 * DAY;
    remote.queues.refresh.push(answer(OFFLINE));
    await worker.trigger('startup');
    expect(remote.calls).toHaveLength(1);
    // After a failure, the next occasion waits an hour.
    await worker.trigger('installed');
    expect(remote.calls).toHaveLength(1);
    const iat = Math.floor(T0 / 1000);
    await licensed(0, {
      token: await tokenAt(0, { status: 'revoked', reason: 'seat-limit', chk: iat, warn: iat, exp: iat }),
    });
    await worker.trigger('opened');
    expect(remote.calls).toHaveLength(1);
    remote.queues.refresh.push(answer(OFFLINE));
    await worker.handle({ type: 'licence/check', v: 1 });
    expect(remote.calls).toHaveLength(2);
  });

  it('a spoiled token with a secret is checked as urgent, and the record’s lid and inst decide what is kept', async () => {
    const { worker, remote, licensed, entitlement } = setup({ now: T0 + DAY });
    await licensed(0, { token: 'spoiled' });
    const fresh = await tokenAt(1);
    remote.queues.refresh.push(ok({ token: fresh }));
    await worker.trigger('opened');
    expect(remote.calls).toHaveLength(1);
    expect(entitlement()?.token).toBe(fresh);
  });

  it('a secret whose token record is gone is urgent too (unreadable), and repaired the same way', async () => {
    const { worker, remote, storage, entitlement } = setup({ now: T0 + DAY });
    storage.rows.set('licence', { v: 1, inst: INST, lid: LID, secret: SECRET, attempts: { failures: 0 } });
    const fresh = await tokenAt(1);
    remote.queues.refresh.push(ok({ token: fresh }));
    await worker.trigger('startup');
    expect(entitlement()?.token).toBe(fresh);
  });

  it('a check begun by an occasion and the button meanwhile get the same result from one request', async () => {
    const { worker, remote, licensed } = setup({ now: T0 + 8 * DAY });
    await licensed(0);
    let release: (value: ServerAnswer<{ token: string }>) => void = () => undefined;
    let asked: () => void = () => undefined;
    const sent = new Promise<void>(resolve => (asked = resolve));
    remote.queues.refresh.push(() => {
      asked();
      return new Promise(resolve => (release = resolve));
    });
    const occasion = worker.trigger('opened');
    await sent;
    const button = worker.handle({ type: 'licence/check', v: 1 });
    const fresh = await tokenAt(8);
    release({ kind: 'ok', body: { token: fresh } });
    await occasion;
    expect(await button).toEqual({ v: 1, ok: true });
    expect(remote.calls).toHaveLength(1);
  });
});

describe('deactivate, remove, opened', () => {
  it('deactivate frees the place on the server and erases both records — whatever the server answers', async () => {
    const { worker, remote, licensed, storage } = setup({ now: T0 + DAY });
    await licensed(0);
    remote.queues.deactivate.push(answer(OFFLINE));
    expect(await worker.handle({ type: 'licence/deactivate', v: 1 })).toEqual({ v: 1, ok: true });
    expect(remote.calls).toEqual([{ address: 'deactivate', body: { lid: LID, inst: INST, secret: SECRET } }]);
    expect(storage.rows.size).toBe(0);
  });

  it('deactivate without a secret, and remove: no request, records erased', async () => {
    const { worker, remote, storage } = setup();
    storage.rows.set('licence', { v: 1, inst: INST, attempts: { failures: 0 } });
    expect(await worker.handle({ type: 'licence/deactivate', v: 1 })).toEqual({ v: 1, ok: true });
    storage.rows.set('entitlement', { v: 1, inst: INST, token: 'x', seen: 0 });
    expect(await worker.handle({ type: 'licence/remove', v: 1 })).toEqual({ v: 1, ok: true });
    expect(remote.calls).toEqual([]);
    expect(storage.rows.size).toBe(0);
  });

  it('opened answers at once, moves the mark up and checks when due; without a licence it does nothing', async () => {
    const empty = setup();
    expect(await empty.worker.handle({ type: 'licence/opened', v: 1 })).toEqual({ v: 1, ok: true });
    await empty.worker.trigger('opened');
    expect(empty.remote.calls).toEqual([]);
    expect(empty.storage.rows.size).toBe(0);

    const { worker, remote, licensed, entitlement } = setup({ now: T0 + 8 * DAY });
    await licensed(0);
    const fresh = await tokenAt(8);
    remote.queues.refresh.push(ok({ token: fresh }));
    expect(await worker.handle({ type: 'licence/opened', v: 1 })).toEqual({ v: 1, ok: true });
    // The operations are queued: an occasion behind them finishes after them.
    await worker.trigger('startup');
    expect(remote.calls).toHaveLength(1);
    expect(entitlement()?.token).toBe(fresh);
  });
});

describe('a worker stopped in the middle of a request', () => {
  it('the installation’s number and the pending mark survive; a new worker activates with the same number', async () => {
    const first = setup();
    first.remote.queues.activate.push(() => new Promise(() => undefined));
    void first.worker.handle({ type: 'licence/activate', v: 1, key: KEY });
    await expect.poll(() => first.licence()?.pending).toEqual({ since: T0 });
    const inst = first.licence()!.inst;
    // Chrome stopped the worker: a new one starts over the same storage.
    const again = first.make();
    first.remote.queues.activate.push(ok({ token: await tokenAt(0, { inst }), secret: SECRET }));
    expect(await again.handle({ type: 'licence/activate', v: 1, key: KEY })).toEqual({ v: 1, ok: true });
    expect(first.remote.calls.map(c => (c.body as { inst: string }).inst)).toEqual([inst, inst]);
    expect(first.licence()?.pending).toBeUndefined();
  });

  it('a check stopped mid-request was already counted: the next occasions wait the pause instead of retrying', async () => {
    const first = setup({ now: T0 + 8 * DAY });
    await first.licensed(0);
    first.remote.queues.refresh.push(() => new Promise(() => undefined));
    void first.worker.trigger('opened');
    await expect.poll(() => first.licence()?.attempts).toEqual({ last: T0 + 8 * DAY, failures: 1 });
    const again = first.make();
    first.clock.now = T0 + 8 * DAY + 60_000;
    await again.trigger('opened');
    await again.trigger('startup');
    expect(first.remote.calls).toHaveLength(1);
    // After the pause of one failure (an hour), it asks again.
    first.clock.now = T0 + 8 * DAY + 3_600_000;
    first.remote.queues.refresh.push(answer(OFFLINE));
    await again.trigger('opened');
    expect(first.remote.calls).toHaveLength(2);
  });
});

describe('an activation the site made', () => {
  const NEW_INST = 'BwcHBwcHBwcHBwcHBwcHBw';

  it('hello gives the installation number, made and kept once, and sends nothing', async () => {
    const { worker, remote, licence } = setup();
    expect(await worker.siteHello()).toEqual({ inst: NEW_INST });
    expect(licence()?.inst).toBe(NEW_INST);
    expect(licence()?.pending).toBeUndefined();
    expect(await worker.siteHello()).toEqual({ inst: NEW_INST });
    expect(remote.calls).toEqual([]);
  });

  it('a signed active token for this installation and the licence it names is kept as after a key', async () => {
    const { worker, licence, entitlement } = setup({ now: T0 + 1_000 });
    const { inst } = await worker.siteHello();
    const token = await sign(claimsAt(T0, { inst, lid: LID }));
    expect(await worker.siteLicence({ lid: LID, token, secret: SECRET })).toEqual({ ok: true });
    expect(licence()).toMatchObject({ inst, lid: LID, secret: SECRET });
    expect(entitlement()).toEqual({ v: 1, inst, token, seen: T0 });
  });

  it('another installation, another licence, another key, a bad secret or no hello: nothing is kept', async () => {
    const { worker, licence, entitlement } = setup({ now: T0 + 1_000 });
    const stranger = await sign(claimsAt(T0, { inst: INST, lid: LID }));
    expect(await worker.siteLicence({ lid: LID, token: stranger, secret: SECRET })).toEqual({
      ok: false,
      error: 'bad-answer',
    });
    const { inst } = await worker.siteHello();
    for (const [lid, token, secret] of [
      [LID, await sign(claimsAt(T0, { inst: INST, lid: LID })), SECRET],
      ['lic_OTHER000000001', await sign(claimsAt(T0, { inst, lid: LID })), SECRET],
      [LID, await sign(claimsAt(T0, { inst, lid: LID }), other), SECRET],
      [LID, await sign(claimsAt(T0, { inst, lid: LID })), 'short'],
    ] as const) {
      expect(await worker.siteLicence({ lid, token, secret })).toEqual({ ok: false, error: 'bad-answer' });
    }
    expect(licence()?.secret).toBeUndefined();
    expect(entitlement()).toBeUndefined();
  });
});
