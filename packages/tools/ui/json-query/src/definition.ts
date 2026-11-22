/**
 * The JSON Query tool as a host lists it (docs/tools/specs/json-query.md): the description, its history declaration and its
 * component, loaded only when the tool is opened. Data only: it imports its history declaration and nothing else at run
 * time — no logic, no library — so a host reads it at build time and lists the tool without its code.
 * Recognising pasted text is `./detect` (src/detect.ts).
 */
import { jsonQueryHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'json-query',
  title: 'JSON Query',
  summary: 'Query JSON with JSONPath (RFC 9535): the matching values and their paths.',
  keywords: ['jsonpath', 'json', 'query', 'path', 'filter', 'select', 'extract', 'rfc 9535'],
  order: 35,
  history: jsonQueryHistory,
  // Its result comes from what the person gives it (a converter, an inspector): nothing to copy unasked.
  output: { origin: 'input' },
  load: () => import('./JsonQueryTool'),
};
