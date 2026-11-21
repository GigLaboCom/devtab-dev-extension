/**
 * The Hex and Text tool as a host lists it (docs/tools/specs/hex-ascii.md): the description, its history declaration and its
 * component, loaded only when the tool is opened. Data only: it imports its history declaration and nothing else at run
 * time — no logic, no library — so a host reads it at build time and lists the tool without its code.
 * Recognising pasted text is `./detect` (src/detect.ts).
 */
import { hexAsciiHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'hex-ascii',
  title: 'Hex and Text',
  summary: 'Turn text into hex bytes and back: UTF-8, UTF-16 or ISO-8859-1.',
  keywords: ['hex', 'ascii', 'hex to text', 'text to hex', 'bytes', 'utf-8', 'utf-16', 'latin-1', 'hexdump', '0x'],
  order: 19,
  history: hexAsciiHistory,
  // Its result comes from what the person gives it (a converter, an inspector): nothing to copy unasked.
  output: { origin: 'input' },
  load: () => import('./HexAsciiTool'),
};
