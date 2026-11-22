/**
 * @workspace/tool-logic-string-inspector — the String Inspector tool's logic (docs/tools/specs/string-inspector.md §9),
 * pure TypeScript that runs in a page, a worker and Node alike: the summary, the warnings, the visible text and the
 * table by code point, the character names (loaded on first use) and the recognition of pasted text.
 */
export * from './limits.ts';
export * from './kinds.ts';
export * from './inspect.ts';
export * from './views.ts';
export * from './names.ts';
export { detectStringIssues } from './detect.ts';
