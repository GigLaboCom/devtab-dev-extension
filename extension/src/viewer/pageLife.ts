/**
 * Whether the editor page is going away, and failures that only say so. When the main page is reloaded or closed while
 * the editor module (or a grammar file) is still arriving, the browser aborts the load — "WebAssembly compilation
 * aborted: Network error: Response body loading was aborted" — and the promise rejects while the page is going away.
 * That is not a failure of the editor: it is not logged (Chrome would record it as the extension's error) and not
 * reported.
 *
 * How it tells. The abort usually arrives before the page's own `pagehide` (the browser stops a leaving document's loads
 * first): a rejection that is an abort is reported only if the page is still here a moment later — a page that is going
 * away never runs that timer. Anything that fails after `pagehide`, or once the frame is detached (`window.parent` is
 * null then), is not reported at all.
 */

export interface PageLife {
  leaving: () => boolean;
}

interface LifeWindow {
  addEventListener: (type: 'pagehide' | 'pageshow', listener: (event: { persisted?: boolean }) => void) => void;
  readonly parent: unknown;
}

export const watchPageLife = (win: LifeWindow): PageLife => {
  let hidden = false;
  win.addEventListener('pagehide', () => {
    hidden = true;
  });
  // Back from the back/forward cache: the page lives on.
  win.addEventListener('pageshow', event => {
    if (event.persisted) hidden = false;
  });
  return { leaving: () => hidden || win.parent === null };
};

/** A rejection of an interrupted load (an abort of the network or of the compilation), not of a broken file. */
export const isAbort = (error: unknown): boolean => {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  const message = error instanceof Error ? error.message : String(error);
  return /\babort(ed)?\b/i.test(message);
};

/** How long an abort waits to be sure the page stays: a leaving page is gone well before. */
export const ABORT_GRACE_MS = 1_000;

/**
 * Reports `error` unless the page is going away; an abort only once the page has stayed for {@link ABORT_GRACE_MS}.
 */
export const reportUnlessLeaving = (
  error: unknown,
  life: PageLife,
  report: (error: unknown) => void,
  later: (run: () => void, ms: number) => void = (run, ms) => setTimeout(run, ms),
): void => {
  if (life.leaving()) return;
  if (!isAbort(error)) {
    report(error);
    return;
  }
  later(() => {
    if (!life.leaving()) report(error);
  }, ABORT_GRACE_MS);
};
