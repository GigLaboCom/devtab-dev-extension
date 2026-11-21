/**
 * Does pasted text look like the URL tool's input (docs/tools/specs/url.md §7)? The package's `./detect` export, a
 * module of its own: a host loads it only when pasted text needs it, never with the list of tools.
 */
export { detectUrl as detect } from '@workspace/tool-logic-url';
