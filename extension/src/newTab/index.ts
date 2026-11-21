/**
 * The composition root of the New Tab override (seam `NewTabOverride`, ./override.ts): the one place that says whether
 * the build is the browser's New Tab page. The manifest (`chrome_url_overrides`), the settings ("A new tab opens"), the
 * toolbar (the menu's first item, the button without a menu) and the build check (scripts/validate-build.sh through
 * scripts/entry-pages.mjs) all read this choice. The other implementation is `browserNewTab` (./browserNewTab.ts: the
 * browser keeps its New Tab page, the start page opens by its address) — to switch, export it here instead.
 *
 * Only relative imports of plain modules: manifest.config.ts and the build check load this file outside the app.
 */
export { ownNewTab as newTab } from './ownNewTab';
