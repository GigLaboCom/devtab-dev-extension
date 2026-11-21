/**
 * Seam `WebSearch` — where a web search from the start page goes (docs/replaceable-behaviors.md). The default hands
 * the text to Chrome's search API, so the search follows the user's own search provider (the Chrome Web Store asks
 * new-tab extensions to search this way), and the results replace the start page in the same tab. Nothing is sent
 * anywhere before the user presses Enter on the web-search row: the field fetches no suggestions.
 */
export interface WebSearch {
  search(text: string): Promise<void>;
}

/** chrome.search.query in the current tab (permission `search`, no install warning). */
export const chromeWebSearch = (search: Pick<typeof chrome.search, 'query'>): WebSearch => ({
  search: text => search.query({ text, disposition: 'CURRENT_TAB' }),
});
