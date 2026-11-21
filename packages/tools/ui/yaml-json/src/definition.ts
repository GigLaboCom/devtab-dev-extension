/**
 * The YAML and JSON tool as a host lists it (docs/tools/specs/yaml-json.md): the description, its history declaration
 * and its component, loaded only when the tool is opened. This module is part of every host page that lists the tools,
 * so it imports only the light `detect` and the declaration — never the component, the converter or the yaml library.
 */
import { yamlJsonHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'yaml-json',
  title: 'YAML and JSON',
  summary: 'Convert YAML to JSON and back, with the line and column of every error.',
  keywords: [
    'yaml',
    'yml',
    'json',
    'yaml to json',
    'json to yaml',
    'convert',
    'kubernetes',
    'docker compose',
    'openapi',
    'anchors',
  ],
  order: 11,
  history: yamlJsonHistory,
  // Converts what a person types, pastes or opens: the result is derived from their input, nothing is made.
  output: { origin: 'input' },
  load: () => import('./YamlJsonTool'),
};
