/**
 * The composition root of the start page's parts (seam `StartPart`, ../part.ts): the one list of what the start page
 * is made of, in its default order. The page, the settings, the permissions in the manifest and the build check all
 * walk this list. Each entry is a part's definition — data — whose `load()` brings its code (`<id>.run.ts`) only while
 * the part is on. Adding a part: its definition and its code next to these, and one entry here
 * (docs/replaceable-behaviors.md, «Как добавить часть стартовой страницы»).
 *
 * Only relative imports of plain modules: manifest.config.ts and scripts/start-parts.mjs load this file outside the
 * app to read the permissions the parts declare.
 */
import { fuzzyMatchingPart } from './fuzzyMatching';
import { mostVisitedPart } from './mostVisited';
import { recentlyClosedPart } from './recentlyClosed';
import { recentlyOpenedPart } from './recentlyOpened';
import { recognisePastePart } from './recognisePaste';
import { shortcutsPart } from './shortcuts';
import { siteIconsPart } from './siteIcons';
import { toolsPart } from './tools';
import { webSearchPart } from './webSearch';
import type { StartPart } from '../part';

export const START_PARTS: readonly StartPart[] = [
  webSearchPart,
  recognisePastePart,
  fuzzyMatchingPart,
  shortcutsPart,
  toolsPart,
  mostVisitedPart,
  recentlyOpenedPart,
  recentlyClosedPart,
  siteIconsPart,
];

/** The definitions (ids, titles, permissions): what manifest.config.ts and the build check read. */
export const partDefinitions = (): readonly StartPart[] => START_PARTS;
