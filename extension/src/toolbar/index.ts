/**
 * The composition root of the toolbar button (seam `ToolbarButton`, ./button.ts): the one place that picks what the
 * button does. The manifest (`action.default_popup`), the build's pages (vite.config.ts), the service worker
 * (`action.onClicked`) and the build check (scripts/validate-build.sh through scripts/toolbar-button.mjs) all read this
 * choice. The other implementation is `newTabButton` (./newTabButton.ts: a click opens a new tab, no popup) — to switch,
 * export it here instead; nothing of the menu is then built.
 *
 * It also picks how the toolbar opens a page of ours at a route (seam `PageOpener`, ./opener.ts): `reuseTab` brings an open
 * tab of ours at that route to the front, as Chrome does with its own pages; the other implementation is `alwaysNewTab`
 * (./alwaysNewTab.ts: a new tab every time). The popup page and the service worker receive it as an argument.
 *
 * Only relative imports of plain modules: manifest.config.ts, vite.config.ts and the build check load this file
 * outside the app.
 */
export { menuButton as toolbarButton } from './menuButton';
export { reuseTab as pageOpener } from './reuseTab';
