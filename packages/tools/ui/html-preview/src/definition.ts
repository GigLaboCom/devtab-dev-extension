/**
 * The HTML Preview tool as a host lists it (docs/tools/specs/html-preview.md): the description, its history declaration and its
 * component, loaded only when the tool is opened. Data only: it imports its history declaration and nothing else at run
 * time — no logic, no library — so a host reads it at build time and lists the tool without its code.
 * Recognising pasted text is `./detect` (src/detect.ts).
 */
import { htmlPreviewHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'html-preview',
  title: 'HTML Preview',
  summary: 'Render pasted HTML with its styles. Scripts never run and nothing is loaded.',
  keywords: ['html', 'preview', 'render', 'email', 'template', 'snippet', 'css', 'sandbox'],
  order: 24,
  history: htmlPreviewHistory,
  // Its result comes from what the person gives it (a converter, an inspector): nothing to copy unasked.
  output: { origin: 'input' },
  load: () => import('./HtmlPreviewTool'),
};
