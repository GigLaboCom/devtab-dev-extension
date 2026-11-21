/**
 * The UUID / ULID tool as a host lists it (docs/tools/specs/uuid.md): the description, its history declaration and its
 * component, loaded only when the tool is opened. This module is part of every host page that lists the tools, so it
 * imports only the light `detect` and the declaration — never the component or a library.
 */
import { uuidHistory } from './history';
import { detectUuid } from '@workspace/tool-logic-uuid';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'uuid',
  title: 'UUID / ULID',
  summary: 'Generate UUIDs (v4, v7, v5, v3) and ULIDs, or inspect one: version, variant, time.',
  keywords: ['uuid', 'guid', 'ulid', 'v4', 'v7', 'v5', 'v3', 'generate', 'decode', 'timestamp', 'rfc 9562'],
  order: 6,
  detect: detectUuid,
  history: uuidHistory,
  load: () => import('./UuidTool'),
};
