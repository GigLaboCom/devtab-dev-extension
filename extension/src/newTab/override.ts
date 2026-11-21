/**
 * Seam `NewTabOverride` — whether the build is the browser's New Tab page (docs/replaceable-behaviors.md). A build
 * either overrides it (`chrome_url_overrides.newtab`: every new tab is the main page, the install shows "Replace the page
 * you see when opening a new tab") or leaves the browser its own, and our page is reached by its address. The
 * composition root (index.ts) picks one; the manifest, the settings, the toolbar (the menu's first item, the button
 * without a menu) and the build check read the chosen definition through the helpers below and never name one.
 *
 * Even a build that overrides it is not always the New Tab page: in an incognito window Chrome applies no override, and
 * an extension installed later takes it over — nothing the extension can call says so before a new tab opens (probe,
 * docs/research/new-tab-probe.md §11). So the toolbar always offers the pages of ours by their address too.
 *
 * Only relative imports of plain modules here and in the implementations: manifest.config.ts and
 * scripts/entry-pages.mjs read the definition outside the app. Creating one touches no `chrome`.
 */
import type { Target } from '../toolbar/target';

/** How the toolbar reaches the start page: the menu's first item, and what the button without a menu does. */
export interface StartEntry {
  /** The menu item's id. */
  id: string;
  /** What the menu shows. */
  title: string;
  opens: Target;
}

interface OverrideBase {
  /** For reports and tests. */
  id: string;
  start: StartEntry;
}

/** The build is the New Tab page: Chrome opens this page (relative to the extension's root) for every new tab. */
export interface OverridingNewTab extends OverrideBase {
  newtab: string;
}

/** The browser keeps its own New Tab page. */
export interface KeepingNewTab extends OverrideBase {
  newtab?: never;
}

export type NewTabOverride = OverridingNewTab | KeepingNewTab;

/** The manifest's `chrome_url_overrides`, when the build has one. */
export const overridesOf = (override: NewTabOverride): { chrome_url_overrides?: { newtab: string } } =>
  override.newtab ? { chrome_url_overrides: { newtab: override.newtab } } : {};

/**
 * Does a new tab open our page? Then "what a new tab opens" (Settings → General, seam NewTabPage) means something, and a
 * page with no route in its address is a new tab.
 */
export const isNewTabPage = (override: NewTabOverride): override is OverridingNewTab => !!override.newtab;
