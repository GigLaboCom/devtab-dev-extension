/**
 * The composition root of the editor's highlighter — seam `Highlighter` (./highlighter.ts): which build of the editor
 * module the editor page starts. Today `syntect` (./syntect.ts), the owner's default until they decide otherwise; the
 * other is the mixed tree-sitter scheme (./treeSitter.ts: the common languages compiled in, the others grammar files of
 * the package). A build of it without editing this file: `pnpm build:tree-sitter` (DEVTAB_VARIANT=highlighter:treeSitter
 * into dist-tree-sitter/, extension/vite.config.ts); switching the default is this line (docs/editor-base.md).
 */
export { syntect as highlighter } from './syntect';
