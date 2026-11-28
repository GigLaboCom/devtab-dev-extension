/**
 * When an edit of a project's file is written (Р22: no Save button; the companion's specification §8.6а): a pause of
 * `AUTOSAVE_DELAY_MS` after the last change, and at once when the person leaves the file, the section or the page, hides
 * the tab, the window loses focus, or presses ⌘S. One write of a file at a time: the next waits for the answer (it needs
 * the new hash) and carries the latest text, so no edit is lost and none goes out of order. A `conflict` — the file
 * changed on disk under an unsaved edit — stops the writes of this file until the person chooses (Р23): keep theirs
 * (write over, from the disk's hash) or take the disk's text. Without the companion the edit stays in the editor and
 * is written again when it answers.
 *
 * No timers, no editor and no backend of its own: they come in, so the schedule is tested on the test's clock.
 */
import { isCompanionError } from './types';
import type { CompanionError } from './types';

export const AUTOSAVE_DELAY_MS = 1000;
/** Without the companion, the edit is tried again after this many pauses. */
const RETRY_FACTOR = 5;

/** What the person sees of the file: saved, waiting for the pause, being written, or not saved and why. */
export type SaveState =
  | { kind: 'saved' }
  | { kind: 'pending' }
  | { kind: 'saving' }
  | { kind: 'conflict'; currentHash: string }
  | { kind: 'offline' }
  /** The companion refused the write (a secret, `.git`, a read-only project, …): the page says why by its code. */
  | { kind: 'refused'; error: CompanionError };

export interface AutosaveTimers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface AutosaveOptions {
  delayMs?: number;
  /** The hash of the text the editor opened with. */
  baseHash: string;
  /** The text the editor opened with (an edit back to it writes nothing). */
  savedText: string;
  /** The editor's text now. */
  read(): Promise<string>;
  /** `file.save`: the new hash, or a rejection (`conflict` with the disk's hash). */
  save(
    text: string,
    baseHash: string,
    reason: 'auto' | 'explicit',
  ): Promise<{ hash: string; protected?: string | null }>;
  /** A text was written: the editor's baseline moves to it; `marked` names the rule when the file runs code. */
  onSaved?(text: string, hash: string, marked: string | null): void;
  onState?(state: SaveState): void;
  timers?: AutosaveTimers;
}

export interface Autosave {
  /** The editor's text changed: write it after the pause. */
  edited(): void;
  /** Write now (leaving, ⌘S); resolves when nothing is waiting any more. */
  flush(reason?: 'auto' | 'explicit'): Promise<void>;
  /** «Keep mine»: write the editor's text over the disk's, whose hash the conflict named. */
  keepMine(): Promise<void>;
  /** «Apply the external change»: the editor now holds the disk's text; nothing waits to be written. */
  takeDisk(text: string, hash: string): void;
  readonly state: SaveState;
  readonly baseHash: string;
  /** The text the file holds as far as this schedule knows (the last written or taken). */
  readonly savedText: string;
  dispose(): void;
}

const browserTimers: AutosaveTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Errors after which the edit is kept and written again later: the companion is away for a while. */
const AWAY = new Set(['server-restarting', 'rate-limited', 'paused', 'cancelled', 'internal', 'not-running']);
/** Refusals of this text, not of the file: the next edit tries again (a character the encoding holds, a shorter text). */
const OF_THE_TEXT = new Set(['not-encodable', 'too-large', 'disk-low']);

export const createAutosave = (options: AutosaveOptions): Autosave => {
  const delay = options.delayMs ?? AUTOSAVE_DELAY_MS;
  const timers = options.timers ?? browserTimers;
  let baseHash = options.baseHash;
  let savedText = options.savedText;
  let state: SaveState = { kind: 'saved' };
  let dirty = false;
  let timer: unknown = null;
  let running: Promise<void> | null = null;
  let disposed = false;

  const setState = (next: SaveState): void => {
    state = next;
    options.onState?.(next);
  };
  const stopTimer = (): void => {
    if (timer !== null) timers.clear(timer);
    timer = null;
  };
  const schedule = (): void => {
    stopTimer();
    timer = timers.set(() => {
      timer = null;
      void flush('auto');
    }, delay);
  };

  const writeOnce = async (reason: 'auto' | 'explicit'): Promise<void> => {
    dirty = false;
    const text = await options.read();
    if (text === savedText) {
      setState({ kind: 'saved' });
      return;
    }
    setState({ kind: 'saving' });
    try {
      const saved = await options.save(text, baseHash, reason);
      const { hash } = saved;
      baseHash = hash;
      savedText = text;
      options.onSaved?.(text, hash, saved.protected ?? null);
      setState(dirty ? { kind: 'pending' } : { kind: 'saved' });
    } catch (error) {
      dirty = true;
      if (isCompanionError(error, 'conflict')) {
        const currentHash = typeof error.data?.currentHash === 'string' ? error.data.currentHash : '';
        setState({ kind: 'conflict', currentHash });
      } else if (!isCompanionError(error) || AWAY.has(error.code)) {
        setState({ kind: 'offline' });
        // Tried again by itself after a while (what the companion asked to wait, when it said); the next edit sooner.
        const asked = isCompanionError(error) ? error.data?.retryAfterMs : undefined;
        stopTimer();
        timer = timers.set(
          () => {
            timer = null;
            void flush('auto');
          },
          typeof asked === 'number' && asked > 0 ? asked : delay * RETRY_FACTOR,
        );
      } else {
        setState({ kind: 'refused', error });
      }
    }
  };

  const flush = (reason: 'auto' | 'explicit' = 'auto'): Promise<void> => {
    stopTimer();
    if (disposed || state.kind === 'conflict') return running ?? Promise.resolve();
    if (state.kind === 'refused' && (!OF_THE_TEXT.has(state.error.code) || !dirty)) return running ?? Promise.resolve();
    if (state.kind === 'offline' && reason === 'auto' && running) return running;
    if (running) {
      // One write at a time: this one follows the write in flight and carries the newest text.
      return running.then(() => (dirty ? flush(reason) : undefined));
    }
    if (!dirty) return Promise.resolve();
    running = writeOnce(reason).finally(() => {
      running = null;
    });
    return running;
  };

  return {
    edited() {
      if (disposed) return;
      dirty = true;
      if (state.kind === 'conflict') return;
      // A refusal of the file stays until it is opened again; one of the text is tried again with the new text.
      if (state.kind === 'refused' && !OF_THE_TEXT.has(state.error.code)) return;
      if (state.kind !== 'saving') setState({ kind: 'pending' });
      schedule();
    },
    flush,
    async keepMine() {
      if (state.kind !== 'conflict') return;
      baseHash = state.currentHash;
      // The disk moved on: whatever the editor holds now differs from it and is written.
      savedText = '\u0000';
      dirty = true;
      setState({ kind: 'pending' });
      await flush('explicit');
    },
    takeDisk(text, hash) {
      stopTimer();
      baseHash = hash;
      savedText = text;
      dirty = false;
      setState({ kind: 'saved' });
    },
    get state() {
      return state;
    },
    get baseHash() {
      return baseHash;
    },
    get savedText() {
      return savedText;
    },
    dispose() {
      disposed = true;
      stopTimer();
    },
  };
};
