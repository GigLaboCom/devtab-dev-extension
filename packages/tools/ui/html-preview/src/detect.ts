/**
 * Does pasted text look like the HTML Preview tool's input (docs/tools/specs/html-preview.md §7) — a whole HTML
 * document? The package's `./detect` export, a module of its own: a host loads it only when pasted text needs it, never
 * with the list of tools. It imports the tool's own logic and nothing else.
 */
export { detectHtmlDocument as detect } from '@workspace/tool-logic-html-preview';
