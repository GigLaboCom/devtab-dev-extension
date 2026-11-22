/**
 * The Base64 Image tool as a host lists it (docs/tools/specs/base64-image.md): the description, its history declaration and its
 * component, loaded only when the tool is opened. Data only: it imports its history declaration and nothing else at run
 * time — no logic, no library — so a host reads it at build time and lists the tool without its code.
 * Recognising pasted text is `./detect` (src/detect.ts).
 */
import { base64ImageHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'base64-image',
  title: 'Base64 Image',
  summary: 'Turn an image into Base64 or a data URI, and a data URI back into an image.',
  keywords: ['base64', 'image', 'data uri', 'data url', 'png', 'jpeg', 'svg', 'img', 'css url', 'inline image'],
  order: 27,
  history: base64ImageHistory,
  // Its result comes from what the person gives it (a converter, an inspector): nothing to copy unasked.
  output: { origin: 'input' },
  load: () => import('./Base64ImageTool'),
};
