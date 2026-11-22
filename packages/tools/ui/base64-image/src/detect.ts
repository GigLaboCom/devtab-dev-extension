/**
 * Does pasted text look like the Base64 Image tool's input (docs/tools/specs/base64-image.md §7)? The package's `./detect` export,
 * a module of its own: a host loads it only when pasted text needs it, never with the list of tools. It imports the
 * tool's own logic and nothing else.
 */
export { detectBase64Image as detect } from '@workspace/tool-logic-base64-image';
