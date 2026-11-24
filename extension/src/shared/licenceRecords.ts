/**
 * The record `entitlement` in chrome.storage.local: this installation's signed licence token as the server sent it,
 * and the clock mark. Only the service worker writes it (src/background/licence/store.ts, which alone also knows the
 * record `licence` with the installation's secret); the pages read it here — the source `licensed` checks the token's
 * signature itself and trusts nothing else in the record. Types and the pages' reader; no chrome.
 */
export const ENTITLEMENT_KEY = 'entitlement';

export interface EntitlementRecord {
  readonly v: 1;
  /** This installation's number (not secret), to tell a token of another installation (`foreign`). */
  readonly inst: string;
  /** The compact JWS as the server sent it. */
  readonly token: string;
  /** The clock mark: the latest instant the worker saw for this licence, ms. */
  readonly seen: number;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `none`: no record; `unreadable`: not this shape or another `v`. Unknown extra fields are ignored. */
export const readEntitlement = (raw: unknown): EntitlementRecord | 'none' | 'unreadable' => {
  if (raw === undefined || raw === null) return 'none';
  if (!isObject(raw) || raw.v !== 1) return 'unreadable';
  const { inst, token, seen } = raw;
  if (typeof inst !== 'string' || typeof token !== 'string') return 'unreadable';
  // A mark that is not a finite non-negative number counts as 0 (the table of states, row 24); the record stays readable.
  return { v: 1, inst, token, seen: typeof seen === 'number' && Number.isFinite(seen) && seen >= 0 ? seen : 0 };
};
