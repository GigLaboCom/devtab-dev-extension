/**
 * The service worker: the toolbar button's click, when the chosen button has no popup (src/toolbar/index.ts; with a
 * popup Chrome sends no click and nothing listens), and the licence (src/background/licence) with the plans list.
 * The network is only there, only to the licence configuration's origin (src/licence), only with a licence — or for the
 * plans list when the person asks; the store build's configuration has no origin yet, so nothing is ever sent. No DOM,
 * no Native Messaging (the Projects section shows its demo until the companion exists).
 */
import { startLicence } from './licence';
import { createDebug } from '@extension/logger';
import { licence } from '@src/licence';
import { pageOpener, toolbarButton } from '@src/toolbar';
import { listenForClicks } from '@src/toolbar/button';

const debug = createDebug('extension:background');

listenForClicks(
  { action: chrome.action, runtime: chrome.runtime, tabs: chrome.tabs, windows: chrome.windows, opener: pageOpener },
  toolbarButton,
  e => debug.warn('toolbar button', e),
);

// At the script's first run, so a message or an event that woke the worker reaches its listener.
startLicence({ chrome, config: licence });
