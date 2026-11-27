/**
 * The companion's API as the Projects section sees it: identifiers, the methods with their requests and answers, the
 * streams, the events and the error codes (the companion's specification, §4.5–§4.7 and §4.11).
 *
 * Two sources. The methods, events and error codes the companion offers today come from its contract — the copy in
 * ./api/ and the types made from its schemas (./api/types.gen.ts, scripts/contract-sync.mjs); the companion's contract
 * is the source of truth for them, and the demo answers in the same shapes. The methods the companion does not offer
 * yet (the trusted folders, the class changes, every write, commit, push and restore) are written here by hand after
 * the specification's tables, until a newer contract brings them.
 *
 * Paths are relative POSIX paths inside the project (`""` is the root); no answer carries an absolute path or the
 * home directory — a project's root is its `displayPath` (`~/…`).
 */
import type * as Contract from './api/types.gen';
import type { LineHunk } from '@extension/review-wasm';

export type { LineHunk };
export type { ContractEvents, ContractMethods, ErrorCode } from './api/types.gen';

/** `p_` and ten base32 characters, given by the companion when the project is added; stable. */
export type ProjectId = string;

/** «view» — read only; «mine» — files and git may be written from the page (§3.2). */
export type ProjectClass = Contract.ProjectClass;

/** How the project got its class: a command in the terminal, the companion's window, or a trusted folder. */
export type Via = Contract.Via;

/** An opaque point of the local history (the companion's: `s:<id>@<ms>:<path>`, `g:<sha>@<ms>:<path>`). */
export type HistoryPoint = string;

// ---- from the contract ------------------------------------------------------------------------------------------

export type CompanionState = Contract.CompanionState;
export type ProjectSummary = Contract.ProjectSummary;
export type ProjectState = Contract.ProjectStateResult;
export type TreeEntry = Contract.TreeEntry;
export type TreeListing = Contract.TreeList;
export type FileText = Contract.FileText;
export type FoundFile = Contract.FoundFile;
export type SearchParams = Contract.SearchParams;
/** One file's matches, streamed. `ranges` are UTF-16 columns of the line. */
export type SearchHit = Contract.SearchFile;
export type SearchDone = Contract.SearchDone;
export type ChangeGroup = Contract.StatusGroup;
export type Change = Contract.Change;
export type StatusFile = Contract.StatusFile;
export type GitStatus = Contract.GitStatus;
export type GitIdentity = Contract.GitIdentity;
export type DiffBase = Contract.DiffBase;
export type DiffSides = Contract.DiffSides;
/** A changed range of `diff.sides`: 0-based lines, `old*` on the old side. */
export type Hunk = Contract.Hunk;
export type ChunkHunk = Contract.IndexedHunk;
export type FileHunks = Contract.GitHunks;
export type PointSource = Contract.PointSource;
export type FilePoint = Contract.HistoryPoint;
export type ProjectPoint = Contract.ProjectPoint;

// ---- by hand, until the companion offers them --------------------------------------------------------------------

/** A trusted folder (§3.7, §3.7а): read only for the page — no method creates or changes one. */
export interface TrustedLocation {
  /** Its name, given outside the browser (`devtab trust <folder> --name <name>`); the folder's own name without one. */
  name: string;
  displayPath: string;
  mode: 'write' | 'read-only';
  projects: number;
  createdVia: 'terminal' | 'dialog' | 'init';
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
  expect: { headSha?: string | null; files: { path: string; diskHash?: string | null }[] };
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

// ---- the methods ------------------------------------------------------------------------------------------------

type Of<P, R, S = never> = { params: P; result: R; stream: S };
type InProject<P = object> = { project: ProjectId } & P;

/** Every method of the first version: the contract's, and the ones written here until the companion offers them. */
export interface Methods extends Contract.ContractMethods {
  'locations.list': Of<object, TrustedLocation[]>;
  'project.requestAdd': Of<{ path: string }, { id: ProjectId; class: ProjectClass; via: Via }>;
  'project.requestMine': Of<InProject, { class: 'mine' }>;
  'project.setView': Of<InProject, { class: 'view' }>;
  'project.remove': Of<InProject, object>;
  'env.requestCapture': Of<object, { capturedAt: number; path: string[] }>;
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
      expect: { files: { path: string; diskHash?: string | null }[] };
    }>,
    { rolledBack: string[]; trashed: string[] }
  >;
  'git.undoCommit': Of<InProject<{ headSha?: string | null }>, { message: string; paths: string[] }>;
  'git.push': Of<
    InProject<{ expect: { headSha?: string | null; remote: string; branch: string } }>,
    PushResult,
    OutputLine
  >;
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

/** An event: about a project the page subscribed to, or about the companion (`project` null). */
type EventOf<N extends string, D> = { name: N; project: ProjectId | null; data: D };

export type CompanionEvent =
  | { [N in keyof Contract.ContractEvents]: EventOf<N, Contract.ContractEvents[N]> }[keyof Contract.ContractEvents]
  // Not in the contract yet: the companion's own history and pause (its later stages).
  | EventOf<'history.appeared', { paths: string[] }>
  | EventOf<'history.gap', { from: number; to: number; paths: number }>
  | EventOf<'companion.paused', Record<string, never>>
  | EventOf<'companion.resumed', Record<string, never>>;

export type EventName = CompanionEvent['name'];

// ---- errors -----------------------------------------------------------------------------------------------------

/** An error in the API's one form: a code, an English message without paths outside the project, data by code. */
export class CompanionError extends Error {
  readonly code: Contract.ErrorCode;
  readonly data: Readonly<Record<string, unknown>> | undefined;

  constructor(code: Contract.ErrorCode, message: string, data?: Record<string, unknown>) {
    super(message);
    this.name = 'CompanionError';
    this.code = code;
    this.data = data;
  }
}

export const isCompanionError = (error: unknown, code?: Contract.ErrorCode): error is CompanionError =>
  error instanceof CompanionError && (code === undefined || error.code === code);
