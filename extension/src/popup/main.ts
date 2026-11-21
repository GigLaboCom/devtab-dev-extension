/**
 * The popup page under the toolbar button (`ToolbarButton` = the menu, src/toolbar/menuButton.ts): the menu's items
 * and the theme. Kept small on purpose — no React, nothing of the main page, no wasm: it opens on every click.
 */
import './popup.css';
import { menuItems } from './items';
import { mountMenu } from './menu';
import { createDebug } from '@extension/logger';
import { applyTheme, watchTheme } from '@src/shared/theme/store';
import { pageOpener } from '@src/toolbar';

const debug = createDebug('extension:popup');

mountMenu(
  {
    list: document.getElementById('menu')!,
    row: document.getElementById('menu-row') as HTMLTemplateElement,
  },
  menuItems,
  {
    api: { runtime: chrome.runtime, tabs: chrome.tabs, windows: chrome.windows, opener: pageOpener },
    close: () => window.close(),
    onError: error => debug.warn('open a menu item', error),
  },
);

// theme-boot.js painted the copy before the first paint; this follows the real choice and every change.
watchTheme({ area: chrome.storage.local, onChanged: chrome.storage.onChanged, win: window }, ({ theme }) =>
  applyTheme(document.documentElement, theme),
).catch(error => debug.warn('watch the theme', error));
