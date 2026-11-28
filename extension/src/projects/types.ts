/**
 * The companion's API as the Projects section sees it: identifiers, the methods with their requests and answers, the
 * streams, the events and the error codes (the companion's specification, §4.5–§4.7 and §4.11).
 *
 * Two sources. The methods, events and error codes the companion offers today come from its contract — the copy in
 * ./api/ and the types made from its schemas (./api/types.gen.ts, scripts/contract-sync.mjs); the companion's contract
 * is the source of truth for them, and the demo answers in the same shapes. The methods the companion does not offer
 * yet (the commits to push and push) are written here by hand after the specification's tables, until a newer contract
 * brings them.
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

/**
 * An opaque point of the local history: passed back as it came (`history.content`, `diff.sides`, `history.restore`),
 * never taken apart.
 */
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
/** A point as the page takes it: `content` is absent from a companion older than the field. */
type MaybeContent<T extends { content: boolean }> = Omit<T, 'content'> & { content?: boolean };
export type FilePoint = MaybeContent<Contract.HistoryPoint>;
export type ProjectPoint = MaybeContent<Contract.ProjectPoint>;
/** A stretch of time in which the companion did not watch the project (`history.file.gaps`, `historyGaps`). */
export type HistoryGap = Contract.Gap;
export type Restored = Contract.Restored;

export type TrustedLocation = Contract.LocationSummary;
export type CommitSelection = Contract.Selected;
export type ExpectedFile = Contract.ExpectedFile;
export type CommitParams = Contract.CommitParams;
export type CommitResult = Contract.CommitResult;
/** A part of a commit's (or a push's) output, streamed while it runs: git's and the hooks' text as it came. */
export type OutputLine = Contract.CommitOutput;
export type SaveParams = Contract.SaveParams;
export type Saved = Contract.Saved;

// ---- by hand, until the companion offers them --------------------------------------------------------------------

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
  'git.outgoing': Of<InProject, Outgoing>;
  'git.push': Of<
    InProject<{ expect: { headSha?: string | null; remote: string; branch: string } }>,
    PushResult,
    OutputLine
  >;
}

export type Method = keyof Methods;
export type Params<M extends Method> = Methods[M]['params'];
export type Result<M extends Method> = Methods[M]['result'];
export type StreamOf<M extends Method> = Methods[M]['stream'];

/**
 * The methods that write: only in a project of class «mine». A backend offers each on its own (the companion lists in
 * its `welcome` what it can do: no `file.delete` without a Trash, no push yet, no restore before its stage 7).
 */
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
  // Not in the contract yet: new points of the history (the demo's; the companion leaves it for later) and the pause.
  | EventOf<'history.appeared', { paths: string[] }>
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
