/**
 * Texts handed to «Compare code» by another part of this page — a tool sending the person here
 * (`ToolHost.navigation`, src/tools/navigation.ts). Like the start page's hand-off to a tool (app/handoff.ts) they live
 * in this module's memory only — never in the address, never in storage — and go when the page takes them (the
 * default TextSource's `handed`) or the tab closes. The same tab keeps the same document across the hash change.
 */

/** A handed text: its content and, when the sender gave one, a name (a file's, which tells the language). */
export interface HandedCompareText {
  text: string;
  name: string | null;
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
