/**
 * Does pasted text look like this tool's input (its specification's §7)? The package's `./detect` export, a module of
 * its own: a host loads it only when pasted text needs it, never with the list of tools.
 */
export { detectUnixTime as detect } from '@workspace/tool-logic-unix-time';
