/**
 * The Native Messaging port to the companion's relay (`chrome.runtime.connectNative`) and the frames that cross it
 * (the companion's specification §4.3–§4.4; the frames' schema is ../api/companion-api-v1/envelope.schema.json).
 *
 * Chrome frames each message itself (a length and UTF-8 JSON); what arrives here is a parsed value, and nothing that
 * arrives is trusted: `serverFrame` takes a frame only in the envelope's shape, anything else is dropped and counted by
 * the client — never thrown, never logged with its content. Why the port closed comes from `chrome.runtime.lastError`,
 * read in `onDisconnect` (an unread one would be a console error).
 */
import { CONTRACT_ERRORS } from '../api/types.gen';
import type { ClientFrame, ErrorCode, ServerFrame } from '../api/types.gen';

/** The host's name: the companion registers its relay under it (`devtab install-host`). */
export const HOST_NAME = 'dev.devtab.companion';

/** Why the port closed, as far as Chrome tells. */
export type LinkClosed =
  /** No manifest for the host, or its program is missing ("Specified native messaging host not found."). */
  | { kind: 'not-found'; message: string }
  /** The host's manifest does not allow this extension ("Access … is forbidden."). */
  | { kind: 'forbidden'; message: string }
  /** The relay exited ("Native host has exited.") — after its last frame, if it sent one. */
  | { kind: 'exited'; message: string }
  /** `connectNative` is not there: the permission is not granted on this page (yet). */
  | { kind: 'unavailable'; message: string }
  | { kind: 'closed'; message: string };

export interface LinkEvents {
  /** One message from the relay, as Chrome parsed it (not checked yet). */
  onMessage(message: unknown): void;
  /** The port closed from the other side; not called after `close()`. */
  onClose(reason: LinkClosed): void;
}

export interface Link {
  send(frame: ClientFrame): void;
  /** Closes the port (the relay exits when its input ends). */
  close(): void;
}

/** Opens a port; the composition root names Chrome's, the tests a fake. */
export type OpenLink = (events: LinkEvents) => Link;

const classify = (message: string): LinkClosed => {
  if (/not found/i.test(message)) return { kind: 'not-found', message };
  if (/forbidden/i.test(message)) return { kind: 'forbidden', message };
  if (/exited/i.test(message)) return { kind: 'exited', message };
  if (/not available/i.test(message)) return { kind: 'unavailable', message };
  return { kind: 'closed', message };
};

/** Whether this page may open a port now (Chrome adds `connectNative` once the permission is granted). */
export const canConnectNative = (): boolean =>
  typeof chrome !== 'undefined' && typeof chrome.runtime?.connectNative === 'function';

/** Chrome's port to the relay. */
export const nativeLink: OpenLink = events => {
  let open = true;
  const closeLater = (reason: LinkClosed): Link => {
    queueMicrotask(() => open && ((open = false), events.onClose(reason)));
    return { send: () => undefined, close: () => void (open = false) };
  };
  if (!canConnectNative()) return closeLater({ kind: 'unavailable', message: 'connectNative is not available' });
  let port: chrome.runtime.Port;
  try {
    port = chrome.runtime.connectNative(HOST_NAME);
  } catch (error) {
    return closeLater(classify(error instanceof Error ? error.message : String(error)));
  }
  port.onMessage.addListener((message: unknown) => {
    if (open) events.onMessage(message);
  });
  port.onDisconnect.addListener(() => {
    const message = chrome.runtime.lastError?.message ?? '';
    if (!open) return;
    open = false;
    events.onClose(classify(message));
  });
  return {
    send(frame) {
      if (!open) return;
      try {
        port.postMessage(frame);
      } catch {
        // A port that just closed: its onDisconnect says why.
      }
    },
    close() {
      if (!open) return;
      open = false;
      port.disconnect();
    },
  };
};

// ---- the frames from the companion ----------------------------------------------------------------------------------

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const isIdOrNull = (value: unknown): boolean => value === undefined || value === null || isCount(value);
const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string');

/** A code the contract names; another one (a newer companion's) is `internal`, its message kept. */
export const errorCode = (code: unknown): ErrorCode =>
  typeof code === 'string' && Object.hasOwn(CONTRACT_ERRORS, code) ? (code as ErrorCode) : 'internal';

/** The frame, if the message is one in the envelope's shape; null otherwise. */
export const serverFrame = (message: unknown): ServerFrame | null => {
  if (!isObject(message)) return null;
  switch (message.type) {
    case 'welcome': {
      const { companion, api, server, platform, methods, limits } = message;
      return typeof companion === 'string' &&
        isCount(api) &&
        typeof server === 'string' &&
        typeof platform === 'string' &&
        isStrings(methods) &&
        isObject(limits) &&
        isCount(limits.maxRequestBytes) &&
        isCount(limits.maxTextBytes)
        ? (message as ServerFrame)
        : null;
    }
    case 'result':
      return isCount(message.id) && 'result' in message ? (message as ServerFrame) : null;
    case 'error': {
      const { error } = message;
      if (!isIdOrNull(message.id) || !isObject(error) || typeof error.message !== 'string') return null;
      if (typeof error.code !== 'string' || (error.data !== undefined && error.data !== null && !isObject(error.data)))
        return null;
      return { ...message, error: { ...error, code: errorCode(error.code) } } as ServerFrame;
    }
    case 'stream':
      return isCount(message.id) && isCount(message.seq) && 'data' in message ? (message as ServerFrame) : null;
    case 'event':
      return typeof message.name === 'string' &&
        (message.project === undefined || message.project === null || typeof message.project === 'string') &&
        'data' in message
        ? (message as ServerFrame)
        : null;
    case 'chunk':
      return isIdOrNull(message.id) &&
        isCount(message.seq) &&
        typeof message.last === 'boolean' &&
        typeof message.data === 'string'
        ? (message as ServerFrame)
        : null;
    default:
      return null;
  }
};
