// Before the first paint (D9, docs/theming.md §5.3): a plain synchronous script in <head> — inline scripts are not
// allowed on extension pages — that sets the theme from the copy in localStorage, so a page never flashes another
// theme. It mirrors resolveTheme of @extension/theme (src/shared/theme/themeBoot.test.ts holds the two together); the
// real choice comes from chrome.storage a moment later (src/shared/theme/store.ts).
(function () {
  var pref = { mode: 'system', light: 'default-light', dark: 'default-dark' };
  try {
    var cached = JSON.parse(window.localStorage.getItem('theme-cache') || 'null');
    if (cached && typeof cached === 'object') {
      if (cached.mode === 'light' || cached.mode === 'dark') pref.mode = cached.mode;
      if (typeof cached.light === 'string') pref.light = cached.light;
      if (typeof cached.dark === 'string') pref.dark = cached.dark;
    }
  } catch (ignored) {
    // no copy yet, or no localStorage: the default pair
  }
  var systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  var dark = pref.mode === 'dark' || (pref.mode === 'system' && systemDark);
  var root = document.documentElement;
  root.setAttribute('data-theme', dark ? pref.dark : pref.light);
  root.setAttribute('data-mode', dark ? 'dark' : 'light');
})();
