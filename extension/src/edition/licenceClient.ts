/**
 * The page's side of the licence messages (src/shared/licenceMessages.ts): what Settings → Pro does — activate, check
 * now, deactivate, remove — sent to the service worker, which alone talks to the licence server and writes the
 * records. A worker that does not answer (stopped mid-request, updating, an older version) or answers something of
 * another shape is `worker`; nothing here ever rejects.
 */
import type { LicenceError, LicenceOutcome, LicenceReply, LicenceRequest } from '@src/shared/licenceMessages';

export interface LicenceControls {
  /** The licence server's host for the texts ("licence.example.invalid"); `undefined` — cannot activate here. */
  readonly host: string | undefined;
  activate(key: string): Promise<LicenceOutcome>;
  check(): Promise<LicenceOutcome>;
  deactivate(): Promise<LicenceOutcome>;
  remove(): Promise<LicenceOutcome>;
}

const ERRORS: readonly LicenceError[] = [
  'malformed-key',
  'key-unknown',
  'seat-limit',
  'key-blocked',
  'licence-inactive',
  'offline',
  'server',
  'rate-limited',
  'server-busy',
  'bad-answer',
  'busy',
  'unavailable',
  'refused',
  'version',
];

const WORKER: LicenceOutcome = { ok: false, error: 'worker' };

/** A reply of the worker's shape as an outcome; anything else is `worker`. */
const outcomeOf = (reply: unknown): LicenceOutcome => {
  if (typeof reply !== 'object' || reply === null) return WORKER;
  const { v, ok, error, retryAt } = reply as Partial<Record<keyof LicenceReply | 'error' | 'retryAt', unknown>>;
  if (v !== 1) return WORKER;
  if (ok === true) return { ok: true };
  if (ok !== false || !ERRORS.includes(error as LicenceError)) return WORKER;
  return {
    ok: false,
    error: error as LicenceError,
    ...(typeof retryAt === 'number' && Number.isFinite(retryAt) ? { retryAt } : {}),
  };
};

/** Sends the licence messages; a rejection or an answer of another shape is `{ ok: false, error: 'worker' }`. Never rejects. */
export const licenceClient = (
  runtime: Pick<typeof chrome.runtime, 'sendMessage'>,
  host: string | undefined,
): LicenceControls => {
  const send = async (request: LicenceRequest): Promise<LicenceOutcome> => {
    try {
      return outcomeOf(await runtime.sendMessage(request));
    } catch {
      return WORKER;
    }
  };
  return {
    host,
    activate: key => send({ type: 'licence/activate', v: 1, key }),
    check: () => send({ type: 'licence/check', v: 1 }),
    deactivate: () => send({ type: 'licence/deactivate', v: 1 }),
    remove: () => send({ type: 'licence/remove', v: 1 }),
  };
};
