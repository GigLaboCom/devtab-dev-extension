/**
 * Seam `Edition` — what differs between the free version and Pro (D21, D24, D25; docs/replaceable-behaviors.md). Every
 * tool works in full in both; Pro is the product's memory and its automatic copying. An edition is the list of what
 * stands behind each of those things in this build, and the host follows what that says about itself — never a
 * question "is this Pro?" asked somewhere else:
 *
 *   parameters        what keeps the tools' saved parameters (seam `ParameterStorage`, D23;
 *                     docs/tools/settings-storage.md): the browser's storage, so a tool opens with what the person chose
 *                     last time (Pro), or nothing, so it opens with its defaults on every visit (free). Whether a tool's
 *                     page offers "Reset settings" follows from that storage (it says whether it keeps anything).
 *   history           what stands behind the tool history (D17): where its records go and whether the tools' work is
 *                     recorded at all (docs/tools/settings-storage.md §9). Pro: the extension's IndexedDB, recording;
 *                     free: nothing is recorded, the database is never opened, and the history's places say so.
 *   automaticCopying  whether "Copy automatically after generating" exists (D24; docs/tools/copying.md). Pro: it does;
 *                     free: Settings has no switch for it and no generator copies by itself — a stored "on" has no
 *                     effect and is kept as it is. The Copy buttons work the same in both.
 *   scratches         whether the Projects section has scratch files (D34: files of no project, made, edited and
 *                     downloaded on the page). Whether they are Pro is the owner's decision and is not made: on in both
 *                     editions, so the answer is one line of ./pro.ts or ./free.ts. Off: the section shows no
 *                     «Scratches» group and opens no scratch; the ones kept are neither read nor deleted.
 *   editorProfiles    where the editor's profiles besides Default are kept (seam `EditorProfilesStore`, D39 stage 2;
 *                     src/editorSettings/profilesStore.ts). Pro: a record of their own in the browser's storage
 *                     (`editorProfiles`); free: none — the record is never opened, every editor uses the Default set
 *                     (which both editions keep), and Settings → Editor says in one line that profiles are part of Pro.
 *                     When Pro ends nothing is deleted: the record is not read, and it is there again with Pro.
 *   projectEditorSettings  what a project of the Projects section says about its files (seam `ProjectEditorSettings`,
 *                     D39 stage 3; src/editorSettings/project.ts). Pro: its `.editorconfig` files, read through the
 *                     backend's read method; free: nothing is read at all, and the indicator of a project's file says
 *                     in one line that a project's .editorconfig is part of Pro.
 *   openFiles         what the Projects section does with a file opened from the system (D42: «Open With»,
 *                     `devtab open <file>`). Pro (`edit`): the file is written as the companion's mode for it says, and the
 *                     section's help names the terminal command. Free (`read`): the file opens read only, with one quiet
 *                     line and «Copy to a scratch» (a way out without buying, D40), and nothing names the command. The
 *                     companion knows nothing of the edition; when Pro ends nothing is deleted — the list stays, the
 *                     files open read only. The one place where the line between Free and Pro is drawn for these files.
 *
 * The tools never see any of it: they get their settings, their history and whether to copy from their host either way
 * (D14). Which edition is in force is seam `EditionSource` (./source.ts): the composition root (index.ts) names a
 * source, and the host turns its state into one of these (editionFor, ./inForce.ts). There is no payment or licence
 * check yet: the root names a source fixed at build time, and the free build is that one line changed
 * (docs/defaults.md §2).
 */
import type { EditorProfilesStore } from '../editorSettings/profilesStore';
import type { ProjectEditorSettingsFactory } from '../editorSettings/project';
import type { EditorSettingsArea } from '../editorSettings/storage';
import type { HistoryPlace } from '../history/behaviors';
import type { BrowserStorage } from '../tools/settings';
import type { ParameterStorage } from '@workspace/tools-host';
import type { HistoryStore } from '@workspace/tools-shared/history';

/** What stands behind the tool history in an edition. */
export interface EditionHistory {
  /** Where the tools' records are kept and read from. */
  readonly store: HistoryStore;
  /**
   * Whether the tools' work is recorded at all. `false`: nothing is recorded — every tool is told its history is off —,
   * nothing of the history is read, and the host's own places (the tool page's line, History, Settings → History) say
   * the history is not part of this version instead of offering it.
   */
  readonly recording: boolean;
}

export interface Edition {
  /** For reports and tests. */
  readonly id: 'free' | 'pro';
  /** Seam `ParameterStorage`: what keeps the tools' saved parameters in this edition, given the browser's storage. */
  parameters(browser: BrowserStorage): ParameterStorage;
  /**
   * What stands behind the tool history in this edition, given the place the host offers for it. Called at most once
   * per page for each edition (when the edition in force changes on an open page, the host asks the other one for its
   * history); an edition that does not record leaves the place alone (a database there is neither opened, read nor
   * deleted).
   */
  history(place: HistoryPlace): EditionHistory;
  /** Whether "Copy automatically after generating" exists in this edition (the setting and the copying it does). */
  readonly automaticCopying: boolean;
  /** Whether the Projects section has scratch files in this edition (D34; Free or Pro is not decided yet). */
  readonly scratches: boolean;
  /**
   * Seam `EditorProfilesStore`: where the editor's profiles besides Default are kept, given the browser's storage (an
   * edition without profiles never touches it). Called at most once per page for each edition.
   */
  editorProfiles(browser: EditorSettingsArea): EditorProfilesStore;
  /** Seam `ProjectEditorSettings`: what a project says about its files (an edition without it reads nothing). */
  readonly projectEditorSettings: ProjectEditorSettingsFactory;
  /** Files opened from the system (D42): written as the companion allows (`edit`), or shown read only (`read`). */
  readonly openFiles: OpenFilesEdition;
}

/** What an edition does with a file opened from the system. */
export type OpenFilesEdition = 'edit' | 'read';
