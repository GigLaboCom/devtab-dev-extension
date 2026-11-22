/**
 * How deep the markup nests, found before it reaches the browser's parser (docs/tools/specs/html-to-jsx.md §12, §15).
 * Chrome's parser spends time on every token in proportion to the depth of its stack of open elements and stops
 * nesting the DOM at 512 levels: 10,000 nested `<div>` (110 KB, under LIVE_INPUT) held the page 1.4 s, and past 512
 * levels the tree the tool walks is not the nesting the person wrote. So markup deeper than MAX_NESTING is refused
 * before parsing. The scan is the shared one html-preview refuses deep markup with (`@workspace/tools-shared/html-depth`:
 * linear, a model of the HTML tree builder, never below the DOM's depth on the known ways to grow it).
 */
import { nestingDepth as scanDepth } from '@workspace/tools-shared/html-depth';

/** The deepest nesting converted, counting `<html>` and `<body>`: Chrome's DOM stops nesting at 512 levels. */
export const MAX_NESTING = 512;

const DOCUMENT_START = /^[ \t\n\f\r]*<(?:!doctype|html(?=[ \t\n\f\r/>]|$))/i;

/**
 * The deepest nesting of `markup` as the tool parses it — a whole document as it is, anything else after
 * `<!doctype html>` (standards mode, as `parseMarkup` does); the scan stops as soon as it passes `limit`.
 */
export const nestingDepth = (markup: string, limit = MAX_NESTING): number =>
  scanDepth(DOCUMENT_START.test(markup) ? markup : `<!doctype html>${markup}`, limit);
