/**
 * The composition root of «Compare code» (AGENTS.md, "Replaceable Behavior"): the one place that picks the
 * implementation behind each of its shell seams. The comparison itself is not here — it lives in Rust, in the editor's
 * module (crates/review-view). Components receive `CompareBehaviors` and never import an implementation.
 *
 *   TextSource       where a side's text comes from when it is a file: the file chooser and drops (textSource.ts)
 *   Clipboard        Paste and Copy of a side (clipboard.ts)
 *   ExampleSource    what the page shows when nothing is loaded (examples.ts)
 *   SideSaver        how a side is saved: File System Access where the browser has it, a download otherwise
 *                    (sideSaver.ts)
 *   ConfirmDiscard   how the page asks before new text replaces unsaved edits (below)
 *   CompareAction    the toolbar: the list of actions (actions.ts)
 */
import { compareActions } from './actions';
import { navigatorClipboard } from './clipboard';
import { bundledExamples } from './examples';
import { chooseSaver } from './sideSaver';
import { browserTextSource } from './textSource';
import type { ActionBehaviors, CompareAction } from './actions';
import type { SavePicker } from './sideSaver';
import type { OpenPicker } from './textSource';

/** Seam `ConfirmDiscard`: true when the user agrees to lose a side's unsaved edits. */
export type ConfirmDiscard = (question: string) => Promise<boolean>;

/** The browser's own confirmation dialog (it blocks the page until answered, as Meld's question does). */
export const windowConfirm =
  (win: Pick<Window, 'confirm'>): ConfirmDiscard =>
  question =>
    Promise.resolve(win.confirm(question));

export interface CompareBehaviors extends ActionBehaviors {
  confirmDiscard: ConfirmDiscard;
  actions: readonly CompareAction[];
}

export const compareBehaviors = (win: Window & OpenPicker & SavePicker): CompareBehaviors => ({
  texts: browserTextSource(win),
  clipboard: navigatorClipboard(win.navigator.clipboard),
  examples: bundledExamples(),
  saver: chooseSaver(win),
  confirmDiscard: windowConfirm(win),
  actions: compareActions,
});
