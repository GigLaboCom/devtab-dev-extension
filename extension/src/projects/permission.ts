/**
 * The Projects section's permission (the companion's specification §8.3, Р3): `nativeMessaging`, optional — no warning
 * at install; asked for only when the person presses «Connect the companion», because Chrome takes a request only
 * inside a user gesture. The section declares it here the way the start page's parts declare theirs
 * (src/start/part.ts); the manifest and scripts/validate-build.sh read the declaration through
 * src/app/sectionPermissions.ts (scripts/permissions.mjs), never a list of their own.
 *
 * Only relative imports of plain modules: manifest.config.ts and scripts/permissions.mjs load this file outside the
 * app. Nothing touches `chrome` until a function runs.
 */
import type { PartPermission } from '../start/part';

export const PROJECTS_PERMISSION = {
  name: 'nativeMessaging',
  optional: true,
  reason:
    'Talks to the companion app the person installs on their Mac, which reads the projects they added (Projects section).',
  // Chrome's warning for it, word for word (spikes/extension-e2e finding 8: none while it stays optional).
  warning: 'Communicate with cooperating native applications',
} as const satisfies PartPermission;

/** Chrome's side of the permission, as the connection needs it; the tests give a fake. */
export interface PermissionGate {
  contains(): Promise<boolean>;
  /** Shows Chrome's prompt; call it straight from a click handler, before any `await`. */
  request(): Promise<boolean>;
  /** Whether this page can open a port now (`connectNative` appears once the permission is granted). */
  usable(): boolean;
  onAdded(listener: () => void): () => void;
  onRemoved(listener: () => void): () => void;
}

const wanted = { permissions: [PROJECTS_PERMISSION.name] };
const names = (p: chrome.permissions.Permissions): readonly string[] => p.permissions ?? [];
/** The two events as Chrome has them (the typings lack `removeListener`). */
type PermissionEvent = {
  addListener(listener: (p: chrome.permissions.Permissions) => void): void;
  removeListener(listener: (p: chrome.permissions.Permissions) => void): void;
};
const listen = (event: unknown, listener: () => void): (() => void) => {
  const target = event as PermissionEvent;
  const on = (p: chrome.permissions.Permissions): void => {
    if (names(p).includes(PROJECTS_PERMISSION.name)) listener();
  };
  target.addListener(on);
  return () => target.removeListener(on);
};

export const chromePermission = (): PermissionGate => ({
  contains: () => chrome.permissions.contains(wanted).catch(() => false),
  request: () => chrome.permissions.request(wanted).catch(() => false),
  usable: () => typeof chrome.runtime.connectNative === 'function',
  onAdded: listener => listen(chrome.permissions.onAdded, listener),
  onRemoved: listener => listen(chrome.permissions.onRemoved, listener),
});
