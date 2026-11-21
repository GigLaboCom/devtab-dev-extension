/** Web search: the field's last row searches the web with the user's own search engine (option; required `search`). */
import type { OptionPart } from '../part';

export const webSearchPart: OptionPart = {
  id: 'webSearch',
  kind: 'option',
  title: 'Web search',
  description:
    'When nothing here matches, Enter searches the web with your browser’s search engine. Off: the field only finds tools and sections.',
  defaultOn: true,
  permissions: [
    {
      name: 'search',
      optional: false,
      reason:
        "chrome.search.query, so a search from the start page goes to the user's own search engine (the Chrome Web Store's rule for a new tab page that searches); web search is on by default and the permission has no warning, so it is required",
      warning: null,
    },
  ],
  loadAt: 'start',
  provides: ['webSearch'],
  load: () => import('./webSearch.run'),
};
