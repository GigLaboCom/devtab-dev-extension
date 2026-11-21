import pkg from './package.json';
import product from './product.json';
import { newTab } from './src/newTab';
import { overridesOf } from './src/newTab/override';
import { optionsPage } from './src/options';
import { optionsUiOf } from './src/options/optionsPage';
import { declaredPermissions } from './src/start/part';
import { partDefinitions } from './src/start/parts';
import { toolbarButton } from './src/toolbar';
import { actionOf } from './src/toolbar/button';
import { defineManifest } from '@crxjs/vite-plugin';
import { IS_DEV } from '@extension/env';

/**
 * Source of truth for the manifest — crxjs generates dist/manifest.json from this at build time (never hand-edit the
 * output). `scripts/validate-build.sh` holds the built manifest to exactly this surface, these permissions and this
 * CSP, so widening any of them is a two-place change (here + the validator's allowlists).
 *
 * Surface (D16): a module service worker and two extension pages built by vite.config.ts — the main page
 * `src/app/index.html`, which is the browser's New Tab page (`chrome_url_overrides`) when the build overrides it
 * (src/newTab/index.ts picks, seam `NewTabOverride`) and the options page (`options_ui`, its `?options#/settings` route,
 * in a tab or in Chrome's dialog as src/options/index.ts picks, seam `OptionsPage`), and the editor page
 * `src/viewer/index.html`, which the main page shows in an iframe (gpui-web owns its whole document). The toolbar button is the one chosen in
 * src/toolbar/index.ts (seam `ToolbarButton`): `action.default_popup` is its popup page when it has one (the menu —
 * built by vite.config.ts from the same choice), absent when a click goes to the service worker (a new tab). No side
 * panel, no content scripts, no host access, no web-accessible resources.
 */
/**
 * The narrowest policy that runs the wasm editor, checked by spikes/extension-e2e (RESULTS.md, «Минимальная CSP»):
 * - `default-src 'none'` closes everything not named (the MV3 default lets images from the network through);
 * - `script-src 'self' 'wasm-unsafe-eval'` — the extension's own modules and compiling its own wasm;
 * - `style-src 'self'` — stylesheets are files; pages have no inline <style>;
 * - `style-src-attr` + four hashes — gpui-pre-web 0.3.12 styles four invisible safe-area probes through the `style`
 *   attribute (viewport.rs:117); without them the console shows four errors per load;
 * - `img-src` / `font-src` / `connect-src 'self'` — own files only (the network stays closed);
 * - `object-src`, `base-uri`, `form-action 'none'`.
 * Two additions the spike named for the iframe it did not run (D3: the editor page inside the main page):
 * `frame-src 'self'` (the main page may frame its own pages, `default-src 'none'` would forbid it) and
 * `frame-ancestors 'self'` (instead of 'none': the editor page may be framed by the extension's own page only).
 * Dev builds only: `ws://localhost:*` in connect-src for the reload client of @extension/hmr — the validator refuses a
 * build that still has it.
 */
const SAFE_AREA_PROBE_HASHES = [
  "'sha256-f7k/zkE0F5tLJydN2gyZQ4AOODzhaXhLLMp11FaIh5k='",
  "'sha256-tUiyeK8Byfwc/oNxmI63Upo8EZy+Z4dQfKT3FPt4Qq4='",
  "'sha256-MnlFZhszarHl/R/A2EWXa+4M/Hs8g3j+PBNaIrrscZ8='",
  "'sha256-KVR0sJO9NDObqCUVDwC9L9fIyWNaULEbUQPAXIyMyx4='",
];

export const EXTENSION_PAGES_CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  `style-src-attr 'unsafe-hashes' ${SAFE_AREA_PROBE_HASHES.join(' ')}`,
  "img-src 'self'",
  "font-src 'self'",
  IS_DEV ? "connect-src 'self' ws://localhost:*" : "connect-src 'self'",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join('; ');

/** What the start page's parts need (src/start/parts): the parts' definitions are the one source. */
const START_PERMISSIONS = declaredPermissions(partDefinitions()) as {
  required: chrome.runtime.ManifestPermissions[];
  optional: chrome.runtime.ManifestPermissions[];
};

export default defineManifest({
  manifest_version: 3,
  // The product's name — one place: product.json.
  name: product.name,
  version: pkg.version,
  description: product.description,
  // WebGPU on macOS needs 113; runtime.getContexts (the toolbar finds an open tab of ours, src/toolbar/reuseTab.ts) needs
  // 116.
  minimum_chrome_version: '116',
  icons: {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png',
  },
  // Permissions. `storage` is the page's own: settings in chrome.storage.local — the theme choice (D9: the source of
  // truth, shared by the main page and the editor page through storage.onChanged), the start page's settings, the
  // user's start page shortcuts and the recent sections and tools, the keyboard shortcuts of our pages, which sidebar
  // groups are open, and the tool history's settings. No install warning.
  // The tool history (D17) is not chrome.storage: what the user types, pastes or opens in a tool, with its results, is
  // kept in the extension's IndexedDB while History is on — never in incognito, never sent, deleted by the user's
  // retention and filters; secrets only encrypted, with the optional master password (its unlocked key lives in
  // chrome.storage.session, memory only). IndexedDB and chrome.storage.session need no permission; `unlimitedStorage` is
  // not requested (the history keeps to its own budget, docs/research/history-storage-probe.md).
  // Everything else comes from the start page's parts (src/start/parts/*.ts, listed in src/start/parts/index.ts): each
  // part declares the permissions it needs, with the reason and Chrome's install warning word for word (read with
  // chrome.management.getPermissionWarningsByManifest, docs/research/new-tab-probe.md). A permission without a warning
  // that a default-on part needs is required (`search`, web search); one with a warning is optional, requested when the
  // user switches its part on and removed when no switched-on part needs it (`topSites`, `history`, `sessions` + `tabs`,
  // `favicon`). scripts/validate-build.sh reads the same definitions (scripts/start-parts.mjs) and refuses a manifest
  // with a permission no part declares or without one a part declares.
  // The New Tab override itself, when the build has it, shows "Replace the page you see when opening a new tab" at
  // install; a build without it shows no warning at all.
  // Not requested: nativeMessaging (live review is a stub until the companion exists; it will likely be OPTIONAL,
  // asked on entering live review — spikes/extension-e2e finding 8), clipboardRead / clipboardWrite (navigator.clipboard
  // writeText works on an extension page from a click; «Compare code»'s Paste reads after Chrome's own prompt, and the
  // keyboard's paste needs nothing — src/compare/clipboard.ts), host permissions, scripting, sidePanel, contextMenus.
  // `tabs` is only ever optional (tabs.create for the toolbar button needs none).
  permissions: ['storage', ...START_PERMISSIONS.required],
  optional_permissions: START_PERMISSIONS.optional,
  // D16, when the build overrides it (src/newTab/index.ts): every new tab is the main page (not in incognito — Chrome's
  // rule). A new tab opens it with no hash: the start page, or the last opened tool (public/route-boot.js). Without it
  // the key is absent and the start page opens by its address from the toolbar.
  ...overridesOf(newTab),
  // The extension's details page → "Extension options", runtime.openOptionsPage(): the main page's settings route
  // (src/options/index.ts: in a tab, or in Chrome's dialog without the app's frame). `?options` makes the address differ
  // from a new tab's: Chrome looks for an open options tab by the address without its fragment, and with
  // `index.html#/settings` it found an open new tab of ours and merely focused it — the start page, not the settings
  // (probe of D16). The page reads the route from the hash; crxjs drops the query and the hash to find the file.
  options_ui: optionsUiOf(optionsPage),
  content_security_policy: {
    extension_pages: EXTENSION_PAGES_CSP,
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  // The toolbar button (src/toolbar/index.ts picks it): with a popup page, `default_popup` names it and Chrome opens it
  // under the button (the menu: the start page, Tools, Compare code, the settings); without one, a click reaches the
  // service worker (action.onClicked), which opens the start page. The Chrome Web Store's FAQ lets a new-tab extension's button "open a new
  // tab page" but not "introduce any additional functionality or content" — whether the menu passes is open (D16).
  // chrome.action.setPopup could switch it at run time (a user setting) later; not built.
  action: actionOf(toolbarButton, {
    default_title: product.name,
    default_icon: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
    },
  }),
});
