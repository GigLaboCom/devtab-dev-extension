/**
 * What the parts use when they run. A definition never touches these when it is created — manifest.config.ts and the
 * build check create the definitions with none of them, only to read the permissions they declare.
 */
import type { StartArea } from '../store';

/** One of our places (src/shared/destinations.ts), as much of it as a part needs. */
export interface Place {
  id: string;
  title: string;
  hash: string;
}

export interface PartDeps {
  chrome: typeof chrome;
  area: StartArea;
  destinations: readonly Place[];
  /** When a part that reads the browser may start (tests pass an immediate one). */
  afterPaint?: () => Promise<void>;
}
