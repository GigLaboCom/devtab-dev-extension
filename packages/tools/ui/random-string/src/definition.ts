/**
 * The Random String tool as a host lists it (docs/tools/specs/random-string.md): the description, its history
 * declaration and its component, loaded only when the tool is opened. Data only: it imports its history declaration and
 * nothing else at run time — no logic, no library — so a host reads it at build time and lists the tool without its
 * code. No `./detect` (§7): the tool takes no input, so there is no pasted text for it to recognise.
 */
import { randomStringHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'random-string',
  title: 'Random String',
  summary: 'Random strings and bytes for tokens, keys and test data.',
  keywords: ['random', 'string', 'token', 'secret', 'key', 'hex', 'bytes', 'nonce', 'salt', 'alphanumeric'],
  order: 29,
  history: randomStringHistory,
  // Makes strings on request (Generate); Copy / Copy all: one per line, no line break at the end.
  output: { origin: 'generated', copies: 'lines' },
  load: () => import('./RandomStringTool'),
};
