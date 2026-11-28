/**
 * Seam `OpenedFiles` (D42; docs/research/open-with.md §4.3) — files opened from the system: one file of no project,
 * handed to the companion by «Open With», `devtab open <file>` in the terminal or, later, a link, and shown on the
 * Projects page next to the scratches — one file in a plain text editor, without a project. The page never
 * receives a path as a right: the companion keeps the opening behind a one-time token, the page redeems it (`claim`)
 * and from then on speaks of the file by the companion's id. No tree, no git, no folder settings, no neighbour is read.
 *
 * Asynchronous like the section's other seams; refusals are `CompanionError`s in the API's form (../types.ts). The
 * section's composition root (../behaviors.ts, `openFiles`) names the implementation: the companion's
 * (./companion.ts — the one module that knows the wire names and shapes of the companion's contract). A companion that
 * does not announce the methods (every companion before them) makes `offered()` false: the page sends nothing and shows
 * nothing.
 */
import type { ProjectBackend } from '../backend';
import type { FileMode, FileText, OpenedVia, ProjectClass, ReadReason } from '../types';

/** `edit`: the page may write the file (where the edition edits it); `read`: it only shows it. */
export type OpenedFileMode = FileMode;

/** Why the companion keeps the file read only (only in mode `read`). */
export type OpenedFileReason = ReadReason;

export interface OpenedFile {
  /** The companion's id of the opened file: what every later call names. */
  id: string;
  /** The file's name, for the bar and the list. */
  name: string;
  /** Where it is: `~/…` inside the home folder, the absolute path outside it; never a path to act on. */
  displayPath: string;
  mode: OpenedFileMode;
  /** A file that runs by itself (a shell's or the system's setting): marked, written like any other in mode `edit`. */
  executes: boolean;
  /** Why it is read only; null in mode `edit`. */
  reason: OpenedFileReason | null;
  /** How it came; null when not known (a claim's answer). */
  via: OpenedVia | null;
  /** When a person last opened it (ms since the epoch); null when not known (a claim's answer). */
  openedAt: number | null;
}

/** Where the editor's caret goes: a 0-based line and a 0-based column. */
export interface OpenedAt {
  line: number;
  column?: number;
}

/** What a token turned out to be: a file of no project, or a file of an added project (opened as the project's). */
export type Claim =
  | { kind: 'file'; file: OpenedFile; at: OpenedAt | null }
  | {
      kind: 'project';
      project: string;
      path: string;
      name: string;
      displayPath: string;
      class: ProjectClass;
      at: OpenedAt | null;
    };

/** One of the companion's own copies of an opened file. */
export interface OpenedFilePoint {
  point: string;
  label: string;
  timeMs: number;
  size: number;
  /** Whether the companion kept the text (false: it noted the moment only). */
  content: boolean;
}

/** What the companion may be asked beyond reading: each is offered on its own (its `welcome` lists it). */
export type OpenedFilesAction = 'save' | 'history' | 'historyContent' | 'restore' | 'forget' | 'activity';

export interface OpenedFiles {
  /** Whether the companion offers opened files at all (claim, read and list). False: nothing is sent, nothing shown. */
  offered(): boolean;
  /** Whether it offers one of the further methods. */
  can(action: OpenedFilesAction): boolean;
  /** The files it has opened, newest first. */
  list(): Promise<OpenedFile[]>;
  /** Tokens that wait to be claimed (opened while no page was connected). */
  pending(): Promise<string[]>;
  /** Redeems a token, once: `not-found` when it is unknown, used, expired or another extension's. */
  claim(token: string): Promise<Claim>;
  read(file: string): Promise<FileText>;
  /**
   * Writes the file if it is still the version `baseHash` names. Refusals: `conflict` (`currentHash`), `not-editable`
   * (`reason`; `replaced`: read only from now on), `rate-limited` (`retryAfterMs`), `paused`, `disk-low`, `too-large`,
   * `binary`, `not-found`.
   */
  save(file: string, baseHash: string, text: string): Promise<{ hash: string }>;
  /** The companion's own copies of this file, newest first (mode `read` too). */
  history(file: string): Promise<OpenedFilePoint[]>;
  /** The text of one copy. */
  historyContent(file: string, point: string): Promise<{ text: string; secret: boolean }>;
  /** Writes a copy over the file (mode `edit`): the new version and the copy of what it replaced. */
  restore(file: string, point: string, currentHash: string): Promise<{ hash: string; before: string }>;
  /** The file leaves the list, the companion drops its right to it and deletes its copies of it. */
  forget(file: string): Promise<void>;
  /** Tells the companion the page's visibility and focus; nothing is sent where the method is not offered. */
  activity(visible: boolean, focusedAt: number): Promise<void>;
  /** A file waits for this page (`open.requested`); returns the undo. */
  onRequested(listener: (token: string) => void): () => void;
}

/** Makes the seam over the page's backend (the one port the section holds). */
export type OpenedFilesFactory = ((backend: ProjectBackend) => OpenedFiles) & { readonly id: string };
