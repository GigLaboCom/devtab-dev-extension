/**
 * What the parts' code uses when it runs (`create(deps)` in each `<id>.run.ts`). A definition never has them: the
 * manifest and the build check read the definitions with none of them.
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
