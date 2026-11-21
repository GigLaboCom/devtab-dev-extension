/**
 * The String Escape tool as a host lists it (docs/tools/specs/backslash-escape.md): the description, its history declaration and its
 * component, loaded only when the tool is opened. Data only: it imports its history declaration and nothing else at run
 * time — no logic, no library — so a host reads it at build time and lists the tool without its code.
 * Recognising pasted text is `./detect` (src/detect.ts).
 */
import { backslashEscapeHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'backslash-escape',
  title: 'String Escape',
  summary: 'Escape text for a string literal and unescape it back: JSON, JavaScript, Python, C.',
  keywords: ['escape', 'unescape', 'backslash', 'string literal', 'json string', 'quotes', '\\n', '\\u'],
  order: 18,
  history: backslashEscapeHistory,
  // Escapes and unescapes what a person types or pastes: a conversion of their input, nothing is made.
  output: { origin: 'input' },
  load: () => import('./BackslashEscapeTool'),
};
