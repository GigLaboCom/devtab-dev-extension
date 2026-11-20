import pkg from './package.json';
import product from './product.json';
import { defineManifest } from '@crxjs/vite-plugin';
import { IS_DEV } from '@extension/env';

/**
 * Source of truth for the manifest — crxjs generates dist/manifest.json from this at build time (never hand-edit the
 * output). `scripts/validate-build.sh` holds the built manifest to exactly this surface, these permissions and this
 * CSP, so widening any of them is a two-place change (here + the validator's allowlists).
 *
 * Surface: a module service worker and two extension pages that are NOT manifest entries (vite.config.ts builds them
 * as inputs): the main page `src/app/index.html`, opened in a tab by the toolbar button, and the editor page
 * `src/viewer/index.html`, which the main page shows in an iframe (gpui-web owns its whole document). No popup, no
 * side panel, no content scripts, no host access, no web-accessible resources.
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

export default defineManifest({
  manifest_version: 3,
  // The working name (Q6, not approved) — one place: product.json.
  name: product.name,
  version: pkg.version,
  description: product.description,
  // runtime.getContexts (the toolbar button finds an open main page without the `tabs` permission) needs 116; WebGPU
  // on macOS needs 113.
  minimum_chrome_version: '116',
  icons: {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png',
  },
  // Permissions rationale (each one; the absences are listed in docs/extension-structure.md):
  //   storage — the theme choice in chrome.storage.local (D9: the source of truth, shared by the main page and the
  //             editor page through storage.onChanged). Settings only: what the user pastes or opens is never stored.
  // Not requested: nativeMessaging (live review is a stub until the companion exists; it will likely be OPTIONAL,
  // asked on entering live review — spikes/extension-e2e finding 8), tabs (tabs.create / tabs.update /
  // runtime.getContexts need none), clipboardRead / clipboardWrite (the user pastes; navigator.clipboard.writeText
  // works on an extension page from a click), host permissions, scripting, sidePanel, contextMenus.
  permissions: ['storage'],
  content_security_policy: {
    extension_pages: EXTENSION_PAGES_CSP,
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  // No default_popup: a click on the button reaches the service worker (action.onClicked), which opens the main page.
  action: {
    default_title: product.name,
    default_icon: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
    },
  },
});
