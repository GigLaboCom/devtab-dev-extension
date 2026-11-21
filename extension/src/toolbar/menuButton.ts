/**
 * `ToolbarButton`: a small menu under the button — the popup page src/popup/index.html, which lists the menu's items
 * (src/popup/items.ts). The service worker hears no click.
 */
import type { PopupButton } from './button';

export const menuButton: PopupButton = {
  id: 'menu',
  popup: 'src/popup/index.html',
};
