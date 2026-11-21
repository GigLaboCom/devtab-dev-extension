/**
 * Does pasted text look like the UUID / ULID tool's input (docs/tools/specs/uuid.md §7)? The package's `./detect` export, a
 * module of its own: a host loads it only when pasted text needs it, never with the list of tools.
 */
export { detectUuid as detect } from '@workspace/tool-logic-uuid';
