/**
 * The UUID / ULID tool as a host lists it (docs/tools/specs/uuid.md): the description, its history declaration and its
 * component, loaded only when the tool is opened. Data only: it imports its history declaration and nothing else at
 * run time — a host reads it at build time and lists the tool without its code. Recognising pasted text is `./detect`.
 */
import { uuidHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'uuid',
  title: 'UUID / ULID',
  summary: 'Generate UUIDs (v4, v7, v5, v3) and ULIDs, or inspect one: version, variant, time.',
  keywords: ['uuid', 'guid', 'ulid', 'v4', 'v7', 'v5', 'v3', 'generate', 'decode', 'timestamp', 'rfc 9562'],
  order: 6,
  history: uuidHistory,
  // Makes identifiers on request (Generate); Copy / Copy all: one per line, no line break at the end.
  output: { origin: 'generated', copies: 'lines' },
  load: () => import('./UuidTool'),
};
