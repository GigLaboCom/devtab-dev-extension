// Before the first paint, the same way theme-boot.js sets the theme: a plain synchronous script in <head> that reads
// the start page's settings from their copy in localStorage. A new tab opens the main page with no hash; when the user
// chose "the last opened tool or section" (Settings → General), the hash becomes that route here — replaceState keeps
// the address bar of a new tab empty — so the page renders the tool directly and the start page is never painted. It
// mirrors the NewTabPage seam of src/start/newTabPage.ts (src/start/routeBoot.test.ts holds the two together); the
// real settings come from chrome.storage a moment later (src/start/store.ts).
//
// Only a new tab, as it opens: never a page whose address names a route or carries a query (opened by its address:
// from the toolbar, a bookmark, the options page), never a reload or a step back or forward (the page stays what the
// user saw), and only in a build that is the New Tab page (the manifest's chrome_url_overrides, src/newTab).
(function () {
  try {
    // An address that asks for no frame (`?bare`: the options page in Chrome's dialog, src/options) is marked on <html>
    // before the page has any content: Chrome sizes that dialog to the page and opens it only when the size is not zero
    // at load, so @workspace/dna/ui.css gives the bare page's body a size of its own from the start.
    if (/[?&]bare(?:[=&]|$)/.test(window.location.search)) window.document.documentElement.dataset.frame = 'bare';
    var hash = window.location.hash;
    if ((hash && hash !== '#' && hash !== '#/') || window.location.search) return;
    var runtime = window.chrome && window.chrome.runtime;
    var manifest = runtime && runtime.getManifest && runtime.getManifest();
    if (!manifest || !manifest.chrome_url_overrides || !manifest.chrome_url_overrides.newtab) return;
    var navigation = window.performance.getEntriesByType('navigation')[0];
    if (navigation && navigation.type !== 'navigate') return;
    var cached = JSON.parse(window.localStorage.getItem('start-cache') || 'null');
    if (!cached || !cached.settings || cached.settings.newTab !== 'last' || !cached.recent) return;
    var last = cached.recent.last;
    if (typeof last === 'string' && /^#\/(?:compare|review|tools(?:\/[a-z0-9-]+)?)$/.test(last)) {
      window.history.replaceState(null, '', last);
    }
  } catch (ignored) {
    // no copy yet, or no localStorage: the start page
  }
})();
