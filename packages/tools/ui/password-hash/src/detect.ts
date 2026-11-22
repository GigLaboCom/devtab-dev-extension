/**
 * Does pasted text look like the Password Hash tool's input (docs/tools/specs/password-hash.md §7)? The package's `./detect` export,
 * a module of its own: a host loads it only when pasted text needs it, never with the list of tools. It imports the
 * tool's own logic and nothing else.
 */
export { detectPasswordHash as detect } from '@workspace/tool-logic-password-hash';
