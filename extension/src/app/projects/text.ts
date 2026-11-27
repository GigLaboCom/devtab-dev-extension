/**
 * Every word the Projects section shows, in one place: the owner approves the section's texts, and most of them are
 * not in the specification yet (it leaves the wording to the owner, §8.5). Each is minimal and factual; the ones the
 * specification gives (in Russian) are its meaning in English, marked `spec`.
 */
import type { ScratchRefusal } from '@src/projects/scratch/store';

export const TEXT = {
  title: 'Projects',
  hint: 'Your local repositories: files, changes, commits and history.',

  // The demo's notice (§8.1: «demo with the strip "This is an example"»).
  demoBadge: 'Example',
  demoNotice:
    'This is an example with invented projects. Nothing here is on your computer, and nothing is kept: a reload starts it again.',
  demoCompanion:
    'With the DevTab.Dev Companion installed (macOS), this section shows the projects you add on your computer: their files, changes, commits and local history.',

  // The connection to the companion (§8.3, §8.5). Working placeholders: the owner writes these texts.
  connectionLabel: 'Companion',
  connect: 'Connect the companion',
  connectAsked: 'Chrome asks whether to allow it.',
  connectDenied: 'Chrome did not allow it.',
  connecting: 'Connecting…',
  checkAgain: 'Check again',
  notInstalled: 'The companion is not installed. It runs on macOS only.',
  notRunning: 'The companion is installed but not running.',
  notRunningCommand: 'devtab doctor',
  retryIn: (seconds: number) => `Trying again in ${seconds} s.`,
  updateCompanion: 'The companion is older than this extension: update the companion.',
  updateExtension: 'This extension is older than the companion: update the extension.',
  reconnecting: 'Reconnecting to the companion…',
  connected: (version: string) => `Companion ${version}`,
  said: (detail: string) => `It said: ${detail}`,
  // An action the connected companion does not offer yet (its `welcome` does not list the method).
  notOffered: 'This companion cannot do this yet.',
  foldersNotOffered: 'This companion does not list trusted folders yet.',

  // The list of projects and the trusted folders (§3.7а, §8.4).
  projectsTitle: 'Projects',
  outsideFolders: 'Outside trusted folders',
  noProjects: 'No projects yet.',
  noProjectsCommand: 'cd <project> && devtab add',
  projectMissing: 'The folder is missing',
  foldersTitle: 'Trusted folders',
  foldersHint: 'Projects in a trusted folder are writable when added. Folders are set in the terminal, not here.',
  noFolders: 'No trusted folders.',
  noFoldersCommand: 'devtab trust <folder>',
  folderProjects: (n: number) => (n === 1 ? '1 project' : `${n} projects`),
  folderReadOnly: 'read only',

  // A project's bar and its class (§3.2, §8.4 «Класс проекта»).
  allProjects: 'All projects',
  goToFile: 'Go to file',
  classMine: 'Writable',
  classView: 'Read only',
  viaFolder: (name: string) => `via ${name}`,
  makeMine: 'Make writable…',
  makeView: 'Make read only',
  makeMineCommand: 'devtab add --write',
  viewExplained: 'This project is read only: nothing can be written from the page.',
  findInFiles: 'Find in files…',

  // The panels around the editor (D35). Working placeholders: the owner writes these texts.
  sidePanel: 'Side panel',
  bottomPanel: 'Bottom panel',
  hideSidePanel: 'Hide the side panel',
  hideBottomPanel: 'Hide the bottom panel',
  showBottomPanel: 'Show the bottom panel',
  resizeSidePanel: 'Resize the side panel',
  resizeBottomPanel: 'Resize the bottom panel',
  withChanges: (label: string, files: number) => `${label}, ${files} changed ${files === 1 ? 'file' : 'files'}`,
  showHistory: 'Show history',

  // The tree (§8.4 «Дерево»).
  treeLabel: 'Files',
  loading: 'Loading…',
  emptyFolder: 'Empty folder',
  truncated: 'Not every entry is shown.',
  markIgnored: 'Ignored',
  markSecret: 'Secret: read only',
  markRunsCode: 'Runs code',
  markLinkOutside: 'Link outside the project',

  // Quick open (§8.4 «Быстрый переход»).
  quickOpenTitle: 'Go to file',
  quickOpenPlaceholder: 'File name',
  noMatches: 'No matches',

  // Search (§8.4 «Поиск»).
  searchLabel: 'Find in files',
  searchPlaceholder: 'Text to find',
  searchRun: 'Find',
  searchCancel: 'Cancel',
  searchRegex: 'Regex',
  searchCase: 'Match case',
  searchWord: 'Whole word',
  searchIgnored: 'Include ignored folders',
  searching: 'Searching…',
  searchCancelled: 'Cancelled.',
  searchSummary: (matches: number, files: number) =>
    `${matches} ${matches === 1 ? 'match' : 'matches'} in ${files} ${files === 1 ? 'file' : 'files'}`,
  searchTruncated: 'Only the first matches are shown.',

  // The editor (§8.4 «Редактор», §8.6а).
  editorTitle: 'Editor',
  noFile: 'Open a file from the tree.',
  modeFile: 'File',
  modeDiff: 'Diff',
  binary: (size: string) => `Binary file, ${size}`,
  tooLarge: (size: string) => `Too large to show (${size})`,
  outsideLink: 'This link leads outside the project and is not opened.',
  readOnlySecret: 'Read only: this file holds secrets.',
  readOnlyView: 'Read only: the project is read only.',
  runsCode: 'This file runs code (it is written like any other file).',
  savedState: 'Saved', // spec: «сохранён»
  savingState: 'Saving…', // spec: «сохраняется…»
  pendingState: 'Edited',
  conflictState: 'Not saved: conflict', // spec: «не сохранён: конфликт»
  offlineState: 'Not saved: no connection to the companion', // spec: «не сохранён: нет связи с компаньоном»
  refusedState: (message: string) => `Not saved: ${message}`,
  conflictNotice: 'The file changed on disk while you were editing it.', // spec: «показываем что изменился»
  keepMine: 'Keep mine', // spec: «keep memory overwrite»
  applyExternal: 'Apply the external change', // spec: «применить внешние правки»
  showComparison: 'Show the comparison', // spec: «можно показать сравнительную превьюху»
  backToFile: 'Back to the file',
  updatedFromDisk: 'Updated from disk', // spec: «обновлён с диска»
  comparing: (a: string, b: string) => `${a} ↔ ${b}`,
  current: 'Current',
  head: 'HEAD',
  mine: 'Mine',
  onDisk: 'On disk',

  // The commit window (§6, §8.4 «Коммит»).
  commitTitle: 'Commit',
  // A read-only project's Commit view, in place of the message and the buttons (D35). Working placeholders.
  commitReadOnly: 'This project is read only: its changes and diffs can be looked at, not committed.',
  commitNotOffered: 'This companion cannot commit yet: the changes and diffs can be looked at.',
  refresh: 'Refresh',
  rollback: 'Rollback…',
  showDiff: 'Show diff',
  expandAll: 'Expand all',
  collapseAll: 'Collapse all',
  groupByFolder: 'Group by folder',
  changes: 'Changes',
  unversioned: 'Unversioned Files', // as IntelliJ names it (§6.0)
  clean: 'No changes.',
  stagedOutside: 'Staged in the terminal',
  conflicted: 'Conflict: resolve it in the terminal', // spec: «решите конфликт в терминале»
  wholeFileOnly: 'Whole file only',
  chunksOf: (path: string) => `Chunks of ${path}`,
  chunk: (index: number, start: number, lines: number) =>
    lines === 0
      ? `Chunk ${index + 1}: removed after line ${start}`
      : `Chunk ${index + 1}: lines ${start + 1}–${start + lines}`,
  message: 'Commit message',
  recentMessages: 'Recent messages',
  runHooks: 'Run Git hooks', // as IntelliJ names it (§6.4)
  hooksSkipped: 'Skips pre-commit and commit-msg; prepare-commit-msg and post-commit still run.', // spec §6.4
  branchLine: (branch: string, upstream: string | null, ahead: number) =>
    `${branch} → ${upstream ?? 'no upstream'}${ahead ? ` · ${ahead} to push` : ''}`,
  noIdentity: 'Git has no name or e-mail for commits. Set them in the terminal:',
  noIdentityCommand: 'git config --global user.email "you@example.com"',
  checked: (files: number, chunks: number) =>
    `${files} ${files === 1 ? 'file' : 'files'} checked${chunks ? `, ${chunks} ${chunks === 1 ? 'chunk' : 'chunks'}` : ''}`,
  commit: 'Commit',
  commitAndPush: 'Commit and Push…',
  cancel: 'Cancel',
  committing: 'Committing…',
  committed: (files: number, sha: string) => `Committed ${files} ${files === 1 ? 'file' : 'files'} as ${sha}.`,
  undoCommit: 'Undo last commit',
  undone: 'The last commit is undone; its changes are back.',
  staleSelection: 'Files changed since they were shown. The list is updated; check them again.',
  hookFailed: (hook: string) => `${hook} failed. Nothing was committed.`,
  hookToolMissing: (tool: string) => `A hook did not find ${tool}. Nothing was committed.`,
  hookTimeout: 'A hook ran out of time and was stopped. Nothing was committed.',
  commitCancelled: 'The commit was cancelled. Nothing was committed.',

  // Rollback (§6.8).
  rollbackTitle: 'Rollback',
  rollbackSummary: 'All changes made to these files since the last commit will be discarded.', // IntelliJ's words (§6.0)
  rollbackDeleteAdded: 'Delete local copies of added files', // IntelliJ's words (§6.8)
  rollbackTrash: 'Deleted files go to the Trash.', // spec §5.4а: «в Корзину»
  rollbackRun: 'Rollback',
  rolledBack: (n: number) => `Rolled back ${n} ${n === 1 ? 'file' : 'files'}.`,
  undoRollback: 'Undo rollback',

  // Push (§6.9).
  pushTitle: 'Push',
  pushTarget: (branch: string, target: string) => `${branch} → ${target}`,
  pushSetsUpstream: 'The upstream will be set.', // spec: «будет установлен upstream»
  pushNothing: 'Nothing to push.',
  pushRun: 'Push',
  pushing: 'Pushing…',
  pushed: (n: number, target: string) => `Pushed ${n} ${n === 1 ? 'commit' : 'commits'} to ${target}.`,
  pushErrors: {
    'push-rejected': 'The remote branch has commits this one does not. Pull in the terminal, then push.', // spec: «сделайте pull в терминале»
    'push-remote-rejected': 'The remote refused the push.',
    'push-auth-failed': 'Git found no credentials for the remote. Push once in the terminal.',
    'push-needs-input': 'Git wanted to ask something in a terminal. Push in the terminal.',
    'push-remote-ambiguous': 'The project has no remote to push to. Push in the terminal.',
    'push-detached': 'HEAD is detached. Push in the terminal.',
    'push-timeout': 'The push ran out of time and was stopped.',
    'push-network': 'The remote could not be reached.',
  } as Record<string, string>,
  pushCommand: 'Command:',

  // History (§7.5, §7.6).
  historyLabel: 'History',
  historyFile: 'This file',
  historyProject: 'Project',
  historyEmpty: 'No history yet.',
  historyNoFile: 'Open a file to see its history.',
  compareWithCurrent: 'Compare with current',
  compareSelected: 'Compare the two selected',
  restore: 'Restore…',
  restoreTitle: 'Restore this version?',
  restoreBody: (path: string, when: string) =>
    `${path} will be replaced by its version of ${when}. The current version is kept in the history.`, // spec §7.6
  restoreRun: 'Restore',
  restored: 'Restored. The version it replaced is in the history.',
  undoRestore: 'Undo restore',

  // Scratch files (D34). Working placeholders: the owner writes these texts.
  scratchesTitle: 'Scratches',
  scratchesHint: 'Files of no project, kept in this browser. No companion needed.',
  scratchesNotKept: 'This page has no storage: scratches last only while it is open.',
  noScratches: 'No scratches yet.',
  newScratch: 'New scratch…',
  scratchMark: 'Scratch',
  scratchEdited: (when: string) => `Edited ${when}`,
  scratchLanguage: 'Language',
  renameScratch: 'Rename…',
  scratchName: 'Scratch name',
  downloadScratch: 'Download',
  deleteScratch: 'Delete…',
  deleteScratchOf: (name: string) => `Delete ${name}`,
  deleteScratchTitle: (name: string) => `Delete ${name}?`,
  deleteScratchBody: 'Its text is removed from this browser. To keep a copy, download it first.',
  deleteScratchRun: 'Delete',
  scratchMissing: 'This scratch no longer exists.',
  downloaded: (name: string, how: 'file' | 'download') =>
    how === 'file' ? `Saved as ${name}.` : `Downloaded ${name}.`,
  notDownloaded: (message: string) => `Not downloaded: ${message}`,
  tooManyScratches: (max: number) => `${max} scratches are kept at most. Delete one to make another.`,
  scratchTooLarge: (max: number) =>
    `Not saved: longer than ${max.toLocaleString('en-US')} characters. Shorten it, or download it to keep it.`,
  scratchStorageFull:
    'Not saved: the extension’s storage in this browser is full. Delete a scratch, or download this one.',
  scratchDeletedElsewhere: 'Not saved: this scratch was deleted in another tab. Download it to keep it.',
  scratchNotSaved: (message: string) => `Not saved: ${message}`,

  // The language popup and the keys of the section (D38). Working placeholders: the owner writes these texts.
  newScratchTitle: 'New scratch file',
  switchView: 'Switch file and diff',
  renameScratchTitle: 'Rename scratch',
  changeLanguageTitle: 'Change scratch language',
  downloadScratchTitle: 'Download scratch',
  deleteScratchTitleShort: 'Delete scratch',
  languageOf: (name: string) => `Language of ${name}`,
  languages: 'Languages',
  languageFilter: 'Filter languages',
  languageFilterPlaceholder: 'Type to filter',
  languageLast: 'Used last',
  noLanguage: (query: string) => `No language matches “${query}”.`,
  pickerMove: 'to move',
  pickerChoose: 'to choose',
  pickerClose: 'to close',

  // Errors any call may meet.
  failed: (message: string) => `Failed: ${message}`,
} as const;

/** What a scratch store's refusal says (D34): what was not kept, and what the person can do. */
export const scratchRefusal = (refusal: ScratchRefusal): string => {
  switch (refusal.kind) {
    case 'too-many':
      return TEXT.tooManyScratches(refusal.max);
    case 'too-large':
      return TEXT.scratchTooLarge(refusal.max);
    case 'full':
      return TEXT.scratchStorageFull;
    case 'missing':
      return TEXT.scratchDeletedElsewhere;
    case 'failed':
      return TEXT.scratchNotSaved(refusal.message);
  }
};

/**
 * A string from the repository (a name, a branch, a label, a line) as text to show: control characters — a terminal's
 * escape sequences among them (ANSI, OSC 8 links) — become visible symbols instead of acting (S17). One UTF-16 unit
 * for one, so the companion's column ranges still fit.
 */
export const printable = (text: string): string =>
  // eslint-disable-next-line no-control-regex
  text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, c => {
    const code = c.charCodeAt(0);
    return code < 0x20 ? String.fromCharCode(0x2400 + code) : code === 0x7f ? '\u2421' : '\ufffd';
  });

/**
 * A hook's or git's output as text (S17): a terminal's escape sequences — CSI (colours, cursor), OSC (titles, links:
 * `ESC]8;;…`) and the two-character ones — are removed, what control characters remain become visible.
 */
export const terminalText = (text: string): string =>
  printable(
    text
      // eslint-disable-next-line no-control-regex
      .replace(/\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)?/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/(\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/\u001b[@-_]/g, ''),
  );

/** A size in bytes as people read it. */
export const formatSize = (bytes: number): string =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** A point in time as the history lists it: the time today, the day and time before. */
export const formatTime = (ms: number, now = Date.now()): string => {
  const date = new Date(ms);
  const sameDay = new Date(now).toDateString() === date.toDateString();
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return sameDay ? time : `${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${time}`;
};
