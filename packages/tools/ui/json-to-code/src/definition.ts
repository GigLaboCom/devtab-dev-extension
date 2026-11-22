/**
 * The JSON to Code tool as a host lists it (docs/tools/specs/json-to-code.md): the description, its history declaration
 * and its component, loaded only when the tool is opened. Data only: it imports its history declaration and nothing
 * else at run time — no logic, no library — so a host reads it at build time and lists the tool without its code.
 *
 * No `detect` (§7): its input is the same JSON the `json` tool takes, and JSON pasted into the start page's field must
 * open `json`. A person finds this tool by its title and keywords.
 */
import { jsonToCodeHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'json-to-code',
  title: 'JSON to Code',
  summary: 'Generate TypeScript, Go, Rust or Python types from a JSON sample.',
  keywords: [
    'json',
    'types',
    'typescript',
    'interface',
    'go',
    'struct',
    'rust',
    'serde',
    'python',
    'typeddict',
    'codegen',
    'infer',
  ],
  order: 31,
  history: jsonToCodeHistory,
  // Declarations derived from the sample a person pastes: nothing is made unasked.
  output: { origin: 'input' },
  load: () => import('./JsonToCodeTool'),
};
