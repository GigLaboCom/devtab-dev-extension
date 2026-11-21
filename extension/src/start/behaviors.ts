/**
 * The composition root of the start page (AGENTS.md, "Replaceable Behavior"): the one place that picks the
 * implementation behind each of its seams. Components receive `StartBehaviors` and never import an implementation.
 *
 *   NewTabPage   what a new tab shows — chosen by the user (Settings → General): the start page or the last tool
 *   StartPart    what the start page is made of — the parts and their default order (parts/index.ts); each part's
 *                code (`code`, loaded while it is on) brings a row's TileSource, an option's part of the page's context
 *                (WebSearch, SiteIcons, PlaceMatcher, PasteRecogniser)
 *
 * and passes on the build's choice of NewTabOverride (src/newTab/index.ts): whether a new tab is ours at all, which
 * decides whether NewTabPage means anything.
 */
import { lastOpened, startPage } from './newTabPage';
import { partCode } from './part';
import { START_PARTS } from './parts';
import { newTab } from '@src/newTab';
import { DESTINATIONS } from '@src/shared/destinations';
import type { NewTabPage } from './newTabPage';
import type { PartCode, StartPart } from './part';
import type { NewTabChoice } from './settings';
import type { NewTabOverride } from '@src/newTab/override';

export interface StartBehaviors {
  newTabPage: Record<NewTabChoice, NewTabPage>;
  parts: readonly StartPart[];
  /** The parts' code on this page, with what it runs on. */
  code: PartCode;
  newTab: NewTabOverride;
}

export const NEW_TAB_PAGES: Record<NewTabChoice, NewTabPage> = { start: startPage, last: lastOpened };

export const startBehaviors = (api: typeof chrome): StartBehaviors => ({
  newTabPage: NEW_TAB_PAGES,
  parts: START_PARTS,
  code: partCode({ chrome: api, area: api.storage.local, destinations: DESTINATIONS }),
  newTab,
});
