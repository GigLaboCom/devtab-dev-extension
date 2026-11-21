/**
 * Seam `ToolbarButton` — what the extension's button on Chrome's toolbar does (docs/replaceable-behaviors.md). A button
 * either has a popup page, which Chrome opens under it, or does something itself when clicked; Chrome sends no click to
 * the service worker while a popup is set, so a button is exactly one of the two. The composition root (index.ts) picks
 * the button; the manifest, the build's pages, the service worker and the build check read the chosen definition
 * through the helpers below and never name one.
 *
 * Only relative imports of plain modules here and in the implementations: manifest.config.ts, vite.config.ts and
 * scripts/toolbar-button.mjs load the definition outside the app. Creating a definition touches no `chrome`.
 */

import type { FromTab } from '../shared/pages';
import type { OpenDeps } from './target';

/** What a click may use: the APIs the service worker hands it (none needs a permission), and the page opener. */
export type ClickApi = OpenDeps;

/** The tab the button was clicked in, as much of it as Chrome gives without the `tabs` permission. */
export type ClickedTab = FromTab;

interface ButtonBase {
  /** For reports and tests. */
  id: string;
}

/** A button with a popup page: Chrome opens the page under the button; the service worker hears nothing. */
export interface PopupButton extends ButtonBase {
  /** The page, relative to the extension's root (`src/<page>/index.html`): the manifest's `action.default_popup`. */
  popup: string;
  click?: never;
}

/** A button without a popup: a click reaches the service worker (`action.onClicked`), which runs this. */
export interface ClickButton extends ButtonBase {
  popup?: never;
  click(api: ClickApi, tab?: ClickedTab): Promise<void>;
}

export type ToolbarButton = PopupButton | ClickButton;

/** The manifest's `action` for the button: the given fields, and `default_popup` when the button has a page. */
export const actionOf = <A extends object>(button: ToolbarButton, action: A): A & { default_popup?: string } =>
  button.popup ? { ...action, default_popup: button.popup } : action;

/** The extension pages the button needs built, as Vite inputs (name → path relative to the extension's root). */
export const pagesOf = (button: ToolbarButton): Record<string, string> => (button.popup ? { popup: button.popup } : {});

/**
 * The service worker's part: listens for clicks when the button has no popup (with one, Chrome would never send them).
 * `onError` gets what a click throws.
 */
export const listenForClicks = (
  api: ClickApi & { action: { onClicked: Pick<typeof chrome.action.onClicked, 'addListener'> } },
  button: ToolbarButton,
  onError: (error: unknown) => void,
): void => {
  const { click } = button;
  if (!click) return;
  api.action.onClicked.addListener(tab => {
    click(api, tab).catch(onError);
  });
};
