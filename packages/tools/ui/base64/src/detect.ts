/**
 * Does pasted text look like the Base64 tool's input (docs/tools/specs/base64.md §7)? The package's `./detect` export, a
 * module of its own: a host loads it only when pasted text needs it, never with the list of tools.
 */
export { detectBase64 as detect } from '@workspace/tool-logic-base64';
