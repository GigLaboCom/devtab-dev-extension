/**
 * The companion's API as the Projects section sees it: identifiers, the methods of the first version with their
 * requests and answers, the streams, the events and the error codes (the companion's specification, §4.5–§4.7 and
 * §4.11). Written by hand for now, in one file: once the companion publishes its contract (its
 * `contract/companion-api-v1/`), this file is replaced by types generated from the copy of that contract, and every
 * implementation of the seam is checked against its vectors. Until then the shapes follow the specification's tables
 * field by field; a field this section does not read yet is still here, so the generated file can replace this one
 * without touching the parts.
 *
 * Paths are relative POSIX paths inside the project (`""` is the root); no answer carries an absolute path or the
 * home directory — a project's root is its `displayPath` (`~/…`).
 */
import type { LineHunk } from '@extension/review-wasm';

export type { LineHunk };

/** `p_` and ten base32 characters, given by the companion when the project is added; stable. */
export type ProjectId = string;

/** «view» — read only; «mine» — files and git may be written from the page (§3.2). */
export type ProjectClass = 'view' | 'mine';

/** How the project got its class: a command in the terminal, the companion's window, or a trusted folder. */
export type Via = 'terminal' | 'dialog' | 'location' | 'person';

/** An opaque point of the local history (`s:<id>@<ms>` or `c:<sha256>@<ms>`). */
export type HistoryPoint = string;

// ---- projects and state -----------------------------------------------------------------------------------------

export interface CompanionState {
  companion: string;
  server: { state: 'running' | 'restarting' | 'refused'; version: string };
  env: { capturedAt: number | null; path: string[] };
  paused: boolean;
  problems: string[];
  /** Where a deleted file goes; one value in the first version. */
  deletePolicy: 'trash';
}

export interface ProjectSummary {
  id: ProjectId;
  /** The folder's name. */
  name: string;
  /** The root with `~/`. */
  displayPath: string;
  class: ProjectClass;
  via: Via;
  /** The trusted folder the project lies in (its `displayPath`), or null outside every trusted folder. */
  location: string | null;
  branch: string | null;
  state: 'open' | 'missing' | 'error';
}

export interface ProjectState {
  class: ProjectClass;
  via: Via;
  location: string | null;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  detached: boolean;
  /** The hooks a commit runs (`pre-commit`, `commit-msg`, …). */
  hooks: string[];
  hooksPath: boolean;
  historyGaps: { from: number; to: number }[];
}

/** A trusted folder (§3.7, §3.7а): read only for the page — no method creates or changes one. */
export interface TrustedLocation {
  /** Its name, given outside the browser (`devtab trust <folder> --name <name>`); the folder's own name without one. */
  name: string;
  displayPath: string;
  mode: 'write' | 'read-only';
  projects: number;
  createdVia: 'terminal' | 'dialog' | 'init';
}

// ---- reading ----------------------------------------------------------------------------------------------------

export interface TreeEntry {
  name: string;
  path: string;
  kind: 'file' | 'dir' | 'symlink';
  size: number;
  mtimeMs: number;
  /** Matched by `.gitignore`: shown dimmed (Р18). */
  ignored: boolean;
  hidden: boolean;
  /** For a symlink: whether it leads inside the project or out of it (shown, never followed). */
  link: 'inside' | 'outside' | null;
  /** A file that runs code by itself or changes what git runs (§5.4): writable in «mine», marked. */
  protected: boolean;
  /** The rule that marks it protected. */
  rule?: string;
  /** A file with secrets (§5.3): read only in every class (Р19). */
  secret: boolean;
}

export interface TreeListing {
  entries: TreeEntry[];
  truncated: boolean;
  skippedNames: number;
}

export interface FileText {
  text: string;
  /** SHA-256 of the text with `\n` line ends. */
  hash: string;
  size: number;
  mtimeMs: number;
  encoding: string;
  bom: boolean;
  lineEnding: 'lf' | 'crlf' | 'mixed';
  large: boolean;
  secret?: boolean;
  protected?: boolean;
  rule?: string;
}

export interface FoundFile {
  path: string;
  score: number;
  /** The matched characters of the path. */
  indices: number[];
  ignored: boolean;
}

export interface SearchParams {
  project: ProjectId;
  pattern: string;
  isRegex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  /** Ignored folders are skipped unless asked (Р20). */
  includeIgnored?: boolean;
  include?: string[];
  exclude?: string[];
  maxMatches?: number;
}

/** One file's matches, streamed. `ranges` are UTF-16 columns of the line. */
export interface SearchHit {
  path: string;
  matches: { line: number; text: string; ranges: [number, number][] }[];
}

export interface SearchDone {
  files: number;
  matches: number;
  truncated: boolean;
}

export type ChangeGroup = 'changes' | 'unversioned';
export type Change = 'modified' | 'added' | 'deleted' | 'renamed' | 'conflicted' | 'untracked';

export interface StatusFile {
  path: string;
  group: ChangeGroup;
  change: Change;
  renamedFrom: string | null;
  /** The person's index holds something for it (staged in the terminal). */
  stagedOutside: boolean;
  /** The hash of the file on disk (null when deleted). */
  diskHash: string | null;
}

export interface GitStatus {
  headSha: string;
  branch: string | null;
  files: StatusFile[];
}

export interface GitIdentity {
  name: string | null;
  email: string | null;
  signing: { enabled: boolean; format: string | null };
}

export type DiffBase = 'HEAD' | 'index' | { rev: string } | { point: HistoryPoint };

export interface DiffSides {
  old: { text: string; exists: boolean };
  new: { text: string; exists: boolean };
  hunks: LineHunk[];
  flags: { crlf: boolean; binary: boolean; renamedFrom: string | null; conflicted: boolean; utf8: boolean };
}

export interface ChunkHunk {
  index: number;
  oldStart: number;
  oldLines: number;
  start: number;
  lines: number;
}

export interface FileHunks {
  hunks: ChunkHunk[];
  headHash: string | null;
  diskHash: string | null;
  /** Whether chunks may be checked one by one; a whole file only otherwise (§6.5). */
  chunkable: boolean;
  reason?: 'binary' | 'encoding' | 'conflicted' | 'submodule' | 'renamed';
}

export interface OutgoingCommit {
  sha: string;
  short: string;
  summary: string;
  author: string;
  timeMs: number;
}

export interface Outgoing {
  branch: string | null;
  remote: string | null;
  upstream: string | null;
  /** The push sets the upstream (the branch has none yet). */
  setUpstream: boolean;
  commits: OutgoingCommit[];
  more: boolean;
  behindAtLastFetch: number;
}

// ---- writing ----------------------------------------------------------------------------------------------------

export interface SaveParams {
  project: ProjectId;
  path: string;
  /** The hash of the text the edit started from: the save is refused (`conflict`) when the disk moved on. */
  baseHash: string;
  text: string;
  /** One per editing session of the file: the companion keeps one «Before edit» snapshot for it. */
  session?: string;
  reason?: 'auto' | 'explicit';
}

export interface CommitSelection {
  path: string;
  /** Hunk indices of `git.hunks`; absent — the whole file. */
  chunks?: number[];
}

export interface CommitParams {
  project: ProjectId;
  message: string;
  selection: CommitSelection[];
  /** Unchecked = `--no-verify`: skips `pre-commit` and `commit-msg` only. */
  runHooks: boolean;
  expect: { headSha: string; files: { path: string; diskHash: string | null }[] };
}

export interface CommitResult {
  sha: string;
  hookChangedCommit: string[];
  changedAfter: string[];
  indexKept: string[];
}

/** A line of a hook's or of git's output, streamed while a commit or a push runs. */
export interface OutputLine {
  stream: 'stdout' | 'stderr';
  text: string;
}

export interface PushResult {
  pushed: number;
  remote: string;
  branch: string;
  setUpstream: boolean;
}

// ---- history ----------------------------------------------------------------------------------------------------

export type PointSource = 'server' | 'companion' | 'commit';

export interface FilePoint {
  point: HistoryPoint;
  /** External change, Saved, Deleted, Before edit, Before save, Before restore, Before rollback, Commit, … */
  label: string;
  source: PointSource;
  size: number;
  timeMs: number;
  /** Saves of one editing session shown as one row: how many, and the time of the first (§8.6а). */
  count?: number;
  firstMs?: number;
}

export interface ProjectPoint extends FilePoint {
  path: string;
}

// ---- the methods ------------------------------------------------------------------------------------------------

type Of<P, R, S = never> = { params: P; result: R; stream: S };
type InProject<P = object> = { project: ProjectId } & P;

/** Every method of the first version: its request, its answer and, for a streaming one, its parts. */
export interface Methods {
  'companion.state': Of<object, CompanionState>;
  'projects.list': Of<object, ProjectSummary[]>;
  'project.state': Of<InProject, ProjectState>;
  'locations.list': Of<object, TrustedLocation[]>;
  'project.requestAdd': Of<{ path: string }, { id: ProjectId; class: ProjectClass; via: Via }>;
  'project.requestMine': Of<InProject, { class: 'mine' }>;
  'project.setView': Of<InProject, { class: 'view' }>;
  'project.remove': Of<InProject, object>;
  'env.requestCapture': Of<object, { capturedAt: number; path: string[] }>;
  'events.subscribe': Of<InProject, object>;
  'events.unsubscribe': Of<InProject, object>;
  'tree.list': Of<InProject<{ path: string }>, TreeListing>;
  'file.read': Of<InProject<{ path: string }>, FileText>;
  'files.find': Of<InProject<{ query: string; limit?: number }>, FoundFile[]>;
  'search.start': Of<SearchParams, SearchDone, SearchHit>;
  'git.status': Of<InProject, GitStatus>;
  'git.identity': Of<InProject, GitIdentity>;
  'diff.sides': Of<InProject<{ path: string; base: DiffBase }>, DiffSides>;
  'git.hunks': Of<InProject<{ path: string }>, FileHunks>;
  'git.outgoing': Of<InProject, Outgoing>;
  'git.messages': Of<InProject, { messages: string[] }>;
  'file.save': Of<SaveParams, { hash: string; mtimeMs: number }>;
  'file.create': Of<InProject<{ path: string; text: string }>, { hash: string }>;
  'folder.create': Of<InProject<{ path: string }>, object>;
  'file.rename': Of<InProject<{ from: string; to: string }>, object>;
  'file.delete': Of<InProject<{ path: string; baseHash?: string }>, { trashed: true; files: number }>;
  'git.commit': Of<CommitParams, CommitResult, OutputLine>;
  'git.rollback': Of<
    InProject<{
      paths: string[];
      deleteAdded: boolean;
      expect: { files: { path: string; diskHash: string | null }[] };
    }>,
    { rolledBack: string[]; trashed: string[] }
  >;
  'git.undoCommit': Of<InProject<{ headSha: string }>, { message: string; paths: string[] }>;
  'git.push': Of<InProject<{ expect: { headSha: string; remote: string; branch: string } }>, PushResult, OutputLine>;
  'history.file': Of<InProject<{ path: string }>, { points: FilePoint[]; gaps: { from: number; to: number }[] }>;
  'history.project': Of<
    InProject<{ since?: number; cursor?: string; limit?: number }>,
    { points: ProjectPoint[]; next: string | null; deleted: string[] }
  >;
  'history.content': Of<InProject<{ point: HistoryPoint }>, { text: string; secret: boolean }>;
  'history.restore': Of<
    InProject<{ path: string; point: HistoryPoint; currentHash: string | null }>,
    { restored: HistoryPoint; before: HistoryPoint | null }
  >;
  'history.requestPurge': Of<InProject, object>;
}

export type Method = keyof Methods;
export type Params<M extends Method> = Methods[M]['params'];
export type Result<M extends Method> = Methods[M]['result'];
export type StreamOf<M extends Method> = Methods[M]['stream'];

/** The methods that write: only in a project of class «mine». */
export const WRITE_METHODS: readonly Method[] = [
  'project.setView',
  'file.save',
  'file.create',
  'folder.create',
  'file.rename',
  'file.delete',
  'git.commit',
  'git.rollback',
  'git.undoCommit',
  'git.push',
  'history.restore',
];

// ---- events -----------------------------------------------------------------------------------------------------

export type CompanionEvent =
  | { name: 'files.changed'; project: ProjectId; data: { paths: string[]; more: boolean } }
  | { name: 'git.changed'; project: ProjectId; data: object }
  | { name: 'history.appeared'; project: ProjectId; data: { paths: string[] } }
  | { name: 'history.gap'; project: ProjectId; data: { from: number; to: number; paths: number } }
  | { name: 'server.restarted'; project: ProjectId; data: object }
  | { name: 'project.changed'; project: ProjectId; data: { class?: ProjectClass; state?: ProjectSummary['state'] } }
  | { name: 'companion.paused'; project: ProjectId; data: object }
  | { name: 'companion.resumed'; project: ProjectId; data: object };

export type EventName = CompanionEvent['name'];

// ---- errors -----------------------------------------------------------------------------------------------------

export type ErrorCode =
  | 'invalid-params'
  | 'invalid-path'
  | 'not-found'
  | 'outside-project'
  | 'protected-path'
  | 'secret-file'
  | 'not-mine'
  | 'paused'
  | 'binary'
  | 'too-large'
  | 'too-many-files'
  | 'conflict'
  | 'exists'
  | 'stale-selection'
  | 'hunks-unsupported'
  | 'nothing-selected'
  | 'identity-missing'
  | 'hook-failed'
  | 'hook-tool-missing'
  | 'hook-timeout'
  | 'index-locked'
  | 'signing-failed'
  | 'undo-unavailable'
  | 'push-rejected'
  | 'push-remote-rejected'
  | 'push-auth-failed'
  | 'push-needs-input'
  | 'push-remote-ambiguous'
  | 'push-detached'
  | 'push-timeout'
  | 'push-network'
  | 'confirmation-declined'
  | 'confirmation-unavailable'
  | 'confirmation-busy'
  | 'rate-limited'
  | 'server-restarting'
  | 'unsupported-version'
  | 'cancelled'
  | 'internal';

/** An error in the API's one form: a code, an English message without paths outside the project, data by code. */
export class CompanionError extends Error {
  readonly code: ErrorCode;
  readonly data: Readonly<Record<string, unknown>> | undefined;

  constructor(code: ErrorCode, message: string, data?: Record<string, unknown>) {
    super(message);
    this.name = 'CompanionError';
    this.code = code;
    this.data = data;
  }
}

export const isCompanionError = (error: unknown, code?: ErrorCode): error is CompanionError =>
  error instanceof CompanionError && (code === undefined || error.code === code);
