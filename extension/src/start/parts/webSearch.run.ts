/** Web search's code: the field's last row hands the text to chrome.search.query (WebSearch, ../webSearch.ts). */
import { chromeWebSearch } from '../webSearch';
import type { OptionCode } from '../part';
import type { PartDeps } from './deps';

export const create = (deps: PartDeps): OptionCode => ({ context: { webSearch: chromeWebSearch(deps.chrome.search) } });
