/**
 * The composition root of the Projects section (AGENTS.md, "Replaceable Behavior"; the companion's specification
 * §8.1): the one place that names the implementation behind each of its seams. Parts of the page receive
 * `ProjectsBehaviors` and never import an implementation.
 *
 *   ProjectBackend   where the projects come from (./backend.ts): today the demo's invented projects in memory
 *                    (./demo) — the only implementation until the companion exists. The companion's comes with it,
 *                    and this root then chooses by state: no companion → the demo with its notice
 *   Autosave         when an edit is written (./autosave.ts): a pause after the last change, at once on leaving
 */
import { AUTOSAVE_DELAY_MS } from './autosave';
import { demo } from './demo';
import type { ProjectBackendFactory } from './backend';

export interface ProjectsBehaviors {
  backend: ProjectBackendFactory;
  /** How long an edit waits for the typing to pause before it is written. */
  autosaveDelayMs: number;
}

export const projectsBehaviors = (): ProjectsBehaviors => ({
  backend: demo,
  autosaveDelayMs: AUTOSAVE_DELAY_MS,
});
