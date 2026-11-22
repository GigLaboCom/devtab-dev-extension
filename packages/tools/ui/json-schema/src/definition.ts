/**
 * The JSON Schema tool as a host lists it (docs/tools/specs/json-schema.md): the description, its history declaration and its
 * component, loaded only when the tool is opened. Data only: it imports its history declaration and nothing else at run
 * time — no logic, no library — so a host reads it at build time and lists the tool without its code.
 * Recognising pasted text is `./detect` (src/detect.ts).
 */
import { jsonSchemaHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'json-schema',
  title: 'JSON Schema',
  summary: 'Validate JSON against a JSON Schema and see every violation in place, or generate a schema from samples.',
  keywords: ['json schema', 'validate json', 'schema validator', 'generate schema', 'openapi', '$ref'],
  order: 42,
  history: jsonSchemaHistory,
  // Its result comes from what the person gives it (a converter, an inspector): nothing to copy unasked.
  output: { origin: 'input' },
  load: () => import('./JsonSchemaTool'),
};
