/**
 * Texts handed to «Compare code» by another part of this page — a tool sending the person here
 * (`ToolHost.navigation`, src/tools/navigation.ts). Like the start page's hand-off to a tool (app/handoff.ts) they live
 * in this module's memory only — never in the address, never in storage — and go when the page takes them (the
 * default TextSource's `handed`) or the tab closes. The same tab keeps the same document across the hash change.
 */

/**
 * A text that is a project's file as the Projects section showed it (its «Open in Compare code», the companion's
 * specification §7.6): Save writes the side back into the project — `file.save` from `baseHash`, through the backend
 * the section had (`backend`), so a file changed on disk meanwhile is not overwritten. Data only: which file, which
 * version; how it is saved is the composition root's (behaviors.ts).
 */
export interface ProjectFileOrigin {
  project: string;
  path: string;
  /** The version of the file the text is (`file.read.hash`). */
  baseHash: string;
  /** Which of the section's backends has the project: the companion's, or the demo's invented one. */
  backend: 'companion' | 'demo';
}

/** A handed text: its content and, when the sender gave one, a name (a file's, which tells the language). */
export interface HandedCompareText {
  text: string;
  name: string | null;
  /** The project's file the text is, when it is one: Save writes it back there. */
  origin?: ProjectFileOrigin;
}

let pending: readonly HandedCompareText[] | null = null;

/** Keeps texts for the comparison to take when it opens: the original, then the changed text. */
export const handToCompare = (texts: readonly HandedCompareText[]): void => {
  pending = texts.length ? texts : null;
};

/** The texts waiting for the comparison, once: the next call finds none. */
export const takeHandedTexts = (): readonly HandedCompareText[] => {
  const texts = pending ?? [];
  pending = null;
  return texts;
};

/** Drops texts nobody took (a newer navigation supersedes them). */
export const clearHandedTexts = (): void => {
  pending = null;
};
