/** Site icons' code: Chrome's favicon cache for each site on the tiles (SiteIcons, ../siteIcons.ts). */
import { chromeFavicons } from '../siteIcons';
import type { OptionCode } from '../part';
import type { PartDeps } from './deps';

export const create = (deps: PartDeps): OptionCode => ({
  context: { siteIcons: chromeFavicons(path => deps.chrome.runtime.getURL(path)) },
});
