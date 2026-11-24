/**
 * The licence in the service worker: what each trusted request does (activate, check now, deactivate, remove, a page
 * opened) and the occasions on which it looks whether a check is due (the profile's start, an install or update, a
 * page opening — there is no alarm). Every operation that writes a record or goes to the network runs one at a time:
 * a check begun by an occasion and `Check now` arriving meanwhile get the same result; an activation arriving while
 * another request to the server is on its way is told `busy`. A request is written down before it is sent (`pending`, `attempting`), so a
 * worker stopped mid-request neither loses the installation's number nor turns into rapid retries.
 *
 * What it keeps (pro-entitlement-implementation §4.3): an activation's token only when its signature and fields are
 * right, it is for the installation that asked and it is `active`; a refreshed token only when it is for the same
 * licence and installation and issued no earlier than the one held. Nothing unsigned changes anything stored — a
 * network error, a timeout, an HTML page, a 5xx, a 4xx without a token: only the count of failures grows, and a
 * Retry-After may only postpone the next request. The licence key lives in memory for the one request and is never
 * stored or logged.
 */
import {
  acceptActivation,
  acceptRefresh,
  base64urlEncode,
  evaluate,
  shouldCheck,
  verifyToken,
} from '@extension/licence';
import { createDebug } from '@extension/logger';
import { normaliseKey } from '@src/shared/licenceMessages';
import type { LicenceServer } from './server';
import type { LicenceRecord, LicenceStore } from './store';
import type { Attempts, CheckDecision, PublicKeyEntry, Stored, Trigger } from '@extension/licence';
import type { LicenceOutcome, LicenceReply, LicenceRequest } from '@src/shared/licenceMessages';
import type { EntitlementRecord } from '@src/shared/licenceRecords';

const debug = createDebug('extension:licence');

export interface LicenceWorkerDeps {
  readonly store: LicenceStore;
  /** `undefined` when the config has no origin: activation answers `unavailable`, nothing is ever sent. */
  readonly server: LicenceServer | undefined;
  readonly keys: readonly PublicKeyEntry[];
  readonly now: () => number;
  /** 16 random bytes for a new installation number. */
  readonly random: () => Uint8Array;
  readonly subtle?: SubtleCrypto;
}

/** The licence's own requests (`plans/refresh` goes to the plans worker, src/background/plans). */
export type LicenceWork = Exclude<LicenceRequest, { readonly type: 'plans/refresh' }>;

export interface LicenceWorker {
  /** Answers one trusted request; never rejects. */
  handle(request: LicenceWork): Promise<LicenceReply>;
  /** A reason to see whether a check is due (startup, installed, a page opened). */
  trigger(trigger: Exclude<Trigger, 'button'>): Promise<void>;
}

const OK: LicenceOutcome = { ok: true };
const reply = (outcome: LicenceOutcome): LicenceReply => ({ v: 1, ...outcome });

/** A refused request's answer while a Retry-After holds: the text of the answer that set it. */
const waitOutcome = (attempts: Attempts, at: number): LicenceOutcome => ({
  ok: false,
  error: attempts.retryCause === 'server-busy' ? 'server-busy' : 'rate-limited',
  retryAt: at,
});

export const licenceWorker = (deps: LicenceWorkerDeps): LicenceWorker => {
  const { store, server, keys, now, subtle } = deps;

  // One operation at a time.
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work);
    tail = run.catch(() => undefined);
    return run;
  };
  /**
   * Requests to the server on their way. An activation arriving meanwhile is `busy`; one arriving while only storage
   * is read or written (a page opened in a profile without a licence) waits its turn instead.
   */
  let talking = 0;
  const talk = async <T>(request: () => Promise<T>): Promise<T> => {
    talking += 1;
    try {
      return await request();
    } finally {
      talking -= 1;
    }
  };
  /** A check that is talking to the server now: an occasion or the button arriving meanwhile share its result. */
  let inFlight: Promise<LicenceOutcome> | undefined;

  /** What is stored, as a page would compute it — plus: a secret without a readable token is `unreadable`. */
  const storedOf = async (entitlement: EntitlementRecord | undefined, licence: LicenceRecord): Promise<Stored> => {
    if (!entitlement) return licence.secret ? { kind: 'unreadable' } : { kind: 'none' };
    const verified = await verifyToken(entitlement.token, keys, subtle);
    return verified.ok
      ? { kind: 'token', claims: verified.claims, inst: entitlement.inst }
      : { kind: 'rejected', reason: verified.reason };
  };

  const answerOf = (decision: Extract<CheckDecision, { check: false }>, attempts: Attempts): LicenceOutcome => {
    switch (decision.why) {
      case 'retry-after':
        return waitOutcome(attempts, decision.notBefore ?? now());
      case 'backoff':
        return { ok: false, error: 'rate-limited', retryAt: decision.notBefore ?? now() };
      default:
        // No secret: nothing to check. Not due, or only by hand: an occasion does nothing (the button is never told so).
        return OK;
    }
  };

  const check = async (trigger: Trigger): Promise<LicenceOutcome> => {
    const { licence, entitlement } = await store.read();
    if (!licence) return OK;
    const at = now();
    const seen = entitlement?.seen ?? 0;
    const stored = await storedOf(entitlement, licence);
    const state = evaluate(stored, at, seen);
    const { lid, secret, inst } = licence;
    const decision = shouldCheck(
      { hasSecret: Boolean(lid && secret), state, attempts: licence.attempts, trigger },
      at,
      seen,
    );
    if (!decision.check) return answerOf(decision, licence.attempts);
    if (!server || !lid || !secret) return { ok: false, error: 'unavailable' };
    const request = refresh(server, { lid, inst, secret }, stored, at);
    inFlight = request;
    try {
      return await request;
    } finally {
      if (inFlight === request) inFlight = undefined;
    }
  };

  /** The request of a check and what is kept of its answer. */
  const refresh = async (
    to: LicenceServer,
    { lid, inst, secret }: { readonly lid: string; readonly inst: string; readonly secret: string },
    stored: Stored,
    at: number,
  ): Promise<LicenceOutcome> => {
    await store.attempting(at);
    const answer = await talk(() => to.refresh({ lid, inst, secret }));
    switch (answer.kind) {
      case 'ok': {
        const verified = await verifyToken(answer.body.token, keys, subtle);
        // The token held, when it is this licence's and this installation's; otherwise the record names them.
        const held =
          stored.kind === 'token' && stored.claims.lid === lid && stored.claims.inst === inst && stored.inst === inst
            ? stored.claims
            : undefined;
        const accepted =
          verified.ok &&
          (held
            ? acceptRefresh(held, verified.claims).accept
            : verified.claims.lid === lid && verified.claims.inst === inst);
        if (!accepted) {
          debug.warn('refresh answer not kept', verified.ok ? 'not newer or not ours' : verified.reason);
          await store.failed();
          return { ok: false, error: 'bad-answer' };
        }
        await store.refreshed(answer.body.token, verified.claims.iat);
        return OK;
      }
      case 'rate-limited':
        await store.failed({ at: answer.retryAt, cause: 'rate-limited' });
        return { ok: false, error: 'rate-limited', retryAt: answer.retryAt };
      case 'busy':
        await store.failed({ at: answer.retryAt, cause: 'server-busy' });
        return { ok: false, error: 'server-busy', retryAt: answer.retryAt };
      case 'unreached':
        await store.failed();
        return { ok: false, error: answer.why === 'offline' || answer.why === 'timeout' ? 'offline' : 'server' };
      default:
        await store.failed();
        return { ok: false, error: 'server' };
    }
  };

  /** A check by an occasion or the button: shares the one talking to the server, if any; queued otherwise. */
  const runCheck = (trigger: Trigger): Promise<LicenceOutcome> => inFlight ?? enqueue(() => check(trigger));

  const activate = async (raw: string): Promise<LicenceOutcome> => {
    const key = normaliseKey(raw);
    if (key === undefined) return { ok: false, error: 'malformed-key' };
    if (!server) return { ok: false, error: 'unavailable' };
    const { licence } = await store.read();
    const at = now();
    const retryAfter = licence?.attempts.retryAfter;
    if (licence && retryAfter !== undefined && retryAfter > at) return waitOutcome(licence.attempts, retryAfter);
    const inst = licence?.inst ?? base64urlEncode(deps.random());
    await store.beginActivation(inst, at);
    const answer = await talk(() => server.activate({ key, inst }));
    switch (answer.kind) {
      case 'ok': {
        const verified = await verifyToken(answer.body.token, keys, subtle);
        if (!verified.ok || !acceptActivation(inst, verified.claims).accept) {
          debug.warn('activation answer not kept', verified.ok ? 'not active or not ours' : verified.reason);
          await store.endActivation();
          return { ok: false, error: 'bad-answer' };
        }
        await store.activated({
          inst,
          lid: verified.claims.lid,
          secret: answer.body.secret,
          token: answer.body.token,
          iat: verified.claims.iat,
        });
        return OK;
      }
      case 'refused':
        await store.endActivation();
        return { ok: false, error: answer.error };
      case 'rate-limited':
      case 'busy': {
        const cause = answer.kind === 'busy' ? 'server-busy' : 'rate-limited';
        await store.failed({ at: answer.retryAt, cause });
        await store.endActivation();
        return { ok: false, error: cause, retryAt: answer.retryAt };
      }
      default:
        await store.endActivation();
        return { ok: false, error: answer.why === 'offline' || answer.why === 'timeout' ? 'offline' : 'server' };
    }
  };

  const deactivate = async (): Promise<LicenceOutcome> => {
    const { licence } = await store.read();
    if (server && licence?.lid && licence.secret) {
      // The answer only frees the place on the server; the records go whatever it is.
      const { lid, inst, secret } = licence;
      await talk(() => server.deactivate({ lid, inst, secret }));
    }
    await store.erase();
    return OK;
  };

  /** Never rejects: a failure of the browser's storage itself is answered as the server's. */
  const safely = (work: Promise<LicenceOutcome>): Promise<LicenceReply> =>
    work.then(reply, error => {
      debug.warn('licence operation', error);
      return reply({ ok: false, error: 'server' });
    });

  return {
    handle: request => {
      switch (request.type) {
        case 'licence/opened':
          void enqueue(async () => {
            await store.touchSeen(now());
          })
            .then(() => runCheck('opened'))
            .catch(error => debug.warn('opened', error));
          return Promise.resolve(reply(OK));
        case 'licence/activate':
          if (talking > 0) return Promise.resolve(reply({ ok: false, error: 'busy' }));
          return safely(enqueue(() => activate(request.key)));
        case 'licence/check':
          return safely(runCheck('button'));
        case 'licence/deactivate':
          return safely(enqueue(deactivate));
        case 'licence/remove':
          return safely(enqueue(() => store.erase().then(() => OK)));
        default:
          return Promise.resolve(reply({ ok: false, error: 'version' }));
      }
    },
    trigger: async trigger => {
      await runCheck(trigger).catch(error => debug.warn('check', error));
    },
  };
};
