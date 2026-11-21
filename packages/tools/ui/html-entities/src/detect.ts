/**
 * Does pasted text look like the HTML Entities tool's input (docs/tools/specs/html-entities.md §7)? The package's `./detect` export,
 * a module of its own: a host loads it only when pasted text needs it, never with the list of tools. It imports the
 * tool's own logic and nothing else.
 */
export { detectHtmlEntities as detect } from '@workspace/tool-logic-html-entities';
