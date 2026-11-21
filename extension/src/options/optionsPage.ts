/**
 * Seam `OptionsPage` — how the extension's options page is offered (docs/replaceable-behaviors.md): which address the
 * manifest's `options_ui` names and whether Chrome opens it in a tab of its own or in a dialog over chrome://extensions.
 * Either way it is the main page's settings route, so the settings are the same page whichever way they are reached —
 * the menu ("Settings" = runtime.openOptionsPage), "Extension options" on the extension's details page, the sidebar.
 * The composition root (index.ts) picks one; the manifest and the build check read it and never name one.
 *
 * The address always carries the options flag (shared/pages.ts): without it Chrome takes an open new tab of ours for the
 * open options page (docs/research/new-tab-probe.md §5). A page shown inside Chrome's small dialog adds the bare flag:
 * the settings without the app's frame, so nothing in the dialog leads away from them.
 *
 * Only relative imports of plain modules: manifest.config.ts and scripts/entry-pages.mjs read the definition outside
 * the app.
 */
import { APP_PAGE, OPTIONS_FLAG } from '../shared/pages';

export interface OptionsPage {
  /** For reports and tests. */
  id: string;
  /** The address, relative to the extension's root: the main page, the options flag, the settings route. */
  page: string;
  /** Chrome's `open_in_tab`: a tab of its own, or a dialog over chrome://extensions. */
  openInTab: boolean;
}

/** The settings route of the main page with these query flags. */
export const optionsAddress = (...flags: string[]): string =>
  `${APP_PAGE}?${[OPTIONS_FLAG, ...flags].join('&')}#/settings`;

/** The manifest's `options_ui`. */
export const optionsUiOf = (options: OptionsPage): { page: string; open_in_tab: boolean } => ({
  page: options.page,
  open_in_tab: options.openInTab,
});
