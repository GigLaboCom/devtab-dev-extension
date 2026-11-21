/**
 * `OptionsPage`: in Chrome's dialog over chrome://extensions (`open_in_tab: false`) — the settings alone, without the
 * app's frame (the bare flag): the sidebar's links would open the rest of the product inside the dialog. Chrome sizes
 * the dialog to the page; runtime.openOptionsPage() (the menu's "Settings") opens chrome://extensions with the dialog.
 */
import { optionsAddress } from './optionsPage';
import { BARE_FLAG } from '../shared/pages';
import type { OptionsPage } from './optionsPage';

export const optionsEmbedded: OptionsPage = {
  id: 'embedded',
  page: optionsAddress(BARE_FLAG),
  openInTab: false,
};
