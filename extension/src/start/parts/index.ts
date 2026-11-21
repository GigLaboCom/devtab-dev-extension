/**
 * The composition root of the start page's parts (seam `StartPart`, ../part.ts): the one list of what the start page
 * is made of, in its default order. The page, the settings, the permissions in the manifest and the build check all
 * walk this list. Adding a part: its module next to these, and one entry here (docs/replaceable-behaviors.md, «Как
 * добавить часть стартовой страницы»).
 *
 * Only relative imports of plain modules: manifest.config.ts and scripts/start-parts.mjs load this file outside the
 * app, with no `deps`, to read the permissions the parts declare.
 */
import { mostVisitedPart } from './mostVisited';
import { recentlyClosedPart } from './recentlyClosed';
import { recentlyOpenedPart } from './recentlyOpened';
import { shortcutsPart } from './shortcuts';
import { siteIconsPart } from './siteIcons';
import { toolsPart } from './tools';
import { webSearchPart } from './webSearch';
import type { StartPart } from '../part';
import type { PartDeps } from './deps';

export const startParts = (deps: PartDeps): readonly StartPart[] => [
  webSearchPart(deps),
  shortcutsPart(deps),
  toolsPart(deps),
  mostVisitedPart(deps),
  recentlyOpenedPart(deps),
  recentlyClosedPart(deps),
  siteIconsPart(deps),
];

/** Definitions for reading only (ids, titles, permissions): nothing they use when they run is there. */
export const partDefinitions = (): readonly StartPart[] => startParts({} as PartDeps);
