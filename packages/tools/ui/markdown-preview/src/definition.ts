/**
 * The Markdown Preview tool as a host lists it (docs/tools/specs/markdown-preview.md): the description, its history declaration and its
 * component, loaded only when the tool is opened. Data only: it imports its history declaration and nothing else at run
 * time — no logic, no library — so a host reads it at build time and lists the tool without its code.
 */
import { markdownPreviewHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'markdown-preview',
  title: 'Markdown Preview',
  summary: 'See how Markdown renders. Nothing is loaded and nothing runs.',
  keywords: ['markdown', 'md', 'preview', 'render', 'readme', 'commonmark', 'gfm', 'table'],
  order: 23,
  history: markdownPreviewHistory,
  // Its result comes from what the person gives it (a converter, an inspector): nothing to copy unasked.
  output: { origin: 'input' },
  load: () => import('./MarkdownPreviewTool'),
};
