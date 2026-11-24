/**
 * Who may ask the service worker about the licence: our main page only — the same extension, and the page's address
 * without its query and fragment is src/app/index.html (in a tab, as the new tab, in Chrome's options dialog: `?options`,
 * `?bare`). Not the editor page, not the toolbar's menu, not a website, not another extension (runtime.onMessage never
 * hears other extensions — that would be onMessageExternal, which nothing listens to; the id check is for the future).
 */

/** Our main page only: same extension id, and the URL (query and hash aside) is src/app/index.html. */
export const trustedSender = (
  sender: chrome.runtime.MessageSender,
  runtime: Pick<typeof chrome.runtime, 'id' | 'getURL'>,
): boolean => {
  if (!sender || sender.id !== runtime.id || typeof sender.url !== 'string') return false;
  return sender.url.split(/[?#]/, 1)[0] === runtime.getURL('src/app/index.html');
};
