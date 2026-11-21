/**
 * @workspace/tool-logic-html-entities — the HTML Entities tool's logic (docs/tools/specs/html-entities.md §9), pure
 * TypeScript that runs in a page and in Node alike: encoding, decoding with the HTML Standard's table of names (loaded
 * on first use), and the recognition of pasted text.
 */
export * from './limits.ts';
export * from './encode.ts';
export * from './decode.ts';
export * from './table.ts';
export { detectHtmlEntities } from './detect.ts';
