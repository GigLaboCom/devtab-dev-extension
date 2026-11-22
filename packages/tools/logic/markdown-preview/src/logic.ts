/**
 * The Markdown Preview tool's logic (docs/tools/specs/markdown-preview.md §9): the limits of §12, Markdown → HTML with
 * the flavour and rules of §5.1–§5.5 (render.ts), and the allowlist of §5.6 that turns that HTML into new nodes of a
 * Document passed in (allowlist.ts). Pure apart from that parameter: no React, no chrome, no globals of a page.
 */
export { createRenderer, renderMarkdown } from './render';
export { isOpenableHref, toSafeFragment } from './allowlist';

/** Up to this many characters the preview follows every edit (§6, §12). */
export const LIVE_INPUT = 64 * 1024;
/** Above this many characters the tool refuses (§6, §12): 1 Mi = 1 048 576. */
export const MAX_INPUT = 1024 * 1024;
/** Between LIVE_INPUT and MAX_INPUT the preview is drawn this long after the last edit (§12). */
export const SETTLE_MS = 300;
