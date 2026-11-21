/**
 * `OptionsPage`: in a tab of its own (D16) — the main page at `?options#/settings`, inside the app's frame: from the
 * settings the whole product is one click away in the sidebar, which matters most where our page is not the New Tab
 * page. Leaving the settings route drops the options flag (App.tsx), so Chrome's next "open the options page" opens the
 * settings again instead of focusing that tab on another route (probe, docs/research/new-tab-probe.md §11).
 */
import { optionsAddress } from './optionsPage';
import type { OptionsPage } from './optionsPage';

export const optionsInTab: OptionsPage = {
  id: 'tab',
  page: optionsAddress(),
  openInTab: true,
};
