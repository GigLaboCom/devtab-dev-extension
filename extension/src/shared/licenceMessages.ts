/**
 * The messages between our main page and the service worker about the licence and the plans list
 * (chrome.runtime.sendMessage from the page, runtime.onMessage in the worker; no permission). The worker answers with
 * `sendResponse` and `return true` — a promise returned from the listener is understood only from Chrome 148, and the
 * manifest's minimum is 116. No page listens for these. No chrome here: the pages and the worker import it.
 */

export type LicenceRequest =
  | { readonly type: 'licence/opened'; readonly v: 1 }
  | { readonly type: 'licence/activate'; readonly v: 1; readonly key: string }
  | { readonly type: 'licence/check'; readonly v: 1 }
  | { readonly type: 'licence/deactivate'; readonly v: 1 }
  | { readonly type: 'licence/remove'; readonly v: 1 }
  /** The plans list; the answer is PlansOutcome. */
  | { readonly type: 'plans/refresh'; readonly v: 1; readonly reason: 'person' | 'opened' };

export type LicenceError =
  | 'malformed-key'
  | 'key-unknown'
  | 'seat-limit'
  | 'key-blocked'
  | 'licence-inactive'
  | 'offline'
  | 'server'
  | 'rate-limited'
  | 'server-busy'
  | 'bad-answer'
  | 'busy'
  | 'unavailable'
  | 'refused'
  | 'version'
  /** Set by the page, never sent: the worker did not answer (stopped, updating, older). */
  | 'worker';

export type LicenceOutcome =
  { readonly ok: true } | { readonly ok: false; readonly error: LicenceError; readonly retryAt?: number };

export type LicenceReply = { readonly v: 1 } & LicenceOutcome;

/** `ok` — a fresh catalog is in the record `plans` now (fetched, or already there). */
export type PlansOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error:
        | 'offline'
        | 'server'
        | 'bad-answer'
        | 'unsupported'
        | 'rate-limited'
        | 'server-busy'
        | 'unavailable'
        | 'refused'
        | 'version'
        | 'worker';
      readonly retryAt?: number;
    };

export type PlansReply = { readonly v: 1 } & PlansOutcome;

const TYPES: readonly LicenceRequest['type'][] = [
  'licence/opened',
  'licence/activate',
  'licence/check',
  'licence/deactivate',
  'licence/remove',
  'plans/refresh',
];

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A message of one of these types, whatever its version: the worker answers it (with `version` if it is not v1). */
export const isLicenceMessage = (message: unknown): message is { readonly type: LicenceRequest['type'] } =>
  isObject(message) && TYPES.includes(message.type as LicenceRequest['type']);

/** A request of this shape with `v: 1`; anything else is not a licence request. */
export const isLicenceRequest = (message: unknown): message is LicenceRequest => {
  if (!isLicenceMessage(message)) return false;
  const fields = message as Record<string, unknown>;
  if (fields.v !== 1) return false;
  switch (fields.type) {
    case 'licence/activate':
      return typeof fields.key === 'string';
    case 'plans/refresh':
      return fields.reason === 'person' || fields.reason === 'opened';
    default:
      return true;
  }
};

/** A licence key once its spaces are dropped: 16–128 printable ASCII characters (the server's rule for the body). */
const KEY = /^[\x21-\x7e]{16,128}$/;

/** Trims, drops spaces inside; 16–128 printable ASCII characters, or `undefined`. */
export const normaliseKey = (raw: string): string | undefined => {
  if (typeof raw !== 'string') return undefined;
  const key = raw.replace(/\s+/g, '');
  return KEY.test(key) ? key : undefined;
};
