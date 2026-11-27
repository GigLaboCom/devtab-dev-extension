import type {
  CompareRequest,
  DiffPayload,
  DiffShown,
  FileRequest,
  ReviewEvent,
  ReviewModule,
  Side,
  SideRequest,
  SideShown,
  ViewMode,
} from './types';

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
  /** Hunks computed elsewhere (the companion, in the Projects section), shown as given; waits the same way. */
  showDiff: (payload: DiffPayload) => void;
  /** One file alone (the new side), editable unless `readOnly`; a full replacement, waits the same way. */
  showFile: (request: FileRequest) => void;
  /** The file alone or the diff of its edits; the texts stay. */
  setMode: (mode: ViewMode) => void;
  /** Bring a 0-based line of the new side into view: the caret at the column, or the line selected without one. */
  revealLine: (line: number, column?: number) => void;
  /** Bring a hunk of what is shown into view, its lines selected; an index past the hunks is refused (`onError`). */
  revealHunk: (index: number) => void;
  /** One side's new text, compared with the other side as it is now; waits after a waiting `compare`. */
  setSide: (request: SideRequest) => void;
  /** Highlight both sides as another language. */
  setLanguage: (language: string) => void;
  /** The sides trade places. */
  swap: () => void;
  /** Let the user edit a side, or make it read-only again; with `focus`, the keyboard goes to it. */
  setEditable: (side: Side, editable: boolean, focus?: boolean) => void;
  /** The page saved `text` for the side: it is not modified any more. */
  markSaved: (side: Side, text: string) => void;
  /** Give a side the keyboard. */
  focusSide: (side: Side) => void;
  /** A side's text as the editor holds it now. Throws before the first frame or when the module refuses. */
  sideText: (side: Side) => string;
  /** The side whose editor has the keyboard; null before the first frame or when neither has it. */
  focusedSide: () => Side | null;
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

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const isShown = (value: unknown): value is Partial<DiffShown> & Pick<DiffShown, 'path' | 'changes'> =>
  isObject(value) &&
  typeof value.path === 'string' &&
  typeof value.changes === 'number' &&
  typeof value.added === 'number' &&
  typeof value.removed === 'number';

const sideOf = (value: unknown): SideShown => ({
  editable: isObject(value) && value.editable === true,
  modified: isObject(value) && value.modified === true,
  empty: isObject(value) && value.empty === true,
});

const parseShown = (detail: string): DiffShown | null => {
  try {
    const value: unknown = JSON.parse(detail);
    if (!isShown(value)) return null;
    const sides: Record<string, unknown> = isObject(value.sides) ? value.sides : {};
    return {
      path: value.path,
      changes: value.changes,
      added: value.added ?? 0,
      removed: value.removed ?? 0,
      lineDiffer: value.lineDiffer ?? null,
      compareMs: value.compareMs ?? null,
      updateMs: value.updateMs ?? null,
      cause: value.cause === 'edit' ? 'edit' : 'request',
      sides: { old: sideOf(sides.old), new: sideOf(sides.new) },
      mode: value.mode === 'file' ? 'file' : 'diff',
    };
  } catch {
    return null;
  }
};

const sideOrNull = (name: string | undefined): Side | null => (name === 'old' || name === 'new' ? name : null);

/**
 * The editor's lifecycle without the wasm (testable): `run()` opens a window and draws an empty view; only after the
 * first frame does the module take texts (spikes/extension-e2e, finding 11). Until then the calls wait in order — a
 * full `compare`, `showDiff` or `showFile` drops whatever waited before it, as it would only be painted over — and a
 * theme change goes straight through (`set_theme` is safe at any time after `run()`).
 */
export const createReviewController = (module: ReviewModule, hooks: ControllerHooks = {}): ReviewController => {
  let ready = false;
  let waiting: Array<() => void> = [];

  const call = (send: () => void): void => {
    try {
      send();
    } catch (error) {
      hooks.onError?.(error);
    }
  };
  // How many full replacements (compare, showDiff) have gone to the module.
  let replaced = 0;
  const whenReady = (send: () => void, replaces = false): void => {
    if (!ready) {
      waiting = replaces ? [send] : [...waiting, send];
      return;
    }
    if (replaces) replaced++;
    call(send);
  };
  const requireReady = (name: string): void => {
    if (!ready) throw new Error(`${name}: the editor has not drawn its first frame yet`);
  };

  return {
    get ready() {
      return ready;
    },
    compare(request) {
      whenReady(() => module.compare_texts(JSON.stringify(request)), true);
    },
    showDiff(payload) {
      whenReady(() => module.show_diff(JSON.stringify(payload)), true);
    },
    showFile(request) {
      whenReady(() => module.show_file(JSON.stringify(request)), true);
    },
    setMode(mode) {
      whenReady(() => module.set_mode(mode));
    },
    revealLine(line, column) {
      whenReady(() => module.reveal_line(line, column ?? null));
    },
    revealHunk(index) {
      whenReady(() => module.reveal_hunk(index));
    },
    setSide(request) {
      whenReady(() => module.set_side(JSON.stringify(request)));
    },
    setLanguage(language) {
      whenReady(() => module.set_language(language));
    },
    swap() {
      whenReady(() => module.swap_sides());
    },
    setEditable(side, editable, focus = false) {
      whenReady(() => module.set_editable(side, editable, focus));
    },
    markSaved(side, text) {
      whenReady(() => module.mark_saved(side, text));
    },
    focusSide(side) {
      whenReady(() => module.focus_side(side));
    },
    sideText(side) {
      requireReady('side_text');
      return module.side_text(side);
    },
    focusedSide() {
      if (!ready) return null;
      try {
        return sideOrNull(module.focused_side());
      } catch {
        return null;
      }
    },
    setTheme({ dark, name, json }) {
      call(() => module.set_theme(dark, name, json));
    },
    onModuleEvent(name, detail) {
      if (name === 'first-frame') {
        if (ready) return;
        ready = true;
        // A replacement made while the event is reported (from onEvent) is newer than what waited, and goes straight
        // through; what waited is then dropped, as it would only paint over it.
        const queued = waiting;
        waiting = [];
        const before = replaced;
        hooks.onEvent?.({ name });
        if (replaced === before) for (const send of queued) call(send);
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
