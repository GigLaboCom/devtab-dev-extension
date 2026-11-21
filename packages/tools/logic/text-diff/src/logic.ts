/**
 * The Text Diff tool's logic (docs/tools/specs/text-diff.md). There is nothing to compute: the product has one
 * comparison, «Compare code» — the editor's wasm module — and Text Diff only leads there (§1; a second comparison is
 * out, §13). No `detect` either (§7): the comparison takes two texts and `detect` sees one. What is left is §4 as data:
 * where the tool leads and how.
 */

/** Where Text Diff leads: the host's comparison of two texts — `{ part: 'compare' }` of the host contract (§1, §4). */
export const DESTINATION = { part: 'compare' } as const;

/** The tool's own address is replaced, not added to: Back returns to where the person was before it (§2.2, §4). */
export const REPLACES_ADDRESS = true;
