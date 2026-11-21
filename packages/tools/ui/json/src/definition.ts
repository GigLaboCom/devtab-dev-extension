/**
 * The JSON tool as a host lists it (docs/tools/specs/json.md): the description, its history declaration and its
 * component, loaded only when the tool is opened. This module is part of every host page that lists the tools, so it
 * imports only the light `detect` and the declaration.
 */
import { jsonHistory } from './history';
import { detectJson } from '@workspace/tool-logic-json';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'json',
  title: 'JSON',
  summary: 'Format, validate and minify JSON.',
  keywords: ['json', 'format', 'pretty', 'validate', 'minify', 'sort keys'],
  order: 1,
  detect: detectJson,
  history: jsonHistory,
  load: () => import('./JsonTool'),
};
