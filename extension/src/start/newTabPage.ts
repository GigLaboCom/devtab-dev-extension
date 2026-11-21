/**
 * Seam `NewTabPage` — what a new tab shows (docs/replaceable-behaviors.md). A new tab opens the app page with no hash;
 * the implementation names the route it starts on. The user picks one in Settings → General (`NewTabChoice`), and
 * behaviors.ts maps the choice to the implementation.
 *
 * Synchronous on purpose: public/route-boot.js applies the same rule before the first paint, from the localStorage copy
 * of the settings (src/start/routeBoot.test.ts holds the two together). An implementation that needs to wait would
 * paint the start page first — the flash this seam exists to avoid.
 */
import type { Recent } from './settings';

export const START_HASH = '#/start';

export interface NewTabPage {
  /** The route hash a new tab starts on. */
  initialHash(recent: Recent): string;
}

/** The start page: the field and the tiles. */
export const startPage: NewTabPage = { initialHash: () => START_HASH };

/** The section or tool opened last; the start page when there is none yet. */
export const lastOpened: NewTabPage = { initialHash: recent => recent.last ?? START_HASH };
