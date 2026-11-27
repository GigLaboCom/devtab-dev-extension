/** The demo implementation of seam `ProjectBackend`: a new set of invented projects in memory for each page. */
import { demoBackend } from './backend';
import type { ProjectBackendFactory } from '../backend';

export const demo: ProjectBackendFactory = Object.assign(() => demoBackend(), { id: 'demo' as const });
