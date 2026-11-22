/**
 * The String Inspector as a host lists it (docs/tools/specs/string-inspector.md): the description, its history
 * declaration and its component, loaded only when the tool is opened. Data only: it imports its history declaration
 * and nothing else at run time — no logic, no library, not the table of names — so a host reads it at build time and
 * lists the tool without its code. Recognising pasted text is `./detect` (src/detect.ts, §7: a text that hides a zero
 * width space, a byte order mark, a bidirectional override or isolate, or a lone surrogate). No default `shortcut`.
 */
import { stringInspectorHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'string-inspector',
  title: 'String Inspector',
  summary: 'Count characters, bytes and words, and reveal invisible and look-alike characters.',
  keywords: [
    'string',
    'length',
    'count',
    'characters',
    'bytes',
    'utf-8',
    'utf-16',
    'code point',
    'grapheme',
    'unicode',
    'invisible',
    'zero width',
    'homoglyph',
  ],
  order: 28,
  history: stringInspectorHistory,
  // Shows what is in the text a person gives it (an inspector): nothing is made, nothing to copy unasked.
  output: { origin: 'input' },
  load: () => import('./StringInspectorTool'),
};
