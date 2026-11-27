/**
 * The editor page (in the main page's iframe): runs the wasm editor, hands it what the main page sends (two texts, one
 * side, the language, a swap, which side the user may edit; for the Projects section, two texts with their hunks, one
 * file alone, the file or its diff, a line or a hunk to bring into view) and reads a side back when asked; the module compares —
 * on a request, and by itself after the user's edits. It follows the theme through chrome.storage itself. Only
 * messages from the extension's own parent page are taken; every answer to a request carries the request's id.
 *
 * What happens on the canvas but belongs to the main page goes up to it (shared/viewerProtocol.ts): a drag of files
 * entering the editor (gpui-web would swallow the drop: it cancels drops on its canvas), a drop that reached the
 * editor anyway, the main page's shortcuts (⌘S would otherwise open the browser's "Save page"), and Tab leaving the
 * editor — at once from a read-only side, after Escape from one being edited, where Tab indents. While the main page
 * has a modal open, this page takes no focus (focusGuard.ts).
 */
import './viewer.css';
import { behindModal, guardFocus } from './focusGuard';
import { reportUnlessLeaving, watchPageLife } from './pageLife';
import { createDebug } from '@extension/logger';
import { loadThemeSource } from '@extension/theme/sources';
import { collectDrop } from '@src/compare/files';
import { highlighter } from '@src/highlighter';
import { applyTheme, watchTheme } from '@src/shared/theme/store';
import { chordOf, isMac, isToViewer, sameChord } from '@src/shared/viewerProtocol';
import type { ReviewController, Side, ThemeArgs } from '@extension/review-wasm';
import type { ResolvedTheme } from '@extension/theme';
import type { FromViewer, KeyChord, ToViewer } from '@src/shared/viewerProtocol';

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

/** The side under a point of the page: the editors split it in two halves. */
const sideAt = (x: number): Side => (x < window.innerWidth / 2 ? 'old' : 'new');

// First, before the module can focus anything: no focus while the main page has a modal open (focusGuard.ts).
guardFocus(window, behindModal(window));
// Whether the page is going away: a load it interrupts is not the editor's failure (pageLife.ts).
const life = watchPageLife(window);

const main = async (): Promise<void> => {
  let controller: ReviewController | null = null;
  // Messages that arrive while the theme or the module is still loading, in order; the controller itself holds them
  // until the first frame.
  let early: ToViewer[] = [];
  // The module answers the latest request it was given: the controller sends at most one at a time, synchronously.
  let latestRequest: number | undefined;
  let shortcuts: KeyChord[] = [];
  const editable: Record<Side, boolean> = { old: false, new: false };

  const handle = (c: ReviewController, message: ToViewer): void => {
    switch (message.type) {
      case 'viewer/compare':
        latestRequest = message.id;
        return c.compare(message.request);
      case 'viewer/set-side':
        latestRequest = message.id;
        return c.setSide(message.request);
      case 'viewer/set-language':
        latestRequest = message.id;
        return c.setLanguage(message.language);
      case 'viewer/swap':
        latestRequest = message.id;
        [editable.old, editable.new] = [editable.new, editable.old];
        return c.swap();
      case 'viewer/mark-saved':
        latestRequest = message.id;
        return c.markSaved(message.side, message.text);
      case 'viewer/set-editable':
        editable[message.side] = message.editable;
        if (message.focus) window.focus();
        return c.setEditable(message.side, message.editable, message.focus);
      case 'viewer/focus':
        window.focus();
        return c.focusSide(message.side);
      case 'viewer/read':
        try {
          toParent({ type: 'viewer/text', id: message.id, side: message.side, text: c.sideText(message.side) });
        } catch (error) {
          toParent({ type: 'viewer/error', id: message.id, message: String(error) });
        }
        return;
      case 'viewer/keys':
        shortcuts = message.keys;
        return;
      case 'viewer/show-diff':
        latestRequest = message.id;
        return c.showDiff(message.payload);
      case 'viewer/show-file':
        latestRequest = message.id;
        editable.old = false;
        editable.new = !message.request.readOnly;
        return c.showFile(message.request);
      case 'viewer/set-mode':
        latestRequest = message.id;
        return c.setMode(message.mode);
      case 'viewer/reveal-line':
        return c.revealLine(message.line, message.column);
      case 'viewer/reveal-hunk':
        return c.revealHunk(message.index);
    }
  };

  // Before the first `await`: a message that arrives while the theme or the module is still loading is kept, not lost.
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== window.parent || !isToViewer(event.data)) return;
    if (controller) handle(controller, event.data);
    else early.push(event.data);
  });

  // A drag of files over the canvas: the main page puts its drop targets over the editor, and the next events go to
  // them. A drop that lands here before they cover it is handed up as it is.
  window.addEventListener(
    'dragenter',
    event => {
      if (event.dataTransfer?.types.includes('Files') || event.dataTransfer?.types.includes('text/plain'))
        toParent({ type: 'viewer/drag' });
    },
    true,
  );
  window.addEventListener('dragover', event => event.preventDefault(), true);
  window.addEventListener(
    'drop',
    event => {
      event.preventDefault();
      if (!event.dataTransfer) return;
      const side = sideAt(event.clientX);
      void collectDrop(event.dataTransfer).then(entries => {
        if (entries.length) toParent({ type: 'viewer/drop', side, entries });
      });
    },
    true,
  );

  // The keys that belong to the main page, and Tab out of the editor. Captured before gpui-web's own listener.
  const mac = isMac();
  let escapedAt = 0;
  window.addEventListener(
    'keydown',
    event => {
      const chord = chordOf(event, mac);
      if (shortcuts.some(s => sameChord(s, chord))) {
        event.preventDefault();
        event.stopPropagation();
        toParent({ type: 'viewer/key', chord, side: controller?.focusedSide() ?? null });
        return;
      }
      if (event.key === 'Escape') {
        escapedAt = event.timeStamp;
        return;
      }
      if (event.key !== 'Tab' || event.metaKey || event.ctrlKey || event.altKey || !controller) return;
      const side = controller.focusedSide();
      // Tab indents a side being edited, unless it comes right after Escape.
      if (side && editable[side] && event.timeStamp - escapedAt > 2000) return;
      event.preventDefault();
      event.stopPropagation();
      escapedAt = 0;
      const backwards = event.shiftKey;
      if (side === 'old' && !backwards) controller.focusSide('new');
      else if (side === 'new' && backwards) controller.focusSide('old');
      else toParent({ type: 'viewer/leave', backwards });
    },
    true,
  );

  // Theme files load asynchronously: only the latest choice reaches the editor.
  let current: ResolvedTheme | null = null;
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
  // Which build of the module, and what it needs on this page: the highlighter's composition root (src/highlighter).
  const started = await highlighter.start(
    { dark: initial.dark, themeName: initial.name, themeJson: initial.json, fontSize },
    {
      life,
      // A grammar file of the mixed highlighter build: the main page notes it; the text stays plain without it.
      onGrammar: event => toParent({ type: 'viewer/grammar', ...event }),
      onEvent: event => {
        if (event.name === 'first-frame') {
          document.getElementById('placeholder')?.setAttribute('hidden', '');
          toParent({ type: 'viewer/ready' });
        } else if (event.name === 'shown') {
          // The user's edit, compared once the typing paused, answers no request.
          if (event.shown.cause === 'edit') toParent({ type: 'viewer/shown', shown: event.shown });
          else if (latestRequest !== undefined)
            toParent({ type: 'viewer/shown', id: latestRequest, shown: event.shown });
        } else toParent({ type: 'viewer/error', message: event.message });
      },
      // A request the module refused (an unknown option, say): the main page shows it, so it is not logged here.
      onError: error => toParent({ type: 'viewer/error', id: latestRequest, message: String(error) }),
    },
  );
  // Handed over before the next `await`, so a message that arrives meanwhile goes after them.
  controller = started;
  for (const message of early) handle(started, message);
  early = [];
  // A choice made while the module was loading.
  if (latest !== startTicket) started.setTheme(await themeArgs(current!));
};

// A start that fails because the page is going away (a reload or a close while the module is still arriving aborts
// its load) is not reported: it is not the editor's failure, and Chrome would record it as the extension's error.
main().catch(error =>
  reportUnlessLeaving(error, life, () => {
    debug.error('start', error);
    const placeholder = document.getElementById('placeholder');
    if (placeholder) placeholder.textContent = 'The editor could not start.';
    toParent({ type: 'viewer/error', message: String(error) });
  }),
);
