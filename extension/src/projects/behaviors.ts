/**
 * The composition root of the Projects section (AGENTS.md, "Replaceable Behavior"; the companion's specification
 * §8.1): the one place that names the implementation behind each of its seams. Parts of the page receive
 * `ProjectsBehaviors` and never import an implementation.
 *
 *   ProjectBackend   where the projects come from (./backend.ts), chosen by the connection's state (./connection.ts):
 *                    no permission or no companion → the demo's invented projects (./demo) under its «Example»
 *                    notice; the companion connected (or winning its port back) → the companion (./companion)
 *   Autosave         when an edit is written (./autosave.ts): a pause after the last change, at once on leaving
 */
import { AUTOSAVE_DELAY_MS } from './autosave';
import { companionBackend } from './companion/backend';
import { nativeLink } from './companion/link';
import { createConnection } from './connection';
import { demoBackend } from './demo/backend';
import { chromePermission } from './permission';
import type { ConnectionState, ProjectBackend, ProjectBackendFactory } from './backend';
import type { CompanionConnection } from './connection';

export interface ProjectsBehaviors {
  backend: ProjectBackendFactory;
  /** How long an edit waits for the typing to pause before it is written. */
  autosaveDelayMs: number;
}

/** The states in which the page shows the companion's projects; in every other one the demo's. */
const COMPANION_STATES: ReadonlySet<ConnectionState> = new Set([
  'ready',
  'ready-empty',
  'reconnecting',
  'not-initialised',
  'paused',
]);

/**
 * One backend for the page that follows the connection: the companion's while it is connected, the demo's otherwise.
 * Its connection members (status, the permission, «Check again») are always the companion connection's.
 */
export const chosenBackend = (connection: CompanionConnection, demo: ProjectBackend): ProjectBackend => {
  const companion = companionBackend(connection);
  const current = (): ProjectBackend => (COMPANION_STATES.has(connection.status().state) ? companion : demo);
  return {
    get name() {
      return current().name;
    },
    connect: () => companion.connect(),
    capabilities: () => current().capabilities(),
    call: (method, params, options) => current().call(method, params, options),
    subscribe: (project, onEvent) => current().subscribe(project, onEvent),
    onState: listener => companion.onState(listener),
    status: () => connection.status(),
    requestPermission: () => connection.grant(),
    retry: () => connection.retry(),
    dispose() {
      companion.dispose();
      demo.dispose();
    },
  };
};

const extensionVersion = (): string => {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return '0.0.0';
  }
};

const chosen: ProjectBackendFactory = Object.assign(
  () =>
    chosenBackend(
      createConnection({
        permission: chromePermission(),
        openLink: nativeLink,
        extension: extensionVersion(),
        reload: () => location.reload(),
      }),
      demoBackend(),
    ),
  { id: 'companion-or-demo' as const },
);

export const projectsBehaviors = (): ProjectsBehaviors => ({
  backend: chosen,
  autosaveDelayMs: AUTOSAVE_DELAY_MS,
});
