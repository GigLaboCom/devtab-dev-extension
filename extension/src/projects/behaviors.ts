/**
 * The composition root of the Projects section (AGENTS.md, "Replaceable Behavior"; the companion's specification
 * §8.1): the one place that names the implementation behind each of its seams. Parts of the page receive
 * `ProjectsBehaviors` and never import an implementation.
 *
 *   ProjectBackend   where the projects come from (./backend.ts), chosen by the connection's state (./connection.ts):
 *                    no permission or no companion → the demo's invented projects (./demo) under its «Example»
 *                    notice; the companion connected (or winning its port back) → the companion (./companion)
 *   Autosave         when an edit is written (./autosave.ts): a pause after the last change, at once on leaving
 *   WorkspaceLayout  how an open project's parts are arranged (src/app/projects/workspaceLayout.ts, D35): the side
 *                    panel with Files and Commit, the editor, History and Find in files below (`SidePanels`)
 *   LayoutMemory     where that arrangement remembers its panels (./layoutMemory.ts): chrome.storage.local with a
 *                    localStorage copy for the first render
 *   ScratchStore     where the scratch files are kept (./scratch/store.ts, D34): chrome.storage.local (./scratch/
 *                    storage.ts), the page's memory where the page has no extension storage; no companion either way
 *   SideSaver        how a scratch is downloaded: «Compare code»'s seam (../compare/sideSaver.ts) — Save as through the
 *                    browser's file picker, a download where it has none
 */
import { AUTOSAVE_DELAY_MS } from './autosave';
import { companionBackend } from './companion/backend';
import { nativeLink } from './companion/link';
import { createConnection } from './connection';
import { demoBackend } from './demo/backend';
import { chromeLayoutMemory } from './layoutMemory';
import { chromePermission } from './permission';
import { chromeScratches } from './scratch/storage';
import { SidePanels } from '../app/projects/SidePanels';
import { chooseSaver } from '../compare/sideSaver';
import type { WorkspaceLayout } from '../app/projects/workspaceLayout';
import type { SideSaver } from '../compare/sideSaver';
import type { ConnectionState, ProjectBackend, ProjectBackendFactory } from './backend';
import type { CompanionConnection } from './connection';
import type { LayoutMemory } from './layoutMemory';
import type { ScratchStore } from './scratch/store';

export interface ProjectsBehaviors {
  backend: ProjectBackendFactory;
  /** How long an edit waits for the typing to pause before it is written. */
  autosaveDelayMs: number;
  /** How an open project's parts are arranged. */
  layout: WorkspaceLayout;
  /** Where the arrangement remembers its panels. */
  layoutMemory: LayoutMemory;
  /** Where the scratch files are kept (D34). */
  scratchStore: ScratchStore;
  /** How a scratch is downloaded. */
  scratchSaver: SideSaver;
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
  layout: SidePanels,
  layoutMemory: chromeLayoutMemory(),
  scratchStore: chromeScratches(),
  scratchSaver: chooseSaver(window),
});
