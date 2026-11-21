/**
 * The RegExp tool as a host lists it (docs/tools/specs/regexp.md): the description, its history declaration and its
 * component, loaded only when the tool is opened. No `detect` (§7): a regular expression cannot be told from ordinary
 * text cheaply and reliably (`a+b`, `C:\path`, `/usr/bin/` are all valid patterns). This module is part of every host
 * page that lists the tools, so it imports only the declaration — never the component, the logic or the worker.
 */
import { regexpHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: 'regexp',
  title: 'RegExp',
  summary: 'Test a JavaScript regular expression: matches, groups and replacement.',
  keywords: [
    'regexp',
    'regex',
    'regular expression',
    'match',
    'groups',
    'named groups',
    'replace',
    'flags',
    'pattern',
    'javascript',
  ],
  order: 9,
  history: regexpHistory,
  // Matches and replaces in the text a person gives it: the result is derived from their input, nothing is made.
  output: { origin: 'input' },
  load: () => import('./RegexpTool'),
};
