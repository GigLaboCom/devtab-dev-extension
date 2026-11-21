/**
 * The service worker: the toolbar button's click, when the chosen button has no popup (src/toolbar/index.ts; with a
 * popup Chrome sends no click and nothing listens). Nothing else runs here yet — no network, no DOM, no Native
 * Messaging (live review is a stub until the companion exists).
 */
import { createDebug } from '@extension/logger';
import { pageOpener, toolbarButton } from '@src/toolbar';
import { listenForClicks } from '@src/toolbar/button';

const debug = createDebug('extension:background');

listenForClicks(
  { action: chrome.action, runtime: chrome.runtime, tabs: chrome.tabs, windows: chrome.windows, opener: pageOpener },
  toolbarButton,
  e => debug.warn('toolbar button', e),
);
