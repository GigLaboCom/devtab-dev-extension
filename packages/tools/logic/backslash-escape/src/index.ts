/** @workspace/tool-logic-backslash-escape — the String Escape tool's logic, everything its component and its definition use. */
export * from './types';
export { escapeString, quoteFor, quotesFor } from './escape';
export { unescapeString } from './unescape';
export { detectBackslashEscape } from './detect';
