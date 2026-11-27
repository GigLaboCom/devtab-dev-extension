/**
 * Every word the Projects section shows, in one place: the owner approves the section's texts, and most of them are
 * not in the specification yet (it leaves the wording to the owner, §8.5). Each is minimal and factual; the ones the
 * specification gives (in Russian) are its meaning in English, marked `spec`.
 */
export const TEXT = {
  title: 'Projects',
  hint: 'Your local repositories: files, changes, commits and history.',

  // The demo's notice (§8.1: «demo with the strip "This is an example"»).
  demoBadge: 'Example',
  demoNotice:
    'This is an example with invented projects. Nothing here is on your computer, and nothing is kept: a reload starts it again.',
  demoCompanion:
    'With the DevTab.Dev Companion installed (macOS), this section shows the projects you add on your computer: their files, changes, commits and local history.',

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
  savesInOne: (n: number) => `${n} saves`,

  // Errors any call may meet.
  failed: (message: string) => `Failed: ${message}`,
} as const;

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
