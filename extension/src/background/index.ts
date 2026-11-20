/**
 * The service worker: the toolbar button opens the main page in a tab (or brings an open one forward). Nothing else
 * runs here yet — no network, no DOM, no Native Messaging (live review is a stub until the companion exists).
 */
import { createDebug } from '@extension/logger';
import { openAppPage } from '@src/shared/pages';

const debug = createDebug('extension:background');

chrome.action.onClicked.addListener(() => {
  openAppPage(chrome).catch(e => debug.warn('open the main page', e));
});
