/**
 * What the history's places say in a build whose edition records nothing (`HistoryHost.included` false; D25,
 * docs/tools/settings-storage.md §9). Words only: nothing about a price or how to get Pro — that is not decided.
 */
export const HISTORY_EXCLUDED = {
  /** The line under a tool's title, without the links to History and Settings. */
  line: 'History is part of Pro: nothing is kept.',
  /** The one sentence of the History section and of Settings → History, in place of their content. */
  section: 'History is part of Pro. Nothing you do in the tools is kept in this version.',
} as const;
