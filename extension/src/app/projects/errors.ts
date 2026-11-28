/**
 * What a refusal of the companion says on the page: the page's own words (./text.ts), chosen by the error's code and its
 * data — never the companion's `message`, which is English for its log and not written for the person. What the
 * companion sends that is shown — a path, a hook's output, a command for the terminal — is shown as text through
 * `printable` / `terminalText` (S17): a hostile repository's strings do not become markup or act as a terminal's
 * escape sequences.
 *
 * `Said` is the sentence, and where the person can act: a command to run in Terminal (shown verbatim, copyable), more
 * commands, the output of git or a hook (monospaced).
 */
import { TEXT, formatSize, formatTime, printable, terminalText } from './text';
import { isCompanionError } from '@src/projects/types';

export interface Said {
  text: string;
  /** A command for Terminal, shown verbatim and copyable. */
  command?: string;
  /** More commands, each its own line. */
  commands?: string[];
  /** The output of git or a hook, shown monospaced. */
  output?: string;
}

/** What the person was doing: some codes read differently by it. */
export type ErrorContext =
  | 'read'
  | 'save'
  | 'write'
  | 'add'
  | 'class'
  | 'remove'
  | 'commit'
  | 'rollback'
  | 'undo'
  | 'capture'
  | 'restore'
  | 'purge'
  | 'claim';

const str = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

const seconds = (ms: number | null): number => Math.max(1, Math.ceil((ms ?? 1000) / 1000));

const duration = (ms: number | null): string => {
  if (ms === null) return '5 minutes';
  const minutes = Math.round(ms / 60_000);
  if (minutes >= 1) return minutes === 1 ? '1 minute' : `${minutes} minutes`;
  return `${seconds(ms)} s`;
};

/** The page's words for an error of a call. Anything not from the companion is the page's own failure. */
export const errorText = (error: unknown, context: ErrorContext, project?: string): Said => {
  if (!isCompanionError(error)) return { text: TEXT.failed(error instanceof Error ? error.message : String(error)) };
  const data = error.data ?? {};
  const E = TEXT.errors;
  const command = str(data.command);
  switch (error.code) {
    case 'invalid-params':
      return { text: E.invalidParams };
    case 'unknown-method':
      return { text: TEXT.notOffered };
    case 'invalid-path':
      return { text: E.invalidPath };
    case 'not-found':
      return {
        text:
          context === 'add'
            ? E.addNotFound
            : context === 'restore'
              ? TEXT.history.pointGone
              : context === 'claim'
                ? TEXT.openFiles.expired
                : E.notFound,
      };
    case 'outside-project':
      return { text: E.outsideProject };
    case 'protected-path':
      switch (str(data.rule)) {
        case 'git-dir':
        case '.git':
          return { text: E.protectedGitDir };
        case 'symlink':
          return { text: E.protectedSymlink };
        case 'read-only-file':
          return { text: E.protectedReadOnlyFile };
        case 'git-filter':
          return { text: E.protectedGitFilter };
        case 'submodule':
          return { text: E.protectedSubmodule };
        default:
          return { text: E.protectedOther };
      }
    case 'secret-file':
      return { text: E.secretFile };
    case 'not-mine':
      return { text: E.notMine };
    case 'paused':
      return { text: E.paused, command: E.pausedCommand };
    case 'binary':
      return { text: E.binary };
    case 'too-large': {
      const limit = num(data.limit);
      return { text: E.tooLarge(limit === null ? '5 MB' : formatSize(limit)) };
    }
    case 'too-many-files':
      return { text: E.tooManyFiles(num(data.size) ?? 0, num(data.limit) ?? 2000) };
    case 'conflict':
      return { text: context === 'restore' ? TEXT.history.restoreConflict : TEXT.conflictNotice };
    case 'exists':
      return { text: E.exists };
    case 'stale-selection': {
      const paths = Array.isArray(data.paths) ? data.paths.filter((p): p is string => typeof p === 'string') : [];
      return { text: paths.length ? TEXT.staleSelection : E.staleHead };
    }
    case 'hunks-unsupported': {
      const reason = str(data.reason) ?? '';
      return {
        text: E.hunksUnsupported(printable(str(data.path) ?? 'This file'), E.hunkReasons[reason] ?? printable(reason)),
      };
    }
    case 'nothing-selected':
      return { text: E.nothingSelected };
    case 'identity-missing':
      return { text: TEXT.noIdentity, command: TEXT.noIdentityCommand };
    case 'hook-failed': {
      const output = str(data.output);
      return {
        text: `${TEXT.hookFailed(printable(str(data.hook) ?? 'A hook'))} ${E.hookFailedNext}`,
        ...(output && { output: terminalText(output) }),
      };
    }
    case 'hook-tool-missing': {
      const output = str(data.output);
      const captured = num(data.pathCapturedAt);
      const id = project ?? '<project>';
      return {
        text: `${TEXT.hookToolMissing(printable(str(data.hook) ?? 'A hook'), printable(str(data.tool) ?? 'a program'))} ${E.hookToolPath(
          captured === null ? null : formatTime(captured),
        )}`,
        commands: [`devtab env path-add --project ${id} <folder>`, `devtab doctor --commit ${id}`],
        ...(output && { output: terminalText(output) }),
      };
    }
    case 'hook-timeout':
      return { text: E.hookTimeout(duration(num(data.afterMs))) };
    case 'index-locked':
      return { text: E.indexLocked };
    case 'signing-failed': {
      const output = str(data.output);
      return { text: E.signingFailed, ...(output && { output: terminalText(output) }) };
    }
    case 'undo-unavailable':
      return { text: E.undoUnavailable[str(data.reason) ?? ''] ?? E.undoUnavailableOther };
    case 'operation-in-progress':
      return { text: E.operationInProgress(printable(str(data.operation) ?? 'merge')) };
    case 'confirmation-declined':
      return { text: E.confirmationDeclined };
    case 'confirmation-unavailable':
      return {
        text:
          str(data.reason) === 'requests-off'
            ? E.requestsOff
            : context === 'purge'
              ? TEXT.history.purgeNoWindow
              : E.noWindow,
        ...(command && { command: printable(command) }),
      };
    case 'confirmation-busy':
      return { text: E.confirmationBusy };
    case 'rate-limited': {
      const wait = seconds(num(data.retryAfterMs));
      return {
        text:
          context === 'commit' || context === 'rollback' || context === 'undo' ? E.gitBusy(wait) : E.rateLimited(wait),
      };
    }
    case 'server-restarting':
      return { text: E.serverRestarting };
    case 'cancelled':
      return { text: context === 'commit' ? TEXT.commitCancelled : E.cancelled };
    case 'trash-unavailable':
      return { text: E.trashUnavailable };
    case 'disk-low':
      return { text: E.diskLow(formatSize(num(data.freeBytes) ?? 0), formatSize(num(data.floorBytes) ?? 0)) };
    case 'not-encodable': {
      const encoding = printable(str(data.encoding) ?? 'its encoding');
      return { text: context === 'restore' ? TEXT.history.restoreNotEncodable(encoding) : E.notEncodable(encoding) };
    }
    case 'not-running':
      return { text: E.notRunning };
    case 'unsupported-version':
      return { text: E.unsupportedVersion };
    case 'peer-not-allowed':
      return { text: E.peerNotAllowed };
    case 'too-many-connections':
      return { text: E.tooManyConnections };
    case 'internal':
      return { text: E.internal };
    case 'confirmation-required':
      return { text: E.confirmationRequired };
    case 'not-editable':
      return { text: TEXT.openFiles.readOnly[str(data.reason) ?? ''] ?? TEXT.openFiles.notEditable };
    case 'push-rejected':
    case 'push-remote-rejected':
    case 'push-auth-failed':
    case 'push-needs-input':
    case 'push-remote-ambiguous':
    case 'push-detached':
    case 'push-timeout':
    case 'push-network': {
      const output = str(data.output);
      return {
        text: TEXT.pushErrors[error.code] ?? E.other(error.code),
        ...(command && { command: printable(command) }),
        ...(output && { output: terminalText(output) }),
      };
    }
    default:
      return { text: E.other(printable(String(error.code))) };
  }
};

/** How it is said: a refusal that only says where to do it instead (the companion has no window) is no error. */
export const toneOf = (error: unknown): 'info' | 'error' =>
  isCompanionError(error, 'confirmation-unavailable') ? 'info' : 'error';

/** The sentence alone, where one line is all there is room for (a tooltip, the save state). */
export const errorLine = (error: unknown, context: ErrorContext, project?: string): string => {
  const said = errorText(error, context, project);
  return said.command ? `${said.text} ${said.command}` : said.text;
};
