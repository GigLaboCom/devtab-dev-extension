/**
 * @workspace/tool-logic-html-to-jsx — the HTML to JSX tool's logic (docs/tools/specs/html-to-jsx.md §9): a walk over a
 * document parsed by the caller's DOMParser that writes JSX, the table of attribute names (loaded on first use) and the
 * pieces its tests use. Runs in a page and, with jsdom, in Node.
 */
export * from './limits.ts';
export * from './names.ts';
export { describeNotes, htmlToJsx, parseMarkup, reactAttributeName } from './convert.ts';
export type { JsxNote, JsxOptions, JsxResult, ParseHtml } from './convert.ts';
export { styleToObject } from './style.ts';
export { escapeJsxText } from './text.ts';
export { scanCode } from './handler.ts';
