import type { CompareRequest, DiffPayload, DiffShown, ReviewEvent, ReviewModule } from './types';

export interface ThemeArgs {
  dark: boolean;
  name?: string;
  json?: string;
}

export interface ReviewController {
  /**
   * Two texts → the module compares and shows them; the result comes back as a `shown` event. Before the first frame
   * the request waits (the editor refuses texts until its window is open).
   */
  compare: (request: CompareRequest) => void;
  /** Hunks computed elsewhere (the server, in live review), shown as given; waits the same way. */
  showDiff: (payload: DiffPayload) => void;
  setTheme: (theme: ThemeArgs) => void;
  /** Feed of the module's `__reviewEvent` calls. */
  onModuleEvent: (name: string, detail: string) => void;
  readonly ready: boolean;
}

export interface ControllerHooks {
  onEvent?: (event: ReviewEvent) => void;
  /** A call the module refused (it throws): a broken payload, an unknown option or variant. Never thrown on. */
  onError?: (error: unknown) => void;
}

const isShown = (value: unknown): value is DiffShown => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.path === 'string' &&
    typeof v.changes === 'number' &&
    typeof v.added === 'number' &&
    typeof v.removed === 'number'
  );
};

const parseShown = (detail: string): DiffShown | null => {
  try {
    const value: unknown = JSON.parse(detail);
    return isShown(value)
      ? { ...value, lineDiffer: value.lineDiffer ?? null, compareMs: value.compareMs ?? null }
      : null;
  } catch {
    return null;
  }
};

/**
 * The editor's lifecycle without the wasm (testable): `run()` opens a window and draws an empty view; only after the
 * first frame does the module take texts (spikes/extension-e2e, finding 11). Until then the LAST request waits — an
 * earlier one would be painted over anyway — and a theme change goes straight through (`set_theme` is safe at any
 * time after `run()`).
 */
export const createReviewController = (module: ReviewModule, hooks: ControllerHooks = {}): ReviewController => {
  let ready = false;
  let pending: (() => void) | null = null;

  const call = (send: () => void): void => {
    try {
      send();
    } catch (error) {
      hooks.onError?.(error);
    }
  };
  // How many requests have gone to the module.
  let sent = 0;
  const whenReady = (send: () => void): void => {
    if (!ready) pending = send;
    else {
      sent++;
      call(send);
    }
  };

  return {
    get ready() {
      return ready;
    },
    compare(request) {
      whenReady(() => module.compare_texts(JSON.stringify(request)));
    },
    showDiff(payload) {
      whenReady(() => module.show_diff(JSON.stringify(payload)));
    },
    setTheme({ dark, name, json }) {
      call(() => module.set_theme(dark, name, json));
    },
    onModuleEvent(name, detail) {
      if (name === 'first-frame') {
        if (ready) return;
        ready = true;
        // A request made while the event is reported (from onEvent) is newer than the one that waited, and goes
        // straight through; the waiting one is then dropped, as it would only paint over it.
        const waiting = pending;
        pending = null;
        const before = sent;
        hooks.onEvent?.({ name });
        if (waiting && sent === before) call(waiting);
      } else if (name === 'shown') {
        const shown = parseShown(detail);
        if (shown) hooks.onEvent?.({ name, shown });
        else hooks.onError?.(new Error(`the editor reported an unreadable result: ${detail}`));
      } else if (name === 'error') {
        hooks.onEvent?.({ name, message: detail });
      }
    },
  };
};
