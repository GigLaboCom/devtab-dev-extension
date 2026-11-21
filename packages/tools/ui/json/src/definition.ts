/**
 * The JSON tool as a host lists it (docs/tools/specs/json.md): the description, its history declaration and its
 * component, loaded only when the tool is opened. Data only: it imports its history declaration and nothing else at
 * run time — a host reads it at build time and lists the tool without its code. Recognising pasted text is `./detect`.
 */
import { jsonHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'json',
  title: 'JSON',
  summary: 'Format, validate and minify JSON.',
  keywords: ['json', 'format', 'pretty', 'validate', 'minify', 'sort keys'],
  order: 1,
  history: jsonHistory,
  // Formats, checks and minifies the JSON a person pastes: the result is derived from their input, nothing is made.
  output: { origin: 'input' },
  load: () => import('./JsonTool'),
};
