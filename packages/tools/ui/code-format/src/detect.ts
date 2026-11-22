/**
 * Does pasted text look like the Code Formatter's input (docs/tools/specs/code-format.md §7)? The package's `./detect`
 * export, a module of its own: a host loads it only when pasted text needs it, never with the list of tools. It imports
 * the tool's own logic and nothing else — no Prettier, no saxes.
 */
export { detectCodeFormat as detect } from '@workspace/tool-logic-code-format';
