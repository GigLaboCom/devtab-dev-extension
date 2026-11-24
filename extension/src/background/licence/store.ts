/**
 * The service worker's only access to the two licence records in chrome.storage.local (`sync` would carry them to the
 * account's other browsers and make the count of installations meaningless; `session` empties at every restart):
 *
 *   licence      LicenceRecord — this installation's number, and once activated the licence's number and the
 *                installation's secret; an activation on its way; the attempts. Only this module knows the key.
 *   entitlement  the signed token and the clock mark (src/shared/licenceRecords.ts); the pages read it.
 *
 * Only the worker writes either. The licence key is never stored anywhere; nothing here is encrypted (a key to decrypt
 * it would have to live in the same profile). No module logs the key, the secret or a whole token.
 */
import { ENTITLEMENT_KEY, readEntitlement } from '@src/shared/licenceRecords';
import type { Attempts } from '@extension/licence';
import type { EntitlementRecord } from '@src/shared/licenceRecords';

const LICENCE_KEY = 'licence';
const HOUR = 3_600_000;

export interface LicenceRecord {
  readonly v: 1;
  readonly inst: string;
  /** Present once an activation succeeded. */
  readonly lid?: string;
  readonly secret?: string;
  /** An activation was sent and not answered yet (the worker may have been stopped). */
  readonly pending?: { readonly since: number };
  readonly attempts: Attempts;
}

export interface LicenceStore {
  read(): Promise<{ readonly licence?: LicenceRecord; readonly entitlement?: EntitlementRecord }>;
  /** Before an activation is sent: keeps `inst` (reused if already there) and marks it pending. */
  beginActivation(inst: string, now: number): Promise<void>;
  /** An activation that ended without a token: the pending mark goes, nothing else changes. */
  endActivation(): Promise<void>;
  /** One storage.set with both keys: the secret, the token, and `seen = iat`. */
  activated(done: {
    readonly inst: string;
    readonly lid: string;
    readonly secret: string;
    readonly token: string;
    readonly iat: number;
  }): Promise<void>;
  /** An accepted refresh: the token, `seen = iat`, attempts reset — one storage.set. */
  refreshed(token: string, iat: number): Promise<void>;
  /**
   * A request began — written before it is sent, so a stopped worker still counts it: it is counted as a failure until
   * an accepted token (`refreshed`) resets the count, so requests cut short never turn into rapid retries.
   */
  attempting(now: number): Promise<void>;
  /** A request ended without an accepted token: `retry` with its cause when a 429 or a 503 named a time, else none. */
  failed(retry?: { readonly at: number; readonly cause: 'rate-limited' | 'server-busy' }): Promise<void>;
  /** `seen = max(seen, now)` when it is an hour or more behind. */
  touchSeen(now: number): Promise<void>;
  /** Both keys removed. */
  erase(): Promise<void>;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const optional = (value: unknown, check: (value: unknown) => boolean): boolean => value === undefined || check(value);

/** The attempts as stored, or none made yet when they are not of this shape. */
const attemptsOf = (raw: unknown): Attempts => {
  if (!isObject(raw)) return { failures: 0 };
  const { last, failures, retryAfter, retryCause } = raw;
  return {
    ...(isTime(last) ? { last } : {}),
    failures: typeof failures === 'number' && Number.isInteger(failures) && failures >= 0 ? failures : 0,
    ...(isTime(retryAfter) ? { retryAfter } : {}),
    ...(retryCause === 'rate-limited' || retryCause === 'server-busy' ? { retryCause } : {}),
  };
};

/** The record `licence`, or `undefined` when there is none or it is not of this shape (it is then treated as absent). */
const readLicence = (raw: unknown): LicenceRecord | undefined => {
  if (!isObject(raw) || raw.v !== 1 || typeof raw.inst !== 'string') return undefined;
  const { inst, lid, secret, pending } = raw;
  if (!optional(lid, v => typeof v === 'string') || !optional(secret, v => typeof v === 'string')) return undefined;
  return {
    v: 1,
    inst,
    ...(typeof lid === 'string' ? { lid } : {}),
    ...(typeof secret === 'string' ? { secret } : {}),
    ...(isObject(pending) && isTime(pending.since) ? { pending: { since: pending.since } } : {}),
    attempts: attemptsOf(raw.attempts),
  };
};

export const licenceStore = (area: Pick<chrome.storage.LocalStorageArea, 'get' | 'set' | 'remove'>): LicenceStore => {
  const read = async () => {
    const rows = (await area.get([LICENCE_KEY, ENTITLEMENT_KEY])) as Record<string, unknown>;
    const licence = readLicence(rows[LICENCE_KEY]);
    const entitlement = readEntitlement(rows[ENTITLEMENT_KEY]);
    return {
      ...(licence ? { licence } : {}),
      ...(typeof entitlement === 'object' ? { entitlement } : {}),
    };
  };
  const writeLicence = (licence: LicenceRecord) => area.set({ [LICENCE_KEY]: licence });
  /** Changes the record `licence` when there is one; without it there is nothing to count. */
  const update = async (change: (licence: LicenceRecord) => LicenceRecord) => {
    const { licence } = await read();
    if (licence) await writeLicence(change(licence));
  };

  return {
    read,
    beginActivation: async (inst, now) => {
      const { licence } = await read();
      await writeLicence({
        ...(licence?.inst === inst ? licence : {}),
        v: 1,
        inst,
        pending: { since: now },
        attempts: licence?.attempts ?? { failures: 0 },
      });
    },
    endActivation: () =>
      update(({ v, inst, lid, secret, attempts }) => ({
        v,
        inst,
        ...(lid !== undefined ? { lid } : {}),
        ...(secret !== undefined ? { secret } : {}),
        attempts,
      })),
    activated: ({ inst, lid, secret, token, iat }) =>
      area.set({
        [LICENCE_KEY]: { v: 1, inst, lid, secret, attempts: { failures: 0 } } satisfies LicenceRecord,
        [ENTITLEMENT_KEY]: { v: 1, inst, token, seen: iat } satisfies EntitlementRecord,
      }),
    refreshed: async (token, iat) => {
      const { licence } = await read();
      if (!licence) return;
      await area.set({
        [LICENCE_KEY]: {
          ...licence,
          attempts: { ...(licence.attempts.last !== undefined ? { last: licence.attempts.last } : {}), failures: 0 },
        } satisfies LicenceRecord,
        [ENTITLEMENT_KEY]: { v: 1, inst: licence.inst, token, seen: iat } satisfies EntitlementRecord,
      });
    },
    attempting: now =>
      update(licence => ({
        ...licence,
        attempts: { ...licence.attempts, last: now, failures: licence.attempts.failures + 1 },
      })),
    failed: retry =>
      update(licence => ({
        ...licence,
        attempts: {
          ...(licence.attempts.last !== undefined ? { last: licence.attempts.last } : {}),
          failures: licence.attempts.failures,
          ...(retry ? { retryAfter: retry.at, retryCause: retry.cause } : {}),
        },
      })),
    touchSeen: async now => {
      const { entitlement } = await read();
      if (!entitlement || now - entitlement.seen < HOUR) return;
      await area.set({ [ENTITLEMENT_KEY]: { ...entitlement, seen: now } satisfies EntitlementRecord });
    },
    erase: () => area.remove([LICENCE_KEY, ENTITLEMENT_KEY]),
  };
};
