/**
 * The composition root of «Compare code» (AGENTS.md, "Replaceable Behavior"): the one place that picks the
 * implementation behind each of its shell seams. The comparison itself is not here — it lives in Rust, in the editor's
 * module (crates/review-view). Components receive `CompareBehaviors` and never import an implementation.
 *
 *   TextSource       where a side's text comes from when it is a file: the file chooser and drops (textSource.ts)
 *   Clipboard        Paste and Copy of a side (clipboard.ts)
 *   ExampleSource    what the page shows when nothing is loaded (examples.ts)
 *   SideSaver        how a side is saved: File System Access where the browser has it, a download otherwise
 *                    (sideSaver.ts); a side that is a project's file or a file opened from the computer (handed over
 *                    by the Projects section with its `origin`, handoff.ts): the same seam's `projectSaver` through the
 *                    Projects section's backend (src/projects/compareSaver.ts) — loaded when such a side is first
 *                    saved, so this chunk carries no code of the companion (Check 12 of scripts/validate-build.sh)
 *   ConfirmDiscard   how the page asks before new text replaces unsaved edits (below)
 *   CompareAction    the toolbar: the list of actions (actions.ts)
 */
import { compareActions } from './actions';
import { navigatorClipboard } from './clipboard';
import { bundledExamples } from './examples';
import { chooseSaver } from './sideSaver';
import { browserTextSource } from './textSource';
import type { ActionBehaviors, CompareAction } from './actions';
import type { CompanionFileOrigin } from './handoff';
import type { SavePicker, SideSaver } from './sideSaver';
import type { OpenPicker } from './textSource';

/** Seam `ConfirmDiscard`: true when the user agrees to lose a side's unsaved edits. */
export type ConfirmDiscard = (question: string) => Promise<boolean>;

/** The browser's own confirmation dialog (it blocks the page until answered, as Meld's question does). */
export const windowConfirm =
  (win: Pick<Window, 'confirm'>): ConfirmDiscard =>
  question =>
    Promise.resolve(win.confirm(question));

/**
 * The saver of the sides that are a companion's file (a project's, an opened one): one per handed file (the same
 * origin keeps its saver, so the next Save starts from the version the last one wrote), its implementation loaded on
 * the first Save.
 */
export const lazyProjectSavers = (
  load: () => Promise<(origin: CompanionFileOrigin) => SideSaver>,
): ((origin: CompanionFileOrigin) => SideSaver) => {
  const kept = new WeakMap<CompanionFileOrigin, SideSaver>();
  return origin => {
    const known = kept.get(origin);
    if (known) return known;
    let made: Promise<SideSaver> | null = null;
    const saver = (): Promise<SideSaver> => (made ??= load().then(make => make(origin)));
    const lazy: SideSaver = {
      name: 'project',
      save: request => saver().then(s => s.save(request)),
      saveAs: request => saver().then(s => s.saveAs(request)),
    };
    kept.set(origin, lazy);
    return lazy;
  };
};

export interface CompareBehaviors extends ActionBehaviors {
  confirmDiscard: ConfirmDiscard;
  actions: readonly CompareAction[];
}

export const compareBehaviors = (win: Window & OpenPicker & SavePicker): CompareBehaviors => ({
  texts: browserTextSource(win),
  clipboard: navigatorClipboard(win.navigator.clipboard),
  examples: bundledExamples(),
  saver: chooseSaver(win),
  projectSaver: lazyProjectSavers(() => import('../projects/compareSaver').then(m => m.compareProjectSaver)),
  confirmDiscard: windowConfirm(win),
  actions: compareActions,
});
