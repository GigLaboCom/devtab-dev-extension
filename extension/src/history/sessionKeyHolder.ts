/**
 * Where the extension keeps an unlocked master password's data keys (seam `KeyHolder`): chrome.storage.session — held in
 * memory by the browser, never written to disk, emptied when the browser closes, and shared by the extension's pages and
 * service worker (probe, docs/research/history-storage-probe.md), so one unlock serves every tab. Its values must be
 * JSON: a CryptoKey or a Uint8Array put there comes back as `{}` (probe), so the raw 32 bytes go as Base64 and each page
 * imports them as non-extractable keys (cipher.ts).
 *
 * Idle lock: every page that uses the history marks activity (at most once per ACTIVITY_MS) and checks the deadline
 * every CHECK_MS; a page that finds the keys older than the idle time removes them, which locks every page. A page
 * opened after the deadline finds them expired and removes them before using them.
 */
import { fromBase64, toBase64 } from '@workspace/tools-shared/history';
import type { KeyHolder } from '@workspace/tools-shared/history';

export const SESSION_KEYS_KEY = 'historyKeys';
/** Last activity, a key of its own: marking activity never rewrites the keys (a lock in another tab stays a lock). */
export const SESSION_ACTIVITY_KEY = 'historyActivity';
const ACTIVITY_MS = 30_000;
const CHECK_MS = 30_000;

interface Held {
  keys: Record<string, string>;
}

export type SessionArea = Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'>;
export type SessionChanged = Pick<chrome.storage.StorageChangedEvent, 'addListener' | 'removeListener'>;

export interface SessionKeyHolder extends KeyHolder {
  /** The user did something on a page that uses the history. */
  touch(): void;
  /** Stops the page's idle check. */
  dispose(): void;
}

export const sessionKeyHolder = (deps: {
  area: SessionArea;
  onChanged: SessionChanged;
  idleMinutes: () => number;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}): SessionKeyHolder => {
  const now = deps.now ?? Date.now;
  const listeners = new Set<() => void>();
  let lastTouch = 0;

  const read = async (): Promise<{ held?: Held; lastActive: number }> => {
    const items = await deps.area.get([SESSION_KEYS_KEY, SESSION_ACTIVITY_KEY]);
    return { held: items[SESSION_KEYS_KEY] as Held | undefined, lastActive: Number(items[SESSION_ACTIVITY_KEY] ?? 0) };
  };
  const expired = (lastActive: number) => now() - lastActive > deps.idleMinutes() * 60_000;

  const clear = () => deps.area.remove([SESSION_KEYS_KEY, SESSION_ACTIVITY_KEY]);
  const check = async () => {
    const { held, lastActive } = await read();
    if (held && expired(lastActive)) await clear();
  };
  const timer = (deps.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms)))(() => void check(), CHECK_MS);

  deps.onChanged.addListener((changes, areaName) => {
    if (areaName === 'session' && SESSION_KEYS_KEY in changes) listeners.forEach(l => l());
  });

  return {
    async get() {
      const { held, lastActive } = await read();
      if (!held) return new Map();
      if (expired(lastActive)) {
        await clear();
        return new Map();
      }
      return new Map(Object.entries(held.keys).map(([kid, b64]) => [kid, fromBase64(b64)]));
    },
    async set(keys) {
      lastTouch = now();
      await deps.area.set({
        [SESSION_KEYS_KEY]: { keys: Object.fromEntries([...keys].map(([kid, raw]) => [kid, toBase64(raw)])) },
        [SESSION_ACTIVITY_KEY]: lastTouch,
      });
    },
    clear,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    touch() {
      const t = now();
      if (t - lastTouch < ACTIVITY_MS) return;
      lastTouch = t;
      void read().then(({ held, lastActive }) => {
        if (held && !expired(lastActive)) return deps.area.set({ [SESSION_ACTIVITY_KEY]: t });
      });
    },
    dispose() {
      (deps.clearInterval ?? (h => globalThis.clearInterval(h as ReturnType<typeof setInterval>)))(timer);
    },
  };
};
