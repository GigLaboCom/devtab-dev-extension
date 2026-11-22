/**
 * How deep the HTML parser's stack of open elements will grow on this markup, before the markup reaches the parser
 * (docs/tools/specs/html-preview.md §12, §15): the scan is the shared `@workspace/tools-shared/html-depth` (written
 * here, moved there on 2026-11-22 when html-to-jsx needed the same guard).
 */
export { nestingDepth } from '@workspace/tools-shared/html-depth';

/** The deepest nesting the tool previews (§12): Chrome's own DOM stops at 512 levels. */
export const MAX_DEPTH = 512;
