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
  refusedState: (text: string) => `Not saved: ${text}`,
  refusedShort: 'Not saved', // spec: «не сохранён»
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
  hookToolMissing: (hook: string, tool: string) => `${hook} did not find ${tool}. Nothing was committed.`,
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

  // ---- stages 4–6: classes, adding, writing files, committing. Working texts: the owner approves them. ----------

  // The list page and the connection (§3.6, §8.5).
  addProject: 'Add project…',
  addProjectTitle: 'Add a project',
  addProjectBody:
    'The folder of a git repository on this computer. Inside a trusted folder it is added at once and writable; elsewhere the companion asks you first.',
  addProjectPath: 'Full path of the folder',
  addProjectPlaceholder: '/path/to/project',
  addProjectAbsolute: 'Type the full path, starting with /. A ~ is not expanded.',
  addProjectRun: 'Add',
  notInitialised: 'The companion is installed but not set up yet. Run this in Terminal:', // spec: «Выполните devtab init в Terminal»
  notInitialisedCommand: 'devtab init',
  noFoldersYet: 'With a trusted folder, projects inside it are added writable at once:',
  // Waiting for the companion's window (§8.5 `awaiting-confirmation`).
  awaiting: 'Confirm in the companion’s window.', // spec: «подтвердите в окне компаньона»
  copyCommand: (command: string) => `Copy the command ${command}`,
  terminalCommand: 'Command for Terminal',

  // A project's class (§3.2, §8.4 «Класс проекта»).
  viaTerminal: 'set in the terminal',
  viaDialog: 'confirmed in the companion’s window',
  viaPerson: 'made read only by you',
  viaFolderGone: 'its trusted folder was removed, so it is read only again', // spec: «расположение удалено → просмотр с пояснением»
  madeMine: 'The project is writable now.',
  madeView: 'The project is read only now.',
  removeProject: 'Remove…',
  removeProjectTitle: (name: string) => `Remove ${name} from the companion?`,
  removeProjectBody:
    'The project leaves the list. Nothing in its folder changes, and the companion keeps its history; adding the folder again brings it back.',
  removeProjectRun: 'Remove',

  // Files: create, rename, delete (§4.6 «Записи файлов»).
  fileActions: 'File actions',
  newFile: 'New file…',
  newFolder: 'New folder…',
  renameFile: 'Rename…',
  deleteFile: 'Delete…',
  newFileTitle: 'New file',
  newFolderTitle: 'New folder',
  renameTitle: (path: string) => `Rename ${path}`,
  pathInProject: 'Path in the project',
  create: 'Create',
  renameRun: 'Rename',
  noTrash: 'The companion cannot move files to the Trash yet. Delete the file in Finder or the terminal.',
  writeReadOnly: 'The project is read only.',
  noOpenFile: 'Open a file first.',
  created: (path: string) => `Created ${path}.`,
  renamed: (from: string, to: string) => `Renamed ${from} to ${to}.`,
  deleted: (path: string) => `Moved ${path} to the Trash.`,
  deleteFileTitle: (path: string) => `Delete ${path}?`,
  deleteFileBody: 'It goes to the Trash; the companion keeps a copy of it first.',
  deleteRun: 'Delete',

  // Committing (§6.1–§6.8).
  pushNotOffered: 'This companion cannot push yet.',
  hooksWillRun: (hooks: string) => `Hooks that run: ${hooks}`,
  hooksWereSkipped: (hooks: string) => `Skipped: ${hooks}.`,
  indexKept: (paths: string) => `A different version staged in the terminal stays in the index: ${paths}.`, // spec §6.1 п. 7
  hookChangedCommit: (paths: string) => `A hook changed what was committed: ${paths}.`,
  changedAfter: (paths: string) => `A hook changed files on disk: ${paths}.`,
  hookOutput: 'Output of git and the hooks',
  retry: 'Try again',
  captureAgain: 'Capture the environment again…', // spec §6.3: «Снять окружение заново…»
  undoCommitTitle: 'Undo last commit',
  rollbackNoTrash: 'The companion cannot move files to the Trash yet: added files stay on disk.',
  rollbackBefore: 'The companion keeps each file’s current text as “Before rollback” first.',

  // What the companion refused, in the page's words: by the error's code and its data, never its message.
  errors: {
    invalidParams: 'The companion did not take the request.',
    invalidPath:
      'That is not a path inside the project: no “..”, “.” or empty parts, no backslash, no control characters.',
    notFound: 'It is not there any more.',
    addNotFound: 'No such folder, or it is not a git repository the companion may add.', // one answer for every refusal (S7)
    outsideProject: 'The path leads outside the project, through a link.',
    protectedGitDir: 'Files inside .git are never written from the page.',
    protectedSymlink: 'This is a link: the page does not write through links.',
    protectedReadOnlyFile: 'The file is read only on disk.',
    protectedGitFilter: 'Bringing this file back would run a filter of the repository. Roll it back in the terminal.',
    protectedSubmodule: 'A submodule is not rolled back from the page.',
    protectedOther: 'This place is protected: the page does not write it.',
    secretFile: 'This file holds secrets: it is read only from the page.',
    notMine: 'The project is read only. Make it writable first.',
    paused: 'The companion has paused writing. To resume, run:',
    pausedCommand: 'devtab resume',
    binary: 'This is a binary file: the page does not edit it.',
    tooLarge: (limit: string) => `The text is larger than the companion takes (${limit}).`,
    tooManyFiles: (size: number, limit: number) =>
      `The folder holds ${size.toLocaleString('en-US')} files; the companion moves at most ${limit.toLocaleString('en-US')} at once.`,
    exists: 'Something with that name is already there.',
    staleHead: 'The repository moved on since the changes were shown. The list is updated; check them again.',
    nothingSelected: 'Nothing to commit: the checked files hold no change against HEAD.',
    hunksUnsupported: (path: string, why: string) =>
      `${path} can only be committed whole: ${why}. Check the whole file.`,
    hunkReasons: {
      binary: 'it is binary',
      'not-utf8': 'it is not UTF-8',
      conflicted: 'it has a conflict',
      renamed: 'it is renamed',
      deleted: 'it is deleted',
      submodule: 'it is a submodule',
      'line-ends': 'a line ends with a lone carriage return',
      'new-file': 'it is a new file',
      'does-not-apply': 'the checked chunks no longer apply',
      'too-large': 'it is too large',
      'not-a-file': 'it is not a regular file',
    } as Record<string, string>,
    hookFailedNext:
      'Fix what it reports and commit again, or uncheck “Run Git hooks” to skip pre-commit and commit-msg.',
    hookToolPath: (when: string | null) =>
      when
        ? `The companion runs hooks with the PATH captured ${when}. Add the tool’s folder, or check the hook:`
        : 'The companion runs hooks with a default PATH: no environment was captured. Add the tool’s folder, or check the hook:',
    hookTimeout: (limit: string) => `A hook ran longer than ${limit} and was stopped. Nothing was committed.`,
    indexLocked:
      'Another git holds the repository’s lock file; nothing was done. Try again when it finishes. If no git is running, remove .git/index.lock in the terminal.',
    signingFailed: 'Signing the commit failed. Nothing was committed. Check the signing setup of your git:',
    undoUnavailable: {
      moved: 'The last commit is not the one shown any more. The list is updated.',
      pushed: 'The last commit is pushed, so it is not undone from the page.',
      merge: 'The last commit is a merge: it is not undone from the page.',
      root: 'The first commit of a branch is not undone from the page.',
      detached: 'HEAD is detached: there is no branch to undo the commit on.',
    } as Record<string, string>,
    undoUnavailableOther: 'The last commit cannot be undone from the page.',
    operationInProgress: (operation: string) =>
      `A ${operation} is in progress in this repository. Finish or abort it in the terminal; nothing was committed.`,
    confirmationDeclined: 'The request was declined in the companion’s window.',
    noWindow: 'The companion cannot ask you in a window yet. Run this in Terminal instead:',
    requestsOff: 'After three declines the companion takes no more requests from the page. To take them again, run:',
    confirmationBusy: 'The companion is already asking about something else. Answer that window first.',
    rateLimited: (seconds: number) => `Too many requests at once. Try again in ${seconds} s.`,
    gitBusy: (seconds: number) => `Another git operation is running in this project. Try again in ${seconds} s.`,
    serverRestarting: 'The companion’s server is restarting. Try again in a moment.',
    cancelled: 'Cancelled.',
    trashUnavailable: 'The companion cannot move files to the Trash yet: nothing was deleted.',
    diskLow: (free: string, floor: string) =>
      `Too little free disk space for the companion to keep a copy first (${free} free, ${floor} needed). Nothing was written.`,
    notEncodable: (encoding: string) => `The text has characters ${encoding} cannot hold. Nothing was written.`,
    notRunning: 'The companion is not connected.',
    unsupportedVersion: 'The companion and this extension speak different versions. Update the older one.',
    peerNotAllowed: 'The companion did not allow this connection.',
    tooManyConnections: 'The companion has as many pages connected as it takes. Close another Projects tab.',
    internal: 'The companion failed. Its debug log has the details.',
    confirmationRequired: 'The companion waits for you to confirm in its window.',
    other: (code: string) => `The companion refused (${code}).`,
  },

  // ---- stage 7: the local history on the companion's data (§7.5, §7.6), and what its newer answers let the page say
  // (whether HEAD can be undone). Working texts: the owner approves them. ------------------------------------------
  history: {
    notOffered: 'This companion does not keep a history yet.',
    // A companion of stage 6 or older: the feeds read, restoring and clearing are not there (no request is sent).
    readOnlyCompanion: 'This companion cannot restore versions or clear the history yet.',
    viewProject: 'The project is read only: versions can be compared, not restored.',
    sinceVisit: 'Since your last visit',
    sinceVisitCount: (files: number) => `Since your last visit (${files})`,
    sinceVisitEmpty: 'Nothing changed since your last visit.',
    sinceVisitFrom: (when: string) => `Changes since ${when}, when you last left this project.`,
    gap: (from: string, to: string) =>
      `The history may be incomplete: the companion was not running from ${from} to ${to}.`, // spec §7.5
    showMore: 'Show more',
    deletedTitle: 'Deleted files',
    deletedOf: (path: string) => `History of ${path}, deleted`,
    deletedSubject: (path: string) => `${path} is deleted. Restoring a version creates it again.`,
    backToOpenFile: 'Back to the open file',
    sourceCommit: 'Commit',
    noContent: 'No version kept', // spec: «версия не сохранена»
    noContentTitle: 'The companion noted this moment but kept no text of it.',
    openInCompare: 'Open in Compare code',
    restoreDeletedBody: (path: string, when: string) =>
      `${path} was deleted. It will be created again from its version of ${when}.`,
    restoredDeleted: 'Restored: the file is back.',
    undone: 'The restore is undone.',
    clear: 'Clear history…',
    cleared: 'The local history of this project is cleared.',
    purgeNoWindow:
      'Clearing the history needs your confirmation, and the companion cannot ask in a window yet. Run this in Terminal:',
    restoreConflict: 'The file changed since this was asked. Nothing was written; look at it again.',
    pointGone: 'This version is not there any more, or it is not one of this file’s.',
    restoreNotEncodable: (encoding: string) =>
      `This version cannot be written in the file’s encoding (${encoding}). Nothing was written.`,
    // «Compare code» saving a side that came from a project.
    compareNotConnected: 'Not saved: the companion that has this project is not connected.',
    compareConflict:
      'Not saved: the file changed on disk since it was opened here. Open it from Projects again to compare.',
    compareFailed: (text: string) => `Not saved: ${text}`,
  },
  // Why the last commit cannot be undone, as the companion says beforehand (`git.status.headUndoReason`).
  headUndo: {
    unknown: 'The companion could not check whether the last commit can be undone.',
  },

  // ---- files opened from the system (D42, step O2): the «Files» group, a file's editor, a file arriving. Working
  // placeholders: the owner writes these texts (D40: the free edition's line is quiet, it offers a way out). -------
  openFiles: {
    title: 'Files',
    hint: 'Single files opened from your computer, outside any project.',
    empty: 'No files are open.',
    listLabel: 'Files opened from your computer',
    markReadOnly: 'read only',
    markExecutes: 'runs on its own',
    mark: 'File',
    forget: 'Forget',
    forgetOf: (name: string) => `Forget ${name}`,
    forgetTitle: 'Remove from this list and delete the companion’s copies of it. The file itself stays as it is.',
    settingsTitle: 'When a file arrives',
    reuseTab: 'Open it in this tab',
    bringForward: 'Bring this window to the front',
    // Pro only (the free edition does not name it).
    commandHint: 'To open a file here from Terminal:',
    command: 'devtab open <file>',
    // An open file.
    freeLine: 'Editing files opened from your computer is part of Pro.',
    copyToScratch: 'Copy to a scratch',
    // Why the companion keeps a file read only (its `reason`), one quiet sentence each.
    readOnly: {
      secret: 'Read only: this file holds secrets.',
      executes: 'Read only: this file runs on its own, and the companion is set to keep such files read only.',
      remote: 'Read only: this file is not on a disk of this computer.',
      'not-utf8': 'Read only: this file is not UTF-8 text.',
      'read-only-file': 'Read only: the file itself is read only on disk.',
      requested: 'Read only: it was opened read only.',
      replaced:
        'Read only: the file was replaced, moved or became a link since it was opened. Open it again from your computer to edit it.',
    } as Record<string, string>,
    readOnlyOther: 'Read only.',
    executes: 'This file runs on its own (a shell or system setting). It is written like any other file.',
    missing: 'This file is not in the list any more. Open it again from your computer.',
    notEditable: 'This file can only be read here now.',
    forgetConfirm: (name: string) => `Forget ${name}?`,
    forgetBody:
      'It leaves this list, and the companion deletes the copies it kept of it. The file itself stays as it is.',
    forgetRun: 'Forget',
    // A file arriving (event, route, or waiting since before the page connected).
    opening: 'Opening a file…',
    waitingConnect: 'A file waits to open here. Connect the companion to open it.',
    waitingCompanion: 'A file waits to open here once the companion is connected.',
    notOffered: 'This companion cannot open files from your computer yet.',
    expired: 'The link to this file has expired or was already used. Open the file again from your computer.',
  },
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
