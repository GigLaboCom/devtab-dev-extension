/**
 * The editor page (in the main page's iframe): runs the wasm editor, hands it the two texts the main page sends (the
 * module compares them) and follows the theme through chrome.storage itself. Only messages from the extension's own
 * parent page are taken; every answer carries the id of the request it belongs to.
 */
import './viewer.css';
import { createDebug } from '@extension/logger';
import { startReview } from '@extension/review-wasm/host';
import { loadThemeSource } from '@extension/theme/sources';
import { applyTheme, watchTheme } from '@src/shared/theme/store';
import { isToViewer } from '@src/shared/viewerProtocol';
import type { CompareRequest, ReviewController, ThemeArgs } from '@extension/review-wasm';
import type { ResolvedTheme } from '@extension/theme';
import type { FromViewer } from '@src/shared/viewerProtocol';

const debug = createDebug('extension:viewer');

const toParent = (message: FromViewer): void => {
  if (window.parent !== window) window.parent.postMessage(message, location.origin);
};

// gpui-kit's built-in defaults need no theme file; any other theme goes to the editor with its gpui-kit file (D9: the
// same JSON the React pages' variables were generated from), loaded on first use.
const themeArgs = async (theme: ResolvedTheme): Promise<ThemeArgs> => ({
  dark: theme.dark,
  name: theme.builtIn ? undefined : theme.name,
  json: await loadThemeSource(theme),
});

const main = async (): Promise<void> => {
  let controller: ReviewController | null = null;
  let current: ResolvedTheme | null = null;
  // A request sent before the module is loaded; the controller itself holds one until the first frame.
  let early: CompareRequest | null = null;
  // The module answers the latest request it was given: the controller sends at most one at a time, synchronously,
  // and while it waits for the first frame only the latest one is kept.
  let latestRequest: number | undefined;

  // Before the first `await`: a request that arrives while the theme or the module is still loading is kept, not lost.
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== window.parent || !isToViewer(event.data)) return;
    latestRequest = event.data.id;
    if (controller) controller.compare(event.data.request);
    else early = event.data.request;
  });

  // Theme files load asynchronously: only the latest choice reaches the editor.
  let latest = 0;
  await watchTheme({ area: chrome.storage.local, onChanged: chrome.storage.onChanged, win: window }, ({ theme }) => {
    applyTheme(document.documentElement, theme);
    current = theme;
    const ticket = ++latest;
    themeArgs(theme)
      .then(args => {
        if (ticket === latest) controller?.setTheme(args);
      })
      .catch(error => toParent({ type: 'viewer/error', message: `theme ${theme.name}: ${String(error)}` }));
  });

  const fontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const startTicket = latest;
  const initial = await themeArgs(current!);
  controller = await startReview(
    { dark: initial.dark, themeName: initial.name, themeJson: initial.json, fontSize },
    {
      onEvent: event => {
        if (event.name === 'first-frame') {
          document.getElementById('placeholder')?.setAttribute('hidden', '');
          toParent({ type: 'viewer/ready' });
        } else if (event.name === 'shown') {
          if (latestRequest !== undefined) toParent({ type: 'viewer/shown', id: latestRequest, shown: event.shown });
        } else toParent({ type: 'viewer/error', message: event.message });
      },
      // A request the module refused (an unknown option, say): the main page shows it, so it is not logged here.
      onError: error => toParent({ type: 'viewer/error', id: latestRequest, message: String(error) }),
    },
  );
  // Handed over before the next `await`, so a request that arrives meanwhile goes after it and wins.
  if (early) controller.compare(early);
  early = null;
  // A choice made while the module was loading.
  if (latest !== startTicket) controller.setTheme(await themeArgs(current!));
};

main().catch(error => {
  debug.error('start', error);
  const placeholder = document.getElementById('placeholder');
  if (placeholder) placeholder.textContent = 'The editor could not start.';
  toParent({ type: 'viewer/error', message: String(error) });
});
