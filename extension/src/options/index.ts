/**
 * The composition root of the options page (seam `OptionsPage`, ./optionsPage.ts): the one place that says how the
 * extension's options page is offered. The manifest (`options_ui`) and the build check (scripts/validate-build.sh through
 * scripts/entry-pages.mjs) read this choice. The other implementation is `optionsEmbedded` (./optionsEmbedded.ts: a
 * dialog over chrome://extensions, the settings without the app's frame) — to switch, export it here instead.
 *
 * Only relative imports of plain modules: manifest.config.ts and the build check load this file outside the app.
 */
export { optionsInTab as optionsPage } from './optionsInTab';
