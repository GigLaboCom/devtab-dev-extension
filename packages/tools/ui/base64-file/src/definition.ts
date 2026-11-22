/**
 * The Base64 File tool as a host lists it (docs/tools/specs/base64-file.md): the description, its history declaration and its
 * component, loaded only when the tool is opened. Data only: it imports its history declaration and nothing else at run
 * time — no logic, no library — so a host reads it at build time and lists the tool without its code.
 * Recognising pasted text is `./detect` (src/detect.ts).
 */
import { base64FileHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'base64-file',
  title: 'Base64 File',
  summary: 'Turn any file into Base64 or a data URI, and Base64 back into a file.',
  keywords: ['base64', 'file', 'binary', 'data uri', 'decode to file', 'pdf', 'zip', 'certificate'],
  order: 38,
  history: base64FileHistory,
  // Its result comes from what the person gives it (a converter, an inspector): nothing to copy unasked.
  output: { origin: 'input' },
  load: () => import('./Base64FileTool'),
};
