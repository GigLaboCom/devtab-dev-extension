/**
 * The HTML to JSX tool as a host lists it (docs/tools/specs/html-to-jsx.md): the description, its history declaration and its
 * component, loaded only when the tool is opened. Data only: it imports its history declaration and nothing else at run
 * time — no logic, no library — so a host reads it at build time and lists the tool without its code.
 */
import { htmlToJsxHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'html-to-jsx',
  title: 'HTML to JSX',
  summary: 'Convert HTML or SVG markup to JSX for React.',
  keywords: ['html', 'jsx', 'tsx', 'react', 'svg', 'classname', 'component', 'convert', 'markup'],
  order: 33,
  history: htmlToJsxHistory,
  // Its result comes from what the person gives it (a converter, an inspector): nothing to copy unasked.
  output: { origin: 'input' },
  load: () => import('./HtmlToJsxTool'),
};
