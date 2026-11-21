/**
 * The Number Bases tool as a host lists it (docs/tools/specs/number-base.md): the description, its history declaration and its
 * component, loaded only when the tool is opened. Data only: it imports its history declaration and nothing else at run
 * time — no logic, no library — so a host reads it at build time and lists the tool without its code.
 * Recognising pasted text is `./detect` (src/detect.ts).
 */
import { numberBaseHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'number-base',
  title: 'Number Bases',
  summary: 'Convert a whole number between binary, octal, decimal, hex and any base up to 36.',
  keywords: ['number', 'base', 'radix', 'binary', 'octal', 'decimal', 'hex', "two's complement", 'bigint', '0x'],
  order: 15,
  history: numberBaseHistory,
  // Its result comes from what the person gives it (a converter, an inspector): nothing to copy unasked.
  output: { origin: 'input' },
  load: () => import('./NumberBaseTool'),
};
